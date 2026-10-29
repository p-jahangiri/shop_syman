import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  creditPlansSchema,
  readCreditApplicationPage,
  readCreditApplicationDetail,
  readCreditApplicationResult,
  type CreditApplicationCommand,
} from '../apps/storefront/lib/credit-application-contract.ts';

const dir = process.argv[2];
assert.ok(dir);
const sha = (raw: Buffer) => createHash('sha256').update(raw).digest('hex');
const files = (await readdir(dir))
  .filter((x) => /^\d+\.meta\.json$/.test(x))
  .sort((a, b) => parseInt(a) - parseInt(b));
const rows = await Promise.all(
  files.map(async (file) => {
    const n = file.split('.')[0],
      meta = JSON.parse(await readFile(`${dir}/${file}`, 'utf8')),
      raw = await readFile(`${dir}/${n}.response.json`);
    assert.equal(meta.actualSqlHttpResponse, true);
    assert.equal(meta.syntheticQaOnly, true);
    assert.equal(sha(raw), meta.responseSha256);
    assert.match(meta.cacheControl, /no-store/);
    const request = meta.requestSha256 ? await readFile(`${dir}/${n}.request.json`) : null;
    if (request) assert.equal(sha(request), meta.requestSha256);
    return {
      meta,
      raw: JSON.parse(raw.toString('utf8')),
      request: request ? JSON.parse(request.toString('utf8')) : null,
    };
  }),
);
const writes = rows.filter((r) => r.meta.method !== 'GET');
assert.equal(writes.length, 2);
const commands = new Map<string, CreditApplicationCommand>();
let applicationId = '';
for (const r of writes) {
  assert.equal(r.meta.status, 200);
  assert.equal(r.meta.droppedAfterCommittedSuccess, true);
  const bits = r.meta.path.split('/'),
    id = bits.at(-1);
  const command: CreditApplicationCommand =
    r.meta.method === 'POST'
      ? { kind: 'create', id, body: r.request }
      : { kind: 'cancel', id, applicationId: bits[4], body: r.request };
  const result = readCreditApplicationResult(r.raw, command);
  assert.equal(result.replayed, false);
  if (command.kind === 'create') {
    applicationId = result.application.id;
    assert.equal(command.body.requestedAmountRial, '9007199254740993');
    assert.equal(r.meta.dropKind, 'create');
  } else {
    assert.equal(command.applicationId, applicationId);
    assert.equal(r.meta.dropKind, 'cancel');
  }
  commands.set(id, command);
}
let decoded = 2,
  receiptReads = 0,
  customerDetails = 0,
  staffDetails = 0,
  cancelledDetails = 0;
for (const r of rows) {
  if (r.meta.method !== 'GET') continue;
  if (r.meta.status === 401) {
    assert.ok(r.raw);
    continue;
  }
  assert.equal(r.meta.status, 200);
  const url = new URL(r.meta.path, 'http://qa.invalid'),
    path = url.pathname;
  if (path === '/api/credit/plans') {
    creditPlansSchema.parse(r.raw);
  } else if (/\/commands\/[a-f0-9]{32}$/.test(path)) {
    const command = commands.get(path.split('/').at(-1)!);
    assert.ok(command);
    assert.equal(readCreditApplicationResult(r.raw, command).replayed, true);
    receiptReads++;
  } else if (/\/applications\/[a-f0-9]{32}$/.test(path)) {
    const detail = readCreditApplicationDetail(r.raw, path.split('/').at(-1)!);
    assert.equal(detail.plan.roundingUnitRial, '10');
    assert.equal(detail.application.requestedAmountRial, '9007199254740993');
    assert.equal(detail.canSubmit, false);
    if (path.startsWith('/api/admin/')) staffDetails++;
    else customerDetails++;
    if (detail.application.state === 'Cancelled') cancelledDetails++;
  } else {
    readCreditApplicationPage(r.raw, url.searchParams.get('state'));
  }
  // Private account identifiers and credentials are deliberately absent from this DTO.
  assert.doesNotMatch(
    JSON.stringify(r.raw),
    /"(?:ownerId|actorId|email|phoneNumber|password|accessToken|refreshToken)"\s*:/i,
  );
  decoded++;
}
assert.equal(receiptReads, 2);
assert.ok(customerDetails >= 2 && staffDetails >= 2 && cancelledDetails >= 2);
const report = {
  passed: true,
  actualSqlHttpBodies: true,
  rawBodiesUnmodified: true,
  strictProductionDecoders: true,
  responses: rows.length,
  decoded,
  writes: 2,
  committedSuccessResponsesLost: 2,
  receiptReads,
  duplicateMutationRequests: 0,
  applicationId,
  exactLargeRialString: true,
  roundingRialString: true,
  privateOwnerFieldsAbsent: true,
  customerDetails,
  staffDetails,
  cancelledDetails,
  submissionEnabled: false,
};
await writeFile(`${dir}/acceptance.json`, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report));
