import test from 'node:test';
import assert from 'node:assert/strict';
import {
  convertAccountingQuantity,
  warehouseInputSchema,
  warehousePageSchema,
  readWarehouseResult,
  readReconciliation,
  type WarehouseCommand,
} from '../src/api/contracts/accounting/accounting-reconciliation-contract.ts';
import {
  readWarehouseJournal,
  keepWarehouseCommand,
  finishWarehouseCommand,
  clearWarehouseJournal,
} from '../src/state/accounting/accounting-warehouse-journal.ts';
const id = 'a'.repeat(32),
  version = 'AAAAAAAAAAE=',
  next = 'AAAAAAAAAAI=';
const command: WarehouseCommand = {
  targetId: id,
  input: {
    commandId: 'b'.repeat(32),
    companyKey: '000-C',
    externalWarehouseKey: '000-W',
    nameFa: 'انبار نمونه',
    nameEn: 'Sample warehouse',
    isActive: false,
    acknowledgeWholeStorePhysical: false,
    version: null,
  },
};
const result = {
  schemaVersion: 1,
  commandId: command.input.commandId,
  targetId: id,
  payloadHash: 'A'.repeat(64),
  warehouse: {
    id,
    companyKey: '000-C',
    externalWarehouseKey: '000-W',
    nameFa: 'انبار نمونه',
    nameEn: 'Sample warehouse',
    isActive: false,
    scope: 'whole_store_physical',
    version,
  },
  replayed: false,
};
const reconciliation = {
  schemaVersion: 1,
  batchId: 'c'.repeat(32),
  batchPayloadHash: 'D'.repeat(64),
  companyKey: '000-C',
  externalWarehouseKey: '000-W',
  observedAt: '2026-10-25T12:00:00+00:00',
  isDemo: true,
  warehouse: result.warehouse,
  rows: [
    {
      rowNumber: 1,
      externalItemId: '000-item',
      externalUnitKey: 'BOX',
      sourceQuantity: '0.5',
      match: {
        linkId: 'e'.repeat(32),
        linkVersion: version,
        variantId: 'V1',
        sku: 'SKU1',
        nameFa: 'نمونه',
        nameEn: 'Sample',
        priceRial: '9007199254740993',
        isActive: true,
        isDigital: false,
        productStatus: 'Draft',
      },
      unitMapping: {
        id: 'f'.repeat(32),
        originSystem: 'holoo',
        companyKey: '000-C',
        warehouseKey: '000-W',
        sourceUnitKey: 'BOX',
        variantId: 'v1',
        numerator: 2,
        denominator: 1,
        nameFa: 'بسته',
        nameEn: 'Box',
        isActive: true,
        version,
      },
      stock: {
        onHand: 6,
        reserved: 2,
        sourcingReserved: 1,
        available: 3,
        isSingleUnit: false,
        trackingMode: 'none',
        version,
        lastMovementAt: '2026-10-25T11:00:00Z',
      },
      targetOnHand: 1,
      delta: -5,
      issues: ['warehouse_mapping_inactive', 'stock_below_commitments'],
    },
  ],
  fingerprint: 'F'.repeat(64),
  canApplyManual: false,
  canSyncLive: false,
};
test('source quantity conversion is exact, includes zero, and rejects precision loss', () => {
  for (const [raw, n, d, want] of [
    ['0', 1, 1, 0],
    ['0.5', 2, 1, 1],
    ['1.50', 2, 1, 3],
    ['0002', 12, 1, 24],
    ['1000000', 1, 1, 1000000],
  ] as const)
    assert.equal(convertAccountingQuantity(raw, n, d), want);
  for (const raw of [
    '-1',
    '1e3',
    '۱',
    '1,000',
    ' 1',
    '1.000000001',
    '99999999999999999999',
    '1000001',
  ])
    assert.throws(() => convertAccountingQuantity(raw, 1, 1));
  assert.throws(() => convertAccountingQuantity('0.5', 1, 1));
  assert.throws(() => convertAccountingQuantity('0.00000001', 1000000, 1));
});
test('activating a whole-store warehouse requires explicit acknowledgement', () => {
  assert.equal(warehouseInputSchema.safeParse(command.input).success, true);
  assert.equal(warehouseInputSchema.safeParse({ ...command.input, isActive: true }).success, false);
  assert.equal(
    warehouseInputSchema.safeParse({
      ...command.input,
      isActive: true,
      acknowledgeWholeStorePhysical: true,
    }).success,
    true,
  );
  assert.equal(
    warehouseInputSchema.safeParse({ ...command.input, companyKey: ' 000-C' }).success,
    false,
  );
});
test('receipt binds command, resource, historical fields and changed version', () => {
  assert.equal(readWarehouseResult(result, command).warehouse.id, id);
  for (const changed of [
    { ...result, commandId: '9'.repeat(32) },
    { ...result, warehouse: { ...result.warehouse, nameFa: 'دیگر' } },
    { ...result, targetId: '9'.repeat(32) },
  ])
    assert.throws(() => readWarehouseResult(changed, command));
  assert.throws(() =>
    readWarehouseResult(result, { ...command, input: { ...command.input, version } }),
  );
  assert.equal(
    readWarehouseResult(
      { ...result, warehouse: { ...result.warehouse, version: next } },
      { ...command, input: { ...command.input, version } },
    ).warehouse.version,
    next,
  );
});
test('warehouse page is bounded and never accepts two active sources in one page', () => {
  const page = { schemaVersion: 1, pageSize: 20, items: [result.warehouse], nextCursor: null };
  assert.equal(warehousePageSchema.safeParse(page).success, true);
  assert.equal(
    warehousePageSchema.safeParse({
      ...page,
      items: [
        { ...result.warehouse, isActive: true },
        { ...result.warehouse, id: '8'.repeat(32), isActive: true },
      ],
    }).success,
    false,
  );
  assert.equal(warehousePageSchema.safeParse({ ...page, nextCursor: undefined }).success, false);
});
test('reconciliation ties units, scope, target, delta and all three stock balances', () => {
  assert.equal(readReconciliation(reconciliation, reconciliation.batchId).rows[0].targetOnHand, 1);
  const change = (patch: Record<string, unknown>) => ({
    ...reconciliation,
    rows: [{ ...reconciliation.rows[0], ...patch }],
  });
  for (const raw of [
    change({ targetOnHand: 2 }),
    change({ delta: 0 }),
    change({ stock: { ...reconciliation.rows[0].stock, available: 6 } }),
    change({ unitMapping: { ...reconciliation.rows[0].unitMapping, warehouseKey: 'other' } }),
    change({ match: null }),
    { ...reconciliation, warehouse: { ...result.warehouse, companyKey: 'other' } },
    { ...reconciliation, canApplyManual: true },
    { ...reconciliation, canSyncLive: true },
  ])
    assert.throws(() => readReconciliation(raw, reconciliation.batchId));
  assert.throws(() => readReconciliation(reconciliation, '9'.repeat(32)));
});
test('warehouse pending body is deep frozen by copying, owner-bound and blocks replacement', () => {
  clearWarehouseJournal();
  const supplied = structuredClone(command);
  keepWarehouseCommand('owner', supplied);
  supplied.input.nameFa = 'تغییر بیرونی';
  assert.equal(readWarehouseJournal('owner')!.command.input.nameFa, command.input.nameFa);
  assert.equal(readWarehouseJournal('other'), null);
  assert.throws(() =>
    keepWarehouseCommand('owner', {
      ...command,
      input: { ...command.input, commandId: '8'.repeat(32) },
    }),
  );
  assert.equal(finishWarehouseCommand('other', command, result), false);
  assert.equal(finishWarehouseCommand('owner', command, result), true);
  clearWarehouseJournal('other');
  assert.ok(readWarehouseJournal('owner')?.result);
  clearWarehouseJournal('owner');
  assert.equal(readWarehouseJournal('owner'), null);
});
