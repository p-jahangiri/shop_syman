import assert from 'node:assert/strict';
import test from 'node:test';
import {
  initialWorkspaceFilters,
  readWorkspaceProducts,
  workspaceFiltersSchema,
  workspaceProductsPath,
} from '../src/api/contracts/catalog/product-workspace-contract.ts';

test('workspace sends one bounded list per selected column and omits empty lists', () => {
  const query = (filters: typeof initialWorkspaceFilters) =>
    new URL(workspaceProductsPath(filters), 'http://localhost').searchParams;
  const params = query({
    ...initialWorkspaceFilters,
    categoryIds: ['c1', 'c2'],
    brandIds: ['b1', 'b2'],
    statuses: ['Published', 'archived'],
  });
  assert.deepEqual(params.getAll('categoryIds'), ['c1,c2']);
  assert.deepEqual(params.getAll('brandIds'), ['b1,b2']);
  assert.deepEqual(params.getAll('statuses'), ['Published,archived']);
  assert.equal(query(initialWorkspaceFilters).has('statuses'), false);
  assert.equal(query({ ...initialWorkspaceFilters, status: 'Hidden' }).get('status'), 'Hidden');
  assert.equal(
    workspaceFiltersSchema.safeParse({ ...initialWorkspaceFilters, brandIds: ['b1', 'B1'] })
      .success,
    false,
  );
  assert.equal(
    workspaceFiltersSchema.safeParse({
      ...initialWorkspaceFilters,
      categoryIds: Array.from({ length: 33 }, (_, i) => String(i)),
    }).success,
    false,
  );
});

test('workspace response accepts the selected union without conflating archived and hidden rows', () => {
  const product = {
    id: 'p1',
    version: 'AAAAAAAAAAE=',
    slug: 'demo',
    nameFa: 'نمونه',
    nameEn: 'Demo',
    categoryId: 'c1',
    categoryName: 'دسته',
    brandId: 'b1',
    brandName: 'نمونه',
    status: 'Hidden',
    archived: true,
    featured: false,
    isDigital: false,
    variantCount: 1,
    activeVariantCount: 1,
    minPriceRial: '9007199254740993',
    maxPriceRial: '9007199254740993',
    availableQuantity: '0',
    imageUrl: null,
    updatedAt: '2026-11-03T08:00:00.000Z',
  };
  const published = {
    ...product,
    id: 'p2',
    categoryId: 'c2',
    brandId: 'b2',
    status: 'Published',
    archived: false,
  };
  const response = {
    schemaVersion: 1,
    page: 0,
    pageSize: 25,
    totalCount: '2',
    items: [product, published],
  };
  const filters = {
    ...initialWorkspaceFilters,
    categoryId: 'legacy-c',
    brandId: 'legacy-b',
    status: 'Draft' as const,
    categoryIds: ['c1', 'c2'],
    brandIds: ['b1', 'b2'],
    statuses: ['Published', 'archived'] as ('Published' | 'archived')[],
  };
  assert.equal(readWorkspaceProducts(response, filters).totalCount, '2');
  assert.throws(() =>
    readWorkspaceProducts(response, { ...filters, statuses: ['Published', 'Hidden'] }),
  );
  assert.throws(() => readWorkspaceProducts(response, { ...filters, categoryIds: ['c2'] }));
  assert.throws(() => readWorkspaceProducts(response, { ...filters, brandIds: ['b1'] }));
  assert.throws(() => readWorkspaceProducts(response, initialWorkspaceFilters));
});
