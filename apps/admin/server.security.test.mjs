import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createAdminServer,
  adminRefreshCookieName,
  readAdminRefreshCookie,
  safeAdminRefreshCookie,
} from './server.mjs';

test('admin review photos are exact, authenticated WebP reads with no cache or cookie reuse', async () => {
  const webp = Buffer.from('RIFF0000WEBPexample');
  const endpoint = `/api/admin/reviews/${'a'.repeat(32)}/photos/${'b'.repeat(32)}`;
  const token = 'Bearer ' + 'test-token-'.repeat(4);
  const seen = [];
  let resultHeaders = {};
  const upstream = http.createServer((req, res) => {
    req.resume();
    seen.push([req.url, req.headers.authorization, req.headers.cookie]);
    res.writeHead(200, {
      'Content-Type': 'image/webp',
      'Content-Length': webp.length,
      ...resultHeaders,
    });
    res.end(webp);
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = createAdminServer({ apiUrl: `http://127.0.0.1:${upstream.address().port}` });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}` + endpoint;
  const headers = { Authorization: token, Cookie: 'sayman_admin_refresh=private' };
  try {
    const anonymous = await fetch(url);
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.headers.get('Cache-Control'), 'private, no-store');
    assert.equal((await fetch(url + '?other=1', { headers })).status, 404);
    assert.equal((await fetch(url + '/extra', { headers })).status, 404);
    assert.equal(seen.length, 0);
    const approved = await fetch(url, { headers });
    assert.equal(approved.status, 200);
    assert.equal(approved.headers.get('Content-Type'), 'image/webp');
    assert.equal(approved.headers.get('Cache-Control'), 'private, no-store');
    assert.deepEqual(Buffer.from(await approved.arrayBuffer()), webp);
    assert.deepEqual(seen, [[endpoint, token, undefined]]);
    for (const malformed of [
      { 'Content-Type': 'text/html' },
      { 'Set-Cookie': 'private=do-not-forward' },
      { 'Content-Length': 2097153 },
    ]) {
      resultHeaders = malformed;
      const result = await fetch(url, { headers });
      assert.equal(result.status, 503);
      assert.equal(result.headers.get('Set-Cookie'), null);
    }
  } finally {
    for (const instance of [server, upstream]) instance.closeAllConnections();
    await Promise.all(
      [server, upstream].map((instance) => new Promise((resolve) => instance.close(resolve))),
    );
  }
});

test('public image proxy admits exact approved WebP reads and never forwards private authority', async () => {
  const bytes = Buffer.from('RIFF\x08\x00\x00\x00WEBPtest');
  const sha = (value) => createHash('sha256').update(value).digest('hex');
  const id = 'a'.repeat(32),
    seen = [];
  let change = {};
  const upstream = http.createServer((req, res) => {
    seen.push({
      path: req.url,
      cookie: req.headers.cookie,
      authorization: req.headers.authorization,
      origin: req.headers.origin,
    });
    req.resume();
    const body = change.body ?? bytes;
    const headers = {
      'Content-Type': 'image/webp',
      'Content-Length': String(body.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: `"${sha(body)}"`,
      'X-Shop-Public-Resource': 'catalog-image-v1',
      ...change.headers,
    };
    for (const key of Object.keys(headers)) if (headers[key] === null) delete headers[key];
    res.writeHead(change.status ?? 200, headers);
    res.end(body);
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = createAdminServer({ apiUrl: `http://127.0.0.1:${upstream.address().port}` });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`,
    route = `/api/media/catalog/${id}/thumb.webp`;
  try {
    for (const name of ['thumb', 'card', 'zoom']) {
      const response = await fetch(base + route.replace('thumb', name), {
        headers: {
          Cookie: 'sayman_admin_refresh=private',
          Authorization: 'Bearer private',
          Origin: 'https://foreign.example',
        },
      });
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
      assert.equal(response.headers.get('ETag'), `"${sha(bytes)}"`);
      assert.equal(response.headers.get('Content-Type'), 'image/webp');
      assert.equal(response.headers.get('X-Shop-Public-Resource'), 'catalog-image-v1');
      assert.equal(response.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
      assert.equal(response.headers.get('Set-Cookie'), null);
      assert.match(response.headers.get('Content-Security-Policy'), /sandbox/);
    }
    assert.ok(
      seen.every(
        (request) =>
          request.cookie === undefined &&
          request.authorization === undefined &&
          request.origin === undefined,
      ),
    );
    assert.equal(seen[0].path, route);
    const count = seen.length;
    for (const invalid of [
      route.replace(id, id.toUpperCase()),
      route.replace(id, '%61' + id.slice(1)),
      route.replace('thumb.webp', 'private.pdf'),
      route.replace(id, 'short'),
      '/api/media/anything',
    ])
      assert.equal((await fetch(base + invalid)).status, 404);
    assert.equal((await fetch(base + route + '?owner=other')).status, 400);
    assert.equal((await fetch(base + route, { headers: { Range: 'bytes=0-5' } })).status, 400);
    for (const method of ['POST', 'HEAD', 'DELETE'])
      assert.equal((await fetch(base + route, { method })).status, 405);
    assert.equal(seen.length, count);
    for (const headers of [
      { 'Content-Type': 'text/html' },
      { 'X-Shop-Public-Resource': null },
      { ETag: 'W/"' + sha(bytes) + '"' },
      { ETag: '"' + '0'.repeat(64) + '"' },
      { 'Set-Cookie': 'private=never-return' },
      { Vary: 'Accept, Cookie' },
      { Vary: 'Authorization' },
      { 'Cache-Control': 'private, no-store' },
      { 'Content-Encoding': 'gzip' },
      { 'Content-Length': null },
      { 'Content-Length': String(8 * 1024 * 1024 + 1) },
      { 'Content-Length': String(bytes.length + 1), Connection: 'close' },
    ]) {
      change = { headers };
      const response = await fetch(base + route);
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('Set-Cookie'), null);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
    }
    change = { body: Buffer.from('HTML1234WEBPtest') };
    assert.equal((await fetch(base + route)).status, 503);
    change = { status: 302 };
    assert.equal((await fetch(base + route, { redirect: 'manual' })).status, 503);
    change = { status: 404 };
    assert.equal((await fetch(base + route)).status, 404);
  } finally {
    for (const instance of [server, upstream]) instance.closeAllConnections();
    await Promise.all(
      [server, upstream].map((instance) => new Promise((resolve) => instance.close(resolve))),
    );
  }
});

test(
  'public image reads keep their concurrency slot until the response ends',
  { timeout: 5000 },
  async () => {
    const bytes = Buffer.from('RIFF\x08\x00\x00\x00WEBPtest');
    let release,
      ready,
      waiting = 0;
    const held = new Promise((resolve) => {
        release = resolve;
      }),
      started = new Promise((resolve) => {
        ready = resolve;
      });
    const upstream = http.createServer(async (req, res) => {
      req.resume();
      if (++waiting === 8) ready();
      await held;
      res.writeHead(200, {
        'Content-Type': 'image/webp',
        'Content-Length': String(bytes.length),
        'Cache-Control': 'public',
        ETag: '"' + createHash('sha256').update(bytes).digest('hex') + '"',
        'X-Shop-Public-Resource': 'catalog-image-v1',
      });
      res.end(bytes);
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    const server = createAdminServer({ apiUrl: `http://127.0.0.1:${upstream.address().port}` });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}/api/media/catalog/${'a'.repeat(32)}/card.webp`;
    try {
      const first = Array.from({ length: 8 }, () => fetch(url));
      await started;
      const busy = await fetch(url);
      assert.equal(busy.status, 429);
      assert.equal(busy.headers.get('Retry-After'), '2');
      release();
      for (const response of await Promise.all(first)) {
        assert.equal(response.status, 200);
        await response.arrayBuffer();
      }
      const next = await fetch(url);
      assert.equal(next.status, 200);
      await next.arrayBuffer();
    } finally {
      release();
      for (const instance of [server, upstream]) instance.closeAllConnections();
      await Promise.all(
        [server, upstream].map((instance) => new Promise((resolve) => instance.close(resolve))),
      );
    }
  },
);

test('auth proxy preserves empty API challenges and problem JSON while malformed bodies fail closed', async () => {
  let current = { status: 401, type: undefined, body: '' };
  const upstream = http.createServer((req, res) => {
    req.resume();
    res.writeHead(current.status, current.type ? { 'Content-Type': current.type } : {});
    res.end(current.body);
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = createAdminServer({ apiUrl: `http://127.0.0.1:${upstream.address().port}` });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const scenario of [
      { status: 401, type: undefined, body: '', expected: 401, title: 'invalid_credentials' },
      { status: 403, type: undefined, body: '', expected: 403, title: 'forbidden' },
      { status: 503, type: undefined, body: '', expected: 503, title: 'unavailable' },
      {
        status: 401,
        type: 'application/problem+json; charset=utf-8',
        body: '{"title":"invalid_credentials"}',
        expected: 401,
        title: 'invalid_credentials',
      },
      { status: 200, type: 'application/json', body: '{}', expected: 200 },
      { status: 200, type: undefined, body: '', expected: 503 },
      {
        status: 401,
        type: 'text/html',
        body: '<html>Private upstream detail</html>',
        expected: 503,
      },
      { status: 401, type: 'application/json', body: Buffer.from([255]), expected: 503 },
      { status: 401, type: 'application/json', body: 'x'.repeat(32769), expected: 503 },
    ]) {
      current = scenario;
      const response = await fetch(base + '/api/auth/me');
      assert.equal(response.status, scenario.expected);
      assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
      assert.equal(response.headers.get('Set-Cookie'), null);
      const value = await response.json();
      if (scenario.title) assert.equal(value.title, scenario.title);
      assert.ok(!JSON.stringify(value).includes('Private upstream detail'));
    }
  } finally {
    for (const instance of [server, upstream]) instance.closeAllConnections();
    await Promise.all(
      [server, upstream].map((instance) => new Promise((resolve) => instance.close(resolve))),
    );
  }
});

test('admin cookie parsing is isolated, rejects duplicates and enforces HTTPS host cookies', () => {
  const value = 'b'.repeat(64),
    name = adminRefreshCookieName(true);
  assert.equal(name, '__Host-sayman_admin_refresh');
  assert.equal(
    readAdminRefreshCookie(`sayman_refresh=${'c'.repeat(64)}; ${name}=${value}`, name),
    value,
  );
  assert.throws(() => readAdminRefreshCookie(`${name}=${value}; ${name}=${value}`, name));
  assert.throws(() => readAdminRefreshCookie(`${name}=bad`, name));
  assert.equal(
    safeAdminRefreshCookie(`${name}=${value}; Secure; Max-Age=300`, true),
    `${name}=${value}; Path=/; Max-Age=300; HttpOnly; SameSite=Strict; Secure`,
  );
  for (const raw of [
    `${name}=${value}; Max-Age=300`,
    `${name}=${value}; Secure; Max-Age=604801`,
    `${name}=${value}; Secure; Max-Age=300; Domain=example.test`,
    `__Host-sayman_refresh=${value}; Secure; Max-Age=300`,
  ])
    assert.equal(safeAdminRefreshCookie(raw, true), undefined);
  assert.match(
    safeAdminRefreshCookie('sayman_admin_refresh=; expires=Thu, 01 Jan 1970 00:00:00 GMT', true),
    /Max-Age=0.*Secure/,
  );
});

test('admin proxy blocks CSRF and unrelated routes, isolates cookies and ignores forged client headers', async () => {
  const seen = [];
  let responseCookie;
  let large = false;
  let streaming = false;
  const directory = await mkdtemp(path.join(tmpdir(), 'sayman-security-'));
  for (const file of ['index.html', '.env', 'entry.js.map', 'secret.pem'])
    await writeFile(path.join(directory, file), '<h1>synthetic fixture</h1>');
  const upstream = http.createServer((req, res) => {
    seen.push({
      path: req.url,
      cookie: req.headers.cookie,
      client: req.headers['x-sayman-client'],
      admin: req.headers['x-sayman-admin'],
    });
    req.resume();
    res.writeHead(200, {
      'Content-Type': 'application/json',
      ...(large && !streaming ? { 'Content-Length': '32769' } : {}),
      ...(responseCookie ? { 'Set-Cookie': responseCookie } : {}),
    });
    res.end(large ? 'x'.repeat(32769) : '{}');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = createAdminServer({
    root: directory,
    apiUrl: `http://127.0.0.1:${upstream.address().port}`,
    publicUrl: 'https://admin.example',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Origin: 'https://admin.example', 'Content-Type': 'application/json' };
  const post = (tail, extra = {}) =>
    fetch(base + '/api/auth/' + tail, {
      method: 'POST',
      headers: { ...headers, ...extra },
      body: '{}',
    });
  try {
    assert.equal((await post('refresh', { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await post('refresh', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal(
      (await fetch(base + '/api/auth/refresh', { method: 'POST', body: '{}' })).status,
      403,
    );
    assert.equal((await post('refresh', { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await post('refresh?owner=other')).status, 400);
    assert.equal(
      (await fetch(base + '/api/orders', { headers: { Authorization: 'Bearer synthetic' } }))
        .status,
      404,
    );
    assert.equal((await fetch(base + '/api/admin/products')).status, 401);
    const value = 'a'.repeat(64),
      own = `__Host-sayman_admin_refresh=${value}`;
    assert.equal((await post('refresh', { Cookie: own + '; ' + own })).status, 400);
    assert.equal(seen.length, 0);
    responseCookie = `${own}; Secure; Max-Age=300`;
    const response = await post('password', {
      Cookie: `__Host-sayman_refresh=${'b'.repeat(64)}; cart=private; ${own}`,
      'X-Sayman-Client': 'storefront',
      'X-Sayman-Admin': '0',
    });
    assert.equal(response.status, 200);
    assert.equal(seen[0].cookie, own);
    assert.equal(seen[0].client, 'admin');
    assert.equal(seen[0].admin, '1');
    assert.match(response.headers.get('Set-Cookie'), /Path=\/;.*HttpOnly.*SameSite=Strict.*Secure/);
    assert.equal(response.headers.get('Strict-Transport-Security'), 'max-age=31536000');
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    responseCookie = undefined;
    const privateResponse = await fetch(base + '/api/admin/products', {
      headers: { ...headers, Cookie: own, Authorization: 'Bearer synthetic' },
    });
    assert.equal(privateResponse.status, 200);
    assert.equal(seen.at(-1).cookie, undefined);
    responseCookie = 'unexpected=1';
    assert.equal((await post('refresh')).status, 503);
    responseCookie = undefined;
    large = true;
    assert.equal((await post('refresh')).status, 503);
    streaming = true;
    assert.equal((await post('refresh')).status, 503);
    for (const file of ['.env', 'entry.js.map', 'secret.pem'])
      assert.equal((await fetch(base + '/' + file)).status, 404);
  } finally {
    for (const instance of [server, upstream]) instance.closeAllConnections();
    await Promise.all(
      [server, upstream].map((instance) => new Promise((resolve) => instance.close(resolve))),
    );
    await rm(directory, { recursive: true, force: true });
  }
});
