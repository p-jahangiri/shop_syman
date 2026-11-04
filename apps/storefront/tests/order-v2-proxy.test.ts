import assert from 'node:assert/strict';
import test from 'node:test';
import { proxyOrdersV2 } from '../lib/orders/order-v2-proxy.ts';
import { proxyCartV2 } from '../lib/checkout/cart-v2-proxy.ts';
import { isCustomerOrderV2Path } from '../lib/orders/order-v2-path.ts';
import { isCustomerCartV2Path } from '../lib/checkout/cart-v2-path.ts';
import {
  order2Detail,
  order2Input,
  order2Id,
  quote5Snapshot,
} from '@sayman/web-shared/testing/order-v2.test-fixtures.ts';
import { quote4Snapshot } from '@sayman/web-shared/testing/quote-v4.test-fixtures.ts';
import { CustomerSessionStore, type CustomerSession } from '../lib/account/customer-session.ts';
const environment = {
    SHOP_API_URL: 'https://api.example.test',
    SHOP_PUBLIC_URL: 'https://shop.example.test',
    SHOP_DATA_MODE: 'api',
  },
  bearer = 'Bearer ' + 'a'.repeat(30);
const input = {
  cartVersion: 'AAAAAAAAAAE=',
  methodId: 'cash',
  planId: null,
  requestId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
};
function request(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  return new Request(environment.SHOP_PUBLIC_URL + path, {
    method,
    headers: {
      Authorization: bearer,
      Origin: environment.SHOP_PUBLIC_URL,
      'Content-Type': 'application/json',
      Cookie: 'private=secret',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
test('new private path gates are method-aware and reject suffixes, arbitrary queries and unknown locales', () => {
  for (const [path, method] of [
    ['/api/orders/v2', 'GET'],
    ['/api/orders/v2', 'POST'],
    ['/api/orders/v2?cursor=abc_-', 'GET'],
    [`/api/orders/v2/${order2Id}`, 'GET'],
    [`/api/orders/v2/${order2Id}/cancel`, 'POST'],
  ])
    assert.equal(isCustomerOrderV2Path(path, method), true);
  for (const [path, method] of [
    ['/api/orders/v2/', 'GET'],
    ['/api/orders/v2?cursor=abc_-', 'POST'],
    ['/api/orders/v2?owner=other', 'GET'],
    [`/api/orders/v2/${order2Id}/cancel`, 'GET'],
    [`/api/orders/v2/${order2Id}`, 'POST'],
    ['/api/orders/v2/../admin', 'GET'],
  ])
    assert.equal(isCustomerOrderV2Path(path, method), false);
  assert.equal(isCustomerCartV2Path('/api/cart/fa/v2/order-quote', 'POST'), true);
  for (const [path, method] of [
    ['/api/cart/fa/v2/order-quote', 'GET'],
    ['/api/cart/fa/v2/order-quote/', 'POST'],
    ['/api/cart/fr/v2/order-quote', 'POST'],
    ['/api/cart/fa/v2/order-quote?owner=other', 'POST'],
  ])
    assert.equal(isCustomerCartV2Path(path, method), false);
});
test('Quote5 BFF forwards exact four-field input privately and rejects Quote4 without capability conversion', async () => {
  let sends = 0;
  const path = '/api/cart/en/v2/order-quote';
  const fetcher = (async (url, init) => {
    sends++;
    assert.equal(url, environment.SHOP_API_URL + path);
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.credentials, 'omit');
    assert.equal(new Headers(init?.headers).get('Cookie'), null);
    assert.deepEqual(JSON.parse(String(init?.body)), input);
    return Response.json(quote5Snapshot());
  }) as typeof fetch;
  const result = await proxyCartV2(
    request(path, input),
    'en',
    ['order-quote'],
    environment,
    fetcher,
  );
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
  assert.equal((await result.json()).schemaVersion, 5);
  assert.equal(
    (
      await proxyCartV2(request(path, input), 'en', ['order-quote'], environment, (async () =>
        Response.json(quote4Snapshot(true))) as typeof fetch)
    ).status,
    503,
  );
  for (const body of [
    { ...input, unitPriceRial: '1' },
    { ...input, ownerId: 'other' },
    { ...input, requestId: null },
  ])
    assert.equal(
      (await proxyCartV2(request(path, body), 'en', ['order-quote'], environment, fetcher)).status,
      400,
    );
  assert.equal(sends, 1);
});
test('Order2 BFF requires bearer, trusted origin and strict bounded price-free input before forwarding', async () => {
  let sent = 0;
  const fetcher = (async () => {
    sent++;
    return Response.json({ order: order2Detail(), replayed: false }, { status: 201 });
  }) as typeof fetch;
  const guest = request('/api/orders/v2', order2Input());
  guest.headers.delete('Authorization');
  assert.equal((await proxyOrdersV2(guest, [], environment, fetcher)).status, 401);
  const foreign = request('/api/orders/v2', order2Input());
  foreign.headers.set('Origin', 'https://foreign.test');
  assert.equal((await proxyOrdersV2(foreign, [], environment, fetcher)).status, 403);
  for (const body of [
    { ...order2Input(), ownerId: 'other' },
    { ...order2Input(), shippingRial: '0' },
    { ...order2Input(), acknowledgeTemporary: false },
    { ...order2Input(), secret: 'x'.repeat(17000) },
  ])
    assert.ok(
      [400, 413].includes(
        (await proxyOrdersV2(request('/api/orders/v2', body), [], environment, fetcher)).status,
      ),
    );
  assert.equal(sent, 0);
});
test('Order2 BFF binds saved order identity, preserves 201 and strips cookies and cacheability', async () => {
  const response = await proxyOrdersV2(
    request('/api/orders/v2', order2Input()),
    [],
    environment,
    (async (url, init) => {
      assert.equal(url, environment.SHOP_API_URL + '/api/orders/v2');
      assert.deepEqual(JSON.parse(String(init?.body)), order2Input());
      assert.equal(init?.cache, 'no-store');
      assert.equal(init?.credentials, 'omit');
      assert.equal(init?.redirect, 'error');
      assert.equal(new Headers(init?.headers).get('Cookie'), null);
      assert.equal(new Headers(init?.headers).get('Authorization'), bearer);
      return Response.json(
        { order: order2Detail(), replayed: false },
        { status: 201, headers: { 'Set-Cookie': 'private=secret' } },
      );
    }) as typeof fetch,
  );
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('Vary'), 'Cookie, Authorization');
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.equal((await response.json()).order.lines[1].unitPriceRial, '9007199254740993');
  const foreign = order2Detail();
  foreign.summary.id = 'f'.repeat(32);
  assert.equal(
    (
      await proxyOrdersV2(
        request(`/api/orders/v2/${order2Id}`),
        [order2Id],
        environment,
        (async () => Response.json(foreign)) as typeof fetch,
      )
    ).status,
    503,
  );
});
test('Order2 BFF rejects malformed or oversized response, accidental legacy contract and unsafe private problems', async () => {
  for (const response of [
    new Response(new Uint8Array([255]), { headers: { 'Content-Type': 'application/json' } }),
    new Response('x'.repeat(1048577), { headers: { 'Content-Type': 'application/json' } }),
    Response.json({ ...order2Detail(), schemaVersion: 1 }),
    Response.json({ ...order2Detail(), privateUnits: ['secret'] }),
  ])
    assert.equal(
      (
        await proxyOrdersV2(
          request(`/api/orders/v2/${order2Id}`),
          [order2Id],
          environment,
          (async () => response) as typeof fetch,
        )
      ).status,
      503,
    );
  const error = await proxyOrdersV2(
    request(`/api/orders/v2/${order2Id}`),
    [order2Id],
    environment,
    (async () =>
      Response.json(
        { title: 'private <secret>', detail: 'secret' },
        { status: 500 },
      )) as typeof fetch,
  );
  assert.equal(error.status, 503);
  assert.deepEqual(await error.json(), { title: 'order_unavailable' });
});
test('authenticated transport permits exact new routes and rejects delayed private response after account switch', async (t) => {
  let owner = 'first';
  const session = (): CustomerSession => ({
    accessToken: (owner === 'first' ? 'a' : 'b').repeat(30),
    expiresIn: 300,
    requiresMfa: false,
    requiresEnrollment: false,
    user: { id: owner, displayName: 'QA', userName: 'qa' },
  });
  const store = new CustomerSessionStore(
    async () => undefined,
    async () => session(),
    async (run) => run(),
    () => false,
  );
  await store.restore();
  let release: (response: Response) => void = () => {};
  const response = new Promise<Response>((resolve) => {
    release = resolve;
  });
  t.mock.method(globalThis, 'fetch', async (path: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(path, '/api/orders/v2');
    assert.equal(new Headers(init?.headers).get('Authorization'), bearer);
    return response;
  });
  const pending = store.fetch('/api/orders/v2');
  owner = 'second';
  await store.restore(true);
  release(Response.json({ schemaVersion: 2, items: [] }));
  await assert.rejects(pending);
  await assert.rejects(store.fetch('/api/cart/en/v2/order-quote', { method: 'GET' }));
  await assert.rejects(store.fetch(`/api/orders/v2/${order2Id}/cancel`, { method: 'GET' }));
  store.remote('signout');
});
