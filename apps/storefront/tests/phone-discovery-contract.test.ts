import test from 'node:test';
import assert from 'node:assert/strict';
import {
  phoneSearchSchema,
  matchingPhoneChoices,
  phoneQueryFromParams,
  phoneQueryParams,
  phoneHref,
  phonePageSchema,
  phoneItemSchema,
  phoneChoiceSchema,
  phoneConfigurationSnapshotSchema,
  phoneInterestPageSchema,
  phoneInterestInputSchema,
  phoneInterestResultSchema,
} from '@sayman/web-shared/lib/market/phone-discovery-contract.ts';
import {
  phoneTestPage as page,
  phoneTestItem as item,
  phoneTestChoice as choice,
  phoneTestSnapshot as snapshot,
  phoneTestInterest as interest,
  phoneTestResult as result,
} from './phone-discovery.test-fixtures.ts';

test('filtered cards retain only real matching memory and colour combinations', () => {
  const choices = [
    { ...choice, ramGb: 12, storageGb: 256, colorKey: 'silver-shadow' },
    { ...choice, ramGb: 12, storageGb: 512, colorKey: 'silver-shadow' },
    { ...choice, ramGb: 16, storageGb: 1024, colorKey: 'blue-shadow' },
    { ...choice, ramGb: 16, storageGb: 1024, colorKey: 'jetblack' },
  ];
  const filtered = matchingPhoneChoices(choices, { ramGb: 16 });
  assert.deepEqual([...new Set(filtered.map((c) => c.storageGb))], [1024]);
  assert.deepEqual(
    filtered.map((c) => c.colorKey),
    ['blue-shadow', 'jetblack'],
  );
  assert.deepEqual(matchingPhoneChoices(choices, { ramGb: 16, storageGb: 256 }), []);
  assert.deepEqual(matchingPhoneChoices(choices, { ramGb: 16, colorKey: 'silver-shadow' }), []);
  assert.equal(matchingPhoneChoices(choices, {}).length, 4);
});

test('phone queries normalize Persian/Arabic numbers and preserve bounded page state in shareable URLs', () => {
  const query = phoneQueryFromParams(
    new URLSearchParams('q=Galaxy+A56&brand=samsung&ram=۸&storage=٢٥٦&color=black&page=۲&size=۲۴'),
  );
  assert.deepEqual(query, {
    query: 'Galaxy A56',
    brandId: 'samsung',
    ramGb: 8,
    storageGb: 256,
    colorKey: 'black',
    page: 2,
    pageSize: 24,
  });
  assert.deepEqual(phoneQueryFromParams(phoneQueryParams(query)), query);
  assert.equal(
    phoneHref(query),
    '/market?q=Galaxy+A56&brand=samsung&ram=8&storage=256&color=black&page=2&size=24',
  );
  assert.equal(phoneHref(phoneSearchSchema.parse({})), '/market');
  for (const raw of [
    'page=0',
    'page=-1',
    'page=01',
    'page=10001',
    'size=25',
    'size=0',
    'ram=129',
    'storage=32769',
    'ram=8.0',
    'ram=8e0',
    'ram=+8',
    'q=x&q=y',
    'ram=8&ram=8',
    'category=phones',
    'stock=1',
    'color=Black',
    'page=',
    'q=' + 'x'.repeat(2049),
  ])
    assert.throws(() => phoneQueryFromParams(new URLSearchParams(raw)), raw);
});

test('phone search excludes price/stock/source authority, control characters and overlong queries', () => {
  for (const extra of [
    { priceRial: '1' },
    { referencePriceRial: '1' },
    { sourceUrl: 'https://source.example' },
    { sourceName: 'Source' },
    { stock: 1 },
    { sellerId: 'seller' },
    { categoryId: 'laptops' },
  ])
    assert.equal(phoneSearchSchema.safeParse(extra).success, false);
  for (const query of [
    'x'.repeat(121),
    'one two three four five six seven eight nine',
    'phone\nprivate',
    'phone\u0000private',
  ])
    assert.equal(phoneSearchSchema.safeParse({ query }).success, false);
  assert.equal(
    phoneSearchSchema.safeParse({ query: '   Galaxy A56   ', page: 10000, pageSize: 24 }).success,
    true,
  );
});

test('public phone contracts expose choices without source, reference prices or inferred stock', () => {
  assert.equal(phonePageSchema.safeParse(page).success, true);
  for (const extra of [
    { referencePriceRial: '1' },
    { referencePriceCurrent: true },
    { sourceName: 'Private source' },
    { sourceUrl: 'https://source.example' },
    { stock: 100 },
  ])
    assert.equal(phoneItemSchema.safeParse({ ...item, ...extra }).success, false);
  for (const extra of [
    { priceRial: '1' },
    { stock: 1 },
    { sourceName: 'source' },
    { enabled: true },
  ])
    assert.equal(phoneChoiceSchema.safeParse({ ...choice, ...extra }).success, false);
  assert.equal(phoneChoiceSchema.safeParse({ ...choice, availableInStore: true }).success, false);
  assert.equal(
    phoneChoiceSchema.safeParse({
      ...choice,
      availableInStore: true,
      variantId: 'sku',
      storeSlug: 'phone',
      canRequest: false,
    }).success,
    true,
  );
  assert.equal(
    phoneChoiceSchema.safeParse({
      ...choice,
      availableInStore: true,
      variantId: 'sku',
      storeSlug: 'phone',
      canRequest: true,
    }).success,
    false,
  );
  assert.equal(
    phoneItemSchema.safeParse({ ...item, configurations: [choice, choice] }).success,
    false,
  );
  for (const imageUrl of [
    'http://source.example/image.jpg',
    'https://user:pass@source.example/image.jpg',
    'https://source.example/image.jpg?token=secret',
    '/media/catalog/' + 'a'.repeat(32) + '/private.webp',
  ])
    assert.equal(phoneChoiceSchema.safeParse({ ...choice, imageUrl }).success, false);
});

test('phone pages bind pagination math, unique rows, facet limits and strict nested contracts', () => {
  for (const value of [
    { ...page, totalPages: 2 },
    { ...page, total: 0 },
    { ...page, pageSize: 25 },
    { ...page, items: [item, item] },
    { ...page, facets: { ...page.facets, privateSource: 'secret' } },
    { ...page, items: [{ ...item, model: { ...item.model, stock: 1 } }] },
  ])
    assert.equal(phonePageSchema.safeParse(value).success, false);
  assert.equal(
    phonePageSchema.safeParse({ ...page, items: [], total: 0, totalPages: 0 }).success,
    true,
  );
  assert.equal(phonePageSchema.safeParse({ ...page, items: [], total: 1, page: 2 }).success, true);
});

test('phone specifications require bounded localized label/value rows rather than rendering attribute keys', () => {
  assert.equal(phoneItemSchema.safeParse(item).success, true);
  const { specifications, ...without } = item;
  assert.equal(phoneItemSchema.safeParse(without).success, false);
  for (const value of [
    { ...item, specifications: Array(65).fill(specifications[0]) },
    { ...item, specifications: [{ ...specifications[0], label: '' }] },
    { ...item, specifications: [{ ...specifications[0], source: 'private' }] },
    { ...item, specifications: [{ ...specifications[0], priceRial: '1' }] },
  ])
    assert.equal(phoneItemSchema.safeParse(value).success, false);
  assert.equal(phoneItemSchema.safeParse({ ...item, specifications: [] }).success, true);
});

test('interest contracts cap pages at fifty and preserve immutable typed selection without payment fields', () => {
  assert.equal(phoneConfigurationSnapshotSchema.safeParse(snapshot).success, true);
  assert.equal(
    phoneInterestPageSchema.safeParse({
      schemaVersion: 1,
      items: Array.from({ length: 50 }, (_, i) => ({
        ...interest,
        id: (i + 1).toString(16).padStart(32, '0'),
      })),
      nextCursor: null,
    }).success,
    true,
  );
  assert.equal(
    phoneInterestPageSchema.safeParse({
      schemaVersion: 1,
      items: Array(51).fill(interest),
      nextCursor: null,
    }).success,
    false,
  );
  assert.equal(
    phoneInterestInputSchema.safeParse({ configurationId: choice.id, active: true, version: null })
      .success,
    true,
  );
  for (const extra of [
    { owner: 'a'.repeat(32) },
    { userId: 'a'.repeat(32) },
    { canPay: true },
    { priceRial: '1' },
    { notifyBySms: true },
  ])
    assert.equal(
      phoneInterestInputSchema.safeParse({
        configurationId: choice.id,
        active: true,
        version: null,
        ...extra,
      }).success,
      false,
    );
  for (const value of [
    { ...result, canPay: true },
    { ...result, privateOwner: 'a'.repeat(32) },
    { ...result, interest: { ...interest, changedAt: '2026-10-27T12:00:00Z' } },
    { ...result, interest: { ...interest, configuration: { ...snapshot, priceRial: '1' } } },
  ])
    assert.equal(phoneInterestResultSchema.safeParse(value).success, false);
});
