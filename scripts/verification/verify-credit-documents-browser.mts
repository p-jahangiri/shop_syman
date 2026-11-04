import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  creditDocumentCommandSchema,
  isCreditDocumentPath,
  readCreditDocumentResult,
  readCreditDocuments,
  type CreditDocumentCommand,
} from '@sayman/web-shared/lib/credit/credit-document-contract.ts';
import { isCreditRequirementsPath } from '@sayman/web-shared/lib/credit/credit-requirements-path.ts';
import {
  publishCreditRequirementsSchema,
  acceptCreditRequirementsSchema,
  creditRequirementsCurrentSchema,
  creditRequirementsHistorySchema,
  creditRequirementsRevisionSchema,
  readCreditRequirementsResult,
  readCreditCaseRequirements,
  type CreditRequirementsCommand,
} from '@sayman/web-shared/lib/credit/credit-requirements-contract.ts';
import {
  creditApplicationCreateSchema,
  creditApplicationCancelSchema,
  creditPlansSchema,
  readCreditApplicationResult,
  readCreditApplicationPage,
  readCreditApplicationDetail,
  type CreditApplicationCommand,
} from '@sayman/web-shared/lib/credit/credit-application-contract.ts';
const dir = process.argv[2];
assert.ok(dir);
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex'),
  files = (await readdir(dir))
    .filter((x) => /^\d+\.meta\.json$/.test(x))
    .sort((a, b) => parseInt(a) - parseInt(b));
const rows = await Promise.all(
  files.map(async (name) => {
    const n = parseInt(name),
      meta = JSON.parse(await readFile(`${dir}/${name}`, 'utf8')),
      binary = meta.status === 200 && meta.path.includes('/documents/files/'),
      raw = await readFile(`${dir}/${n}.response.${binary ? 'bin' : 'json'}`);
    assert.equal(meta.actualSqlHttpResponse, true);
    assert.equal(meta.actualS3AndClamAv, true);
    assert.equal(meta.syntheticQaOnly, true);
    assert.equal(sha(raw), meta.responseSha256);
    assert.equal(raw.length, meta.responseBytes);
    assert.match(meta.cacheControl, /no-store/);
    assert.match(meta.robots, /noindex/);
    const inputBytes = meta.requestSha256 ? await readFile(`${dir}/${n}.request.json`) : null;
    if (inputBytes) assert.equal(sha(inputBytes), meta.requestSha256);
    return {
      n,
      meta,
      raw,
      value: !binary && raw.length ? JSON.parse(raw.toString('utf8')) : null,
      input: inputBytes ? JSON.parse(inputBytes.toString('utf8')) : null,
    };
  }),
);
const writes = rows.filter((x) => x.meta.method !== 'GET' && x.meta.status === 200);
assert.equal(writes.length, 7);
const commands = new Map<
  string,
  CreditApplicationCommand | CreditRequirementsCommand | CreditDocumentCommand
>();
let applicationId = '',
  fileId = '',
  upload: CreditDocumentCommand | undefined,
  createCount = 0,
  cancelCount = 0,
  publications = 0,
  consents = 0,
  cancelIndex = 0,
  attachmentAt = '';
const revisions: string[] = [],
  consentIds: string[] = [];
for (const r of writes) {
  const parts = r.meta.path.split('/'),
    id = parts.at(-1)!;
  assert.equal(commands.has(id), false, 'No duplicate successful mutation requests');
  if (r.meta.multipartCanonical) {
    const c = creditDocumentCommandSchema.parse(r.input),
      v = readCreditDocumentResult(r.value, c);
    assert.equal(c.applicationId, applicationId);
    assert.equal(c.body.consentId, consentIds[0]);
    assert.equal(c.body.requirementsRevisionId, revisions[0]);
    assert.equal(c.body.replacesFileId, null);
    assert.equal(r.meta.droppedAfterCommittedSuccess, true);
    assert.equal(r.meta.dropKind, 'attachment');
    assert.match(r.meta.multipartRequestSha256, /^[a-f0-9]{64}$/);
    assert.equal(v.replayed, false);
    upload = c;
    fileId = v.attachment.id;
    attachmentAt = v.attachment.at;
    commands.set(id, c);
  } else if (r.meta.path.startsWith('/api/admin/credit/requirements/commands/')) {
    const c: CreditRequirementsCommand = {
        kind: 'publish',
        id,
        body: publishCreditRequirementsSchema.parse(r.input),
      },
      v = readCreditRequirementsResult(r.value, c);
    assert.ok('current' in v);
    assert.ok(v.current.published);
    assert.match(v.current.published.content.termsEn, /synthetic/i);
    assert.equal(v.replayed, false);
    publications++;
    revisions.push(v.current.published.id);
    commands.set(id, c);
  } else if (parts[5] === 'consents') {
    const c: CreditRequirementsCommand = {
        kind: 'consent',
        id,
        applicationId: parts[4],
        body: acceptCreditRequirementsSchema.parse(r.input),
      },
      v = readCreditRequirementsResult(r.value, c);
    assert.ok('consent' in v);
    assert.equal(c.applicationId, applicationId);
    assert.equal(v.consent.locale, consents === 0 ? 'fa' : 'en');
    assert.equal(v.replayed, false);
    consents++;
    consentIds.push(v.consent.id);
    commands.set(id, c);
  } else {
    const c: CreditApplicationCommand =
        r.meta.method === 'POST'
          ? { kind: 'create', id, body: creditApplicationCreateSchema.parse(r.input) }
          : {
              kind: 'cancel',
              id,
              applicationId: parts[4],
              body: creditApplicationCancelSchema.parse(r.input),
            },
      v = readCreditApplicationResult(r.value, c);
    assert.equal(v.replayed, false);
    assert.equal(v.application.requestedAmountRial, '9007199254740993');
    if (c.kind === 'create') {
      applicationId = v.application.id;
      createCount++;
    } else {
      assert.equal(c.applicationId, applicationId);
      cancelCount++;
      cancelIndex = r.n;
    }
    commands.set(id, c);
  }
}
assert.ok(upload);
assert.equal(createCount, 1);
assert.equal(cancelCount, 1);
assert.equal(publications, 2);
assert.equal(consents, 2);
assert.equal(new Set(consentIds).size, 2);
assert.equal(new Set(revisions).size, 2);
const realServices = JSON.parse(
  await readFile('artifacts/checks/credit-documents57-refreshed-services.json', 'utf8'),
);
assert.equal(realServices.passed, true);
assert.equal(realServices.eicarRejected, true);
assert.equal(realServices.definitionsYoungerThan48Hours, true);
assert.match(realServices.clamVersion, /\/28165\//);
assert.ok(
  Date.parse(attachmentAt) >= Date.parse(realServices.definitionsAtUtc) &&
    Date.parse(attachmentAt) - Date.parse(realServices.definitionsAtUtc) < 48 * 3600000,
);
let receiptReads = 0,
  downloads = 0,
  reviewerDownloads = 0,
  cancelledDownloads = 0,
  currentFilesBeforeReconsent = 0,
  historicalFilesAfterReconsent = 0,
  staleConsentPages = 0,
  cancelledOwnerPages = 0,
  cancelledReviewerPages = 0,
  unauthorized = 0;
for (const r of rows) {
  if (r.meta.status === 401) {
    unauthorized++;
    continue;
  }
  assert.equal(r.meta.status, 200);
  if (r.meta.method !== 'GET') continue;
  const url = new URL(r.meta.path, 'http://qa.invalid'),
    p = url.pathname,
    parts = p.split('/'),
    staff = p.startsWith('/api/admin/'),
    app = staff ? parts[5] : parts[4];
  if (isCreditDocumentPath(p, 'GET', staff)) {
    if (parts.includes('files')) {
      assert.equal(app, applicationId);
      assert.equal(parts.at(-1), fileId);
      assert.equal(r.meta.privateFileId, fileId);
      assert.equal(r.meta.contentType, upload.file.contentType);
      assert.match(r.meta.contentDisposition, /^attachment/);
      assert.equal(r.raw.length, upload.file.bytes);
      assert.equal(sha(r.raw).toUpperCase(), upload.file.sha256);
      downloads++;
      if (staff) reviewerDownloads++;
      if (r.n > cancelIndex) cancelledDownloads++;
    } else if (parts.includes('commands')) {
      assert.equal(parts.at(-1), upload.id);
      const v = readCreditDocumentResult(r.value, upload);
      assert.equal(v.replayed, true);
      receiptReads++;
    } else {
      const v = readCreditDocuments(r.value, app, staff);
      assert.equal(v.application.id, applicationId);
      assert.equal(v.application.requestedAmountRial, '9007199254740993');
      if (v.items.length) {
        assert.equal(v.items.length, 1);
        assert.equal(v.items[0].attachment.id, fileId);
        assert.equal(v.items[0].attachment.consentId, consentIds[0]);
        assert.equal(v.items[0].attachment.requirementsRevisionId, revisions[0]);
        if (v.currentConsentId === consentIds[0] && v.items[0].isCurrent)
          currentFilesBeforeReconsent++;
        if (v.currentConsentId === consentIds[1]) {
          assert.equal(v.items[0].isCurrent, false);
          historicalFilesAfterReconsent++;
        }
      }
      if (v.blockers.includes('credit_current_consent_required') && v.items.length) {
        assert.equal(v.canUpload, false);
        staleConsentPages++;
      }
      if (v.application.state === 'Cancelled') {
        assert.equal(v.canUpload, false);
        if (staff) cancelledReviewerPages++;
        else cancelledOwnerPages++;
      }
    }
  } else if (isCreditRequirementsPath(r.meta.path, 'GET', staff)) {
    if (p.endsWith('/history')) creditRequirementsHistorySchema.parse(r.value);
    else if (p.includes('/revisions/')) creditRequirementsRevisionSchema.parse(r.value);
    else if (p.endsWith('/requirements') && p.includes('/applications/'))
      readCreditCaseRequirements(r.value, app);
    else creditRequirementsCurrentSchema.parse(r.value);
  } else if (p.endsWith('/plans')) creditPlansSchema.parse(r.value);
  else if (/^\/api\/(?:admin\/)?credit\/applications\/[a-f0-9]{32}$/.test(p))
    readCreditApplicationDetail(r.value, parts.at(-1)!);
  else readCreditApplicationPage(r.value, url.searchParams.get('state'));
  if (r.value)
    assert.doesNotMatch(
      JSON.stringify(r.value),
      /"(?:ownerId|actorId|email|phoneNumber|password|accessToken|refreshToken|protectedKey|protectedFilename|storageKey)"\s*:/i,
    );
}
assert.equal(receiptReads, 1);
assert.equal(downloads, 3);
assert.equal(reviewerDownloads, 1);
assert.equal(cancelledDownloads, 1);
assert.ok(
  currentFilesBeforeReconsent >= 1 &&
    historicalFilesAfterReconsent >= 2 &&
    staleConsentPages >= 1 &&
    cancelledOwnerPages >= 1 &&
    cancelledReviewerPages >= 1,
);
const report = {
  passed: true,
  responses: rows.length,
  actualSqlHttpBodies: true,
  rawBodiesUnmodified: true,
  strictProductionDecoders: true,
  actualS3AndClamAv: true,
  freshSignedDefinitionsAtAttachment: true,
  signatureVersion: 28165,
  successfulWrites: 7,
  createdDrafts: 1,
  cancelledDrafts: 1,
  publications: 2,
  consents: 2,
  documentUploads: 1,
  browserReplacementUploadExecuted: false,
  sqlReplacementAcceptedSeparately: true,
  committedSuccessResponsesLost: 1,
  receiptReads,
  duplicateSuccessfulMutationRequests: 0,
  unauthorizedResponses: unauthorized,
  downloads,
  reviewerDownloads,
  cancelledDownloads,
  downloadHttpBytesExact: true,
  savedBrowserDownloadFileBytesVerified: false,
  currentFilesBeforeReconsent,
  historicalFilesAfterReconsent,
  staleConsentPages,
  cancelledOwnerPages,
  cancelledReviewerPages,
  applicationId,
  fileId,
  exactLargeRialString: true,
  submissionEnabled: false,
  mainPromoted: false,
};
await writeFile(`${dir}/acceptance.json`, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report));
