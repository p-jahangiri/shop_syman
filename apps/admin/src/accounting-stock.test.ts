import test from 'node:test';
import assert from 'node:assert/strict';
import {
  stockPreviewSchema,
  stockApplyInputSchema,
  stockApplicationSchema,
  readStockApplication,
  type StockApplyCommand,
} from './accounting-stock-contract.ts';
import {
  readStockJournal,
  stockJournalSnapshot,
  beginStockCommand,
  finishStockCommand,
  failStockCommand,
  clearStockJournal,
  interruptStockCommand,
} from './accounting-stock-journal.ts';
const id = (letter: string) => letter.repeat(32),
  v = 'AAAAAAAAAAE=',
  after = 'AAAAAAAAAAI=';
function fixture() {
  const preview = {
    schemaVersion: 1,
    reconciliation: {
      schemaVersion: 1,
      batchId: id('d'),
      batchPayloadHash: 'B'.repeat(64),
      companyKey: '000-C',
      externalWarehouseKey: '000-WH',
      observedAt: '2026-10-25T12:00:00.0000001+00:00',
      isDemo: true,
      warehouse: {
        id: id('c'),
        companyKey: '000-C',
        externalWarehouseKey: '000-WH',
        nameFa: 'انبار نمونه',
        nameEn: 'Sample warehouse',
        isActive: true,
        scope: 'whole_store_physical',
        version: v,
      },
      rows: [
        {
          rowNumber: 1,
          externalItemId: '000-item',
          externalUnitKey: 'BOX',
          sourceQuantity: '4',
          match: {
            linkId: id('a'),
            linkVersion: v,
            variantId: 'v1',
            sku: 'QA-SKU',
            nameFa: 'نمونه',
            nameEn: 'Sample',
            priceRial: '9007199254740993',
            isActive: true,
            isDigital: false,
            productStatus: 'Published',
          },
          unitMapping: {
            id: id('b'),
            originSystem: 'holoo',
            companyKey: '000-C',
            warehouseKey: '000-WH',
            sourceUnitKey: 'BOX',
            variantId: 'V1',
            numerator: 2,
            denominator: 1,
            nameFa: 'بسته',
            nameEn: 'Pack',
            isActive: true,
            version: v,
          },
          stock: {
            onHand: 6,
            reserved: 2,
            sourcingReserved: 1,
            available: 3,
            isSingleUnit: false,
            trackingMode: 'none',
            version: v,
            lastMovementAt: '2026-10-25T11:59:00Z',
          },
          targetOnHand: 8,
          delta: 2,
          issues: [],
        },
      ],
      fingerprint: 'D'.repeat(64),
      canApplyManual: false,
      canSyncLive: false,
    },
    catalogProofs: [
      {
        variantId: 'v1',
        productId: 'p1',
        variantVersion: v,
        productVersion: v,
        isActive: true,
        isDigital: false,
        isUsed: false,
      },
    ],
    candidates: [
      {
        rowNumber: 1,
        canApply: true,
        issues: [],
        priorApplicationId: null,
        lastAppliedObservationAt: null,
      },
    ],
    fingerprint: 'C'.repeat(64),
    canApplyManual: true,
    canSyncLive: false,
  };
  const command: StockApplyCommand = {
    batchId: id('d'),
    input: stockApplyInputSchema.parse({
      commandId: id('f'),
      previewFingerprint: preview.fingerprint,
      rowNumbers: [1],
      reason: 'Physical QA',
      acknowledgeWholeStorePhysical: true,
      acknowledgeUnpostedSalesReconciled: true,
    }),
    preview: stockPreviewSchema.parse(preview),
  };
  const result = {
    schemaVersion: 1,
    id: id('e'),
    batchId: id('d'),
    commandId: id('f'),
    payloadHash: 'A'.repeat(64),
    batchPayloadHash: 'B'.repeat(64),
    previewFingerprint: preview.fingerprint,
    companyKey: '000-C',
    externalWarehouseKey: '000-WH',
    warehouseId: id('c'),
    warehouseVersion: v,
    observedAt: preview.reconciliation.observedAt,
    appliedAt: '2026-10-25T12:01:00Z',
    reason: 'Physical QA',
    isDemo: true,
    acknowledgeWholeStorePhysical: true,
    acknowledgeUnpostedSalesReconciled: true,
    lines: [
      {
        rowNumber: 1,
        externalItemId: '000-item',
        externalUnitKey: 'BOX',
        sourceQuantity: '4',
        numerator: 2,
        denominator: 1,
        linkId: id('a'),
        linkVersion: v,
        mappingId: id('b'),
        mappingVersion: v,
        variantId: 'v1',
        productId: 'p1',
        variantVersion: v,
        productVersion: v,
        sku: 'QA-SKU',
        nameFa: 'نمونه',
        nameEn: 'Sample',
        beforeOnHand: 6,
        afterOnHand: 8,
        reserved: 2,
        sourcingReserved: 1,
        delta: 2,
        beforeStockVersion: v,
        afterStockVersion: after,
        movementId: '9007199254740993',
      },
    ],
    replayed: false,
  };
  return { command, result };
}
test('manual stock receipt binds every selected source, SKU, quantity, version and both commitments', () => {
  const { command, result } = fixture();
  assert.equal(readStockApplication(result, command).lines[0].movementId, '9007199254740993');
  for (const patch of [
    { commandId: id('a') },
    { batchId: id('a') },
    { previewFingerprint: 'E'.repeat(64) },
    { warehouseVersion: after },
    { reason: 'other' },
  ])
    assert.throws(() => readStockApplication({ ...result, ...patch }, command));
  for (const patch of [
    { mappingVersion: after },
    { productVersion: after },
    { sku: 'other' },
    { sourceQuantity: '5' },
    { reserved: 0 },
    { sourcingReserved: 0 },
    { beforeStockVersion: after },
  ])
    assert.throws(() =>
      readStockApplication({ ...result, lines: [{ ...result.lines[0], ...patch }] }, command),
    );
});
test('preview cannot mark a used/digital SKU, unbound row or changed stock math eligible', () => {
  const { command } = fixture();
  assert.equal(stockPreviewSchema.safeParse(command.preview).success, true);
  for (const changed of [
    { ...command.preview, catalogProofs: [{ ...command.preview.catalogProofs[0], isUsed: true }] },
    { ...command.preview, catalogProofs: [] },
    { ...command.preview, candidates: [{ ...command.preview.candidates[0], rowNumber: 2 }] },
    { ...command.preview, canApplyManual: false },
  ])
    assert.equal(stockPreviewSchema.safeParse(changed).success, false);
});
test('observation comparisons retain SQL seven-digit precision rather than truncating to milliseconds', () => {
  const { command } = fixture();
  const p = structuredClone(command.preview);
  p.candidates[0].lastAppliedObservationAt = '2026-10-25T12:00:00.0000000Z';
  assert.equal(stockPreviewSchema.safeParse(p).success, true);
  p.candidates[0].lastAppliedObservationAt = '2026-10-25T12:00:00.0000002Z';
  assert.equal(stockPreviewSchema.safeParse(p).success, false);
});
test('zero delta requires unchanged stock version and no invented movement', () => {
  const { result } = fixture();
  const line = {
    ...result.lines[0],
    sourceQuantity: '3',
    afterOnHand: 6,
    delta: 0,
    afterStockVersion: v,
    movementId: null,
  };
  assert.equal(stockApplicationSchema.safeParse({ ...result, lines: [line] }).success, true);
  assert.equal(
    stockApplicationSchema.safeParse({ ...result, lines: [{ ...line, movementId: '1' }] }).success,
    false,
  );
  assert.equal(
    stockApplicationSchema.safeParse({ ...result, lines: [{ ...line, afterStockVersion: after }] })
      .success,
    false,
  );
});
test('missing zero Stock stays missing and absent versions cannot hide a nonzero prior balance', () => {
  const { result } = fixture();
  const line = {
    ...result.lines[0],
    sourceQuantity: '0',
    beforeOnHand: 0,
    afterOnHand: 0,
    reserved: 0,
    sourcingReserved: 0,
    delta: 0,
    beforeStockVersion: null,
    afterStockVersion: null,
    movementId: null,
  };
  assert.equal(stockApplicationSchema.safeParse({ ...result, lines: [line] }).success, true);
  assert.equal(
    stockApplicationSchema.safeParse({
      ...result,
      lines: [{ ...line, beforeOnHand: 1, delta: -1, movementId: '1' }],
    }).success,
    false,
  );
});
test('both acknowledgements, a reason and a bounded distinct row set are required', () => {
  const { command } = fixture();
  for (const patch of [
    { acknowledgeWholeStorePhysical: false },
    { acknowledgeUnpostedSalesReconciled: false },
    { rowNumbers: [] },
    { rowNumbers: [1, 1] },
    { rowNumbers: [201] },
    { reason: ' ' },
  ])
    assert.equal(stockApplyInputSchema.safeParse({ ...command.input, ...patch }).success, false);
  assert.deepEqual(
    stockApplyInputSchema.parse({ ...command.input, rowNumbers: [2, 1] }).rowNumbers,
    [1, 2],
  );
});
test('pending stock body is owner-bound, deeply frozen and cannot be replaced after a lost response', () => {
  clearStockJournal();
  const { command, result } = fixture();
  beginStockCommand('owner', command);
  assert.equal(readStockJournal('other'), null);
  command.input.reason = 'external mutation';
  assert.equal(readStockJournal('owner')!.command.input.reason, 'Physical QA');
  const saved = readStockJournal('owner')!.command;
  assert.throws(() => {
    stockJournalSnapshot('owner')!.command.preview.reconciliation.rows[0].targetOnHand = 99;
  });
  assert.throws(() => beginStockCommand('owner', saved));
  assert.equal(failStockCommand('owner', saved, 'unknown', 'Lost200'), true);
  assert.throws(() =>
    beginStockCommand('owner', { ...saved, input: { ...saved.input, commandId: id('a') } }),
  );
  beginStockCommand('owner', saved);
  assert.equal(finishStockCommand('other', saved, result), false);
  assert.equal(finishStockCommand('owner', saved, result), true);
  assert.equal(readStockJournal('owner')!.state, 'done');
  clearStockJournal('other');
  assert.ok(readStockJournal('owner'));
  clearStockJournal('owner');
  assert.equal(readStockJournal('owner'), null);
});

test('stock journal preserves exact pending body as unknown during unavailable authentication', () => {
  clearStockJournal();
  const { command } = fixture();
  const bytes = JSON.stringify(command);
  beginStockCommand('owner', command);
  interruptStockCommand();
  assert.equal(readStockJournal('owner')!.state, 'unknown');
  assert.equal(JSON.stringify(readStockJournal('owner')!.command), bytes);
  beginStockCommand('owner', readStockJournal('owner')!.command);
  clearStockJournal();
});
