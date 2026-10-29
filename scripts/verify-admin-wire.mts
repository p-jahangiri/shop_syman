import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  emptyProductFilters,
  readProductsPage,
  readProductLookup,
  readProductDetail,
} from '../apps/admin/src/products-contract.ts';
import {
  emptyInventoryFilters,
  readInventoryPage,
  inventorySummarySchema,
  catalogSummarySchema,
} from '../apps/admin/src/inventory-contract.ts';
import {
  emptyMovementFilters,
  readMovementPage,
} from '../apps/admin/src/inventory-history-contract.ts';
import {
  recoveryStatusSchema,
  recoveryBatchSchema,
  recoveryChallengeSchema,
} from '../apps/admin/src/mfa-recovery-contract.ts';
import {
  emptyStaffFilters,
  readStaffPage,
  readStaffDetail,
  staffRoleCatalogSchema,
  staffHistorySchema,
} from '../apps/admin/src/staff-contract.ts';
const directory = process.argv[2];
if (!directory) throw new Error('Pass the opt-in synthetic ASP.NET capture directory.');
const read = async (name: string) =>
  JSON.parse(await readFile(path.join(directory, name + '.json'), 'utf8'));
assert.equal(readProductsPage(await read('products-page'), emptyProductFilters).nextCursor, null);
assert.equal(readProductLookup(await read('products-lookup'), ['p1'])[0].id, 'p1');
const product = readProductDetail(await read('product-detail'), 'p1');
assert.equal(product.variants[0].priceRial, '9223372036854775807');
assert.equal(product.attributes[0].valueBool, false);
assert.equal(product.variants[0].attributes[0].valueNumber, 0);
const stock = readInventoryPage(await read('stock-page'), emptyInventoryFilters);
assert.equal(stock.nextCursor, null);
assert.equal(stock.items[0].version, null);
inventorySummarySchema.parse(await read('stock-summary'));
catalogSummarySchema.parse(await read('catalog-summary'));
assert.equal(readMovementPage(await read('movement-page'), emptyMovementFilters).nextCursor, null);
const recovery = process.argv.slice(3).includes('--mfa-recovery');
const staff = process.argv.slice(3).includes('--staff');
if (recovery) {
  recoveryStatusSchema.parse(await read('mfa-recovery-status'));
  recoveryBatchSchema.parse(await read('mfa-recovery-batch'));
  recoveryChallengeSchema.parse(await read('mfa-recovery-challenge'));
}
if (staff) {
  readStaffPage(await read('staff-page'), emptyStaffFilters);
  readStaffDetail(await read('staff-detail'), 'one');
  staffRoleCatalogSchema.parse(await read('staff-roles'));
  const history = staffHistorySchema.parse(await read('staff-history'));
  assert.equal(history.items[0].id, '9007199254740993');
}
const report = {
  scope:
    'real ASP.NET test HTTP response bodies parsed by production TypeScript contracts; synthetic readers/services, no SQL or real authentication acceptance',
  passed: 7 + (recovery ? 3 : 0) + (staff ? 4 : 0),
  explicitNullCursorAndStockVersion: true,
  bigintMoneyPreserved: true,
  recoveryEnrollmentChallenge: recovery,
  staffContracts: staff,
};
await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
process.stdout.write(`${report.passed} native ASP.NET to TypeScript wire contracts passed.\n`);
