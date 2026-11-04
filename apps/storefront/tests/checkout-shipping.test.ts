import assert from 'node:assert/strict';
import test from 'node:test';
import { quoteSnapshotSchema } from '@sayman/web-shared/lib/checkout/quote-contract.ts';
import { quoteSnapshotV4Schema } from '../lib/checkout/quote-v4-contract.ts';
import { quoteSnapshotV5Schema } from '@sayman/web-shared/lib/checkout/quote-v5-contract.ts';
import { orderDetailSchema } from '@sayman/web-shared/lib/orders/order-contract.ts';
import { orderDetailV2Schema } from '@sayman/web-shared/lib/orders/order-v2-contract.ts';
import { quote4Snapshot } from '@sayman/web-shared/testing/quote-v4.test-fixtures.ts';
import { quote5Snapshot, order2Detail } from '@sayman/web-shared/testing/order-v2.test-fixtures.ts';
import { ordinaryPostpaidQuote, postpaidQuote } from './checkout-shipping.test-fixtures.ts';
import {
  hasPostpaidShipping,
  hasUnitemizedTax,
} from '@sayman/web-shared/lib/checkout/checkout-shipping.ts';

for (const [name, schema, raw] of [
  ['ordinary', quoteSnapshotSchema, ordinaryPostpaidQuote()],
  ['accepted calculator', quoteSnapshotV4Schema, postpaidQuote(quote4Snapshot())],
  ['mixed order', quoteSnapshotV5Schema, postpaidQuote(quote5Snapshot())],
] as const) {
  test(`${name} decodes postpaid merchant-zero and unknown included tax with an exact known total`, () => {
    const quote = schema.parse(raw);
    assert.equal(quote.shippingRial, '0');
    assert.equal(quote.taxRial, null);
    assert.equal(quote.payableTotalRial, quote.goodsTotalRial);
    assert.equal(quote.chargeRules?.taxableBaseRial, quote.goodsTotalRial);
    assert.equal(hasPostpaidShipping(quote), true);
    assert.equal(hasUnitemizedTax(quote), true);
    assert.ok(BigInt(quote.goodsTotalRial) > BigInt(Number.MAX_SAFE_INTEGER));
    for (const patch of [
      { shippingRial: '1', payableTotalRial: (BigInt(quote.goodsTotalRial) + 1n).toString() },
      { taxRial: '0' },
      { payableTotalRial: null },
      { chargeRules: { ...raw.chargeRules, shippingReason: 'free' } },
      { chargeRules: { ...raw.chargeRules, shippingFeeRial: '1' } },
      { chargeRules: { ...raw.chargeRules, shippingFreeFromRial: '1' } },
      { chargeRules: { ...raw.chargeRules, shippingMode: 'collect' } },
      { chargeRules: { ...raw.chargeRules, taxRateBasisPoints: 1000 } },
      { chargeRules: { ...raw.chargeRules, taxIncluded: false } },
      { chargeRules: { ...raw.chargeRules, taxMode: 'exempt' } },
    ])
      assert.equal(schema.safeParse({ ...raw, ...patch }).success, false);
  });
}

test('digital-only postpaid policy has no carrier collection and historical free/flat policies keep their own meaning', () => {
  const quote = ordinaryPostpaidQuote();
  const digital = quoteSnapshotSchema.parse({
    ...quote,
    shippingRequired: false,
    lines: quote.lines.map((line) => ({ ...line, isDigital: true })),
    chargeRules: { ...quote.chargeRules, shippingReason: 'digital' },
  });
  assert.equal(hasPostpaidShipping(digital), false);
  assert.equal(digital.shippingRial, '0');
  assert.equal(quoteSnapshotV4Schema.safeParse(quote4Snapshot()).success, true);
  assert.equal(quoteSnapshotV5Schema.safeParse(quote5Snapshot()).success, true);
  assert.equal(
    hasPostpaidShipping({
      shippingRequired: true,
      chargeRules: { shippingMode: 'free', shippingReason: 'free' },
    }),
    false,
  );
  assert.equal(hasPostpaidShipping({ shippingRequired: true }), false);
});

test('unitemized tax does not relax exact rated-inclusive arithmetic or turn unknown tax into exemption', () => {
  const raw = ordinaryPostpaidQuote();
  const tax = ((BigInt(raw.goodsTotalRial) + 1n) / 2n).toString();
  const included = {
    ...raw,
    taxRial: tax,
    chargeRules: { ...raw.chargeRules, taxMode: 'inclusive', taxRateBasisPoints: 10000 },
  };
  assert.equal(quoteSnapshotSchema.parse(included).taxRial, tax);
  assert.equal(quoteSnapshotSchema.safeParse({ ...included, taxRial: null }).success, false);
  assert.equal(
    quoteSnapshotSchema.safeParse({
      ...included,
      payableTotalRial: (BigInt(raw.goodsTotalRial) + BigInt(tax)).toString(),
    }).success,
    false,
  );
  assert.equal(
    quoteSnapshotSchema.safeParse({
      ...raw,
      chargeRules: { ...raw.chargeRules, taxMode: 'unconfigured' },
    }).success,
    false,
  );
});

test('order1 and mixed/projection order2 histories require finite snapshot flags and retain legacy tax and shipping bytes', () => {
  const prior = order2Detail();
  const mixed = {
    ...prior,
    shippingMode: 'postpaid',
    shippingRial: '0',
    taxRial: null,
    taxIncluded: true,
    taxBreakdownKnown: false,
    payableTotalRial: prior.goodsTotalRial,
    summary: { ...prior.summary, payableTotalRial: prior.goodsTotalRial },
  };
  const first = prior.lines[0];
  const legacy = {
    ...Object.fromEntries(
      Object.entries(mixed).filter(([key]) => key !== 'originalSnapshotVersion'),
    ),
    schemaVersion: 1,
    itemsSubtotalRial: first.lineTotalRial,
    goodsTotalRial: first.lineTotalRial,
    payableTotalRial: first.lineTotalRial,
    summary: {
      ...Object.fromEntries(
        Object.entries(prior.summary).filter(([key]) => key !== 'originalSnapshotVersion'),
      ),
      itemCount: 1,
      payableTotalRial: first.lineTotalRial,
    },
    lines: [
      Object.fromEntries(
        Object.entries(first).filter(
          ([key]) =>
            !['lineId', 'lineKind', 'accepted', 'categoryId', 'priceVersion'].includes(key),
        ),
      ),
    ],
    events: prior.events.map((event) => ({ ...event, reason: 'temporary_order_created' })),
  };
  for (const [schema, input] of [
    [orderDetailSchema, legacy],
    [orderDetailV2Schema, mixed],
  ] as const) {
    const parsed = schema.parse(input);
    assert.equal(hasPostpaidShipping(parsed), true);
    assert.equal(hasUnitemizedTax(parsed), true);
    assert.equal(parsed.taxRial, null);
    for (const patch of [
      { shippingMode: 'free' },
      { shippingMode: null },
      { shippingRial: '1' },
      { taxBreakdownKnown: true },
      { taxBreakdownKnown: null },
      { taxBreakdownKnown: undefined },
      { taxRial: '0' },
      { taxRial: undefined },
      { taxIncluded: false },
    ])
      assert.equal(schema.safeParse({ ...input, ...patch }).success, false);
  }
  const historical = orderDetailV2Schema.parse(prior);
  assert.equal(Object.hasOwn(historical, 'shippingMode'), false);
  assert.equal(Object.hasOwn(historical, 'taxBreakdownKnown'), false);
  assert.equal(historical.taxRial, '0');
  assert.equal(historical.shippingRial, '7');
  assert.equal(hasPostpaidShipping(historical), false);
});
