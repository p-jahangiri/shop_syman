import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MarketImportDraft,
  marketImportCsvHash,
  marketImportFailureIsUnknown,
} from '../src/state/market-import-state.ts';
import {
  keepMarketImportCommand,
  readMarketImportJournal,
  markMarketImportUncertain,
  finishMarketImportCommand,
  clearMarketImportJournal,
} from '../src/state/market/market-import-journal.ts';
import type { ImportCommand, ImportResult } from '../src/api/contracts/market/market-contract.ts';

test('a file read immediately invalidates its old preview and cannot race a new preview', () => {
  const draft = new MarketImportDraft<{ hash: string }>('FILE_A');
  const previewA = draft.beginPreview();
  assert.equal(draft.acceptPreview(previewA, { hash: 'A' }), true);
  const readB = draft.beginFileRead();
  assert.equal(draft.readingFile, true);
  assert.throws(() => draft.beginPreview());
  assert.throws(() => draft.reviewed());
  assert.equal(draft.acceptPreview(previewA, { hash: 'late A' }), false);
  assert.equal(draft.finishFileRead(readB, 'FILE_B'), true);
  assert.equal(draft.acceptPreview(previewA, { hash: 'A' }), false);
  const previewB = draft.beginPreview();
  assert.equal(previewB.csv, 'FILE_B');
  assert.equal(draft.acceptPreview(previewB, { hash: 'B' }), true);
  assert.deepEqual(draft.reviewed(), { csv: 'FILE_B', preview: { hash: 'B' } });
});
test('late file reads and cancellation never replace a newer file', () => {
  const draft = new MarketImportDraft('initial'),
    first = draft.beginFileRead(),
    second = draft.beginFileRead();
  assert.equal(draft.cancelFileRead(first), false);
  assert.equal(draft.readingFile, true);
  assert.equal(draft.finishFileRead(first, 'old'), false);
  assert.equal(draft.finishFileRead(second, 'new'), true);
  assert.equal(draft.beginPreview().csv, 'new');
});
test('a reviewed snapshot is immutable and changing even one character requires another preview', () => {
  const draft = new MarketImportDraft<{ rows: { id: string }[] }>('raw\r\ntext');
  const input = { rows: [{ id: 'one' }] },
    token = draft.beginPreview();
  assert.equal(draft.acceptPreview(token, input), true);
  input.rows[0].id = 'outside mutation';
  const read = draft.reviewed();
  read.preview.rows[0].id = 'returned mutation';
  assert.equal(draft.reviewed().preview.rows[0].id, 'one');
  assert.equal(draft.reviewed().csv, 'raw\r\ntext');
  draft.replace('raw\ntext');
  assert.throws(() => draft.reviewed());
});
test('authorization, transport and later rejections preserve an uncertain command', () => {
  for (const status of [undefined, 0, 401, 403, 408, 429, 500, 503])
    assert.equal(marketImportFailureIsUnknown(status), true);
  for (const status of [400, 404, 409, 413, 422]) {
    assert.equal(marketImportFailureIsUnknown(status), false);
    assert.equal(marketImportFailureIsUnknown(status, true), true);
  }
});
test('primary CSV journal preserves exact UUID/body and uncertainty through navigation/retry', () => {
  clearMarketImportJournal();
  const command: ImportCommand = {
    csv: 'exact private CSV\r\n',
    requestId: '11111111-1111-4111-8111-111111111111',
    expected: [
      {
        rowNumber: 2,
        listingId: null,
        listingVersion: null,
        modelId: null,
        modelVersion: null,
        metadataFingerprint: 'A'.repeat(64),
      },
    ],
  };
  const result: ImportResult = {
    schemaVersion: 1,
    requestId: command.requestId,
    payloadHash: 'B'.repeat(64),
    created: 1,
    updated: 0,
    rows: [{ rowNumber: 2, listingId: 'listing', modelId: 'model', operation: 'create' }],
    replayed: true,
  };
  keepMarketImportCommand('owner', command);
  assert.equal(markMarketImportUncertain('owner', command), true);
  keepMarketImportCommand('owner', structuredClone(command));
  assert.equal(readMarketImportJournal('owner')!.uncertain, true);
  assert.throws(() =>
    keepMarketImportCommand('owner', { ...command, csv: command.csv + 'changed' }),
  );
  assert.throws(() =>
    keepMarketImportCommand('owner', {
      ...command,
      requestId: '22222222-2222-4222-8222-222222222222',
    }),
  );
  assert.equal(markMarketImportUncertain('another-owner', command), false);
  assert.equal(
    finishMarketImportCommand('owner', command.requestId, {
      ...result,
      requestId: '22222222-2222-4222-8222-222222222222',
    }),
    false,
  );
  assert.equal(finishMarketImportCommand('owner', command.requestId, result), true);
  assert.equal(readMarketImportJournal('owner')!.uncertain, false);
  clearMarketImportJournal();
});
test('the exact preview hash distinguishes BOM and line endings', async () => {
  assert.equal((await marketImportCsvHash('sample')).length, 64);
  assert.notEqual(await marketImportCsvHash('sample\r\n'), await marketImportCsvHash('sample\n'));
  assert.notEqual(await marketImportCsvHash('\ufeffsample'), await marketImportCsvHash('sample'));
});
