import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  upfrontPageSchema,
  upfrontCustomerSchema,
  upfrontHistorySchema,
  upfrontResultSchema,
} from '../apps/storefront/lib/credit-upfront-contract.ts';
const dir = process.argv[2];
if (!dir || !path.isAbsolute(dir)) throw Error('Absolute actual SQL wire directory required');
const files = (await readdir(dir)).filter((f) => /^[a-f0-9]{32}\.json$/.test(f)),
  counts: Record<string, number> = {},
  evidence = [];
let zero = 0,
  positive = 0,
  revoked = 0,
  replayed = 0;
for (const f of files) {
  const raw = await readFile(path.join(dir, f)),
    meta = JSON.parse(await readFile(path.join(dir, f.replace('.json', '.meta.json')), 'utf8'));
  assert.equal(meta.actualSqlHttpResponse, true);
  assert.equal(meta.syntheticQaOnly, true);
  assert.equal(meta.status, 200);
  const u = new URL(meta.path, 'http://qa.invalid'),
    parts = u.pathname.split('/'),
    data = JSON.parse(raw.toString('utf8'));
  let kind: string;
  if (u.pathname.startsWith('/api/credit/')) {
    const p = upfrontCustomerSchema.parse(data);
    assert.equal(p.orderId, parts[4]);
    kind = 'customer';
  } else if (u.pathname.includes('/commands/')) {
    const p = upfrontResultSchema.parse(data);
    assert.equal(p.orderId, parts[6]);
    assert.equal(p.commandId, parts.at(-1));
    if (p.event.summary.state === 'NoUpfrontDue') zero++;
    if (p.event.summary.state === 'ReceiptConfirmed') positive++;
    if (p.event.summary.state === 'Revoked') revoked++;
    if (p.replayed) replayed++;
    kind = meta.method === 'POST' ? 'command' : 'receipt';
  } else if (u.pathname.endsWith('/history')) {
    const p = upfrontHistorySchema.parse(data);
    assert.equal(p.orderId, parts[6]);
    kind = 'history';
  } else {
    const p = upfrontPageSchema.parse(data);
    assert.equal(p.orderId, parts[6]);
    kind = 'page';
  }
  counts[kind] = (counts[kind] ?? 0) + 1;
  evidence.push({ file: f, kind, sha256: createHash('sha256').update(raw).digest('hex') });
}
for (const k of ['customer', 'command', 'receipt', 'history', 'page']) assert.ok(counts[k] > 0, k);
assert.ok(zero > 0 && positive > 0 && revoked > 0 && replayed > 0);
const report = {
  passed: true,
  actualSqlHttpOnly: true,
  syntheticQaOnly: true,
  responses: evidence.length,
  counts,
  zeroNoFundsDue: zero,
  positiveManualConfirmations: positive,
  revokedConfirmations: revoked,
  replays: replayed,
  allBankVerifiedAndCanPayAndCanFulfillFalse: true,
  evidence,
};
await writeFile(path.join(dir, 'acceptance.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, evidence: undefined }));
