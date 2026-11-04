import type { PaymentItem, PaymentPage } from '@sayman/web-shared/lib/orders/payment-contract.ts';
export const paymentOrderId = 'a'.repeat(32),
  paymentAttemptId = 'b'.repeat(32),
  paymentCreated = '2026-10-26T10:00:00.1234567Z',
  paymentChanged = '2026-10-26T10:01:00.1234567Z',
  paymentUntil = '2026-10-26T11:00:00Z';
export function paymentItem(): PaymentItem {
  return {
    id: paymentAttemptId,
    orderId: paymentOrderId,
    state: 'verified',
    amountRial: '9007199254741000',
    currency: 'IRR',
    createdAt: paymentCreated,
    changedAt: paymentChanged,
    orderExpiresAt: paymentUntil,
    version: 'AAAAAAAAAAE=',
    containsDemo: true,
    verifiedAmountRial: '9007199254741000',
    verificationDisposition: 'applied',
    verificationReason: 'verified_amount_and_reservation',
    verifiedAt: paymentChanged,
  };
}
export function paymentPage(): PaymentPage {
  return {
    schemaVersion: 1,
    filter: { state: null, orderId: paymentOrderId },
    items: [paymentItem()],
    nextCursor: null,
  };
}
