import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  sourceCsvPreviewSchema,
  sourceCsvResultSchema,
} from '../apps/admin/src/market-source-csv-contract.ts';
const dir = process.argv[2];
assert.ok(dir);
const manifest = JSON.parse(await readFile(`${dir}/manifest.json`, 'utf8'));
assert.equal(manifest.actualSqlHttpBodies, true);
assert.equal(manifest.syntheticCsvInputsOnly, true);
const expected = [
  'preview-valid',
  'commit-created',
  'preview-update',
  'commit-updated',
  'commit-replay',
  'receipt',
  'preview-invalid',
  'preview50',
  'commit50',
];
assert.deepEqual(
  manifest.entries.map((x: { file: string }) => x.file).sort(),
  expected.map((x) => x + '.json').sort(),
);
for (const entry of manifest.entries) {
  const raw = await readFile(`${dir}/${entry.file}`);
  assert.equal(createHash('sha256').update(raw).digest('hex'), entry.sha256);
  assert.ok(['preview', 'result'].includes(entry.kind));
  const value = (entry.kind === 'preview' ? sourceCsvPreviewSchema : sourceCsvResultSchema).parse(
    JSON.parse(raw.toString('utf8')),
  );
  assert.equal(
    value.fileHash,
    createHash('sha256')
      .update(await readFile(`${dir}/${entry.csvFile}`))
      .digest('hex')
      .toUpperCase(),
  );
}
const first = sourceCsvPreviewSchema.parse(
  JSON.parse(await readFile(`${dir}/preview-valid.json`, 'utf8')),
);
assert.equal(first.rows[0].referencePriceRial, '9007199254740993');
assert.equal(first.rows[0].listingId, first.rows[1].listingId);
assert.notEqual(first.rows[0].sourceId, first.rows[1].sourceId);
const fifty = sourceCsvResultSchema.parse(
  JSON.parse(await readFile(`${dir}/commit50.json`, 'utf8')),
);
assert.equal(fifty.created, 50);
assert.equal(new Set(fifty.rows.map((x) => x.listingId)).size, 4);
await writeFile(
  `${dir}/acceptance.json`,
  JSON.stringify(
    {
      passed: true,
      responses: expected.length,
      actualSqlHttpBodies: true,
      strictProductionDecoders: true,
      exactUtf8FileHash: true,
      rawBodiesUnmodified: true,
      sameParentMultipleSources: true,
      fiftyRowBatch: true,
    },
    null,
    2,
  ) + '\n',
);
console.log(`${expected.length} raw source CSV responses and exact input hashes accepted.`);
