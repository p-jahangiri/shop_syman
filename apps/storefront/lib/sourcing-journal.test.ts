import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bindSourcingOwner,
  startSourcingJournal,
  readSourcingJournal,
  finishSourcingJournal,
  clearSourcingJournal,
  markSourcingUncertain,
  failSourcingJournal,
} from './sourcing-journal.ts';
import { sourcingSubmitSchema, sourcingMutationSchema } from './sourcing-contract.ts';
import { sourcingTestSubmit, sourcingTestMutation } from './sourcing.test-fixtures.ts';
test('frozen sourcing retry keeps exact UUID/body and never follows another account', () => {
  bindSourcingOwner('owner1');
  const input = sourcingSubmitSchema.parse(sourcingTestSubmit);
  startSourcingJournal('owner1', { kind: 'submit', locale: 'fa', body: input });
  input.note = 'Changed elsewhere';
  const copy = readSourcingJournal('owner1')!;
  assert.equal(copy.command.body.requestId, sourcingTestSubmit.requestId);
  assert.equal(copy.command.kind === 'submit' && copy.command.body.note, 'Test note');
  copy.command.body.requestId = 'mutated';
  assert.equal(readSourcingJournal('owner1')!.command.body.requestId, sourcingTestSubmit.requestId);
  assert.equal(readSourcingJournal('other'), null);
  bindSourcingOwner(null);
  assert.equal(readSourcingJournal('owner1'), null);
  assert.equal(
    finishSourcingJournal(
      'owner1',
      sourcingTestSubmit.requestId,
      sourcingMutationSchema.parse(sourcingTestMutation),
    ),
    false,
  );
  bindSourcingOwner('owner2');
  assert.equal(readSourcingJournal('owner2'), null);
});
test('one unresolved command blocks new intent and only its own result can finish it', () => {
  bindSourcingOwner('owner');
  const command = {
    kind: 'submit' as const,
    locale: 'fa' as const,
    body: sourcingSubmitSchema.parse(sourcingTestSubmit),
  };
  startSourcingJournal('owner', command);
  assert.throws(() => startSourcingJournal('owner', command));
  assert.equal(
    finishSourcingJournal('owner', 'different', sourcingMutationSchema.parse(sourcingTestMutation)),
    false,
  );
  assert.equal(
    finishSourcingJournal(
      'owner',
      command.body.requestId,
      sourcingMutationSchema.parse(sourcingTestMutation),
    ),
    true,
  );
  assert.equal(readSourcingJournal('owner')!.result!.version, sourcingTestMutation.version);
  clearSourcingJournal('other');
  assert.ok(readSourcingJournal('owner'));
  clearSourcingJournal('owner', command.body.requestId);
  assert.equal(readSourcingJournal('owner'), null);
  bindSourcingOwner(null);
});

test('a lost submission or cancellation stays uncertain after retry 4xx and preserves its exact intent', () => {
  for (const kind of ['submit', 'cancel'] as const) {
    bindSourcingOwner('sticky-' + kind);
    const owner = 'sticky-' + kind;
    const command =
      kind === 'submit'
        ? { kind, locale: 'fa' as const, body: sourcingSubmitSchema.parse(sourcingTestSubmit) }
        : {
            kind,
            id: sourcingTestMutation.id,
            body: {
              requestId: sourcingTestSubmit.requestId,
              version: sourcingTestMutation.version,
            },
          };
    startSourcingJournal(owner, command);
    assert.equal(failSourcingJournal(owner, command.body.requestId, 0), 'unknown');
    const frozen = readSourcingJournal(owner)!.command;
    for (const status of [429, 403, 409, 404, 400]) {
      assert.equal(failSourcingJournal(owner, command.body.requestId, status), 'unknown');
      assert.equal(readSourcingJournal(owner)!.uncertain, true);
      assert.deepEqual(readSourcingJournal(owner)!.command, frozen);
      assert.throws(() => startSourcingJournal(owner, command));
    }
    assert.equal(
      finishSourcingJournal(
        owner,
        command.body.requestId,
        sourcingMutationSchema.parse({
          ...sourcingTestMutation,
          state: kind === 'submit' ? 'Submitted' : 'Cancelled',
          replayed: true,
        }),
      ),
      true,
    );
    assert.ok(readSourcingJournal(owner)!.result);
  }
  bindSourcingOwner(null);
});
test('a first definitive rejection can clear intent but retrying an unresolved navigation cannot', () => {
  bindSourcingOwner('rejection');
  const command = {
    kind: 'submit' as const,
    locale: 'fa' as const,
    body: sourcingSubmitSchema.parse(sourcingTestSubmit),
  };
  startSourcingJournal('rejection', command);
  assert.equal(failSourcingJournal('rejection', command.body.requestId, 409), 'rejected');
  assert.equal(readSourcingJournal('rejection'), null);
  startSourcingJournal('rejection', command);
  assert.equal(markSourcingUncertain('rejection', command.body.requestId), true);
  assert.equal(failSourcingJournal('rejection', command.body.requestId, 429), 'unknown');
  assert.ok(readSourcingJournal('rejection'));
  bindSourcingOwner('other');
  assert.equal(failSourcingJournal('rejection', command.body.requestId, 503), 'ignored');
  assert.equal(readSourcingJournal('rejection'), null);
  bindSourcingOwner(null);
});
test('an unrelated receipt cannot resolve a pending cancellation', () => {
  bindSourcingOwner('receipt');
  const command = {
    kind: 'cancel' as const,
    id: sourcingTestMutation.id,
    body: { requestId: sourcingTestSubmit.requestId, version: sourcingTestMutation.version },
  };
  startSourcingJournal('receipt', command);
  markSourcingUncertain('receipt', command.body.requestId);
  for (const result of [
    sourcingTestMutation,
    { ...sourcingTestMutation, state: 'Cancelled', id: 'c'.repeat(32) },
  ])
    assert.equal(
      finishSourcingJournal(
        'receipt',
        command.body.requestId,
        sourcingMutationSchema.parse(result),
      ),
      false,
    );
  assert.equal(readSourcingJournal('receipt')!.uncertain, true);
  assert.equal(readSourcingJournal('receipt')!.result, null);
  bindSourcingOwner(null);
});
