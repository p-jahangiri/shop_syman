import type { ServerCartV2 } from './cart-v2-contract.ts';

// Reviewing agreed prices is separate from permission to place an order.
// Inquiry rows are excluded from Quote4, including their availability issues.
export function cartReviewCapabilities(
  cart: ServerCartV2 | null,
  state: { authenticated: boolean; failed: boolean; mergePending: boolean },
) {
  const ordinaryIssue = !!cart?.ordinaryLines.some((line) => line.issue !== null);
  return {
    cartIssue: ordinaryIssue || !!cart?.offerLines.length || state.failed || state.mergePending,
    quoteReviewIssue:
      !state.authenticated ||
      !cart ||
      !cart.version ||
      state.failed ||
      state.mergePending ||
      ordinaryIssue ||
      cart.offerLines.some((line) => line.issue !== null) ||
      cart.buySubtotalRial === null,
  };
}
