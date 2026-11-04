import test from 'node:test';
import assert from 'node:assert/strict';
import {
  supplyStartReviewKey,
  supplyStartReviewMatches,
} from '../src/features/market/supply-start-review.ts';
import { supplyTestIds as ids, supplyTestVersion as version } from './supply.test-fixtures.ts';
const candidate = {
  offerId: ids.offer,
  acceptanceId: ids.acceptance,
  offerVersion: version,
  termsHash: 'A'.repeat(64),
  purchaseUntil: '2026-10-25T00:00:00Z',
};
test('explicit start confirmation binds the complete current parent and accepted Offer candidate', () => {
  const reviewed = supplyStartReviewKey(ids.request, version, candidate);
  assert.equal(supplyStartReviewMatches(reviewed, ids.request, version, { ...candidate }), true);
  assert.equal(supplyStartReviewMatches(null, ids.request, version, candidate), false);
  for (const changed of [
    { offerId: '9'.repeat(32) },
    { acceptanceId: '9'.repeat(32) },
    { offerVersion: 'AAAAAAAAAAI=' },
    { termsHash: 'B'.repeat(64) },
    { purchaseUntil: '2026-10-26T00:00:00Z' },
  ])
    assert.equal(
      supplyStartReviewMatches(reviewed, ids.request, version, { ...candidate, ...changed }),
      false,
    );
  assert.equal(supplyStartReviewMatches(reviewed, '9'.repeat(32), version, candidate), false);
  assert.equal(supplyStartReviewMatches(reviewed, ids.request, 'AAAAAAAAAAI=', candidate), false);
  assert.equal(supplyStartReviewMatches(reviewed, ids.request, version, null), false);
});
test('a query candidate replacement immediately invalidates old checked state without waiting for a React effect', () => {
  const reviewed = supplyStartReviewKey(ids.request, version, candidate),
    next = {
      ...candidate,
      offerId: '9'.repeat(32),
      acceptanceId: '8'.repeat(32),
      offerVersion: 'AAAAAAAAAAI=',
    };
  assert.equal(supplyStartReviewMatches(reviewed, ids.request, version, next), false);
  const reviewedAgain = supplyStartReviewKey(ids.request, version, next);
  assert.equal(supplyStartReviewMatches(reviewedAgain, ids.request, version, next), true);
});
