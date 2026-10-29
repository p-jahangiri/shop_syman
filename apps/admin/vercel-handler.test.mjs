import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createVercelAdminHandler, vercelRequestLimit } from './vercel-handler.mjs';

async function fixture(t, respond = (_request, response) => response.end('{}')) {
  const seen = [];
  const completed = [];
  const upstream = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    seen.push({ url: request.url, headers: request.headers, body: Buffer.concat(chunks) });
    response.setHeader('Content-Type', 'application/json');
    respond(request, response);
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const handler = createVercelAdminHandler({
    apiUrl: `http://127.0.0.1:${upstream.address().port}`,
    publicUrl: 'https://admin.example.test',
  });
  const server = http.createServer((request, response) => {
    Object.defineProperty(request, 'body', {
      get() {
        throw new Error('Parsed Vercel body must never be accessed.');
      },
    });
    handler(request, response).then(() => completed.push(response.writableFinished));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    for (const value of [server, upstream]) value.closeAllConnections();
    await Promise.all(
      [server, upstream].map((value) => new Promise((resolve) => value.close(resolve))),
    );
  });
  return { origin: `http://127.0.0.1:${server.address().port}`, seen, completed };
}

test('Vercel adapter preserves JSON bytes, large rial strings, query and authentication headers', async (t) => {
  const { origin, seen } = await fixture(t);
  const raw = ' { "amountRial": "9223372036854775807", "title": "آزمون" }\n';
  const response = await fetch(origin + '/api/admin/catalog?cursor=a%2Bb&filter=1&filter=2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-only' },
    body: raw,
  });
  assert.equal(response.status, 200);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, '/api/admin/catalog?cursor=a%2Bb&filter=1&filter=2');
  assert.equal(seen[0].headers.authorization, 'Bearer synthetic-only');
  assert.deepEqual(seen[0].body, Buffer.from(raw));
  assert.match(response.headers.get('Cache-Control'), /no-store/);
});

test('Vercel adapter retains scoped route authorization and rejects static fallback paths', async (t) => {
  const { origin, seen } = await fixture(t);
  assert.equal((await fetch(origin + '/api/admin/staff')).status, 401);
  assert.equal((await fetch(origin + '/private-dashboard')).status, 404);
  assert.equal(seen.length, 0);
});

test('Vercel adapter retains BFF origin, cookie and endpoint restrictions', async (t) => {
  const { origin, seen } = await fixture(t);
  const headers = {
    Authorization: 'Bearer synthetic-only',
    Cookie: 'private=must-not-forward',
  };
  assert.equal((await fetch(origin + '/api/internal', { headers })).status, 404);
  assert.equal(
    (
      await fetch(origin + '/api/admin/catalog', {
        headers: { ...headers, Origin: 'https://untrusted.example.test' },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(origin + '/api/admin/catalog', {
        headers: { ...headers, Origin: 'https://admin.example.test' },
      })
    ).status,
    200,
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0].headers.cookie, undefined);
  assert.equal(seen[0].headers.origin, 'https://admin.example.test');
});

test('Vercel adapter retains smaller BFF body limits', async (t) => {
  const { origin, seen } = await fixture(t);
  const response = await fetch(origin + '/api/admin/catalog', {
    method: 'POST',
    headers: { Authorization: 'Bearer synthetic-only' },
    body: 'x'.repeat(512001),
  });
  assert.equal(response.status, 413);
  assert.equal(seen.length, 0);
});

test('Vercel adapter preserves multipart bytes within the platform request ceiling', async (t) => {
  const { origin, seen } = await fixture(t);
  const raw = Buffer.concat([
    Buffer.from(
      '--sample\r\nContent-Disposition: form-data; name="file"; filename="sample.png"\r\n\r\n',
    ),
    Buffer.from([0, 255, 128, 13, 10]),
    Buffer.alloc(600000, 7),
    Buffer.from('\r\n--sample--\r\n'),
  ]);
  const response = await fetch(origin + '/api/admin/media/images', {
    method: 'POST',
    headers: {
      'Content-Type': 'multipart/form-data; boundary=sample',
      Authorization: 'Bearer synthetic-only',
    },
    body: raw,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(seen[0].body, raw);
});

test('Vercel adapter rejects declared and chunked bodies beyond 4 MiB before forwarding', async (t) => {
  const { origin, seen } = await fixture(t);
  const declared = await new Promise((resolve, reject) => {
    const request = http.request(
      origin + '/api/admin/media/images',
      { method: 'POST', headers: { 'Content-Length': String(vercelRequestLimit + 1) } },
      (response) => {
        response.resume();
        response.once('end', () => resolve(response.statusCode));
      },
    );
    request.once('error', reject);
    request.end('x');
  });
  assert.equal(declared, 413);
  const response = await fetch(origin + '/api/admin/media/images', {
    method: 'POST',
    headers: { Authorization: 'Bearer synthetic-only' },
    body: (async function* () {
      for (let index = 0; index < 65; index++) yield Buffer.alloc(65536);
    })(),
    duplex: 'half',
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).title, 'vercel_request_too_large');
  assert.match(response.headers.get('Cache-Control'), /private, no-store/);
  assert.equal(seen.length, 0);
});

test('Vercel handler stays active until the streamed upstream response finishes', async (t) => {
  const { origin, completed } = await fixture(t, (_request, response) => {
    response.write('{"ready":');
    setTimeout(() => response.end('true}'), 25);
  });
  const response = await fetch(origin + '/api/admin/catalog', {
    headers: { Authorization: 'Bearer synthetic-only' },
  });
  assert.equal(await response.text(), '{"ready":true}');
  assert.deepEqual(completed, [true]);
});

test('unconfigured Vercel BFF fails closed without a local or preview upstream', async (t) => {
  const handler = createVercelAdminHandler({
    apiUrl: null,
    publicUrl: 'https://admin.example.test',
  });
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/catalog`, {
    headers: { Authorization: 'Bearer synthetic-only' },
  });
  assert.equal(response.status, 503);
  assert.match(response.headers.get('Cache-Control'), /no-store/);
});
