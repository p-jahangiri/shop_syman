import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  catalogInputSchema,
  catalogPageSchema,
  catalogQueryFromParams,
  catalogQueryParams,
  lookupInputSchema,
  facetInputSchema,
  facetPageSchema,
} from '../lib/catalog/catalog-contract.ts';
import {
  previewFilters,
  previewPage,
  pageFacetValues,
  previewFacetPage,
} from '../lib/catalog/catalog-preview.ts';
import {
  parseSavedShop,
  savedLookupBatches,
  hydrateSavedShop,
  resolveSavedShop,
} from '../lib/wishlist/saved-shop.ts';
import { storefrontSnapshot } from '../lib/data/fixtures.ts';
test('bounded query state round trips through URLs without converting rial to a number', () => {
  const input = catalogInputSchema.parse({
    categoryId: 'phones',
    query: 'آیفون',
    maxPriceRial: '9223372036854775807',
    page: 2,
    availableOnly: true,
    attributes: [{ key: 'storage', values: ['stable-option'] }],
    brandIds: ['apple'],
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(catalogQueryFromParams(catalogQueryParams(input)))),
    input,
  );
  for (const query of [
    { query: 'one two three four five six seven eight nine' },
    { pageSize: 49 },
    { sort: 'script' },
    { maxPriceRial: '9223372036854775808' },
    { attributes: [{ key: 'ram', values: ['8'] }] },
    {
      categoryId: 'c',
      attributes: [
        { key: 'ram', values: ['8'] },
        { key: 'ram', values: ['16'] },
      ],
    },
  ])
    assert.equal(catalogInputSchema.safeParse(query).success, false);
  assert.equal(lookupInputSchema.safeParse({ productIds: Array(65).fill('p') }).success, false);
});

test('catalog and facet limits count canonical Persian tokens while preserving the raw query', () => {
  const query = 'کیف كیف کيف كيف کِیف کَیف كِيف كَيف کُیف';
  const catalog = catalogInputSchema.parse({ query, pageSize: 4 });
  assert.equal(catalog.query, query);
  assert.equal(catalogQueryFromParams(catalogQueryParams(catalog)).query, query);
  const facet = facetInputSchema.parse({
    categoryId: 'phones',
    key: 'case',
    query,
    selectedValues: ['canonical-id'],
  });
  assert.equal(facet.query, query);
  assert.deepEqual(facet.selectedValues, ['canonical-id']);
  assert.deepEqual(Object.keys(catalog).sort(), [
    'attributes',
    'availableOnly',
    'brandIds',
    'page',
    'pageSize',
    'query',
    'sort',
  ]);
});

test('catalog and facet query boundaries agree with backend normalization fixtures', () => {
  // Counts follow PersianText.Normalize in Shop.SharedKernel/Money.cs, not a search alias list.
  const fixtures: [string, number][] = [
    ['کیف كیف کيف كيف کِیف کَیف كِيف كَيف کُیف', 1],
    ['۱۲۳ ١٢٣ 123', 1],
    ['ی ي ى', 1],
    ['ک ك', 1],
    ['کیف\u06d6 كيف', 1],
    ['کیف\u200cكيف', 1],
    ['یک\u200cدو', 2],
    ['یک\u0085دو', 2],
    ['یک\u00a0دو\u2028سه', 3],
    ['یک\ufeffدو', 1],
    ['Ａ a', 1],
    ['I i İ', 2],
    ['ΟΣ οσ', 1],
    ['\u064e\u0670 \u06d6', 0],
    ['', 0],
  ];
  for (const [query, count] of fixtures) {
    for (const accepted of [true, false]) {
      const prefix = Array.from({ length: 8 - count + Number(!accepted) }, (_, i) => `b${i}`);
      const value = [...prefix, query].join(' ');
      assert.equal(catalogInputSchema.safeParse({ query: value }).success, accepted, value);
      assert.equal(
        facetInputSchema.safeParse({ categoryId: 'c', key: 'k', query: value }).success,
        accepted,
        value,
      );
    }
  }
});

test('nine distinct terms cannot bypass either query limit using Persian half-spaces', () => {
  for (const separator of [' ', '\u200c', '\u0085', '\n']) {
    const query = Array.from({ length: 9 }, (_, i) => `واژه${i}`).join(separator);
    assert.equal(catalogInputSchema.safeParse({ query }).success, false);
    assert.equal(facetInputSchema.safeParse({ categoryId: 'c', key: 'k', query }).success, false);
  }
});

test('normalization never bypasses raw query length, strict shape or field-type limits', () => {
  for (const [schema, base, limit] of [
    [catalogInputSchema, {}, 200],
    [facetInputSchema, { categoryId: 'c', key: 'k' }, 100],
  ] as const) {
    const query = 'ک' + '\u064e'.repeat(limit - 1);
    assert.equal(schema.safeParse({ ...base, query }).success, true);
    assert.equal(schema.safeParse({ ...base, query: query + '\u064e' }).success, false);
    assert.equal(schema.safeParse({ ...base, query, extra: true }).success, false);
    for (const query of [null, 123, ['کیف'], { text: 'کیف' }])
      assert.equal(schema.safeParse({ ...base, query }).success, false);
  }
});

test('page boundary rejects a foreign matching variant and contradictory totals', () => {
  const page = previewPage('en', catalogInputSchema.parse({ pageSize: 2 }));
  assert.equal(catalogPageSchema.safeParse(page).success, true);
  assert.equal(catalogPageSchema.safeParse({ ...page, total: 0, totalPages: 0 }).success, false);
  assert.equal(
    catalogPageSchema.safeParse({
      ...page,
      matchingVariantIds: { [page.products[0].id]: 'private-variant' },
    }).success,
    false,
  );
  const ids = previewPage('en', catalogInputSchema.parse({ page: 2, pageSize: 2 })).products.map(
    (p) => p.id,
  );
  assert.equal(
    page.products.some((p) => ids.includes(p.id)),
    false,
  );
});
test('fixture filter identifiers remain stable between Persian and English', () => {
  const fa = previewFilters('fa', 'phones'),
    en = previewFilters('en', 'phones');
  assert.deepEqual(
    fa.attributes.map((a) => a.values.map((v) => v.value)),
    en.attributes.map((a) => a.values.map((v) => v.value)),
  );
  const first = fa.attributes.find((a) => a.values.length)!;
  const input = catalogInputSchema.parse({
    categoryId: 'phones',
    attributes: [{ key: first.key, values: [first.values[0].value] }],
  });
  assert.deepEqual(
    previewPage('fa', input).products.map((p) => p.id),
    previewPage('en', input).products.map((p) => p.id),
  );
});
test('saved choices strip injected prices and hydrate against fresh public stock', () => {
  const p = structuredClone(storefrontSnapshot.products[0]);
  p.variants[0].stock = 2;
  const saved = parseSavedShop({
    cart: [
      { variantId: p.variants[0].id, quantity: 99, priceRial: '1' },
      { variantId: 'missing', quantity: 1 },
      { variantId: p.variants[0].id, quantity: -1 },
    ],
    wishlist: [p.id, 'missing'],
    compare: [p.id, 'missing'],
  });
  assert.equal(JSON.stringify(saved).includes('priceRial'), false);
  assert.deepEqual(hydrateSavedShop(saved, [p]), {
    cart: [{ variantId: p.variants[0].id, quantity: 2 }],
    wishlist: [p.id],
    compare: [p.id],
  });
});
test('saved lookup is bounded and partial failures leave the original references untouched', async () => {
  const saved = parseSavedShop({
    cart: Array.from({ length: 100 }, (_, i) => ({ variantId: `v${i}`, quantity: 1 })),
    wishlist: Array.from({ length: 200 }, (_, i) => `p${i}`),
    compare: ['x1', 'x2', 'x3', 'x4'],
  });
  const before = JSON.stringify(saved);
  const batches = savedLookupBatches(saved);
  assert.equal(batches.length, 5);
  assert.ok(batches.every((b) => b.productIds.length + b.variantIds.length <= 64));
  let called = 0;
  await assert.rejects(
    resolveSavedShop(saved, async () => {
      if (++called === 2) throw new Error('network');
      return [];
    }),
  );
  assert.equal(JSON.stringify(saved), before);
  assert.equal(called, 2);
});

test('facet pages can find an option beyond the initial limit and retain off-page selected labels', () => {
  const values = Array.from({ length: 85 }, (_, i) => ({ value: `o${i}`, label: `کیف ${i}` }));
  const query = facetInputSchema.parse({
    categoryId: 'c',
    key: 'case',
    page: 4,
    pageSize: 20,
    selectedValues: ['o84'],
  });
  const page = pageFacetValues('fa', 'case', values, query);
  assert.equal(facetPageSchema.safeParse(page).success, true);
  assert.equal(page.values.length, 20);
  assert.equal(page.totalPages, 5);
  assert.deepEqual(page.selectedValues, [values[84]]);
  const next = pageFacetValues('fa', 'case', values, { ...query, page: 5 });
  assert.equal(next.values.length, 5);
  assert.equal(
    next.values.some((v) => page.values.some((o) => o.value === v.value)),
    false,
  );
  const search = pageFacetValues('en', 'case', values, { ...query, page: 1, query: 'كِيف ۸۴' });
  assert.deepEqual(search.values, [values[84]]);
  assert.equal(
    facetPageSchema.safeParse({ ...page, values: [...page.values, page.values[0]] }).success,
    false,
  );
  for (const bad of [
    { categoryId: 'c', key: 'k', pageSize: 61 },
    { categoryId: 'c', key: 'k', selectedValues: ['same', 'same'] },
    { categoryId: 'c', key: 'k', query: 'x'.repeat(101) },
  ])
    assert.equal(facetInputSchema.safeParse(bad).success, false);
});
test('facet labels and identifiers stay consistent while searching in the other language', () => {
  const filters = previewFilters('fa', 'phones');
  const key = filters.attributes[0].key;
  const chosen = filters.attributes[0].values[0].value;
  const fa = previewFacetPage(
    'fa',
    facetInputSchema.parse({ categoryId: 'phones', key, pageSize: 1, selectedValues: [chosen] }),
  );
  const en = previewFacetPage(
    'en',
    facetInputSchema.parse({ categoryId: 'phones', key, pageSize: 1, selectedValues: [chosen] }),
  );
  assert.equal(fa.values[0].value, en.values[0].value);
  assert.equal(fa.selectedValues[0].value, en.selectedValues[0].value);
  assert.notEqual(fa.selectedValues[0].label, en.selectedValues[0].label);
  const search = previewFacetPage(
    'en',
    facetInputSchema.parse({
      categoryId: 'phones',
      key,
      query: fa.selectedValues[0].label,
      selectedValues: [chosen],
    }),
  );
  assert.ok(search.values.some((v) => v.value === chosen));
});
