import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adminShipmentSchema,
  customerShipmentSchema,
  readAdminShipment,
  readCustomerShipment,
  readShipmentResult,
  shipmentInputSchema,
  shipmentTicks,
} from '@sayman/web-shared/lib/orders/order-shipment-contract.ts';
import {
  shipment,
  shipmentPreview,
  shipmentCommand,
  shipmentResult,
  shipmentOrderId,
  shipmentOwner,
  shipmentAt,
  shipmentLater,
  dispatchedShipment,
} from '@sayman/web-shared/testing/order-shipment.test-fixtures.ts';
test('shipment decoders bind the exact owner, order, reviewed package and immutable command', () => {
  const command = shipmentCommand(),
    result = shipmentResult();
  assert.deepEqual(readShipmentResult(result, command), result);
  assert.deepEqual(readShipmentResult({ ...result, replayed: true }, command), {
    ...result,
    replayed: true,
  });
  assert.deepEqual(
    readAdminShipment(shipmentPreview(), shipmentOwner, shipmentOrderId),
    shipmentPreview(),
  );
  assert.throws(() => readAdminShipment(shipmentPreview(), 'other', shipmentOrderId));
  for (const bad of [
    { ...result, commandId: 'f'.repeat(32) },
    { ...result, reason: 'other' },
    { ...result, inventoryFingerprint: 'C'.repeat(64) },
    { ...result, shipment: { ...result.shipment, packingRevision: 2 } },
    {
      ...result,
      shipment: {
        ...result.shipment,
        units: [{ ...result.shipment.units[0], warrantyUntil: shipmentAt }],
      },
    },
    { ...result, amountRial: '1' },
  ])
    assert.throws(() => readShipmentResult(bad, command));
});
test('customer decoder refuses premature private unit details and foreign order data', () => {
  const packed = {
    schemaVersion: 1 as const,
    orderId: shipmentOrderId,
    shipment: { ...shipment(), unitDetailsVisible: false, units: [] },
    manualCarrierReport: false,
  };
  assert.deepEqual(readCustomerShipment(packed, shipmentOrderId), packed);
  assert.equal(
    customerShipmentSchema.safeParse({ ...packed, shipment: shipment() }).success,
    false,
  );
  assert.throws(() => readCustomerShipment(packed, 'f'.repeat(32)));
  const sent = { ...packed, shipment: dispatchedShipment(), manualCarrierReport: true };
  assert.equal(readCustomerShipment(sent, shipmentOrderId).shipment!.units.length, 1);
  assert.equal(
    customerShipmentSchema.safeParse({ ...sent, manualCarrierReport: false }).success,
    false,
  );
  assert.equal(
    customerShipmentSchema.safeParse({ ...sent, shipment: { ...sent.shipment, units: [] } })
      .success,
    false,
  );
});
test('packing readiness rejects missing units, impossible capabilities and malformed versions', () => {
  const p = shipmentPreview();
  for (const bad of [
    { ...p, packingUnits: [] },
    { ...p, canDispatch: true },
    { ...p, orderState: 'AwaitingPayment' },
    { ...p, orderVersion: 'AAAAAAAAAAB=' },
    { ...p, liveCarrierConfigured: true },
  ])
    assert.equal(adminShipmentSchema.safeParse(bad).success, false);
  assert.equal(
    adminShipmentSchema.safeParse({
      ...p,
      canPack: false,
      blockers: ['tracked_units_incomplete'],
      packingUnits: [],
    }).success,
    true,
  );
});
test('packing, dispatch and delivery inputs cannot express payment or unrelated facts', () => {
  const input = shipmentCommand().input;
  assert.deepEqual(shipmentInputSchema.parse(input), input);
  for (const bad of [
    { ...input, action: 'paid' },
    { ...input, amountRial: '1' },
    { ...input, acknowledge: false },
    { ...input, carrierNameEn: 'unrelated' },
    { ...input, action: 'repack' },
    {
      ...input,
      action: 'deliver',
      shipmentVersion: 'AAAAAAAAAAI=',
      occurredAt: shipmentLater,
      trackingNumber: 'unexpected',
    },
  ])
    assert.equal(shipmentInputSchema.safeParse(bad).success, false);
});
test('explicit repack advances one revision while retaining the original package identity', () => {
  const command = shipmentCommand();
  command.before = {
    ...command.before,
    shipment: shipment(),
    canPack: false,
    canRepack: true,
    blockers: ['packed_inventory_changed'],
  };
  command.input = {
    ...command.input,
    action: 'repack',
    shipmentVersion: command.before.shipment!.version,
  };
  const result = {
    ...shipmentResult(),
    action: 'repack',
    recordedAt: shipmentLater,
    shipment: {
      ...shipment(),
      packingRevision: 2,
      version: 'AAAAAAAAAAM=',
      packedAt: shipmentLater,
    },
  };
  assert.equal(readShipmentResult(result, command).shipment.packingRevision, 2);
  for (const bad of [
    { ...result, shipment: { ...result.shipment, packingRevision: 3 } },
    { ...result, shipment: { ...result.shipment, id: 'f'.repeat(32) } },
    { ...result, shipment: { ...result.shipment, version: shipment().version } },
  ])
    assert.throws(() => readShipmentResult(bad, command));
});
test('dispatch receipt preserves carrier and actual time at SQL seven-digit precision', () => {
  const command = shipmentCommand();
  command.before = { ...command.before, shipment: shipment(), canPack: false, canDispatch: true };
  command.input = {
    ...command.input,
    action: 'dispatch',
    shipmentVersion: shipment().version,
    carrierNameFa: 'حمل نمونه',
    carrierNameEn: 'Sample carrier',
    trackingNumber: 'QA-001',
    occurredAt: shipmentLater,
  };
  const result = {
    ...shipmentResult(),
    action: 'dispatch',
    recordedAt: shipmentLater,
    shipment: dispatchedShipment(),
  };
  assert.equal(readShipmentResult(result, command).shipment.state, 'dispatched');
  assert.equal(
    shipmentTicks(shipmentAt) - shipmentTicks(shipmentAt.replace('1234567', '1234566')),
    1n,
  );
  assert.throws(() =>
    readShipmentResult(
      {
        ...result,
        shipment: { ...result.shipment, dispatchedAt: shipmentLater.replace('1234567', '1234566') },
      },
      command,
    ),
  );
  assert.throws(() =>
    readShipmentResult(
      { ...result, shipment: { ...result.shipment, trackingNumber: 'other' } },
      command,
    ),
  );
});
