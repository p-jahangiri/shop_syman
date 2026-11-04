import test from 'node:test';
import assert from 'node:assert/strict';
import {
  marketFreshness,
  marketInputSchema,
  marketItemSchema,
  marketPageSchema,
  marketQueryFromParams,
  marketQueryParams,
} from '@sayman/web-shared/lib/market/market-contract.ts';
import { formatToman } from '@sayman/web-shared/lib/shared/money.ts';
const model = {
  id: 'model1',
  slug: 'market-phone',
  categoryId: 'phones',
  brandId: 'brand1',
  brand: 'Brand',
  name: 'Phone',
  englishName: 'Phone',
  description: 'Model description',
  image: '/products/phone.svg',
  images: ['/products/phone.svg'],
  attributes: { ram: '8 GB' },
};
const sample = {
  id: 'listing1',
  model,
  sourceName: 'Recorded source',
  availability: 'available',
  observedAt: '2026-10-23T10:00:00.1234567+00:00',
  validUntil: '2026-10-24T10:00:00+00:00',
  referencePriceRial: '9007199254740993',
  referencePriceCurrent: true,
  isDemo: true,
};
test('market models remain a strict non-sellable contract and preserve integer rial precision', () => {
  const item = marketItemSchema.parse(sample);
  assert.equal(item.referencePriceRial, '9007199254740993');
  assert.equal(formatToman(item.referencePriceRial!, 'en'), '900,719,925,474,099.3');
  assert.equal(item.sourceUrl, null);
  for (const input of [
    { ...sample, referencePriceRial: Number('9007199254740993') },
    { ...sample, referencePriceRial: '0' },
    { ...sample, referencePriceRial: '9223372036854775808' },
    { ...sample, model: { ...model, variants: [{ id: 'v', stock: 1, priceRial: '1' }] } },
    { ...sample, stock: 1 },
    { ...sample, purchaseMethodIds: ['cash'] },
    { ...sample, model: { ...model, attributes: { ...model.attributes, battery: 0 } } },
  ])
    assert.equal(marketItemSchema.safeParse(input).success, false);
});
test('unknown prices and omitted dates decode explicitly while contradictory source claims fail', () => {
  const item = marketItemSchema.parse({
    id: 'listing1',
    model,
    sourceName: 'Source',
    availability: 'unknown',
    referencePriceRial: null,
    referencePriceCurrent: false,
    isDemo: false,
  });
  assert.equal(item.observedAt, null);
  assert.equal(item.validUntil, null);
  for (const input of [
    { ...sample, observedAt: undefined },
    { ...sample, validUntil: '2026-10-22T10:00:00Z' },
    { ...sample, referencePriceRial: null },
    { ...sample, availability: 'stale' },
    { ...sample, sourceUrl: 'https://source.example/item?token=secret' },
    { ...sample, sourceUrl: 'https://user:pass@source.example/item' },
    {
      ...sample,
      model: { ...model, image: 'javascript:alert(1)', images: ['javascript:alert(1)'] },
    },
  ])
    assert.equal(marketItemSchema.safeParse(input).success, false);
  assert.equal(
    marketItemSchema.safeParse({ ...sample, availability: 'stale', referencePriceCurrent: false })
      .success,
    true,
  );
});
test('market pages reject duplicate models, overlarge pages and inconsistent totals', () => {
  const page = {
    schemaVersion: 1,
    locale: 'fa',
    items: [sample],
    total: 1,
    page: 1,
    pageSize: 12,
    totalPages: 1,
  };
  assert.equal(marketPageSchema.safeParse(page).success, true);
  for (const value of [
    { ...page, total: 0 },
    { ...page, totalPages: 2 },
    { ...page, page: 2 },
    { ...page, pageSize: 25 },
    { ...page, items: [sample, sample], total: 2 },
    { ...page, items: [sample, { ...sample, id: 'listing2' }], total: 2 },
    { ...page, privateData: 'extra' },
  ])
    assert.equal(marketPageSchema.safeParse(value).success, false);
  assert.equal(marketPageSchema.safeParse({ ...page, items: [], page: 5 }).success, true);
});
test('search, category, brand and paging round trip with bounded distinct URL fields', () => {
  const query = marketInputSchema.parse({
    query: 'گوشی ۱۲۸',
    categoryId: 'phones',
    brandId: 'brand1',
    page: 2,
    pageSize: 24,
  });
  assert.deepEqual(marketQueryFromParams(marketQueryParams(query)), query);
  assert.equal(marketQueryFromParams(new URLSearchParams('page=۲&size=۱۲')).page, 2);
  for (const raw of [
    'q=one&q=two',
    'page=1e2',
    'page=01',
    'page=10001',
    'size=25',
    'brand=..%2Fadmin',
    'category=%2F',
    'unknown=x',
  ])
    assert.throws(() => marketQueryFromParams(new URLSearchParams(raw)), raw);
  for (const input of [
    { query: 'one two three four five six seven eight nine' },
    { query: 'bad\0query' },
    { query: 'x'.repeat(121) },
    { pageSize: 0 },
    { brandId: 'unsafe/brand' },
    { minPriceRial: '1' },
  ])
    assert.equal(marketInputSchema.safeParse(input).success, false);
});
test('freshness expires on screen without turning source availability into store stock', () => {
  const item = marketItemSchema.parse(sample),
    expiry = Date.parse(item.validUntil!);
  assert.deepEqual(marketFreshness(item, expiry - 1), {
    availability: 'available',
    priceCurrent: true,
  });
  assert.deepEqual(marketFreshness(item, expiry), { availability: 'stale', priceCurrent: false });
  const unknown = marketItemSchema.parse({
    ...sample,
    availability: 'unknown',
    observedAt: undefined,
    validUntil: undefined,
    referencePriceRial: null,
    referencePriceCurrent: false,
  });
  assert.deepEqual(marketFreshness(unknown, expiry), {
    availability: 'unknown',
    priceCurrent: false,
  });
});
