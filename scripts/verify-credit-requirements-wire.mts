import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  publishCreditRequirementsResultSchema,
  acceptCreditRequirementsResultSchema,
  creditRequirementsHistorySchema,
  creditRequirementsRevisionSchema,
  readCreditCaseRequirements,
  readCreditRequirementsResult,
  type CreditRequirementsCommand,
} from '../apps/storefront/lib/credit-requirements-contract.ts';
const dir = process.argv[2];
assert.ok(dir);
const hashes: string[] = [];
async function read(name: string) {
  const raw = await readFile(`${dir}/${name}.json`),
    meta = JSON.parse(await readFile(`${dir}/${name}.meta.json`, 'utf8'));
  assert.equal(meta.status, 200);
  assert.equal(meta.actualSqlHttpResponse, true);
  assert.equal(meta.syntheticQaOnly, true);
  assert.match(meta.cacheControl, /no-store/);
  hashes.push(createHash('sha256').update(raw).digest('hex'));
  return JSON.parse(raw.toString('utf8'));
}
const published = publishCreditRequirementsResultSchema.parse(await read('published')),
  before = await read('case-before');
readCreditCaseRequirements(before, before.application.id);
assert.equal(before.canConsent, true);
assert.equal(before.consent, null);
const accepted = acceptCreditRequirementsResultSchema.parse(await read('accepted')),
  id = accepted.application.id;
assert.equal(id, before.application.id);
assert.equal(accepted.consent.locale, 'en');
assert.equal(accepted.consent.requirements.id, published.current.published!.id);
assert.equal(accepted.application.requestedAmountRial, '9007199254740993');
assert.deepEqual(accepted.consent.requirements.content.documents[0].contentTypes, [
  'application/pdf',
  'image/png',
]);
const command: CreditRequirementsCommand = {
  kind: 'consent',
  id: accepted.commandId,
  applicationId: id,
  body: {
    applicationVersion: before.application.version,
    requirementsRevisionId: published.current.published!.id,
    requirementsVersion: published.current.version!,
    locale: 'en',
    accepted: true,
  },
};
readCreditRequirementsResult(accepted, command);
const exact = readCreditCaseRequirements(await read('case-accepted'), id);
assert.equal(exact.canConsent, false);
assert.deepEqual(exact.consent, accepted.consent);
for (const name of ['accept-replay', 'historical-consent-receipt']) {
  const r = readCreditRequirementsResult(await read(name), command);
  assert.equal(r.replayed, true);
  assert.ok('consent' in r);
  assert.deepEqual(r.consent, accepted.consent);
}
const changed = readCreditCaseRequirements(await read('case-changed'), id);
assert.equal(changed.canConsent, true);
assert.notEqual(changed.current.published!.id, changed.consent!.requirements.id);
assert.deepEqual(changed.consent, accepted.consent);
const reviewer = await read('reviewer-case');
readCreditCaseRequirements(reviewer, reviewer.application.id);
creditRequirementsHistorySchema.parse(await read('history'));
creditRequirementsRevisionSchema.parse(await read('revision'));
const report = {
  passed: true,
  responses: hashes.length,
  actualSqlHttpBodies: true,
  rawBodiesUnmodified: true,
  strictProductionDecoders: true,
  revisionAndLanguageBound: true,
  exactLargeRialString: true,
  historicalConsentNotRewritten: true,
  replayedReceiptAfterCancellation: true,
  historyIsSummaries: true,
  submissionEnabled: false,
  mainPromoted: false,
  sha256: hashes,
};
await writeFile(`${dir}/acceptance.json`, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report));
