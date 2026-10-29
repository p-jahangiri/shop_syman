import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  inventorySupplyDetailV2Schema,
  inventorySupplyPageV2Schema,
  supplyAdminDetailV2Schema,
  supplyAdminPageV2Schema,
} from '../src/supply-contract.ts';
const directory = process.argv[2];
if (!directory) throw new Error('Pass the actual SQL Supply2 capture directory.');
const cases = [
  ['supply2-admin-page.json', supplyAdminPageV2Schema],
  ['supply2-admin-detail.json', supplyAdminDetailV2Schema],
  ['supply2-inventory-page.json', inventorySupplyPageV2Schema],
  ['supply2-inventory-detail.json', inventorySupplyDetailV2Schema],
] as const;
const accepted = new Map<string, unknown>();
for (const [file, schema] of cases) {
  const bytes = await fs.readFile(path.join(directory, file));
  assert.ok(bytes.length <= 524288, 'Actual response must fit its wire bound.');
  accepted.set(file, schema.parse(JSON.parse(bytes.toString('utf8'))));
}
const detail = supplyAdminDetailV2Schema.parse(accepted.get('supply2-admin-detail.json')),
  page = supplyAdminPageV2Schema.parse(accepted.get('supply2-admin-page.json')),
  inventory = inventorySupplyDetailV2Schema.parse(accepted.get('supply2-inventory-detail.json')),
  inventoryPage = inventorySupplyPageV2Schema.parse(accepted.get('supply2-inventory-page.json'));
assert.equal(detail.requestId, inventory.task.requestId);
assert.equal(detail.task.id, inventory.task.task.id);
assert.ok(detail.task.allocation);
assert.equal(detail.reservedForRequest, true);
assert.equal(inventory.task.reservedForRequest, true);
assert.equal(
  page.items.find((item) => item.id === detail.task.id)?.allocation?.id,
  detail.task.allocation.id,
);
assert.equal(
  inventoryPage.items.find((item) => item.task.id === detail.task.id)?.task.allocation?.id,
  detail.task.allocation.id,
);
assert.deepEqual(detail.task.allocation, inventory.task.task.allocation);
function privateKeys(value: unknown) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    assert.ok(
      ![
        'ownerid',
        'actorid',
        'unitids',
        'serial',
        'imei1',
        'imei2',
        'unitpricerial',
        'totalrial',
        'costrial',
        'sourcekind',
        'sourcekey',
        'sourcenamefa',
        'sourcenameen',
        'internalnote',
        'protectednote',
      ].includes(key.toLowerCase()),
      key,
    );
    privateKeys(item);
  }
}
privateKeys(inventory);
privateKeys(detail.task.allocation);
assert.equal(detail.canCheckout, false);
assert.equal(detail.canPay, false);
assert.equal(inventory.task.canCheckout, false);
assert.equal(inventory.task.canPay, false);
console.log(
  JSON.stringify(
    {
      passed: true,
      responseCount: cases.length,
      files: cases.map(([file]) => file),
      checks: [
        'Actual SQL Supply2 staff and warehouse DTOs decoded without substitution',
        'Exact same held allocation, request, task and bounded lines across pages/details',
        'Warehouse projection and allocation summary exclude owner, supplier, prices and unit identifiers',
        'Actual stock allocation remains separate from unavailable conversion, checkout and payment',
      ],
    },
    null,
    2,
  ),
);
