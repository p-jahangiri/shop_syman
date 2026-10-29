import type {
  AdminShipment,
  Shipment,
  ShipmentCommand,
  ShipmentResult,
} from './order-shipment-contract.ts';
export const shipmentOrderId = 'a'.repeat(32),
  shipmentOwner = 'qa-owner',
  shipmentCommandId = 'b'.repeat(32),
  shipmentAt = '2026-10-26T10:00:00.1234567Z',
  shipmentLater = '2026-10-26T10:01:00.1234567Z';
export function shipmentLine() {
  return {
    lineKey: 'LINE',
    variantId: 'variant',
    productId: 'product',
    sku: 'QA-IMEI',
    name: 'گوشی نمونه / Sample phone',
    label: 'QA',
    warranty: 'Unknown',
    quantity: 1,
    trackingMode: 'imei' as const,
  };
}
export function shipmentUnit() {
  return {
    unitId: 'c'.repeat(32),
    lineKey: 'LINE',
    variantId: 'variant',
    serial: null,
    imei1: '990000000000002',
    imei2: null,
    warrantyUntil: null,
  };
}
export function shipment(): Shipment {
  return {
    id: 'd'.repeat(32),
    orderId: shipmentOrderId,
    state: 'packed',
    version: 'AAAAAAAAAAI=',
    packingRevision: 1,
    packedAt: shipmentAt,
    dispatchedAt: null,
    deliveredAt: null,
    carrierNameFa: null,
    carrierNameEn: null,
    trackingNumber: null,
    containsDemo: true,
    unitDetailsVisible: true,
    lines: [shipmentLine()],
    units: [shipmentUnit()],
  };
}
export function shipmentPreview(): AdminShipment {
  return {
    schemaVersion: 1,
    orderId: shipmentOrderId,
    ownerId: shipmentOwner,
    orderState: 'Paid',
    orderVersion: 'AAAAAAAAAAE=',
    containsDemo: true,
    shipment: null,
    packingLines: [shipmentLine()],
    packingUnits: [shipmentUnit()],
    canPack: true,
    canRepack: false,
    canDispatch: false,
    canDeliver: false,
    blockers: [],
    inventoryFingerprint: 'A'.repeat(64),
    liveCarrierConfigured: false,
  };
}
export function shipmentCommand(): ShipmentCommand {
  return {
    orderId: shipmentOrderId,
    before: shipmentPreview(),
    input: {
      ownerId: shipmentOwner,
      commandId: shipmentCommandId,
      action: 'pack',
      orderVersion: 'AAAAAAAAAAE=',
      shipmentVersion: null,
      inventoryFingerprint: 'A'.repeat(64),
      reason: 'Synthetic QA',
      acknowledge: true,
      carrierNameFa: null,
      carrierNameEn: null,
      trackingNumber: null,
      occurredAt: null,
    },
  };
}
export function shipmentResult(): ShipmentResult {
  return {
    schemaVersion: 1,
    commandId: shipmentCommandId,
    payloadHash: 'B'.repeat(64),
    orderId: shipmentOrderId,
    action: 'pack',
    inventoryFingerprint: 'A'.repeat(64),
    reason: 'Synthetic QA',
    recordedAt: shipmentAt,
    orderVersion: 'AAAAAAAAAAM=',
    shipment: shipment(),
    replayed: false,
  };
}
export function dispatchedShipment(): Shipment {
  return {
    ...shipment(),
    state: 'dispatched',
    version: 'AAAAAAAAAAM=',
    dispatchedAt: shipmentLater,
    carrierNameFa: 'حمل نمونه',
    carrierNameEn: 'Sample carrier',
    trackingNumber: 'QA-001',
  };
}
