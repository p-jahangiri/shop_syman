import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import {
  marketSourcesSchema,
  marketHistorySchema,
} from '../apps/storefront/lib/market-sources-contract.ts';
import {
  adminSourcesSchema,
  sourceResultSchema,
} from '../apps/admin/src/market-sources-contract.ts';
const directory = process.argv[2];
assert.ok(directory);
const manifest = JSON.parse(await readFile(`${directory}/manifest.json`, 'utf8'));
assert.equal(manifest.actualSqlHttpBodies, true);
const schemas = {
  sources: marketSourcesSchema,
  history: marketHistorySchema,
  admin: adminSourcesSchema,
  result: sourceResultSchema,
};
const expected = [
  'create-result',
  'public-sources-en',
  'public-sources-fa',
  'admin-sources',
  'public-history',
  'admin-hidden-history',
  'primary-history',
  'replay-result',
  'receipt-result',
  'history-page1',
  'history-page2',
];
assert.deepEqual(
  manifest.entries.map((x: { file: string }) => x.file).sort(),
  expected.map((x) => x + '.json').sort(),
);
for (const entry of manifest.entries) {
  const bytes = await readFile(`${directory}/${entry.file}`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
  assert.ok(entry.kind in schemas);
  schemas[entry.kind as keyof typeof schemas].parse(JSON.parse(bytes.toString('utf8')));
}
const sources = marketSourcesSchema.parse(
  JSON.parse(await readFile(`${directory}/public-sources-en.json`, 'utf8')),
);
assert.equal(sources.sources.length, 2);
assert.equal(sources.sources[1].referencePriceRial, '9007199254740993');
const admin = adminSourcesSchema.parse(
  JSON.parse(await readFile(`${directory}/admin-sources.json`, 'utf8')),
);
assert.equal(admin.sources.length, 3);
const history = marketHistorySchema.parse(
  JSON.parse(await readFile(`${directory}/public-history.json`, 'utf8')),
);
assert.equal(history.items[1].source.referencePriceRial, '9007199254740993');
assert.equal(history.items[0].source.referencePriceRial, null);
await writeFile(
  `${directory}/acceptance.json`,
  JSON.stringify(
    {
      passed: true,
      responses: expected.length,
      actualSqlHttpBodies: true,
      strictProductionDecoders: true,
      bytesUnmodified: true,
      exactRialAndSequenceStrings: true,
    },
    null,
    2,
  ) + '\n',
);
console.log(`${expected.length} raw SQL source/history/receipt responses accepted.`);
