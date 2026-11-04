import test from 'node:test';
import assert from 'node:assert/strict';
import {
  creditReminderPolicyBodySchema,
  creditReminderPolicyCurrentSchema,
  creditReminderPolicyCommandSchema,
  creditReminderPolicyHistorySchema,
  parseCreditReminderOffsets,
  readCreditReminderPolicyResult,
} from '@sayman/web-shared/lib/credit/credit-reminder-policy-contract.ts';
import { CreditReminderPolicyJournal } from '@sayman/web-shared/lib/credit/credit-reminder-policy-journal.ts';
const id = (n: number) => n.toString(16).padStart(32, '0'),
  v = 'AAAAAAAAAAE=',
  at = '2026-10-28T02:00:00.0000000Z';
const current = () => ({
  schemaVersion: 1 as const,
  current: null,
  timeZone: 'Asia/Tehran' as const,
  channel: 'PrivateAccountInbox' as const,
  workerEnabled: false,
});
const body = () => ({
  version: null,
  enabled: true,
  dayOffsets: [-7, 0, 3],
  sendAt: '09:30',
  note: 'Synthetic private policy review',
  confirmed: true as const,
});
const command = () =>
  creditReminderPolicyCommandSchema.parse({ id: id(1), body: body(), previous: current() });
const result = () => ({
  schemaVersion: 1,
  commandId: id(1),
  replayed: false,
  policy: {
    ...current(),
    current: {
      id: id(2),
      revision: 1,
      version: v,
      enabled: true,
      dayOffsets: [-7, 0, 3],
      sendAt: '09:30',
      note: body().note,
      at,
    },
  },
});
test('reminder schedule requires explicit cadence or a fully disabled schedule and rejects guessed fields', () => {
  assert.ok(creditReminderPolicyBodySchema.parse(body()));
  assert.ok(
    creditReminderPolicyBodySchema.parse({
      ...body(),
      enabled: false,
      dayOffsets: [],
      sendAt: null,
    }),
  );
  for (const patch of [
    { confirmed: false },
    { dayOffsets: [] },
    { dayOffsets: [0, 0] },
    { dayOffsets: [3, -7, 0] },
    { dayOffsets: [366] },
    { dayOffsets: Array.from({ length: 32 }, (_, i) => i) },
    { sendAt: '9:30' },
    { sendAt: '24:00' },
    { sendAt: null },
    { enabled: false },
    { recipient: 'someone' },
    { channel: 'sms' },
  ])
    assert.equal(creditReminderPolicyBodySchema.safeParse({ ...body(), ...patch }).success, false);
  assert.equal(
    creditReminderPolicyCurrentSchema.safeParse({ ...current(), timeZone: 'UTC' }).success,
    false,
  );
});
test('Persian signed day input is explicit, sorted and deduplicated only by rejecting duplicates', () => {
  assert.deepEqual(parseCreditReminderOffsets('−۷، ۰، ٣'), [-7, 0, 3]);
  assert.deepEqual(parseCreditReminderOffsets('3,-7,0'), [-7, 0, 3]);
  for (const raw of ['', '0,0', '+7', '-0', '00', '366', '7,', '1.5', '0x10'])
    assert.throws(() => parseCreditReminderOffsets(raw));
});
test('policy receipt is bound to the exact immutable review, revision and versions', () => {
  assert.equal(readCreditReminderPolicyResult(result(), command()).policy.current!.sendAt, '09:30');
  for (const mutate of [
    (r: ReturnType<typeof result>) => {
      r.commandId = id(9);
    },
    (r: ReturnType<typeof result>) => {
      r.policy.current.dayOffsets = [0];
    },
    (r: ReturnType<typeof result>) => {
      r.policy.current.note = 'Different';
    },
    (r: ReturnType<typeof result>) => {
      r.policy.current.sendAt = '10:00';
    },
    (r: ReturnType<typeof result>) => {
      r.policy.current.revision = 2;
    },
  ]) {
    const r = result();
    mutate(r);
    assert.throws(() => readCreditReminderPolicyResult(r, command()));
  }
  const first = result().policy.current;
  const c = creditReminderPolicyCommandSchema.parse({
    id: id(1),
    body: { ...body(), version: v },
    previous: { ...current(), current: first },
  });
  assert.throws(() => readCreditReminderPolicyResult(result(), c));
  assert.equal(
    creditReminderPolicyHistorySchema.safeParse({
      schemaVersion: 1,
      items: [first, { ...first, id: id(3) }],
      nextBefore: null,
    }).success,
    false,
  );
});
test('policy recovery is actor bound, preserves unknown receipt misses and clears on logout', () => {
  const j = new CreditReminderPolicyJournal(),
    c = command();
  j.bind('finance');
  j.begin('finance', c);
  j.interrupt();
  j.fail('finance', c, 404, 'not_found');
  assert.equal(j.snapshot('finance')!.state, 'unknown');
  assert.equal(j.snapshot('other'), null);
  assert.equal(j.finish('finance', c, { ...result(), replayed: true }), true);
  assert.equal(j.snapshot('finance')!.state, 'done');
  j.bind(null);
  assert.equal(j.snapshot('finance'), null);
  j.bind('other');
  assert.equal(j.finish('finance', c, result()), false);
});
