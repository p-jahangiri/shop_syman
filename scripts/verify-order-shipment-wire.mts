import { CapturedValues } from './captured-values.mts';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  adminShipmentSchema,
  shipmentInputSchema,
  shipmentResultSchema,
  customerShipmentSchema,
  readShipmentResult,
} from '../apps/storefront/lib/order-shipment-contract.ts';
const directory = process.argv[2];
assert.ok(directory);
const manifest = JSON.parse(await readFile(`${directory}/manifest.json`, 'utf8'));
assert.equal(manifest.actualSqlHttpBodies, true);
assert.equal(manifest.syntheticTestOnly, true);
const values = new CapturedValues();
let responses = 0,
  inputs = 0;
for (const entry of manifest.entries) {
  const raw = await readFile(`${directory}/${entry.file}`);
  assert.equal(createHash('sha256').update(raw).digest('hex'), entry.sha256);
  const name = entry.file.replace(/\.json$/, '');
  let schema;
  if (name.endsWith('-input')) {
    schema = shipmentInputSchema;
    inputs++;
  } else {
    responses++;
    schema = name.endsWith('-before')
      ? adminShipmentSchema
      : name.startsWith('customer-')
        ? customerShipmentSchema
        : shipmentResultSchema;
  }
  values.set(name, schema.parse(JSON.parse(raw.toString('utf8'))));
}
for (const stage of ['pack', 'dispatch', 'deliver']) {
  const command = {
    orderId: values.read(`${stage}-before`, adminShipmentSchema).orderId,
    input: values.read(`${stage}-input`, shipmentInputSchema),
    before: values.read(`${stage}-before`, adminShipmentSchema),
  };
  readShipmentResult(values.read(stage, shipmentResultSchema), command);
}
const pack = {
  orderId: values.read('pack-before', adminShipmentSchema).orderId,
  input: values.read('pack-input', shipmentInputSchema),
  before: values.read('pack-before', adminShipmentSchema),
};
readShipmentResult(values.read('pack-receipt', shipmentResultSchema), pack);
assert.equal(values.read('pack-receipt', shipmentResultSchema).replayed, true);
assert.equal(values.read('pack-receipt', shipmentResultSchema).shipment?.state, 'packed');
assert.equal(values.read('deliver', shipmentResultSchema).shipment?.state, 'delivered');
assert.equal(
  values.read('customer-packed', customerShipmentSchema).shipment?.unitDetailsVisible,
  false,
);
assert.equal(values.read('customer-packed', customerShipmentSchema).shipment?.units.length, 0);
assert.equal(
  values.read('customer-dispatched', customerShipmentSchema).shipment?.units[0].imei1,
  values.read('pack-before', adminShipmentSchema).packingUnits[0].imei1,
);
assert.equal(
  values.read('customer-delivered', customerShipmentSchema).shipment?.state,
  'delivered',
);
assert.equal(inputs, 3);
assert.equal(responses, 10);
await writeFile(
  `${directory}/acceptance.json`,
  JSON.stringify(
    {
      passed: true,
      responses,
      actualCommandBodies: inputs,
      strictProductionDecoders: true,
      rawBodiesUnmodified: true,
      threeStagesBoundToActualReviewedPackage: true,
      historicalReceiptAfterDelivery: true,
      customerImeiHiddenUntilDispatch: true,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `${responses} raw SQL responses and ${inputs} actual command bodies accepted by production shipment decoders.`,
);
