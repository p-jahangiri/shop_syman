import assert from 'node:assert/strict';
import test from 'node:test';
import { quoteInputSchema, quoteSnapshotSchema, quoteExpired } from './quote-contract.ts';
import { requestQuote } from './quote-client.ts';
import { CartError } from './cart-client.ts';
const method = {
  id: 'cash',
  kind: 'online',
  name: 'Cash',
  description: '',
  enabled: true,
  requiresApproval: false,
  categoryIds: [],
  minAmountRial: null,
  maxAmountRial: null,
};
function snapshot() {
  return {
    schemaVersion: 1,
    locale: 'en',
    quoteId: null,
    cartVersion: 'AAAAAAAAAAE=',
    pricingFingerprint: 'A'.repeat(64),
    createdAt: '2026-10-22T12:00:00+00:00',
    expiresAt: null,
    lines: [
      {
        variantId: 'v',
        productId: 'p',
        sellerId: 'store',
        categoryId: 'c',
        sku: 'SKU',
        name: 'Product',
        label: 'Variant',
        warranty: 'Warranty',
        isDigital: false,
        quantity: 2,
        unitPriceRial: '9007199254740993',
        lineTotalRial: '18014398509481986',
      },
    ],
    itemsSubtotalRial: '18014398509481986',
    markupRial: '0',
    downPaymentRial: '0',
    goodsTotalRial: '18014398509481986',
    shippingRequired: true,
    shippingRial: null,
    taxRial: null,
    payableTotalRial: null,
    methods: [method],
    plans: [],
    selectedMethod: null,
    selectedPlan: null,
    installments: [],
    requiresApproval: false,
    canPlaceOrder: false,
    blockers: [
      'shipping_unconfigured',
      'tax_unconfigured',
      'checkout_not_ready',
      'method_required',
    ],
  };
}
test('quote keeps exact large rial values and unknown charges', () => {
  const q = quoteSnapshotSchema.parse(snapshot());
  assert.equal(q.itemsSubtotalRial, '18014398509481986');
  assert.equal(q.payableTotalRial, null);
  assert.equal(q.shippingRial, null);
  assert.equal(q.taxRial, null);
});
test('quote rejects forged totals, decimal/unsafe numeric money, duplicate lines and inconsistent delivery', () => {
  const q = snapshot();
  for (const patch of [
    { itemsSubtotalRial: '1' },
    { goodsTotalRial: Number('18014398509481986') },
    { markupRial: '0.1' },
    { lines: [q.lines[0], q.lines[0]] },
    { shippingRequired: false },
    { canPlaceOrder: true },
  ])
    assert.equal(quoteSnapshotSchema.safeParse({ ...q, ...patch }).success, false);
});
test('digital quote only uses zero shipping when no line needs physical delivery', () => {
  const q = snapshot();
  const digital = {
    ...q,
    lines: q.lines.map((l) => ({ ...l, isDigital: true })),
    shippingRequired: false,
    shippingRial: '0',
  };
  assert.equal(quoteSnapshotSchema.safeParse(digital).success, true);
  assert.equal(quoteSnapshotSchema.safeParse({ ...digital, shippingRial: null }).success, false);
});
test('saved cash quote requires method, fixed deadline and checks the final amount if supplied', () => {
  const q = {
    ...snapshot(),
    quoteId: 'a'.repeat(32),
    expiresAt: '2026-10-22T12:05:00Z',
    selectedMethod: method,
  };
  assert.equal(quoteSnapshotSchema.safeParse(q).success, true);
  assert.equal(
    quoteExpired(quoteSnapshotSchema.parse(q), Date.parse('2026-10-22T12:05:00Z')),
    true,
  );
  for (const patch of [
    { expiresAt: null },
    { expiresAt: q.createdAt },
    { selectedMethod: null },
    { payableTotalRial: q.goodsTotalRial },
    { selectedMethod: { ...method, id: 'other' } },
  ])
    assert.equal(quoteSnapshotSchema.safeParse({ ...q, ...patch }).success, false);
});
test('cheque quote preserves every rial, interval and positive installment', () => {
  const q = snapshot();
  const cheque = { ...method, id: 'cheque', kind: 'cheque', requiresApproval: true };
  const plan = {
    id: 'six',
    name: 'Six months',
    months: 6,
    markupBasisPoints: 1250,
    downPaymentBasisPoints: 2500,
    intervalMonths: 2,
    roundingUnitRial: 10,
    enabled: true,
    categoryIds: [],
    minAmountRial: null,
    maxAmountRial: null,
  };
  const value = {
    ...q,
    quoteId: 'b'.repeat(32),
    expiresAt: '2026-10-22T12:05:00Z',
    lines: [{ ...q.lines[0], quantity: 1, unitPriceRial: '100003', lineTotalRial: '100003' }],
    itemsSubtotalRial: '100003',
    markupRial: '9380',
    downPaymentRial: '25010',
    goodsTotalRial: '109383',
    methods: [cheque],
    plans: [plan],
    selectedMethod: cheque,
    selectedPlan: plan,
    requiresApproval: true,
    installments: [
      { sequence: 1, monthOffset: 2, amountRial: '28120' },
      { sequence: 2, monthOffset: 4, amountRial: '28120' },
      { sequence: 3, monthOffset: 6, amountRial: '28133' },
    ],
  };
  assert.equal(quoteSnapshotSchema.safeParse(value).success, true);
  for (const installments of [
    [],
    value.installments.map((x, i) => (i === 2 ? { ...x, amountRial: '28132' } : x)),
    value.installments.map((x, i) => (i === 0 ? { ...x, monthOffset: 1 } : x)),
    value.installments.map((x, i) => (i === 0 ? { ...x, amountRial: '0' } : x)),
  ])
    assert.equal(quoteSnapshotSchema.safeParse({ ...value, installments }).success, false);
});
test('quote input cannot inject prices, owners or save a method without an idempotency UUID', () => {
  const base = { cartVersion: 'AAAAAAAAAAE=', methodId: null, planId: null, requestId: null };
  assert.equal(quoteInputSchema.safeParse(base).success, true);
  for (const patch of [
    { unitPriceRial: '1' },
    { ownerId: 'other' },
    { methodId: 'cash' },
    { planId: 'p' },
    { cartVersion: 'bad' },
    { methodId: 'cash', requestId: '00000000-0000-0000-0000-000000000000' },
  ])
    assert.equal(quoteInputSchema.safeParse({ ...base, ...patch }).success, false);
});
test('quote transport rejects wrong cart/locale/method and does not fall back on service failures', async () => {
  const input = quoteInputSchema.parse({ cartVersion: 'AAAAAAAAAAE=' });
  await assert.rejects(
    requestQuote(
      async () => Response.json({ title: 'cart_version_conflict' }, { status: 409 }),
      'en',
      input,
    ),
    (e) => e instanceof CartError && e.status === 409,
  );
  for (const patch of [{ locale: 'fa' }, { cartVersion: 'AAAAAAAAAAI=' }, { itemsSubtotalRial: 1 }])
    await assert.rejects(
      requestQuote(async () => Response.json({ ...snapshot(), ...patch }), 'en', input),
    );
  const result = await requestQuote(
    async (path, init) => {
      assert.equal(path, '/api/cart/en/quote');
      assert.equal(init.method, 'POST');
      assert.deepEqual(JSON.parse(init.body as string), input);
      return Response.json(snapshot());
    },
    'en',
    input,
  );
  assert.equal(result.lines.length, 1);
});
function charged() {
  const old = snapshot();
  return {
    ...old,
    schemaVersion: 2,
    lines: [{ ...old.lines[0], quantity: 1, unitPriceRial: '10003', lineTotalRial: '10003' }],
    itemsSubtotalRial: '10003',
    goodsTotalRial: '10003',
    shippingRial: '1999',
    taxRial: '1110',
    payableTotalRial: '13112',
    chargeRules: {
      version: 'AAAAAAAAAAI=',
      shippingMode: 'flat',
      shippingName: 'Flat delivery',
      shippingDescription: 'Per order',
      shippingFeeRial: '1999',
      shippingFreeFromRial: null,
      shippingReason: 'flat',
      taxMode: 'exclusive',
      taxRateBasisPoints: 925,
      taxBase: 'goods_shipping',
      taxRounding: 'half_up',
      taxableBaseRial: '12002',
      taxIncluded: false,
    },
  };
}
test('schema two charges validate exact payable amounts even before a method snapshot is saved', () => {
  const q = charged();
  assert.equal(quoteSnapshotSchema.safeParse(q).success, true);
  for (const patch of [
    { payableTotalRial: '1' },
    { taxRial: '1111' },
    { chargeRules: null },
    { chargeRules: { ...q.chargeRules, taxableBaseRial: '10003' } },
    { chargeRules: { ...q.chargeRules, shippingReason: 'digital' } },
  ])
    assert.equal(quoteSnapshotSchema.safeParse({ ...q, ...patch }).success, false);
});
test('tax included in prices is a component and cannot be added to the payable amount twice', () => {
  const q = charged();
  const included = {
    ...q,
    taxRial: '6001',
    payableTotalRial: '12002',
    chargeRules: {
      ...q.chargeRules,
      taxMode: 'inclusive',
      taxRateBasisPoints: 10000,
      taxIncluded: true,
    },
  };
  assert.equal(quoteSnapshotSchema.safeParse(included).success, true);
  assert.equal(
    quoteSnapshotSchema.safeParse({ ...included, payableTotalRial: '18003' }).success,
    false,
  );
  assert.equal(
    quoteSnapshotSchema.safeParse({
      ...included,
      chargeRules: { ...included.chargeRules, taxIncluded: false },
    }).success,
    false,
  );
});
test('free delivery threshold changes the tax basis and preserves every rial', () => {
  const q = charged();
  const free = {
    ...q,
    shippingRial: '0',
    taxRial: '925',
    payableTotalRial: '10928',
    chargeRules: {
      ...q.chargeRules,
      shippingFreeFromRial: '10000',
      shippingReason: 'threshold',
      taxableBaseRial: '10003',
    },
  };
  assert.equal(quoteSnapshotSchema.safeParse(free).success, true);
  assert.equal(
    quoteSnapshotSchema.safeParse({
      ...free,
      chargeRules: { ...free.chargeRules, shippingFreeFromRial: '10004' },
    }).success,
    false,
  );
});
test('schema one replay remains accepted while ambiguous new mixed schemas are rejected', () => {
  assert.equal(quoteSnapshotSchema.safeParse(snapshot()).success, true);
  assert.equal(quoteSnapshotSchema.safeParse({ ...snapshot(), schemaVersion: 2 }).success, false);
  assert.equal(quoteSnapshotSchema.safeParse({ ...charged(), schemaVersion: 1 }).success, false);
});
test('schema three exposes temporary cash ordering separately from unavailable gateway payment', () => {
  const q = {
    ...charged(),
    schemaVersion: 3,
    quoteId: 'a'.repeat(32),
    selectedMethod: method,
    expiresAt: '2026-10-22T12:05:00Z',
    lines: charged().lines.map((l) => ({ ...l, priceVersion: 'AAAAAAAAAAM=' })),
    temporaryOrder: {
      canCreate: true,
      reservationMinutes: 15,
      requiresSignIn: true,
      blockers: [],
      settingsVersion: 'AAAAAAAAAAQ=',
    },
  };
  assert.equal(quoteSnapshotSchema.safeParse(q).success, true);
  for (const patch of [
    { temporaryOrder: null },
    { quoteId: null },
    { lines: q.lines.map((l) => ({ ...l, priceVersion: null })) },
    { temporaryOrder: { ...q.temporaryOrder, blockers: ['temporary_orders_disabled'] } },
    { temporaryOrder: { ...q.temporaryOrder, settingsVersion: null } },
    { requiresApproval: true },
    { selectedMethod: { ...method, enabled: false } },
    { selectedMethod: { ...method, requiresApproval: true } },
    { selectedMethod: { ...method, kind: 'cheque' } },
    { schemaVersion: 2 },
  ])
    assert.equal(quoteSnapshotSchema.safeParse({ ...q, ...patch }).success, false);
  assert.equal(
    quoteSnapshotSchema.safeParse({
      ...q,
      temporaryOrder: { ...q.temporaryOrder, canCreate: false, blockers: ['quote_expired'] },
    }).success,
    true,
  );
});
