import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyProductFilters,
  productsPath,
  readProductsPage,
  productLookupPath,
  readProductLookup,
  readProductDetail,
  toggleProductSelection,
} from './products-contract.ts';
const summary = (id = 'p1') => ({
  id,
  slug: 'phone',
  nameFa: 'گوشی',
  nameEn: 'Phone',
  categoryId: 'c1',
  brandId: 'b1',
  status: 'Draft',
  featured: false,
  variantCount: 1,
});
const detail = () => ({
  schemaVersion: 1,
  product: {
    id: 'p1',
    version: 'AAAAAAAAAAA=',
    slug: 'phone',
    categoryId: 'c1',
    brandId: 'b1',
    status: 'Draft',
    isDigital: false,
    featured: false,
    translations: [{ locale: 'fa', name: 'گوشی', description: 'شرح', badge: null }],
    attributes: [{ attributeId: 'a1', valueBool: false, selections: [{ optionId: 'o1' }] }],
    variants: [
      {
        id: 'v1',
        version: 'AAAAAAAAAAA=',
        sku: 'SKU',
        priceRial: '9223372036854775807',
        compareAtPriceRial: null,
        color: '#fff',
        colorNameFa: '',
        colorNameEn: '',
        labelFa: '',
        labelEn: '',
        warrantyFa: '',
        warrantyEn: '',
        isActive: false,
        attributes: [{ attributeId: 'a2', valueNumber: 0, selections: [] }],
        purchaseMethods: [{ methodId: 'online' }],
      },
    ],
    media: [{ url: '/products/phone-silver.svg', sortOrder: 0 }],
    purchaseMethods: [{ methodId: 'online' }],
    creditPlans: [{ planId: 'plan' }],
  },
});
test('paged products reject private graph, duplicates, wrong filters and truncated cursor pages', () => {
  const page = { schemaVersion: 1, pageSize: 50, items: [summary()], nextCursor: null };
  assert.equal(readProductsPage(page, emptyProductFilters).items.length, 1);
  for (const patch of [
    { items: [summary(), summary('P1')] },
    { items: [{ ...summary(), variants: [] }] },
    { nextCursor: 'cursor' },
    { items: Array.from({ length: 51 }, (_, i) => summary('p' + i)) },
  ])
    assert.throws(() => readProductsPage({ ...page, ...patch }, emptyProductFilters));
  assert.throws(() => readProductsPage(page, { ...emptyProductFilters, status: 'Published' }));
  assert.throws(() => readProductsPage(page, { ...emptyProductFilters, categoryId: 'c2' }));
});
test('filter URLs and selected lookups are bounded and never mix unrelated ids', () => {
  const url = new URL(
    'https://qa.example' +
      productsPath({ ...emptyProductFilters, query: 'کیبورد ۱۲', brandId: 'b1' }, 'opaque'),
  );
  assert.equal(url.searchParams.get('query'), 'کیبورد ۱۲');
  assert.equal(url.searchParams.get('cursor'), 'opaque');
  assert.match(
    productLookupPath(['p1', 'p2']),
    /^\/admin\/catalog\/product-lookup\?ids=p1&ids=p2$/,
  );
  assert.throws(() => productLookupPath(['p1', 'P1']));
  assert.throws(() => productLookupPath(Array.from({ length: 25 }, (_, i) => 'p' + i)));
  assert.throws(() => readProductLookup([summary('other')], ['p1']));
  assert.deepEqual(readProductLookup([], ['missing']), []);
});
test('detail preserves full editable relations, inactive variants, bigint money, false and zero', () => {
  const product = readProductDetail(detail(), 'p1');
  assert.equal(product.variants[0].priceRial, '9223372036854775807');
  assert.equal(BigInt(product.variants[0].priceRial), 9223372036854775807n);
  assert.equal(product.variants[0].isActive, false);
  assert.equal(product.attributes[0].valueBool, false);
  assert.equal(product.variants[0].attributes[0].valueNumber, 0);
  assert.equal(product.attributes[0].selections.length, 1);
  assert.equal(product.purchaseMethods[0].methodId, 'online');
  assert.equal(product.creditPlans[0].planId, 'plan');
});
test('invalid detail money, identity, version and unexpected private fields prevent editing', () => {
  assert.throws(() => readProductDetail(detail(), 'other'));
  for (const patch of [
    { priceRial: Number('9223372036854775807') },
    { priceRial: '9223372036854775808' },
    { priceRial: 'bad' },
    { version: 'bad' },
  ]) {
    const value = detail();
    Object.assign(value.product.variants[0], patch);
    assert.throws(() => readProductDetail(value, 'p1'));
  }
  const value = detail();
  Object.assign(value.product, { privateCustomer: {} });
  assert.throws(() => readProductDetail(value, 'p1'));
});
test('missing translation becomes an editable empty locale without mutating the source', () => {
  const raw = detail();
  const product = readProductDetail(raw, 'P1');
  assert.equal(product.translations.length, 2);
  assert.equal(product.translations[1].locale, 'en');
  assert.equal(product.translations[1].name, '');
  assert.equal(raw.product.translations.length, 1);
});
test('cross-page selection preserves missing ids, order and the 24-product limit', () => {
  const selected = ['missing', 'p1'];
  const next = toggleProductSelection(selected, 'p2');
  assert.deepEqual(next, ['missing', 'p1', 'p2']);
  assert.deepEqual(selected, ['missing', 'p1']);
  assert.deepEqual(toggleProductSelection(next, 'P1'), ['missing', 'p2']);
  const full = Array.from({ length: 24 }, (_, i) => 'p' + i);
  assert.deepEqual(toggleProductSelection(full, 'other'), full);
});
