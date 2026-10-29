import assert from 'node:assert/strict';
import test from 'node:test';
import { proxyOrdersV2 } from './order-v2-proxy.ts';
import { isCustomerOrderV2Path } from './order-v2-path.ts';
import { dispatchedShipment, shipmentOrderId } from './order-shipment.test-fixtures.ts';
const environment = {
    SHOP_API_URL: 'https://api.example.test',
    SHOP_PUBLIC_URL: 'https://shop.example.test',
    SHOP_DATA_MODE: 'api',
  },
  path = '/api/orders/v2/' + shipmentOrderId + '/shipment',
  parts = [shipmentOrderId, 'shipment'],
  bearer = 'Bearer ' + 'a'.repeat(30);
const request = () =>
  new Request(environment.SHOP_PUBLIC_URL + path, {
    headers: {
      Authorization: bearer,
      Origin: environment.SHOP_PUBLIC_URL,
      Cookie: 'secret=cookie',
    },
  });
const body = () => ({
  schemaVersion: 1,
  orderId: shipmentOrderId,
  shipment: dispatchedShipment(),
  manualCarrierReport: true,
});
test('shipment BFF is an exact GET-only authenticated route with no owner query or mutation capability', async () => {
  assert.equal(isCustomerOrderV2Path(path, 'GET'), true);
  for (const [p, m] of [
    [path, 'POST'],
    [path + '?owner=other', 'GET'],
    [path + '/commands', 'POST'],
    [path + '/', 'GET'],
  ])
    assert.equal(isCustomerOrderV2Path(p, m), false);
  let sends = 0;
  const fetcher = (async () => {
    sends++;
    return Response.json(body());
  }) as typeof fetch;
  const guest = request();
  guest.headers.delete('Authorization');
  assert.equal((await proxyOrdersV2(guest, parts, environment, fetcher)).status, 401);
  const foreign = request();
  foreign.headers.set('Origin', 'https://foreign.test');
  assert.equal((await proxyOrdersV2(foreign, parts, environment, fetcher)).status, 403);
  assert.equal(sends, 0);
});
test('shipment BFF forwards bearer without cookies and strips private upstream headers', async () => {
  const response = await proxyOrdersV2(request(), parts, environment, (async (url, init) => {
    assert.equal(url, environment.SHOP_API_URL + path);
    assert.equal(init?.method, 'GET');
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('Authorization'), bearer);
    assert.equal(new Headers(init?.headers).get('Cookie'), null);
    return Response.json(body(), { headers: { 'Set-Cookie': 'secret=upstream' } });
  }) as typeof fetch);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('Vary'), 'Cookie, Authorization');
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.equal((await response.json()).shipment.units.length, 1);
});
test('shipment BFF rejects crossed order, premature identifiers, wrong success status and oversized response', async () => {
  const data = body();
  for (const response of [
    Response.json({ ...data, orderId: 'f'.repeat(32) }),
    Response.json({
      ...data,
      shipment: {
        ...data.shipment,
        state: 'packed',
        dispatchedAt: null,
        carrierNameFa: null,
        carrierNameEn: null,
        trackingNumber: null,
      },
      manualCarrierReport: false,
    }),
    Response.json(data, { status: 201 }),
    new Response('x'.repeat(1048577), { headers: { 'Content-Type': 'application/json' } }),
    Response.json({ ...data, privateStaffReason: 'secret' }),
  ])
    assert.equal(
      (await proxyOrdersV2(request(), parts, environment, (async () => response) as typeof fetch))
        .status,
      503,
    );
});
