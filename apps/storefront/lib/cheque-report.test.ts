import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chequeReportFilterSchema,
  chequeReportPageSchema,
  chequeReportPath,
  chequeReportToday,
  readChequeReport,
} from './cheque-report-contract.ts';
const states = [
  'Received',
  'Deposited',
  'CollectedReported',
  'BouncedReported',
  'Withdrawn',
  'ReturnedToCustomer',
];
const id = (i: number) => i.toString(16).padStart(32, '0'),
  at = '2026-10-27T20:30:00.0000000+00:00',
  filter = { from: '2026-10-01', through: '2026-11-01', state: 'All' as const };
function page() {
  const items = states.map((state, i) => ({
    ownerId: 'OWNER',
    cheque: {
      id: id(i + 1),
      internalReference: 'CH-' + id(i + 1).toUpperCase(),
      orderId: id(100),
      scheduleId: id(200),
      sequence: i + 1,
      dueDate: '2026-10-28',
      amountRial: '9223372036854775807',
      state,
      version: 'AAAAAAAAAAE=',
      occurredAt: at,
      recordedAt: at,
      bankVerified: false,
    },
    currentOrder: {
      orderId: id(100),
      ownerId: 'OWNER',
      reference: 'SM-1',
      locale: 'fa',
      state: 'Cancelled',
      createdAt: '2026-10-26T00:00:00Z',
      expiresAt: '2026-10-26T01:00:00Z',
      payableTotalRial: '9223372036854775807',
      itemCount: 1,
      version: 'AAAAAAAAAAE=',
    },
  }));
  return {
    schemaVersion: 1,
    filter: { ...filter },
    timeZone: 'Asia/Tehran',
    today: '2026-10-28',
    registrationCutoff: at,
    observedAt: at,
    cursorExpiresAt: '2026-10-27T20:45:00.0000000+00:00',
    items,
    pageTotals: {
      count: 6,
      amountRial: '55340232221128654842',
      states: states.map((state) => ({ state, count: 1, amountRial: '9223372036854775807' })),
      overdueHeldCount: 0,
      overdueHeldRial: '0',
      dueTodayHeldCount: 4,
      dueTodayHeldRial: '36893488147419103228',
      futureHeldCount: 0,
      futureHeldRial: '0',
    },
    nextCursor: null as string | null,
    bankVerified: false,
    canPay: false,
    canFulfill: false,
  };
}
test('report decodes bigint page totals above SQL long and Tehran civil midnight', () => {
  assert.equal(chequeReportToday(at), '2026-10-28');
  assert.equal(readChequeReport(page(), filter).pageTotals.amountRial, '55340232221128654842');
  assert.equal(chequeReportToday('2021-07-01T19:30:00Z'), '2021-07-02');
});
test('wrong totals, bank authority and unexpected private fields are rejected', () => {
  for (const change of [
    (p: ReturnType<typeof page>) => {
      p.pageTotals.amountRial = '6';
    },
    (p: ReturnType<typeof page>) => {
      p.pageTotals.dueTodayHeldCount = 6;
    },
    (p: ReturnType<typeof page>) => {
      p.bankVerified = true;
    },
    (p: ReturnType<typeof page>) => {
      Object.assign(p.items[0], { instrumentReference: 'private' });
    },
    (p: ReturnType<typeof page>) => {
      p.pageTotals.states.reverse();
    },
  ]) {
    const p = page();
    change(p);
    assert.equal(chequeReportPageSchema.safeParse(p).success, false);
  }
});
test('duplicate or wrongly ordered rows and wrong owner/order/state filter fail closed', () => {
  for (const change of [
    (p: ReturnType<typeof page>) => {
      p.items.reverse();
    },
    (p: ReturnType<typeof page>) => {
      p.items[1] = p.items[0];
    },
    (p: ReturnType<typeof page>) => {
      p.items[0].currentOrder.ownerId = 'FOREIGN';
    },
    (p: ReturnType<typeof page>) => {
      p.items[0].currentOrder.orderId = id(99);
    },
  ]) {
    const p = page();
    change(p);
    assert.equal(chequeReportPageSchema.safeParse(p).success, false);
  }
  assert.throws(() => readChequeReport(page(), { ...filter, state: 'Received' }));
});
test('page continuation requires twenty rows and fixed fifteen-minute technical lifetime', () => {
  const p = page();
  p.nextCursor = 'Opaque_token';
  assert.equal(chequeReportPageSchema.safeParse(p).success, false);
  p.nextCursor = null;
  p.cursorExpiresAt = '2026-10-27T20:46:00Z';
  assert.equal(chequeReportPageSchema.safeParse(p).success, false);
  p.cursorExpiresAt = '2026-10-27T20:45:00Z';
  p.observedAt = p.cursorExpiresAt;
  assert.equal(chequeReportPageSchema.safeParse(p).success, false);
});
test('canonical bounded filter and URL encoding keep report read-only', () => {
  assert.equal(
    chequeReportFilterSchema.safeParse({ from: '2024-01-01', through: '2024-12-31', state: 'All' })
      .success,
    true,
  );
  for (const f of [
    { from: '2026-01-01', through: '2027-01-02', state: 'All' },
    { from: '2026-02-30', through: '2026-03-01', state: 'All' },
    { ...filter, state: 'received' },
  ])
    assert.equal(chequeReportFilterSchema.safeParse(f).success, false);
  assert.equal(
    chequeReportPath(filter, 'Opaque_token'),
    '/admin/credit/cheque-report?from=2026-10-01&through=2026-11-01&state=All&cursor=Opaque_token',
  );
  assert.throws(() => chequeReportPath(filter, 'raw+base64='));
});
