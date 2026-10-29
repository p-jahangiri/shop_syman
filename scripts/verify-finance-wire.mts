import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import {
  emptyPurchaseFilters,
  readMethodsPage,
  readPlansPage,
  readMethodDetail,
  readPlanDetail,
  purchaseSummarySchema,
} from '../apps/admin/src/finance-contract.ts';
const directory = process.argv[2];
if (!directory) throw Error('Pass synthetic native HTTP capture directory.');
const read = async (name: string) =>
  JSON.parse(await readFile(directory + '/' + name + '.json', 'utf8'));
assert.equal(
  readMethodsPage(await read('finance-method-page'), emptyPurchaseFilters).nextCursor,
  null,
);
assert.equal(readPlansPage(await read('finance-plan-page'), emptyPurchaseFilters).nextCursor, null);
assert.equal(
  readMethodDetail(await read('finance-method-detail'), 'one').minAmountRial,
  '9223372036854775807',
);
assert.equal(readPlanDetail(await read('finance-plan-detail'), 'one').maxAmountRial, undefined);
assert.equal(
  purchaseSummarySchema.parse(await read('finance-summary')).enabledPlans,
  '9007199254740993',
);
await writeFile(
  directory + '/report.json',
  JSON.stringify(
    {
      passed: 5,
      scope:
        'native ASP.NET test HTTP bodies with synthetic readers, parsed by production TS schemas; no SQL or MFA acceptance',
      explicitNulls: true,
      longRialStringsPreserved: true,
      summaryBigIntsPreserved: true,
    },
    null,
    2,
  ) + '\n',
);
process.stdout.write('5 native finance wire contracts passed.\n');
