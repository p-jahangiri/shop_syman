import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  chequeLedgerPageSchema,
  chequeDetailSchema,
  chequeHistorySchema,
  chequeResultSchema,
  type ChequeSummary,
  type ChequeEvent,
  type ChequeResult,
} from '@sayman/web-shared/lib/credit/cheque-ledger-contract.ts';
const directory = process.argv[2];
assert.ok(directory);
const facts = new Map<string, string>(),
  events = new Map<string, string>(),
  results: ChequeResult[] = [],
  evidence = [];
let pages = 0,
  details = 0,
  histories = 0,
  paged = 0,
  customerPages = 0;
function cheque(c: ChequeSummary) {
  const value = JSON.stringify({
      id: c.id,
      internalReference: c.internalReference,
      orderId: c.orderId,
      scheduleId: c.scheduleId,
      sequence: c.sequence,
      dueDate: c.dueDate,
      amountRial: c.amountRial,
    }),
    old = facts.get(c.id);
  if (old) assert.equal(value, old, 'registered cheque financial facts stay immutable');
  else facts.set(c.id, value);
  assert.equal(c.bankVerified, false);
}
function event(e: ChequeEvent) {
  const value = JSON.stringify(e),
    old = events.get(e.id);
  if (old) assert.equal(value, old, 'event history and encrypted receipt remain identical');
  else events.set(e.id, value);
  assert.equal(e.bankVerified, false);
  assert.match(e.note, /^Synthetic /);
}
for (const file of (await readdir(directory)).filter((x) => x.endsWith('.meta.json')).sort()) {
  const meta = JSON.parse(await readFile(directory + '/' + file, 'utf8')),
    name = file.replace('.meta.json', '.json'),
    bytes = await readFile(directory + '/' + name),
    raw = JSON.parse(bytes.toString('utf8')),
    path = meta.path.split('?')[0];
  assert.equal(meta.syntheticQaOnly, true);
  assert.equal(meta.actualSqlHttpResponse, true);
  assert.equal(meta.status, 200);
  assert.match(meta.cacheControl, /no-store/);
  assert.doesNotMatch(
    bytes.toString('utf8'),
    /"(?:accessToken|refreshToken|password|protectedResult|protectedRegistration|protectedEvent|actorId|ownerId|contactPhone|contactName|delivery)"\s*:/i,
  );
  if (path.includes('/commands/')) {
    const result = chequeResultSchema.parse(raw);
    assert.equal(result.commandId, path.split('/').at(-1));
    cheque(result.cheque);
    event(result.event);
    results.push(result);
  } else if (path.endsWith('/history')) {
    const page = chequeHistorySchema.parse(raw);
    assert.equal(page.chequeId, path.split('/').at(-2));
    page.items.forEach(event);
    histories++;
    if (page.nextSequence !== null) paged++;
  } else if (path.endsWith('/cheques')) {
    const page = chequeLedgerPageSchema.parse(raw);
    assert.equal(page.orderId, path.split('/').at(-2));
    page.items.forEach(cheque);
    pages++;
    if (path.startsWith('/api/credit/')) {
      customerPages++;
      assert.equal(page.canReceive, false);
      assert.doesNotMatch(bytes.toString('utf8'), /"(?:instrumentReference|receiptNote|note)"\s*:/);
    }
  } else {
    const detail = chequeDetailSchema.parse(raw);
    assert.equal(detail.cheque.id, path.split('/').at(-1));
    assert.equal(detail.instrumentReference, 'SYNTHETIC-INSTRUMENT-ONLY');
    cheque(detail.cheque);
    event(detail.current);
    details++;
  }
  evidence.push({
    file: name,
    path: meta.path,
    method: meta.method,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}
for (const r of results.filter((x) => x.replayed)) {
  const created = results.find((x) => !x.replayed && x.commandId === r.commandId);
  assert.ok(created);
  assert.deepEqual(r.cheque, created.cheque);
  assert.deepEqual(r.event, created.event);
}
const created = results.filter((x) => !x.replayed).length,
  replayed = results.filter((x) => x.replayed).length;
assert.ok(
  created >= 30 &&
    replayed >= 2 &&
    pages >= 3 &&
    details >= 2 &&
    histories >= 2 &&
    paged >= 1 &&
    customerPages >= 2 &&
    facts.size >= 6,
  JSON.stringify({
    created,
    replayed,
    pages,
    details,
    histories,
    paged,
    customerPages,
    cheques: facts.size,
  }),
);
assert.ok(results.some((x) => x.event.action === 'ReportCollection'));
assert.ok(results.some((x) => x.event.action === 'CorrectCollectionReport'));
assert.ok(results.some((x) => x.event.action === 'ReturnToCustomer'));
const report = {
  passed: true,
  responses: evidence.length,
  created,
  replayed,
  pages,
  customerPages,
  details,
  histories,
  pagedHistories: paged,
  uniqueCheques: facts.size,
  uniqueEvents: events.size,
  actualSqlHttpBodies: true,
  strictProductionDecoders: true,
  exactRialStrings: true,
  immutableFinancialFactsAndHistoricalEvents: true,
  customerNeverGetsInstrumentReferenceOrPrivateNote: true,
  bankVerified: false,
  canPay: false,
  canFulfill: false,
  syntheticQaOnly: true,
  evidence,
};
await writeFile(directory + '/acceptance.json', JSON.stringify(report, null, 2) + '\n', {
  flag: 'wx',
});
console.log(JSON.stringify({ ...report, evidence: undefined }));
