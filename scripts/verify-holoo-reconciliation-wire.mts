import { CapturedValues } from './captured-values.mts';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  warehouseSavedSchema,
  warehousePageSchema,
  reconciliationSchema,
} from '../apps/admin/src/accounting-reconciliation-contract.ts';
const directory = process.argv[2];
assert.ok(directory);
const manifest = JSON.parse(await readFile(`${directory}/manifest.json`, 'utf8'));
assert.equal(manifest.actualSqlHttpBodies, true);
const expected = [
  'warehouse-saved',
  'warehouse-replay',
  'warehouse-receipt',
  'warehouse-page',
  'reconciliation',
];
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
    (name === 'warehouse-page'
      ? warehousePageSchema
      : name === 'reconciliation'
        ? reconciliationSchema
        : warehouseSavedSchema
    ).parse(JSON.parse(raw.toString('utf8'))),
  );
}
assert.equal(values.read('warehouse-saved', warehouseSavedSchema).replayed, false);
assert.equal(values.read('warehouse-replay', warehouseSavedSchema).replayed, true);
assert.equal(values.read('warehouse-receipt', warehouseSavedSchema).replayed, true);
assert.deepEqual(
  values.read('warehouse-saved', warehouseSavedSchema).warehouse,
  values.read('warehouse-receipt', warehouseSavedSchema).warehouse,
);
assert.equal(values.read('reconciliation', reconciliationSchema).rows[0].sourceQuantity, '1.5');
assert.equal(values.read('reconciliation', reconciliationSchema).rows[0].targetOnHand, 3);
assert.equal(values.read('reconciliation', reconciliationSchema).rows[0].delta, -3);
assert.equal(values.read('reconciliation', reconciliationSchema).rows[0].stock?.reserved, 2);
assert.equal(
  values.read('reconciliation', reconciliationSchema).rows[0].stock?.sourcingReserved,
  1,
);
assert.equal(
  values.read('reconciliation', reconciliationSchema).rows[0].match?.priceRial,
  '9007199254740993',
);
assert.equal(values.read('reconciliation', reconciliationSchema).canApplyManual, false);
assert.equal(values.read('reconciliation', reconciliationSchema).canSyncLive, false);
await writeFile(
  `${directory}/acceptance.json`,
  JSON.stringify(
    {
      passed: true,
      responses: 5,
      actualSqlHttpBodies: true,
      rawBodiesUnmodified: true,
      strictProductionDecoders: true,
      exactDecimalConversion: true,
      exactMoney: true,
      reservedAndSourcingReservedPreserved: true,
    },
    null,
    2,
  ) + '\n',
);
console.log('5 raw SQL reconciliation/warehouse responses accepted by production decoders.');
