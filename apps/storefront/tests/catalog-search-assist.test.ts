import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogInputSchema, catalogSearchPageSchema } from '../lib/catalog/catalog-contract.ts';
import {
  catalogSearchCandidate,
  verifiedCatalogSuggestion,
} from '../lib/catalog/catalog-search-assist.ts';

test('catalog correction normalizes known spelling variants without changing arbitrary terms or SKUs', () => {
  assert.equal(catalogSearchCandidate('اي فون ۱۵'), 'iphone 15');
  assert.equal(catalogSearchCandidate('آیفون۱۵'), 'iphone 15');
  assert.equal(catalogSearchCandidate('گالکسی A۵۶'), 'galaxy a56');
  assert.equal(catalogSearchCandidate('IPHNOE 15'), 'iphone 15');
  assert.equal(catalogSearchCandidate('PS5'), undefined);
  assert.equal(catalogSearchCandidate('D70-DEMO-A10-BLUE'), undefined);
  assert.equal(catalogSearchCandidate('سایرایفون x'), undefined);
  assert.equal(catalogSearchCandidate('ایفون۱ یک دو سه چهار پنج شش هفت'), undefined);
});

test('catalog correction probes once on the first empty page and keeps every filter', async () => {
  const query = catalogInputSchema.parse({
    query: 'ای فون ۱۵',
    categoryId: 'phones',
    brandIds: ['apple'],
    attributes: [{ key: 'storage', values: ['256'] }],
    availableOnly: true,
    minPriceRial: '60000000',
    sort: 'price-asc',
    pageSize: 4,
  });
  const reads: unknown[] = [];
  const read = async (alternate: typeof query) => {
    reads.push(alternate);
    return { total: 1 };
  };
  assert.deepEqual(await verifiedCatalogSuggestion(query, { total: 0 }, read), {
    query: 'iphone 15',
    total: 1,
  });
  assert.deepEqual(reads, [{ ...query, query: 'iphone 15', pageSize: 1 }]);
  assert.equal(await verifiedCatalogSuggestion(query, { total: 1 }, read), undefined);
  assert.equal(
    await verifiedCatalogSuggestion({ ...query, page: 2 }, { total: 0 }, read),
    undefined,
  );
  assert.equal(
    await verifiedCatalogSuggestion({ ...query, query: 'unknown' }, { total: 0 }, read),
    undefined,
  );
  assert.equal(reads.length, 1);
  assert.equal(
    await verifiedCatalogSuggestion(query, { total: 0 }, async () => ({ total: 0 })),
    undefined,
  );
});

test('gateway suggestion schema accepts a positive alternate only for an empty first page', () => {
  const page = {
    version: 1,
    locale: 'fa',
    products: [],
    matchingVariantIds: {},
    total: 0,
    page: 1,
    pageSize: 4,
    totalPages: 0,
    suggestion: { query: 'iphone 15', total: 1 },
  };
  assert.equal(catalogSearchPageSchema.safeParse(page).success, true);
  assert.equal(catalogSearchPageSchema.safeParse({ ...page, page: 2 }).success, false);
  assert.equal(
    catalogSearchPageSchema.safeParse({ ...page, total: 1, totalPages: 1 }).success,
    false,
  );
  assert.equal(
    catalogSearchPageSchema.safeParse({ ...page, suggestion: { query: 'iphone', total: 0 } })
      .success,
    false,
  );
});
