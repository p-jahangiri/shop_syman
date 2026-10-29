import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
  creditApplicationCancelSchema,
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
  CreditSubmissionCommand | CreditApplicationCommand | CreditRequirementsCommand
>();
let app = '',
  sub = '',
  consent = '',
  revision = '',
  submission: CreditSubmissionCommand | undefined,
  cancelIndex = 0;
const writes = rows.filter((r) => r.meta.method !== 'GET');
assert.equal(writes.length, 5);
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
    assert.ok('current' in v);
    assert.ok(v.current.published);
    assert.equal(v.current.published.content.documents.length, 0);
    assert.match(v.current.published.content.termsEn, /Synthetic local QA only/);
    revision = v.current.published.id;
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
    assert.equal(c.body.locale, 'fa');
    assert.equal(v.submission.documentCount, 0);
    assert.equal(r.meta.droppedAfterCommittedSuccess, true);
    assert.equal(r.meta.dropKind, 'submit');
    submission = c;
    sub = v.submission.id;
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
    commands.set(id, c);
  } else {
    const c: CreditApplicationCommand =
        r.meta.method === 'POST'
          ? { kind: 'create', id, body: creditApplicationCreateSchema.parse(r.input) }
          : {
              kind: 'cancel',
              id,
              applicationId: app,
              body: creditApplicationCancelSchema.parse(r.input),
            },
      v = readCreditApplicationResult(r.raw, c);
    assert.equal(v.replayed, false);
    assert.equal(v.application.requestedAmountRial, '9007199254740993');
    if (c.kind === 'create') app = v.application.id;
    else cancelIndex = r.n;
    commands.set(id, c);
  }
}
assert.ok(app && sub && submission && cancelIndex);
let receiptReads = 0,
  reviewerDetails = 0,
  withdrawnDetails = 0,
  queueSubmitted = 0,
  queueEmptyAfterWithdrawal = 0;
for (const r of rows) {
  assert.doesNotMatch(
    JSON.stringify(r.raw),
    /"(?:ownerId|actorId|email|phoneNumber|password|accessToken|refreshToken|protectedNote|protectedResult|storageKey)"\s*:/i,
  );
  if (r.meta.method !== 'GET') continue;
  const url = new URL(r.meta.path, 'http://qa.invalid'),
    path = url.pathname,
    staff = path.startsWith('/api/admin/'),
    match = /\/applications\/([a-f0-9]{32})/.exec(path),
    appId = match?.[1];
  if (path.endsWith('/submission')) {
    assert.ok(appId);
    readCreditSubmissionCapabilities(r.raw, appId, staff);
  } else if (path.endsWith('/submissions')) {
    assert.ok(appId);
    readCreditSubmissionPage(r.raw, appId);
  } else if (path.includes('/submissions/commands/')) {
    assert.equal(path.split('/').at(-1), submission.id);
    const v = readCreditSubmissionResult(r.raw, submission);
    assert.equal(v.replayed, true);
    receiptReads++;
  } else if (path.includes('/submissions/')) {
    assert.ok(appId);
    const v = readCreditSubmissionDetail(r.raw, appId, path.split('/').at(-1)!);
    assert.equal(v.submission.id, sub);
    assert.equal(v.consent.id, consent);
    assert.equal(v.submission.documentCount, 0);
    if (staff) reviewerDetails++;
    if (v.application.state === 'Cancelled') withdrawnDetails++;
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
    if (staff && url.searchParams.get('state') === 'Submitted') {
      queueSubmitted++;
      if (r.n > cancelIndex) {
        assert.equal(v.items.length, 0);
        queueEmptyAfterWithdrawal++;
      } else assert.ok(v.items.some((i) => i.id === app));
    }
  }
}
assert.equal(receiptReads, 1);
assert.ok(
  reviewerDetails >= 2 &&
    withdrawnDetails >= 2 &&
    queueSubmitted >= 2 &&
    queueEmptyAfterWithdrawal >= 1,
);
const report = {
  passed: true,
  responses: rows.length,
  actualSqlHttpBodies: true,
  rawBodiesUnmodified: true,
  strictProductionDecoders: true,
  successfulWrites: 5,
  publications: 1,
  createdApplications: 1,
  consents: 1,
  submissions: 1,
  withdrawals: 1,
  committedSuccessResponsesLost: 1,
  receiptReads,
  duplicateSuccessfulMutationRequests: 0,
  reviewerDetails,
  withdrawnDetails,
  queueSubmitted,
  queueEmptyAfterWithdrawal,
  applicationId: app,
  submissionId: sub,
  exactLargeRialString: true,
  filesStorage: 'Disabled',
  noRequiredDocumentsExplicitlyPublishedInQa: true,
  actualS3AndClamAvThisSlice: false,
  finalBundleWritesRetested: false,
  submissionIsApproval: false,
  mainPromoted: false,
};
await writeFile(`${dir}/acceptance.json`, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report));
