import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  inventorySupplyDetailSchema,
  inventorySupplyPageSchema,
  mappingMutationSchema,
  mappingPageSchema,
  mappingSchema,
  receivingDataSchema,
  receivingMutationSchema,
  supplyAdminDetailSchema,
  supplyAdminEventsSchema,
  supplyAdminPageSchema,
  supplyMutationSchema,
} from '../src/supply-contract.ts';
const directory = process.argv[2];
if (!directory) throw new Error('Pass the actual SQL response capture directory.');
const cases = [
  ['admin-page.json', supplyAdminPageSchema],
  ['admin-detail.json', supplyAdminDetailSchema],
  ['admin-events.json', supplyAdminEventsSchema],
  ['inventory-page.json', inventorySupplyPageSchema],
  ['inventory-detail.json', inventorySupplyDetailSchema],
  ['mapping.json', mappingSchema],
  ['mapping-page.json', mappingPageSchema],
  ['mapping-mutation.json', mappingMutationSchema],
  ['receipt.json', receivingDataSchema],
  ['receive.json', receivingMutationSchema],
  ['receive-replay.json', receivingMutationSchema],
  ['supply-mutation.json', supplyMutationSchema],
] as const;
const accepted = new Map<string, unknown>();
for (const [file, schema] of cases)
  accepted.set(
    file,
    schema.parse(JSON.parse(await fs.readFile(path.join(directory, file), 'utf8'))),
  );
const detail = supplyAdminDetailSchema.parse(accepted.get('admin-detail.json')),
  inventory = inventorySupplyDetailSchema.parse(accepted.get('inventory-detail.json')),
  receipt = receivingDataSchema.parse(accepted.get('receipt.json')),
  receive = receivingMutationSchema.parse(accepted.get('receive.json')),
  replay = receivingMutationSchema.parse(accepted.get('receive-replay.json'));
assert.equal(detail.task.id, inventory.task.task.id);
assert.equal(detail.requestId, inventory.task.requestId);
assert.equal(receipt.taskId, inventory.task.task.id);
assert.equal(receipt.requestId, inventory.task.requestId);
assert.equal(receive.receiptId, receipt.id);
assert.equal(replay.receiptId, receipt.id);
assert.equal(replay.replayed, true);
assert.equal(inventory.task.canCheckout, false);
assert.equal(inventory.task.canPay, false);
assert.equal(inventory.task.reservedForRequest, false);
for (const forbidden of [
  'ownerId',
  'internalNote',
  'sourceKind',
  'sourceKey',
  'sourceNameFa',
  'sourceNameEn',
  'reference',
  'totalRial',
  'unitPriceRial',
  'costRial',
])
  assert.equal(Object.hasOwn(inventory.task, forbidden), false, forbidden);
assert.deepEqual(
  receive.lines.map((line) => [line.offerLineId, line.quantity, line.movementId]).sort(),
  receipt.lines.map((line) => [line.offerLineId, line.quantity, line.movementId]).sort(),
);
console.log(
  JSON.stringify(
    {
      passed: true,
      responseCount: cases.length,
      files: cases.map(([file]) => file),
      checks: [
        'Actual SQL supply staff and inventory DTOs decoded without shape substitution',
        'Inventory projection excludes account, supplier, notes and money',
        'Receipt and repeated command bind request, task and immutable receipt resource',
        'Explicit exact unit conversion, document identity and bigint movement strings',
        'Actual received stock never implies reservation or checkout',
      ],
    },
    null,
    2,
  ),
);
