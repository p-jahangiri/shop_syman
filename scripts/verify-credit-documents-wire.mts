import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  creditDocumentCommandSchema,
  creditDocumentResultSchema,
  readCreditDocumentResult,
  readCreditDocuments,
} from '../apps/storefront/lib/credit-document-contract.ts';
const dir = process.argv[2];
assert.ok(dir);
const evidence: unknown[] = [];
async function read(name: string) {
  const raw = await readFile(`${dir}/${name}.json`),
    meta = JSON.parse(await readFile(`${dir}/${name}.meta.json`, 'utf8'));
  assert.equal(meta.status, 200);
  assert.equal(meta.actualSqlHttpResponse, true);
  assert.equal(meta.syntheticQaOnly, true);
  assert.equal(meta.storeAndScannerAreTestCaptures, true);
  assert.match(meta.cacheControl, /no-store/);
  assert.match(meta.robots, /noindex/);
  assert.match(meta.contentType, /application\/json/);
  evidence.push({
    name,
    sha256: createHash('sha256').update(raw).digest('hex'),
    method: meta.method,
    path: meta.path,
  });
  return { raw: JSON.parse(raw.toString('utf8')), meta };
}
const command = creditDocumentCommandSchema.parse(
    JSON.parse(await readFile(`${dir}/attached-command.json`, 'utf8')),
  ),
  first = readCreditDocumentResult((await read('attached')).raw, command);
assert.equal(first.replayed, false);
assert.equal(first.application.requestedAmountRial, '9007199254740993');
for (const name of ['replay', 'historical-receipt']) {
  const r = readCreditDocumentResult((await read(name)).raw, command);
  assert.equal(r.replayed, true);
  assert.deepEqual(r.attachment, first.attachment);
  assert.equal(r.application.state, 'Draft');
}
const replacement = creditDocumentResultSchema.parse((await read('replaced')).raw);
assert.equal(replacement.attachment.replacesFileId, first.attachment.id);
assert.equal(replacement.attachment.consentId, first.attachment.consentId);
assert.notEqual(replacement.application.version, first.application.version);
for (const name of [
  'customer-page',
  'reviewer-page',
  'cancelled-page',
  'stale-consent-page',
  'disabled-page',
]) {
  const { raw, meta } = await read(name),
    appId = /\/applications\/([a-f0-9]{32})\/documents/.exec(meta.path)?.[1];
  assert.ok(appId);
  const r = readCreditDocuments(raw, appId, meta.path.startsWith('/api/admin/'));
  if (name === 'customer-page') {
    assert.equal(r.items.length, 2);
    assert.equal(r.canUpload, true);
  }
  if (name === 'reviewer-page') assert.equal(r.canUpload, false);
  if (name === 'cancelled-page') {
    assert.equal(r.application.state, 'Cancelled');
    assert.equal(r.canUpload, false);
  }
  if (name === 'stale-consent-page') {
    assert.equal(r.canUpload, false);
    assert.ok(r.blockers.includes('credit_current_consent_required'));
  }
  if (name === 'disabled-page') {
    assert.equal(r.configured, false);
    assert.equal(r.canUpload, false);
  }
}
const report = {
  passed: true,
  responses: evidence.length,
  actualSqlHttpBodies: true,
  rawBodiesUnmodified: true,
  strictProductionDecoders: true,
  exactLargeRialString: true,
  consentRevisionDefinitionAndExplicitReplacementBound: true,
  historicalReceiptAfterCancellation: true,
  privateFileStoreAndScannerAreTestCaptures: true,
  actualS3AndAntivirusAccepted: false,
  submissionEnabled: false,
  mainPromoted: false,
  evidence,
};
await writeFile(`${dir}/acceptance.json`, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ passed: true, responses: evidence.length }));
