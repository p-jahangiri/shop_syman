import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  creditScopeCommandSchema,
  readCreditScopeResult,
  readCreditPurchaseScopePage,
  type CreditScopeCommand,
} from '../apps/storefront/lib/credit-purchase-scope-contract.ts';
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
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const names = (await readdir(dir))
  .filter((x) => /^\d+\.meta\.json$/.test(x))
  .sort((a, b) => parseInt(a) - parseInt(b));
const rows = await Promise.all(
  names.map(async (name) => {
    const n = parseInt(name),
      meta = JSON.parse(await readFile(dir + '/' + name, 'utf8')),
      bytes = await readFile(`${dir}/${n}.response.json`);
    assert.ok([200, 429].includes(meta.status));
    if (meta.status === 429) {
      assert.equal(meta.method, 'GET');
      assert.equal(bytes.length, 0);
    }
    assert.equal(meta.actualSqlHttpResponse, true);
    assert.equal(meta.syntheticQaOnly, true);
    assert.match(meta.cacheControl, /no-store/);
    assert.equal(meta.responseSha256, sha(bytes));
    const inputBytes = meta.requestSha256 ? await readFile(`${dir}/${n}.request.json`) : null;
    if (inputBytes) assert.equal(meta.requestSha256, sha(inputBytes));
    return {
      n,
      meta,
      raw: bytes.length ? JSON.parse(bytes.toString('utf8')) : null,
      input: inputBytes ? JSON.parse(inputBytes.toString('utf8')) : null,
    };
  }),
);
const rateLimited = rows.filter((x) => x.meta.status === 429);
assert.equal(rateLimited.length, 2);
for (const failed of rateLimited)
  assert.ok(
    rows.some(
      (x) =>
        x.n > failed.n &&
        x.meta.status === 200 &&
        x.meta.method === 'GET' &&
        x.meta.path === failed.meta.path,
    ),
  );
const scopeCommands = new Map<string, CreditScopeCommand>();
let app = '',
  review = '',
  submission = '',
  scope = '',
  revision = '',
  consent = '',
  approval: { approvedAmountRial: string; expiresAt: string; submissionId: string } | null = null;
const counts = { publish: 0, create: 0, consent: 0, submit: 0, approve: 0, grant: 0, revoke: 0 };
const writeIds = new Set<string>();
const applicationIds: string[] = [];
for (const r of rows.filter((x) => x.meta.method !== 'GET')) {
  const path = r.meta.path,
    id = path.split('/').at(-1)!;
  assert.equal(writeIds.has(id), false);
  writeIds.add(id);
  if (path.includes('/purchase-scope/')) {
    assert.ok(approval);
    const kind = path.includes('/grant/') ? 'Grant' : 'Revoke',
      staff = path.startsWith('/api/admin/'),
      c = creditScopeCommandSchema.parse({
        id,
        applicationId: app,
        staff,
        kind,
        ...(kind === 'Grant' ? { approval } : {}),
        body: r.input,
      }),
      v = readCreditScopeResult(r.raw, c);
    assert.equal(v.replayed, false);
    assert.equal(v.scope.reviewId, review);
    assert.equal(v.scope.submissionId, submission);
    assert.equal(v.scope.limitAmountRial, '9007199254740993');
    assert.equal(Date.parse(v.scope.expiresAt), Date.parse('2026-10-28T10:00:00Z'));
    scopeCommands.set(id, c);
    if (kind === 'Grant') {
      counts.grant++;
      scope = v.scope.id;
      assert.equal(r.meta.droppedAfterCommittedSuccess, counts.grant === 1);
      assert.equal(r.meta.dropKind, counts.grant === 1 ? 'scope' : null);
    } else {
      counts.revoke++;
      assert.equal(v.scope.id, scope);
      assert.equal(v.scope.revocation?.actorKind, staff ? 'Staff' : 'Owner');
      assert.match(v.scope.revocation!.note, /ساختگی/);
    }
  } else if (path.includes('/requirements/commands/')) {
    const c: CreditRequirementsCommand = {
        id,
        kind: 'publish',
        body: publishCreditRequirementsSchema.parse(r.input),
      },
      v = readCreditRequirementsResult(r.raw, c);
    assert.ok('current' in v && v.current.published);
    assert.equal(v.current.published.content.documents.length, 0);
    assert.match(v.current.published.content.termsEn, /Temporary software QA only/);
    revision = v.current.published.id;
    counts.publish++;
  } else if (path.includes('/reviews/commands/')) {
    const c: CreditReviewCommand = {
        id,
        applicationId: app,
        body: creditReviewBodySchema.parse(r.input),
      },
      v = readCreditReviewResult(r.raw, c);
    assert.equal(v.review.outcome, 'Approved');
    assert.equal(v.review.submissionId, submission);
    review = v.review.id;
    approval = {
      approvedAmountRial: v.review.approvedAmountRial!,
      expiresAt: v.review.expiresAt!,
      submissionId: submission,
    };
    counts.approve++;
  } else if (path.includes('/submissions/commands/')) {
    const c: CreditSubmissionCommand = {
        id,
        applicationId: app,
        body: creditSubmissionBodySchema.parse(r.input),
      },
      v = readCreditSubmissionResult(r.raw, c);
    assert.equal(c.body.consentId, consent);
    assert.equal(c.body.requirementsRevisionId, revision);
    assert.equal(v.submission.documentCount, 0);
    submission = v.submission.id;
    counts.submit++;
  } else if (path.includes('/consents/')) {
    const c: CreditRequirementsCommand = {
        id,
        applicationId: app,
        kind: 'consent',
        body: acceptCreditRequirementsSchema.parse(r.input),
      },
      v = readCreditRequirementsResult(r.raw, c);
    assert.ok('consent' in v);
    assert.equal(v.consent.requirements.id, revision);
    consent = v.consent.id;
    counts.consent++;
  } else {
    const c: CreditApplicationCommand = {
        id,
        kind: 'create',
        body: creditApplicationCreateSchema.parse(r.input),
      },
      v = readCreditApplicationResult(r.raw, c);
    app = v.application.id;
    applicationIds.push(app);
    assert.equal(v.application.requestedAmountRial, '9007199254740993');
    counts.create++;
  }
}
assert.deepEqual(counts, {
  publish: 1,
  create: 2,
  consent: 2,
  submit: 2,
  approve: 2,
  grant: 2,
  revoke: 2,
});
let receiptReads = 0,
  ownerActive = 0,
  ownerRevoked = 0,
  staffRevoked = 0;
for (const r of rows) {
  assert.doesNotMatch(
    JSON.stringify(r.raw),
    /"(?:ownerId|actorId|email|phoneNumber|password|accessToken|refreshToken|protectedNote|protectedResult|storageKey)"\s*:/i,
  );
  if (r.meta.method !== 'GET' || r.meta.status === 429) continue;
  const url = new URL(r.meta.path, 'http://qa.invalid'),
    path = url.pathname,
    staff = path.startsWith('/api/admin/'),
    appId = /\/applications\/([a-f0-9]{32})/.exec(path)?.[1];
  if (path.includes('/purchase-scope/commands/')) {
    const c = scopeCommands.get(path.split('/').at(-1)!);
    assert.ok(c);
    assert.equal(readCreditScopeResult(r.raw, c).replayed, true);
    receiptReads++;
  } else if (path.endsWith('/purchase-scope')) {
    assert.ok(appId);
    const p = readCreditPurchaseScopePage(r.raw, appId, staff);
    if (!staff && p.scope?.state === 'Active') ownerActive++;
    if (p.scope?.state === 'Revoked') {
      if (staff) staffRevoked++;
      else ownerRevoked++;
    }
  } else if (path.endsWith('/review')) {
    assert.ok(appId);
    readCreditReviewCapabilities(r.raw, appId);
  } else if (path.endsWith('/reviews')) {
    assert.ok(appId);
    readCreditReviewPage(r.raw, appId);
  } else if (path.includes('/reviews/')) {
    assert.ok(appId);
    readCreditReviewDetail(r.raw, appId, path.split('/').at(-1)!);
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
  else readCreditApplicationPage(r.raw, url.searchParams.get('state'));
}
assert.equal(receiptReads, 1);
assert.ok(ownerActive >= 1 && ownerRevoked >= 2 && staffRevoked >= 2);
const report = {
  passed: true,
  responses: rows.length,
  successfulResponses: rows.length - rateLimited.length,
  rateLimitedReadonlyResponses: rateLimited.length,
  rateLimitedReadsLaterRecovered: true,
  actualSqlHttpBodies: true,
  rawBodiesUnmodified: true,
  strictProductionDecoders: true,
  successfulWrites: 13,
  counts,
  committedSuccessResponsesLost: 1,
  receiptReads,
  duplicateSuccessfulMutationRequests: 0,
  ownerActive,
  ownerRevoked,
  staffRevoked,
  applicationId: app,
  submissionId: submission,
  reviewId: review,
  scopeId: scope,
  exactLargeRialString: true,
  syntheticQaOnly: true,
  realPersonEligibilityDecided: false,
  creditCheckoutEnabled: false,
  runtimeSet: 'tmp/credit-purchase-scope60-ui-runtime-set.json',
  firstFunctionalCandidate: 'tmp/credit-purchase-scope60-runtime-set.json',
  finalSecondCaseFunctionalWritesRetested: true,
  finalFirstCaseUnknownRecoveryRetested: false,
  applicationIds,
  mainPromoted: false,
};
await writeFile(dir + '/acceptance.json', JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(
  JSON.stringify({ passed: true, responses: rows.length, successfulWrites: 13, receiptReads }),
);
