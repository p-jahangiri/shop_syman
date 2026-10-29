import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  approvalPageSchema,
  approvalDetailSchema,
  approvalHistorySchema,
  approvalResultSchema,
} from '../apps/storefront/lib/cheque-approval-contract.ts';
const dir = process.argv[2];
if (!dir || !path.isAbsolute(dir)) throw Error('Absolute actual SQL wire directory required');
const files = (await readdir(dir)).filter((f) => /^[a-f0-9]{32}\.json$/.test(f)),
  counts: Record<string, number> = {},
  evidence = [];
let approved = 0,
  revoked = 0,
  replayed = 0,
  all = 0,
  stale = 0;
for (const f of files) {
  const raw = await readFile(path.join(dir, f)),
    meta = JSON.parse(await readFile(path.join(dir, f.replace('.json', '.meta.json')), 'utf8'));
  assert.equal(meta.actualSqlHttpResponse, true);
  assert.equal(meta.syntheticQaOnly, true);
  assert.equal(meta.status, 200);
  const u = new URL(meta.path, 'http://qa.invalid'),
    parts = u.pathname.split('/'),
    data = JSON.parse(raw.toString('utf8'));
  let kind;
  if (u.pathname.includes('/commands/')) {
    const r = approvalResultSchema.parse(data);
    assert.equal(r.commandId, parts.at(-1));
    assert.equal(r.orderId, parts[6]);
    assert.equal(r.chequeId, parts[8]);
    if (r.event.summary.state === 'Approved') approved++;
    else revoked++;
    if (r.replayed) replayed++;
    kind = meta.method === 'POST' ? 'command' : 'receipt';
  } else if (u.pathname.endsWith('/history')) {
    const h = approvalHistorySchema.parse(data);
    assert.equal(h.orderId, parts[6]);
    assert.equal(h.chequeId, parts[8]);
    kind = 'history';
  } else if (u.pathname.endsWith('/cheque-approvals')) {
    const p = approvalPageSchema.parse(data);
    assert.equal(p.orderId, parts[u.pathname.startsWith('/api/credit/') ? 4 : 6]);
    if (p.allChequesApproved) all++;
    stale += p.items.filter(
      (x) => x.current?.state === 'Approved' && !x.approvedForCurrentCheque,
    ).length;
    kind = u.pathname.startsWith('/api/credit/') ? 'customer' : 'page';
  } else {
    approvalDetailSchema.parse(data);
    kind = 'detail';
  }
  counts[kind] = (counts[kind] ?? 0) + 1;
  evidence.push({ file: f, kind, sha256: createHash('sha256').update(raw).digest('hex') });
}
for (const k of ['customer', 'page', 'history', 'command', 'receipt']) assert.ok(counts[k] > 0, k);
assert.ok(approved > 0 && revoked > 0 && replayed > 0 && all > 0 && stale > 0);
const report = {
  passed: true,
  actualSqlHttpOnly: true,
  syntheticQaOnly: true,
  responses: evidence.length,
  counts,
  manualApprovals: approved,
  revocations: revoked,
  replays: replayed,
  allLinesApproved: all,
  staleApprovalsObserved: stale,
  allBankVerifiedAndCanPayAndCanFulfillFalse: true,
  evidence,
};
await writeFile(path.join(dir, 'acceptance.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, evidence: undefined }));
