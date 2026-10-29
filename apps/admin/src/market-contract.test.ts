import test from 'node:test';
import assert from 'node:assert/strict';
import {
  previewSchema,
  readImportResult,
  marketModelInputSchema,
  marketPageSchema,
  type ImportCommand,
  type ImportResult,
} from './market-contract.ts';
import {
  keepMarketImportCommand,
  readMarketImportJournal,
  finishMarketImportCommand,
  clearMarketImportJournal,
} from './market-import-journal.ts';
const expected = {
  rowNumber: 2,
  listingId: null,
  listingVersion: null,
  modelId: null,
  modelVersion: null,
  metadataFingerprint: 'A'.repeat(64),
};
const requestId = '12345678-1234-4123-8123-123456789abc';
const result: ImportResult = {
  schemaVersion: 1,
  requestId,
  payloadHash: 'B'.repeat(64),
  created: 1,
  updated: 0,
  rows: [{ rowNumber: 2, listingId: 'listing-1', modelId: 'model-1', operation: 'create' }],
  replayed: false,
};
test('receipt is tied to UUID, row identities and exact counters', () => {
  assert.equal(readImportResult(result, requestId, [expected]).created, 1);
  for (const invalid of [
    { ...result, requestId: '12345678-1234-4123-8123-123456789abd' },
    { ...result, created: 2 },
    { ...result, rows: [{ ...result.rows[0], rowNumber: 3 }] },
    { ...result, payloadHash: 'bad' },
    { ...result, rows: [result.rows[0], result.rows[0]], created: 2 },
  ])
    assert.throws(() => readImportResult(invalid, requestId, [expected]));
  assert.throws(() =>
    readImportResult(result, requestId, [{ ...expected, modelId: 'another-model' }]),
  );
});
test('preview preserves large reference money as strings and rejects mismatched readiness', () => {
  const row = {
    rowNumber: 2,
    operation: 'create',
    nameFa: 'نمونه',
    nameEn: 'Sample',
    sourceKey: 'manual',
    sourceItemKey: 'a',
    status: 'Draft',
    referencePriceRial: '9007199254740993',
    hasStorefrontOffers: false,
    expected,
    issues: [],
  };
  const value = {
    schemaVersion: 1,
    fileHash: 'A'.repeat(64),
    rows: [row],
    validRows: 1,
    invalidRows: 0,
    canCommit: true,
  };
  assert.equal(previewSchema.parse(value).rows[0].referencePriceRial, '9007199254740993');
  for (const invalid of [
    { ...value, canCommit: false },
    { ...value, rows: [{ ...row, expected: null }] },
    { ...value, rows: [{ ...row, referencePriceRial: Number('9007199254740993') }] },
    { ...value, rows: [{ ...row, referencePriceRial: '9223372036854775808' }] },
  ])
    assert.equal(previewSchema.safeParse(invalid).success, false);
});
test('model metadata keeps decimal attributes out of JavaScript number conversion', () => {
  const value = {
    categoryId: 'phones',
    brandId: 'brand',
    slug: 'sample',
    translations: [
      { locale: 'fa', name: 'نمونه', description: '' },
      { locale: 'en', name: 'Sample', description: '' },
    ],
    attributes: [{ attributeId: 'a', number: '99999999999999999999.12345678', bool: null }],
    imageUrls: [],
    version: null,
  };
  assert.equal(
    marketModelInputSchema.parse(value).attributes[0].number,
    '99999999999999999999.12345678',
  );
  assert.equal(
    marketModelInputSchema.safeParse({ ...value, attributes: [{ attributeId: 'a', number: 1.5 }] })
      .success,
    false,
  );
});
test('paged listing never accepts duplicate IDs or numeric versions', () => {
  const row = {
    id: 'l1',
    modelId: 'm1',
    nameFa: 'نمونه',
    nameEn: 'Sample',
    status: 'Draft',
    sourceKey: 'manual',
    sourceItemKey: 'a',
    isDemo: true,
    version: 'AAAAAAAAAAA=',
  };
  const page = { schemaVersion: 1, pageSize: 50, items: [row], nextCursor: null };
  assert.equal(marketPageSchema.parse(page).items.length, 1);
  assert.equal(marketPageSchema.safeParse({ ...page, items: [row, row] }).success, false);
  assert.equal(
    marketPageSchema.safeParse({ ...page, items: [{ ...row, version: 1 }] }).success,
    false,
  );
});
test('memory journal survives component navigation, isolates owners and ignores late replies after logout', () => {
  clearMarketImportJournal();
  const command: ImportCommand = { csv: 'private sample CSV', requestId, expected: [expected] };
  keepMarketImportCommand('owner-a', command);
  command.csv = 'mutated';
  assert.equal(readMarketImportJournal('owner-a')!.command.csv, 'private sample CSV');
  assert.equal(readMarketImportJournal('owner-b'), null);
  assert.equal(finishMarketImportCommand('owner-b', requestId, result), false);
  clearMarketImportJournal();
  assert.equal(finishMarketImportCommand('owner-a', requestId, result), false);
  assert.equal(readMarketImportJournal('owner-a'), null);
});

test('admin market brand filters survive URL encoding and paging without changing legacy paths', async () => {
  const { marketListPath } = await import('./market-contract.ts');
  assert.equal(marketListPath('', 'all', '', null), '/admin/market');
  const path = marketListPath('گوشی ۱۲', 'Published', 'phones', 'cursor_1', 'market-brand');
  const url = new URL(path, 'http://localhost');
  assert.equal(url.searchParams.get('brandId'), 'market-brand');
  assert.equal(url.searchParams.get('query'), 'گوشی ۱۲');
  assert.equal(url.searchParams.get('cursor'), 'cursor_1');
  assert.equal(url.searchParams.get('categoryId'), 'phones');
  assert.equal(url.searchParams.get('status'), 'Published');
});
