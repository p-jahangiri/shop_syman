import test from 'node:test';
import assert from 'node:assert/strict';
import {
  creditReminderPageSchema,
  creditReminderCommandSchema,
  creditReminderInputSchema,
  readCreditReminderResult,
} from './credit-reminder-contract.ts';
import { CreditReminderJournal } from './credit-reminder-journal.ts';
import { readCreditInbox, readCreditInboxAcknowledgement } from './credit-inbox-contract.ts';
import { proxyNotifications } from './notification-proxy.ts';
import { isCustomerNotificationPath } from './notification-path.ts';
const id = (i: number) => i.toString(16).padStart(32, '0'),
  v = 'AAAAAAAAAAE=',
  hash = 'A'.repeat(64),
  at = '2026-10-27T20:30:00.0000000+00:00';
function page() {
  return {
    schemaVersion: 1,
    orderId: id(1),
    orderVersion: v,
    orderState: 'CreditApproved',
    cheque: {
      id: id(2),
      internalReference: 'CH-' + id(2).toUpperCase(),
      orderId: id(1),
      scheduleId: id(3),
      sequence: 1,
      dueDate: '2027-01-01',
      amountRial: '9007199254740993',
      state: 'Received',
      version: v,
      occurredAt: at,
      recordedAt: at,
      bankVerified: false,
    },
    today: '2026-10-28',
    previewFingerprint: hash,
    nextSequence: 1,
    canSend: true,
    sentToday: null,
    bankVerified: false,
    canPay: false,
    canFulfill: false,
  };
}
function command() {
  const p = page();
  return creditReminderCommandSchema.parse({
    id: id(4),
    ownerId: 'QA_OWNER',
    orderId: id(1),
    chequeId: id(2),
    body: {
      orderVersion: v,
      ledgerVersion: v,
      previewFingerprint: hash,
      note: 'Synthetic private finance note',
      confirmed: true,
    },
    previewSnapshot: p,
  });
}
function result() {
  return {
    schemaVersion: 1,
    replayed: false,
    commandId: id(4),
    event: {
      summary: {
        id: id(5),
        orderId: id(1),
        chequeId: id(2),
        sequence: 1,
        civilDay: '2026-10-28',
        dueDate: '2027-01-01',
        amountRial: '9007199254740993',
        ledgerState: 'Received',
        ledgerVersion: v,
        orderVersion: v,
        previewFingerprint: hash,
        at,
      },
      note: 'Synthetic private finance note',
    },
    bankVerified: false,
    canPay: false,
    canFulfill: false,
  };
}
const notice = () => ({
  id: id(5),
  sequence: '1',
  orderId: id(1),
  chequeId: id(2),
  dueDate: '2027-01-01',
  amountRial: '9007199254740993',
  civilDay: '2026-10-28',
  at,
  readAt: null as string | null,
});
test('reminder binds exact retained amount/date/day/ledger and forbids client money or recipient fields', () => {
  assert.equal(
    readCreditReminderResult(result(), command()).event.summary.amountRial,
    '9007199254740993',
  );
  assert.equal(
    creditReminderInputSchema.safeParse({ ...command().body, amountRial: '1' }).success,
    false,
  );
  assert.equal(
    creditReminderInputSchema.safeParse({ ...command().body, recipient: 'someone' }).success,
    false,
  );
  for (const change of [
    (r: ReturnType<typeof result>) => {
      r.event.summary.sequence = 2;
    },
    (r: ReturnType<typeof result>) => {
      r.event.summary.amountRial = '10';
    },
    (r: ReturnType<typeof result>) => {
      r.event.summary.civilDay = '2026-10-27';
    },
    (r: ReturnType<typeof result>) => {
      r.event.note = 'Other note';
    },
    (r: ReturnType<typeof result>) => {
      r.event.summary.chequeId = id(9);
    },
    (r: ReturnType<typeof result>) => {
      r.event.summary.orderVersion = 'AAAAAAAAAAI=';
    },
    (r: ReturnType<typeof result>) => {
      r.event.summary.previewFingerprint = 'B'.repeat(64);
    },
  ]) {
    const r = result();
    change(r);
    assert.throws(() => readCreditReminderResult(r, command()));
  }
});
test('uncommitted orders, collected/returned instruments and already sent day cannot advertise canSend', () => {
  for (const state of ['AwaitingPayment', 'Paid', 'Cancelled', 'Expired'])
    assert.equal(
      creditReminderPageSchema.safeParse({ ...page(), orderState: state }).success,
      false,
    );
  for (const state of ['CollectedReported', 'ReturnedToCustomer']) {
    const p = page();
    p.cheque.state = state;
    assert.equal(creditReminderPageSchema.safeParse(p).success, false);
  }
  assert.equal(
    creditReminderPageSchema.safeParse({ ...page(), nextSequence: null }).success,
    false,
  );
  assert.equal(
    creditReminderPageSchema.safeParse({ ...page(), sentToday: result().event.summary }).success,
    false,
  );
});
test('lost result remains unknown until same receipt and journal never crosses actor or logout', () => {
  const j = new CreditReminderJournal(),
    c = command();
  j.bind('finance');
  j.begin('finance', c);
  j.interrupt();
  assert.equal(j.snapshot('finance')?.state, 'unknown');
  j.fail('finance', c, 404, 'not_found');
  assert.equal(j.snapshot('finance')?.state, 'unknown');
  assert.equal(j.snapshot('other'), null);
  assert.equal(j.finish('finance', c, { ...result(), replayed: true }), true);
  assert.equal(j.snapshot('finance')?.state, 'done');
  j.bind(null);
  assert.equal(j.snapshot('finance'), null);
  j.bind('other');
  assert.equal(j.finish('finance', c, result()), false);
});
test('customer inbox has no private financial note/reference and read time is monotone', () => {
  const p = { schemaVersion: 1, unreadOnly: true, items: [notice()], nextCursor: null };
  assert.equal(readCreditInbox(p, true).items[0].amountRial, '9007199254740993');
  assert.throws(() => readCreditInbox({ ...p, items: [{ ...notice(), note: 'private' }] }, true));
  assert.throws(() =>
    readCreditInbox({ ...p, items: [{ ...notice(), instrumentReference: 'private' }] }, true),
  );
  assert.throws(() =>
    readCreditInbox({ ...p, items: [{ ...notice(), civilDay: '2026-10-27' }] }, true),
  );
  assert.throws(() =>
    readCreditInboxAcknowledgement(
      { schemaVersion: 1, notification: { ...notice(), readAt: '2026-10-27T20:29:59Z' } },
      id(5),
    ),
  );
  assert.equal(
    readCreditInboxAcknowledgement(
      { schemaVersion: 1, notification: { ...notice(), readAt: at } },
      id(5),
    ).notification.readAt,
    at,
  );
  assert.throws(() =>
    readCreditInboxAcknowledgement(
      { schemaVersion: 1, notification: { ...notice(), readAt: at } },
      id(6),
    ),
  );
});
test('new private path allows only owned inbox reads and read acknowledgement', () => {
  for (const p of [
    '/api/notifications/credit-reminders',
    '/api/notifications/credit-reminders?unreadOnly=true',
    '/api/notifications/credit-reminders/unread-count',
  ])
    assert.equal(isCustomerNotificationPath(p), true);
  assert.equal(
    isCustomerNotificationPath('/api/notifications/credit-reminders/' + id(5) + '/read', 'PUT'),
    true,
  );
  for (const p of [
    '/api/notifications/credit-reminders?owner=someone',
    '/api/notifications/credit-reminders?unreadOnly=true&unreadOnly=false',
    '/api/notifications/credit-reminders/send',
    '/api/notifications/credit-reminders/' + id(5),
  ])
    assert.equal(isCustomerNotificationPath(p), false);
  assert.equal(isCustomerNotificationPath('/api/notifications/credit-reminders', 'POST'), false);
});
test('credit reminder proxy preserves bigint, excludes cookies and rejects unexpected response cookies', async () => {
  const env = {
      SHOP_DATA_MODE: 'api',
      SHOP_API_URL: 'http://api.local',
      SHOP_PUBLIC_URL: 'https://shop.example',
    },
    headers = {
      Authorization: 'Bearer ' + 'a'.repeat(30),
      Origin: 'https://shop.example',
      Cookie: 'must-not-forward=1',
    },
    url = 'https://shop.example/api/notifications/credit-reminders?unreadOnly=false';
  let seen = false;
  const response = await proxyNotifications(
    new Request(url, { headers }),
    ['credit-reminders'],
    env,
    async (_input, init) => {
      seen = true;
      assert.equal(init?.credentials, 'omit');
      assert.equal(new Headers(init?.headers).has('Cookie'), false);
      return Response.json({
        schemaVersion: 1,
        unreadOnly: false,
        items: [notice()],
        nextCursor: null,
      });
    },
  );
  assert.equal(seen, true);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control')!, /private, no-store/);
  assert.equal((await response.json()).items[0].amountRial, '9007199254740993');
  const unsafe = await proxyNotifications(
    new Request(url, { headers }),
    ['credit-reminders'],
    env,
    async () =>
      Response.json(
        { schemaVersion: 1, unreadOnly: false, items: [], nextCursor: null },
        { headers: { 'Set-Cookie': 'forbidden=1' } },
      ),
  );
  assert.equal(unsafe.status, 503);
  assert.equal(unsafe.headers.has('Set-Cookie'), false);
});
