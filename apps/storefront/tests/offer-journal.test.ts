import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bindSourcingOwner,
  failSourcingJournal,
  finishSourcingJournal,
  markSourcingUncertain,
  readSourcingJournal,
  sourcingJournalTarget,
  startSourcingJournal,
  subscribeSourcingJournal,
  type SourcingOfferCommand,
} from '../lib/market/sourcing-journal.ts';
import {
  offerActionSchema,
  offerMutationSchema,
} from '@sayman/web-shared/lib/market/offer-contract.ts';
import { sourcingSubmitSchema } from '@sayman/web-shared/lib/market/sourcing-contract.ts';
import {
  offerTestAction,
  offerTestDetail,
  offerTestId,
  offerTestMutation,
  offerTestRequest,
} from '@sayman/web-shared/testing/offer.test-fixtures.ts';
import {
  sourcingTestSubmit,
  sourcingTestMutation,
} from '@sayman/web-shared/testing/sourcing.test-fixtures.ts';
const command = (kind: 'accept' | 'decline' = 'accept'): SourcingOfferCommand => ({
  kind,
  id: offerTestRequest,
  offerId: offerTestId,
  reference: offerTestDetail.requestReference,
  body: offerActionSchema.parse(offerTestAction),
});
test('offer consent and request cancellation use exactly one frozen owner-bound journal slot', () => {
  bindSourcingOwner('offer-owner');
  const input = command();
  startSourcingJournal('offer-owner', input);
  input.body.termsHash = 'B'.repeat(64);
  assert.equal(
    readSourcingJournal('offer-owner')!.command.body.requestId,
    offerTestAction.requestId,
  );
  const first = readSourcingJournal('offer-owner')!;
  assert.equal(
    'termsHash' in first.command.body && first.command.body.termsHash,
    offerTestAction.termsHash,
  );
  assert.throws(() =>
    startSourcingJournal('offer-owner', {
      kind: 'cancel',
      id: offerTestRequest,
      body: { requestId: '11234567-89ab-4cde-8012-3456789abcde', version: offerTestAction.version },
    }),
  );
  assert.throws(() =>
    startSourcingJournal('offer-owner', {
      kind: 'submit',
      locale: 'fa',
      body: sourcingSubmitSchema.parse(sourcingTestSubmit),
    }),
  );
  assert.equal(
    finishSourcingJournal('offer-owner', offerTestAction.requestId, sourcingTestMutation as never),
    false,
  );
  const result = offerMutationSchema.parse(offerTestMutation);
  for (const wrong of [
    { ...result, requestId: 'f'.repeat(32) },
    { ...result, offerId: 'f'.repeat(32) },
    { ...result, operation: 'decline' as const, state: 'Declined' as const, acceptanceId: null },
  ])
    assert.equal(finishSourcingJournal('offer-owner', offerTestAction.requestId, wrong), false);
  assert.equal(finishSourcingJournal('offer-owner', offerTestAction.requestId, result), true);
  assert.deepEqual(sourcingJournalTarget(readSourcingJournal('offer-owner')!), {
    id: offerTestRequest,
    reference: offerTestDetail.requestReference,
  });
  bindSourcingOwner(null);
});
test('lost offer decisions preserve exact intent through navigation and every retry rejection', () => {
  for (const kind of ['accept', 'decline'] as const) {
    const owner = 'offer-' + kind;
    bindSourcingOwner(owner);
    const initial = command(kind);
    startSourcingJournal(owner, initial);
    let notifications = 0;
    const leave = subscribeSourcingJournal(() => notifications++);
    assert.equal(failSourcingJournal(owner, initial.body.requestId, 0), 'unknown');
    leave();
    const before = readSourcingJournal(owner)!;
    // A different mounted page reads the same memory journal. No local storage,
    // fresh UUID, fresh version, or automatic mutation retry is introduced.
    const returnToPage = readSourcingJournal(owner)!;
    assert.deepEqual(returnToPage.command, before.command);
    assert.equal(returnToPage.uncertain, true);
    assert.equal(notifications, 1);
    for (const status of [400, 401, 403, 404, 409, 429, 500, 503]) {
      assert.equal(failSourcingJournal(owner, initial.body.requestId, status), 'unknown');
      assert.deepEqual(readSourcingJournal(owner)!.command, before.command);
      assert.throws(() => startSourcingJournal(owner, command(kind)));
    }
    const receipt = offerMutationSchema.parse({
      ...offerTestMutation,
      operation: kind,
      state: kind === 'accept' ? 'Accepted' : 'Declined',
      acceptanceId: kind === 'accept' ? offerTestMutation.acceptanceId : null,
      replayed: true,
    });
    assert.equal(finishSourcingJournal(owner, initial.body.requestId, receipt), true);
    assert.equal(readSourcingJournal(owner)!.result!.replayed, true);
  }
  bindSourcingOwner(null);
});
test('an unresolved navigation retry remains unknown even if its first visible response is4xx', () => {
  bindSourcingOwner('navigation');
  const initial = command();
  startSourcingJournal('navigation', initial);
  markSourcingUncertain('navigation', initial.body.requestId);
  assert.equal(failSourcingJournal('navigation', initial.body.requestId, 409), 'unknown');
  assert.deepEqual(readSourcingJournal('navigation')!.command, initial);
  bindSourcingOwner('other');
  assert.equal(
    finishSourcingJournal(
      'navigation',
      initial.body.requestId,
      offerMutationSchema.parse(offerTestMutation),
    ),
    false,
  );
  assert.equal(readSourcingJournal('navigation'), null);
  bindSourcingOwner('navigation');
  assert.equal(readSourcingJournal('navigation'), null);
  assert.equal(failSourcingJournal('navigation', initial.body.requestId, 503), 'ignored');
  bindSourcingOwner(null);
});
test('competing acceptance and cancellation intents cannot occupy parallel slots', async () => {
  bindSourcingOwner('competing');
  const intents = await Promise.allSettled([
    Promise.resolve().then(() => startSourcingJournal('competing', command())),
    Promise.resolve().then(() =>
      startSourcingJournal('competing', {
        kind: 'cancel',
        id: offerTestRequest,
        body: {
          requestId: '11234567-89ab-4cde-8012-3456789abcde',
          version: offerTestAction.version,
        },
      }),
    ),
  ]);
  assert.equal(intents.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(intents.filter((item) => item.status === 'rejected').length, 1);
  assert.equal(readSourcingJournal('competing')!.command.kind, 'accept');
  bindSourcingOwner(null);
});
