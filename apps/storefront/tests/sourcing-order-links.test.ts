import assert from 'node:assert/strict';
import test from 'node:test';
import {
  sourcingOrderLinksSchema,
  readSourcingOrderLinks,
  isCustomerSourcingOrdersPath,
} from '../lib/market/sourcing-order-links.ts';
import { proxySourcingRequests } from '../lib/market/sourcing-proxy.ts';
const id = (n: number) => n.toString(16).padStart(32, '0'),
  requestId = id(1);
const sample = () => ({
  schemaVersion: 1,
  requestId,
  items: [
    {
      orderId: id(2),
      taskId: id(3),
      offerId: id(4),
      acceptanceId: id(5),
      createdAt: '2026-10-24T12:00:00Z',
    },
  ],
  nextCursor: null,
});
const environment = {
  SHOP_API_URL: 'https://api.example.test',
  SHOP_PUBLIC_URL: 'https://shop.example.test',
  SHOP_DATA_MODE: 'api',
};
const path = `/api/sourcing/requests/${requestId}/orders`;
function request(suffix = '') {
  return new Request(environment.SHOP_PUBLIC_URL + path + suffix, {
    headers: {
      Authorization: 'Bearer ' + 'a'.repeat(30),
      Origin: environment.SHOP_PUBLIC_URL,
      Cookie: 'private=secret',
    },
  });
}
test('sourcing order links are historical only and may repeat an order for different acceptances', () => {
  const value = sample();
  assert.equal(sourcingOrderLinksSchema.safeParse(value).success, true);
  assert.equal(
    sourcingOrderLinksSchema.safeParse({
      ...value,
      items: [...value.items, { ...value.items[0], acceptanceId: id(6) }],
    }).success,
    true,
  );
  for (const patch of [
    { payableTotalRial: '100' },
    { canPay: true },
    { state: 'Paid' },
    { nextCursor: undefined },
    { items: [...value.items, value.items[0]] },
    { items: value.items.map((i) => ({ ...i, ownerId: 'private' })) },
    { items: value.items.map((i) => ({ ...i, createdAt: '2026-10-24T12:00:00+03:30' })) },
  ])
    assert.equal(sourcingOrderLinksSchema.safeParse({ ...value, ...patch }).success, false);
});
test('historical order link client binds owner request route and bounded pagination, without private fallback', async () => {
  assert.equal(isCustomerSourcingOrdersPath(path + '?cursor=abc_-', 'GET'), true);
  assert.equal(isCustomerSourcingOrdersPath(path + '?cursor=' + 'a'.repeat(350), 'GET'), true);
  assert.equal(
    sourcingOrderLinksSchema.safeParse({ ...sample(), nextCursor: 'a'.repeat(350) }).success,
    true,
  );
  for (const [value, method] of [
    [path, 'POST'],
    [path + '/', 'GET'],
    [path + '?owner=other', 'GET'],
    [path + '?cursor=a&cursor=b', 'GET'],
  ])
    assert.equal(isCustomerSourcingOrdersPath(value, method), false);
  const page = await readSourcingOrderLinks(
    async (value, init) => {
      assert.equal(value, path + '?cursor=abc_-');
      assert.equal(init.method, 'GET');
      return Response.json(sample());
    },
    requestId,
    'abc_-',
  );
  assert.equal(page.requestId, requestId);
  await assert.rejects(
    readSourcingOrderLinks(
      async () => Response.json({ ...sample(), requestId: id(7) }),
      requestId,
      null,
    ),
  );
  await assert.rejects(
    readSourcingOrderLinks(async () => new Response('x'.repeat(65537)), requestId, null),
  );
});
test('historical order links BFF privately forwards exact GET and validates owned route identity', async () => {
  const response = await proxySourcingRequests(
    request('?cursor=abc_-'),
    [requestId, 'orders'],
    environment,
    (async (url, init) => {
      assert.equal(url, environment.SHOP_API_URL + path + '?cursor=abc_-');
      assert.equal(init?.cache, 'no-store');
      assert.equal(init?.credentials, 'omit');
      assert.equal(new Headers(init?.headers).get('Cookie'), null);
      return Response.json(sample(), { headers: { 'Set-Cookie': 'private=secret' } });
    }) as typeof fetch,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.deepEqual(await response.json(), sample());
  assert.equal(
    (
      await proxySourcingRequests(request(), [requestId, 'orders'], environment, (async () =>
        Response.json({ ...sample(), requestId: id(7) })) as typeof fetch)
    ).status,
    503,
  );
  const guest = request();
  guest.headers.delete('Authorization');
  assert.equal(
    (await proxySourcingRequests(guest, [requestId, 'orders'], environment)).status,
    401,
  );
  assert.equal(
    (await proxySourcingRequests(request('?owner=other'), [requestId, 'orders'], environment))
      .status,
    400,
  );
});
