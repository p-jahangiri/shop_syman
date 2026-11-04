import type { RmaContext, RmaDetail, RmaPolicyData } from '../lib/orders/rma-contract.ts';
export const rmaOrderId = '11111111111111111111111111111111',
  rmaCaseId = '22222222222222222222222222222222',
  rmaPolicyId = '33333333333333333333333333333333',
  rmaCommandId = '44444444444444444444444444444444';
export function rmaPolicy(): RmaPolicyData {
  return {
    id: rmaPolicyId,
    revision: 1,
    version: 'AAAAAAAAAAE=',
    enabled: true,
    physicalReturns: true,
    digitalComplaints: true,
    conditionsFa: 'سه روز از تحویل واقعی یا آماده‌شدن دیجیتال؛ فقط بررسی درخواست.',
    conditionsEn: 'Three days from actual delivery or digital availability; request review only.',
    windowMode: 'deliveryDays',
    windowDays: 3,
    maxOpenPerOwner: null,
    at: '2026-10-30T09:00:00Z',
  };
}
export function rmaContext(): RmaContext {
  return {
    schemaVersion: 1,
    orderId: rmaOrderId,
    originalSnapshotVersion: 2,
    orderVersion: 'AAAAAAAAAAE=',
    orderState: 'Fulfilled',
    snapshotHash: 'A'.repeat(64),
    policy: {
      schemaVersion: 1,
      current: rmaPolicy(),
      canRefund: false,
      refundAvailability: 'provider_unconfigured',
    },
    lines: [
      {
        lineKey: 'physical',
        variantId: 'p-1',
        sku: 'SKU-P',
        name: 'گوشی تاریخی',
        label: 'رنگ ثبت‌شده',
        isDigital: false,
        orderedQuantity: 2,
        handedOffOrAvailableQuantity: 2,
        requestableQuantity: 1,
      },
      {
        lineKey: 'digital',
        variantId: 'd-1',
        sku: 'SKU-D',
        name: 'بازی دیجیتال',
        label: 'نسخهٔ سفارش',
        isDigital: true,
        orderedQuantity: 1,
        handedOffOrAvailableQuantity: 1,
        requestableQuantity: 1,
      },
    ],
    canRequest: true,
    blockers: [],
    canRefund: false,
    canRestock: false,
    canReship: false,
  };
}
export function rmaDetail(staff = false): RmaDetail {
  return {
    schemaVersion: 1,
    case: {
      id: rmaCaseId,
      reference: 'RMA-1',
      orderId: rmaOrderId,
      locale: 'fa',
      kind: 'physicalReturn',
      state: 'submitted',
      outcome: null,
      isOpen: true,
      version: 'AAAAAAAAAAI=',
      itemCount: 1,
      createdAt: '2026-10-30T10:00:00Z',
      changedAt: '2026-10-30T10:00:00Z',
      ...(staff ? { ownerId: 'CUSTOMER' } : {}),
    },
    originalSnapshotVersion: 2,
    snapshotHash: 'A'.repeat(64),
    policy: rmaPolicy(),
    reason: 'دلیل خصوصی مشتری',
    lines: [
      {
        lineKey: 'physical',
        variantId: 'p-1',
        sku: 'SKU-P',
        name: 'گوشی تاریخی',
        label: 'رنگ ثبت‌شده',
        isDigital: false,
        orderedQuantity: 2,
        quantity: 1,
        handedOffOrAvailableQuantity: 2,
      },
    ],
    events: [
      {
        sequence: '1',
        action: 'submitted',
        state: 'submitted',
        outcome: null,
        author: 'customer',
        at: '2026-10-30T10:00:00Z',
        message: null,
      },
    ],
    canWithdraw: true,
    canRefund: false,
    refundAvailability: 'provider_unconfigured',
    canReceive: false,
    canRestock: false,
    canReship: false,
  };
}
export function rmaResult(staff = false) {
  return {
    schemaVersion: 1 as const,
    commandId: rmaCommandId,
    payloadHash: 'B'.repeat(64),
    replayed: false,
    case: rmaDetail(staff),
  };
}
export function rmaPublicPolicy() {
  const {
    enabled,
    physicalReturns,
    digitalComplaints,
    conditionsFa,
    conditionsEn,
    windowMode,
    windowDays,
  } = rmaPolicy();
  return {
    schemaVersion: 1,
    configured: true,
    enabled,
    physicalReturns,
    digitalComplaints,
    conditionsFa,
    conditionsEn,
    windowMode,
    windowDays,
    canRefund: false,
    refundAvailability: 'provider_unconfigured',
  };
}
export function rmaCreateBody() {
  return {
    policyRevisionId: rmaPolicyId,
    orderVersion: 'AAAAAAAAAAE=',
    kind: 'physicalReturn',
    lines: [{ lineKey: 'physical', quantity: 1 }],
    reason: 'دلیل خصوصی مشتری',
    acknowledgeNoFinancialAction: true,
  };
}
