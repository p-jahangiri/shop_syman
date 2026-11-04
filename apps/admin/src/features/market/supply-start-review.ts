export type SupplyStartCandidate = {
  offerId: string;
  acceptanceId: string;
  offerVersion: string;
  termsHash: string;
  purchaseUntil: string;
};
export function supplyStartReviewKey(
  requestId: string,
  requestVersion: string,
  candidate: SupplyStartCandidate | null,
) {
  return candidate
    ? JSON.stringify([
        requestId,
        requestVersion,
        candidate.offerId,
        candidate.acceptanceId,
        candidate.offerVersion,
        candidate.termsHash,
        candidate.purchaseUntil,
      ])
    : null;
}
export function supplyStartReviewMatches(
  reviewed: string | null,
  requestId: string,
  requestVersion: string,
  candidate: SupplyStartCandidate | null,
) {
  const current = supplyStartReviewKey(requestId, requestVersion, candidate);
  return current !== null && reviewed === current;
}
