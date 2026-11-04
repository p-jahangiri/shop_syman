import { publicOrigin } from '../seo/seo.ts';
import { safeRefreshCookie } from '../auth/auth-cookie.ts';
import type { OrderProxyEnvironment } from '../orders/order-proxy.ts';
import {
  isCustomerAccountPath,
  customerAccountProfileSchema,
  updateCustomerProfileSchema,
  changeCustomerPasswordSchema,
} from './customer-account-contract.ts';

const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie, Authorization',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
};
class AccountProxyError extends Error {
  status: number;
  constructor(status: number) {
    super('Account proxy failed');
    this.status = status;
  }
}

// Both commands are flat string-valued objects. Read their original keys before
// JSON.parse can collapse duplicates, including escaped spellings of a key.
function parseInput(raw: string): unknown {
  // eslint-disable-next-line no-control-regex -- JSON string tokens exclude literal control bytes.
  const token = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*"/y,
    keys = new Set<string>();
  let at = 0;
  const whitespace = () => {
    while (/[ \t\r\n]/.test(raw[at] ?? '') && at < raw.length) at++;
  };
  const string = () => {
    token.lastIndex = at;
    const match = token.exec(raw);
    if (!match) throw new AccountProxyError(400);
    at = token.lastIndex;
    return JSON.parse(match[0]) as string;
  };
  whitespace();
  if (raw[at++] !== '{') throw new AccountProxyError(400);
  whitespace();
  if (raw[at] !== '}')
    while (true) {
      const key = string();
      if (keys.has(key)) throw new AccountProxyError(400);
      keys.add(key);
      whitespace();
      if (raw[at++] !== ':') throw new AccountProxyError(400);
      whitespace();
      string();
      whitespace();
      if (raw[at] !== ',') break;
      at++;
      whitespace();
    }
  if (raw[at++] !== '}') throw new AccountProxyError(400);
  whitespace();
  if (at !== raw.length) throw new AccountProxyError(400);
  return JSON.parse(raw);
}

function refreshDeletion(cookie: string, https: boolean) {
  const parts = cookie.split(';').map((part) => part.trim());
  if (!/^(?:__Host-)?sayman_refresh=$/.test(parts[0])) return false;
  const seen = new Set<string>();
  for (const part of parts.slice(1)) {
    const at = part.indexOf('='),
      name = (at < 0 ? part : part.slice(0, at)).toLowerCase(),
      value = at < 0 ? '' : part.slice(at + 1);
    if (seen.has(name)) return false;
    seen.add(name);
    if (name === 'max-age') {
      if (value !== '0') return false;
    } else if (name === 'path') {
      if (!['/', '/api/auth'].includes(value)) return false;
    } else if (name === 'expires') {
      if (!Number.isFinite(Date.parse(value))) return false;
    } else if (name === 'samesite') {
      if (value.toLowerCase() !== 'strict') return false;
    } else if (!['httponly', 'secure'].includes(name) || at >= 0) return false;
  }
  return safeRefreshCookie(cookie, https) !== undefined;
}
async function read(stream: ReadableStream<Uint8Array> | null, maximum: number, status: number) {
  const reader = stream?.getReader(),
    parts: Uint8Array[] = [];
  let size = 0;
  try {
    if (reader)
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > maximum) {
          await reader.cancel();
          throw new AccountProxyError(status);
        }
        parts.push(part.value);
      }
  } finally {
    reader?.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new AccountProxyError(status === 413 ? 400 : status);
  }
}

export async function proxyCustomerAccount(
  request: Request,
  path: string[],
  environment: OrderProxyEnvironment,
  fetcher: typeof fetch = fetch,
) {
  const url = new URL(request.url),
    full = '/api/account/' + path.join('/');
  if (
    !isCustomerAccountPath(full, request.method) ||
    url.pathname !== full ||
    url.search ||
    url.hash
  )
    return new Response(null, { status: 404, headers });
  const origin = publicOrigin(environment);
  let api: URL;
  try {
    api = new URL(environment.SHOP_API_URL ?? '');
    if (
      environment.SHOP_DATA_MODE !== 'api' ||
      !origin ||
      !['http:', 'https:'].includes(api.protocol) ||
      publicOrigin({ SHOP_PUBLIC_URL: api.origin }) !== api.origin ||
      api.username ||
      api.password ||
      api.search ||
      api.hash ||
      !['', '/'].includes(api.pathname)
    )
      throw Error('Account API unavailable');
  } catch {
    return Response.json({ title: 'account_unavailable' }, { status: 503, headers });
  }
  const supplied = request.headers.get('Origin');
  if (
    request.headers.get('Sec-Fetch-Site') === 'cross-site' ||
    ((request.method !== 'GET' || request.headers.has('Origin')) && supplied !== origin)
  )
    return new Response(null, { status: 403, headers });
  const bearer = request.headers.get('Authorization');
  if (!bearer || !/^Bearer [A-Za-z0-9._-]{20,8185}$/.test(bearer))
    return Response.json({ title: 'invalid_credentials' }, { status: 401, headers });
  try {
    let body: string | undefined;
    if (request.method !== 'GET') {
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? ''))
        throw new AccountProxyError(415);
      if (Number(request.headers.get('Content-Length')) > 4096) throw new AccountProxyError(413);
      const raw = await read(request.body, 4096, 413);
      let value: unknown;
      try {
        value = parseInput(raw);
      } catch {
        throw new AccountProxyError(400);
      }
      const input = (
        request.method === 'PUT' ? updateCustomerProfileSchema : changeCustomerPasswordSchema
      ).safeParse(value);
      if (!input.success) throw new AccountProxyError(400);
      body = JSON.stringify(input.data);
    }
    const upstream = await fetcher(api.origin + full, {
      method: request.method,
      headers: {
        Authorization: bearer,
        Origin: origin!,
        'Content-Type': 'application/json',
        'X-Sayman-Client': 'storefront',
      },
      body,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]),
    });
    const cookies = upstream.headers.getSetCookie();
    if (
      (cookies.length > 0 &&
        !(
          request.method === 'POST' &&
          upstream.status === 204 &&
          cookies.every((cookie) => refreshDeletion(cookie, origin!.startsWith('https:')))
        )) ||
      Number(upstream.headers.get('Content-Length')) > 16384
    ) {
      await upstream.body?.cancel();
      throw new AccountProxyError(503);
    }
    const raw = await read(upstream.body, 16384, 503);
    if (!upstream.ok) {
      let title = 'account_unavailable';
      try {
        const problem = JSON.parse(raw);
        if (typeof problem.title === 'string' && /^[a-z_]{1,100}$/.test(problem.title))
          title = problem.title;
      } catch {
        /* Preserve the status while withholding raw upstream data. */
      }
      return Response.json(
        { title },
        {
          status: [400, 401, 403, 409, 413, 415, 429, 503].includes(upstream.status)
            ? upstream.status
            : 503,
          headers,
        },
      );
    }
    if (request.method === 'POST') {
      if (upstream.status !== 204 || raw) throw new AccountProxyError(503);
      return new Response(null, { status: 204, headers });
    }
    if (
      upstream.status !== 200 ||
      !/^application\/json(?:\s*;|$)/i.test(upstream.headers.get('Content-Type') ?? '')
    )
      throw new AccountProxyError(503);
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new AccountProxyError(503);
    }
    const profile = customerAccountProfileSchema.safeParse(value);
    if (!profile.success) throw new AccountProxyError(503);
    return Response.json(profile.data, { headers });
  } catch (error) {
    const status = error instanceof AccountProxyError ? error.status : 503;
    return Response.json(
      {
        title:
          status === 400
            ? 'invalid_account_input'
            : status === 413
              ? 'account_input_too_large'
              : 'account_unavailable',
      },
      { status, headers },
    );
  }
}
