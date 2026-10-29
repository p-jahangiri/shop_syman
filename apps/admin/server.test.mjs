import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createAdminServer } from './server.mjs';
test('blog publication proxy scopes draft/revision/commands and preserves private JSON limits without cookies', async () => {
  const seen = [];
  let unsafe = false;
  const upstream = http.createServer((req, res) => {
    req.resume();
    seen.push({ path: req.url, cookie: req.headers.cookie ?? null });
    res.writeHead(200, {
      'Content-Type': 'application/json',
      ...(unsafe ? { 'Set-Cookie': 'forbidden=1' } : {}),
    });
    res.end('{}');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = createAdminServer({ apiUrl: `http://127.0.0.1:${upstream.address().port}` });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`,
    base = '/api/admin/blog-posts',
    id = 'a'.repeat(32),
    headers = {
      Authorization: 'Bearer synthetic-only',
      Cookie: 'private=never-forward',
      'Content-Type': 'application/json',
    };
  try {
    assert.equal((await fetch(origin + base)).status, 401);
    for (const tail of [
      '',
      '?cursor=a-b',
      '/' + id,
      '/' + id + '/history?beforePublication=10000',
      '/' + id + '/revisions/' + id,
      '/commands/' + id,
      '/' + id + '/commands/' + id,
    ]) {
      const r = await fetch(origin + base + tail, { headers });
      assert.equal(r.status, 200);
      assert.match(r.headers.get('Cache-Control'), /private, no-store/);
      assert.match(r.headers.get('X-Robots-Tag'), /noindex/);
    }
    for (const tail of ['/commands/' + id, '/' + id + '/commands/' + id])
      assert.equal(
        (await fetch(origin + base + tail, { method: 'POST', headers, body: '{}' })).status,
        200,
      );
    assert.ok(seen.every((r) => r.cookie === null));
    const count = seen.length;
    for (const tail of [
      '?owner=another',
      '?cursor=UPPER',
      '/' + id + '/history?beforePublication=01',
      '/' + id + '/history?beforePublication=10001',
      '/' + id + '/history?beforePublication=2&beforePublication=3',
    ])
      assert.equal((await fetch(origin + base + tail, { headers })).status, 400);
    assert.equal((await fetch(origin + base, { method: 'POST', headers, body: '{}' })).status, 405);
    assert.equal(
      (
        await fetch(origin + base + '/commands/' + id, {
          method: 'POST',
          headers,
          body: 'x'.repeat(131073),
        })
      ).status,
      413,
    );
    assert.equal(seen.length, count);
    unsafe = true;
    const r = await fetch(origin + base + '/' + id, { headers });
    assert.equal(r.status, 503);
    assert.equal(r.headers.has('Set-Cookie'), false);
  } finally {
    for (const value of [server, upstream]) value.closeAllConnections();
    await Promise.all(
      [server, upstream].map((value) => new Promise((resolve) => value.close(resolve))),
    );
  }
});
test('private reminder schedule proxy admits only exact scoped policy/history/commands without cookies', async () => {
  const seen = [];
  let unsafe = false;
  const upstream = http.createServer((req, res) => {
    req.resume();
    seen.push({ path: req.url, cookie: req.headers.cookie ?? null });
    res.writeHead(200, {
      'Content-Type': 'application/json',
      ...(unsafe ? { 'Set-Cookie': 'forbidden=1' } : {}),
    });
    res.end('{}');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = createAdminServer({ apiUrl: `http://127.0.0.1:${upstream.address().port}` });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`,
    route = '/api/admin/credit/reminder-policy',
    headers = {
      Authorization: 'Bearer synthetic-only',
      Cookie: 'do-not-forward=1',
      'Content-Type': 'application/json',
    },
    id = 'a'.repeat(32);
  try {
    assert.equal((await fetch(origin + route)).status, 401);
    for (const tail of ['', '/history?beforeRevision=10000', '/commands/' + id]) {
      const r = await fetch(origin + route + tail, { headers });
      assert.equal(r.status, 200);
      assert.match(r.headers.get('Cache-Control'), /private, no-store/);
      assert.match(r.headers.get('X-Robots-Tag'), /noindex/);
    }
    assert.equal(
      (await fetch(origin + route + '/commands/' + id, { headers, method: 'POST', body: '{}' }))
        .status,
      200,
    );
    assert.ok(seen.every((r) => r.cookie === null));
    const count = seen.length;
    for (const tail of [
      '?enabled=true',
      '/history?beforeRevision=01',
      '/history?beforeRevision=10001',
      '/history?beforeRevision=2&beforeRevision=3',
    ])
      assert.equal((await fetch(origin + route + tail, { headers })).status, 400);
    assert.equal(
      (await fetch(origin + route, { headers, method: 'POST', body: '{}' })).status,
      405,
    );
    assert.equal(
      (
        await fetch(origin + route + '/commands/' + id, {
          headers,
          method: 'POST',
          body: 'x'.repeat(8193),
        })
      ).status,
      413,
    );
    assert.equal(seen.length, count);
    unsafe = true;
    const r = await fetch(origin + route, { headers });
    assert.equal(r.status, 503);
    assert.equal(r.headers.has('Set-Cookie'), false);
  } finally {
    for (const value of [server, upstream]) value.closeAllConnections();
    await Promise.all(
      [server, upstream].map((value) => new Promise((resolve) => value.close(resolve))),
    );
  }
});
test('private cheque reminder proxy scopes the exact instrument, history cursor and idempotent command', async () => {
  const seen = [];
  const upstream = http.createServer((req, res) => {
    req.resume();
    seen.push({ path: req.url, cookie: req.headers.cookie ?? null, method: req.method });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = createAdminServer({ apiUrl: `http://127.0.0.1:${upstream.address().port}` });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`,
    id = 'b'.repeat(32),
    route = '/api/admin/credit/orders/QA_OWNER/' + id + '/cheques/' + 'c'.repeat(32) + '/reminders',
    headers = {
      Authorization: 'Bearer synthetic-only',
      Cookie: 'do-not-forward=1',
      'Content-Type': 'application/json',
    };
  try {
    assert.equal((await fetch(origin + route)).status, 401);
    for (const path of [route, route + '/history?beforeSequence=3650', route + '/commands/' + id]) {
      const response = await fetch(origin + path, { headers });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('Cache-Control'), /private, no-store/);
      assert.match(response.headers.get('X-Robots-Tag'), /noindex/);
    }
    assert.equal(
      (await fetch(origin + route + '/commands/' + id, { method: 'POST', headers, body: '{}' }))
        .status,
      200,
    );
    assert.ok(seen.every((x) => x.cookie === null));
    const count = seen.length;
    for (const tail of [
      '?owner=another',
      '/history?beforeSequence=03650',
      '/history?beforeSequence=3651',
      '/history?beforeSequence=2&beforeSequence=3',
    ])
      assert.equal((await fetch(origin + route + tail, { headers })).status, 400);
    assert.equal(
      (await fetch(origin + route, { method: 'POST', headers, body: '{}' })).status,
      405,
    );
    assert.equal(
      (
        await fetch(origin + route + '/commands/' + id, {
          method: 'POST',
          headers,
          body: 'x'.repeat(8193),
        })
      ).status,
      413,
    );
    assert.equal(seen.length, count);
  } finally {
    for (const value of [server, upstream]) value.closeAllConnections();
    await Promise.all(
      [server, upstream].map((value) => new Promise((resolve) => value.close(resolve))),
    );
  }
});
test('cheque due report is read only, strictly bounded by dates/state/cursor and excludes cookies', async () => {
  const seen = [];
  let unsafe = false;
  const upstream = http.createServer((req, res) => {
    req.resume();
    seen.push({ path: req.url, cookie: req.headers.cookie ?? null });
    res.writeHead(200, {
      'Content-Type': 'application/json',
      ...(unsafe ? { 'Set-Cookie': 'forbidden=1' } : {}),
    });
    res.end('{}');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = createAdminServer({ apiUrl: `http://127.0.0.1:${upstream.address().port}` });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`,
    route = '/api/admin/credit/cheque-report',
    query = '?from=2024-01-01&through=2024-12-31&state=All',
    headers = { Authorization: 'Bearer synthetic-only', Cookie: 'private-not-upstream=1' };
  try {
    assert.equal((await fetch(base + route + query)).status, 401);
    const response = await fetch(base + route + query + '&cursor=opaque_URL-safe-token', {
      headers,
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('Cache-Control'), /private, no-store/);
    assert.match(response.headers.get('X-Robots-Tag'), /noindex/);
    assert.equal(seen[0].cookie, null);
    for (const state of [
      'Received',
      'Deposited',
      'CollectedReported',
      'BouncedReported',
      'Withdrawn',
      'ReturnedToCustomer',
    ])
      assert.equal(
        (await fetch(base + route + query.replace('state=All', 'state=' + state), { headers }))
          .status,
        200,
      );
    const count = seen.length;
    for (const q of [
      '',
      query + '&state=Received',
      query + '&ownerId=someone',
      query.replace('2024-12-31', '2025-01-01'),
      query.replace('2024-01-01', '2024-02-30'),
      query.replace('state=All', 'state=received'),
      query.replace('&state=All', ''),
      query + '&cursor=raw%2Bbase64%3D',
      query + '&cursor=' + 'A'.repeat(2049),
    ])
      assert.equal((await fetch(base + route + q, { headers })).status, 400, q);
    assert.equal(
      (await fetch(base + route + query, { method: 'POST', headers, body: '{}' })).status,
      405,
    );
    assert.equal(seen.length, count);
    unsafe = true;
    const rejected = await fetch(base + route + query, { headers });
    assert.equal(rejected.status, 503);
    assert.equal(rejected.headers.get('Set-Cookie'), null);
  } finally {
    for (const value of [server, upstream]) value.closeAllConnections();
    await Promise.all(
      [server, upstream].map((value) => new Promise((resolve) => value.close(resolve))),
    );
  }
});
test('versioned credit requirements allow only policy publication and scoped reads with bounded cookie-free JSON', async () => {
  const seen = [];
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      seen.push({
        method: req.method,
        path: req.url,
        cookie: req.headers.cookie ?? null,
        body: Buffer.concat(chunks).toString(),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = createAdminServer({ apiUrl: `http://127.0.0.1:${upstream.address().port}` });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`,
    id = 'b'.repeat(32),
    headers = {
      Authorization: 'Bearer synthetic-qa-access',
      Cookie: 'not-upstream=1',
      'Content-Type': 'application/json',
    },
    path = '/api/admin/credit/requirements/commands/' + id;
  try {
    let response = await fetch(base + path, {
      method: 'POST',
      headers,
      body: JSON.stringify({ version: null, content: { synthetic: true } }),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('Cache-Control'), /private, no-store/);
    assert.match(response.headers.get('X-Robots-Tag'), /noindex/);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].cookie, null);
    assert.equal(seen[0].method, 'POST');
    assert.equal(seen[0].path, path);
    for (const url of [
      '/api/admin/credit/requirements',
      '/api/admin/credit/requirements/history?cursor=YQ%3D%3D',
      '/api/admin/credit/requirements/revisions/' + id,
      '/api/admin/credit/applications/' + id + '/requirements',
    ]) {
      response = await fetch(base + url, { headers });
      assert.equal(response.status, 200, url);
    }
    const count = seen.length;
    response = await fetch(base + path, { method: 'POST', headers, body: 'x'.repeat(49153) });
    assert.equal(response.status, 413);
    response = await fetch(base + '/api/admin/credit/applications/' + id + '/consents/' + id, {
      method: 'POST',
      headers,
      body: '{}',
    });
    assert.equal(response.status, 405);
    response = await fetch(base + '/api/admin/credit/requirements?ownerId=foreign', { headers });
    assert.equal(response.status, 400);
    response = await fetch(
      base + '/api/admin/credit/requirements/history?cursor=YQ%3D%3D&cursor=YQ%3D%3D',
      { headers },
    );
    assert.equal(response.status, 400);
    assert.equal(seen.length, count);
  } finally {
    for (const value of [server, upstream]) value.closeAllConnections();
    await Promise.all(
      [server, upstream].map((value) => new Promise((resolve) => value.close(resolve))),
    );
  }
});
test('private credit gateway requires bearer, excludes cookies, allows only current reads and never indexes failure responses', async () => {
  const seen = [];
  let unsafe = false;
  const upstream = http.createServer((request, response) => {
    request.resume();
    seen.push({
      path: request.url,
      cookie: request.headers.cookie ?? null,
      authorization: request.headers.authorization,
    });
    response.writeHead(200, {
      'Content-Type': 'application/json',
      ...(unsafe ? { 'Set-Cookie': 'forbidden=1' } : {}),
    });
    response.end('{}');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = createAdminServer({ apiUrl: `http://127.0.0.1:${upstream.address().port}` }),
    unconfigured = createAdminServer({ apiUrl: '' });
  server.listen(0, '127.0.0.1');
  unconfigured.listen(0, '127.0.0.1');
  await Promise.all([once(server, 'listening'), once(unconfigured, 'listening')]);
  const base = `http://127.0.0.1:${server.address().port}`,
    path = '/api/admin/credit/applications',
    headers = { Authorization: 'Bearer synthetic-credit-qa', Cookie: 'must-not-forward=1' };
  try {
    let response = await fetch(base + path);
    assert.equal(response.status, 401);
    assert.match(response.headers.get('X-Robots-Tag'), /noindex/);
    response = await fetch(base + path, { headers });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('Cache-Control'), /private, no-store/);
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.deepEqual(seen, [{ path, cookie: null, authorization: headers.Authorization }]);
    assert.equal((await fetch(base + path, { method: 'PUT', headers, body: '{}' })).status, 405);
    assert.equal(
      (await fetch(base + '/api/admin/credit/commands/' + 'a'.repeat(32), { headers })).status,
      404,
    );
    assert.equal(seen.length, 1);
    unsafe = true;
    response = await fetch(base + path, { headers });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.match(response.headers.get('X-Robots-Tag'), /noindex/);
    response = await fetch(`http://127.0.0.1:${unconfigured.address().port}` + path, { headers });
    assert.equal(response.status, 503);
    assert.match(response.headers.get('Cache-Control'), /private, no-store/);
    assert.match(response.headers.get('X-Robots-Tag'), /noindex/);
  } finally {
    for (const value of [server, unconfigured, upstream]) value.closeAllConnections();
    await Promise.all(
      [server, unconfigured, upstream].map(
        (value) => new Promise((resolve) => value.close(resolve)),
      ),
    );
  }
});
test('admin runtime serves SPA safely and proxies only to its configured API', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'sayman-admin-'));
  await writeFile(path.join(directory, 'index.html'), '<h1>Admin test</h1>');
  const upstream = http.createServer((request, response) => {
    response.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie':
        'sayman_admin_refresh=' + 'a'.repeat(64) + '; Max-Age=604800; HttpOnly; SameSite=Strict',
    });
    response.end(JSON.stringify({ path: request.url, client: request.headers['x-sayman-client'] }));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = createAdminServer({
    root: directory,
    apiUrl: `http://127.0.0.1:${upstream.address().port}`,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    let response = await fetch(base + '/catalog');
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Admin test/);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    response = await fetch(base + '/missing.js');
    assert.equal(response.status, 404);
    response = await fetch(base + '/%2e%2e%2foutside.txt');
    assert.equal(response.status, 403);
    response = await fetch(base + '/api/auth/refresh', {
      method: 'POST',
      headers: {
        'X-Sayman-Client': 'admin',
        Origin: 'http://127.0.0.1:3173',
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie'), /HttpOnly/);
    assert.deepEqual(await response.json(), { path: '/api/auth/refresh', client: 'admin' });
    response = await fetch(base + '/api/auth/password', {
      method: 'POST',
      headers: { Origin: 'http://127.0.0.1:3173', 'Content-Type': 'application/json' },
      body: 'x'.repeat(512001),
    });
    assert.equal(response.status, 413);
  } finally {
    server.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([
      new Promise((resolve) => server.close(resolve)),
      new Promise((resolve) => upstream.close(resolve)),
    ]);
    await rm(directory, { recursive: true, force: true });
  }
});
test('only authenticated media uploads receive a larger bounded multipart proxy body', async () => {
  const received = [];
  let release;
  let waiting = 0;
  let bothStarted;
  const started = new Promise((resolve) => {
    bothStarted = resolve;
  });
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const upstream = http.createServer(async (request, response) => {
    let bytes = 0;
    for await (const chunk of request) bytes += chunk.length;
    received.push({
      path: request.url,
      mime: request.headers['content-type'],
      authorization: request.headers.authorization,
      bytes,
    });
    if (bytes === 4) {
      if (++waiting === 2) bothStarted();
      await held;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{}');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = createAdminServer({ apiUrl: `http://127.0.0.1:${upstream.address().port}` });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const headers = {
      Authorization: 'Bearer test-only',
      'Content-Type': 'multipart/form-data; boundary=boundary-test',
    };
    const payload = 'x'.repeat(600000);
    assert.equal(
      (await fetch(base + '/api/admin/media/images', { method: 'POST', headers, body: payload }))
        .status,
      200,
    );
    assert.deepEqual(received[0], {
      path: '/api/admin/media/images',
      mime: headers['Content-Type'],
      authorization: headers.Authorization,
      bytes: 600000,
    });
    assert.equal(
      (await fetch(base + '/api/admin/media/images', { method: 'POST', body: payload })).status,
      401,
    );
    assert.equal(
      (await fetch(base + '/api/admin/products', { method: 'POST', headers, body: payload }))
        .status,
      413,
    );
    assert.equal(
      (
        await fetch(base + '/api/admin/media/images', {
          method: 'POST',
          headers,
          body: 'x'.repeat(8 * 1024 * 1024 + 65537),
        })
      ).status,
      413,
    );
    assert.equal(received.length, 1);
    const first = fetch(base + '/api/admin/media/images', {
      method: 'POST',
      headers: { ...headers, 'X-Sayman-Admin': 'hold' },
      body: 'test',
    });
    const second = fetch(base + '/api/admin/media/images', {
      method: 'POST',
      headers: { ...headers, 'X-Sayman-Admin': 'hold' },
      body: 'test',
    });
    await started;
    const third = await fetch(base + '/api/admin/media/images', {
      method: 'POST',
      headers,
      body: 'test',
    });
    assert.equal(third.status, 429);
    assert.equal(third.headers.get('retry-after'), '2');
    release();
    assert.equal((await first).status, 200);
    assert.equal((await second).status, 200);
  } finally {
    release();
    server.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([
      new Promise((resolve) => server.close(resolve)),
      new Promise((resolve) => upstream.close(resolve)),
    ]);
  }
});
test('slow stock and shipment commits can finish while an ordinary API request retains its shorter timeout', async () => {
  const timers = new Set();
  const upstream = http.createServer((request, response) => {
    request.resume();
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!response.destroyed) {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('{"complete":true}');
      }
    }, 13000);
    timers.add(timer);
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = createAdminServer({ apiUrl: `http://127.0.0.1:${upstream.address().port}` });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const [stock, shipment, ordinary, realtime] = await Promise.all([
      fetch(base + '/api/admin/accounting/holoo/imports/' + 'a'.repeat(32) + '/stock-commands', {
        method: 'POST',
        headers: { Authorization: 'Bearer synthetic-only' },
        body: '{}',
      }),
      fetch(base + '/api/admin/orders/' + 'b'.repeat(32) + '/shipment/commands', {
        method: 'POST',
        headers: { Authorization: 'Bearer synthetic-only' },
        body: '{}',
      }),
      fetch(base + '/api/admin/accounting/holoo/imports/' + 'a'.repeat(32) + '/stock-preview', {
        headers: { Authorization: 'Bearer synthetic-only' },
      }),
      fetch(base + '/api/admin/realtime?id=synthetic-test-connection', {
        headers: { Authorization: 'Bearer synthetic-only' },
      }),
    ]);
    assert.equal(stock.status, 200);
    assert.deepEqual(await stock.json(), { complete: true });
    assert.equal(shipment.status, 200);
    assert.deepEqual(await shipment.json(), { complete: true });
    assert.equal(ordinary.status, 503);
    assert.equal(ordinary.headers.get('cache-control'), 'private, no-store');
    assert.equal(realtime.status, 200);
    assert.equal(realtime.headers.get('cache-control'), 'private, no-store');
  } finally {
    for (const timer of timers) clearTimeout(timer);
    server.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([
      new Promise((resolve) => server.close(resolve)),
      new Promise((resolve) => upstream.close(resolve)),
    ]);
  }
});
test('only the private realtime connection can use DELETE; its cookies never reach upstream or return to the browser', async () => {
  const seen = [];
  let maliciousCookie = false;
  const authorization = { Authorization: 'Bearer synthetic-private-test' };
  const upstream = http.createServer(async (request, response) => {
    const parts = [];
    for await (const part of request) parts.push(part);
    seen.push({
      method: request.method,
      path: request.url,
      cookie: request.headers.cookie ?? null,
      authorization: request.headers.authorization,
      bytes: Buffer.concat(parts).length,
    });
    response.writeHead(200, {
      'Content-Type': 'text/plain',
      ...(maliciousCookie ? { 'Set-Cookie': 'must-not-return=1' } : {}),
    });
    response.end('');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = createAdminServer({ apiUrl: `http://127.0.0.1:${upstream.address().port}` });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(base + '/api/admin/realtime?id=synthetic-test-connection', {
      method: 'DELETE',
      headers: { Cookie: 'private=never-forward', Authorization: 'Bearer synthetic-private-test' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.match(response.headers.get('x-robots-tag'), /noindex/);
    assert.deepEqual(seen, [
      {
        method: 'DELETE',
        path: '/api/admin/realtime?id=synthetic-test-connection',
        cookie: null,
        authorization: 'Bearer synthetic-private-test',
        bytes: 0,
      },
    ]);
    assert.equal(
      (await fetch(base + '/api/admin/products', { method: 'DELETE', headers: authorization }))
        .status,
      405,
    );
    assert.equal(
      (
        await fetch(base + '/api/admin/realtime/negotiate', {
          method: 'DELETE',
          headers: authorization,
        })
      ).status,
      405,
    );
    assert.equal(
      (
        await fetch(base + '/api/admin/realtime?id=synthetic-test-connection', {
          method: 'POST',
          headers: authorization,
          body: 'x'.repeat(4097),
        })
      ).status,
      413,
    );
    assert.equal(seen.length, 1);
    maliciousCookie = true;
    const unsafe = await fetch(base + '/api/admin/realtime?id=synthetic-test-connection', {
      method: 'DELETE',
      headers: authorization,
    });
    assert.equal(unsafe.status, 503);
    assert.equal(unsafe.headers.get('set-cookie'), null);
    assert.equal(seen.length, 2);
  } finally {
    server.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([
      new Promise((resolve) => server.close(resolve)),
      new Promise((resolve) => upstream.close(resolve)),
    ]);
  }
});
test('private file uploads have their own bounded authenticated gateway and downloads preserve only safe attachment headers', async () => {
  const id = 'a'.repeat(32),
    file = 'b'.repeat(32),
    seen = [],
    pdf = Buffer.from('%PDF-1.7\nSynthetic proxy file QA.\n%%EOF\n');
  const upstream = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    seen.push({
      path: request.url,
      cookie: request.headers.cookie ?? null,
      bytes: Buffer.concat(chunks).length,
      mime: request.headers['content-type'],
    });
    if (request.method === 'GET' && request.url.endsWith('/attachments/' + file)) {
      response.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Length': pdf.length,
        'Content-Disposition': 'attachment; filename="synthetic.pdf"',
        'X-Sayman-Private-File': file,
      });
      response.end(pdf);
    } else {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{"synthetic":true}');
    }
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = createAdminServer({ apiUrl: `http://127.0.0.1:${upstream.address().port}` });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`,
    path = '/api/admin/support/tickets/' + id + '/attachments/' + file;
  try {
    const headers = {
      Authorization: 'Bearer synthetic-test',
      Cookie: 'never-forward',
      'Content-Type': 'multipart/form-data; boundary=synthetic',
    };
    const uploaded = await fetch(base + path, {
      method: 'POST',
      headers,
      body: 'x'.repeat(600000),
    });
    assert.equal(uploaded.status, 200);
    assert.match(uploaded.headers.get('Cache-Control'), /private, no-store/);
    assert.match(uploaded.headers.get('X-Robots-Tag'), /noindex/);
    assert.equal(seen[0].cookie, null);
    assert.equal(seen[0].bytes, 600000);
    assert.equal(seen[0].mime, headers['Content-Type']);
    const download = await fetch(base + path, { headers });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('X-Sayman-Private-File'), file);
    assert.match(download.headers.get('Content-Disposition'), /^attachment/);
    assert.match(download.headers.get('Content-Security-Policy'), /sandbox/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdf);
    assert.equal(seen[1].cookie, null);
    assert.equal((await fetch(base + path, { method: 'POST', body: 'x' })).status, 401);
    assert.equal(
      (
        await fetch(base + path, {
          method: 'POST',
          headers,
          body: 'x'.repeat(8 * 1024 * 1024 + 65537),
        })
      ).status,
      413,
    );
    assert.equal(
      (
        await fetch(base + '/api/admin/products', {
          method: 'POST',
          headers,
          body: 'x'.repeat(600000),
        })
      ).status,
      413,
    );
    assert.equal(seen.length, 2);
  } finally {
    server.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([
      new Promise((resolve) => server.close(resolve)),
      new Promise((resolve) => upstream.close(resolve)),
    ]);
  }
});
test('private file gateway refuses download substitution and upstream cookies even on capability responses', async () => {
  const id = 'a'.repeat(32),
    file = 'b'.repeat(32);
  const upstream = http.createServer((request, response) => {
    request.resume();
    if (request.url.endsWith('/capabilities')) {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'forbidden=1' });
      response.end('{}');
    } else {
      response.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Length': '16',
        'Content-Disposition': 'attachment; filename="synthetic.pdf"',
        'X-Sayman-Private-File': id,
      });
      response.end('synthetic-wrong-id');
    }
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = createAdminServer({ apiUrl: `http://127.0.0.1:${upstream.address().port}` });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of [
      '/api/admin/support/files/capabilities',
      `/api/admin/support/tickets/${id}/attachments/${file}`,
    ]) {
      const response = await fetch(base + path, {
        headers: { Authorization: 'Bearer synthetic-test' },
      });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('Set-Cookie'), null);
      assert.match(response.headers.get('Cache-Control'), /private, no-store/);
      assert.match(response.headers.get('X-Robots-Tag'), /noindex/);
    }
  } finally {
    server.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([
      new Promise((resolve) => server.close(resolve)),
      new Promise((resolve) => upstream.close(resolve)),
    ]);
  }
});
test('private download gateway bounds concurrent unfinished response bodies and releases capacity when they finish', async () => {
  const id = 'a'.repeat(32),
    file = 'b'.repeat(32),
    pdf = Buffer.from('%PDF-1.7\nSynthetic slow gateway response.\n%%EOF\n'),
    waiting = [];
  const upstream = http.createServer((request, response) => {
    request.resume();
    response.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': pdf.length,
      'Content-Disposition': 'attachment; filename="synthetic.pdf"',
      'X-Sayman-Private-File': file,
    });
    response.write(pdf.subarray(0, 10));
    waiting.push(response);
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = createAdminServer({ apiUrl: `http://127.0.0.1:${upstream.address().port}` });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/api/admin/support/tickets/${id}/attachments/${file}`,
    headers = { Authorization: 'Bearer synthetic-test' };
  try {
    const first = await fetch(url, { headers }),
      second = await fetch(url, { headers });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal((await fetch(url, { headers })).status, 429);
    assert.equal(waiting.length, 2);
    for (const response of waiting) response.end(pdf.subarray(10));
    assert.deepEqual(Buffer.from(await first.arrayBuffer()), pdf);
    assert.deepEqual(Buffer.from(await second.arrayBuffer()), pdf);
    const recovered = await fetch(url, { headers });
    assert.equal(recovered.status, 200);
    waiting.at(-1).end(pdf.subarray(10));
    assert.deepEqual(Buffer.from(await recovered.arrayBuffer()), pdf);
  } finally {
    server.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([
      new Promise((resolve) => server.close(resolve)),
      new Promise((resolve) => upstream.close(resolve)),
    ]);
  }
});
test('credit document gateway permits only scoped reviewer reads and streams private files without JSON truncation or cookies', async () => {
  const app = 'a'.repeat(32),
    file = 'b'.repeat(32),
    seen = [],
    pdf = Buffer.concat([
      Buffer.from('%PDF-1.7\nSynthetic credit proxy.\n'),
      Buffer.alloc(270000, 32),
      Buffer.from('\n%%EOF\n'),
    ]);
  let substitute = false,
    cookie = false;
  const upstream = http.createServer((request, response) => {
    request.resume();
    seen.push({ path: request.url, cookie: request.headers.cookie ?? null });
    if (request.url.endsWith('/files/' + file)) {
      response.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Length': pdf.length,
        'Content-Disposition': 'attachment; filename="synthetic.pdf"',
        'X-Sayman-Private-File': substitute ? app : file,
        ...(cookie ? { 'Set-Cookie': 'forbidden=1' } : {}),
      });
      response.end(pdf);
    } else {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{"synthetic":true}');
    }
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = createAdminServer({ apiUrl: `http://127.0.0.1:${upstream.address().port}` });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`,
    base = '/api/admin/credit/applications/' + app + '/documents',
    headers = { Authorization: 'Bearer synthetic-test', Cookie: 'never-forward=1' };
  try {
    const page = await fetch(origin + base, { headers });
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('Cache-Control'), 'private, no-store');
    const response = await fetch(origin + base + '/files/' + file, { headers });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('Content-Security-Policy'), /sandbox/);
    assert.match(response.headers.get('X-Robots-Tag'), /noindex/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
    assert.ok(seen.every((x) => x.cookie === null));
    const count = seen.length;
    assert.equal(
      (
        await fetch(origin + base + '/files/' + file, {
          headers: { ...headers, Range: 'bytes=0-10' },
        })
      ).status,
      400,
    );
    assert.equal((await fetch(origin + base + '?owner=forged', { headers })).status, 400);
    assert.equal(
      (await fetch(origin + base + '/commands/' + file, { method: 'POST', headers, body: '{}' }))
        .status,
      405,
    );
    assert.equal((await fetch(origin + base + '/commands/' + file, { headers })).status, 404);
    assert.equal(seen.length, count);
    substitute = true;
    assert.equal((await fetch(origin + base + '/files/' + file, { headers })).status, 503);
    substitute = false;
    cookie = true;
    const denied = await fetch(origin + base + '/files/' + file, { headers });
    assert.equal(denied.status, 503);
    assert.equal(denied.headers.get('Set-Cookie'), null);
  } finally {
    server.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([
      new Promise((resolve) => server.close(resolve)),
      new Promise((resolve) => upstream.close(resolve)),
    ]);
  }
});

test('submission gateway allows only reviewer reads and Submitted queue, rejecting impersonation and receipt commands', async () => {
  const seen = [],
    id = 'a'.repeat(32),
    sub = 'b'.repeat(32),
    upstream = http.createServer((req, res) => {
      seen.push({ path: req.url, cookie: req.headers.cookie ?? null });
      req.resume();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = createAdminServer({ apiUrl: `http://127.0.0.1:${upstream.address().port}` });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`,
    path = '/api/admin/credit/applications/' + id,
    headers = { Authorization: 'Bearer synthetic-submission-qa', Cookie: 'must-not-forward=1' };
  try {
    for (const suffix of ['/submission', '/submissions', '/submissions/' + sub])
      assert.equal((await fetch(origin + path + suffix, { headers })).status, 200);
    assert.equal(
      (await fetch(origin + '/api/admin/credit/applications?state=Submitted', { headers })).status,
      200,
    );
    const count = seen.length;
    assert.equal(
      (await fetch(origin + path + '/submissions/commands/' + sub, { headers })).status,
      404,
    );
    assert.equal(
      (
        await fetch(origin + path + '/submissions/commands/' + sub, {
          method: 'POST',
          headers,
          body: '{}',
        })
      ).status,
      405,
    );
    assert.equal(
      (await fetch(origin + path + '/submission?ownerId=forged', { headers })).status,
      400,
    );
    assert.equal(seen.length, count);
    assert.ok(seen.every((x) => x.cookie === null));
  } finally {
    server.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([new Promise((r) => server.close(r)), new Promise((r) => upstream.close(r))]);
  }
});

test('human review gateway permits scoped staff commands at 8KiB and preserves bounded private history without cookie forwarding', async () => {
  const seen = [],
    id = 'a'.repeat(32),
    cmd = 'b'.repeat(32),
    upstream = http.createServer((req, res) => {
      const parts = [];
      req.on('data', (p) => parts.push(p));
      req.on('end', () => {
        seen.push({
          method: req.method,
          path: req.url,
          cookie: req.headers.cookie ?? null,
          bytes: Buffer.concat(parts).length,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
    });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = createAdminServer({ apiUrl: `http://127.0.0.1:${upstream.address().port}` });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`,
    base = '/api/admin/credit/applications/' + id,
    headers = {
      Authorization: 'Bearer synthetic-review-qa',
      Cookie: 'must-not-forward=1',
      'Content-Type': 'application/json',
    };
  try {
    for (const suffix of ['/review', '/reviews', '/reviews/' + cmd, '/reviews/commands/' + cmd])
      assert.equal((await fetch(origin + base + suffix, { headers })).status, 200);
    assert.equal(
      (
        await fetch(origin + base + '/reviews/commands/' + cmd, {
          method: 'POST',
          headers,
          body: '{}',
        })
      ).status,
      200,
    );
    const count = seen.length;
    assert.equal(
      (
        await fetch(origin + base + '/reviews/commands/' + cmd, {
          method: 'POST',
          headers,
          body: 'x'.repeat(8193),
        })
      ).status,
      413,
    );
    assert.equal((await fetch(origin + base + '/reviews?owner=forged', { headers })).status, 400);
    assert.equal(
      (await fetch(origin + base + '/reviews/' + cmd, { method: 'PUT', headers, body: '{}' }))
        .status,
      405,
    );
    assert.equal(seen.length, count);
    assert.ok(seen.every((x) => x.cookie === null));
  } finally {
    server.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([new Promise((r) => server.close(r)), new Promise((r) => upstream.close(r))]);
  }
});

test('purchase scope gateway bounds grant and revoke commands and excludes queries cookies and unsupported writes', async () => {
  const seen = [],
    id = 'a'.repeat(32),
    cmd = 'b'.repeat(32),
    upstream = http.createServer((req, res) => {
      const parts = [];
      req.on('data', (p) => parts.push(p));
      req.on('end', () => {
        seen.push({
          method: req.method,
          path: req.url,
          cookie: req.headers.cookie ?? null,
          bytes: Buffer.concat(parts).length,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
    });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = createAdminServer({ apiUrl: `http://127.0.0.1:${upstream.address().port}` });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`,
    base = '/api/admin/credit/applications/' + id + '/purchase-scope',
    headers = {
      Authorization: 'Bearer synthetic-scope-qa',
      Cookie: 'must-not-forward=1',
      'Content-Type': 'application/json',
    };
  try {
    for (const suffix of ['', '/commands/' + cmd])
      assert.equal((await fetch(origin + base + suffix, { headers })).status, 200);
    for (const kind of ['grant', 'revoke'])
      assert.equal(
        (
          await fetch(origin + base + '/' + kind + '/' + cmd, {
            method: 'POST',
            headers,
            body: '{}',
          })
        ).status,
        200,
      );
    const count = seen.length;
    assert.equal(
      (
        await fetch(origin + base + '/grant/' + cmd, {
          method: 'POST',
          headers,
          body: 'x'.repeat(8193),
        })
      ).status,
      413,
    );
    assert.equal((await fetch(origin + base + '?owner=forged', { headers })).status, 400);
    assert.equal(
      (await fetch(origin + base + '/grant/' + cmd, { method: 'GET', headers })).status,
      404,
    );
    assert.equal(
      (await fetch(origin + base + '/revoke/' + cmd, { method: 'PUT', headers, body: '{}' }))
        .status,
      405,
    );
    assert.equal(seen.length, count);
    assert.ok(seen.every((x) => x.cookie === null));
  } finally {
    server.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([new Promise((r) => server.close(r)), new Promise((r) => upstream.close(r))]);
  }
});

test('cheque order information permits only bounded scoped staff reads without cookies or query authority', async () => {
  const seen = [],
    id = 'b'.repeat(32),
    path = '/api/admin/credit-orders/qa_owner/' + id;
  let mode = 'normal';
  const upstream = http.createServer((req, res) => {
    req.resume();
    seen.push({
      path: req.url,
      cookie: req.headers.cookie ?? null,
      authorization: req.headers.authorization,
    });
    const raw = JSON.stringify({
      synthetic: true,
      padding: 'x'.repeat(mode === 'large' ? 1048576 : 300000),
    });
    res.writeHead(200, {
      'Content-Type': mode === 'html' ? 'text/html' : 'application/json',
      'Content-Length': Buffer.byteLength(raw),
      ...(mode === 'cookie' ? { 'Set-Cookie': 'forbidden=1' } : {}),
    });
    res.end(raw);
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = createAdminServer({ apiUrl: `http://127.0.0.1:${upstream.address().port}` });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`,
    headers = { Authorization: 'Bearer synthetic-order-qa', Cookie: 'must-not-forward=1' };
  try {
    assert.equal((await fetch(origin + path)).status, 401);
    const good = await fetch(origin + path, { headers });
    assert.equal(good.status, 200);
    assert.equal((await good.json()).synthetic, true);
    assert.equal(good.headers.get('cache-control'), 'private, no-store');
    assert.match(good.headers.get('x-robots-tag'), /noindex/);
    assert.deepEqual(seen, [{ path, cookie: null, authorization: headers.Authorization }]);
    const count = seen.length;
    for (const bad of [
      path + '?owner=foreign',
      '/api/admin/credit-orders/qa_owner/' + '0'.repeat(32),
      '/api/admin/credit-orders/qa_owner/' + id + '/extra',
    ])
      assert.ok([400, 404].includes((await fetch(origin + bad, { headers })).status));
    assert.equal((await fetch(origin + path, { method: 'POST', headers, body: '{}' })).status, 405);
    assert.equal(seen.length, count);
    for (const unsafe of ['cookie', 'large', 'html']) {
      mode = unsafe;
      const response = await fetch(origin + path, { headers });
      assert.equal(response.status, 503, unsafe);
      assert.equal(response.headers.get('set-cookie'), null);
      assert.match(response.headers.get('cache-control'), /private, no-store/);
      await response.text();
    }
  } finally {
    server.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([new Promise((r) => server.close(r)), new Promise((r) => upstream.close(r))]);
  }
});

test('financial cheque schedules permit only scoped planning reads and commands with canonical history and bounded cookie-free JSON', async () => {
  const id = 'a'.repeat(32),
    cmd = 'b'.repeat(32),
    base = '/api/admin/credit/orders/qa_owner/' + id + '/schedule',
    seen = [];
  let unsafe = false;
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (x) => chunks.push(x));
    req.on('end', () => {
      seen.push({
        path: req.url,
        method: req.method,
        cookie: req.headers.cookie ?? null,
        bytes: Buffer.concat(chunks).length,
      });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(unsafe ? { 'Set-Cookie': 'forbidden=1' } : {}),
      });
      res.end('{}');
    });
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = createAdminServer({ apiUrl: `http://127.0.0.1:${upstream.address().port}` });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`,
    headers = {
      Authorization: 'Bearer synthetic-schedule-qa',
      Cookie: 'never-forward=1',
      'Content-Type': 'application/json',
    };
  try {
    for (const path of [
      '/api/admin/credit/orders',
      '/api/admin/credit/orders?cursor=YQ%3D%3D',
      base,
      base + '/history?beforeRevision=20',
      base + '/commands/' + cmd,
    ]) {
      const r = await fetch(origin + path, { headers });
      assert.equal(r.status, 200, path);
      assert.equal(r.headers.get('cache-control'), 'private, no-store');
      assert.match(r.headers.get('x-robots-tag'), /noindex/);
      await r.text();
    }
    for (const path of [base + '/preview', base + '/commands/' + cmd]) {
      const r = await fetch(origin + path, { method: 'POST', headers, body: '{}' });
      assert.equal(r.status, 200);
      await r.text();
    }
    const count = seen.length;
    for (const path of [
      base + '?owner=forged',
      base + '/history?beforeRevision=01',
      base + '/history?beforeRevision=2147483648',
      base + '/history?beforeRevision=1&beforeRevision=2',
      '/api/admin/credit/orders?state=Paid',
    ])
      assert.equal((await fetch(origin + path, { headers })).status, 400, path);
    assert.equal((await fetch(origin + base + '/preview', { headers })).status, 404);
    assert.equal((await fetch(origin + base, { method: 'PUT', headers, body: '{}' })).status, 405);
    assert.equal(
      (
        await fetch(origin + base + '/commands/' + cmd, {
          method: 'POST',
          headers,
          body: 'x'.repeat(8193),
        })
      ).status,
      413,
    );
    assert.equal(seen.length, count);
    assert.ok(seen.every((x) => x.cookie === null));
    unsafe = true;
    const unsafeResponse = await fetch(origin + base, { headers });
    assert.equal(unsafeResponse.status, 503);
    assert.equal(unsafeResponse.headers.get('set-cookie'), null);
  } finally {
    server.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([new Promise((r) => server.close(r)), new Promise((r) => upstream.close(r))]);
  }
});

test('cheque custody routes are scoped, bounded and private, with canonical event history queries', async () => {
  const id = 'a'.repeat(32),
    cmd = 'b'.repeat(32),
    cheque = 'c'.repeat(32),
    base = '/api/admin/credit/orders/qa_owner/' + id + '/cheques',
    seen = [];
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (b) => chunks.push(b));
    req.on('end', () => {
      seen.push({ method: req.method, path: req.url, cookie: req.headers.cookie ?? null });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = createAdminServer({ apiUrl: `http://127.0.0.1:${upstream.address().port}` });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`,
    headers = {
      Authorization: 'Bearer synthetic-cheque-qa',
      Cookie: 'never-forward=1',
      'Content-Type': 'application/json',
    };
  try {
    for (const path of [
      base,
      base + '/' + cheque,
      base + '/' + cheque + '/history',
      base + '/' + cheque + '/history?beforeSequence=20',
      base + '/commands/' + cmd,
    ]) {
      const r = await fetch(origin + path, { headers });
      assert.equal(r.status, 200, path);
      assert.match(r.headers.get('cache-control'), /no-store/);
      assert.match(r.headers.get('x-robots-tag'), /noindex/);
      await r.text();
    }
    for (const path of [
      base + '/receive/commands/' + cmd,
      base + '/' + cheque + '/commands/' + cmd,
    ])
      assert.equal(
        (await fetch(origin + path, { method: 'POST', headers, body: '{}' })).status,
        200,
      );
    const count = seen.length;
    for (const path of [
      base + '?owner=foreign',
      base + '/' + cheque + '/history?beforeSequence=201',
      base + '/' + cheque + '/history?beforeSequence=01',
      base + '/' + cheque + '/history?beforeSequence=1&beforeSequence=2',
    ])
      assert.equal((await fetch(origin + path, { headers })).status, 400, path);
    assert.equal(
      (
        await fetch(origin + base + '/receive/commands/' + cmd, {
          method: 'POST',
          headers,
          body: 'x'.repeat(8193),
        })
      ).status,
      413,
    );
    assert.equal((await fetch(origin + base, { method: 'PUT', headers, body: '{}' })).status, 405);
    assert.equal((await fetch(origin + base)).status, 401);
    assert.equal(seen.length, count);
    assert.ok(seen.every((x) => x.cookie === null));
  } finally {
    server.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([new Promise((r) => server.close(r)), new Promise((r) => upstream.close(r))]);
  }
});

test('CMS page gateway allows bounded scoped publication commands and private canonical history without cookies', async () => {
  const id = 'a'.repeat(32),
    cmd = 'b'.repeat(32),
    base = '/api/admin/pages',
    seen = [];
  let mode = 'normal';
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (b) => chunks.push(b));
    req.on('end', () => {
      seen.push({ method: req.method, path: req.url, cookie: req.headers.cookie ?? null });
      const payload = mode === 'large' ? 'x'.repeat(262145) : '{}';
      res.writeHead(200, {
        'Content-Type': mode === 'html' ? 'text/html' : 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...(mode === 'cookie' ? { 'Set-Cookie': 'forbidden=1' } : {}),
      });
      res.end(payload);
    });
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = createAdminServer({ apiUrl: `http://127.0.0.1:${upstream.address().port}` });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`,
    headers = {
      Authorization: 'Bearer synthetic-page-qa',
      Cookie: 'never-forward=1',
      'Content-Type': 'application/json',
    };
  try {
    for (const tail of [
      '',
      '?cursor=sample-page',
      '/' + id,
      '/' + id + '/history?beforePublication=20',
      '/' + id + '/revisions/' + cmd,
      '/commands/' + cmd,
      '/' + id + '/commands/' + cmd,
    ]) {
      const r = await fetch(origin + base + tail, { headers });
      assert.equal(r.status, 200, tail);
      assert.match(r.headers.get('cache-control'), /private, no-store/);
      assert.match(r.headers.get('x-robots-tag'), /noindex/);
      await r.text();
    }
    for (const tail of ['/commands/' + cmd, '/' + id + '/commands/' + cmd]) {
      const r = await fetch(origin + base + tail, { method: 'POST', headers, body: '{}' });
      assert.equal(r.status, 200);
      await r.text();
    }
    const count = seen.length;
    for (const tail of [
      '?cursor=UPPER',
      '?cursor=a&cursor=b',
      '/' + id + '?draft=true',
      '/' + id + '/history?beforePublication=01',
      '/' + id + '/history?beforePublication=10001',
    ])
      assert.equal((await fetch(origin + base + tail, { headers })).status, 400, tail);
    assert.equal(
      (await fetch(origin + base + '/' + id, { method: 'POST', headers, body: '{}' })).status,
      405,
    );
    assert.equal(
      (
        await fetch(origin + base + '/commands/' + cmd, {
          method: 'POST',
          headers,
          body: 'x'.repeat(131073),
        })
      ).status,
      413,
    );
    assert.equal((await fetch(origin + base)).status, 401);
    assert.equal(seen.length, count);
    assert.ok(seen.every((x) => x.cookie === null));
    for (const unsafe of ['large', 'html', 'cookie']) {
      mode = unsafe;
      const r = await fetch(origin + base + '/' + id, { headers });
      assert.equal(r.status, 503, unsafe);
      assert.equal(r.headers.get('set-cookie'), null);
      await r.text();
    }
  } finally {
    server.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([new Promise((r) => server.close(r)), new Promise((r) => upstream.close(r))]);
  }
});
test('redirect administration scopes preview commands and seek queries, drops cookies and bounds bodies', async () => {
  const seen = [];
  let unsafe = false;
  const upstream = http.createServer((req, res) => {
    req.resume();
    seen.push({ path: req.url, cookie: req.headers.cookie ?? null });
    res.writeHead(200, {
      'Content-Type': 'application/json',
      ...(unsafe ? { 'Set-Cookie': 'unsafe=1' } : {}),
    });
    res.end('{}');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = createAdminServer({ apiUrl: `http://127.0.0.1:${upstream.address().port}` });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`,
    id = 'a'.repeat(32),
    headers = {
      Authorization: 'Bearer synthetic-redirect-qa',
      Cookie: 'private=1',
      'Content-Type': 'application/json',
    },
    head = '/api/admin/redirects/' + id;
  try {
    assert.equal((await fetch(base + head)).status, 401);
    for (const path of [
      '/api/admin/redirects?cursor=' + encodeURIComponent('/fa/pages/a'),
      head,
      head + '/preview',
      head + '/history?beforePublication=2',
      head + '/revisions/' + id,
      head + '/commands/' + id,
      '/api/admin/redirects/commands/' + id,
    ]) {
      const r = await fetch(base + path, { headers });
      assert.equal(r.status, 200, path);
      assert.match(r.headers.get('Cache-Control'), /private, no-store/);
      assert.match(r.headers.get('X-Robots-Tag'), /noindex/);
    }
    assert.ok(seen.every((x) => x.cookie === null));
    assert.equal(
      (await fetch(base + head + '/commands/' + id, { method: 'POST', headers, body: '{}' }))
        .status,
      200,
    );
    const count = seen.length;
    for (const path of [
      head + '/preview?target=evil',
      head + '/history?beforePublication=01',
      '/api/admin/redirects?cursor=' + encodeURIComponent('/fa/pages/a\n'),
      '/api/admin/redirects?cursor=' + encodeURIComponent('/fa/account'),
    ])
      assert.equal((await fetch(base + path, { headers })).status, 400, path);
    assert.equal(
      (await fetch(base + head + '/preview', { method: 'POST', headers, body: '{}' })).status,
      405,
    );
    assert.equal(
      (
        await fetch(base + head + '/commands/' + id, {
          method: 'POST',
          headers,
          body: 'x'.repeat(16385),
        })
      ).status,
      413,
    );
    assert.equal(seen.length, count);
    unsafe = true;
    const r = await fetch(base + head, { headers });
    assert.equal(r.status, 503);
    assert.equal(r.headers.get('Set-Cookie'), null);
  } finally {
    for (const value of [server, upstream]) value.closeAllConnections();
    await Promise.all(
      [server, upstream].map((value) => new Promise((resolve) => value.close(resolve))),
    );
  }
});
test('upfront confirmations expose only scoped finance reads and commands with strict history queries and no cookies', async () => {
  const seen = [];
  let unsafe = false;
  const upstream = http.createServer((req, res) => {
    req.resume();
    seen.push({ path: req.url, cookie: req.headers.cookie ?? null });
    res.writeHead(200, {
      'Content-Type': 'application/json',
      ...(unsafe ? { 'Set-Cookie': 'unsafe=1' } : {}),
    });
    res.end('{}');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = createAdminServer({ apiUrl: `http://127.0.0.1:${upstream.address().port}` });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`,
    id = 'a'.repeat(32),
    base = '/api/admin/credit/orders/QA_OWNER/' + id + '/upfront',
    headers = {
      Authorization: 'Bearer synthetic-upfront-qa',
      Cookie: 'private=never-forward',
      'Content-Type': 'application/json',
    };
  try {
    assert.equal((await fetch(origin + base)).status, 401);
    for (const path of [
      base,
      base + '/history',
      base + '/history?beforeSequence=20',
      base + '/commands/' + id,
    ]) {
      const r = await fetch(origin + path, { headers });
      assert.equal(r.status, 200);
      assert.match(r.headers.get('Cache-Control'), /private, no-store/);
      assert.match(r.headers.get('X-Robots-Tag'), /noindex/);
    }
    assert.equal(
      (await fetch(origin + base + '/commands/' + id, { method: 'POST', headers, body: '{}' }))
        .status,
      200,
    );
    assert.ok(seen.every((x) => x.cookie === null));
    const count = seen.length;
    for (const query of [
      '?owner=FOREIGN',
      '/history?beforeSequence=01',
      '/history?beforeSequence=201',
      '/history?beforeSequence=1&beforeSequence=2',
    ])
      assert.equal((await fetch(origin + base + query, { headers })).status, 400);
    assert.equal((await fetch(origin + base, { method: 'POST', headers, body: '{}' })).status, 405);
    assert.equal(
      (
        await fetch(origin + base + '/commands/' + id, {
          method: 'POST',
          headers,
          body: 'x'.repeat(8193),
        })
      ).status,
      413,
    );
    assert.equal(seen.length, count);
    unsafe = true;
    const r = await fetch(origin + base, { headers });
    assert.equal(r.status, 503);
    assert.equal(r.headers.get('Set-Cookie'), null);
  } finally {
    for (const value of [server, upstream]) value.closeAllConnections();
    await Promise.all(
      [server, upstream].map((value) => new Promise((resolve) => value.close(resolve))),
    );
  }
});

test('per-cheque manual approvals expose only scoped finance reads and commands with strict history queries and no cookies', async () => {
  const seen = [];
  let unsafe = false;
  const upstream = http.createServer((req, res) => {
    req.resume();
    seen.push({ path: req.url, cookie: req.headers.cookie ?? null });
    res.writeHead(200, {
      'Content-Type': 'application/json',
      ...(unsafe ? { 'Set-Cookie': 'unsafe=1' } : {}),
    });
    res.end('{}');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = createAdminServer({ apiUrl: `http://127.0.0.1:${upstream.address().port}` });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`,
    id = 'a'.repeat(32),
    base = '/api/admin/credit/orders/QA_OWNER/' + id + '/cheque-approvals/' + id,
    headers = {
      Authorization: 'Bearer synthetic-approval-qa',
      Cookie: 'private=never-forward',
      'Content-Type': 'application/json',
    };
  try {
    assert.equal((await fetch(origin + base)).status, 401);
    for (const path of [
      base,
      base + '/history',
      base + '/history?beforeSequence=20',
      base + '/commands/' + id,
    ]) {
      const r = await fetch(origin + path, { headers });
      assert.equal(r.status, 200);
      assert.match(r.headers.get('Cache-Control'), /private, no-store/);
      assert.match(r.headers.get('X-Robots-Tag'), /noindex/);
    }
    assert.equal(
      (await fetch(origin + base + '/commands/' + id, { method: 'POST', headers, body: '{}' }))
        .status,
      200,
    );
    assert.ok(seen.every((x) => x.cookie === null));
    const count = seen.length;
    for (const query of [
      '?owner=FOREIGN',
      '/history?beforeSequence=01',
      '/history?beforeSequence=201',
      '/history?beforeSequence=1&beforeSequence=2',
    ])
      assert.equal((await fetch(origin + base + query, { headers })).status, 400);
    assert.equal((await fetch(origin + base, { method: 'POST', headers, body: '{}' })).status, 405);
    assert.equal(
      (
        await fetch(origin + base + '/commands/' + id, {
          method: 'POST',
          headers,
          body: 'x'.repeat(8193),
        })
      ).status,
      413,
    );
    assert.equal(seen.length, count);
    unsafe = true;
    const r = await fetch(origin + base, { headers });
    assert.equal(r.status, 503);
    assert.equal(r.headers.get('Set-Cookie'), null);
  } finally {
    for (const value of [server, upstream]) value.closeAllConnections();
    await Promise.all(
      [server, upstream].map((value) => new Promise((resolve) => value.close(resolve))),
    );
  }
});

test('review hold policy exposes only scoped finance reads and commands with strict history queries and no cookies', async () => {
  const seen = [];
  let unsafe = false;
  const upstream = http.createServer((req, res) => {
    req.resume();
    seen.push({ path: req.url, cookie: req.headers.cookie ?? null });
    res.writeHead(200, {
      'Content-Type': 'application/json',
      ...(unsafe ? { 'Set-Cookie': 'unsafe=1' } : {}),
    });
    res.end('{}');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = createAdminServer({ apiUrl: `http://127.0.0.1:${upstream.address().port}` });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`,
    id = 'a'.repeat(32),
    base = '/api/admin/credit/review-hold-policy',
    headers = {
      Authorization: 'Bearer synthetic-review-hold-qa',
      Cookie: 'private=never-forward',
      'Content-Type': 'application/json',
    };
  try {
    assert.equal((await fetch(origin + base)).status, 401);
    for (const path of [
      base,
      base + '/history',
      base + '/history?beforeRevision=20',
      base + '/commands/' + id,
    ]) {
      const r = await fetch(origin + path, { headers });
      assert.equal(r.status, 200);
      assert.match(r.headers.get('Cache-Control'), /private, no-store/);
      assert.match(r.headers.get('X-Robots-Tag'), /noindex/);
    }
    assert.equal(
      (await fetch(origin + base + '/commands/' + id, { method: 'POST', headers, body: '{}' }))
        .status,
      200,
    );
    assert.ok(seen.every((x) => x.cookie === null));
    const count = seen.length;
    for (const query of [
      '?owner=FOREIGN',
      '/history?beforeRevision=01',
      '/history?beforeRevision=10001',
      '/history?beforeRevision=1&beforeRevision=2',
    ])
      assert.equal((await fetch(origin + base + query, { headers })).status, 400);
    assert.equal((await fetch(origin + base, { method: 'POST', headers, body: '{}' })).status, 405);
    assert.equal(
      (
        await fetch(origin + base + '/commands/' + id, {
          method: 'POST',
          headers,
          body: 'x'.repeat(8193),
        })
      ).status,
      413,
    );
    assert.equal(seen.length, count);
    unsafe = true;
    const r = await fetch(origin + base, { headers });
    assert.equal(r.status, 503);
    assert.equal(r.headers.get('Set-Cookie'), null);
  } finally {
    for (const value of [server, upstream]) value.closeAllConnections();
    await Promise.all(
      [server, upstream].map((value) => new Promise((resolve) => value.close(resolve))),
    );
  }
});
test('credit financial clearance accepts only exact private command and history boundaries without cookies', async () => {
  const seen = [];
  let unsafe = false;
  const upstream = http.createServer((req, res) => {
    req.resume();
    seen.push({ path: req.url, method: req.method, cookie: req.headers.cookie ?? null });
    res.writeHead(200, {
      'Content-Type': 'application/json',
      ...(unsafe ? { 'Set-Cookie': 'bad=1' } : {}),
    });
    res.end('{}');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = createAdminServer({ apiUrl: `http://127.0.0.1:${upstream.address().port}` });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`,
    base = '/api/admin/credit/orders/QA_OWNER/' + 'a'.repeat(32) + '/clearance',
    cmd = 'b'.repeat(32),
    headers = {
      Authorization: 'Bearer synthetic-clearance-only',
      'Content-Type': 'application/json',
      Cookie: 'not-forwarded=1',
    };
  try {
    for (const path of [base, base + '/history?beforeSequence=200', base + '/commands/' + cmd]) {
      const r = await fetch(origin + path, { headers });
      assert.equal(r.status, 200);
      assert.match(r.headers.get('Cache-Control'), /no-store/);
      assert.match(r.headers.get('X-Robots-Tag'), /noindex/);
    }
    let r = await fetch(origin + base + '/commands/' + cmd, {
      method: 'POST',
      headers,
      body: '{}',
    });
    assert.equal(r.status, 200);
    assert.ok(seen.every((x) => x.cookie === null));
    const count = seen.length;
    for (const path of [
      base + '?owner=other',
      base + '/history?beforeSequence=01',
      base + '/history?beforeSequence=201',
      base + '/history?beforeSequence=1&beforeSequence=2',
    ])
      assert.equal((await fetch(origin + path, { headers })).status, 400);
    assert.equal((await fetch(origin + base, { method: 'POST', headers, body: '{}' })).status, 405);
    assert.equal(
      (await fetch(origin + base + '/commands/' + cmd, { method: 'PUT', headers, body: '{}' }))
        .status,
      405,
    );
    assert.equal(
      (
        await fetch(origin + base + '/commands/' + cmd, {
          method: 'POST',
          headers,
          body: 'x'.repeat(8193),
        })
      ).status,
      413,
    );
    assert.equal(seen.length, count);
    unsafe = true;
    r = await fetch(origin + base, { headers });
    assert.equal(r.status, 503);
    assert.equal(r.headers.get('Set-Cookie'), null);
  } finally {
    for (const s of [server, upstream]) s.closeAllConnections();
    await Promise.all([server, upstream].map((s) => new Promise((resolve) => s.close(resolve))));
  }
});

test('parcel proxy bounds exact owner/order/command routes, requires installed contract and never forwards private cookies', async () => {
  const seen = [];
  let unsafe = false,
    installed = true,
    status = 200;
  const upstream = http.createServer((req, res) => {
    req.resume();
    seen.push({ path: req.url, cookie: req.headers.cookie ?? null });
    res.writeHead(status, {
      'Content-Type': 'application/json',
      ...(installed ? { 'X-Sayman-Fulfillment-Contract': 'parcels-v1' } : {}),
      ...(unsafe ? { 'Set-Cookie': 'forbidden=1' } : {}),
    });
    res.end('{}');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = createAdminServer({ apiUrl: `http://127.0.0.1:${upstream.address().port}` });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`,
    id = 'a'.repeat(32),
    base = '/api/admin/orders/QA_OWNER/' + id + '/fulfillment',
    headers = {
      Authorization: 'Bearer synthetic-parcel-only',
      Cookie: 'private=never-forward',
      'Content-Type': 'application/json',
    };
  try {
    assert.equal((await fetch(origin + base)).status, 401);
    for (const tail of ['', '?after=9007199254740993', '/parcels/' + id, '/commands/' + id]) {
      const r = await fetch(origin + base + tail, { headers });
      assert.equal(r.status, 200);
      assert.match(r.headers.get('Cache-Control'), /private, no-store/);
      assert.match(r.headers.get('X-Robots-Tag'), /noindex/);
      assert.equal(r.headers.get('X-Sayman-Fulfillment-Contract'), 'parcels-v1');
    }
    assert.equal(
      (await fetch(origin + base + '/commands/' + id, { method: 'POST', headers, body: '{}' }))
        .status,
      200,
    );
    assert.ok(seen.every((x) => x.cookie === null));
    const count = seen.length;
    for (const tail of [
      '?owner=other',
      '?after=01',
      '?after=9223372036854775808',
      '?after=1&after=2',
      '/parcels/' + id + '?after=1',
    ])
      assert.equal((await fetch(origin + base + tail, { headers })).status, 400);
    assert.equal((await fetch(origin + base, { method: 'POST', headers, body: '{}' })).status, 405);
    assert.equal(
      (
        await fetch(origin + base + '/commands/' + id, {
          method: 'POST',
          headers,
          body: 'x'.repeat(65537),
        })
      ).status,
      413,
    );
    assert.equal(seen.length, count);
    unsafe = true;
    let r = await fetch(origin + base, { headers });
    assert.equal(r.status, 503);
    assert.equal(r.headers.has('Set-Cookie'), false);
    unsafe = false;
    installed = false;
    r = await fetch(origin + base, { headers });
    assert.equal(r.status, 503);
    status = 404;
    r = await fetch(origin + base, { headers });
    assert.equal(r.status, 503);
    installed = true;
    r = await fetch(origin + base, { headers });
    assert.equal(r.status, 404);
  } finally {
    for (const s of [server, upstream]) s.closeAllConnections();
    await Promise.all([server, upstream].map((s) => new Promise((resolve) => s.close(resolve))));
  }
});

test('staff provisioning and initial-password proxy preserve private boundaries and exact scoped methods', async () => {
  const seen = [];
  let unsafe = false;
  const upstream = http.createServer((req, res) => {
    seen.push({ path: req.url, cookie: req.headers.cookie ?? null });
    req.resume();
    res.writeHead(200, {
      'Content-Type': 'application/json',
      ...(unsafe ? { 'Set-Cookie': 'unexpected=1' } : {}),
    });
    res.end('{}');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = createAdminServer({ apiUrl: `http://127.0.0.1:${upstream.address().port}` });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`,
    base = '/api/admin/staff',
    id = '3bf6bd02-62b3-4f40-9382-a322d0758994',
    headers = {
      Authorization: 'Bearer synthetic-only',
      Cookie: 'private=never-forward',
      Origin: 'http://127.0.0.1:3173',
      'Content-Type': 'application/json',
    };
  try {
    for (const route of [base, base + '/accounts'])
      assert.equal((await fetch(origin + route)).status, 401);
    assert.equal((await fetch(origin + '/api/auth/staff/password')).status, 400);
    for (const [route, method] of [
      [base + '?query=همکار&active=true', 'GET'],
      [base + '/creation-commands/' + id, 'GET'],
      [base + '/one/history?cursor=a-b', 'GET'],
      [base + '/accounts', 'POST'],
      ['/api/auth/staff/password', 'POST'],
    ]) {
      const response = await fetch(origin + route, {
        method,
        headers,
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('Cache-Control'), /private, no-store/);
      assert.match(response.headers.get('X-Robots-Tag'), /noindex/);
    }
    assert.ok(seen.every((request) => request.cookie === null));
    const count = seen.length;
    assert.equal((await fetch(origin + base + '/accounts', { headers })).status, 405);
    assert.equal(
      (await fetch(origin + base + '/creation-commands/' + id + '?owner=other', { headers }))
        .status,
      400,
    );
    assert.equal(
      (await fetch(origin + base + '?active=true&active=false', { headers })).status,
      400,
    );
    assert.equal(
      (
        await fetch(origin + base + '/accounts', {
          headers,
          method: 'POST',
          body: 'x'.repeat(16385),
        })
      ).status,
      413,
    );
    assert.equal(
      (
        await fetch(origin + '/api/auth/staff/password', {
          headers: { ...headers, 'Content-Type': 'text/plain' },
          method: 'POST',
          body: '{}',
        })
      ).status,
      415,
    );
    assert.equal(seen.length, count);
    unsafe = true;
    const response = await fetch(origin + base + '/creation-commands/' + id, { headers });
    assert.equal(response.status, 503);
    assert.equal(response.headers.has('Set-Cookie'), false);
  } finally {
    for (const value of [server, upstream]) value.closeAllConnections();
    await Promise.all(
      [server, upstream].map((value) => new Promise((resolve) => value.close(resolve))),
    );
  }
});

test('customer directory proxy admits only scoped reads and never forwards or returns private cookies', async () => {
  const seen = [];
  let unsafe = false;
  const upstream = http.createServer((request, response) => {
    request.resume();
    seen.push({ path: request.url, cookie: request.headers.cookie ?? null });
    response.writeHead(200, {
      'Content-Type': 'application/json',
      ...(unsafe ? { 'Set-Cookie': 'unexpected=1' } : {}),
    });
    response.end('{}');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = createAdminServer({ apiUrl: `http://127.0.0.1:${upstream.address().port}` });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`,
    base = '/api/admin/customers',
    id = 'a'.repeat(32),
    headers = {
      Authorization: 'Bearer synthetic-only',
      Cookie: 'must-not-forward=1',
      'Content-Type': 'application/json',
    };
  try {
    assert.equal((await fetch(origin + base)).status, 401);
    for (const tail of [
      '',
      '?kind=customer&query=علی',
      '/one',
      '/one/orders?cursor=a-b',
      '/one/orders/' + id,
      '/one/tickets',
      '/one/tickets/' + id + '/messages?cursor=a-b',
    ]) {
      const response = await fetch(origin + base + tail, { headers });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('Cache-Control'), /private, no-store/);
      assert.match(response.headers.get('X-Robots-Tag'), /noindex/);
    }
    assert.ok(seen.every((request) => request.cookie === null));
    const count = seen.length;
    for (const tail of [
      '?owner=other',
      '?kind=all&kind=staff',
      '/one/tickets/' + id + '/messages?owner=other',
      '/one/tickets/' + id + '/unknown',
    ])
      assert.equal((await fetch(origin + base + tail, { headers })).status, 400);
    assert.equal(
      (await fetch(origin + base + '/one', { headers, method: 'POST', body: '{}' })).status,
      405,
    );
    assert.equal(seen.length, count);
    unsafe = true;
    const response = await fetch(origin + base + '/one', { headers });
    assert.equal(response.status, 503);
    assert.equal(response.headers.has('Set-Cookie'), false);
  } finally {
    for (const value of [server, upstream]) value.closeAllConnections();
    await Promise.all(
      [server, upstream].map((value) => new Promise((resolve) => value.close(resolve))),
    );
  }
});
