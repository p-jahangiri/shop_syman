import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cartInputV2Schema,
  cartSnapshotV2Schema,
  cartV2AllowsLegacyCheckout,
  cartV2BuyCount,
  cartV2HasBuyLines,
  ordinaryCartProducts,
  groupAcceptedCartLines,
} from '../lib/checkout/cart-v2-contract.ts';
import {
  cartCommandReceiptMatches,
  cartConversionCandidateSchema,
  cartConversionInputSchema,
  conversionInput,
} from '../lib/checkout/cart-conversion-contract.ts';
import {
  cart2Snapshot,
  cart2Candidate,
  cart2Command,
  cart2Mutation,
  cart2Removal,
  cart2Ids,
} from './cart-v2.test-fixtures.ts';
import { sourcingTestCart } from '@sayman/web-shared/testing/sourcing.test-fixtures.ts';
import { sourcingCartSchema } from '@sayman/web-shared/lib/market/sourcing-contract.ts';
import { storefrontSnapshot } from '../lib/data/fixtures.ts';
test('Cart2 preserves exact private accepted prices alongside a public same-SKU line', () => {
  const value = cart2Snapshot();
  assert.equal(value.buySubtotalRial, '18014398509482086');
  assert.equal(cartV2BuyCount(value), 3);
  assert.equal(groupAcceptedCartLines(value.offerLines).length, 1);
  assert.notEqual(value.ordinaryLines[0].lineId, value.ordinaryLines[0].variantId);
  assert.equal(cartV2AllowsLegacyCheckout(value), false);
});
test('Cart2 offer-only and empty carts have distinct presence and checkout states', () => {
  const offer = cart2Snapshot('offer');
  assert.equal(cartV2HasBuyLines(offer), true);
  assert.equal(cartV2BuyCount(offer), 2);
  assert.equal(offer.canCheckout, false);
  assert.equal(cartV2HasBuyLines(cart2Snapshot('empty')), false);
  assert.equal(cartV2AllowsLegacyCheckout(cart2Snapshot('ordinary')), true);
});
test('only ordinary prices hydrate the public registry, including same-SKU collisions', () => {
  const product = structuredClone(storefrontSnapshot.products[0]);
  product.variants[0].id = 'qa-sku';
  const old = product.variants[0].priceRial;
  const both = ordinaryCartProducts(cart2Snapshot(), [product]);
  assert.equal(both[0].variants[0].priceRial, '100');
  assert.equal(both[0].variants[0].stock, 3);
  assert.equal(product.variants[0].priceRial, old);
  assert.equal(
    ordinaryCartProducts(cart2Snapshot('offer'), [product])[0].variants[0].priceRial,
    old,
  );
});
test('inquiry issues remain independent of ordinary-only legacy checkout', () => {
  const value = cart2Snapshot('ordinary');
  value.inquiry = sourcingCartSchema.parse({
    ...structuredClone(sourcingTestCart),
    lines: [
      {
        ...structuredClone(sourcingTestCart.lines[0]),
        candidate: {
          ...structuredClone(sourcingTestCart.lines[0].candidate),
          issue: 'unavailable',
        },
      },
    ],
    hasIssues: true,
  });
  value.hasIssues = true;
  value.blockers = ['inquiry_review_required'];
  const parsed = cartSnapshotV2Schema.parse(value);
  assert.equal(cartV2AllowsLegacyCheckout(parsed), true);
});
test('Cart2 rejects legacy shapes, omitted explicit nulls, wrong versions and leaked private fields', () => {
  const value = cart2Snapshot();
  for (const changed of [
    { ...value, schemaVersion: 1 },
    { ...value, ownerId: 'private' },
    { ...value, version: undefined },
    { ...value, ordinaryLines: [{ ...value.ordinaryLines[0], issue: undefined }] },
    { ...value, offerLines: [{ ...value.offerLines[0], imageUrl: undefined }] },
    { ...value, inquiry: { ...value.inquiry, version: 'AAAAAAAAAAI=' } },
  ])
    assert.equal(cartSnapshotV2Schema.safeParse(changed).success, false);
});
test('Cart2 rejects number money, wrong totals and fabricated accepted checkout', () => {
  const value = cart2Snapshot();
  for (const changed of [
    { ...value, buySubtotalRial: Number(value.buySubtotalRial) },
    { ...value, offerSubtotalRial: '1' },
    { ...value, canCheckout: true },
    { ...value, canPay: true },
    { ...value, offerLines: [{ ...value.offerLines[0], quantity: 1 }] },
    {
      ...value,
      offerLines: [{ ...value.offerLines[0], imageUrl: 'https://example.com/private?token=x' }],
    },
  ])
    assert.equal(cartSnapshotV2Schema.safeParse(changed).success, false);
});
test('Cart2 group provenance and the combined purchase capacity cannot be split or hidden', () => {
  const value = cart2Snapshot();
  const other = {
    ...value.offerLines[0],
    lineId: '9'.repeat(32),
    agreementLineId: 'a'.repeat(32),
    offerLineId: 'f'.repeat(32),
    allocationId: 'f'.repeat(32),
  };
  assert.equal(
    cartSnapshotV2Schema.safeParse({ ...value, offerLines: [...value.offerLines, other] }).success,
    false,
  );
  assert.equal(
    cartSnapshotV2Schema.safeParse({
      ...value,
      ordinaryLines: Array.from({ length: 64 }, (_, i) => ({
        ...value.ordinaryLines[0],
        variantId: 'v' + i,
        lineId: (i + 100).toString(16).padStart(32, '0'),
      })),
    }).success,
    false,
  );
});
test('Cart2 input cannot inject accepted prices or overwrite their quantities', () => {
  assert.equal(
    cartInputV2Schema.safeParse({ lines: [{ variantId: 'qa-sku', quantity: 1 }], version: null })
      .success,
    true,
  );
  for (const input of [
    { lines: [], version: undefined },
    { lines: [], version: null, offerLines: [] },
    { lines: [{ variantId: 'qa-sku', quantity: 1, unitPriceRial: '1' }], version: null },
  ])
    assert.equal(cartInputV2Schema.safeParse(input).success, false);
});
test('Cart2 keeps supported long ordinary labels without weakening accepted snapshot bounds', () => {
  const value = cart2Snapshot();
  value.ordinaryLines[0].label = 'الف'.repeat(600);
  assert.equal(cartSnapshotV2Schema.parse(value).ordinaryLines[0].label?.length, 1800);
  assert.equal(
    cartSnapshotV2Schema.safeParse({
      ...value,
      offerLines: [{ ...value.offerLines[0], label: 'x'.repeat(2001) }],
    }).success,
    false,
  );
});
test('conversion proof rejects foreign route lineage, altered quantities and public checkout flags', () => {
  const value = cart2Candidate();
  for (const changed of [
    { ...value, requestId: 'a'.repeat(32) },
    { ...value, canPay: true },
    {
      ...value,
      allocation: { ...value.allocation!, lines: [{ ...value.allocation!.lines[0], quantity: 1 }] },
    },
    { ...value, agreement: undefined },
    {
      ...value,
      conversion: {
        id: cart2Ids.conversion,
        cartVersion: 'AAAAAAAAAAI=',
        lines: cart2Mutation().lines,
      },
    },
  ])
    assert.equal(cartConversionCandidateSchema.safeParse(changed).success, false);
});
test('historical conversions allow later cart versions but never authorize another convert', () => {
  const value = cart2Candidate();
  value.conversion = {
    id: cart2Ids.conversion,
    cartVersion: 'AAAAAAAAAAI=',
    lines: cart2Mutation().lines,
  };
  value.canConvert = false;
  value.blockers = ['already_converted'];
  assert.equal(cartConversionCandidateSchema.parse(value).cartVersion, 'AAAAAAAAAAE=');
  assert.throws(() => conversionInput(value, cart2Command().body.requestId));
});
test('conversion freezes server versions and cannot extend either deadline', () => {
  const value = cart2Candidate(),
    command = cart2Command();
  assert.deepEqual(
    conversionInput(value, command.body.requestId, Date.parse('2026-10-24T12:00:00Z')),
    command.body,
  );
  assert.throws(() =>
    conversionInput(value, command.body.requestId, Date.parse(value.allocation!.expiresAt)),
  );
  assert.equal(
    cartConversionInputSchema.safeParse({ ...command.body, expiresAt: '2030-01-01T00:00:00Z' })
      .success,
    false,
  );
});
test('D UUID inputs match canonical N conversion and remove receipts without weakening body binding', () => {
  const command = cart2Command();
  assert.equal(
    cartCommandReceiptMatches(command, cart2Mutation(true), true).commandId,
    command.body.requestId.replaceAll('-', ''),
  );
  assert.equal(
    cartCommandReceiptMatches(
      {
        kind: 'cart-remove',
        id: cart2Ids.agreement,
        locale: 'fa',
        body: { requestId: command.body.requestId, version: command.body.cartVersion! },
      },
      cart2Removal(true),
      true,
    ).replayed,
    true,
  );
  for (const raw of [
    { ...cart2Mutation(true), allocationId: 'a'.repeat(32) },
    { ...cart2Mutation(true), commandId: 'f'.repeat(32) },
    cart2Mutation(false),
  ])
    assert.throws(() => cartCommandReceiptMatches(command, raw, true));
});
