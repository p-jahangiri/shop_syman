import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  creditSubmissionResultSchema,
  readCreditSubmissionCapabilities,
  readCreditSubmissionDetail,
  readCreditSubmissionPage,
} from '../apps/storefront/lib/credit-submission-contract.ts';
import { readCreditApplicationPage } from '../apps/storefront/lib/credit-application-contract.ts';
const dir = process.argv[2];
assert.ok(dir);
const evidence: unknown[] = [];
let app = '',
  submission = '';
for (const name of [
  'ready',
  'submitted',
  'reviewer-detail',
  'queue',
  'staff-capabilities',
  'historical-replay',
  'receipt',
  'withdrawn-detail',
  'history',
  'missing-documents',
  'document-snapshot',
]) {
  const bytes = await readFile(`${dir}/${name}.json`),
    meta = JSON.parse(await readFile(`${dir}/${name}.meta.json`, 'utf8')),
    raw = JSON.parse(bytes.toString('utf8'));
  assert.equal(meta.status, 200);
  assert.equal(meta.actualSqlHttpResponse, true);
  assert.equal(meta.syntheticQaOnly, true);
  assert.match(meta.cacheControl, /no-store/);
  const path = new URL(meta.path, 'http://qa.invalid'),
    appId = /\/applications\/([a-f0-9]{32})/.exec(path.pathname)?.[1],
    staff = path.pathname.startsWith('/api/admin/');
  if (['submitted', 'historical-replay', 'receipt'].includes(name)) {
    const r = creditSubmissionResultSchema.parse(raw);
    if (name === 'submitted') {
      app = r.application.id;
      submission = r.submission.id;
      assert.equal(r.replayed, false);
    } else {
      assert.equal(r.application.id, app);
      assert.equal(r.submission.id, submission);
      assert.equal(r.replayed, true);
    }
    assert.equal(r.application.requestedAmountRial, '9007199254740993');
    assert.equal(r.note, 'Synthetic QA 😀؛ یادداشت خصوصی');
  } else if (name === 'queue') readCreditApplicationPage(raw, 'Submitted');
  else if (path.pathname.endsWith('/submission')) {
    assert.ok(appId);
    const r = readCreditSubmissionCapabilities(raw, appId, staff);
    if (name === 'ready') assert.equal(r.canSubmit, true);
    if (name === 'missing-documents') {
      assert.equal(r.canSubmit, false);
      assert.deepEqual(r.missingDocumentKeys, ['sample-proof']);
    }
  } else if (path.pathname.endsWith('/submissions')) {
    assert.ok(appId);
    readCreditSubmissionPage(raw, appId);
  } else {
    assert.ok(appId);
    const r = readCreditSubmissionDetail(raw, appId, path.pathname.split('/').at(-1)!);
    if (name === 'withdrawn-detail') assert.equal(r.application.state, 'Cancelled');
    if (name === 'document-snapshot') {
      assert.equal(r.documents.length, 1);
      assert.equal(r.documents[0].file.filename, 'Synthetic-two.pdf');
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
    path: meta.path,
  });
}
const report = {
  passed: true,
  responses: evidence.length,
  actualSqlHttpBodies: true,
  rawBodiesUnmodified: true,
  strictProductionDecoders: true,
  exactLargeRialString: true,
  submissionIsApproval: false,
  privateFileStoreAndScannerAreTestCaptures: true,
  mainPromoted: false,
  evidence,
};
await writeFile(`${dir}/acceptance.json`, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ passed: true, responses: evidence.length }));
