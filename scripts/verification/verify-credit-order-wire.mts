import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  creditOrderResultSchema,
  creditOrderDetailSchema,
  creditOrderReadinessSchema,
  creditQuoteHistorySchema,
  bindCreditOrderQuote,
} from '@sayman/web-shared/lib/credit/credit-order-contract.ts';
import {
  creditCheckoutQuoteResultSchema,
  creditCheckoutQuoteSchema,
} from '@sayman/web-shared/lib/credit/credit-checkout-quote-contract.ts';
import { creditPurchaseScopePageSchema } from '@sayman/web-shared/lib/credit/credit-purchase-scope-contract.ts';
const dir = process.argv[2];
assert.ok(dir);
const rows = [],
  quotes = new Map(),
  orders = [];
let ordinary = 0,
  accepted = 0,
  created = 0,
  replayed = 0,
  details = 0,
  readiness = 0,
  history = 0,
  usedScopes = 0;
for (const file of (await readdir(dir)).filter((f) => f.endsWith('.meta.json')).sort()) {
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
    /"(?:password|accessToken|refreshToken|protectedResult|storageKey|authenticatorKey)"\s*:/i,
  );
  if (path.startsWith('/api/credit-orders/commands/')) {
    const r = creditOrderResultSchema.parse(raw);
    assert.equal(r.commandId, path.split('/').at(-1));
    assert.equal(r.order.canPay, false);
    orders.push(r);
    if (r.order.originalSnapshotVersion === 1) ordinary++;
    else accepted++;
    if (r.replayed) replayed++;
    else created++;
  } else if (path === '/api/credit-orders/quotes') {
    creditQuoteHistorySchema.parse(raw);
    history++;
  } else if (path.endsWith('/readiness')) {
    const r = creditOrderReadinessSchema.parse(raw);
    assert.equal(r.creditQuoteId, path.split('/').at(-2));
    readiness++;
  } else if (
    path.startsWith('/api/credit-orders/') ||
    path.startsWith('/api/admin/credit-orders/')
  ) {
    const r = creditOrderDetailSchema.parse(raw);
    assert.equal(r.order.summary.id, path.split('/').at(-1));
    quotes.set(r.calculation.id, r.calculation);
    details++;
  } else if (path.endsWith('/purchase-scope')) {
    const r = creditPurchaseScopePageSchema.parse(raw);
    if (r.scope?.state === 'Used') usedScopes++;
  } else if (path.includes('/credit-quote')) {
    const q = path.includes('/credit-quotes/')
      ? creditCheckoutQuoteSchema.parse(raw)
      : creditCheckoutQuoteResultSchema.parse(raw).quote;
    quotes.set(q.id, q);
  } else throw Error('Unexpected wire path ' + path);
  rows.push({
    file: name,
    path: meta.path,
    method: meta.method,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}
for (const r of orders) {
  assert.ok(quotes.has(r.credit.creditQuoteId), 'original quote must be captured');
  bindCreditOrderQuote(r, quotes.get(r.credit.creditQuoteId));
}
assert.ok(
  ordinary >= 3 &&
    accepted >= 4 &&
    created >= 3 &&
    replayed >= 3 &&
    details >= 3 &&
    readiness >= 2 &&
    history >= 2 &&
    usedScopes >= 1,
);
const summary = {
  passed: true,
  responses: rows.length,
  ordinary,
  accepted,
  created,
  replayed,
  details,
  readiness,
  history,
  usedScopes,
  strictProductionDecoders: true,
  actualSqlHttpBodies: true,
  rawBodiesUnmodified: true,
  exactOriginalQuoteBinding: true,
  exactMoneyStrings: true,
  canPay: false,
  syntheticQaOnly: true,
  evidence: rows,
};
await writeFile(dir + '/acceptance.json', JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ...summary, evidence: undefined }));
