import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  catalogInputSchema,
  catalogQueryFromParams,
  catalogQueryParams,
} from './catalog-contract.ts';
import {
  areCatalogPriceRangesEqual,
  catalogFilterNeedsSearch,
  parseCatalogPriceRange,
  patchCatalogQuery,
  visibleCatalogFacets,
} from './catalog-filter-state.ts';

test('market-only specifications do not create empty shop accordions, while selected empty values remain removable', () => {
  const attributes = [
    {
      key: 'phone-chipset',
      unit: undefined,
      label: 'Chipset',
      dataType: 'text' as const,
      values: [],
      total: 0,
      truncated: false,
    },
    {
      key: 'ram',
      unit: undefined,
      label: 'RAM',
      dataType: 'number' as const,
      values: [{ value: '8', label: '8 GB' }],
      total: 1,
      truncated: false,
    },
    {
      key: 'storage',
      unit: undefined,
      label: 'Storage',
      dataType: 'number' as const,
      values: [],
      total: 0,
      truncated: false,
    },
  ];
  assert.deepEqual(
    visibleCatalogFacets(attributes, []).map((f) => f.key),
    ['ram'],
  );
  assert.deepEqual(
    visibleCatalogFacets(attributes, [{ key: 'storage', values: ['256'] }]).map((f) => f.key),
    ['ram', 'storage'],
  );
  assert.deepEqual(
    visibleCatalogFacets([{ ...attributes[0], total: 100, truncated: true }], []).map((f) => f.key),
    ['phone-chipset'],
  );
});

test('price bounds can be cleared independently and retain an explicit zero', () => {
  assert.deepEqual(parseCatalogPriceRange(' ', ''), {
    ok: true,
    value: { minPriceRial: undefined, maxPriceRial: undefined },
  });
  assert.deepEqual(parseCatalogPriceRange('0', '۰'), {
    ok: true,
    value: { minPriceRial: '0', maxPriceRial: '0' },
  });
  assert.deepEqual(parseCatalogPriceRange('', '0'), {
    ok: true,
    value: { minPriceRial: undefined, maxPriceRial: '0' },
  });
  assert.deepEqual(parseCatalogPriceRange('۱۰۰', ''), {
    ok: true,
    value: { minPriceRial: '1000', maxPriceRial: undefined },
  });
});

test('Persian and Arabic prices accept grouping separators and preserve one-rial fractions', () => {
  assert.deepEqual(parseCatalogPriceRange('۱۲٬۳۴۵٫۶', '٤٥,٠٠٠.٧'), {
    ok: true,
    value: { minPriceRial: '123456', maxPriceRial: '450007' },
  });
  assert.deepEqual(parseCatalogPriceRange('۴۰ ۰۰۰ ۰۰۰', '50,000,000'), {
    ok: true,
    value: { minPriceRial: '400000000', maxPriceRial: '500000000' },
  });
});

test('invalid, negative, fractional-rial and overflowing bounds return an error without a patch', () => {
  for (const input of [
    '-1',
    '−۱',
    '1e2',
    'NaN',
    '۱۲تومان',
    '1.01',
    '۱٫۲٫۳',
    ' ,٬ ',
    '922337203685477580.8',
  ]) {
    assert.deepEqual(parseCatalogPriceRange(input, ''), { ok: false, error: 'minimum' }, input);
    assert.deepEqual(parseCatalogPriceRange('', input), { ok: false, error: 'maximum' }, input);
  }
});

test('range ordering compares exact rials above Number precision, including zero as a maximum', () => {
  assert.deepEqual(parseCatalogPriceRange('90071992547409939.9', '90071992547409939.8'), {
    ok: false,
    error: 'order',
  });
  assert.deepEqual(parseCatalogPriceRange('0.1', '0'), { ok: false, error: 'order' });
  assert.deepEqual(
    parseCatalogPriceRange('۹۲۲٬۳۳۷٬۲۰۳٬۶۸۵٬۴۷۷٬۵۸۰٫۶', '۹۲۲٬۳۳۷٬۲۰۳٬۶۸۵٬۴۷۷٬۵۸۰٫۷'),
    {
      ok: true,
      value: { minPriceRial: '9223372036854775806', maxPriceRial: '9223372036854775807' },
    },
  );
});

test('canonical price comparisons preserve a paged URL with padded bounds and distinguish absent from zero', () => {
  const query = catalogQueryFromParams(
    new URLSearchParams('min=00&max=0000000000000000010&page=2'),
  );
  const parsed = parseCatalogPriceRange('0', '1');
  assert.ok(parsed.ok);
  assert.equal(areCatalogPriceRangesEqual(parsed.value, query), true);
  assert.equal(query.page, 2);
  assert.equal(areCatalogPriceRangesEqual({}, { minPriceRial: '0' }), false);
  assert.equal(areCatalogPriceRangesEqual({}, { maxPriceRial: '00' }), false);
  assert.equal(
    areCatalogPriceRangesEqual(
      { maxPriceRial: '900719925474099398' },
      { maxPriceRial: '900719925474099399' },
    ),
    false,
  );
  assert.equal(areCatalogPriceRangesEqual({ minPriceRial: '1' }, { maxPriceRial: '1' }), false);
});

test('rapid intended changes compose without losing filters before navigation completes', () => {
  const original = catalogInputSchema.parse({
    categoryId: 'phones',
    query: 'آیفون',
    sort: 'price-desc',
    page: 7,
    pageSize: 24,
  });
  let intended = patchCatalogQuery(original, (current) => ({
    brandIds: [...current.brandIds, 'apple'],
  }));
  intended = patchCatalogQuery(intended, (current) => ({
    brandIds: [...current.brandIds, 'samsung'],
  }));
  intended = patchCatalogQuery(intended, { availableOnly: true });
  intended = patchCatalogQuery(intended, (current) => ({
    attributes: [...current.attributes, { key: 'storage', values: ['256'] }],
  }));
  const price = parseCatalogPriceRange('۴۰٬۰۰۰٬۰۰۰', '۹۰٬۰۰۰٬۰۰۰');
  assert.ok(price.ok);
  intended = patchCatalogQuery(intended, price.value);
  assert.deepEqual(intended, {
    ...original,
    page: 1,
    brandIds: ['apple', 'samsung'],
    availableOnly: true,
    attributes: [{ key: 'storage', values: ['256'] }],
    minPriceRial: '400000000',
    maxPriceRial: '900000000',
  });
  assert.deepEqual(catalogQueryFromParams(catalogQueryParams(intended)), intended);
  assert.equal(original.page, 7);
  assert.deepEqual(original.brandIds, []);
});

test('patches preserve search and sorting, validate category-dependent state and allow explicit pagination', () => {
  const original = catalogInputSchema.parse({
    categoryId: 'phones',
    query: 'گوشی',
    sort: 'newest',
    page: 4,
    brandIds: ['apple'],
    attributes: [{ key: 'color', values: ['black'] }],
    minPriceRial: '1',
    maxPriceRial: '9223372036854775807',
  });
  assert.throws(() => patchCatalogQuery(original, { categoryId: undefined }));
  assert.throws(() => patchCatalogQuery(original, { minPriceRial: '9223372036854775808' }));
  const cleared = patchCatalogQuery(original, {
    categoryId: undefined,
    attributes: [],
    brandIds: [],
    minPriceRial: undefined,
    maxPriceRial: undefined,
  });
  assert.equal(cleared.query, 'گوشی');
  assert.equal(cleared.sort, 'newest');
  assert.equal(cleared.page, 1);
  assert.equal(patchCatalogQuery(original, { page: 5 }).page, 5);
});

test('filter search appears for large or paged lists and never for boolean attributes', () => {
  assert.equal(catalogFilterNeedsSearch(8), false);
  assert.equal(catalogFilterNeedsSearch(9), true);
  assert.equal(catalogFilterNeedsSearch(3, { total: 40 }), true);
  assert.equal(catalogFilterNeedsSearch(2, { truncated: true }), true);
  assert.equal(catalogFilterNeedsSearch(2, { totalPages: 2 }), true);
  assert.equal(
    catalogFilterNeedsSearch(2, { dataType: 'bool', total: 40, truncated: true, totalPages: 2 }),
    false,
  );
});
