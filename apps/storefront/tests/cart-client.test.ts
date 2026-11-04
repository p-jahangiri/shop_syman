import assert from 'node:assert/strict';
import test from 'node:test';
import {
  combineLegacyCart,
  requestCart,
  serverCartProducts,
  CartError,
} from '../lib/checkout/cart-client.ts';
import { cartSnapshotSchema } from '../lib/checkout/cart-contract.ts';
import { storefrontSnapshot } from '../lib/data/fixtures.ts';
test('legacy transfer preserves choices by maximum and is safe to repeat', () => {
  const old = [
    { variantId: 'one', quantity: 3 },
    { variantId: 'two', quantity: 1 },
  ];
  const current = [
    { variantId: 'one', quantity: 2 },
    { variantId: 'three', quantity: 4 },
  ];
  const merged = combineLegacyCart(current, old);
  assert.deepEqual(combineLegacyCart(merged, old), merged);
  assert.deepEqual(merged, [
    { variantId: 'one', quantity: 3 },
    { variantId: 'three', quantity: 4 },
    { variantId: 'two', quantity: 1 },
  ]);
  assert.equal(current[0].quantity, 2);
  assert.equal(old.length, 2);
});
test('legacy transfer beyond the line limit fails without truncating old choices', () => {
  const old = Array.from({ length: 65 }, (_, i) => ({ variantId: `v${i}`, quantity: 1 }));
  assert.throws(
    () => combineLegacyCart([], old),
    (e) => e instanceof CartError && e.code === 'cart_limit',
  );
  assert.equal(old.length, 65);
});
test('cart hydration uses exact server prices and stock without mutating catalogue data', () => {
  const product = structuredClone(storefrontSnapshot.products[0]);
  const variant = product.variants[0];
  const original = variant.priceRial;
  const data = cartSnapshotSchema.parse({
    schemaVersion: 1,
    locale: 'en',
    lines: [
      {
        variantId: variant.id,
        quantity: 1,
        productId: product.id,
        slug: product.slug,
        unitPriceRial: '9007199254740993',
        available: 1,
        lineTotalRial: '9007199254740993',
      },
    ],
    subtotalRial: '9007199254740993',
    hasIssues: false,
  });
  const result = serverCartProducts(data, [product]);
  assert.equal(result[0].variants[0].priceRial, '9007199254740993');
  assert.equal(result[0].variants[0].stock, 1);
  assert.equal(product.variants[0].priceRial, original);
});
test('cart service errors and malformed amounts never fall back to sample data', async () => {
  await assert.rejects(
    requestCart(
      async () => Response.json({ title: 'cart_version_conflict' }, { status: 409 }),
      'en',
    ),
    (e) => e instanceof CartError && e.status === 409,
  );
  await assert.rejects(
    requestCart(
      async () =>
        Response.json({
          schemaVersion: 1,
          locale: 'en',
          lines: [],
          subtotalRial: 0,
          hasIssues: false,
        }),
      'en',
    ),
  );
  await assert.rejects(
    requestCart(
      async () =>
        Response.json({
          schemaVersion: 1,
          locale: 'fa',
          lines: [],
          subtotalRial: '0',
          hasIssues: false,
        }),
      'en',
    ),
  );
});
