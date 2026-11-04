import test from 'node:test';
import assert from 'node:assert/strict';
import {
  marketInputSchema,
  marketQueryFromParams,
  marketQueryParams,
  marketFiltersSchema,
  marketValuesSchema,
} from '@sayman/web-shared/lib/market/market-contract.ts';
import {
  MarketReadError,
  proxyMarket,
  readMarketFilters,
  readMarketPage,
  readMarketValues,
  readMarketFacets,
} from '../lib/market/market-http.ts';
const environment = {
  SHOP_API_URL: 'http://127.0.0.1:5080',
  SHOP_DATA_MODE: 'api',
  SHOP_PUBLIC_URL: 'http://market-ui.localhost:3105',
};
const attributes = [{ key: 'memory', values: ['99999999999999999999.12345678', '0.00000001'] }];
const query = { categoryId: 'phones', attributes, page: 1, pageSize: 12 };
const scope = { query: '', categoryId: 'phones', brandId: null, attributes };
const filters = {
  schemaVersion: 1,
  locale: 'fa',
  categoryId: 'phones',
  filters: [
    { key: 'memory', label: 'حافظه', dataType: 'number', unit: 'GB' },
    { key: 'ports', label: 'ارتباط‌ها', dataType: 'multiSelect', unit: null },
  ],
  moreFilters: false,
  version: 'A'.repeat(64),
};
const values = {
  schemaVersion: 1,
  locale: 'fa',
  scope,
  key: 'memory',
  valueQuery: '',
  values: [{ value: '0.00000001', label: '0.00000001 GB', count: 1 }],
  selectedValues: [
    { value: '99999999999999999999.12345678', label: '99999999999999999999.12345678 GB', count: 2 },
  ],
  total: 3,
  page: 1,
  pageSize: 20,
  totalPages: 1,
};
const input = {
  search: query,
  key: 'memory',
  page: 1,
  pageSize: 20,
  selectedValues: ['99999999999999999999.12345678'],
};
const request = (path: string, body: unknown) =>
  new Request(environment.SHOP_PUBLIC_URL + '/api/market/fa/' + path, {
    method: 'POST',
    headers: { Origin: environment.SHOP_PUBLIC_URL, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
test('typed market URL selections round trip repeated values without converting decimals to Number', () => {
  const valid = marketInputSchema.parse({
    ...query,
    query: 'گوشی ۱۲',
    attributes: [...attributes, { key: '5g', values: ['false'] }],
  });
  const params = marketQueryParams(valid);
  assert.deepEqual(marketQueryFromParams(params), { ...valid, brandId: undefined });
  assert.deepEqual(params.getAll('attr.memory'), attributes[0].values);
  for (const url of [
    'attr.memory=0',
    'category=phones&attr.memory=0&attr.memory=0',
    'category=phones&attr.bad/key=x',
    'category=phones&attr.=x',
    'category=phones&page=1&page=2',
    'category=phones&attr.x=',
  ])
    assert.throws(() => marketQueryFromParams(new URLSearchParams(url)), url);
  for (const body of [
    { ...query, attributes: [{ key: 'memory', values: [0] }] },
    { ...query, attributes: [{ key: 'memory', values: ['1'], stock: 1 }] },
    {
      ...query,
      attributes: Array.from({ length: 9 }, (_, i) => ({ key: 'a' + i, values: ['x'] })),
    },
    { ...query, attributes: [{ key: 'a', values: ['x', 'x'] }] },
    { ...query, attributes: [{ key: 'a', values: ['x'.repeat(2001)] }] },
  ])
    assert.equal(marketInputSchema.safeParse(body).success, false);
});
test('typed filter metadata is strict bounded unique and preserves null unit', () => {
  assert.equal(marketFiltersSchema.parse(filters).filters[1].unit, null);
  for (const body of [
    { ...filters, filters: [filters.filters[0], filters.filters[0]] },
    { ...filters, filters: [{ ...filters.filters[0], dataType: 'money' }] },
    { ...filters, moreFilters: true },
    { ...filters, stock: 1 },
    { ...filters, filters: [{ ...filters.filters[0], priceRial: '1' }] },
  ])
    assert.equal(marketFiltersSchema.safeParse(body).success, false);
});
test('typed values preserve exact strings, false and zero counts while rejecting inconsistent pages', () => {
  const decoded = marketValuesSchema.parse(values);
  assert.equal(decoded.selectedValues[0].value, '99999999999999999999.12345678');
  assert.equal(
    marketValuesSchema.parse({ ...values, values: [{ value: 'false', label: 'خیر', count: 0 }] })
      .values[0].count,
    0,
  );
  for (const body of [
    { ...values, values: [{ ...values.values[0], value: 0.00000001 }] },
    { ...values, values: [{ ...values.values[0], count: -1 }] },
    { ...values, values: [values.values[0], values.values[0]] },
    { ...values, total: 0 },
    { ...values, totalPages: 2 },
    { ...values, selectedValues: [values.selectedValues[0], values.selectedValues[0]] },
    { ...values, scope: { ...scope, categoryId: null } },
  ])
    assert.equal(marketValuesSchema.safeParse(body).success, false);
});
test('public typed responses are bound to the exact selected attributes, category, key, query, page and pinned choices', async () => {
  assert.equal(
    (await readMarketValues('fa', input, environment, async () => Response.json(values)))
      .selectedValues[0].count,
    2,
  );
  for (const body of [
    { ...values, locale: 'en' },
    { ...values, key: 'other' },
    { ...values, valueQuery: 'different' },
    { ...values, page: 2, values: [] },
    { ...values, scope: { ...scope, attributes: undefined } },
    { ...values, selectedValues: [] },
  ])
    await assert.rejects(
      readMarketValues('fa', input, environment, async () => Response.json(body)),
      MarketReadError,
    );
  await assert.rejects(
    readMarketFilters('fa', { categoryId: 'other' }, environment, async () =>
      Response.json(filters),
    ),
    MarketReadError,
  );
  const page = {
    schemaVersion: 1,
    locale: 'fa',
    items: [],
    total: 0,
    page: 1,
    pageSize: 12,
    totalPages: 0,
  };
  await assert.rejects(
    readMarketPage('fa', query, environment, async () => Response.json(page)),
    MarketReadError,
  );
  assert.equal(
    (
      await readMarketPage('fa', query, environment, async () =>
        Response.json({ ...page, appliedAttributes: attributes }),
      )
    ).total,
    0,
  );
  const facet = {
    schemaVersion: 1,
    locale: 'fa',
    scope,
    categories: [],
    brands: [],
    moreCategories: false,
    moreBrands: false,
  };
  await assert.rejects(
    readMarketFacets('fa', {}, environment, async () => Response.json(facet)),
    MarketReadError,
  );
});
test('typed BFF routes validate nested inputs and keep private authority out of anonymous upstream requests', async () => {
  const response = await proxyMarket(
    request('facet-values', input),
    'fa',
    ['facet-values'],
    environment,
    async (url, init) => {
      assert.equal(url, environment.SHOP_API_URL + '/api/market/fa/facet-values');
      assert.equal(init?.credentials, 'omit');
      assert.equal(init?.cache, 'no-store');
      assert.equal(init?.redirect, 'error');
      assert.deepEqual(JSON.parse(String(init?.body)), input);
      const h = new Headers(init?.headers);
      for (const name of ['Cookie', 'Authorization', 'Origin', 'Host', 'X-Sayman-Admin'])
        assert.equal(h.has(name), false);
      return Response.json(values);
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const never: typeof fetch = async () => {
    throw Error('Invalid input must not reach upstream');
  };
  for (const body of [
    { ...input, search: { ...query, stock: 1 } },
    { ...input, selectedValues: ['x', 'x'] },
    { ...input, search: { page: 1, pageSize: 12 } },
    { ...input, pageSize: 41 },
    { ...input, private: 'forged' },
  ])
    assert.equal(
      (await proxyMarket(request('facet-values', body), 'fa', ['facet-values'], environment, never))
        .status,
      400,
    );
  assert.equal(
    (
      await proxyMarket(
        request('filters', { categoryId: 'phones', stock: 1 }),
        'fa',
        ['filters'],
        environment,
        never,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await proxyMarket(
        request('facet-values', { ...input, query: 'x'.repeat(65537) }),
        'fa',
        ['facet-values'],
        environment,
        never,
      )
    ).status,
    413,
  );
});
test('bounded long typed selections can exceed legacy 4KiB while ordinary oversized requests still fail', async () => {
  const attrs = [{ key: 'chip', values: ['a'.repeat(1800), 'b'.repeat(1800), 'c'.repeat(1800)] }],
    typed = { categoryId: 'phones', attributes: attrs },
    data = {
      schemaVersion: 1,
      locale: 'fa',
      scope: { query: '', categoryId: 'phones', brandId: null, attributes: attrs },
      categories: [],
      brands: [],
      moreCategories: false,
      moreBrands: false,
    };
  assert.equal(
    (
      await proxyMarket(request('facets', typed), 'fa', ['facets'], environment, async () =>
        Response.json(data),
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await proxyMarket(
        request('search', { query: 'x'.repeat(4097) }),
        'fa',
        ['search'],
        environment,
        async () => {
          throw Error('No upstream');
        },
      )
    ).status,
    413,
  );
});
