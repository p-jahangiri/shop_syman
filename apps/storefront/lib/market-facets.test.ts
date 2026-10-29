import test from 'node:test';
import assert from 'node:assert/strict';
import { marketFacetsSchema } from './market-contract.ts';
import { MarketReadError, proxyMarket, readMarketFacets } from './market-http.ts';
const origin = 'http://sayman-ui.localhost:3107',
  environment = {
    SHOP_API_URL: 'http://127.0.0.1:5080',
    SHOP_DATA_MODE: 'api',
    SHOP_PUBLIC_URL: origin,
  };
const facets = {
  schemaVersion: 1,
  locale: 'fa',
  scope: { query: '', categoryId: null, brandId: null },
  categories: [{ id: 'phones', count: 3 }],
  brands: [{ id: 'brand', name: 'Market-only brand', count: 3 }],
  moreCategories: false,
  moreBrands: false,
};
const request = (body: unknown = {}, headers: Record<string, string> = {}) =>
  new Request(origin + '/api/market/fa/facets', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
const never: typeof fetch = async () => {
  throw Error('No upstream call expected');
};
test('facet contract is bounded, strict, unique and never accepts inventory or price fields', () => {
  assert.equal(marketFacetsSchema.parse(facets).brands[0].count, 3);
  for (const value of [
    { ...facets, stock: 3 },
    { ...facets, scope: { ...facets.scope, priceRial: '1' } },
    { ...facets, brands: [{ ...facets.brands[0], count: 0 }] },
    { ...facets, brands: [{ ...facets.brands[0], count: '3' }] },
    { ...facets, brands: [facets.brands[0], facets.brands[0]] },
    { ...facets, categories: [facets.categories[0], facets.categories[0]] },
    { ...facets, moreBrands: true },
    {
      ...facets,
      brands: Array.from({ length: 201 }, (_, i) => ({ ...facets.brands[0], id: 'b' + i })),
    },
    { ...facets, scope: { query: '', categoryId: null } },
    { ...facets, brands: [{ ...facets.brands[0], name: '' }] },
  ])
    assert.equal(marketFacetsSchema.safeParse(value).success, false);
  const bounded = {
    ...facets,
    moreBrands: true,
    brands: Array.from({ length: 200 }, (_, i) => ({ ...facets.brands[0], id: 'b' + i })),
  };
  assert.equal(marketFacetsSchema.safeParse(bounded).success, true);
});
test('facet reads bind the response to locale and all non-paging filters', async () => {
  for (const value of [
    { ...facets, locale: 'en' },
    { ...facets, scope: { ...facets.scope, query: 'other' } },
    { ...facets, scope: { ...facets.scope, categoryId: 'other' } },
    { ...facets, scope: { ...facets.scope, brandId: 'other' } },
  ])
    await assert.rejects(
      readMarketFacets('fa', {}, environment, async () => Response.json(value)),
      MarketReadError,
    );
  const result = await readMarketFacets('fa', { page: 23, pageSize: 1 }, environment, async () =>
    Response.json(facets),
  );
  assert.equal(result.brands.length, 1);
});
test('facet BFF forwards only anonymous bounded inputs and emits no-store JSON', async () => {
  const result = await proxyMarket(
    request({}, { Cookie: 'private=1', Authorization: 'Bearer private', 'X-Sayman-Admin': '1' }),
    'fa',
    ['facets'],
    environment,
    async (url, init) => {
      assert.equal(url, environment.SHOP_API_URL + '/api/market/fa/facets');
      assert.deepEqual(JSON.parse(String(init?.body)), { page: 1, pageSize: 12 });
      assert.equal(init?.credentials, 'omit');
      assert.equal(init?.cache, 'no-store');
      assert.equal(init?.redirect, 'error');
      const h = new Headers(init?.headers);
      for (const name of ['Cookie', 'Authorization', 'Origin', 'Host', 'X-Sayman-Admin'])
        assert.equal(h.has(name), false);
      return Response.json(facets);
    },
  );
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), facets);
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
  assert.match(result.headers.get('X-Robots-Tag')!, /noindex/);
  for (const body of [{ stock: 1 }, { pageSize: 25 }, { query: 'x'.repeat(121) }])
    assert.equal(
      (await proxyMarket(request(body), 'fa', ['facets'], environment, never)).status,
      400,
    );
  assert.equal(
    (
      await proxyMarket(
        request({}, { Origin: 'https://other.example' }),
        'fa',
        ['facets'],
        environment,
        never,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await proxyMarket(
        new Request(origin + '/api/market/fa/facets'),
        'fa',
        ['facets'],
        environment,
        never,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await proxyMarket(
        request(),
        'fa',
        ['facets'],
        { ...environment, SHOP_DATA_MODE: 'preview' },
        never,
      )
    ).status,
    503,
  );
  assert.equal(
    (
      await proxyMarket(request(), 'fa', ['facets'], environment, async () =>
        Response.json({ ...facets, private: 'unexpected' }),
      )
    ).status,
    503,
  );
  assert.equal(
    (
      await proxyMarket(request(), 'fa', ['facets'], environment, async () =>
        Response.json({ detail: 'SQL internals' }, { status: 500 }),
      )
    ).status,
    503,
  );
});
