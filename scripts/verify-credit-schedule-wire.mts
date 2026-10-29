import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  creditSchedulePreviewSchema,
  creditScheduleResultSchema,
  creditSchedulePageSchema,
  creditScheduleHistorySchema,
  creditScheduleOrderQueueSchema,
  type CreditSchedulePreview,
  type CreditScheduleResult,
  type CreditScheduleRevision,
} from '../apps/storefront/lib/credit-schedule-contract.ts';
const dir = process.argv[2];
assert.ok(dir);
const previews: CreditSchedulePreview[] = [],
  results: CreditScheduleResult[] = [],
  revisions = new Map<string, string>(),
  evidence = [];
let pages = 0,
  histories = 0,
  queues = 0,
  paged = 0;
function revision(r: CreditScheduleRevision) {
  const value = JSON.stringify(r),
    prior = revisions.get(r.id);
  if (prior)
    assert.equal(value, prior, 'historical revision must remain byte-equivalent after decoding');
  else revisions.set(r.id, value);
  assert.equal(r.state, 'Planned');
  assert.equal(r.canPay, false);
  assert.equal(r.canFulfill, false);
}
for (const file of (await readdir(dir)).filter((x) => x.endsWith('.meta.json')).sort()) {
  const meta = JSON.parse(await readFile(dir + '/' + file, 'utf8')),
    name = file.replace('.meta.json', '.json'),
    bytes = await readFile(dir + '/' + name),
    raw = JSON.parse(bytes.toString('utf8')),
    path = meta.path.split('?')[0];
  assert.equal(meta.actualSqlHttpResponse, true);
  assert.equal(meta.syntheticQaOnly, true);
  assert.equal(meta.status, 200);
  assert.match(meta.cacheControl, /no-store/);
  assert.doesNotMatch(
    bytes.toString('utf8'),
    /"(?:password|accessToken|refreshToken|protectedResult|storageKey|authenticatorKey|contactPhone|contactName|actorId)"\s*:/i,
  );
  if (path === '/api/admin/credit/orders') {
    creditScheduleOrderQueueSchema.parse(raw);
    queues++;
  } else if (path.endsWith('/preview')) {
    const p = creditSchedulePreviewSchema.parse(raw);
    assert.equal(p.orderId, path.split('/').at(-3));
    previews.push(p);
  } else if (path.includes('/commands/')) {
    const r = creditScheduleResultSchema.parse(raw);
    assert.equal(r.commandId, path.split('/').at(-1));
    assert.equal(r.revision.orderId, path.split('/').at(-4));
    if (meta.method === 'GET') assert.equal(r.replayed, true);
    revision(r.revision);
    results.push(r);
  } else if (path.endsWith('/history')) {
    const h = creditScheduleHistorySchema.parse(raw);
    assert.equal(h.orderId, path.split('/').at(-3));
    h.items.forEach(revision);
    histories++;
    if (h.nextRevision !== null) paged++;
  } else {
    const p = creditSchedulePageSchema.parse(raw);
    assert.equal(p.orderId, path.split('/').at(-2));
    if (p.current) revision(p.current);
    if (path.startsWith('/api/credit/')) assert.equal(p.canAmend, false);
    pages++;
  }
  evidence.push({
    file: name,
    path: meta.path,
    method: meta.method,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}
for (const result of results) {
  const r = result.revision;
  assert.ok(
    previews.some(
      (p) =>
        p.orderId === r.orderId &&
        p.creditQuoteId === r.creditQuoteId &&
        p.quoteFingerprint === r.quoteFingerprint &&
        p.planName === r.planName &&
        p.locale === r.locale &&
        JSON.stringify(p.calculation) === JSON.stringify(r.calculation),
    ),
    'receipt must bind an actual server preview',
  );
  if (result.replayed) {
    const created = results.find((x) => !x.replayed && x.commandId === result.commandId);
    assert.ok(created);
    assert.deepEqual(result.revision, created.revision);
  }
}
const created = results.filter((r) => !r.replayed).length,
  replayed = results.filter((r) => r.replayed).length,
  large = results.filter(
    (r) => BigInt(r.revision.calculation.payableTotalRial) > 9007199254740991n,
  ).length;
assert.ok(
  previews.length >= 25 &&
    created >= 25 &&
    replayed >= 4 &&
    large >= 2 &&
    pages >= 3 &&
    histories >= 3 &&
    queues >= 1 &&
    paged >= 1,
);
const report = {
  passed: true,
  responses: evidence.length,
  previews: previews.length,
  created,
  replayed,
  largeRialReceipts: large,
  pages,
  histories,
  queues,
  pagedHistories: paged,
  uniqueRevisions: revisions.size,
  actualSqlHttpBodies: true,
  rawResponsesUnmodified: true,
  strictProductionDecoders: true,
  actualPreviewAndReceiptBinding: true,
  exactRialStrings: true,
  historicalRevisionsStable: true,
  canPay: false,
  canFulfill: false,
  bankCollectionVerified: false,
  syntheticQaOnly: true,
  evidence,
};
await writeFile(dir + '/acceptance.json', JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ...report, evidence: undefined }));
