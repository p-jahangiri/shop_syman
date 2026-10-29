import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  creditReviewBodySchema,
  readCreditReviewResult,
  readCreditReviewCapabilities,
  readCreditReviewPage,
  readCreditReviewDetail,
  type CreditReviewCommand,
} from '../apps/storefront/lib/credit-review-contract.ts';
import {
  creditSubmissionBodySchema,
  readCreditSubmissionResult,
  readCreditSubmissionCapabilities,
  readCreditSubmissionDetail,
  readCreditSubmissionPage,
  type CreditSubmissionCommand,
} from '../apps/storefront/lib/credit-submission-contract.ts';
import {
  readCreditApplicationPage,
  readCreditApplicationDetail,
  readCreditApplicationResult,
  creditApplicationCreateSchema,
  creditPlansSchema,
  type CreditApplicationCommand,
} from '../apps/storefront/lib/credit-application-contract.ts';
import {
  readCreditCaseRequirements,
  readCreditRequirementsResult,
  publishCreditRequirementsSchema,
  acceptCreditRequirementsSchema,
  creditRequirementsCurrentSchema,
  creditRequirementsHistorySchema,
  creditRequirementsRevisionSchema,
  type CreditRequirementsCommand,
} from '../apps/storefront/lib/credit-requirements-contract.ts';
import { readCreditDocuments } from '../apps/storefront/lib/credit-document-contract.ts';
const dir = process.argv[2];
assert.ok(dir);
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex'),
  names = (await readdir(dir))
    .filter((x) => /^\d+\.meta\.json$/.test(x))
    .sort((a, b) => parseInt(a) - parseInt(b));
const rows = await Promise.all(
  names.map(async (name) => {
    const n = parseInt(name),
      meta = JSON.parse(await readFile(`${dir}/${name}`, 'utf8')),
      bytes = await readFile(`${dir}/${n}.response.json`);
    assert.equal(meta.status, 200);
    assert.equal(meta.actualSqlHttpResponse, true);
    assert.equal(meta.syntheticQaOnly, true);
    assert.match(meta.cacheControl, /no-store/);
    assert.equal(meta.responseSha256, sha(bytes));
    const inputBytes = meta.requestSha256 ? await readFile(`${dir}/${n}.request.json`) : null;
    if (inputBytes) assert.equal(meta.requestSha256, sha(inputBytes));
    return {
      n,
      meta,
      raw: JSON.parse(bytes.toString('utf8')),
      input: inputBytes ? JSON.parse(inputBytes.toString('utf8')) : null,
    };
  }),
);
const commands = new Map<
  string,
  | CreditReviewCommand
  | CreditSubmissionCommand
  | CreditApplicationCommand
  | CreditRequirementsCommand
>();
let app = '',
  consent = '',
  revision = '',
  returned = '',
  approved = '',
  returnIndex = 0,
  approveIndex = 0;
const submissions: string[] = [];
let publications = 0,
  consents = 0,
  created = 0;
const writes = rows.filter((r) => r.meta.method !== 'GET');
assert.equal(writes.length, 7);
for (const r of writes) {
  const path = r.meta.path,
    id = path.split('/').at(-1)!;
  assert.equal(commands.has(id), false);
  if (path.startsWith('/api/admin/credit/requirements/commands/')) {
    const c: CreditRequirementsCommand = {
        kind: 'publish',
        id,
        body: publishCreditRequirementsSchema.parse(r.input),
      },
      v = readCreditRequirementsResult(r.raw, c);
    assert.ok('current' in v && v.current.published);
    assert.equal(v.current.published.content.documents.length, 0);
    assert.match(v.current.published.content.termsEn, /Synthetic local QA only/);
    revision = v.current.published.id;
    publications++;
    commands.set(id, c);
  } else if (path.includes('/reviews/commands/')) {
    const c: CreditReviewCommand = {
        id,
        applicationId: app,
        body: creditReviewBodySchema.parse(r.input),
      },
      v = readCreditReviewResult(r.raw, c);
    assert.equal(v.replayed, false);
    assert.equal(v.review.submissionId, submissions.at(-1));
    if (v.review.outcome === 'Returned') {
      returned = v.review.id;
      returnIndex = r.n;
      assert.equal(v.application.state, 'Draft');
      assert.equal(r.meta.droppedAfterCommittedSuccess, true);
      assert.equal(r.meta.dropKind, 'review');
    } else {
      assert.equal(v.review.outcome, 'Approved');
      approved = v.review.id;
      approveIndex = r.n;
      assert.equal(v.review.approvedAmountRial, '9007199254740993');
      assert.equal(Date.parse(v.review.expiresAt!), Date.parse('2026-10-28T10:00:00Z'));
      assert.equal(r.meta.droppedAfterCommittedSuccess, false);
    }
    commands.set(id, c);
  } else if (path.includes('/submissions/commands/')) {
    const c: CreditSubmissionCommand = {
        id,
        applicationId: app,
        body: creditSubmissionBodySchema.parse(r.input),
      },
      v = readCreditSubmissionResult(r.raw, c);
    assert.equal(v.replayed, false);
    assert.equal(c.body.consentId, consent);
    assert.equal(c.body.requirementsRevisionId, revision);
    assert.equal(v.submission.documentCount, 0);
    assert.equal(c.body.locale, 'fa');
    submissions.push(v.submission.id);
    commands.set(id, c);
  } else if (path.includes('/consents/')) {
    const c: CreditRequirementsCommand = {
        kind: 'consent',
        id,
        applicationId: app,
        body: acceptCreditRequirementsSchema.parse(r.input),
      },
      v = readCreditRequirementsResult(r.raw, c);
    assert.ok('consent' in v);
    assert.equal(v.consent.requirements.id, revision);
    consent = v.consent.id;
    consents++;
    commands.set(id, c);
  } else {
    const c: CreditApplicationCommand = {
        kind: 'create',
        id,
        body: creditApplicationCreateSchema.parse(r.input),
      },
      v = readCreditApplicationResult(r.raw, c);
    assert.equal(v.replayed, false);
    assert.equal(v.application.requestedAmountRial, '9007199254740993');
    app = v.application.id;
    created++;
    commands.set(id, c);
  }
}
assert.equal(publications, 1);
assert.equal(consents, 1);
assert.equal(created, 1);
assert.equal(submissions.length, 2);
assert.notEqual(submissions[0], submissions[1]);
assert.ok(returned && approved && returnIndex && approveIndex && returnIndex < approveIndex);
let receipts = 0,
  reviewerDecisions = 0,
  ownerDecisions = 0,
  historicalReturnedDetails = 0,
  approvedDetails = 0,
  emptySubmittedQueueAfterReturn = 0,
  approvedQueue = 0;
for (const r of rows) {
  assert.doesNotMatch(
    JSON.stringify(r.raw),
    /"(?:ownerId|actorId|email|phoneNumber|password|accessToken|refreshToken|protectedNote|protectedResult|storageKey)"\s*:/i,
  );
  if (r.meta.method !== 'GET') continue;
  const url = new URL(r.meta.path, 'http://qa.invalid'),
    path = url.pathname,
    staff = path.startsWith('/api/admin/'),
    appId = /\/applications\/([a-f0-9]{32})/.exec(path)?.[1];
  if (path.endsWith('/review')) {
    assert.ok(staff && appId);
    readCreditReviewCapabilities(r.raw, appId);
  } else if (path.endsWith('/reviews')) {
    assert.ok(appId);
    const v = readCreditReviewPage(r.raw, appId);
    if (r.n > approveIndex) assert.equal(v.items.length, 2);
  } else if (path.includes('/reviews/commands/')) {
    assert.ok(staff);
    const c = commands.get(path.split('/').at(-1)!);
    assert.ok(c && 'submissionId' in c.body && 'outcome' in c.body);
    const v = readCreditReviewResult(r.raw, c as CreditReviewCommand);
    assert.equal(v.replayed, true);
    assert.equal(v.review.id, returned);
    receipts++;
  } else if (path.includes('/reviews/')) {
    assert.ok(appId);
    const v = readCreditReviewDetail(r.raw, appId, path.split('/').at(-1)!);
    if (staff) reviewerDecisions++;
    else ownerDecisions++;
    if (v.review.outcome === 'Returned') {
      assert.equal(v.review.id, returned);
      assert.equal(v.review.submissionId, submissions[0]);
      if (r.n > approveIndex) historicalReturnedDetails++;
    } else {
      assert.equal(v.review.id, approved);
      assert.equal(v.review.submissionId, submissions[1]);
      assert.equal(v.review.approvedAmountRial, '9007199254740993');
      approvedDetails++;
    }
  } else if (path.endsWith('/submission')) {
    assert.ok(appId);
    readCreditSubmissionCapabilities(r.raw, appId, staff);
  } else if (path.endsWith('/submissions')) {
    assert.ok(appId);
    readCreditSubmissionPage(r.raw, appId);
  } else if (path.includes('/submissions/')) {
    assert.ok(appId);
    readCreditSubmissionDetail(r.raw, appId, path.split('/').at(-1)!);
  } else if (path.endsWith('/documents')) {
    assert.ok(appId);
    readCreditDocuments(r.raw, appId, staff);
  } else if (path.endsWith('/requirements') && appId) readCreditCaseRequirements(r.raw, appId);
  else if (path.endsWith('/requirements')) creditRequirementsCurrentSchema.parse(r.raw);
  else if (path.endsWith('/requirements/history')) creditRequirementsHistorySchema.parse(r.raw);
  else if (path.includes('/requirements/revisions/')) creditRequirementsRevisionSchema.parse(r.raw);
  else if (path.endsWith('/plans')) creditPlansSchema.parse(r.raw);
  else if (appId) readCreditApplicationDetail(r.raw, appId);
  else {
    const v = readCreditApplicationPage(r.raw, url.searchParams.get('state'));
    if (
      staff &&
      url.searchParams.get('state') === 'Submitted' &&
      r.n > returnIndex &&
      r.n <
        writes.find((x) => x.meta.path.includes('/submissions/commands/') && x.n > returnIndex)!.n
    ) {
      assert.equal(v.items.length, 0);
      emptySubmittedQueueAfterReturn++;
    }
    if (staff && url.searchParams.get('state') === 'Approved') {
      assert.ok(v.items.some((i) => i.id === app));
      approvedQueue++;
    }
  }
}
assert.equal(receipts, 1);
assert.ok(
  ownerDecisions >= 3 &&
    reviewerDecisions >= 3 &&
    historicalReturnedDetails >= 1 &&
    approvedDetails >= 2 &&
    emptySubmittedQueueAfterReturn >= 1 &&
    approvedQueue >= 1,
);
const report = {
  passed: true,
  responses: rows.length,
  actualSqlHttpBodies: true,
  rawBodiesUnmodified: true,
  strictProductionDecoders: true,
  successfulWrites: 7,
  publications,
  createdApplications: created,
  consents,
  submissions: 2,
  returnedDecisions: 1,
  approvedDecisions: 1,
  committedSuccessResponsesLost: 1,
  receiptReads: receipts,
  duplicateSuccessfulMutationRequests: 0,
  reviewerDecisions,
  ownerDecisions,
  historicalReturnedDetails,
  approvedDetails,
  emptySubmittedQueueAfterReturn,
  approvedQueue,
  applicationId: app,
  submissionIds: submissions,
  returnedReviewId: returned,
  approvedReviewId: approved,
  exactLargeRialString: true,
  explicitUtcExpiry: true,
  filesStorage: 'Disabled',
  noRequiredDocumentsExplicitlyPublishedInQa: true,
  actualS3AndClamAvThisSlice: false,
  firstFunctionalWritesCandidate: 'tmp/credit-review59-runtime-set.json',
  approvalWriteCandidate: 'tmp/credit-review59-final-runtime-set.json',
  finalCopyCandidate: 'tmp/credit-review59-copy-runtime-set.json',
  finalCopyWritesRetested: false,
  manualSyntheticDecisionsOnly: true,
  realPersonEligibilityDecided: false,
  creditCheckoutEnabled: false,
  mainPromoted: false,
};
await writeFile(`${dir}/acceptance.json`, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report));
