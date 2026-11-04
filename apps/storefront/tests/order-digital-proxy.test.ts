import test from 'node:test';
import assert from 'node:assert/strict';
import { proxyOrderDigital } from '../lib/orders/order-digital-proxy.ts';

const order = '1'.repeat(32),
  delivery = '2'.repeat(32),
  item = '3'.repeat(32);
const environment = {
  SHOP_DATA_MODE: 'api',
  SHOP_API_URL: 'http://127.0.0.1:5080',
  SHOP_PUBLIC_URL: 'http://127.0.0.1:3000',
};
const path = ['v2', order, 'fulfillment', 'digital'];
const summary = { schemaVersion: 1, orderId: order, deliveries: [] };
const headers = {
  Authorization: 'Bearer ' + 'x'.repeat(30),
  Cookie: 'do-not-forward=1',
  Origin: environment.SHOP_PUBLIC_URL,
};
function request(suffix = '', options: RequestInit = {}) {
  return new Request(
    environment.SHOP_PUBLIC_URL + '/api/orders/v2/' + order + '/fulfillment/digital' + suffix,
    { headers, ...options },
  );
}
function upstream(value: unknown = summary, options: ResponseInit = {}) {
  return Response.json(value, {
    headers: { 'X-Sayman-Fulfillment-Contract': 'digital-v1' },
    ...options,
  });
}

test('digital customer proxy admits only exact private reads without forwarding cookies or caching', async () => {
  let calls = 0;
  const fetcher = (async (url, init) => {
    calls++;
    assert.equal(
      url,
      environment.SHOP_API_URL + '/api/orders/v2/' + order + '/fulfillment/digital',
    );
    assert.equal(new Headers(init?.headers).get('Cookie'), null);
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.redirect, 'error');
    return upstream();
  }) as typeof fetch;
  const result = await proxyOrderDigital(request(), path, environment, fetcher);
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), summary);
  assert.match(result.headers.get('Cache-Control')!, /private, no-store/);
  assert.match(result.headers.get('X-Robots-Tag')!, /noindex/);
  assert.equal(result.headers.get('X-Sayman-Fulfillment-Contract'), 'digital-v1');
  assert.equal(calls, 1);
  for (const [r, p, expected] of [
    [request('', { method: 'POST', body: '{}' }), path, 405],
    [request('?owner=someone'), path, 400],
    [request(), [...path, 'commands', delivery], 404],
    [request(), ['v2', '0'.repeat(32), 'fulfillment', 'digital'], 400],
    [request('', { headers: {} }), path, 401],
    [request('', { headers: { ...headers, Origin: 'https://evil.example' } }), path, 403],
  ] as const) {
    assert.equal((await proxyOrderDigital(r, [...p], environment, fetcher)).status, expected);
  }
  assert.equal(calls, 1);
});

test('digital customer proxy rejects unrelated content, uninstalled contracts, cookies, and oversized responses', async () => {
  for (const response of [
    () => Response.json(summary),
    () => upstream({ ...summary, orderId: delivery }),
    () => upstream(summary, { headers: { 'X-Sayman-Fulfillment-Contract': 'parcels-v1' } }),
    () =>
      upstream(summary, {
        headers: { 'X-Sayman-Fulfillment-Contract': 'digital-v1', 'Set-Cookie': 'forbidden=1' },
      }),
    () => new Response('x'.repeat(16777217)),
    () => Response.json({ title: 'not_found' }, { status: 404 }),
  ]) {
    const result = await proxyOrderDigital(request(), path, environment, (async () =>
      response()) as typeof fetch);
    assert.equal(result.status, 503);
    assert.equal(result.headers.has('Set-Cookie'), false);
  }
  assert.equal(
    (
      await proxyOrderDigital(request(), path, environment, (async () =>
        upstream({ title: 'not_found' }, { status: 404 })) as typeof fetch)
    ).status,
    404,
  );
});

test('digital content is returned only through the explicit bounded owner and delivery route', async () => {
  const content = {
    schemaVersion: 1,
    orderId: order,
    deliveryId: delivery,
    availableAt: '2026-10-30T00:00:00Z',
    items: [
      {
        id: item,
        lineKey: 'digital-line',
        content: '<script>plain text only</script>\nSYNTHETIC-CODE',
      },
    ],
  };
  const result = await proxyOrderDigital(
    request('/' + delivery + '/content'),
    [...path, delivery, 'content'],
    environment,
    (async () => upstream(content)) as typeof fetch,
  );
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), content);
  const wrong = await proxyOrderDigital(
    request('/' + delivery + '/content'),
    [...path, delivery, 'content'],
    environment,
    (async () => upstream({ ...content, deliveryId: order })) as typeof fetch,
  );
  assert.equal(wrong.status, 503);
  const legacy = await proxyOrderDigital(request(), path.slice(1), environment, (async (url) => {
    assert.equal(url, environment.SHOP_API_URL + '/api/orders/' + order + '/fulfillment/digital');
    return upstream();
  }) as typeof fetch);
  assert.equal(legacy.status, 200);
});
