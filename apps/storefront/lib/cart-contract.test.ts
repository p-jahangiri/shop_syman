import assert from 'node:assert/strict';
import test from 'node:test';
import { cartInputSchema, cartSnapshotSchema } from './cart-contract.ts';
const sample = () => ({
  schemaVersion: 1,
  locale: 'en',
  version: 'AAAAAAAABAA=',
  lines: [
    {
      variantId: 'v1',
      quantity: 2,
      productId: 'p1',
      slug: 'phone',
      name: 'Phone',
      label: 'Black',
      unitPriceRial: '9007199254740993',
      available: 3,
      lineTotalRial: '18014398509481986',
    },
  ],
  subtotalRial: '18014398509481986',
  hasIssues: false,
});
test('cart boundary keeps large rial strings exact and normalizes omitted nullable fields', () => {
  const cart = cartSnapshotSchema.parse(sample());
  assert.equal(cart.subtotalRial, '18014398509481986');
  assert.equal(cart.lines[0].issue, null);
  assert.equal(
    cartSnapshotSchema.parse({
      schemaVersion: 1,
      locale: 'fa',
      lines: [],
      subtotalRial: '0',
      hasIssues: false,
    }).version,
    null,
  );
});
test('cart inputs reject prices, duplicate ids, invalid quantities and excessive lines', () => {
  for (const input of [
    { lines: [{ variantId: 'v1', quantity: 1, priceRial: '1' }] },
    {
      lines: [
        { variantId: 'v1', quantity: 1 },
        { variantId: 'V1', quantity: 2 },
      ],
    },
    { lines: [{ variantId: 'v1', quantity: 0 }] },
    { lines: Array.from({ length: 65 }, (_, i) => ({ variantId: `v${i}`, quantity: 1 })) },
  ])
    assert.equal(cartInputSchema.safeParse(input).success, false);
});
test('cart responses reject money numbers, incorrect totals and leaked credential fields', () => {
  for (const change of [
    { subtotalRial: Number('18014398509481986') },
    { subtotalRial: '1' },
    { ownerId: 'private-user' },
    { guestTokenHash: 'private-hash' },
    { hasIssues: true },
  ])
    assert.equal(cartSnapshotSchema.safeParse({ ...sample(), ...change }).success, false);
});
test('unavailable and overflowing lines remain explicit review items with no fabricated subtotal', () => {
  const invalid = {
    schemaVersion: 1,
    locale: 'fa',
    lines: [{ variantId: 'v1', quantity: 2, available: 0, issue: 'unavailable' }],
    hasIssues: true,
  };
  assert.equal(cartSnapshotSchema.parse(invalid).subtotalRial, null);
  assert.equal(cartSnapshotSchema.safeParse({ ...invalid, subtotalRial: '0' }).success, false);
});
