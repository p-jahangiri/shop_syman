import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adminSourcesSchema,
  readSourceResult,
  sourceInputSchema,
  type SourceCommand,
} from '../src/api/contracts/market/market-sources-contract.ts';
import {
  keepSourceCommand,
  readSourceJournal,
  finishSourceCommand,
  clearSourceJournal,
} from '../src/state/market/market-source-journal.ts';
const listingId = 'a'.repeat(32),
  sourceId = 'b'.repeat(32),
  requestId = '11111111-1111-4111-8111-111111111111',
  version = 'AAAAAAAAB9k=';
const details = {
  status: 'Published',
  sourceKey: 'synthetic',
  sourceItemKey: 'sample',
  sourceNameFa: 'نمونه',
  sourceNameEn: 'Sample',
  sourceUrl: null,
  availability: 'unknown',
  observedAt: null,
  validUntil: null,
  referencePriceRial: null,
  isDemo: true,
};
const result = {
  schemaVersion: 1 as const,
  requestId,
  listingId,
  sourceId,
  listingVersion: version,
  sourceVersion: version,
  replayed: false,
};
const command: SourceCommand = {
  listingId,
  sourceId,
  requestId,
  input: sourceInputSchema.parse({ listingVersion: version, sourceVersion: null, details }),
};
test('admin sources enforce unique identity and bind command receipts', () => {
  assert.equal(
    adminSourcesSchema.parse({
      schemaVersion: 1,
      listingId,
      listingVersion: version,
      sources: [{ id: listingId, isPrimary: true, details, version }],
    }).sources.length,
    1,
  );
  assert.equal(
    adminSourcesSchema.safeParse({
      schemaVersion: 1,
      listingId,
      listingVersion: version,
      sources: [{ id: sourceId, isPrimary: true, details, version }],
    }).success,
    false,
  );
  assert.equal(readSourceResult(result, command).requestId, requestId);
  for (const raw of [
    { ...result, listingId: sourceId },
    { ...result, sourceId: listingId },
    { ...result, requestId: '22222222-2222-4222-8222-222222222222' },
    { ...result, sourceVersion: 'not-version' },
    { ...result, stock: 10 },
  ])
    assert.throws(() => readSourceResult(raw, command));
});
test('source command journal survives navigation in memory and isolates owner/UUID and logout', () => {
  clearSourceJournal();
  keepSourceCommand('owner-a', command);
  const first = readSourceJournal('owner-a')!;
  first.command.input.details.sourceNameEn = 'changed copy';
  assert.equal(readSourceJournal('owner-a')!.command.input.details.sourceNameEn, 'Sample');
  assert.equal(readSourceJournal('owner-b'), null);
  assert.throws(() =>
    keepSourceCommand('owner-a', {
      ...command,
      input: {
        ...command.input,
        details: { ...command.input.details, sourceNameEn: 'different body' },
      },
    }),
  );
  assert.throws(() =>
    keepSourceCommand('owner-a', { ...command, requestId: '22222222-2222-4222-8222-222222222222' }),
  );
  assert.equal(finishSourceCommand('owner-b', command, result), false);
  assert.equal(finishSourceCommand('owner-a', command, { ...result, sourceId: listingId }), false);
  assert.equal(finishSourceCommand('owner-a', command, result), true);
  clearSourceJournal();
  assert.equal(readSourceJournal('owner-a'), null);
  assert.equal(finishSourceCommand('owner-a', command, result), false);
});
