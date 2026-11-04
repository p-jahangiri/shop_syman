import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  sourceCsvPreviewSchema,
  sourceCsvResultSchema,
  readSourceCsvResult,
  sourceCsvHash,
  type SourceCsvCommand,
} from '../src/api/contracts/market/market-source-csv-contract.ts';
import {
  keepSourceCsvCommand,
  readSourceCsvJournal,
  finishSourceCsvCommand,
  clearSourceCsvJournal,
} from '../src/state/market/market-source-csv-journal.ts';
const listingId = 'a'.repeat(32),
  sourceId = 'b'.repeat(32),
  version = 'AAAAAAAAB9k=',
  hash = 'A'.repeat(64),
  requestId = '11111111-1111-4111-8111-111111111111';
const expected = {
  rowNumber: 2,
  listingId,
  listingVersion: version,
  sourceId,
  sourceVersion: null,
  modelVersion: version,
  metadataFingerprint: hash,
};
const row = {
  rowNumber: 2,
  listingId,
  sourceId,
  operation: 'create' as const,
  nameFa: 'نمونه',
  nameEn: 'Sample',
  sourceNameFa: 'منبع نمونه',
  sourceNameEn: 'Sample source',
  referencePriceRial: '9007199254740993',
  expected,
  issues: [],
};
const preview = {
  schemaVersion: 1,
  fileHash: hash,
  rows: [
    row,
    {
      ...row,
      rowNumber: 3,
      sourceId: 'c'.repeat(32),
      expected: { ...expected, rowNumber: 3, sourceId: 'c'.repeat(32) },
    },
  ],
  validRows: 2,
  invalidRows: 0,
  canCommit: true,
};
const result = {
  schemaVersion: 1 as const,
  requestId,
  payloadHash: hash,
  fileHash: hash,
  created: 2,
  updated: 0,
  rows: preview.rows.map((x) => ({
    rowNumber: x.rowNumber,
    listingId: x.listingId,
    sourceId: x.sourceId,
    operation: 'create' as const,
    listingVersion: version,
    sourceVersion: version,
  })),
  replayed: false,
};
const command: SourceCsvCommand = {
  csv: 'Synthetic CSV text',
  requestId,
  expected: preview.rows.map((x) => x.expected),
  fileHash: hash,
};
test('source report previews permit several sources for one model while binding each expected row', () => {
  assert.equal(sourceCsvPreviewSchema.parse(preview).validRows, 2);
  assert.equal(
    sourceCsvPreviewSchema.parse(preview).rows[0].referencePriceRial,
    '9007199254740993',
  );
  for (const raw of [
    { ...preview, validRows: 1 },
    { ...preview, rows: [{ ...row, sourceId: 'c'.repeat(32) }], validRows: 1 },
    {
      ...preview,
      rows: [{ ...row, referencePriceRial: Number('9007199254740993') }],
      validRows: 1,
    },
    { ...preview, rows: [{ ...row, sku: 'fake' }], validRows: 1 },
    { ...preview, rows: [{ ...row, expected: null }], validRows: 1 },
  ])
    assert.equal(sourceCsvPreviewSchema.safeParse(raw).success, false);
});
test('batch results bind UUID, raw file hash, row identities and operations without deduplicating parents', () => {
  assert.equal(readSourceCsvResult(result, requestId, command.expected, hash).created, 2);
  assert.equal(
    sourceCsvResultSchema.parse(result).rows[0].listingId,
    sourceCsvResultSchema.parse(result).rows[1].listingId,
  );
  for (const raw of [
    { ...result, fileHash: 'B'.repeat(64) },
    { ...result, requestId: '22222222-2222-4222-8222-222222222222' },
    { ...result, rows: [result.rows[0], result.rows[0]] },
    { ...result, rows: [result.rows[0], { ...result.rows[1], listingId: 'd'.repeat(32) }] },
    {
      ...result,
      rows: [{ ...result.rows[0], operation: 'update' }, result.rows[1]],
      created: 1,
      updated: 1,
    },
  ])
    assert.throws(() => readSourceCsvResult(raw, requestId, command.expected, hash));
});
test('CSV hash binds exact UTF8 text and journal locks body/file/expectations across navigation', async () => {
  const csv = '\uFEFFlisting_id,source_name_fa\r\nنمونه,"منبع، دوم"\r\n';
  assert.equal(
    await sourceCsvHash(csv),
    createHash('sha256').update(csv).digest('hex').toUpperCase(),
  );
  assert.notEqual(await sourceCsvHash(csv), await sourceCsvHash(csv.replaceAll('\r\n', '\n')));
  clearSourceCsvJournal();
  keepSourceCsvCommand('owner-a', command);
  const copy = readSourceCsvJournal('owner-a')!;
  copy.command.csv = 'changed';
  assert.equal(readSourceCsvJournal('owner-a')!.command.csv, command.csv);
  assert.equal(readSourceCsvJournal('owner-b'), null);
  assert.throws(() => keepSourceCsvCommand('owner-a', { ...command, csv: 'different' }));
  assert.throws(() =>
    keepSourceCsvCommand('owner-a', {
      ...command,
      expected: [{ ...expected, listingVersion: 'AAAAAAAAB9o=' }],
    }),
  );
  assert.equal(finishSourceCsvCommand('owner-b', command, result), false);
  assert.equal(
    finishSourceCsvCommand('owner-a', command, { ...result, fileHash: 'B'.repeat(64) }),
    false,
  );
  clearSourceCsvJournal('owner-b');
  assert.ok(readSourceCsvJournal('owner-a'));
  assert.equal(finishSourceCsvCommand('owner-a', command, result), true);
  clearSourceCsvJournal();
  assert.equal(finishSourceCsvCommand('owner-a', command, result), false);
});
