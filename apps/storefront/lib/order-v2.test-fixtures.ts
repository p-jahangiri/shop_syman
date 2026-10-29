import { quote4Snapshot, quote4Method } from './quote-v4.test-fixtures.ts';
export function quote5Snapshot(saved = true, enabled = true) {
  const previous = quote4Snapshot(saved),
    subtotal = previous.itemsSubtotalRial;
  return {
    ...previous,
    schemaVersion: 5,
    lines: previous.lines.map((line) => ({
      ...line,
      accepted: line.accepted
        ? {
            ...line.accepted,
            revision: 1,
            snapshotHash: 'C'.repeat(64),
            termsFa: 'شرایط نمونهٔ آزمایش',
            termsEn: 'QA sample accepted terms',
            materialFingerprint: 'D'.repeat(64),
            containsDemo: true,
          }
        : null,
    })),
    shippingRial: '7',
    taxRial: '0',
    payableTotalRial: (BigInt(subtotal) + 7n).toString(),
    blockers: [saved ? 'gateway_unconfigured' : 'method_required'],
    chargeRules: {
      ...previous.chargeRules,
      version: 'AAAAAAAAAAQ=',
      shippingMode: 'flat',
      shippingName: 'QA delivery',
      shippingFeeRial: '7',
      shippingReason: 'flat',
      taxMode: 'exempt',
    },
    temporaryOrder: {
      canCreate: saved && enabled,
      reservationMinutes: 15,
      requiresSignIn: true,
      blockers: enabled ? (saved ? [] : ['method_required']) : ['temporary_orders_disabled'],
      settingsVersion: 'AAAAAAAAAAU=',
    },
  };
}
export const order2Id = 'abcdef0123456789abcdef0123456789';
export const order2RequestId = '12345678-1234-4234-8234-123456789abc';
export function order2Input() {
  return {
    quoteId: quote5Snapshot().quoteId!,
    requestId: order2RequestId,
    contactName: 'QA Customer',
    contactPhone: '09123456789',
    delivery: {
      countryCode: 'IR' as const,
      province: 'Tehran',
      city: 'Tehran',
      address: 'A sufficiently long QA address',
      postalCode: '1234567890',
    },
    note: null,
    acknowledgeTemporary: true as const,
  };
}
export function order2Detail() {
  const quote = quote5Snapshot();
  return {
    schemaVersion: 2,
    originalSnapshotVersion: 2,
    summary: {
      id: order2Id,
      reference: 'SM-9007199254740993',
      locale: 'en' as const,
      state: 'AwaitingPayment',
      createdAt: '2026-10-24T12:00:01Z',
      expiresAt: '2026-10-24T12:04:00Z',
      payableTotalRial: quote.payableTotalRial,
      itemCount: 3,
      version: 'AAAAAAAAAAY=',
      originalSnapshotVersion: 2,
    },
    quoteId: quote.quoteId!,
    contactName: 'QA Customer',
    contactPhone: '09123456789',
    delivery: order2Input().delivery,
    note: '',
    shippingRequired: true,
    methodName: quote4Method.name,
    shippingName: 'QA delivery',
    itemsSubtotalRial: quote.itemsSubtotalRial,
    goodsTotalRial: quote.goodsTotalRial,
    shippingRial: '7',
    taxRial: '0',
    payableTotalRial: quote.payableTotalRial,
    taxIncluded: false,
    lines: quote.lines,
    events: [
      {
        state: 'AwaitingPayment',
        at: '2026-10-24T12:00:01Z',
        reason: 'temporary_order_v2_created',
      },
    ],
    canCancel: true,
    canPay: false,
    paymentAvailability: 'gateway_unconfigured',
  };
}
