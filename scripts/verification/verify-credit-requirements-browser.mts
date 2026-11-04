import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
const sha = (raw: Buffer) => createHash('sha256').update(raw).digest('hex');
const files = (await readdir(dir))
  .filter((x) => /^\d+\.meta\.json$/.test(x))
  .sort((a, b) => parseInt(a) - parseInt(b));
const rows = await Promise.all(
  files.map(async (file) => {
    const n = parseInt(file),
      meta = JSON.parse(await readFile(`${dir}/${file}`, 'utf8')),
      raw = await readFile(`${dir}/${n}.response.json`);
    assert.equal(meta.actualSqlHttpResponse, true);
    assert.equal(meta.syntheticQaOnly, true);
    assert.equal(sha(raw), meta.responseSha256);
    assert.match(meta.cacheControl, /no-store/);
    const request = meta.requestSha256 ? await readFile(`${dir}/${n}.request.json`) : null;
    if (request) assert.equal(sha(request), meta.requestSha256);
    return {
      n,
      meta,
      value: raw.length ? JSON.parse(raw.toString('utf8')) : null,
      input: request ? JSON.parse(request.toString('utf8')) : null,
    };
  }),
);
const writes = rows.filter((x) => x.meta.method !== 'GET');
assert.equal(writes.length, 6);
const commands = new Map<string, CreditApplicationCommand | CreditRequirementsCommand>(),
  publications: string[] = [],
  consents: string[] = [];
let applicationId = '',
  cancelIndex = 0,
  createCount = 0,
  cancelCount = 0,
  drops = 0;
for (const r of writes) {
  assert.equal(r.meta.status, 200);
  const path = r.meta.path,
    parts = path.split('/'),
    id = parts.at(-1)!;
  if (/^\/api\/admin\/credit\/requirements\/commands\//.test(path)) {
    const command: CreditRequirementsCommand = {
        kind: 'publish',
        id,
        body: publishCreditRequirementsSchema.parse(r.input),
      },
      value = readCreditRequirementsResult(r.value, command);
    assert.ok('current' in value);
    assert.ok(value.current.published);
    assert.equal(value.replayed, false);
    publications.push(value.current.published.id);
    commands.set(id, command);
    assert.equal(r.meta.droppedAfterCommittedSuccess, publications.length === 1);
    if (publications.length === 1) {
      assert.equal(r.meta.dropKind, 'publish');
      drops++;
    } else {
      assert.equal(value.current.published.content.documents[0].maxBytes, 4194304);
      assert.deepEqual(value.current.published.content.documents[0].contentTypes, [
        'application/pdf',
        'image/png',
      ]);
    }
  } else if (/^\/api\/credit\/applications\/[a-f0-9]{32}\/consents\//.test(path)) {
    const command: CreditRequirementsCommand = {
        kind: 'consent',
        id,
        applicationId: parts[4],
        body: acceptCreditRequirementsSchema.parse(r.input),
      },
      value = readCreditRequirementsResult(r.value, command);
    assert.ok('consent' in value);
    assert.equal(command.applicationId, applicationId);
    assert.equal(value.replayed, false);
    consents.push(value.consent.requirements.id);
    assert.equal(value.consent.locale, consents.length === 1 ? 'fa' : 'en');
    commands.set(id, command);
    assert.equal(r.meta.droppedAfterCommittedSuccess, consents.length === 1);
    if (consents.length === 1) {
      assert.equal(r.meta.dropKind, 'consent');
      drops++;
    }
  } else {
    const command: CreditApplicationCommand =
        r.meta.method === 'POST'
          ? { kind: 'create', id, body: creditApplicationCreateSchema.parse(r.input) }
          : {
              kind: 'cancel',
              id,
              applicationId: parts[4],
              body: creditApplicationCancelSchema.parse(r.input),
            },
      value = readCreditApplicationResult(r.value, command);
    assert.equal(value.replayed, false);
    assert.equal(value.application.requestedAmountRial, '9007199254740993');
    if (command.kind === 'create') {
      createCount++;
      applicationId = value.application.id;
    } else {
      cancelCount++;
      cancelIndex = r.n;
      assert.equal(command.applicationId, applicationId);
    }
    commands.set(id, command);
    assert.equal(r.meta.droppedAfterCommittedSuccess, false);
  }
}
assert.equal(createCount, 1);
assert.equal(cancelCount, 1);
assert.equal(publications.length, 2);
assert.deepEqual(consents, publications);
assert.equal(new Set(commands.keys()).size, 6);
assert.equal(drops, 2);
let decoded = writes.length,
  receipts = 0,
  staleConsentReads = 0,
  cancelledCustomerRequirements = 0,
  cancelledReviewerRequirements = 0,
  historicalRevisionReads = 0,
  unauthorized = 0;
for (const r of rows) {
  if (r.meta.method !== 'GET') continue;
  if (r.meta.status === 401) {
    unauthorized++;
    continue;
  }
  assert.equal(r.meta.status, 200);
  const url = new URL(r.meta.path, 'http://qa.invalid'),
    path = url.pathname,
    parts = path.split('/'),
    staff = path.startsWith('/api/admin/');
  if (isCreditRequirementsPath(r.meta.path, 'GET', staff)) {
    if (/\/commands\/[a-f0-9]{32}$/.test(path) || /\/consents\/[a-f0-9]{32}$/.test(path)) {
      const command = commands.get(parts.at(-1)!);
      assert.ok(command && ['publish', 'consent'].includes(command.kind));
      const value = readCreditRequirementsResult(r.value, command as CreditRequirementsCommand);
      assert.equal(value.replayed, true);
      receipts++;
    } else if (path.endsWith('/history')) {
      creditRequirementsHistorySchema.parse(r.value);
    } else if (/\/revisions\/[a-f0-9]{32}$/.test(path)) {
      const value = creditRequirementsRevisionSchema.parse(r.value);
      assert.equal(value.id, parts.at(-1));
      historicalRevisionReads++;
    } else if (/\/applications\/[a-f0-9]{32}\/requirements$/.test(path)) {
      const value = readCreditCaseRequirements(r.value, staff ? parts[5] : parts[4]);
      assert.equal(value.application.id, applicationId);
      assert.equal(value.application.requestedAmountRial, '9007199254740993');
      if (value.consent && value.current.published?.id !== value.consent.requirements.id) {
        assert.equal(value.consent.requirements.id, publications[0]);
        assert.equal(value.current.published?.id, publications[1]);
        assert.equal(value.consent.requirements.content.documents[0].maxBytes, 8388608);
        assert.equal(value.current.published.content.documents[0].maxBytes, 4194304);
        staleConsentReads++;
      }
      if (r.n > cancelIndex && value.application.state === 'Cancelled') {
        assert.equal(value.canConsent, false);
        if (staff) cancelledReviewerRequirements++;
        else cancelledCustomerRequirements++;
      }
    } else {
      creditRequirementsCurrentSchema.parse(r.value);
    }
  } else if (path.endsWith('/plans')) {
    creditPlansSchema.parse(r.value);
  } else if (/\/applications\/[a-f0-9]{32}$/.test(path)) {
    readCreditApplicationDetail(r.value, parts.at(-1)!);
  } else {
    readCreditApplicationPage(r.value, url.searchParams.get('state'));
  }
  assert.doesNotMatch(
    JSON.stringify(r.value),
    /"(?:ownerId|actorId|email|phoneNumber|password|accessToken|refreshToken)"\s*:/i,
  );
  decoded++;
}
assert.equal(receipts, 2);
assert.ok(staleConsentReads >= 2);
assert.ok(cancelledCustomerRequirements >= 1 && cancelledReviewerRequirements >= 1);
assert.ok(historicalRevisionReads >= 1);
const report = {
  passed: true,
  responses: rows.length,
  decoded,
  unauthorizedResponses: unauthorized,
  actualSqlHttpBodies: true,
  rawBodiesUnmodified: true,
  strictProductionDecoders: true,
  writes: 6,
  publications: 2,
  consents: 2,
  createdDrafts: 1,
  cancelledDrafts: 1,
  committedSuccessResponsesLost: 2,
  receiptReads: 2,
  duplicateMutationRequests: 0,
  applicationId,
  publicationIds: publications,
  exactLargeRialString: true,
  revisionAndLanguageBound: true,
  staleConsentReads,
  historicalRevisionReads,
  cancelledCustomerRequirements,
  cancelledReviewerRequirements,
  privateOwnerFieldsAbsent: true,
  submissionEnabled: false,
  mainPromoted: false,
};
await writeFile(`${dir}/acceptance.json`, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report));
