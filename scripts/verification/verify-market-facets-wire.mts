import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import {
  marketFacetsSchema,
  marketPageSchema,
} from '@sayman/web-shared/lib/market/market-contract.ts';
import { marketPageSchema as adminPageSchema } from '../../apps/admin/src/api/contracts/market/market-contract.ts';
const directory = process.argv[2];
assert.ok(directory, 'Pass the owned SQL response directory');
const manifest = JSON.parse(await readFile(`${directory}/manifest.json`, 'utf8'));
assert.equal(manifest.actualSqlHttpBodies, true);
const schemas = { facets: marketFacetsSchema, page: marketPageSchema, adminPage: adminPageSchema };
for (const entry of manifest.entries) {
  const bytes = await readFile(`${directory}/${entry.file}`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
  assert.ok(entry.kind in schemas);
  schemas[entry.kind as keyof typeof schemas].parse(JSON.parse(bytes.toString('utf8')));
}
assert.deepEqual(
  manifest.entries.map((entry: { file: string }) => entry.file).sort(),
  [
    'all-paged',
    'disjoint-filters',
    'same-filter-facets',
    'disjoint-page',
    'normalized',
    'eligibility',
    'bounded',
    'selected-last',
    'selected-last-category',
    'admin-brand-page',
    'admin-brand-next',
  ]
    .map((name) => name + '.json')
    .sort(),
);
await writeFile(
  `${directory}/acceptance.json`,
  JSON.stringify(
    {
      passed: true,
      responses: manifest.entries.length,
      actualSqlHttpBodies: true,
      strictProductionDecoders: true,
      bytesUnmodified: true,
    },
    null,
    2,
  ) + '\n',
);
process.stdout.write(`${manifest.entries.length} actual SQL HTTP responses accepted unchanged.\n`);
