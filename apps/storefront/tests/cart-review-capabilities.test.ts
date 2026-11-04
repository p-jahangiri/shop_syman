import assert from 'node:assert/strict';
import test from 'node:test';
import { cartReviewCapabilities } from '../lib/checkout/cart-review-capabilities.ts';
import { cart2Snapshot } from './cart-v2.test-fixtures.ts';
const healthy = { authenticated: true, failed: false, mergePending: false };

test('an owned healthy accepted cart can review exact prices while ordering stays blocked', () => {
  for (const kind of ['offer', 'both'] as const) {
    const cart = cart2Snapshot(kind),
      capabilities = cartReviewCapabilities(cart, healthy);
    assert.equal(capabilities.quoteReviewIssue, false);
    assert.equal(capabilities.cartIssue, true);
    assert.equal(cart.canCheckout, false);
    assert.equal(cart.canPay, false);
  }
});
test('accepted price review fails closed on either purchase lane or a missing total', () => {
  const accepted = cart2Snapshot();
  accepted.offerLines[0].issue = 'allocation_expired';
  const ordinary = cart2Snapshot();
  ordinary.ordinaryLines[0].issue = 'insufficient_stock';
  const missingTotal = cart2Snapshot();
  missingTotal.buySubtotalRial = null;
  for (const cart of [accepted, ordinary, missingTotal])
    assert.equal(cartReviewCapabilities(cart, healthy).quoteReviewIssue, true);
});
test('unloaded, unavailable, unverified and unmerged carts cannot enter accepted price review', () => {
  assert.equal(cartReviewCapabilities(null, healthy).quoteReviewIssue, true);
  const unversioned = cart2Snapshot();
  unversioned.version = null;
  assert.equal(cartReviewCapabilities(unversioned, healthy).quoteReviewIssue, true);
  for (const state of [
    { ...healthy, authenticated: false },
    { ...healthy, failed: true },
    { ...healthy, mergePending: true },
  ])
    assert.equal(cartReviewCapabilities(cart2Snapshot(), state).quoteReviewIssue, true);
});
test('inquiry issues do not prevent review of independent purchasable rows', () => {
  const cart = cart2Snapshot();
  cart.inquiry.hasIssues = true;
  cart.hasIssues = true;
  assert.equal(cartReviewCapabilities(cart, healthy).quoteReviewIssue, false);
  assert.equal(cartReviewCapabilities(cart, healthy).cartIssue, true);
});
test('ordinary guest checkout keeps its existing capability independently of accepted review', () => {
  const cart = cart2Snapshot('ordinary'),
    capabilities = cartReviewCapabilities(cart, { ...healthy, authenticated: false });
  assert.equal(capabilities.cartIssue, false);
  assert.equal(capabilities.quoteReviewIssue, true);
  assert.equal(cart.canCheckout, true);
});
