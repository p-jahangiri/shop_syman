import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  creditReviewResultSchema,
  readCreditReviewCapabilities,
  readCreditReviewDetail,
  readCreditReviewPage,
} from '@sayman/web-shared/lib/credit/credit-review-contract.ts';
import { readCreditSubmissionCapabilities } from '@sayman/web-shared/lib/credit/credit-submission-contract.ts';
import { readCreditDocuments } from '@sayman/web-shared/lib/credit/credit-document-contract.ts';
const dir = process.argv[2];
assert.ok(dir);
const evidence: unknown[] = [];
let returned = '',
  app = '';
for (const name of [
  'ready',
  'returned',
  'customer-returned',
  'approved',
  'history',
  'returned-replay',
  'returned-receipt',
  'customer-approved',
  'approved-submission-capabilities',
  'approved-documents',
  'declined',
]) {
  const bytes = await readFile(`${dir}/${name}.json`),
    meta = JSON.parse(await readFile(`${dir}/${name}.meta.json`, 'utf8')),
    raw = JSON.parse(bytes.toString('utf8'));
  assert.equal(meta.status, 200);
  assert.equal(meta.actualSqlHttpResponse, true);
  assert.equal(meta.syntheticQaOnly, true);
  assert.match(meta.cacheControl, /no-store/);
  const path = meta.path,
    appId = /\/applications\/([a-f0-9]{32})/.exec(path)?.[1];
  assert.ok(appId);
  if (name === 'ready') assert.ok(readCreditReviewCapabilities(raw, appId).canReview);
  else if (name === 'history') assert.equal(readCreditReviewPage(raw, appId).items.length, 2);
  else if (name === 'approved-documents')
    assert.equal(readCreditDocuments(raw, appId).canUpload, false);
  else if (name === 'approved-submission-capabilities') {
    const v = readCreditSubmissionCapabilities(raw, appId);
    assert.equal(v.canSubmit, false);
    assert.equal(v.canWithdraw, false);
  } else if (name.startsWith('customer-')) {
    const v = readCreditReviewDetail(raw, appId, path.split('/').at(-1));
    assert.match(v.note, /ساختگی/);
    if (name === 'customer-approved') assert.equal(v.review.approvedAmountRial, '9007199254740993');
  } else {
    const v = creditReviewResultSchema.parse(raw);
    if (name === 'returned') {
      returned = v.review.id;
      app = v.application.id;
      assert.equal(v.application.state, 'Draft');
    }
    if (name.startsWith('returned-')) {
      assert.equal(v.replayed, true);
      assert.equal(v.review.id, returned);
      assert.equal(v.application.id, app);
      assert.equal(v.application.state, 'Draft');
    }
    if (name === 'approved') {
      assert.equal(v.application.state, 'Approved');
      assert.equal(v.review.approvedAmountRial, '9007199254740993');
    }
    if (name === 'declined') {
      assert.equal(v.application.state, 'Declined');
      assert.equal(v.review.approvedAmountRial, null);
    }
  }
  assert.doesNotMatch(
    JSON.stringify(raw),
    /"(?:ownerId|actorId|email|phoneNumber|password|accessToken|refreshToken|protectedNote|protectedResult|storageKey)"\s*:/i,
  );
  evidence.push({
    name,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    method: meta.method,
    path,
  });
}
await writeFile(
  `${dir}/acceptance.json`,
  JSON.stringify(
    {
      passed: true,
      responses: evidence.length,
      actualSqlHttpBodies: true,
      rawBodiesUnmodified: true,
      strictProductionDecoders: true,
      exactLargeRialString: true,
      manualSyntheticDecisionsOnly: true,
      realPersonEligibilityDecided: false,
      checkoutEnabled: false,
      mainPromoted: false,
      evidence,
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
console.log(JSON.stringify({ passed: true, responses: evidence.length }));
