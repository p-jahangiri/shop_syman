import assert from 'node:assert/strict';
import test from 'node:test';
import { proxyPayment } from '../lib/orders/payment-proxy.ts';
import { isCustomerPaymentPath } from '../lib/orders/payment-path.ts';
import {
  paymentPage,
  paymentOrderId,
  paymentAttemptId,
  paymentItem,
} from './payment.test-fixtures.ts';
const environment = {
    SHOP_API_URL: 'https://api.example.test',
    SHOP_PUBLIC_URL: 'https://shop.example.test',
    SHOP_DATA_MODE: 'api',
  },
  path = '/api/payments/orders/' + paymentOrderId,
  parts = ['orders', paymentOrderId],
  bearer = 'Bearer ' + 'a'.repeat(30);
const request = () =>
  new Request(environment.SHOP_PUBLIC_URL + path, {
    headers: {
      Authorization: bearer,
      Origin: environment.SHOP_PUBLIC_URL,
      Cookie: 'private=secret',
    },
  });
test('payment transport exposes exact private GET paths and rejects mutation, owner queries and arbitrary suffixes', () => {
  assert.equal(isCustomerPaymentPath(path), true);
  assert.equal(isCustomerPaymentPath(path + '?cursor=abc_-'), true);
  assert.equal(isCustomerPaymentPath('/api/payments/attempts/' + paymentAttemptId), true);
  for (const [p, m] of [
    [path, 'POST'],
    [path + '?owner=other', 'GET'],
    [path + '?cursor=x&cursor=y', 'GET'],
    [path + '/verify', 'GET'],
    ['/api/payments/callback', 'POST'],
  ])
    assert.equal(isCustomerPaymentPath(p, m), false);
});
test('payment BFF requires bearer and trusted origin before upstream access', async () => {
  let sends = 0;
  const fetcher = (async () => {
    sends++;
    return Response.json(paymentPage());
  }) as typeof fetch;
  const guest = request();
  guest.headers.delete('Authorization');
  assert.equal((await proxyPayment(guest, parts, environment, fetcher)).status, 401);
  const foreign = request();
  foreign.headers.set('Origin', 'https://foreign.test');
  assert.equal((await proxyPayment(foreign, parts, environment, fetcher)).status, 403);
  assert.equal(sends, 0);
});
test('payment BFF forwards exact bearer privately, strips cookies and preserves strict string rial', async () => {
  const response = await proxyPayment(request(), parts, environment, (async (url, init) => {
    assert.equal(url, environment.SHOP_API_URL + path);
    assert.equal(init?.method, 'GET');
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('Authorization'), bearer);
    assert.equal(new Headers(init?.headers).get('Cookie'), null);
    return Response.json(paymentPage(), { headers: { 'Set-Cookie': 'secret=upstream' } });
  }) as typeof fetch);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('Vary'), 'Cookie, Authorization');
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.equal((await response.json()).items[0].amountRial, '9007199254741000');
});
test('payment BFF rejects cross-order data, hidden authorities, wrong success status, malformed UTF8 and oversized bodies', async () => {
  for (const response of [
    Response.json({ ...paymentPage(), filter: { state: null, orderId: 'f'.repeat(32) } }),
    Response.json({ ...paymentPage(), items: [{ ...paymentItem(), authority: 'secret' }] }),
    Response.json(paymentPage(), { status: 201 }),
    new Response(new Uint8Array([255]), { headers: { 'Content-Type': 'application/json' } }),
    new Response('x'.repeat(262145), { headers: { 'Content-Type': 'application/json' } }),
  ])
    assert.equal(
      (await proxyPayment(request(), parts, environment, (async () => response) as typeof fetch))
        .status,
      503,
    );
});
