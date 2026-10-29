import http from 'node:http';
import https from 'node:https';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};
const limit = 512000;
function body(request, maximum = limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const onData = (chunk) => {
      size += chunk.length;
      if (size > maximum) {
        request.removeListener('data', onData);
        request.resume();
        resolve(null);
      } else chunks.push(chunk);
    };
    request.on('data', onData);
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}
export function createAdminServer({
  root = fileURLToPath(new URL('./dist/', import.meta.url)),
  apiUrl = process.env.ADMIN_API_URL,
  publicUrl = process.env.ADMIN_PUBLIC_URL,
} = {}) {
  let activeUploads = 0,
    activeDownloads = 0;
  const directory = path.resolve(root);
  if (process.env.NODE_ENV === 'production' && !publicUrl)
    throw new Error('ADMIN_PUBLIC_URL is required in production.');
  const publicOrigin = new URL(publicUrl ?? 'http://127.0.0.1:3173');
  if (
    publicOrigin.username ||
    publicOrigin.password ||
    publicOrigin.pathname !== '/' ||
    publicOrigin.search ||
    publicOrigin.hash ||
    !(
      publicOrigin.protocol === 'https:' ||
      (publicOrigin.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(publicOrigin.hostname))
    )
  )
    throw new Error('ADMIN_PUBLIC_URL must be HTTPS or the explicit loopback development origin.');
  const secureCookies = publicOrigin.protocol === 'https:';
  const upstream = apiUrl ? new URL(apiUrl) : null;
  if (upstream && !['http:', 'https:'].includes(upstream.protocol))
    throw new Error('ADMIN_API_URL must use HTTP or HTTPS.');
  return http.createServer(
    { requestTimeout: 60000, headersTimeout: 15000 },
    async (request, response) => {
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('X-Frame-Options', 'DENY');
      response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader(
        'Permissions-Policy',
        'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      );
      if (secureCookies) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
      const problem = (status) => {
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({
            title: status === 413 ? 'request_too_large' : 'unavailable',
            detail: status === 413 ? 'Request is too large.' : 'Admin API is unavailable.',
          }),
        );
      };
      try {
        const incoming = new URL(request.url ?? '/', 'http://localhost');
        if (incoming.pathname.startsWith('/api/')) {
          response.setHeader('Cache-Control', 'private, no-store');
          response.setHeader('X-Robots-Tag', 'noindex, nofollow');
          response.setHeader('Vary', 'Origin, Cookie, Authorization');
          const authRoute =
            /^\/api\/auth\/(?:password|refresh|logout|me|staff\/password|mfa\/(?:setup|verify|recovery-codes|recover))$/.test(
              incoming.pathname,
            );
          if (!authRoute && !incoming.pathname.startsWith('/api/admin/')) {
            response.writeHead(404);
            response.end();
            request.resume();
            return;
          }
          const origin = request.headers.origin;
          if (
            request.headers['sec-fetch-site'] === 'cross-site' ||
            (origin && origin !== publicOrigin.origin) ||
            (authRoute && request.method !== 'GET' && !origin)
          ) {
            response.writeHead(403);
            response.end();
            request.resume();
            return;
          }
          if (!authRoute && !request.headers.authorization) {
            response.writeHead(401);
            response.end();
            request.resume();
            return;
          }
          if (
            authRoute &&
            (incoming.search ||
              !(
                (request.method === 'GET' &&
                  ['me', 'mfa/recovery-codes'].includes(incoming.pathname.slice(10))) ||
                (request.method === 'POST' && !incoming.pathname.endsWith('/me'))
              ))
          ) {
            response.writeHead(400);
            response.end();
            request.resume();
            return;
          }
          if (
            authRoute &&
            request.method === 'POST' &&
            !/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')
          ) {
            response.writeHead(415);
            response.end();
            request.resume();
            return;
          }
          const realtime = /^\/api\/admin\/realtime(?:\/negotiate)?$/.test(incoming.pathname);
          const privateStaff =
            incoming.pathname === '/api/admin/staff' ||
            incoming.pathname.startsWith('/api/admin/staff/') ||
            incoming.pathname === '/api/admin/staff-candidate' ||
            incoming.pathname === '/api/admin/staff-role-catalog';
          const privateCustomers =
            incoming.pathname === '/api/admin/customers' ||
            incoming.pathname.startsWith('/api/admin/customers/');
          const initialStaffPassword = incoming.pathname === '/api/auth/staff/password';
          const staffBoundary = privateStaff || initialStaffPassword || privateCustomers;
          const privateParcels =
            incoming.pathname.startsWith('/api/admin/orders/') &&
            incoming.pathname.includes('/fulfillment');
          const privateCreditOrders = incoming.pathname.startsWith('/api/admin/credit-orders/');
          const privateCredit =
            incoming.pathname === '/api/admin/credit' ||
            incoming.pathname.startsWith('/api/admin/credit/');
          const creditDocumentDownload =
            /^\/api\/admin\/credit\/applications\/[a-f0-9]{32}\/documents\/files\/[a-f0-9]{32}$/.test(
              incoming.pathname,
            ) && request.method === 'GET';
          const privateFiles =
              /^\/api\/admin\/support\/(?:files\/capabilities|tickets\/[a-f0-9]{32}\/attachments(?:\/[a-f0-9]{32})?)$/.test(
                incoming.pathname,
              ),
            privateFileUpload =
              privateFiles &&
              request.method === 'POST' &&
              /\/attachments\/[a-f0-9]{32}$/.test(incoming.pathname),
            privateDownload =
              creditDocumentDownload ||
              (privateFiles &&
                request.method === 'GET' &&
                /\/attachments\/[a-f0-9]{32}$/.test(incoming.pathname));
          const privateBlog =
            incoming.pathname === '/api/admin/blog-posts' ||
            incoming.pathname.startsWith('/api/admin/blog-posts/');
          const privatePages =
            privateBlog ||
            incoming.pathname === '/api/admin/pages' ||
            incoming.pathname.startsWith('/api/admin/pages/');
          const privateRedirects =
            incoming.pathname === '/api/admin/redirects' ||
            incoming.pathname.startsWith('/api/admin/redirects/');
          const privateApi =
            staffBoundary ||
            privateParcels ||
            privateRedirects ||
            privatePages ||
            realtime ||
            privateFiles ||
            privateCredit ||
            privateCreditOrders;
          if (privateApi) {
            response.setHeader('Cache-Control', 'private, no-store');
            response.setHeader('X-Robots-Tag', 'noindex, nofollow');
            response.setHeader('Vary', 'Cookie, Authorization');
          }
          if (!upstream) {
            problem(503);
            return;
          }
          if (staffBoundary) {
            if (!request.headers.authorization) {
              response.writeHead(401);
              response.end();
              request.resume();
              return;
            }
            const base = '/api/admin/staff',
              id = '[A-Za-z0-9_-]{1,450}',
              commandId = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
            const path = incoming.pathname;
            const customerBase = '/api/admin/customers',
              customerRoute = new RegExp(
                '^' +
                  customerBase +
                  '(?:/' +
                  id +
                  '(?:/(?:orders(?:/[a-f0-9]{32})?|tickets(?:/[a-f0-9]{32}/messages)?))?)?$',
              );
            const allowed = privateCustomers
              ? customerRoute.test(path)
                ? ['GET']
                : []
              : initialStaffPassword ||
                  path === base + '/accounts' ||
                  path === '/api/admin/staff-candidate'
                ? ['POST']
                : path === base
                  ? ['GET', 'POST']
                  : path === '/api/admin/staff-role-catalog' ||
                      new RegExp('^' + base + '/creation-commands/' + commandId + '$').test(path) ||
                      new RegExp('^' + base + '/' + id + '/history$').test(path)
                    ? ['GET']
                    : new RegExp('^' + base + '/' + id + '$').test(path)
                      ? ['GET', 'PUT']
                      : [];
            if (!allowed.length || !allowed.includes(request.method)) {
              response.writeHead(allowed.length ? 405 : 400);
              response.end();
              request.resume();
              return;
            }
            const keys = privateCustomers
              ? path === customerBase
                ? ['query', 'active', 'kind', 'cursor']
                : /\/(?:orders|tickets|messages)$/.test(path)
                  ? ['cursor']
                  : []
              : path === base && request.method === 'GET'
                ? ['query', 'active', 'role', 'cursor']
                : path.endsWith('/history')
                  ? ['cursor']
                  : [];
            if (
              [...incoming.searchParams.keys()].some(
                (key) => !keys.includes(key) || incoming.searchParams.getAll(key).length !== 1,
              ) ||
              (incoming.searchParams.get('query')?.length ?? 0) > 120
            ) {
              response.writeHead(400);
              response.end();
              request.resume();
              return;
            }
            if (
              request.method !== 'GET' &&
              !/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')
            ) {
              response.writeHead(415);
              response.end();
              request.resume();
              return;
            }
          }
          if (privateParcels) {
            if (!request.headers.authorization) {
              response.writeHead(401);
              response.end();
              request.resume();
              return;
            }
            const id = '[a-f0-9]{32}',
              base = '/api/admin/orders/[A-Za-z0-9_-]{1,64}/' + id + '/fulfillment';
            const page = new RegExp('^' + base + '$').test(incoming.pathname),
              read = new RegExp('^' + base + '(?:/(?:parcels|commands)/' + id + ')?$').test(
                incoming.pathname,
              ),
              write = new RegExp('^' + base + '/commands/' + id + '$').test(incoming.pathname);
            if (
              /(?:^|\/)0{32}(?:\/|$)/.test(incoming.pathname) ||
              !((request.method === 'GET' && read) || (request.method === 'POST' && write))
            ) {
              response.writeHead(request.method === 'GET' ? 404 : 405);
              response.end();
              request.resume();
              return;
            }
            const entries = [...incoming.searchParams];
            if (
              entries.length &&
              (request.method !== 'GET' ||
                !page ||
                entries.length !== 1 ||
                entries[0][0] !== 'after' ||
                !/^[1-9][0-9]{0,18}$/.test(entries[0][1]) ||
                BigInt(entries[0][1]) > 9223372036854775807n)
            ) {
              response.writeHead(400);
              response.end();
              request.resume();
              return;
            }
          }
          if (privateRedirects) {
            if (!request.headers.authorization) {
              response.writeHead(401);
              response.end();
              request.resume();
              return;
            }
            const tail = incoming.pathname.slice('/api/admin/redirects'.length),
              id = '[a-f0-9]{32}';
            const read = new RegExp(
                '^(?:|/' +
                  id +
                  '|/' +
                  id +
                  '/preview|/' +
                  id +
                  '/history|/' +
                  id +
                  '/revisions/' +
                  id +
                  '|(?:/' +
                  id +
                  ')?/commands/' +
                  id +
                  ')$',
              ).test(tail),
              write = new RegExp('^(?:/' + id + ')?/commands/' + id + '$').test(tail);
            if (!(request.method === 'GET' ? read : request.method === 'POST' && write)) {
              response.writeHead(405);
              response.end();
              request.resume();
              return;
            }
            const params = [...incoming.searchParams],
              allowed =
                tail === '' ? ['cursor'] : tail.endsWith('/history') ? ['beforePublication'] : [];
            if (
              params.length !== new Set(params.map((x) => x[0])).size ||
              params.some(
                ([k, v]) =>
                  !allowed.includes(k) ||
                  (k === 'cursor'
                    ? !/^\/(fa|en)\/(product|pages)\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v) ||
                      /\s/.test(v) ||
                      v.length > 192 ||
                      v.split('/')[3].length > (v.split('/')[2] === 'pages' ? 80 : 150)
                    : !/^[1-9][0-9]{0,4}$/.test(v) || Number(v) > 10000),
              )
            ) {
              response.writeHead(400);
              response.end();
              request.resume();
              return;
            }
          }
          if (privatePages) {
            if (!request.headers.authorization) {
              response.writeHead(401);
              response.end();
              request.resume();
              return;
            }
            const tail = incoming.pathname.slice(
                (privateBlog ? '/api/admin/blog-posts' : '/api/admin/pages').length,
              ),
              id = '[a-f0-9]{32}';
            const read = new RegExp(
                '^(?:|/' +
                  id +
                  '|/' +
                  id +
                  '/history|/' +
                  id +
                  '/revisions/' +
                  id +
                  '|(?:/' +
                  id +
                  ')?/commands/' +
                  id +
                  ')$',
              ).test(tail),
              write = new RegExp('^(?:/' + id + ')?/commands/' + id + '$').test(tail);
            if (!(request.method === 'GET' ? read : request.method === 'POST' && write)) {
              response.writeHead(405);
              response.end();
              request.resume();
              return;
            }
            const params = [...incoming.searchParams],
              allowed =
                tail === '' ? ['cursor'] : tail.endsWith('/history') ? ['beforePublication'] : [];
            if (
              params.length !== new Set(params.map((x) => x[0])).size ||
              params.some(
                ([k, v]) =>
                  !allowed.includes(k) ||
                  (k === 'cursor'
                    ? !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v) || v.length > 80
                    : !/^[1-9][0-9]{0,4}$/.test(v) || Number(v) > 10000),
              )
            ) {
              response.writeHead(400);
              response.end();
              request.resume();
              return;
            }
          }
          if (privateCreditOrders) {
            if (!request.headers.authorization) {
              response.writeHead(401);
              response.end();
              request.resume();
              return;
            }
            if (
              request.method !== 'GET' ||
              !/^\/api\/admin\/credit-orders\/[A-Za-z0-9_-]{1,64}\/[a-f0-9]{32}$/.test(
                incoming.pathname,
              ) ||
              /\/0{32}$/.test(incoming.pathname)
            ) {
              response.writeHead(request.method === 'GET' ? 404 : 405);
              response.end();
              request.resume();
              return;
            }
            if (incoming.search) {
              response.writeHead(400);
              response.end();
              request.resume();
              return;
            }
          }
          if (privateCredit) {
            if (!request.headers.authorization) {
              response.writeHead(401);
              response.end();
              request.resume();
              return;
            }
            const id = '[a-f0-9]{32}',
              base = '/api/admin/credit/',
              p = incoming.pathname.slice(base.length),
              history = p === 'requirements/history';
            const approvalBase = 'orders/[A-Za-z0-9_-]{1,64}/' + id + '/cheque-approvals';
            const policyBase = 'review-hold-policy',
              clearanceBase = 'orders/[A-Za-z0-9_-]{1,64}/' + id + '/clearance';
            const upfrontBase = 'orders/[A-Za-z0-9_-]{1,64}/' + id + '/upfront';
            const chequeBase = 'orders/[A-Za-z0-9_-]{1,64}/' + id + '/cheques';
            const reminderBase = chequeBase + '/' + id + '/reminders',
              reminderPolicyBase = 'reminder-policy';
            const orderBase = 'orders/[A-Za-z0-9_-]{1,64}/' + id + '/schedule';
            const read =
                new RegExp('^' + reminderPolicyBase + '(?:/history|/commands/' + id + ')?$').test(
                  p,
                ) ||
                new RegExp('^' + reminderBase + '(?:/history|/commands/' + id + ')?$').test(p) ||
                p === 'cheque-report' ||
                new RegExp('^' + clearanceBase + '(?:/history|/commands/' + id + ')?$').test(p) ||
                new RegExp('^' + policyBase + '(?:/history|/commands/' + id + ')?$').test(p) ||
                new RegExp(
                  '^' + approvalBase + '(?:/' + id + '(?:/history|/commands/' + id + ')?)?$',
                ).test(p) ||
                new RegExp('^' + upfrontBase + '(?:/history|/commands/' + id + ')?$').test(p) ||
                new RegExp(
                  '^' + chequeBase + '(?:/' + id + '(?:/history)?|/commands/' + id + ')?$',
                ).test(p) ||
                p === 'orders' ||
                new RegExp('^' + orderBase + '(?:/history|/commands/' + id + ')?$').test(p) ||
                p === 'applications' ||
                p === 'requirements' ||
                history ||
                new RegExp(
                  '^applications/' +
                    id +
                    '(?:/purchase-scope(?:/commands/' +
                    id +
                    ')?|/review|/reviews(?:/(?:commands/)?' +
                    id +
                    ')?|/submission|/submissions(?:/' +
                    id +
                    ')?|/requirements|/documents(?:/files/' +
                    id +
                    ')?)?$',
                ).test(p) ||
                new RegExp('^requirements/(?:revisions|commands)/' + id + '$').test(p),
              write =
                new RegExp('^' + reminderPolicyBase + '/commands/' + id + '$').test(p) ||
                new RegExp('^' + reminderBase + '/commands/' + id + '$').test(p) ||
                new RegExp('^' + clearanceBase + '/commands/' + id + '$').test(p) ||
                new RegExp('^' + policyBase + '/commands/' + id + '$').test(p) ||
                new RegExp('^' + approvalBase + '/' + id + '/commands/' + id + '$').test(p) ||
                new RegExp('^' + upfrontBase + '/commands/' + id + '$').test(p) ||
                new RegExp('^' + chequeBase + '/(?:receive|' + id + ')/commands/' + id + '$').test(
                  p,
                ) ||
                new RegExp('^' + orderBase + '/(?:preview|commands/' + id + ')$').test(p) ||
                new RegExp(
                  '^(?:requirements/commands/' +
                    id +
                    '|applications/' +
                    id +
                    '/purchase-scope/(?:grant|revoke)/' +
                    id +
                    '|applications/' +
                    id +
                    '/reviews/commands/' +
                    id +
                    ')$',
                ).test(p);
            if (
              !((request.method === 'GET' && read) || (request.method === 'POST' && write)) ||
              /(?:^|\/)0{32}(?:\/|$)/.test(p)
            ) {
              response.writeHead(request.method !== 'GET' ? 405 : 404);
              response.end();
              request.resume();
              return;
            }
            const allowed =
                request.method === 'GET'
                  ? p === 'cheque-report'
                    ? ['from', 'through', 'state', 'cursor']
                    : p === policyBase + '/history' || p === reminderPolicyBase + '/history'
                      ? ['beforeRevision']
                      : p === 'applications'
                        ? ['state', 'cursor']
                        : history || p === 'orders'
                          ? ['cursor']
                          : new RegExp('^' + orderBase + '/history$').test(p)
                            ? ['beforeRevision']
                            : new RegExp('^' + reminderBase + '/history$').test(p) ||
                                new RegExp('^' + clearanceBase + '/history$').test(p) ||
                                new RegExp('^' + approvalBase + '/' + id + '/history$').test(p) ||
                                new RegExp('^' + upfrontBase + '/history$').test(p) ||
                                new RegExp('^' + chequeBase + '/' + id + '/history$').test(p)
                              ? ['beforeSequence']
                              : []
                  : [],
              entries = [...incoming.searchParams];
            if (p === 'cheque-report') {
              const date = (v) =>
                /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v) &&
                Number(v.slice(0, 4)) >= 2000 &&
                Number.isFinite(Date.parse(v + 'T12:00:00Z')) &&
                new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v;
              const from = incoming.searchParams.get('from'),
                through = incoming.searchParams.get('through');
              if (
                entries.length !== new Set(entries.map((x) => x[0])).size ||
                !from ||
                !through ||
                !date(from) ||
                !date(through) ||
                from > through ||
                Date.parse(through) - Date.parse(from) > 365 * 86400000 ||
                !incoming.searchParams.has('state') ||
                entries.some(
                  ([k, v]) =>
                    !allowed.includes(k) ||
                    (k === 'state'
                      ? ![
                          'All',
                          'Received',
                          'Deposited',
                          'CollectedReported',
                          'BouncedReported',
                          'Withdrawn',
                          'ReturnedToCustomer',
                        ].includes(v)
                      : k === 'cursor'
                        ? !/^[A-Za-z0-9_-]{1,2048}$/.test(v)
                        : !date(v)),
                )
              ) {
                response.writeHead(400);
                response.end();
                request.resume();
                return;
              }
            } else if (
              entries.length !== new Set(entries.map((x) => x[0])).size ||
              entries.some(
                ([key, value]) =>
                  !allowed.includes(key) ||
                  (key === 'state'
                    ? !['Draft', 'Submitted', 'Cancelled', 'Approved', 'Declined'].includes(value)
                    : key === 'beforeSequence'
                      ? !/^[1-9][0-9]{0,3}$/.test(value) ||
                        Number(value) >
                          (new RegExp('^' + reminderBase + '/history$').test(p) ? 3650 : 200)
                      : key === 'beforeRevision'
                        ? !/^[1-9][0-9]{0,9}$/.test(value) ||
                          Number(value) >
                            (p === policyBase + '/history' || p === reminderPolicyBase + '/history'
                              ? 10000
                              : 2147483647)
                        : value.length < 1 ||
                          value.length > 180 ||
                          !/^[A-Za-z0-9+/]+={0,2}$/.test(value)),
              )
            ) {
              response.writeHead(400);
              response.end();
              request.resume();
              return;
            }
          }
          if (privateDownload) {
            if (request.headers.range) {
              response.writeHead(400);
              response.end();
              request.resume();
              return;
            }
            if (!request.headers.authorization) {
              response.writeHead(401);
              response.end();
              request.resume();
              return;
            }
            if (activeDownloads >= 2) {
              response.writeHead(429, { 'Retry-After': '2' });
              response.end();
              request.resume();
              return;
            }
            activeDownloads++;
            const deadline = setTimeout(() => response.destroy(), 30000);
            deadline.unref();
            response.once('close', () => {
              clearTimeout(deadline);
              activeDownloads--;
            });
          }
          if (
            !['GET', 'POST', 'PUT'].includes(request.method ?? '') &&
            !(
              realtime &&
              incoming.pathname === '/api/admin/realtime' &&
              request.method === 'DELETE'
            )
          ) {
            response.writeHead(405);
            response.end();
            request.resume();
            return;
          }
          const upload =
            privateFileUpload ||
            (incoming.pathname === '/api/admin/media/images' && request.method === 'POST');
          const maximum =
            authRoute || staffBoundary
              ? 16384
              : privateParcels
                ? 65536
                : privateRedirects
                  ? 16384
                  : privatePages
                    ? 131072
                    : privateCreditOrders
                      ? 16384
                      : privateCredit
                        ? /^\/api\/admin\/credit\/requirements\/commands\//.test(incoming.pathname)
                          ? 49152
                          : 8192
                        : realtime
                          ? 4096
                          : upload
                            ? 8 * 1024 * 1024 + 65536
                            : limit;
          if (upload) {
            if (!request.headers.authorization) {
              response.writeHead(401, { 'Content-Type': 'application/json' });
              response.end(JSON.stringify({ title: 'unauthorized' }));
              request.resume();
              return;
            }
            if (activeUploads >= 2) {
              response.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '2' });
              response.end(JSON.stringify({ title: 'media_busy' }));
              request.resume();
              return;
            }
            activeUploads++;
            let released = false;
            response.once('close', () => {
              if (!released) {
                released = true;
                activeUploads--;
              }
            });
          }
          if (Number(request.headers['content-length'] ?? 0) > maximum) {
            problem(413);
            request.resume();
            return;
          }
          const payload = await body(request, maximum);
          if (payload === null) {
            problem(413);
            return;
          }
          if ((privateParcels || staffBoundary) && request.method === 'GET' && payload.length) {
            response.writeHead(400);
            response.end();
            return;
          }
          const destination = new URL(upstream);
          destination.pathname = incoming.pathname;
          destination.search = incoming.search;
          const headers = {
            host: destination.host,
            'content-type': request.headers['content-type'] ?? 'application/json',
            'content-length': payload.length,
          };
          for (const key of ['authorization', 'origin'])
            if (request.headers[key]) headers[key] = request.headers[key];
          headers['x-sayman-client'] = 'admin';
          if (incoming.pathname === '/api/auth/password') headers['x-sayman-admin'] = '1';
          if (authRoute) {
            try {
              const cookie = readAdminRefreshCookie(request.headers.cookie, secureCookies);
              if (cookie) headers.cookie = `${adminRefreshCookieName(secureCookies)}=${cookie}`;
            } catch {
              response.writeHead(400);
              response.end();
              return;
            }
          }
          const proxy = (destination.protocol === 'https:' ? https : http).request(
            destination,
            { method: request.method, headers },
            (remote) => {
              const result = {
                'Content-Type': remote.headers['content-type'] ?? 'application/json',
                'Cache-Control': 'private, no-store',
                'X-Robots-Tag': 'noindex, nofollow',
                Vary: 'Origin, Cookie, Authorization',
              };
              if (privateApi) {
                result['X-Robots-Tag'] = 'noindex, nofollow';
                result.Vary = 'Cookie, Authorization';
              }
              if (remote.headers['set-cookie']) {
                const cookies = remote.headers['set-cookie'].map((cookie) =>
                  safeAdminRefreshCookie(cookie, secureCookies),
                );
                if (!authRoute || cookies.some((cookie) => !cookie)) {
                  remote.destroy();
                  problem(503);
                  return;
                }
                result['Set-Cookie'] = cookies;
              }
              if (remote.headers['retry-after'])
                result['Retry-After'] = remote.headers['retry-after'];
              if (authRoute) {
                const chunks = [];
                let received = 0,
                  finished = false;
                const reject = () => {
                  if (finished) return;
                  finished = true;
                  remote.destroy();
                  if (!response.headersSent && !response.destroyed) problem(503);
                };
                if (
                  Number(remote.headers['content-length']) > 32768 ||
                  (remote.statusCode !== 204 &&
                    !/^application\/json(?:\s*;|$)/i.test(remote.headers['content-type'] ?? ''))
                ) {
                  reject();
                  return;
                }
                remote.on('data', (chunk) => {
                  received += chunk.length;
                  if (received > 32768) reject();
                  else if (!finished) chunks.push(chunk);
                });
                remote.once('error', reject);
                remote.once('aborted', reject);
                remote.once('end', () => {
                  if (finished) return;
                  const content = Buffer.concat(chunks);
                  try {
                    if (remote.statusCode !== 204)
                      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content));
                    else if (content.length) throw Error('Unexpected auth body');
                  } catch {
                    reject();
                    return;
                  }
                  finished = true;
                  response.writeHead(remote.statusCode ?? 503, result);
                  response.end(content);
                });
                return;
              }
              if (!privateDownload) {
                const maximumResponse = 8 * 1024 * 1024;
                if (Number(remote.headers['content-length']) > maximumResponse) {
                  remote.destroy();
                  problem(503);
                  return;
                }
                let received = 0;
                remote.on('data', (chunk) => {
                  received += chunk.length;
                  if (received > maximumResponse) {
                    remote.destroy();
                    response.destroy();
                  }
                });
              }
              if (
                (staffBoundary ||
                  privateParcels ||
                  privateRedirects ||
                  privatePages ||
                  privateFiles ||
                  privateCredit ||
                  privateCreditOrders) &&
                remote.headers['set-cookie']
              ) {
                remote.destroy();
                problem(503);
                return;
              }
              if (privateParcels) {
                if (
                  (remote.statusCode === 200 || remote.statusCode === 404) &&
                  remote.headers['x-sayman-fulfillment-contract'] !== 'parcels-v1'
                ) {
                  remote.destroy();
                  problem(503);
                  return;
                }
                if (remote.headers['x-sayman-fulfillment-contract'] === 'parcels-v1')
                  result['X-Sayman-Fulfillment-Contract'] = 'parcels-v1';
              }
              if (
                (staffBoundary ||
                  privateParcels ||
                  privateRedirects ||
                  privatePages ||
                  privateCredit ||
                  privateCreditOrders) &&
                !privateDownload
              ) {
                const responseLimit =
                  privateStaff || privateCustomers
                    ? 1048576
                    : privateParcels
                      ? 4194304
                      : privateCreditOrders
                        ? 1048576
                        : 262144;
                if (
                  Number(remote.headers['content-length']) > responseLimit ||
                  (remote.statusCode === 200 &&
                    !/^application\/json(?:\s*;|$)/i.test(remote.headers['content-type'] ?? ''))
                ) {
                  remote.destroy();
                  problem(503);
                  return;
                }
                let received = 0;
                remote.on('data', (chunk) => {
                  received += chunk.length;
                  if (received > responseLimit) {
                    remote.destroy();
                    response.destroy();
                  }
                });
              }
              if (privateDownload && remote.statusCode === 200) {
                const fileId = incoming.pathname.split('/').at(-1),
                  length = Number(remote.headers['content-length']),
                  mime = remote.headers['content-type'],
                  disposition = remote.headers['content-disposition'];
                if (
                  !Number.isSafeInteger(length) ||
                  length < 16 ||
                  length > 8 * 1024 * 1024 ||
                  remote.headers['x-sayman-private-file'] !== fileId ||
                  !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(mime) ||
                  !/^attachment(?:;|$)/i.test(disposition ?? '')
                ) {
                  remote.destroy();
                  problem(503);
                  return;
                }
                result['Content-Length'] = String(length);
                result['Content-Disposition'] = disposition;
                result['X-Sayman-Private-File'] = fileId;
                result['Content-Security-Policy'] = "default-src 'none'; sandbox";
                let received = 0;
                remote.on('data', (chunk) => {
                  received += chunk.length;
                  if (received > length) {
                    remote.destroy();
                    response.destroy();
                  }
                });
                remote.once('end', () => {
                  if (received !== length) response.destroy();
                });
              }
              response.writeHead(remote.statusCode ?? 502, result);
              remote.pipe(response);
            },
          );
          proxy.setTimeout(
            privateParcels
              ? 45000
              : realtime
                ? 20000
                : upload ||
                    incoming.pathname === '/api/admin/market/import/commit' ||
                    incoming.pathname === '/api/admin/market/source-import/commit' ||
                    (request.method === 'POST' &&
                      (/^\/api\/admin\/accounting\/holoo\/imports\/[a-f0-9]{32}\/stock-commands$/.test(
                        incoming.pathname,
                      ) ||
                        /^\/api\/admin\/orders\/[a-f0-9]{32}\/shipment\/commands$/.test(
                          incoming.pathname,
                        )))
                  ? 45000
                  : 12000,
            () => proxy.destroy(),
          );
          proxy.on('error', () => {
            if (response.destroyed || response.writableEnded) return;
            if (!response.headersSent) problem(503);
            else response.destroy();
          });
          request.on('aborted', () => proxy.destroy());
          response.once('close', () => {
            if (!response.writableEnded) proxy.destroy();
          });
          proxy.end(payload);
          return;
        }
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.writeHead(405);
          response.end();
          return;
        }
        let decoded;
        try {
          decoded = decodeURIComponent(incoming.pathname);
        } catch {
          response.writeHead(400);
          response.end();
          return;
        }
        const target = path.resolve(directory, '.' + decoded);
        if (target !== directory && !target.startsWith(directory + path.sep)) {
          response.writeHead(403);
          response.end();
          return;
        }
        if (
          decoded.split('/').some((segment) => segment.startsWith('.')) ||
          decoded.endsWith('.map')
        ) {
          response.writeHead(404);
          response.end();
          return;
        }
        let filename = target;
        try {
          if (!(await stat(filename)).isFile()) throw new Error('not a file');
        } catch {
          if (path.extname(decoded)) {
            response.writeHead(404);
            response.end();
            return;
          }
          filename = path.join(directory, 'index.html');
        }
        const content = await readFile(filename);
        const extension = path.extname(filename);
        if (!(extension in types)) {
          response.writeHead(404);
          response.end();
          return;
        }
        response.setHeader(
          'Content-Security-Policy',
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
        );
        response.setHeader('Content-Type', types[extension] ?? 'application/octet-stream');
        if (incoming.pathname.startsWith('/assets/'))
          response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        response.writeHead(200);
        response.end(request.method === 'HEAD' ? undefined : content);
      } catch {
        if (response.destroyed || response.writableEnded) return;
        if (!response.headersSent) problem(503);
        else response.destroy();
      }
    },
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8080);
  createAdminServer().listen(port, process.env.HOSTNAME ?? '127.0.0.1', () =>
    console.log(`Admin server listening on port ${port}`),
  );
}

export function adminRefreshCookieName(https) {
  return (https ? '__Host-' : '') + 'sayman_admin_refresh';
}
export function readAdminRefreshCookie(header, https) {
  const name = adminRefreshCookieName(https);
  const values = (header ?? '')
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p.startsWith(name + '='))
    .map((p) => p.slice(name.length + 1));
  if (!values.length) return undefined;
  if (values.length !== 1 || !/^[a-f\d]{64}$/i.test(values[0]))
    throw Error('Invalid or ambiguous refresh cookie');
  return values[0];
}
export function safeAdminRefreshCookie(header, https) {
  const parts = header.split(';').map((p) => p.trim()),
    match = parts[0].match(/^([^=]+)=(.*)$/);
  if (!match || parts.some((p) => /^domain\s*=/i.test(p))) return undefined;
  const [, name, value] = match,
    expected = adminRefreshCookieName(https);
  const age = parts.find((p) => /^max-age=/i.test(p))?.slice(8),
    expires = parts.find((p) => /^expires=/i.test(p))?.slice(8);
  const deletion =
    value === '' && (age === '0' || (expires !== undefined && Date.parse(expires) < Date.now()));
  if (https && name === adminRefreshCookieName(false) && deletion)
    return `${name}=; Path=/api/auth; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
  if (
    name !== expected ||
    (!deletion &&
      (!/^[a-f\d]{64}$/i.test(value) ||
        !age ||
        !/^\d+$/.test(age) ||
        Number(age) < 1 ||
        Number(age) > 604800))
  )
    return undefined;
  if (https && !parts.some((p) => /^secure$/i.test(p))) return undefined;
  return `${name}=${value}; Path=${https ? '/' : '/api/auth'}; Max-Age=${deletion ? '0' : age}; HttpOnly; SameSite=Strict${https ? '; Secure' : ''}`;
}
