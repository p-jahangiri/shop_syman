import type { SourcingDetail } from '@sayman/web-shared/lib/market/sourcing-contract.ts';
import type { OfferDetail, OfferPage } from '@sayman/web-shared/lib/market/offer-contract.ts';
import type { SourcingPending } from './sourcing-journal.ts';
export type OfferReview = {
  requestId: string;
  offerId: string;
  requestVersion: string;
  version: string;
  termsHash: string;
  operation: 'accept' | 'decline';
};
export function reviewSourcingOffer(
  detail: OfferDetail,
  operation: 'accept' | 'decline',
): OfferReview {
  return {
    requestId: detail.requestId,
    offerId: detail.offer.summary.id,
    requestVersion: detail.requestVersion,
    version: detail.offer.summary.version,
    termsHash: detail.offer.summary.termsHash,
    operation,
  };
}
export function offerReviewIsCurrent(
  review: OfferReview | null,
  detail: OfferDetail | null,
  now = Date.now(),
) {
  if (!review || !detail) return false;
  const current = reviewSourcingOffer(detail, review.operation);
  return (
    Object.keys(current).every(
      (key) => current[key as keyof OfferReview] === review[key as keyof OfferReview],
    ) &&
    detail.offer.summary.effectiveState === 'Published' &&
    Date.parse(detail.offer.summary.acceptUntil) > now &&
    (review.operation === 'accept' ? detail.canAccept : detail.canDecline)
  );
}
// The v1 request flags describe only its coarse state. The independently read
// child page must agree on the same request version before enabling a cancel.
export function canCancelSourcingWithOffers(detail: SourcingDetail | null, page: OfferPage | null) {
  return (
    !!detail &&
    !!page &&
    detail.canCancel &&
    detail.summary.id === page.requestId &&
    detail.summary.version === page.requestVersion &&
    page.canCancelRequest
  );
}
export function sameOfferView(
  owner: string | null,
  liveOwner: string | undefined,
  requestId: string,
  offerId: string,
  detail: OfferDetail,
) {
  return (
    !!owner &&
    owner === liveOwner &&
    detail.requestId === requestId &&
    detail.offer.summary.id === offerId
  );
}
export function offerCommandMatchesJournal(
  pending: SourcingPending | null,
  requestId: string,
  offerId: string,
  operation: 'accept' | 'decline',
  commandId: string,
) {
  if (!pending) return false;
  const command = pending.command;
  return (
    (command.kind === 'accept' || command.kind === 'decline') &&
    command.kind === operation &&
    command.id === requestId &&
    command.offerId === offerId &&
    command.body.requestId.replaceAll('-', '').toLowerCase() ===
      commandId.replaceAll('-', '').toLowerCase()
  );
}
export function offerRecoveryMayApply(
  pending: SourcingPending | null,
  requestId: string,
  offerId: string,
  operation: 'accept' | 'decline',
  commandId: string,
) {
  return (
    !pending ||
    !!pending.result ||
    offerCommandMatchesJournal(pending, requestId, offerId, operation, commandId)
  );
}
