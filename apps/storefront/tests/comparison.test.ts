import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseComparisonSelection,
  comparisonHref,
  comparisonColumns,
  comparisonRows,
} from '../lib/catalog/comparison.ts';
import type {
  Product,
  Category,
  AttributeDefinition,
} from '@sayman/web-shared/lib/shared/types.ts';
import { findVariant } from '@sayman/web-shared/lib/shared/commerce.ts';
import { addCartSelection } from '../lib/checkout/cart-addition.ts';
import { ordinaryCartProducts, type ServerCartV2 } from '../lib/checkout/cart-v2-contract.ts';
import { lookupReferencesProduct } from '../lib/catalog/catalog-contract.ts';
import {
  changeSavedComparison,
  hydrateSavedShop,
  parseSavedShop,
} from '../lib/wishlist/saved-shop.ts';
const product = (id: string): Product => ({
  id,
  slug: id,
  name: id,
  englishName: id,
  brand: 'Sample',
  category: 'phones',
  description: '',
  image: '/products/charger.svg',
  purchaseMethodIds: ['online'],
  attributes: { storage: '128 GB', battery: '100', hidden: 'secret', literal: '—' },
  variants: [
    {
      id: id + 'a',
      sku: id + 'a',
      label: '128GB',
      color: '#000',
      colorName: 'Black',
      priceRial: '9007199254740993',
      stock: 0,
      warranty: '',
      attributes: { storage: '256 GB' },
    },
    {
      id: id + 'b',
      sku: id + 'b',
      label: '256GB',
      color: '#fff',
      colorName: 'White',
      priceRial: '9223372036854775807',
      stock: 2,
      warranty: 'Sample',
      attributes: { storage: '512 GB', battery: '' },
    },
  ],
});
const category: Category = {
  key: 'phones',
  name: 'Phones',
  description: '',
  image: '',
  filters: [],
  attributeRules: [
    { key: 'storage', comparable: true, showInSpecs: true, variantAxis: true },
    { key: 'battery', comparable: true, showInSpecs: true, variantAxis: false },
    { key: 'hidden', comparable: false, showInSpecs: true, variantAxis: false },
    { key: 'literal', comparable: true, showInSpecs: true, variantAxis: false },
  ],
};
const definitions: AttributeDefinition[] = ['battery', 'hidden', 'storage', 'literal'].map(
  (key) => ({ key, name: key, dataType: 'text', comparable: true, filterable: false }),
);
test('comparison links preserve opaque identifiers, selected SKU order and empty explicit selection', () => {
  const ids = ['0001-A', 'مدل B'],
    variants = ['sku&1', ''];
  const href = comparisonHref(ids, variants),
    params = new URLSearchParams(href.split('?')[1]);
  assert.deepEqual(params.getAll('id'), ids);
  assert.deepEqual(params.getAll('variant'), variants);
  assert.deepEqual(
    parseComparisonSelection({
      view: 'shared',
      id: params.getAll('id'),
      variant: params.getAll('variant'),
    }),
    { valid: true, shared: true, ids, variants },
  );
  assert.deepEqual(parseComparisonSelection({ view: 'shared' }), {
    valid: true,
    shared: true,
    ids: [],
    variants: [],
  });
  assert.equal(parseComparisonSelection({}).valid, true);
});
test('untrusted selections reject duplicates, oversized arrays, mismatched SKU arrays and malformed identifiers', () => {
  for (const q of [
    { id: ['p', 'p'] },
    { id: ['1', '2', '3', '4', '5'] },
    { id: ' ' },
    { id: 'x'.repeat(65) },
    { id: 'x\ny' },
    { id: ['a', 'b'], variant: ['a'] },
    { variant: 'a' },
    { view: ['shared', 'shared'] },
    { view: 'private' },
    { id: 123 },
  ])
    assert.equal(parseComparisonSelection(q as never).valid, false);
  assert.throws(() => comparisonHref(['a', 'a']));
});
test('selected variant determines exact price, stock, warranty and attributes without Number coercion', () => {
  const p = product('p'),
    [column] = comparisonColumns([p], ['p'], { p: 'pa' });
  assert.equal(column.variant?.priceRial, '9007199254740993');
  assert.equal(column.variant?.stock, 0);
  assert.equal(column.variant?.warranty, '');
  assert.equal(comparisonRows([column], category, definitions, {})[0].values[0], '256 GB');
  assert.equal(comparisonColumns([p], ['p'], {})[0].variant?.id, 'pb');
});
test('missing explicit SKU is unavailable rather than silently replaced by a different purchasable SKU', () => {
  const columns = comparisonColumns([product('p')], ['p', 'missing'], { p: 'removed' });
  assert.equal(columns.length, 1);
  assert.equal(columns[0].variant, null);
  assert.equal(columns[0].requestedVariant, 'removed');
  assert.deepEqual(comparisonRows(columns, category, definitions, {}), []);
});
test('saved comparison keeps selected SKU after hydration and keeps a removed SKU unavailable', () => {
  const a = product('a');
  const saved = parseSavedShop({
    compare: ['a', 'b'],
    compareVariants: { a: 'ab', b: 'removed', c: 'c1' },
  });
  const hydrated = hydrateSavedShop(saved, [a, product('b')]);
  assert.deepEqual(hydrated.compareVariants, { a: 'ab', b: 'removed' });
  assert.deepEqual(
    comparisonColumns([a, product('b')], hydrated.compare, hydrated.compareVariants!).map(
      (c) => c.variant?.id,
    ),
    ['ab', undefined],
  );
  const removed = changeSavedComparison(hydrated, 'a', 'remove');
  const replaced = changeSavedComparison(removed, 'a', 'add', 'aa');
  assert.deepEqual(replaced, { compare: ['b', 'a'], compareVariants: { b: 'removed', a: 'aa' } });
  assert.deepEqual(changeSavedComparison(replaced, 'a', 'variant', 'ab').compareVariants, {
    b: 'removed',
    a: 'ab',
  });
  assert.deepEqual(parseSavedShop({ compare: ['a'] }).compare, ['a']);
  assert.equal(
    parseSavedShop({ compare: ['a'], compareVariants: { a: 'invalid&' } }).compareVariants,
    undefined,
  );
});
test('variant unknown values override product data; null and a literal dash remain different', () => {
  const a = product('a'),
    b = product('b');
  delete b.attributes.literal;
  const rows = comparisonRows(
    comparisonColumns([a, b], ['a', 'b'], { a: 'ab', b: 'ba' }),
    category,
    definitions,
    {},
  );
  const battery = rows.find((r) => r.key === 'battery')!;
  assert.deepEqual(battery.values, [null, '100']);
  assert(battery.different);
  const literal = rows.find((r) => r.key === 'literal')!;
  assert.deepEqual(literal.values, ['—', null]);
  assert(literal.different);
});
test('category comparability and configured order control rows even when a global definition differs', () => {
  const p = product('p');
  const rows = comparisonRows(
    comparisonColumns([p], ['p'], { p: 'pa' }),
    category,
    definitions.map((d) => ({ ...d, comparable: false })),
    { storage: 'حافظه' },
  );
  assert.deepEqual(
    rows.map((r) => r.key),
    ['storage', 'battery', 'literal'],
  );
  assert.equal(rows[0].label, 'حافظه');
  assert(!rows.some((r) => r.key === 'hidden'));
  assert(!rows[0].different);
});
test('explicit empty category rules expose no attributes; absent legacy rules fall back only to comparable definitions', () => {
  const c = comparisonColumns([product('p')], ['p'], {});
  assert.deepEqual(comparisonRows(c, { ...category, attributeRules: [] }, definitions, {}), []);
  assert.deepEqual(
    comparisonRows(
      c,
      { ...category, attributeRules: undefined },
      definitions.filter((d) => d.key === 'storage'),
      {},
    ).map((r) => r.key),
    ['storage'],
  );
});
test('comparison never silently mixes categories or invents a schema for an unknown attribute', () => {
  const p = product('p');
  assert.throws(() =>
    comparisonRows(
      comparisonColumns([{ ...p, category: 'laptops' }], ['p'], {}),
      category,
      definitions,
      {},
    ),
  );
  assert.deepEqual(
    comparisonRows(
      comparisonColumns([p], ['p'], {}),
      {
        ...category,
        attributeRules: [
          { key: 'hidden', comparable: true, showInSpecs: true, variantAxis: false },
        ],
      },
      [],
      {},
    ),
    [],
  );
});
test('cart hydration and server price/stock bind to the same variant despite canonical case differences', () => {
  const p = product('P');
  assert.equal(findVariant([p], 'pb')?.variant.id, 'Pb');
  const cart = {
    ordinaryLines: [{ variantId: 'pb', unitPriceRial: '9007199254740993', available: 1 }],
  } as ServerCartV2;
  const [current] = ordinaryCartProducts(cart, [p]);
  assert.equal(current.variants[1].priceRial, '9007199254740993');
  assert.equal(current.variants[1].stock, 1);
  assert.equal(current.variants[0].stock, p.variants[0].stock);
});
test('repeated add of a public uppercase SKU increments one normalized server line and preserves other selections', () => {
  const original = [
    { variantId: 'sku-a', quantity: 1 },
    { variantId: 'sku-b', quantity: 2 },
  ];
  const next = addCartSelection(original, 'SKU-A', 1);
  assert.deepEqual(next, [
    { variantId: 'sku-a', quantity: 2 },
    { variantId: 'sku-b', quantity: 2 },
  ]);
  assert.deepEqual(original, [
    { variantId: 'sku-a', quantity: 1 },
    { variantId: 'sku-b', quantity: 2 },
  ]);
  assert.equal(addCartSelection([], 'SKU-A', 1)[0].variantId, 'SKU-A');
});
test('BFF correlation accepts case-normalized catalogue IDs and still rejects unrelated products and changed slugs', () => {
  const p = product('P');
  assert(lookupReferencesProduct({ productIds: [], variantIds: ['pb'], slugs: [] }, p));
  assert(lookupReferencesProduct({ productIds: ['p'], variantIds: [], slugs: [] }, p));
  assert(
    !lookupReferencesProduct(
      { productIds: ['different'], variantIds: ['different'], slugs: ['p'] },
      p,
    ),
  );
  assert(lookupReferencesProduct({ productIds: [], variantIds: [], slugs: ['P'] }, p));
});
