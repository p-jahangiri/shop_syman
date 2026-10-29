import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reviewHoldBodySchema,
  reviewHoldCurrentSchema,
  readReviewHoldResult,
  type ReviewHoldCommand,
} from './cheque-review-hold-contract.ts';
import { ChequeReviewHoldJournal } from './cheque-review-hold-journal.ts';
const id = 'a'.repeat(32),
  version = 'AAAAAAAAAAE=',
  body = { action: 'Enable' as const, version: null, minutes: 60, confirmed: true as const },
  command: ReviewHoldCommand = { id, body },
  result = {
    schemaVersion: 1,
    commandId: id,
    policy: {
      schemaVersion: 1,
      version,
      current: {
        id: 'b'.repeat(32),
        revision: 1,
        enabled: true,
        minutes: 60,
        createdAt: '2026-10-28T00:00:00+00:00',
      },
      maximumMinutes: 60,
    },
    replayed: false,
  };
test('review hold is unset initially and an explicit bounded configuration, never an inferred default', () => {
  reviewHoldCurrentSchema.parse({
    schemaVersion: 1,
    version: null,
    current: null,
    maximumMinutes: 60,
  });
  reviewHoldBodySchema.parse(body);
  reviewHoldBodySchema.parse({ action: 'Disable', version, minutes: null, confirmed: true });
  for (const b of [
    { ...body, minutes: null },
    { ...body, minutes: 0 },
    { ...body, minutes: 61 },
    { ...body, confirmed: false },
    { ...body, action: '' },
    { ...body, action: 'Disable' },
    { ...body, cashReservationMinutes: 60 },
  ])
    assert.equal(reviewHoldBodySchema.safeParse(b).success, false);
  assert.equal(
    reviewHoldCurrentSchema.safeParse({ ...result.policy, current: null }).success,
    false,
  );
});
test('a policy receipt binds the exact reviewed action duration version and command', () => {
  readReviewHoldResult(result, command);
  for (const r of [
    { ...result, commandId: 'c'.repeat(32) },
    { ...result, policy: { ...result.policy, current: { ...result.policy.current, minutes: 30 } } },
    { ...result, policy: { ...result.policy, version: null } },
  ])
    assert.throws(() => readReviewHoldResult(r, command));
  assert.throws(() => readReviewHoldResult(result, { ...command, body: { ...body, version } }));
});
test('lost policy response keeps exact RAM command for receipt recovery and logout clears authority', () => {
  const j = new ChequeReviewHoldJournal();
  j.bind('finance');
  j.begin('finance', command);
  j.interrupt();
  assert.throws(() => j.begin('finance', { ...command, id: 'c'.repeat(32) }));
  assert.deepEqual(j.retry('finance'), command);
  j.fail('finance', command, 409, 'conflict');
  assert.equal(j.snapshot('finance')?.state, 'unknown');
  assert.equal(j.finish('finance', command, result), true);
  j.clear('finance');
  j.begin('finance', command);
  j.bind(null);
  assert.equal(j.finish('finance', command, result), false);
  assert.equal(j.snapshot('finance'), null);
});
