import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sourcingAdminDetailSchema,
  sourcingAdminPageSchema,
  sourcingCommandMatches,
  sourcingFailureIsUnknown,
  sourcingListPath,
  type SourcingCommand,
} from './sourcing-contract.ts';
import { sourcingSummarySchema } from '../../storefront/lib/sourcing-contract.ts';
const summary = {
  id: 'a'.repeat(32),
  reference: 'SR-1',
  locale: 'fa',
  state: 'Submitted',
  createdAt: '2026-10-23T10:00:00.0000000+00:00',
  changedAt: '2026-10-23T10:00:00+00:00',
  itemCount: 1,
  lineCount: 1,
  version: 'AAAAAAAAAAE=',
  isDemo: true,
};
test('admin summaries require owner while customer summaries reject that private field', () => {
  const page = sourcingAdminPageSchema.parse({
    schemaVersion: 1,
    pageSize: 50,
    items: [{ ...summary, ownerId: 'qa-owner' }],
  });
  assert.equal(page.nextCursor, null);
  assert.equal(page.items[0].ownerId, 'qa-owner');
  assert.equal(sourcingSummarySchema.safeParse({ ...summary, ownerId: 'qa-owner' }).success, false);
  assert.equal(
    sourcingAdminPageSchema.safeParse({
      schemaVersion: 1,
      pageSize: 50,
      items: [summary],
      nextCursor: null,
    }).success,
    false,
  );
});
test('an unresolved prior attempt cannot become rejected when a retry has a 4xx response', () => {
  for (const status of [400, 401, 403, 404, 409, 429, 500, 503, 0, null])
    assert.equal(sourcingFailureIsUnknown(true, status), true);
  for (const status of [400, 401, 403, 409, 429])
    assert.equal(sourcingFailureIsUnknown(false, status), false);
  for (const status of [0, 500, 503, null])
    assert.equal(sourcingFailureIsUnknown(false, status), true);
});
test('a successful action acknowledgement binds request, reference and operation result', () => {
  const command: SourcingCommand = {
    id: 'c'.repeat(32),
    kind: 'review',
    targetId: summary.id,
    reference: summary.reference,
    body: { requestId: 'c'.repeat(32), version: summary.version },
    phase: 'unknown',
  };
  const result = {
    schemaVersion: 1 as const,
    id: summary.id,
    reference: summary.reference,
    state: 'Reviewing' as const,
    version: 'AAAAAAAAAAI=',
    eventId: '9007199254740993',
    at: summary.changedAt,
    replayed: true,
    requestOnly: true as const,
    canPay: false as const,
  };
  assert.equal(sourcingCommandMatches(command, result), true);
  assert.equal(sourcingCommandMatches(command, { ...result, id: 'b'.repeat(32) }), false);
  assert.equal(sourcingCommandMatches(command, { ...result, reference: 'SR-2' }), false);
  assert.equal(sourcingCommandMatches(command, { ...result, state: 'Unavailable' }), false);
  assert.equal(
    sourcingCommandMatches(
      { ...command, kind: 'unavailable' },
      { ...result, state: 'Unavailable' },
    ),
    true,
  );
});
test('technical limits, false payment flag and duplicate records cannot silently pass admin decoding', () => {
  assert.equal(
    sourcingAdminPageSchema.safeParse({
      schemaVersion: 1,
      pageSize: 20,
      items: [],
      nextCursor: null,
    }).success,
    false,
  );
  assert.equal(
    sourcingAdminPageSchema.safeParse({
      schemaVersion: 1,
      pageSize: 50,
      items: [
        { ...summary, ownerId: 'qa' },
        { ...summary, ownerId: 'qa' },
      ],
      nextCursor: null,
    }).success,
    false,
  );
  assert.equal(
    sourcingAdminDetailSchema.safeParse({
      schemaVersion: 1,
      summary: { ...summary, ownerId: 'qa' },
      note: '',
      lines: [],
      canCancel: false,
      canReview: true,
      canMarkUnavailable: true,
      requestOnly: true,
      canPay: true,
    }).success,
    false,
  );
});
test('list path encodes filters and treats a missing cursor as the first page', () => {
  const url = new URL(sourcingListPath('Reviewing', 'SR-1 & sample', null), 'http://localhost');
  assert.equal(url.searchParams.get('state'), 'Reviewing');
  assert.equal(url.searchParams.get('query'), 'SR-1 & sample');
  assert.equal(url.searchParams.has('cursor'), false);
  assert.equal(sourcingListPath('all', '', null), '/admin/sourcing/requests');
});
