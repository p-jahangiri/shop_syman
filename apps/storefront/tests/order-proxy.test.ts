import assert from 'node:assert/strict';
import test from 'node:test';
import { proxyOrders } from '../lib/orders/order-proxy.ts';
const origin = 'http://sayman-ui.localhost:3105',
  environment = {
    SHOP_API_URL: 'http://127.0.0.1:5181',
    SHOP_PUBLIC_URL: origin,
    SHOP_DATA_MODE: 'api',
  };
const bearer = 'Bearer ' + 'temporary-contract-token-'.repeat(2),
  id = 'a'.repeat(32),
  quoteId = 'b'.repeat(32);
const input = {
  quoteId,
  requestId: '01234567-89ab-4cde-8012-3456789abcde',
  contactName: 'QA Customer',
  contactPhone: '09123456789',
  delivery: null,
  note: null,
  acknowledgeTemporary: true,
};
const request = (
  method = 'GET',
  path = '/api/orders',
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  new Request(origin + path, {
    method,
    headers: {
      Origin: origin,
      Authorization: bearer,
      'Content-Type': 'application/json',
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const never: typeof fetch = async () => {
  throw new Error('Upstream must not be called.');
};
test('order proxy requires configured API, allowed paths, exact mutation origin and a bearer', async () => {
  assert.equal(
    (await proxyOrders(request(), [], { ...environment, SHOP_DATA_MODE: 'preview' }, never)).status,
    503,
  );
  assert.equal((await proxyOrders(request('DELETE'), [], environment, never)).status, 404);
  assert.equal((await proxyOrders(request(), ['../admin'], environment, never)).status, 404);
  assert.equal(
    (
      await proxyOrders(
        request('POST', '/api/orders', input, { Origin: 'https://untrusted.example' }),
        [],
        environment,
        never,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await proxyOrders(
        request('GET', '/api/orders', undefined, { Authorization: '' }),
        [],
        environment,
        never,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await proxyOrders(
        request('GET', '/api/orders', undefined, { Authorization: 'Basic invalid' }),
        [],
        environment,
        never,
      )
    ).status,
    401,
  );
});
test('order proxy bounds input and rejects forged authority and unsupported query parameters', async () => {
  for (const body of [
    { ...input, ownerId: 'other' },
    { ...input, payableTotalRial: '1' },
    { ...input, acknowledgeTemporary: false },
  ])
    assert.equal(
      (await proxyOrders(request('POST', '/api/orders', body), [], environment, never)).status,
      400,
    );
  assert.equal(
    (
      await proxyOrders(
        request('POST', '/api/orders', { ...input, note: 'x'.repeat(17000) }),
        [],
        environment,
        never,
      )
    ).status,
    413,
  );
  for (const query of ['?ownerId=other', '?cursor=abc&cursor=abc', '?cursor=../admin', '?cursor='])
    assert.equal(
      (await proxyOrders(request('GET', '/api/orders' + query), [], environment, never)).status,
      400,
    );
});
test('order proxy forwards only bearer and explicit storefront headers, never cookies or admin authority', async () => {
  const result = await proxyOrders(
    request('GET', '/api/orders?cursor=abc_-', undefined, {
      Cookie: 'private-cookie=must-not-forward',
      'X-Sayman-Admin': '1',
      'X-Forwarded-For': 'forged',
    }),
    [],
    environment,
    async (url, init) => {
      assert.equal(url, 'http://127.0.0.1:5181/api/orders?cursor=abc_-');
      assert.equal(init?.cache, 'no-store');
      assert.equal(init?.redirect, 'error');
      const h = new Headers(init?.headers);
      assert.equal(h.get('Authorization'), bearer);
      assert.equal(h.get('X-Sayman-Client'), 'storefront');
      assert.equal(h.get('Origin'), origin);
      for (const key of ['Cookie', 'X-Sayman-Admin', 'X-Forwarded-For'])
        assert.equal(h.has(key), false);
      return Response.json(
        { items: [] },
        { headers: { 'Set-Cookie': 'untrusted=1', Location: 'https://untrusted.example' } },
      );
    },
  );
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { items: [], nextCursor: null });
  assert.equal(result.headers.has('Set-Cookie'), false);
  assert.equal(result.headers.has('Location'), false);
  assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
  assert.match(result.headers.get('X-Robots-Tag')!, /noindex/);
});
test('order proxy sanitizes upstream failure bodies and validates successful payloads', async () => {
  const bad = await proxyOrders(request(), [], environment, async () =>
    Response.json(
      { title: 'database_failure', detail: 'private contact and SQL data' },
      { status: 500 },
    ),
  );
  assert.equal(bad.status, 503);
  assert.deepEqual(await bad.json(), { title: 'database_failure' });
  const conflict = await proxyOrders(
    request('POST', '/api/orders', input),
    [],
    environment,
    async () =>
      Response.json({ title: 'quote_changed_conflict', detail: 'private' }, { status: 409 }),
  );
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), { title: 'quote_changed_conflict' });
  for (const response of [
    Response.json({ items: [{ id, payableTotalRial: 1 }] }),
    new Response('not-json'),
    Response.json({ items: [], unexpected: 'private' }),
  ])
    assert.equal((await proxyOrders(request(), [], environment, async () => response)).status, 503);
  const oversized = await proxyOrders(
    request(),
    [],
    environment,
    async () => new Response('x'.repeat(1048577)),
  );
  assert.equal(oversized.status, 503);
});
test('order proxy preserves cancellation version and strips request extras before reaching API', async () => {
  const response = await proxyOrders(
    request('POST', `/api/orders/${id}/cancel`, { version: 'AAAAAAAAAAE=' }),
    [id, 'cancel'],
    environment,
    async (url, init) => {
      assert.equal(url, `http://127.0.0.1:5181/api/orders/${id}/cancel`);
      assert.deepEqual(JSON.parse(String(init?.body)), { version: 'AAAAAAAAAAE=' });
      return Response.json({ title: 'version_conflict' }, { status: 409 });
    },
  );
  assert.equal(response.status, 409);
});
