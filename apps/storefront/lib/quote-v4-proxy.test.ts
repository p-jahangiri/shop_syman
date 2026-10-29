import assert from 'node:assert/strict';
import test from 'node:test';
import { proxyCartV2 } from './cart-v2-proxy.ts';
import { isCustomerCartV2Path } from './cart-v2-path.ts';
import { quoteInputSchema } from './quote-contract.ts';
import { quote4Snapshot } from './quote-v4.test-fixtures.ts';
const env = {
    SHOP_API_URL: 'https://api.example.test',
    SHOP_PUBLIC_URL: 'https://shop.example.test',
    SHOP_DATA_MODE: 'api',
  },
  auth = 'Bearer ' + 'a'.repeat(30),
  path = '/api/cart/en/v2/quote';
const input = quoteInputSchema.parse({
  cartVersion: 'AAAAAAAAAAE=',
  methodId: 'cash',
  requestId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
});
const req = (body: unknown = input, method = 'POST') =>
  new Request(env.SHOP_PUBLIC_URL + path, {
    method,
    headers: {
      Authorization: auth,
      Origin: env.SHOP_PUBLIC_URL,
      'Content-Type': 'application/json',
    },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
test('Quote4 BFF allowlist admits only exact supported locales and POST without query or suffix', () => {
  assert.equal(isCustomerCartV2Path(path, 'POST'), true);
  for (const [value, method] of [
    [path, 'GET'],
    [path, 'PUT'],
    [path + '/', 'POST'],
    [path + '?owner=other', 'POST'],
    [path + '/receipt', 'GET'],
    ['/api/cart/fr/v2/quote', 'POST'],
  ])
    assert.equal(isCustomerCartV2Path(value, method), false);
});
test('Quote4 BFF requires member bearer, trusted origin, exact bounded server-price-free input', async () => {
  let sent = 0;
  const fetcher = (async () => {
    sent++;
    return Response.json(quote4Snapshot(true));
  }) as typeof fetch;
  const guest = req();
  guest.headers.delete('Authorization');
  assert.equal((await proxyCartV2(guest, 'en', ['quote'], env, fetcher)).status, 401);
  const foreign = req();
  foreign.headers.set('Origin', 'https://foreign.test');
  assert.equal((await proxyCartV2(foreign, 'en', ['quote'], env, fetcher)).status, 403);
  for (const body of [
    { ...input, ownerId: 'private' },
    { ...input, unitPriceRial: '1' },
    { ...input, lineId: 'a'.repeat(32) },
    { ...input, methodId: 'cash', requestId: null },
    { ...input, secret: 'x'.repeat(17000) },
  ])
    assert.ok(
      [400, 413].includes((await proxyCartV2(req(body), 'en', ['quote'], env, fetcher)).status),
    );
  assert.equal(sent, 0);
});
test('Quote4 BFF forwards frozen body and authorization without guest cookies and never caches private response', async () => {
  const request = req();
  request.headers.set('Cookie', 'sayman_cart=' + 'b'.repeat(43) + '; private=secret');
  const result = await proxyCartV2(request, 'en', ['quote'], env, (async (url, init) => {
    assert.equal(url, env.SHOP_API_URL + path);
    assert.equal(init?.method, 'POST');
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.redirect, 'error');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Authorization'), auth);
    assert.equal(headers.get('Cookie'), null);
    assert.deepEqual(JSON.parse(init?.body as string), input);
    return Response.json(quote4Snapshot(true), { headers: { 'Set-Cookie': 'private=secret' } });
  }) as typeof fetch);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(result.headers.get('Vary'), 'Cookie, Authorization');
  assert.equal(result.headers.get('Set-Cookie'), null);
  assert.equal((await result.json()).lines[1].unitPriceRial, '9007199254740993');
});
test('Quote4 BFF binds locale/cart/method and rejects unsafe or oversized upstream bodies', async () => {
  const q = quote4Snapshot(true);
  for (const response of [
    Response.json({ ...q, locale: 'fa' }),
    Response.json({ ...q, cartVersion: 'AAAAAAAAAAI=' }),
    Response.json({ ...q, selectedMethod: { ...q.selectedMethod!, id: 'other' } }),
    Response.json({ ...q, schemaVersion: 3 }),
    Response.json({ ...q, privateUnits: ['private'] }),
    new Response('x'.repeat(524289), { headers: { 'Content-Type': 'application/json' } }),
    new Response(new Uint8Array([255]), { headers: { 'Content-Type': 'application/json' } }),
  ])
    assert.equal(
      (await proxyCartV2(req(), 'en', ['quote'], env, (async () => response) as typeof fetch))
        .status,
      503,
    );
});
test('Quote4 BFF strips upstream private errors and exposes only safe conflict codes', async () => {
  const conflict = await proxyCartV2(req(), 'en', ['quote'], env, (async () =>
    Response.json(
      { title: 'quote_accepted_offer_expired_conflict', detail: 'secret' },
      { status: 409 },
    )) as typeof fetch);
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), { title: 'quote_accepted_offer_expired_conflict' });
  const failure = await proxyCartV2(req(), 'en', ['quote'], env, (async () =>
    Response.json(
      { title: 'private <secret>', detail: 'secret' },
      { status: 500 },
    )) as typeof fetch);
  assert.equal(failure.status, 503);
  assert.deepEqual(await failure.json(), { title: 'cart_unavailable' });
});
