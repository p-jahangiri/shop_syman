import {
  parcelCommandSchema,
  type ParcelPage,
  type ParcelResult,
  type CustomerFulfillment,
} from '../lib/orders/order-parcel-contract.ts';
export const parcelOrder = 'a'.repeat(32),
  parcelId = 'b'.repeat(32),
  parcelCmd = 'c'.repeat(32),
  parcelAt = '2026-10-28T12:00:00.1234567+00:00',
  parcelVersion = 'AAAAAAAAAAE=',
  parcelNext = 'AAAAAAAAAAI=',
  parcelHash = 'A'.repeat(64);
export const parcelLine = {
  lineKey: 'LINE_A',
  variantId: 'VARIANT_A',
  productId: 'PRODUCT_A',
  sku: 'QA-SKU',
  name: 'Synthetic product',
  label: 'Synthetic option',
  warranty: 'Recorded warranty only',
  quantity: 2,
  trackingMode: 'none' as const,
};
export function parcelPage(): ParcelPage {
  return {
    schemaVersion: 1,
    orderId: parcelOrder,
    ownerId: 'OWNER',
    orderState: 'Paid',
    orderVersion: parcelVersion,
    mode: 'none',
    containsDemo: true,
    inventoryFingerprint: parcelHash,
    dispatchCount: 0,
    activeParcelCount: 0,
    lines: [
      {
        lineKey: 'LINE_A',
        variantId: 'VARIANT_A',
        ordered: 2,
        packed: 0,
        dispatched: 0,
        delivered: 0,
        remaining: 2,
      },
    ],
    orderLines: [{ ...parcelLine }],
    availableUnits: [],
    packedUnits: [],
    parcels: [],
    nextAfter: null,
    canPack: true,
    creditAuthorized: true,
    blockers: [],
  };
}
export function parcelCommand() {
  return parcelCommandSchema.parse({
    orderId: parcelOrder,
    input: {
      ownerId: 'OWNER',
      commandId: parcelCmd,
      action: 'pack',
      orderVersion: parcelVersion,
      parcelId: null,
      parcelVersion: null,
      inventoryFingerprint: parcelHash,
      reason: 'Synthetic explicit review',
      acknowledge: true,
      reference: 'SYNTHETIC-1',
      lines: [{ lineKey: 'LINE_A', quantity: 1, unitIds: [] }],
      carrierNameFa: null,
      carrierNameEn: null,
      trackingNumber: null,
      occurredAt: null,
    },
    before: parcelPage(),
    previous: null,
  });
}
export function parcelResult(): ParcelResult {
  return {
    schemaVersion: 1,
    commandId: parcelCmd,
    payloadHash: parcelHash,
    orderId: parcelOrder,
    action: 'pack',
    inventoryFingerprint: parcelHash,
    reason: 'Synthetic explicit review',
    recordedAt: parcelAt,
    orderVersion: parcelNext,
    detail: {
      schemaVersion: 1,
      orderId: parcelOrder,
      parcel: {
        id: parcelId,
        number: '9007199254740993',
        reference: 'SYNTHETIC-1',
        state: 'packed',
        version: parcelNext,
        packingRevision: 1,
        packedAt: parcelAt,
        dispatchedAt: null,
        deliveredAt: null,
        voidedAt: null,
        carrierNameFa: null,
        carrierNameEn: null,
        trackingNumber: null,
        lines: [{ lineKey: 'LINE_A', quantity: 1 }],
      },
      containsDemo: true,
      unitDetailsVisible: true,
      lines: [{ ...parcelLine, quantity: 1 }],
      units: [],
    },
    replayed: false,
  };
}
export function customerFulfillment(): CustomerFulfillment {
  return {
    schemaVersion: 1,
    orderId: parcelOrder,
    mode: 'none',
    single: { schemaVersion: 1, orderId: parcelOrder, shipment: null, manualCarrierReport: false },
    parcels: [],
    nextAfter: null,
    manualCarrierReport: false,
  };
}
