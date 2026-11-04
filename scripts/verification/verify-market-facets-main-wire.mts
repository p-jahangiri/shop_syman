import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { marketFacetsSchema } from '@sayman/web-shared/lib/market/market-contract.ts';
const directory = process.argv[2];
assert.ok(directory, 'Pass the public main HTTP capture directory.');
const manifest = JSON.parse(await readFile(`${directory}/manifest.json`, 'utf8'));
assert.equal(manifest.actualMainSqlHttpBodies, true);
assert.deepEqual(
  manifest.entries.map((e: { file: string }) => e.file).sort(),
  ['api-fa.json', 'api-en.json', 'bff-fa.json', 'bff-en.json'].sort(),
);
for (const entry of manifest.entries) {
  const bytes = await readFile(`${directory}/${entry.file}`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
  const response = marketFacetsSchema.parse(JSON.parse(bytes.toString('utf8')));
  assert.equal(response.locale, entry.file.endsWith('-fa.json') ? 'fa' : 'en');
  assert.deepEqual(response.scope, { query: '', categoryId: null, brandId: null });
}
await writeFile(
  `${directory}/acceptance.json`,
  JSON.stringify(
    {
      passed: true,
      responses: 4,
      strictProductionDecoders: true,
      bytesUnmodified: true,
      businessMutationPerformed: false,
    },
    null,
    2,
  ) + '\n',
);
process.stdout.write('4 main public SQL HTTP facet responses accepted unchanged.\n');
