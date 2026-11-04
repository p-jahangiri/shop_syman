import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MarketReadError,
  proxyMarket,
  readMarketItem,
  readMarketPage,
} from '../lib/market/market-http.ts';
const origin = 'http://sayman-ui.localhost:3107',
  environment = {
    SHOP_API_URL: 'http://127.0.0.1:5080',
    SHOP_DATA_MODE: 'api',
    SHOP_PUBLIC_URL: origin,
  };
const item = {
  id: 'listing1',
  model: {
    id: 'model1',
    slug: 'market-phone',
    categoryId: 'phones',
    brandId: 'brand1',
    brand: 'Brand',
    name: 'Phone',
    englishName: 'Phone',
    description: 'Description',
    image: '/products/phone.svg',
    images: ['/products/phone.svg'],
    attributes: { storage: '256 GB' },
  },
  sourceName: 'Sample source',
  availability: 'unknown',
  referencePriceRial: null,
  referencePriceCurrent: false,
  isDemo: true,
};
const page = {
  schemaVersion: 1,
  locale: 'fa',
  items: [item],
  total: 1,
  page: 1,
  pageSize: 12,
  totalPages: 1,
};
const request = (
  method = 'POST',
  path = '/api/market/fa/search',
  body: unknown = {},
  headers: Record<string, string> = {},
) =>
  new Request(origin + path, {
    method,
    headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });
const never: typeof fetch = async () => {
  throw new Error('Upstream must not be called.');
};
test('public market BFF allows only bounded locale/search/detail routes and exact supplied origin', async () => {
  for (const [locale, path, method] of [
    ['xx', ['search'], 'POST'],
    ['fa', ['../admin'], 'GET'],
    ['fa', ['listing1', 'edit'], 'POST'],
    ['fa', ['search'], 'GET'],
    ['fa', ['listing1'], 'POST'],
  ])
    assert.equal(
      (
        await proxyMarket(
          request(method as string),
          locale as string,
          path as string[],
          environment,
          never,
        )
      ).status,
      404,
    );
  assert.equal(
    (
      await proxyMarket(
        request('POST', undefined, {}, { Origin: 'https://other.example' }),
        'fa',
        ['search'],
        environment,
        never,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await proxyMarket(
        request(),
        'fa',
        ['search'],
        { ...environment, SHOP_DATA_MODE: 'preview' },
        never,
      )
    ).status,
    503,
  );
  assert.equal(
    (
      await proxyMarket(
        request(),
        'fa',
        ['search'],
        { ...environment, SHOP_API_URL: undefined },
        never,
      )
    ).status,
    503,
  );
});
test('market BFF rejects forged payment fields, duplicate query state, oversized input and wrong MIME', async () => {
  for (const body of [
    { stock: 1 },
    { priceRial: '1' },
    { pageSize: 25 },
    { query: 'x'.repeat(121) },
    { query: 'one two three four five six seven eight nine' },
  ])
    assert.equal(
      (await proxyMarket(request('POST', undefined, body), 'fa', ['search'], environment, never))
        .status,
      400,
    );
  assert.equal(
    (
      await proxyMarket(
        request('POST', '/api/market/fa/search?brand=brand1'),
        'fa',
        ['search'],
        environment,
        never,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await proxyMarket(
        request('POST', undefined, { query: 'x'.repeat(4097) }),
        'fa',
        ['search'],
        environment,
        never,
      )
    ).status,
    413,
  );
  assert.equal(
    (
      await proxyMarket(
        request('POST', undefined, {}, { 'Content-Type': 'text/plain' }),
        'fa',
        ['search'],
        environment,
        never,
      )
    ).status,
    400,
  );
});
test('anonymous market reads forward no cookie, bearer, Host, admin authority or upstream headers', async () => {
  const result = await proxyMarket(
    request(
      'POST',
      undefined,
      { query: 'phone' },
      {
        Cookie: 'private=secret',
        Authorization: 'Bearer private',
        'X-Sayman-Admin': '1',
        'X-Forwarded-For': 'forged',
      },
    ),
    'fa',
    ['search'],
    environment,
    async (url, init) => {
      assert.equal(url, 'http://127.0.0.1:5080/api/market/fa/search');
      assert.equal(init?.cache, 'no-store');
      assert.equal(init?.credentials, 'omit');
      assert.equal(init?.redirect, 'error');
      assert.deepEqual(JSON.parse(String(init?.body)), { query: 'phone', page: 1, pageSize: 12 });
      const h = new Headers(init?.headers);
      for (const name of [
        'Cookie',
        'Authorization',
        'Host',
        'Origin',
        'X-Sayman-Admin',
        'X-Forwarded-For',
      ])
        assert.equal(h.has(name), false);
      return Response.json(page, {
        headers: {
          'Set-Cookie': 'ignored=1',
          Location: 'https://untrusted.example',
          'Cache-Control': 'public',
        },
      });
    },
  );
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
  assert.match(result.headers.get('X-Robots-Tag')!, /noindex/);
  assert.equal(result.headers.has('Set-Cookie'), false);
  assert.equal(result.headers.has('Location'), false);
  assert.equal((await result.json()).items[0].referencePriceRial, null);
});
test('market page reads bind locale, requested page, category and brand to the upstream contract', async () => {
  const call = (value: unknown, input = {}) =>
    readMarketPage('fa', input, environment, async () => Response.json(value));
  for (const value of [
    { ...page, locale: 'en' },
    { ...page, page: 2 },
    { ...page, pageSize: 6 },
    { ...page, items: [{ ...item, model: { ...item.model, priceRial: '1' } }] },
  ])
    await assert.rejects(call(value), MarketReadError);
  await assert.rejects(call(page, { categoryId: 'other' }), MarketReadError);
  await assert.rejects(call(page, { brandId: 'other' }), MarketReadError);
  assert.equal(
    (await call(page, { brandId: 'brand1', categoryId: 'phones' })).items[0].model.id,
    'model1',
  );
});
test('detail reads require the exact listing and preserve unavailable/404 responses without leaking provider errors', async () => {
  const good = await proxyMarket(
    request('GET', '/api/market/fa/listing1'),
    'fa',
    ['listing1'],
    environment,
    async (url, init) => {
      assert.equal(url, 'http://127.0.0.1:5080/api/market/fa/listing1');
      assert.equal(init?.body, undefined);
      return Response.json(item);
    },
  );
  assert.equal(good.status, 200);
  await assert.rejects(
    readMarketItem('fa', 'listing1', environment, async () =>
      Response.json({ ...item, id: 'other' }),
    ),
    MarketReadError,
  );
  const missing = await proxyMarket(
    request('GET', '/api/market/fa/listing1'),
    'fa',
    ['listing1'],
    environment,
    async () => Response.json({ detail: 'Internal SQL' }, { status: 404 }),
  );
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { title: 'market_unavailable' });
  const failure = await proxyMarket(request(), 'fa', ['search'], environment, async () =>
    Response.json({ detail: 'Private source credential' }, { status: 500 }),
  );
  assert.equal(failure.status, 503);
  assert.deepEqual(await failure.json(), { title: 'market_unavailable' });
});
test('successful upstream market data is bounded, UTF-8 JSON and strict rather than streamed unchecked', async () => {
  for (const response of [
    new Response('not JSON', { headers: { 'Content-Type': 'application/json' } }),
    new Response('<html>Unexpected</html>', { headers: { 'Content-Type': 'text/html' } }),
    Response.json({ ...page, private: 'unknown' }),
    Response.json(page, { headers: { 'Content-Length': '2097153' } }),
    new Response(' '.repeat(2097153), { headers: { 'Content-Type': 'application/json' } }),
    new Response(new Uint8Array([0xff]), { headers: { 'Content-Type': 'application/json' } }),
  ])
    assert.equal(
      (await proxyMarket(request(), 'fa', ['search'], environment, async () => response)).status,
      503,
    );
});
