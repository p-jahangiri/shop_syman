import { CapturedValues } from './captured-values.mts';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  stockPreviewSchema,
  stockApplicationSchema,
  stockApplyInputSchema,
  readStockApplication,
} from '../apps/admin/src/accounting-stock-contract.ts';
const directory = process.argv[2];
assert.ok(directory);
const manifest = JSON.parse(await readFile(`${directory}/manifest.json`, 'utf8'));
assert.equal(manifest.actualSqlHttpBodies, true);
assert.equal(manifest.syntheticInputOnly, true);
const expected = ['preview', 'applied', 'replay', 'receipt', 'application', 'after-preview'];
assert.deepEqual(
  manifest.entries.map((x: { file: string }) => x.file).sort(),
  expected.map((x) => x + '.json').sort(),
);
const values = new CapturedValues();
for (const entry of manifest.entries) {
  const raw = await readFile(`${directory}/${entry.file}`);
  assert.equal(createHash('sha256').update(raw).digest('hex'), entry.sha256);
  const name = entry.file.replace(/\.json$/, '');
  values.set(
    name,
    (name === 'preview' || name === 'after-preview'
      ? stockPreviewSchema
      : stockApplicationSchema
    ).parse(JSON.parse(raw.toString('utf8'))),
  );
}
const inputBytes = await readFile(`${directory}/${manifest.input.file}`);
assert.equal(createHash('sha256').update(inputBytes).digest('hex'), manifest.input.sha256);
const input = stockApplyInputSchema.parse(JSON.parse(inputBytes.toString('utf8')));
const command = {
  batchId: values.read('preview', stockPreviewSchema).reconciliation.batchId,
  input,
  preview: values.read('preview', stockPreviewSchema),
};
for (const name of ['applied', 'replay', 'receipt', 'application'])
  readStockApplication(values.read(name, stockApplicationSchema), command);
assert.equal(
  values.read('preview', stockPreviewSchema).reconciliation.rows[0].match?.priceRial,
  '9007199254740993',
);
assert.equal(values.read('applied', stockApplicationSchema).lines[0].beforeOnHand, 6);
assert.equal(values.read('applied', stockApplicationSchema).lines[0].afterOnHand, 8);
assert.equal(values.read('applied', stockApplicationSchema).lines[0].reserved, 2);
assert.equal(values.read('applied', stockApplicationSchema).lines[0].sourcingReserved, 1);
assert.equal(values.read('applied', stockApplicationSchema).lines[0].delta, 2);
assert.equal(values.read('applied', stockApplicationSchema).replayed, false);
assert.equal(values.read('replay', stockApplicationSchema).replayed, true);
assert.equal(values.read('receipt', stockApplicationSchema).replayed, true);
assert.equal(values.read('after-preview', stockPreviewSchema).canApplyManual, false);
assert.equal(
  values.read('after-preview', stockPreviewSchema).candidates[0].priorApplicationId,
  values.read('applied', stockApplicationSchema).id,
);
assert.notEqual(
  values.read('preview', stockPreviewSchema).fingerprint,
  values.read('after-preview', stockPreviewSchema).fingerprint,
);
await writeFile(
  `${directory}/acceptance.json`,
  JSON.stringify(
    {
      passed: true,
      responses: 6,
      actualSqlHttpBodies: true,
      rawBodiesUnmodified: true,
      strictProductionDecoders: true,
      actualSyntheticCommandBoundToReceipt: true,
      commitmentsPreserved: true,
      exactMoneyPreserved: true,
      persistentReplay: true,
      historicalReceipt: true,
      appliedRowCannotRepeat: true,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  '6 raw SQL stock-application responses bound to actual synthetic command and production decoders.',
);
