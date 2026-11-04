export const digitalOrder = '1'.repeat(32),
  digitalDelivery = '2'.repeat(32),
  digitalCommand = '3'.repeat(32),
  digitalItem = '4'.repeat(32);
export const digitalVersion = 'AAAAAAAAAAE=',
  digitalNextVersion = 'AAAAAAAAAAI=';
export function digitalSummary() {
  return {
    id: digitalDelivery,
    availableAt: '2026-10-30T08:00:00Z',
    lines: [
      {
        lineKey: 'DIGITAL',
        variantId: 'CODE_SKU',
        productId: 'GAME',
        sku: 'DIGITAL-1',
        name: 'کد بازی',
        label: 'کد خصوصی',
        quantity: 1,
      },
    ],
  };
}
export function digitalPage() {
  const l = digitalSummary().lines[0];
  return {
    schemaVersion: 1 as const,
    orderId: digitalOrder,
    ownerId: 'OWNER',
    orderState: 'Paid' as const,
    orderVersion: digitalVersion,
    inventoryFingerprint: 'A'.repeat(64),
    containsDemo: false,
    canDeliver: true,
    creditAuthorized: true,
    remainingDeliverySlots: 64,
    lines: [
      {
        lineKey: l.lineKey,
        variantId: l.variantId,
        productId: l.productId,
        sku: l.sku,
        name: l.name,
        label: l.label,
        ordered: 2,
        available: 0,
        remaining: 2,
      },
    ],
    deliveries: [],
    blockers: [],
  };
}
export function blockedDigitalPage() {
  return {
    ...digitalPage(),
    orderState: 'AwaitingPayment' as const,
    inventoryFingerprint: null,
    canDeliver: false,
    creditAuthorized: false,
    blockers: ['payment_not_confirmed', 'reservation_not_allocated'],
  };
}
export function digitalInput() {
  return {
    ownerId: 'OWNER',
    commandId: digitalCommand,
    orderVersion: digitalVersion,
    inventoryFingerprint: 'A'.repeat(64),
    reason: 'بازبینی و تحویل',
    acknowledge: true as const,
    lines: [{ lineKey: 'DIGITAL', contents: ['PRIVATE-TEST-CODE'] }],
  };
}
export function digitalResult() {
  return {
    schemaVersion: 1 as const,
    commandId: digitalCommand,
    orderId: digitalOrder,
    orderVersion: digitalNextVersion,
    delivery: digitalSummary(),
    replayed: false,
  };
}
export function digitalContent() {
  return {
    schemaVersion: 1 as const,
    orderId: digitalOrder,
    deliveryId: digitalDelivery,
    availableAt: digitalSummary().availableAt,
    items: [{ id: digitalItem, lineKey: 'DIGITAL', content: 'PRIVATE-TEST-CODE' }],
  };
}
