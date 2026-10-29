import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  creditOrderInputSchema,
  readCreditOrderInputResult,
  creditOrderResultSchema,
  creditOrderDetailSchema,
  creditOrderReadinessSchema,
  creditQuoteHistorySchema,
  bindCreditOrderQuote,
} from '../apps/storefront/lib/credit-order-contract.ts';
import {
  creditCheckoutQuoteInputSchema,
  creditCheckoutQuoteResultSchema,
  creditCheckoutQuoteSchema,
} from '../apps/storefront/lib/credit-checkout-quote-contract.ts';
const dir = process.argv[2];
assert.ok(dir);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex'),
  quotes = new Map(),
  orders = [],
  rows = [];
let posts = 0,
  receipts = 0,
  drops = 0,
  histories = 0,
  readiness = 0,
  details = 0,
  adminDetails = 0;
for (const f of (await readdir(dir))
  .filter((x) => x.endsWith('.meta.json'))
  .sort((a, b) => parseInt(a) - parseInt(b))) {
  const meta = JSON.parse(await readFile(dir + '/' + f, 'utf8')),
    prefix = f.replace('.meta.json', ''),
    bytes = await readFile(dir + '/' + prefix + '.response.json'),
    raw = JSON.parse(bytes.toString('utf8')),
    path = meta.path.split('?')[0];
  assert.equal(meta.actualSqlHttpResponse, true);
  assert.equal(meta.syntheticQaOnly, true);
  assert.equal(meta.status, 200);
  assert.match(meta.cacheControl, /no-store/);
  assert.equal(sha(bytes), meta.responseSha256);
  assert.doesNotMatch(
    bytes.toString('utf8'),
    /"(?:password|accessToken|refreshToken|protectedResult|storageKey|authenticatorKey)"\s*:/i,
  );
  if (path.includes('/credit-quote')) {
    if (meta.method === 'POST') {
      const input = await readFile(dir + '/' + prefix + '.request.json');
      assert.equal(sha(input), meta.requestSha256);
      creditCheckoutQuoteInputSchema.parse(JSON.parse(input.toString('utf8')));
    }
    const q = path.includes('/credit-quotes/')
      ? creditCheckoutQuoteSchema.parse(raw)
      : creditCheckoutQuoteResultSchema.parse(raw).quote;
    assert.ok(q.ordinaryQuote);
    const prior = quotes.get(q.id);
    if (prior) assert.deepEqual(q, prior);
    else quotes.set(q.id, q);
  } else if (path.startsWith('/api/credit-orders/commands/')) {
    const r = creditOrderResultSchema.parse(raw);
    assert.equal(r.commandId, path.split('/').at(-1));
    if (meta.method === 'POST') {
      posts++;
      const bytes = await readFile(dir + '/' + prefix + '.request.json');
      assert.equal(sha(bytes), meta.requestSha256);
      readCreditOrderInputResult(
        raw,
        r.commandId,
        creditOrderInputSchema.parse(JSON.parse(bytes.toString('utf8'))),
      );
      assert.equal(meta.droppedAfterCommittedSuccess, true);
      assert.equal(r.replayed, false);
      drops++;
    } else {
      receipts++;
      assert.equal(r.replayed, true);
    }
    orders.push(r);
  } else if (path === '/api/credit-orders/quotes') {
    const h = creditQuoteHistorySchema.parse(raw);
    assert.equal(h.items.length, 1);
    assert.equal(h.items[0].orderId, 'cfb7e4306e7745f68b826270625d8de6');
    histories++;
  } else if (path.endsWith('/readiness')) {
    creditOrderReadinessSchema.parse(raw);
    readiness++;
  } else {
    const r = creditOrderDetailSchema.parse(raw);
    assert.equal(r.order.summary.id, path.split('/').at(-1));
    assert.ok(['AwaitingPayment', 'Cancelled'].includes(r.order.summary.state));
    if (path.startsWith('/api/admin/')) adminDetails++;
    else details++;
  }
  rows.push({
    file: prefix + '.response.json',
    path: meta.path,
    method: meta.method,
    sha256: meta.responseSha256,
  });
}
assert.equal(posts, 1);
assert.equal(receipts, 1);
assert.equal(drops, 1);
assert.equal(quotes.size, 1);
assert.deepEqual(orders[0].order, orders[1].order);
for (const r of orders) {
  assert.ok(quotes.has(r.credit.creditQuoteId));
  bindCreditOrderQuote(r, quotes.get(r.credit.creditQuoteId));
  assert.equal(r.order.payableTotalRial, '445988345');
  assert.equal(r.credit.limitAmountRial, '9007199254740990');
  assert.equal(r.order.canPay, false);
}
assert.ok(histories >= 3 && readiness >= 1 && details >= 2 && adminDetails >= 2);
const result = {
  passed: true,
  syntheticQaOnly: true,
  responses: rows.length,
  posts,
  receipts,
  drops,
  histories,
  readiness,
  details,
  adminDetails,
  ordinaryBrowserOnly: true,
  acceptedAndMixedSqlOnly: true,
  rawBodiesUnmodified: true,
  strictProductionDecoders: true,
  exactOriginalQuoteBinding: true,
  exactMoneyStrings: true,
  noDuplicatePost: true,
  canPay: false,
  evidence: rows,
};
await writeFile(dir + '/acceptance.json', JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ...result, evidence: undefined }));
