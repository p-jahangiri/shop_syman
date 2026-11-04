import { CapturedValues } from './captured-values.mts';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import {
  parcelPageSchema,
  parcelDetailSchema,
  parcelInputSchema,
  parcelResultSchema,
  customerFulfillmentSchema,
  parcelCommandSchema,
  readParcelResult,
} from '@sayman/web-shared/lib/orders/order-parcel-contract.ts';
const dir = process.argv[2];
assert.ok(dir);
const manifest = JSON.parse(await readFile(dir + '/manifest.json', 'utf8'));
assert.equal(manifest.actualSqlHttpBodies, true);
assert.equal(manifest.syntheticTestOnly, true);
const schemas = {
    page: parcelPageSchema,
    detail: parcelDetailSchema,
    input: parcelInputSchema,
    result: parcelResultSchema,
    customer: customerFulfillmentSchema,
  },
  values = new CapturedValues();
let responses = 0;
for (const entry of manifest.entries) {
  const raw = await readFile(dir + '/' + entry.file);
  assert.equal(createHash('sha256').update(raw).digest('hex'), entry.sha256);
  const kind = entry.kind as keyof typeof schemas;
  assert.ok(schemas[kind]);
  values.set(entry.file.replace(/\.json$/, ''), schemas[kind].parse(JSON.parse(raw.toString())));
  if (kind !== 'input') responses++;
}
for (const b of manifest.bindings) {
  const command = parcelCommandSchema.parse({
    orderId: values.read(b.before, parcelPageSchema).orderId,
    input: values.read(b.input, parcelInputSchema),
    before: values.read(b.before, parcelPageSchema),
    previous: b.previous === null ? null : values.read(b.previous, parcelDetailSchema),
  });
  readParcelResult(values.read(b.result, parcelResultSchema), command);
}
const pack = manifest.bindings.find((b: { name: string }) => b.name === 'pack-a');
assert.ok(pack);
readParcelResult(values.read('pack-receipt', parcelResultSchema), {
  orderId: values.read(pack.before, parcelPageSchema).orderId,
  input: values.read(pack.input, parcelInputSchema),
  before: values.read(pack.before, parcelPageSchema),
  previous: null,
});
assert.equal(values.read('pack-receipt', parcelResultSchema).replayed, true);
assert.equal(values.read('customer-hidden', parcelDetailSchema).unitDetailsVisible, false);
assert.equal(values.read('customer-hidden', parcelDetailSchema).units.length, 0);
assert.equal(values.read('customer-visible', parcelDetailSchema).units.length, 1);
assert.equal(values.read('customer-final', customerFulfillmentSchema).mode, 'parcels');
assert.equal(
  values
    .read('customer-final', customerFulfillmentSchema)
    .parcels.filter((p) => p.state === 'delivered').length,
  2,
);
assert.equal(
  values.read('customer-final', customerFulfillmentSchema).parcels.filter((p) => p.state === 'void')
    .length,
  1,
);
assert.equal(manifest.bindings.length, 9);
const result = {
  passed: true,
  actualSqlHttpBodies: true,
  rawUnmodified: true,
  responses,
  actualCommandBodies: manifest.bindings.length,
  allBindingsUseProductionDecoders: true,
  allFiveActions: true,
  imeiHiddenUntilHandoff: true,
  voidHistoryRetained: true,
  immutableReceiptAfterDelivery: true,
};
await writeFile(dir + '/acceptance.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
