import test from 'node:test';
import assert from 'node:assert/strict';
import {
  purchasePagePath,
  emptyPurchaseFilters,
  readMethodsPage,
  readPlansPage,
  readMethodDetail,
  readPlanDetail,
  purchaseSummarySchema,
  methodInputSchema,
  planInputSchema,
} from '../src/api/contracts/finance/finance-contract.ts';
const method = {
  id: 'one',
  nameFa: 'روش نمونه',
  nameEn: 'Sample',
  kind: 'online',
  enabled: false,
  requiresApproval: false,
  categoryCount: 1,
};
const plan = {
  id: 'one',
  nameFa: 'طرح نمونه',
  nameEn: 'Plan',
  enabled: false,
  months: 6,
  intervalMonths: 2,
  markupBasisPoints: 1500,
  downPaymentBasisPoints: 1000,
  roundingUnitRial: 10,
  categoryCount: 1,
};
const page = (row: unknown) => ({ schemaVersion: 1, pageSize: 50, items: [row], nextCursor: null });
const methodDetail = {
  schemaVersion: 1,
  method: {
    ...(({ categoryCount: _, ...v }) => v)(method),
    descriptionFa: '',
    descriptionEn: '',
    minAmountRial: '9007199254740993',
    maxAmountRial: null,
    categoryIds: ['missing-category'],
    version: 'AAAAAAAAAAE=',
  },
};
const planDetail = {
  schemaVersion: 1,
  plan: {
    ...(({ categoryCount: _, ...v }) => v)(plan),
    minAmountRial: null,
    maxAmountRial: '9223372036854775807',
    categoryIds: ['missing-category'],
    version: 'AAAAAAAAAAE=',
  },
};
test('purchase URLs encode bounded filters and preserve the resource scope', () => {
  const path = purchasePagePath(
    'method',
    {
      ...emptyPurchaseFilters,
      query: 'عنوان & نام',
      kind: 'cheque',
      enabled: 'false',
      categoryId: 'cat',
    },
    'abc_-',
  );
  const q = new URL('http://test' + path).searchParams;
  assert.equal(q.get('query'), 'عنوان & نام');
  assert.equal(q.get('kind'), 'cheque');
  assert.equal(q.get('categoryId'), 'cat');
  assert.equal(q.get('cursor'), 'abc_-');
  assert.equal(
    new URL('http://test' + purchasePagePath('plan', emptyPurchaseFilters, null)).searchParams.has(
      'kind',
    ),
    false,
  );
  for (const f of [
    { ...emptyPurchaseFilters, query: 'a b c d e f g h i' },
    { ...emptyPurchaseFilters, enabled: 'yes' },
    { ...emptyPurchaseFilters, categoryId: 'bad!' },
  ])
    assert.throws(() => purchasePagePath('method', f as typeof emptyPurchaseFilters, null));
  assert.throws(() => purchasePagePath('plan', { ...emptyPurchaseFilters, kind: 'online' }, null));
});
test('purchase list schemas reject private details, duplicates, partial cursors and contradictory filter state', () => {
  assert.equal(readMethodsPage(page(method), emptyPurchaseFilters).items.length, 1);
  assert.equal(readPlansPage(page(plan), emptyPurchaseFilters).items.length, 1);
  for (const value of [
    page({ ...method, minAmountRial: '1' }),
    { ...page(method), items: [method, method] },
    { ...page(method), nextCursor: 'abc' },
    { ...page(method), nextCursor: undefined },
  ])
    assert.throws(() => readMethodsPage(value, emptyPurchaseFilters));
  assert.throws(() => readMethodsPage(page(method), { ...emptyPurchaseFilters, enabled: 'true' }));
  assert.throws(() => readMethodsPage(page(method), { ...emptyPurchaseFilters, kind: 'cheque' }));
  assert.throws(() => readPlansPage(page(plan), { ...emptyPurchaseFilters, enabled: 'true' }));
  for (const p of [
    { ...plan, intervalMonths: 4 },
    { ...plan, roundingUnitRial: 2 },
    { ...plan, markupBasisPoints: 100001 },
  ])
    assert.throws(() => readPlansPage(page(p), emptyPurchaseFilters));
});
test('detail schemas keep unknown selected categories and exact rial strings, and require the requested versioned resource', () => {
  const m = readMethodDetail(methodDetail, 'one');
  assert.equal(m.minAmountRial, '9007199254740993');
  assert.equal(m.maxAmountRial, undefined);
  assert.deepEqual(m.categories, [{ categoryId: 'missing-category' }]);
  assert.equal(readPlanDetail(planDetail, 'one').maxAmountRial, '9223372036854775807');
  assert.throws(() => readMethodDetail(methodDetail, 'other'));
  assert.throws(() => readPlanDetail(planDetail, 'other'));
  for (const bad of [
    { ...methodDetail.method, minAmountRial: 1 },
    { ...methodDetail.method, version: null },
    { ...methodDetail.method, categoryIds: Array.from({ length: 501 }, (_, i) => 'cat' + i) },
    { ...methodDetail.method, categoryIds: ['ONE', 'one'] },
    { ...methodDetail.method, minAmountRial: '10', maxAmountRial: '1' },
  ])
    assert.throws(() => readMethodDetail({ schemaVersion: 1, method: bad }, 'one'));
});
test('purchase summary counts remain decimal strings and impossible snapshots are rejected', () => {
  const summary = {
    schemaVersion: 1,
    methods: '9223372036854775807',
    enabledMethods: '9007199254740993',
    plans: '101',
    enabledPlans: '50',
  };
  assert.equal(purchaseSummarySchema.parse(summary).enabledMethods, '9007199254740993');
  assert.throws(() => purchaseSummarySchema.parse({ ...summary, plans: 101 }));
  assert.throws(() => purchaseSummarySchema.parse({ ...summary, enabledPlans: '102' }));
});
test('form validation normalizes Persian integers but never converts rial to a JavaScript number', () => {
  const m = methodInputSchema.parse({
    kind: 'online',
    nameFa: ' روش ',
    nameEn: ' Method ',
    descriptionFa: '',
    descriptionEn: '',
    enabled: false,
    requiresApproval: false,
    minAmountRial: '۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۳',
    maxAmountRial: '۹۲۲۳۳۷۲۰۳۶۸۵۴۷۷۵۸۰۷',
    categoryIds: [],
    version: null,
  });
  assert.equal(m.minAmountRial, '9007199254740993');
  assert.equal(m.maxAmountRial, '9223372036854775807');
  assert.equal(
    methodInputSchema.safeParse({ ...m, minAmountRial: '9223372036854775808' }).success,
    false,
  );
  assert.equal(methodInputSchema.safeParse({ ...m, minAmountRial: '001' }).success, false);
  const draft = {
    nameFa: 'طرح',
    nameEn: 'Plan',
    months: '۶',
    intervalMonths: '۲',
    markupBasisPoints: '۱۵۰۰',
    downPaymentBasisPoints: '۱۰۰۰',
    roundingUnitRial: '۱۰',
    enabled: false,
    minAmountRial: '',
    maxAmountRial: '',
    categoryIds: [],
    version: null,
  };
  const p = planInputSchema.parse(draft);
  assert.equal(p.months, 6);
  assert.equal(p.minAmountRial, null);
  for (const v of [
    { ...draft, intervalMonths: '4' },
    { ...draft, months: '' },
    { ...draft, markupBasisPoints: '' },
    { ...draft, downPaymentBasisPoints: '10001' },
  ])
    assert.equal(planInputSchema.safeParse(v).success, false);
});
