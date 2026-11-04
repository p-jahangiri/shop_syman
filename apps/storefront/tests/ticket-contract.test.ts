import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ticketSummarySchema,
  ticketMessagesSchema,
  ticketCreateSchema,
  ticketResultSchema,
  readTicketResult,
  readTicketPage,
  readTicketMessages,
  type TicketCommand,
} from '@sayman/web-shared/lib/support/ticket-contract.ts';
import { TicketJournal } from '@sayman/web-shared/lib/support/ticket-journal.ts';
import { isCustomerTicketPath } from '../lib/support/ticket-path.ts';
const id = 'a'.repeat(32),
  cmd = 'b'.repeat(32),
  message = 'c'.repeat(32),
  summary = {
    id,
    subject: 'گفت‌وگوی خصوصی',
    locale: 'fa',
    state: 'Open',
    version: 'AAAAAAAAAAE=',
    messageCount: 1,
    createdAt: '2026-10-26T00:00:00.1234567+00:00',
    changedAt: '2026-10-26T00:00:00.1234567+00:00',
  },
  command: TicketCommand = {
    id: cmd,
    kind: 'create',
    staff: false,
    body: { subject: 'گفت‌وگوی خصوصی', body: 'پیام خصوصی', locale: 'fa' },
  },
  result = {
    schemaVersion: 1,
    replayed: false,
    commandId: cmd,
    ticket: summary,
    messageId: message,
  };
test('private ticket decoders reject owner fields, wrong tickets and mismatched historical receipts', () => {
  assert.deepEqual(readTicketResult(result, command), result);
  assert.equal(ticketSummarySchema.safeParse({ ...summary, ownerId: 'secret' }).success, false);
  assert.equal(ticketResultSchema.safeParse({ ...result, actorId: 'secret' }).success, false);
  assert.throws(() => readTicketResult({ ...result, commandId: id }, command));
  assert.throws(() => readTicketResult({ ...result, messageId: null }, command));
  assert.throws(() =>
    readTicketResult({ ...result, ticket: { ...summary, state: 'Closed' } }, command),
  );
  assert.throws(() =>
    readTicketMessages({ schemaVersion: 1, ticketId: cmd, items: [], nextCursor: null }, id),
  );
  assert.throws(() =>
    readTicketPage({ schemaVersion: 1, state: 'Open', items: [summary], nextCursor: null }, null),
  );
});
test('message sequence stays a decimal string beyond JavaScript safe integer and is strictly increasing', () => {
  const row = {
      id: message,
      sequence: '9007199254740993',
      author: 'customer',
      locale: 'fa',
      body: 'پیام',
      at: summary.createdAt,
    },
    page = {
      schemaVersion: 1,
      ticketId: id,
      items: [row, { ...row, id: cmd, sequence: '9007199254740994' }],
      nextCursor: null,
    };
  assert.equal(ticketMessagesSchema.parse(page).items[0].sequence, '9007199254740993');
  assert.equal(
    ticketMessagesSchema.safeParse({
      ...page,
      items: [{ ...row, sequence: Number('9007199254740993') }],
    }).success,
    false,
  );
  assert.equal(
    ticketMessagesSchema.safeParse({ ...page, items: [page.items[1], row] }).success,
    false,
  );
  assert.equal(ticketMessagesSchema.safeParse({ ...page, items: [row, row] }).success, false);
  assert.equal(
    ticketMessagesSchema.safeParse({ ...page, items: [row, { ...row, id: cmd, sequence: '1.5' }] })
      .success,
    false,
  );
});
test('queue aggregates are staff-only, and an ID lookup accepts at most the requested ticket', () => {
  const page = {
    schemaVersion: 1,
    state: null,
    items: [summary],
    nextCursor: null,
    queueCounts: { open: 51, waitingCustomer: 3, closed: 42 },
  };
  assert.deepEqual(readTicketPage(page, null, true, id), page);
  assert.throws(() => readTicketPage(page, null));
  assert.throws(() => readTicketPage(page, null, true, cmd));
  assert.throws(() =>
    readTicketPage({ ...page, queueCounts: { ...page.queueCounts, open: -1 } }, null, true),
  );
});
test('input rejects impersonation, bidi controls and invalid Unicode while retaining plain text', () => {
  assert.equal(
    ticketCreateSchema.parse({
      subject: ' Subject ',
      body: '<script>plain</script>\r\nsecond',
      locale: 'en',
    }).body,
    '<script>plain</script>\nsecond',
  );
  for (const body of ['\u202eprivate', '\u0000', '\ud800', ' '.repeat(4)])
    assert.equal(
      ticketCreateSchema.safeParse({ subject: 'Subject', body, locale: 'en' }).success,
      false,
    );
  assert.equal(ticketCreateSchema.safeParse({ ...command.body, ownerId: 'other' }).success, false);
});
test('ticket paths expose only exact owner routes and reject traversal, duplicate filters and unknown commands', () => {
  for (const [path, method] of [
    ['/api/support/tickets', 'GET'],
    ['/api/support/tickets?state=Open', 'GET'],
    [`/api/support/tickets/${id}/messages?cursor=YWJj%2Bw%3D%3D`, 'GET'],
    [`/api/support/tickets/commands/${cmd}`, 'POST'],
    [`/api/support/tickets/${id}/replies/${cmd}`, 'POST'],
    [`/api/support/tickets/${id}/state/${cmd}`, 'PUT'],
  ])
    assert.equal(isCustomerTicketPath(path, method), true, path);
  for (const [path, method] of [
    ['/api/admin/support/tickets', 'GET'],
    ['/api/support/tickets?owner=other', 'GET'],
    ['/api/support/tickets?state=Open&state=Closed', 'GET'],
    [`/api/support/tickets/${id}/messages?state=Open`, 'GET'],
    [`/api/support/tickets/${id}`, 'DELETE'],
    [`/api/support/../admin/support/tickets`, 'GET'],
    [`/api/support/tickets/${'0'.repeat(32)}`, 'GET'],
  ])
    assert.equal(isCustomerTicketPath(path, method), false, path);
});
test('an unanswered command retains identical body and ID across retry and later 4xx responses', () => {
  const journal = new TicketJournal();
  journal.bind('one');
  journal.begin('one', command);
  journal.fail('one', command, 0, 'offline');
  assert.equal(journal.snapshot('one')?.state, 'unknown');
  assert.throws(() => journal.begin('one', { ...command, id: message }));
  const frozen = JSON.stringify(journal.snapshot('one')?.command);
  assert.equal(JSON.stringify(journal.retry('one')), frozen);
  journal.fail('one', command, 403, 'denied');
  assert.equal(journal.snapshot('one')?.state, 'unknown');
  journal.clear('one');
  assert.notEqual(journal.snapshot('one'), null);
  assert.equal(journal.finish('one', command, result), true);
  journal.fail('one', command, 0, 'late_error');
  assert.equal(journal.snapshot('one')?.state, 'done');
  journal.clear('one');
  assert.equal(journal.snapshot('one'), null);
});
test('journal hides another owner, survives interrupted verification and clears only on confirmed account change', () => {
  const journal = new TicketJournal();
  journal.bind('one');
  journal.begin('one', command);
  assert.equal(journal.snapshot('two'), null);
  journal.interrupt();
  journal.bind('one');
  assert.equal(journal.snapshot('one')?.state, 'unknown');
  journal.bind('two');
  assert.equal(journal.snapshot('one'), null);
  assert.equal(journal.finish('one', command, result), false);
  journal.bind(null);
  assert.equal(journal.snapshot('two'), null);
});
test('first definitive rejection permits correction but malformed success remains unknown', () => {
  const journal = new TicketJournal();
  journal.bind('one');
  journal.begin('one', command);
  journal.fail('one', command, 409, 'ticket_version_conflict');
  assert.equal(journal.snapshot('one')?.state, 'rejected');
  journal.begin('one', { ...command, id: message });
  assert.throws(() =>
    journal.finish(
      'one',
      { ...command, id: message },
      { ...result, commandId: message, ticket: { ...summary, ownerId: 'leak' } },
    ),
  );
  journal.fail('one', { ...command, id: message }, 0, 'bad_response');
  assert.equal(journal.snapshot('one')?.state, 'unknown');
});

test('customer authentication failure hides but retains an unanswered command until the same owner is verified', async () => {
  const { CustomerSessionStore, SessionError } = await import('../lib/account/customer-session.ts');
  const { customerTicketJournal } =
    await import('@sayman/web-shared/lib/support/ticket-journal.ts');
  let session = {
    accessToken: 'q'.repeat(40),
    expiresIn: 300,
    requiresMfa: false,
    requiresEnrollment: false,
    user: { id: 'member-one', displayName: 'QA', userName: 'qa' },
  };
  const store = new CustomerSessionStore(
    async () => session,
    async () => {
      throw new SessionError('unavailable');
    },
    async (run) => run(),
    () => false,
  );
  await store.login('qa', 'generated-test-only');
  customerTicketJournal.begin('member-one', command);
  await store.restore();
  assert.equal(store.snapshot().session, null);
  assert.equal(store.snapshot().status, 'unavailable');
  assert.equal(customerTicketJournal.snapshot('member-one')?.state, 'unknown');
  assert.equal(customerTicketJournal.snapshot(null), null);
  await store.login('qa', 'generated-test-only');
  assert.equal(customerTicketJournal.snapshot('member-one')?.state, 'unknown');
  session = { ...session, user: { ...session.user, id: 'member-two' } };
  await store.login('qa2', 'generated-test-only');
  assert.equal(customerTicketJournal.snapshot('member-one'), null);
  await store.logout();
  assert.equal(customerTicketJournal.snapshot('member-two'), null);
});
