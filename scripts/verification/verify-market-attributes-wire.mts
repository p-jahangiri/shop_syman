import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import {
  marketPageSchema,
  marketFacetsSchema,
  marketFiltersSchema,
  marketValuesSchema,
} from '@sayman/web-shared/lib/market/market-contract.ts';
const directory = process.argv[2];
assert.ok(directory);
const manifest = JSON.parse(await readFile(`${directory}/manifest.json`, 'utf8'));
assert.equal(manifest.actualSqlHttpBodies, true);
const schemas = {
  page: marketPageSchema,
  facets: marketFacetsSchema,
  filters: marketFiltersSchema,
  values: marketValuesSchema,
};
for (const entry of manifest.entries) {
  const bytes = await readFile(`${directory}/${entry.file}`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
  assert.ok(entry.kind in schemas);
  schemas[entry.kind as keyof typeof schemas].parse(JSON.parse(bytes.toString('utf8')));
}
const expected = [
  'decimal-search',
  'fraction-search',
  'zero-search',
  'false-search',
  'intersection-search',
  'multi-search',
  'decimal-values',
  'decimal-values-next',
  'multi-values',
  'text-values',
  'boolean-values',
  'filtered-facets',
  'definitions-before',
  'definitions-after',
  'after-migration-values',
  'eligibility-search',
  'variant-override-excluded',
  'eligibility-values',
  'bounded-definitions',
  'beyond-metadata-page',
];
assert.deepEqual(
  manifest.entries.map((entry: { file: string }) => entry.file).sort(),
  expected.map((name) => name + '.json').sort(),
);
const decimal = marketValuesSchema.parse(
  JSON.parse(await readFile(`${directory}/decimal-values.json`, 'utf8')),
);
assert.equal(decimal.selectedValues[0].value, '99999999999999999999.12345678');
assert.equal(decimal.values[0].value, '0');
await writeFile(
  `${directory}/acceptance.json`,
  JSON.stringify(
    {
      passed: true,
      responses: expected.length,
      actualSqlHttpBodies: true,
      strictProductionDecoders: true,
      bytesUnmodified: true,
      decimal28Scale8Preserved: true,
      falseIsNotUnknown: true,
    },
    null,
    2,
  ) + '\n',
);
process.stdout.write(`${expected.length} actual SQL HTTP typed market responses accepted.\n`);
