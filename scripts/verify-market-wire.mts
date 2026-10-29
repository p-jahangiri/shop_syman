import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import {
  marketPageSchema,
  marketDetailSchema,
  marketModelSchema,
  previewSchema,
  readImportResult,
} from '../apps/admin/src/market-contract.ts';
const directory = process.argv[2];
if (!directory) throw Error('Pass the owned SQL capture directory.');
const read = async (name: string) =>
  JSON.parse(await readFile(`${directory}/${name}.json`, 'utf8'));
const preview = previewSchema.parse(await read('preview'));
assert.equal(preview.rows[0].referencePriceRial, '9007199254740993');
const raw = await read('saved');
const result = readImportResult(
  raw,
  raw.requestId,
  preview.rows.map((row) => row.expected!),
);
assert.equal(result.created, 2);
assert.equal(result.replayed, false);
assert.equal(
  readImportResult(
    await read('replayed'),
    result.requestId,
    preview.rows.map((row) => row.expected!),
  ).replayed,
  true,
);
assert.equal(readImportResult(await read('receipt'), result.requestId).rows.length, 2);
assert.ok(marketPageSchema.parse(await read('page')).items.length >= 2);
assert.equal(
  marketDetailSchema.parse(await read('detail')).details.referencePriceRial,
  '9007199254740993',
);
const model = marketModelSchema.parse(await read('model'));
assert.ok(
  model.model.input.attributes.some(
    (value) => typeof value.number === 'string' && /^0(?:\.0+)?$/.test(value.number),
  ),
);
assert.ok(model.model.input.attributes.some((value) => value.bool === false));
await writeFile(
  `${directory}/report.json`,
  JSON.stringify(
    {
      passed: 7,
      scope:
        'Actual native TestServer HTTP + own generated MFA accounts + GUID SQL; no browser/visual acceptance',
      rialExact: true,
      decimalAttributesString: true,
      falseAndZeroPreserved: true,
    },
    null,
    2,
  ) + '\n',
);
process.stdout.write('7 real SQL HTTP wire contracts passed.\n');
