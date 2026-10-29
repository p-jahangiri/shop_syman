import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAccountingCsv,
  accountingImportInputSchema,
  accountingImportSavedSchema,
} from './accounting-import-contract.ts';
const header = 'externalItemId,externalCode,externalName,externalUnitKey,quantityRaw,priceRaw';
test('Normalized CSV preserves opaque IDs, quoted commas and above-2^53 decimal strings', () => {
  const rows = parseAccountingCsv(
    '\uFEFF' + header + '\r\n"0001-Ab",,"گوشی، نمونه",EA,1.5,9007199254740993\r\n',
  );
  assert.equal(rows[0].externalItemId, '0001-Ab');
  assert.equal(rows[0].quantityRaw, '1.5');
  assert.equal(rows[0].priceRaw, '9007199254740993');
  assert.equal(rows[0].externalCode, null);
  assert.equal(rows[0].externalName, 'گوشی، نمونه');
});
test('Missing values remain unknown rather than numeric zero', () => {
  const [row] = parseAccountingCsv(header + '\na,,,EA,,');
  assert.equal(row.quantityRaw, null);
  assert.equal(row.priceRaw, null);
  assert.equal(parseAccountingCsv(header + '\na,,,EA,0,0')[0].priceRaw, '0');
});
test('CSV quoting errors, unknown headers and malformed columns fail closed', () => {
  for (const text of [
    header + '\na,,,EA,1,"bad',
    header + '\na,,,EA,1,"2"x',
    header + '\na,,,EA,1,2,3',
    header + '\na,,,EA,1',
    header.replace('externalItemId', 'sku') + '\na,,,EA,1,2',
  ])
    assert.throws(() => parseAccountingCsv(text));
});
test('CSV bounds and embedded control characters are rejected', () => {
  assert.throws(() => parseAccountingCsv(header + '\n' + Array(201).fill('a,,,EA,1,2').join('\n')));
  assert.throws(() => parseAccountingCsv('x'.repeat(262145)));
  assert.throws(() => parseAccountingCsv(header + '\na,,"line\nbreak",EA,1,2'));
});
test('Batch validates exact stable item duplication without folding case or zeroes', () => {
  const rows = parseAccountingCsv(header + '\n0001-A,,,EA,1,1\n0001-a,,,EA,2,2');
  const input = {
    schemaVersion: 1,
    companyKey: 'C',
    externalWarehouseKey: 'WH',
    quantityMeaning: 'physical',
    priceCurrency: 'IRR',
    observedAt: '2026-10-24T18:00:00Z',
    isDemo: true,
    rows,
  };
  assert.equal(accountingImportInputSchema.parse(input).rows.length, 2);
  assert.throws(() => accountingImportInputSchema.parse({ ...input, rows: [rows[0], rows[0]] }));
  assert.throws(() => accountingImportInputSchema.parse({ ...input, extra: true }));
});
test('Receipt can never claim an apply or live sync occurred', () => {
  const receipt = {
    schemaVersion: 1,
    id: 'a'.repeat(32),
    payloadHash: 'A'.repeat(64),
    replayed: false,
    applied: false,
  };
  assert.equal(accountingImportSavedSchema.parse(receipt).applied, false);
  assert.throws(() => accountingImportSavedSchema.parse({ ...receipt, applied: true }));
  assert.throws(() => accountingImportSavedSchema.parse({ ...receipt, canSyncLive: true }));
});
