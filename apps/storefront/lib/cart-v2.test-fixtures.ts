// Synthetic contract fixtures only. Authenticated SQL wires are verified separately.
import {
  offerTestSku,
  offerTestVersion as version,
  offerTestHash as termsHash,
  offerTestCommand as commandId,
} from './offer.test-fixtures.ts';
import { sourcingTestCart } from './sourcing.test-fixtures.ts';
import { cartSnapshotV2Schema } from './cart-v2-contract.ts';
import {
  cartConversionCandidateSchema,
  conversionInput,
  type CartCommand,
} from './cart-conversion-contract.ts';
export const cart2Ids = {
  request: 'b'.repeat(32),
  task: '1'.repeat(32),
  offer: 'c'.repeat(32),
  acceptance: 'e'.repeat(32),
  allocation: '2'.repeat(32),
  agreement: '3'.repeat(32),
  agreementLine: '4'.repeat(32),
  offerLine: 'd'.repeat(32),
  conversion: '5'.repeat(32),
  line: '6'.repeat(32),
  ordinary: '7'.repeat(32),
  cart: '8'.repeat(32),
};
export const cart2Ordinary = {
  lineId: cart2Ids.ordinary,
  lineKind: 'ordinary' as const,
  variantId: 'qa-sku',
  quantity: 1,
  productId: 'phone-model',
  slug: 'offer-phone',
  name: 'Public phone',
  label: 'Public variant',
  unitPriceRial: '100',
  available: 3,
  lineTotalRial: '100',
  issue: null,
};
export const cart2Accepted = {
  lineId: cart2Ids.line,
  lineKind: 'acceptedOffer' as const,
  conversionId: cart2Ids.conversion,
  agreementId: cart2Ids.agreement,
  agreementLineId: cart2Ids.agreementLine,
  requestId: cart2Ids.request,
  taskId: cart2Ids.task,
  offerId: cart2Ids.offer,
  acceptanceId: cart2Ids.acceptance,
  allocationId: cart2Ids.allocation,
  offerLineId: cart2Ids.offerLine,
  variantId: 'qa-sku',
  quantity: 2,
  productId: 'phone-model',
  slug: 'offer-phone',
  sku: 'QA-REAL-SKU',
  name: 'Accepted phone',
  label: 'Accepted variant',
  warranty: 'Recorded warranty',
  imageUrl: '/products/phone.svg',
  unitPriceRial: '9007199254740993',
  lineTotalRial: '18014398509481986',
  purchaseUntil: '2026-10-26T10:00:00+00:00',
  allocationExpiresAt: '2026-10-25T10:00:00+00:00',
  issue: null,
};
export function cart2Snapshot(kind: 'ordinary' | 'offer' | 'both' | 'empty' = 'both') {
  const ordinaryLines =
      kind === 'ordinary' || kind === 'both' ? [structuredClone(cart2Ordinary)] : [],
    offerLines = kind === 'offer' || kind === 'both' ? [structuredClone(cart2Accepted)] : [];
  const ordinarySubtotalRial = ordinaryLines.length ? '100' : '0',
    offerSubtotalRial = offerLines.length ? cart2Accepted.lineTotalRial : '0';
  return cartSnapshotV2Schema.parse({
    schemaVersion: 2,
    locale: 'fa',
    version,
    ordinaryLines,
    offerLines,
    inquiry: { ...structuredClone(sourcingTestCart), lines: [], hasIssues: false },
    ordinarySubtotalRial,
    offerSubtotalRial,
    buySubtotalRial: (BigInt(ordinarySubtotalRial) + BigInt(offerSubtotalRial)).toString(),
    hasIssues: false,
    canCheckout: kind === 'ordinary',
    canPay: false,
    blockers: offerLines.length
      ? ['accepted_offer_checkout_unavailable']
      : ordinaryLines.length
        ? []
        : ['empty_cart'],
  });
}
export function cart2Candidate() {
  return cartConversionCandidateSchema.parse({
    schemaVersion: 1,
    requestId: cart2Ids.request,
    requestVersion: version,
    taskId: cart2Ids.task,
    taskVersion: version,
    offerId: cart2Ids.offer,
    offerVersion: version,
    acceptanceId: cart2Ids.acceptance,
    termsHash,
    purchaseUntil: cart2Accepted.purchaseUntil,
    agreement: {
      schemaVersion: 1,
      id: cart2Ids.agreement,
      requestId: cart2Ids.request,
      taskId: cart2Ids.task,
      offerId: cart2Ids.offer,
      revision: 1,
      acceptanceId: cart2Ids.acceptance,
      termsHash,
      allocationId: cart2Ids.allocation,
      state: 'Active',
      effectiveState: 'Active',
      version,
      termsFa: 'شرایط آزمون',
      termsEn: 'Test terms',
      purchaseUntil: cart2Accepted.purchaseUntil,
      isDemo: true,
      lines: [
        {
          id: cart2Ids.agreementLine,
          offerLineId: cart2Ids.offerLine,
          listingId: 'a'.repeat(32),
          quantity: 2,
          unitPriceRial: cart2Accepted.unitPriceRial,
          lineTotalRial: cart2Accepted.lineTotalRial,
          sku: structuredClone(offerTestSku),
        },
      ],
      canPay: false,
    },
    allocation: {
      allocationId: cart2Ids.allocation,
      requestId: cart2Ids.request,
      taskId: cart2Ids.task,
      offerId: cart2Ids.offer,
      acceptanceId: cart2Ids.acceptance,
      termsHash,
      version,
      expiresAt: cart2Accepted.allocationExpiresAt,
      isDemo: true,
      lines: [{ offerLineId: cart2Ids.offerLine, variantId: 'qa-sku', quantity: 2 }],
    },
    cartVersion: version,
    conversion: null,
    canConvert: true,
    canCheckout: false,
    canPay: false,
    blockers: [],
  });
}
export function cart2Command(): Extract<CartCommand, { kind: 'cart-convert' }> {
  return {
    kind: 'cart-convert',
    id: cart2Ids.request,
    offerId: cart2Ids.offer,
    locale: 'fa',
    body: conversionInput(cart2Candidate(), commandId, Date.parse('2026-10-24T12:00:00Z')),
  };
}
export function cart2Mutation(replayed = false) {
  return {
    schemaVersion: 1,
    conversionId: cart2Ids.conversion,
    requestId: cart2Ids.request,
    taskId: cart2Ids.task,
    offerId: cart2Ids.offer,
    acceptanceId: cart2Ids.acceptance,
    agreementId: cart2Ids.agreement,
    allocationId: cart2Ids.allocation,
    cartId: cart2Ids.cart,
    cartVersion: 'AAAAAAAAAAI=',
    lines: [
      {
        lineId: cart2Ids.line,
        agreementLineId: cart2Ids.agreementLine,
        offerLineId: cart2Ids.offerLine,
      },
    ],
    commandId: commandId.replaceAll('-', ''),
    at: '2026-10-24T12:00:00+00:00',
    replayed,
    canCheckout: false,
    canPay: false,
  };
}
export function cart2Removal(replayed = false) {
  return {
    schemaVersion: 1,
    agreementId: cart2Ids.agreement,
    cartId: cart2Ids.cart,
    cartVersion: 'AAAAAAAAAAM=',
    lineIds: [cart2Ids.line],
    commandId: commandId.replaceAll('-', ''),
    at: '2026-10-24T12:00:00+00:00',
    replayed,
    canCheckout: false,
    canPay: false,
  };
}
