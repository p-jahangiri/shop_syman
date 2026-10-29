import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chequeLedgerPageSchema,
  chequeDetailSchema,
  chequeHistorySchema,
  chequeResultSchema,
  receiveChequeInputSchema,
  moveChequeInputSchema,
  readChequeResult,
  isChequeLedgerPath,
  isChequeLedgerAdminPath,
  chequeActions,
  nextChequeState,
  type ChequeCommand,
} from './cheque-ledger-contract.ts';
import { ChequeLedgerJournal } from './cheque-ledger-journal.ts';
import { proxyChequeLedger } from './cheque-ledger-proxy.ts';
const orderId = 'a'.repeat(32),
  chequeId = 'b'.repeat(32),
  scheduleId = 'c'.repeat(32),
  eventId = 'd'.repeat(32),
  cmd = 'e'.repeat(32),
  v = 'AAAAAAAAAAE=',
  v2 = 'AAAAAAAAAAI=',
  at = '2026-10-27T10:00:00.000Z',
  recorded = '2026-10-27T10:00:01+00:00';
function summary() {
  return {
    id: chequeId,
    internalReference: 'CH-' + chequeId.toUpperCase(),
    orderId,
    scheduleId,
    sequence: 1,
    dueDate: '2026-11-27',
    amountRial: '9007199254740993',
    state: 'Received' as const,
    version: v2,
    occurredAt: at,
    recordedAt: recorded,
    bankVerified: false as const,
  };
}
function event() {
  return {
    id: eventId,
    chequeId,
    sequence: 1,
    action: 'Receive' as const,
    state: 'Received' as const,
    version: v2,
    occurredAt: at,
    recordedAt: recorded,
    note: 'Synthetic QA note',
    bankVerified: false as const,
  };
}
function page() {
  return {
    schemaVersion: 1 as const,
    orderId,
    orderVersion: v,
    orderState: 'AwaitingPayment' as const,
    scheduleVersion: v,
    scheduleFrozen: true,
    canReceive: false,
    items: [summary()],
    canPay: false as const,
    canFulfill: false as const,
  };
}
function result() {
  return {
    schemaVersion: 1 as const,
    replayed: false,
    commandId: cmd,
    cheque: summary(),
    event: event(),
    canPay: false as const,
    canFulfill: false as const,
  };
}
function receive(): ChequeCommand {
  return {
    kind: 'receive',
    id: cmd,
    ownerId: 'QA',
    orderId,
    body: {
      orderVersion: v,
      scheduleVersion: v,
      sequence: 1,
      instrumentReference: 'SYNTHETIC-ONLY',
      note: 'Synthetic QA note',
      occurredAt: at,
      confirmed: true,
    },
    line: { scheduleId, sequence: 1, dueDate: '2026-11-27', amountRial: '9007199254740993' },
  };
}
test('Ledger schemas keep exact positive integer rial and reject private data or fake bank verification in customer output', () => {
  assert.equal(chequeLedgerPageSchema.parse(page()).items[0].amountRial, '9007199254740993');
  for (const bad of ['0', '1.5', '1e9', '01', '9223372036854775808'])
    assert.equal(
      chequeLedgerPageSchema.safeParse({ ...page(), items: [{ ...summary(), amountRial: bad }] })
        .success,
      false,
    );
  assert.equal(
    chequeLedgerPageSchema.safeParse({
      ...page(),
      items: [{ ...summary(), instrumentReference: 'private' }],
    }).success,
    false,
  );
  assert.equal(
    chequeLedgerPageSchema.safeParse({ ...page(), items: [{ ...summary(), bankVerified: true }] })
      .success,
    false,
  );
  assert.equal(chequeLedgerPageSchema.safeParse({ ...page(), canFulfill: true }).success, false);
});
test('Impossible custody jumps and reopening a returned instrument fail', () => {
  assert.deepEqual(chequeActions('Received'), ['Deposit', 'ReturnToCustomer']);
  assert.equal(nextChequeState('Deposited', 'ReportCollection'), 'CollectedReported');
  assert.equal(nextChequeState('CollectedReported', 'CorrectCollectionReport'), 'Deposited');
  assert.throws(() => nextChequeState('Received', 'ReportCollection'));
  assert.throws(() => nextChequeState('ReturnedToCustomer', 'Deposit'));
});
test('Receive has explicit confirmation, exact versions and bounded reference without client money', () => {
  const c = receive();
  assert.ok(receiveChequeInputSchema.safeParse(c.body).success);
  assert.equal(receiveChequeInputSchema.safeParse({ ...c.body, amountRial: '1' }).success, false);
  assert.equal(receiveChequeInputSchema.safeParse({ ...c.body, confirmed: false }).success, false);
  assert.equal(
    receiveChequeInputSchema.safeParse({ ...c.body, instrumentReference: ' padded ' }).success,
    false,
  );
  assert.equal(receiveChequeInputSchema.safeParse({ ...c.body, note: 'bad\nline' }).success, false);
});
test('Actual receipt is bound to order, command and original dated line without floating point time comparison', () => {
  const c = receive();
  assert.equal(readChequeResult(result(), c).cheque.amountRial, '9007199254740993');
  assert.throws(() => readChequeResult({ ...result(), commandId: 'f'.repeat(32) }, c));
  assert.throws(() =>
    readChequeResult({ ...result(), cheque: { ...summary(), dueDate: '2026-11-28' } }, c),
  );
  const micro = {
    ...result(),
    cheque: { ...summary(), occurredAt: '2026-10-27T10:00:00.0000001Z' },
    event: { ...event(), occurredAt: '2026-10-27T10:00:00.0000001Z' },
  };
  assert.throws(() => readChequeResult(micro, c));
  assert.equal(
    chequeResultSchema.safeParse({ ...result(), event: { ...event(), state: 'CollectedReported' } })
      .success,
    false,
  );
});
test('Move receipt preserves cheque identity and next event sequence with an allowed transition', () => {
  const before = { ...summary(), version: v };
  const c: ChequeCommand = {
    kind: 'move',
    id: cmd,
    ownerId: 'QA',
    orderId,
    body: {
      version: v,
      action: 'Deposit',
      note: 'Synthetic QA note',
      occurredAt: at,
      confirmed: true,
      acknowledgedClosedOrder: false,
    },
    before,
    beforeEventSequence: 1,
  };
  const r = {
    ...result(),
    cheque: { ...summary(), state: 'Deposited' },
    event: { ...event(), sequence: 2, action: 'Deposit', state: 'Deposited' },
  };
  assert.equal(readChequeResult(r, c).event.sequence, 2);
  assert.throws(() => readChequeResult({ ...r, event: { ...r.event, sequence: 3 } }, c));
  assert.equal(
    moveChequeInputSchema.safeParse({ ...c.body, acknowledgedClosedOrder: undefined }).success,
    false,
  );
});
test('Private detail and bounded history agree with current record and contiguous event sequence', () => {
  const detail = {
    schemaVersion: 1,
    cheque: summary(),
    instrumentReference: 'SYNTHETIC',
    receiptNote: '',
    current: event(),
    allowedActions: ['Deposit', 'ReturnToCustomer'],
    closedOrderAcknowledgementRequired: false,
    canPay: false,
    canFulfill: false,
  };
  assert.ok(chequeDetailSchema.safeParse(detail).success);
  assert.equal(
    chequeDetailSchema.safeParse({ ...detail, allowedActions: ['ReportCollection'] }).success,
    false,
  );
  assert.ok(
    chequeHistorySchema.safeParse({
      schemaVersion: 1,
      chequeId,
      items: [event()],
      nextSequence: null,
    }).success,
  );
  assert.equal(
    chequeHistorySchema.safeParse({
      schemaVersion: 1,
      chequeId,
      items: [event(), event()],
      nextSequence: null,
    }).success,
    false,
  );
});
test('Owned path is read-only and staff command paths reject foreign queries, zero IDs and unbounded history', () => {
  const own = '/api/credit/orders/' + orderId + '/cheques',
    base = '/api/admin/credit/orders/QA/' + orderId + '/cheques';
  assert.ok(isChequeLedgerPath(own));
  assert.equal(isChequeLedgerPath(own, 'POST'), false);
  assert.equal(isChequeLedgerPath(own + '?owner=foreign'), false);
  assert.ok(isChequeLedgerAdminPath(base + '/receive/commands/' + cmd, 'POST'));
  assert.ok(isChequeLedgerAdminPath(base + '/' + chequeId + '/history?beforeSequence=20'));
  for (const tail of [
    '/commands/' + '0'.repeat(32),
    '/' + chequeId + '/history?beforeSequence=201',
    '/' + chequeId + '/history?beforeSequence=01',
  ])
    assert.equal(isChequeLedgerAdminPath(base + tail), false);
});
test('Unknown receipt survives navigation interruption, rejects duplicate begin, and actor logout clears sensitive RAM', () => {
  const j = new ChequeLedgerJournal(),
    c = receive();
  j.bind('QA');
  j.begin('QA', c);
  j.interrupt();
  assert.equal(j.snapshot('QA')?.state, 'unknown');
  assert.throws(() => j.begin('QA', c));
  assert.equal(j.finish('foreign', c, result()), false);
  assert.ok(j.finish('QA', c, { ...result(), replayed: true }));
  assert.equal(j.snapshot('QA')?.state, 'done');
  j.bind(null);
  assert.equal(j.snapshot('QA'), null);
});
test('Customer proxy strips cookies, returns only owned read-only data and refuses staff authority or secret expansion', async () => {
  const env = {
      SHOP_DATA_MODE: 'api',
      SHOP_PUBLIC_URL: 'https://sayman.test',
      SHOP_API_URL: 'http://api.test',
    },
    url = 'https://sayman.test/api/credit/orders/' + orderId + '/cheques',
    request = () =>
      new Request(url, {
        headers: { Authorization: 'Bearer ' + 'a'.repeat(30), Cookie: 'private=never-forward' },
      });
  let calls = 0;
  const fetcher: typeof fetch = async (_u, init) => {
    calls++;
    assert.equal(new Headers(init?.headers).has('Cookie'), false);
    assert.equal(init?.cache, 'no-store');
    return Response.json(page());
  };
  const r = await proxyChequeLedger(request(), env, fetcher);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('cache-control')!, /no-store/);
  assert.equal((await r.json()).items[0].amountRial, '9007199254740993');
  assert.equal(calls, 1);
  assert.equal(
    (
      await proxyChequeLedger(request(), env, async () =>
        Response.json({ ...page(), canReceive: true }),
      )
    ).status,
    503,
  );
  assert.equal(
    (
      await proxyChequeLedger(request(), env, async () =>
        Response.json({ ...page(), items: [{ ...summary(), note: 'secret' }] }),
      )
    ).status,
    503,
  );
});
