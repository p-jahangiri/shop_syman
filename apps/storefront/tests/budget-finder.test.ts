import assert from 'node:assert/strict';
import test from 'node:test';
import { storefrontSnapshot } from '../lib/data/fixtures.ts';
import {
  budgetCatalogQuery,
  budgetComparison,
  budgetHref,
  budgetMatches,
  budgetRequest,
  type BudgetSelection,
} from '../lib/catalog/budget-finder.ts';
import type { CatalogPage } from '../lib/catalog/catalog-contract.ts';

const { categories, products } = storefrontSnapshot;
const category = categories[0].key;
test('budget input accepts local digits and keeps the rial exact through the catalog and round trip', () => {
  const result = budgetRequest(
    { category, condition: 'new', budget: '۹۰٬۰۷۱٬۹۹۲٬۵۴۷٬۴۰۹٫۳' },
    categories,
    true,
  );
  assert.equal(result.kind, 'ready');
  assert.equal(result.kind === 'ready' && result.maxPriceRial, '900719925474093');
  if (result.kind !== 'ready') throw Error('Expected a valid budget');
  assert.deepEqual(budgetCatalogQuery(result), {
    categoryId: category,
    condition: 'new',
    availableOnly: true,
    maxPriceRial: '900719925474093',
    sort: 'price-asc',
    page: 1,
    pageSize: 8,
  });
  const url = new URL(budgetHref(result, '9007199254740993'), 'https://shop.example');
  const roundTrip = budgetRequest(Object.fromEntries(url.searchParams), categories, true);
  assert.equal(roundTrip.kind === 'ready' && roundTrip.maxPriceRial, '9007199254740993');
  assert.equal(budgetCatalogQuery(result, true).maxPriceRial, undefined);
  assert.equal(budgetCatalogQuery(result, true).availableOnly, true);
  const zero = budgetRequest({ budget: '٠' }, categories, true);
  assert.equal(zero.kind === 'ready' && zero.maxPriceRial, '0');
});
test('malformed budgets and hidden used filters never fall through to a broader search', () => {
  for (const budget of [['5', '100'], '-10', '1e3', '922337203685477580.8', 'x', '1'.repeat(33)]) {
    assert.equal(budgetRequest({ budget }, categories, true).kind, 'invalid');
  }
  const disabled = budgetRequest({ budget: '200', condition: 'used' }, categories, false);
  assert.equal(disabled.kind === 'invalid' && disabled.error, 'condition');
  const hidden = budgetRequest({ budget: '200', category: 'not-a-category' }, categories, true);
  assert.equal(hidden.kind === 'invalid' && hidden.error, 'category');
  assert.equal(budgetRequest({}, categories, true).kind, 'initial');
});
test('only the exact in-stock matched variant is presented and compared', () => {
  const models = products.slice(0, 5).map<CatalogPage['products'][number]>((product, i) => ({
    ...product,
    category,
    variants: [
      {
        ...product.variants[0],
        id: 'unmatched-' + i,
        stock: 12,
        priceRial: '100',
        usedCondition: undefined,
      },
      {
        ...product.variants[0],
        id: 'matched-' + i,
        stock: i === 2 ? 0 : 1,
        priceRial: i === 3 ? '1200' : '1000',
        usedCondition: undefined,
      },
    ],
  }));
  models[4].category = 'another-category';
  const page: CatalogPage = {
    version: 1,
    locale: 'fa',
    products: models,
    matchingVariantIds: Object.fromEntries(models.map((p, i) => [p.id, 'matched-' + i])),
    page: 1,
    pageSize: 8,
    total: 5,
    totalPages: 1,
  };
  const selection: BudgetSelection = {
    category: '',
    condition: 'new',
    amount: '100',
    maxPriceRial: '1000',
  };
  const matches = budgetMatches(page, selection);
  assert.deepEqual(
    matches.map((m) => m.variant.id),
    ['matched-0', 'matched-1', 'matched-4'],
  );
  const compare = new URL(budgetComparison(matches)!, 'https://shop.example');
  assert.deepEqual(compare.searchParams.getAll('id'), [models[0].id, models[1].id]);
  assert.deepEqual(compare.searchParams.getAll('variant'), ['matched-0', 'matched-1']);
  assert.deepEqual(
    budgetMatches(page, selection, true).map((m) => m.variant.id),
    ['matched-3'],
  );
  assert.deepEqual(budgetMatches(page, { ...selection, condition: 'used' }), []);
});
