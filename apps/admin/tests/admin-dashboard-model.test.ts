import assert from 'node:assert/strict';
import test from 'node:test';
import {
  orderDashboardSummary,
  readDashboardPages,
  shiftDashboardDay,
} from '../src/features/dashboard/admin-dashboard-model.ts';
import type { AdminOrderSummaryV2 } from '../src/api/contracts/orders/orders-contract.ts';

test('orders use Tehran calendar days and keep expiry separate from paid or authorized orders', () => {
  const input = [
    { id: '1', state: 'Paid', createdAt: '2026-11-03T21:00:00Z' },
    { id: '2', state: 'Expired', createdAt: '2026-11-03T21:00:00Z' },
    { id: '3', state: 'CreditApproved', createdAt: '2026-11-03T19:00:00Z' },
    { id: '4', state: 'Fulfilled', createdAt: '2026-11-03T18:00:00Z' },
    { id: '5', state: 'AwaitingPayment', createdAt: '2026-11-02T10:00:00Z' },
  ] as AdminOrderSummaryV2[];
  const summary = orderDashboardSummary(input, '2026-11-04', 2);
  assert.deepEqual(summary.series, [
    { day: '2026-11-03', orders: 2, ready: 2 },
    { day: '2026-11-04', orders: 2, ready: 1 },
  ]);
  assert.equal(summary.total, 4);
  assert.equal(summary.ready, 2);
  assert.equal(summary.delivered, 1);
  assert.equal(summary.interrupted, 1);
  assert.equal(summary.waiting, 0);
  assert.equal(shiftDashboardDay('2026-03-01', -1), '2026-02-28');
});

test('dashboard cursor reads deduplicate overlap and distinguish a cap from a complete range', async () => {
  const signal = new AbortController().signal;
  let seen = 0;
  const fetchPage = async () => ({
    items: [String(++seen), 'duplicate'],
    nextCursor: String(seen),
  });
  const limited = await readDashboardPages(fetchPage, (value) => value, signal);
  assert.equal(limited.complete, false);
  assert.equal(limited.items.length, 6);
  seen = 0;
  const ranged = await readDashboardPages(
    fetchPage,
    (value) => value,
    signal,
    (value) => value === '2',
  );
  assert.deepEqual(ranged, { items: ['1', 'duplicate'], complete: true });
  await assert.rejects(
    readDashboardPages(
      async () => ({ items: ['a'], nextCursor: 'same' }),
      (value) => value,
      signal,
    ),
    /صفحه‌بندی/,
  );
});
