import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { inventoryRowSchema, inventoryPageSchema } from '../src/inventory-contract.ts';

const directory = process.argv[2];
if (!directory) throw new Error('Pass the actual SQL Inventory2 capture directory.');
async function read(file: string) {
  const bytes = await fs.readFile(path.join(directory, file));
  assert.ok(bytes.length <= 524288, 'Actual response must fit its wire bound.');
  return JSON.parse(bytes.toString('utf8')) as unknown;
}
const row = inventoryRowSchema.parse(await read('stock-v2.json'));
const page = inventoryPageSchema.parse(await read('stock-v2-page.json'));
assert.equal(row.onHand, 2);
assert.equal(row.reserved, 0);
assert.equal(row.sourcingReserved, 2);
assert.equal(row.available, 0);
assert.deepEqual(
  page.items.find((item) => item.variantId === row.variantId),
  row,
);
assert.equal(page.items.length, 1);
assert.equal(page.nextCursor, null);
console.log(
  JSON.stringify(
    {
      passed: true,
      responseCount: 2,
      checks: [
        'Actual SQL Inventory2 detail/page pass the same strict decoders used by the admin',
        'Physical stock, order reservations, sourcing reservations and public availability remain distinct',
        'Page and detail contain the identical versioned SKU; no response shape substitution',
      ],
    },
    null,
    2,
  ),
);
