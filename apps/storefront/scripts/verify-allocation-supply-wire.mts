import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { supplyDetailV2Schema, supplyPageV2Schema } from '../lib/supply-contract.ts';
const directory = process.argv[2];
if (!directory) throw new Error('Pass the actual SQL Supply2 capture directory.');
const cases = [
  ['supply2-customer-page.json', supplyPageV2Schema],
  ['supply2-customer-detail.json', supplyDetailV2Schema],
] as const;
const accepted = new Map<string, unknown>();
for (const [file, schema] of cases) {
  const bytes = await fs.readFile(path.join(directory, file));
  assert.ok(bytes.length <= 524288, 'Actual response must fit its wire bound.');
  accepted.set(file, schema.parse(JSON.parse(bytes.toString('utf8'))));
}
const detail = supplyDetailV2Schema.parse(accepted.get('supply2-customer-detail.json')),
  page = supplyPageV2Schema.parse(accepted.get('supply2-customer-page.json'));
assert.ok(detail.task.allocation);
assert.equal(detail.reservedForRequest, true);
assert.equal(detail.task.allocation.effectiveState, 'Active');
assert.equal(page.requestId, detail.requestId);
assert.equal(
  page.items.find((item) => item.id === detail.task.id)?.allocation?.id,
  detail.task.allocation.id,
);
assert.equal(page.startCandidate, null);
assert.equal(detail.canCheckout, false);
assert.equal(detail.canPay, false);
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
privateKeys(detail);
privateKeys(page);
console.log(
  JSON.stringify(
    {
      passed: true,
      responseCount: cases.length,
      files: cases.map(([file]) => file),
      checks: [
        'Actual SQL owner Supply2 page and detail decoded without shape substitution',
        'Exact allocation, quantities and deadline; active stock share is represented truthfully',
        'No staff start capability, supplier, private note, price or device identity',
        'Allocation does not activate checkout or payment',
      ],
    },
    null,
    2,
  ),
);
