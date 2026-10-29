import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
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
