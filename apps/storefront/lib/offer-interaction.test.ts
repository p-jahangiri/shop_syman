import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canCancelSourcingWithOffers,
  offerCommandMatchesJournal,
  offerRecoveryMayApply,
  offerReviewIsCurrent,
  reviewSourcingOffer,
  sameOfferView,
} from './offer-interaction.ts';
import { sourcingRecoveryMayApply, type SourcingPending } from './sourcing-journal.ts';
import { offerDetailSchema, offerPageSchema } from './offer-contract.ts';
import { sourcingDetailSchema } from './sourcing-contract.ts';
import {
  offerTestAction,
  offerTestDetail,
  offerTestMutation,
  offerTestPage,
  offerTestSummary,
} from './offer.test-fixtures.ts';
import { sourcingTestDetail, sourcingTestSubmit } from './sourcing.test-fixtures.ts';
test('request cancellation requires both current child capability and the unchanged coarse contract', () => {
  const parent = sourcingDetailSchema.parse(sourcingTestDetail),
    page = offerPageSchema.parse(offerTestPage);
  assert.equal(canCancelSourcingWithOffers(parent, page), true);
  for (const child of [
    null,
    { ...page, requestId: 'f'.repeat(32) },
    { ...page, requestVersion: 'AAAAAAAAAAI=' },
    { ...page, canCancelRequest: false },
  ])
    assert.equal(canCancelSourcingWithOffers(parent, child), false);
  assert.equal(canCancelSourcingWithOffers({ ...parent, canCancel: false }, page), false);
  assert.equal(canCancelSourcingWithOffers(null, page), false);
  // The historical parent remains Reviewing/Submitted. A child acceptance must
  // disable simple cancellation even when the coarse v1 flag remains true.
  assert.equal(
    canCancelSourcingWithOffers(parent, {
      ...page,
      items: [{ ...page.items[0], state: 'Accepted', effectiveState: 'Accepted' }],
      canCancelRequest: false,
    }),
    false,
  );
});
test('foreign manual receipts cannot replace an unresolved command view or confirmation', () => {
  const detail = offerDetailSchema.parse(offerTestDetail),
    command = {
      kind: 'accept' as const,
      id: detail.requestId,
      offerId: detail.offer.summary.id,
      reference: detail.requestReference,
      body: offerTestAction,
    },
    pending: SourcingPending = { command, result: null, uncertain: true };
  assert.equal(
    offerRecoveryMayApply(
      pending,
      command.id,
      command.offerId,
      'accept',
      command.body.requestId.replaceAll('-', ''),
    ),
    true,
  );
  for (const [requestId, offerId, operation, commandId] of [
    [command.id, 'f'.repeat(32), 'accept', command.body.requestId],
    ['f'.repeat(32), command.offerId, 'accept', command.body.requestId],
    [command.id, command.offerId, 'decline', command.body.requestId],
    [command.id, command.offerId, 'accept', '11234567-89ab-4cde-8012-3456789abcde'],
  ] as const)
    assert.equal(offerRecoveryMayApply(pending, requestId, offerId, operation, commandId), false);
  for (const other of [
    {
      ...pending,
      command: {
        kind: 'cancel' as const,
        id: command.id,
        body: { requestId: command.body.requestId, version: command.body.version },
      },
    },
    {
      ...pending,
      command: { kind: 'submit' as const, locale: 'fa' as const, body: sourcingTestSubmit },
    },
  ])
    assert.equal(
      offerRecoveryMayApply(other, command.id, command.offerId, 'accept', command.body.requestId),
      false,
    );
  assert.equal(sourcingRecoveryMayApply(pending, 'submit', command.body.requestId), false);
  assert.equal(sourcingRecoveryMayApply(pending, 'cancel', command.body.requestId), false);
  assert.equal(
    offerRecoveryMayApply(null, command.id, command.offerId, 'accept', command.body.requestId),
    true,
  );
  assert.equal(
    offerRecoveryMayApply(
      { ...pending, result: offerTestMutation as never },
      command.id,
      'f'.repeat(32),
      'decline',
      command.body.requestId,
    ),
    true,
  );
  // An old mutation callback also cannot act on a journal replaced by another
  // command, even if the same customer and request are still being viewed.
  assert.equal(
    offerCommandMatchesJournal(
      {
        ...pending,
        command: {
          ...command,
          body: { ...command.body, requestId: '11234567-89ab-4cde-8012-3456789abcde' },
        },
      },
      command.id,
      command.offerId,
      'accept',
      command.body.requestId,
    ),
    false,
  );
});
test('explicit offer review is bound to both resource versions and the exact terms hash until the deadline', () => {
  const detail = offerDetailSchema.parse(offerTestDetail),
    review = reviewSourcingOffer(detail, 'accept'),
    before = Date.parse(offerTestSummary.acceptUntil) - 1;
  assert.equal(offerReviewIsCurrent(review, detail, before), true);
  for (const current of [
    { ...detail, requestId: 'f'.repeat(32) },
    { ...detail, requestVersion: 'AAAAAAAAAAI=' },
    {
      ...detail,
      offer: { ...detail.offer, summary: { ...detail.offer.summary, id: 'f'.repeat(32) } },
    },
    {
      ...detail,
      offer: { ...detail.offer, summary: { ...detail.offer.summary, version: 'AAAAAAAAAAI=' } },
    },
    {
      ...detail,
      offer: { ...detail.offer, summary: { ...detail.offer.summary, termsHash: 'B'.repeat(64) } },
    },
    { ...detail, canAccept: false },
    {
      ...detail,
      offer: {
        ...detail.offer,
        summary: { ...detail.offer.summary, effectiveState: 'Expired' as const },
      },
    },
  ])
    assert.equal(offerReviewIsCurrent(review, current, before), false);
  assert.equal(
    offerReviewIsCurrent(review, detail, Date.parse(offerTestSummary.acceptUntil)),
    false,
  );
  assert.equal(offerReviewIsCurrent(null, detail, before), false);
  assert.equal(
    offerReviewIsCurrent(
      reviewSourcingOffer({ ...detail, canAccept: false }, 'decline'),
      { ...detail, canAccept: false },
      before,
    ),
    true,
  );
});
test('a delayed offer view cannot be applied after owner or target changes', () => {
  const detail = offerDetailSchema.parse(offerTestDetail);
  assert.equal(
    sameOfferView('owner', 'owner', detail.requestId, detail.offer.summary.id, detail),
    true,
  );
  assert.equal(
    sameOfferView('owner', 'other', detail.requestId, detail.offer.summary.id, detail),
    false,
  );
  assert.equal(
    sameOfferView('owner', undefined, detail.requestId, detail.offer.summary.id, detail),
    false,
  );
  assert.equal(
    sameOfferView(null, 'owner', detail.requestId, detail.offer.summary.id, detail),
    false,
  );
  assert.equal(
    sameOfferView('owner', 'owner', 'f'.repeat(32), detail.offer.summary.id, detail),
    false,
  );
  assert.equal(sameOfferView('owner', 'owner', detail.requestId, 'f'.repeat(32), detail), false);
});
