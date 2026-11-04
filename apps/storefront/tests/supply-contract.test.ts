import test from 'node:test';
import assert from 'node:assert/strict';
import {
  supplyDetailSchema,
  supplyEventsSchema,
  supplyPageSchema,
  supplySummarySchema,
} from '../lib/market/supply-contract.ts';
import {
  supplyTestDetail as detail,
  supplyTestEvents as events,
  supplyTestItem as line,
  supplyTestPage as page,
  supplyTestSummary as summary,
} from './supply.test-fixtures.ts';

test('supply customer contract keeps actual counts, unknown ETA and explicit nonfinancial flags', () => {
  const value = supplyDetailSchema.parse(detail);
  assert.equal(value.task.expectedAt, null);
  assert.equal(value.task.receivedQuantity, 1);
  assert.equal(value.lines[0].remainingQuantity, 2);
  assert.equal(value.reservedForRequest, false);
  assert.equal(value.canCheckout, false);
  assert.equal(value.canPay, false);
  assert.equal(supplyPageSchema.parse(page).startCandidate, null);
  const zero = {
    ...detail,
    task: {
      ...summary,
      state: 'PendingSupply',
      effectiveState: 'PendingSupply',
      receiptProgress: 'None',
      receivedQuantity: 0,
      remainingQuantity: 3,
    },
    lines: [{ ...line, receivedQuantity: 0, remainingQuantity: 3 }],
  };
  assert.equal(supplyDetailSchema.parse(zero).lines[0].receivedQuantity, 0);
});
test('supply receipt completion preserves open workflow and never produces checkout readiness', () => {
  const complete = {
    ...summary,
    receiptProgress: 'Complete',
    effectiveState: 'Received',
    receivedQuantity: 3,
    remainingQuantity: 0,
  };
  assert.equal(supplySummarySchema.parse(complete).isOpen, true);
  for (const state of ['Cancelled', 'Failed'])
    assert.equal(
      supplySummarySchema.parse({
        ...complete,
        state,
        effectiveState: state,
        isOpen: false,
        requiresNewOffer: true,
      }).effectiveState,
      state,
    );
  for (const value of [
    { ...complete, effectiveState: 'ReadyForCheckout' },
    { ...complete, isOpen: false },
    {
      ...summary,
      state: 'Cancelled',
      effectiveState: 'Cancelled',
      isOpen: false,
      requiresNewOffer: false,
    },
  ])
    assert.equal(supplySummarySchema.safeParse(value).success, false);
});
test('supply customer contract rejects private supplier notes, stock, prices and staff start authority at every boundary', () => {
  for (const extra of [
    { ownerId: 'other' },
    { actorId: 'staff' },
    { sourceKey: 'private' },
    { sourceNameFa: 'منبع' },
    { reference: 'supplier-order' },
    { internalNote: 'secret' },
    { unitPriceRial: '1' },
    { serial: 'private' },
    { imei1: 'private' },
  ]) {
    assert.equal(supplyDetailSchema.safeParse({ ...detail, ...extra }).success, false);
    assert.equal(
      supplyDetailSchema.safeParse({ ...detail, task: { ...summary, ...extra } }).success,
      false,
    );
    assert.equal(
      supplyDetailSchema.safeParse({ ...detail, lines: [{ ...line, ...extra }] }).success,
      false,
    );
  }
  for (const extra of [
    { reservedForRequest: true },
    { canPay: true },
    { canCheckout: true },
    { canReceive: true },
  ])
    assert.equal(supplyDetailSchema.safeParse({ ...detail, ...extra }).success, false);
  assert.equal(supplyPageSchema.safeParse({ ...page, pageSize: 50 }).success, false);
  assert.equal(
    supplyPageSchema.safeParse({
      ...page,
      startCandidate: {
        offerId: summary.offerId,
        acceptanceId: summary.acceptanceId,
        offerVersion: summary.version,
        termsHash: 'A'.repeat(64),
        purchaseUntil: summary.purchaseUntil,
      },
    }).success,
    false,
  );
});
test('supply counts remain exact and coherent per line and across the accepted task', () => {
  for (const value of [
    { ...line, receivedQuantity: 4 },
    { ...line, receivedQuantity: -1 },
    { ...line, receivedQuantity: 1.5 },
    { ...line, remainingQuantity: 3 },
    { ...line, requiredQuantity: 1000001 },
    { ...line, requiredQuantity: '3' },
  ])
    assert.equal(supplyDetailSchema.safeParse({ ...detail, lines: [value] }).success, false);
  for (const task of [
    { ...summary, lineCount: 2 },
    { ...summary, requiredQuantity: 4, remainingQuantity: 3 },
    { ...summary, receivedQuantity: 0, remainingQuantity: 3 },
    { ...summary, receiptProgress: 'Complete' },
    { ...summary, effectiveState: 'Received' },
  ])
    assert.equal(supplyDetailSchema.safeParse({ ...detail, task }).success, false);
  assert.equal(
    supplyDetailSchema.safeParse({
      ...detail,
      lines: [line, line],
      task: {
        ...summary,
        lineCount: 2,
        requiredQuantity: 6,
        receivedQuantity: 2,
        remainingQuantity: 4,
      },
    }).success,
    false,
  );
  const second = { ...line, offerLineId: 'f'.repeat(32) };
  assert.equal(
    supplyDetailSchema.safeParse({
      ...detail,
      lines: [line, second],
      task: {
        ...summary,
        lineCount: 2,
        requiredQuantity: 6,
        receivedQuantity: 2,
        remainingQuantity: 4,
      },
    }).success,
    true,
  );
});
test('supply schema preserves explicit nulls and bounded Unicode while rejecting malformed dates or graphs', () => {
  for (const field of ['expectedAt']) {
    const task = { ...summary } as Record<string, unknown>;
    delete task[field];
    assert.equal(supplySummarySchema.safeParse(task).success, false);
  }
  const missing = { ...page } as Record<string, unknown>;
  delete missing.startCandidate;
  assert.equal(supplyPageSchema.safeParse(missing).success, false);
  assert.equal(
    supplyDetailSchema.parse({
      ...detail,
      lines: [{ ...line, labelFa: 'ف'.repeat(2000), labelEn: 'e'.repeat(2000) }],
    }).lines[0].labelFa.length,
    2000,
  );
  for (const task of [
    { ...summary, createdAt: 'bad' },
    { ...summary, changedAt: '2029-01-01T00:00:00Z' },
    { ...summary, expectedAt: '2030-01-01T10:00:00+03:30' },
    { ...summary, requiredQuantity: 64000001 },
  ])
    assert.equal(supplySummarySchema.safeParse(task).success, false);
  assert.equal(supplyPageSchema.safeParse({ ...page, items: [summary, summary] }).success, false);
  assert.equal(supplyDetailSchema.safeParse({ ...detail, lines: [] }).success, false);
});
test('supply public history retains Int64 string IDs and permits terminal receiving self-events without private fields', () => {
  assert.equal(supplyEventsSchema.parse(events).items[0].id, '9007199254740993');
  const entry = events.items[0];
  assert.equal(
    supplyEventsSchema.safeParse({
      ...events,
      items: [
        {
          ...entry,
          stateBefore: 'Cancelled',
          stateAfter: 'Cancelled',
          receiptProgress: 'Partial',
          reasonCode: 'historical_goods_received',
        },
      ],
    }).success,
    true,
  );
  for (const bad of [
    { ...entry, id: 9007199254740992 },
    { ...entry, id: '9223372036854775808' },
    { ...entry, id: '01' },
    { ...entry, actorId: 'private' },
    { ...entry, internalNote: 'private' },
    { ...entry, sourceKey: 'private' },
    { ...entry, stateAfter: 'ReadyForCheckout' },
    { ...entry, stateBefore: null },
  ])
    assert.equal(supplyEventsSchema.safeParse({ ...events, items: [bad] }).success, false);
  assert.equal(supplyEventsSchema.safeParse({ ...events, items: [entry, entry] }).success, false);
  assert.equal(supplyEventsSchema.safeParse({ ...events, pageSize: 50 }).success, false);
  const first = { ...entry, id: '9007199254740994' };
  assert.equal(supplyEventsSchema.safeParse({ ...events, items: [first, entry] }).success, false);
});
