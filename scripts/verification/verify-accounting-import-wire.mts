import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  accountingImportSavedSchema,
  accountingImportDetailSchema,
  accountingImportPageSchema,
} from '../../apps/admin/src/api/contracts/accounting/accounting-import-contract.ts';
const directory = path.resolve(process.argv[2] ?? 'artifacts/checks/holoo-stage-wire-final');
const files = [
  ['holoo-stage-saved.json', accountingImportSavedSchema],
  ['holoo-stage-replayed.json', accountingImportSavedSchema],
  ['holoo-stage-detail.json', accountingImportDetailSchema],
  ['holoo-stage-page.json', accountingImportPageSchema],
] as const;
const result = [];
for (const [file, schema] of files) {
  const b = await readFile(path.join(directory, file));
  assert(b.length > 0 && b.length <= 524288);
  const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b));
  schema.parse(raw);
  result.push({ file, bytes: b.length, sha256: createHash('sha256').update(b).digest('hex') });
}
const saved = JSON.parse(await readFile(path.join(directory, files[0][0]), 'utf8')),
  replay = JSON.parse(await readFile(path.join(directory, files[1][0]), 'utf8')),
  detail = accountingImportDetailSchema.parse(
    JSON.parse(await readFile(path.join(directory, files[2][0]), 'utf8')),
  ),
  page = accountingImportPageSchema.parse(
    JSON.parse(await readFile(path.join(directory, files[3][0]), 'utf8')),
  );
assert(!saved.replayed && replay.replayed);
assert.equal(saved.id, replay.id);
assert.equal(saved.payloadHash, replay.payloadHash);
assert.equal(detail.batch.id, saved.id);
assert.equal(detail.batch.payloadHash, saved.payloadHash);
assert.equal(detail.rows[0].priceRial, '9007199254740993');
assert.equal(detail.rows[1].quantity, null);
assert.equal(detail.rows[1].quantityRaw, '1.5');
assert.equal(detail.rows[1].priceRial, null);
assert.equal(page.items.length, 1);
assert.equal(page.items[0].id, saved.id);
const report = {
  passed: 4,
  actualSqlHttp: true,
  strictProductionDecoders: true,
  originalRawBodyHashes: true,
  bodyNormalization: false,
  browserAccepted: false,
  mainPromoted: false,
  bodies: result,
};
await writeFile(
  path.join(directory, 'holoo-stage-wire-report.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report));
