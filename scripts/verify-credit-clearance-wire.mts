import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  clearancePageSchema,
  clearanceCustomerSchema,
  clearanceHistorySchema,
  clearanceResultSchema,
} from '../apps/storefront/lib/credit-clearance-contract.ts';
const dir = process.argv[2];
assert.ok(dir && path.isAbsolute(dir));
const files = (await readdir(dir)).filter((f) => /^[a-f0-9]{32}\.json$/.test(f)),
  counts: Record<string, number> = {},
  records = [];
let replays = 0,
  initial = 0,
  refreshes = 0,
  revokes = 0,
  stale = 0,
  effective = 0;
for (const file of files) {
  const raw = await readFile(path.join(dir, file)),
    meta = JSON.parse(await readFile(path.join(dir, file.replace('.json', '.meta.json')), 'utf8')),
    u = new URL(meta.path, 'http://qa.invalid'),
    data = JSON.parse(raw.toString());
  assert.equal(meta.actualSqlHttpResponse, true);
  assert.equal(meta.syntheticQaOnly, true);
  assert.equal(meta.status, 200);
  let kind;
  if (u.pathname.includes('/commands/')) {
    const r = clearanceResultSchema.parse(data);
    assert.equal(r.commandId, u.pathname.split('/').at(-1));
    kind = meta.method === 'POST' ? 'command' : 'receipt';
    if (r.replayed) replays++;
    if (r.initialCommit) initial++;
    else if (r.event.summary.action === 'Approve') refreshes++;
    if (r.event.summary.action === 'Revoke') revokes++;
  } else if (u.pathname.endsWith('/history')) {
    clearanceHistorySchema.parse(data);
    kind = 'history';
  } else if (u.pathname.startsWith('/api/admin/')) {
    const p = clearancePageSchema.parse(data);
    kind = 'page';
    if (p.effective) effective++;
    if (p.current && !p.effective) stale++;
  } else {
    clearanceCustomerSchema.parse(data);
    kind = 'customer';
  }
  counts[kind] = (counts[kind] ?? 0) + 1;
  records.push({ file, kind, sha256: createHash('sha256').update(raw).digest('hex') });
}
for (const kind of ['page', 'command', 'receipt', 'history', 'customer'])
  assert.ok(counts[kind] > 0, kind);
assert.ok(replays > 0 && initial > 0 && refreshes > 0 && revokes > 0 && stale > 0 && effective > 0);
const result = {
  passed: true,
  actualSqlHttpOnly: true,
  syntheticQaOnly: true,
  responses: records.length,
  counts,
  replays,
  initialCommitReceipts: initial,
  refreshReceipts: refreshes,
  revocations: revokes,
  effectivePages: effective,
  staleOrRevokedPages: stale,
  records,
};
await writeFile(path.join(dir, 'acceptance.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, records: undefined }));
