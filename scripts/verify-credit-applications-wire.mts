import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  creditPlansSchema,
  readCreditApplicationDetail,
  readCreditApplicationResult,
  readCreditApplicationPage,
  type CreditApplicationCommand,
} from '../apps/storefront/lib/credit-application-contract.ts';
const dir = process.argv[2];
assert.ok(dir);
const read = async (name: string) => {
  const raw = await readFile(`${dir}/${name}.json`),
    meta = JSON.parse(await readFile(`${dir}/${name}.meta.json`, 'utf8'));
  assert.equal(meta.status, 200);
  assert.equal(meta.actualSqlHttpResponse, true);
  assert.equal(meta.syntheticQaOnly, true);
  assert.match(meta.cacheControl, /no-store/);
  return {
    value: JSON.parse(raw.toString('utf8')),
    sha256: createHash('sha256').update(raw).digest('hex'),
  };
};
const created = await read('created'),
  detail = await read('detail'),
  id = created.value.application.id,
  command: CreditApplicationCommand = {
    kind: 'create',
    id: created.value.commandId,
    body: {
      planId: detail.value.plan.id,
      planVersion: detail.value.plan.version,
      requestedAmountRial: '9007199254740993',
      locale: 'fa',
    },
  };
readCreditApplicationResult(created.value, command);
readCreditApplicationDetail(detail.value, id);
assert.equal(detail.value.plan.markupBasisPoints, 3000);
assert.equal(detail.value.plan.roundingUnitRial, '10');
assert.equal(detail.value.canSubmit, false);
const rows = [created, detail];
for (const name of ['create-replay', 'historical-receipt']) {
  const r = await read(name);
  const value = readCreditApplicationResult(r.value, command);
  assert.equal(value.replayed, true);
  assert.equal(value.application.state, 'Draft');
  rows.push(r);
}
const cancelled = await read('cancelled');
readCreditApplicationResult(cancelled.value, {
  kind: 'cancel',
  id: cancelled.value.commandId,
  applicationId: id,
  body: { version: created.value.application.version },
});
rows.push(cancelled);
const page = await read('page');
readCreditApplicationPage(page.value, 'Cancelled');
rows.push(page);
const plans = await read('plans');
creditPlansSchema.parse(plans.value);
rows.push(plans);
const reviewer = await read('reviewer-detail');
readCreditApplicationDetail(reviewer.value, reviewer.value.application.id);
rows.push(reviewer);
const report = {
  passed: true,
  responses: rows.length,
  actualSqlHttpBodies: true,
  strictProductionDecoders: true,
  rawBodiesUnmodified: true,
  largeRialRemainedDecimalString: true,
  historicalPlanSnapshotAndReceipt: true,
  submissionEnabled: false,
  mainPromoted: false,
  sha256: rows.map((x) => x.sha256),
};
await writeFile(dir + '/acceptance.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
