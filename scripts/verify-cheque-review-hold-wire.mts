import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  reviewHoldCurrentSchema,
  reviewHoldResultSchema,
  reviewHoldHistorySchema,
} from '../apps/storefront/lib/cheque-review-hold-contract.ts';
import {
  creditOrderResultSchema,
  creditOrderDetailSchema,
  creditOrderReadinessSchema,
} from '../apps/storefront/lib/credit-order-contract.ts';
import { orderDetailV2Schema } from '../apps/storefront/lib/order-v2-contract.ts';
const dir = process.argv[2];
if (!dir || !path.isAbsolute(dir)) throw Error('Absolute actual SQL wire directory required');
const files = (await readdir(dir)).filter((f) => /^[a-f0-9]{32}\.json$/.test(f)),
  counts: Record<string, number> = {},
  records = [];
let active = 0,
  disabled = 0,
  replays = 0,
  legacy = 0,
  review = 0;
for (const f of files) {
  const raw = await readFile(path.join(dir, f)),
    meta = JSON.parse(await readFile(path.join(dir, f.replace('.json', '.meta.json')), 'utf8'));
  assert.equal(meta.status, 200);
  assert.equal(meta.actualSqlHttpResponse, true);
  assert.equal(meta.syntheticQaOnly, true);
  const u = new URL(meta.path, 'http://qa.invalid'),
    data = JSON.parse(raw.toString());
  let kind;
  if (u.pathname.startsWith('/api/admin/credit/review-hold-policy')) {
    if (u.pathname.includes('/commands/')) {
      const r = reviewHoldResultSchema.parse(data);
      assert.equal(r.commandId, u.pathname.split('/').at(-1));
      if (r.policy.current?.enabled) active++;
      else disabled++;
      if (r.replayed) replays++;
      kind = meta.method === 'POST' ? 'policy-command' : 'policy-receipt';
    } else if (u.pathname.endsWith('/history')) {
      reviewHoldHistorySchema.parse(data);
      kind = 'policy-history';
    } else {
      reviewHoldCurrentSchema.parse(data);
      kind = 'policy-current';
    }
  } else if (u.pathname.startsWith('/api/credit-orders/commands/')) {
    const r = creditOrderResultSchema.parse(data);
    assert.equal(r.commandId, u.pathname.split('/').at(-1));
    if (r.reviewHold) review++;
    else legacy++;
    kind = 'order-command';
  } else if (u.pathname.endsWith('/readiness')) {
    creditOrderReadinessSchema.parse(data);
    kind = 'readiness';
  } else if (u.pathname.startsWith('/api/credit-orders/')) {
    creditOrderDetailSchema.parse(data);
    kind = 'order-detail';
  } else if (u.pathname.startsWith('/api/orders/v2/') && u.pathname.endsWith('/cancel')) {
    orderDetailV2Schema.parse(data);
    kind = 'order-cancel';
  } else throw Error('Unexpected wire path');
  counts[kind] = (counts[kind] ?? 0) + 1;
  records.push({ file: f, kind, sha256: createHash('sha256').update(raw).digest('hex') });
}
for (const k of [
  'policy-current',
  'policy-command',
  'policy-receipt',
  'policy-history',
  'order-command',
  'readiness',
  'order-detail',
  'order-cancel',
])
  assert.ok(counts[k] > 0, k);
assert.ok(active > 0 && disabled > 0 && replays > 0 && legacy > 0 && review > 0);
const report = {
  passed: true,
  syntheticQaOnly: true,
  actualSqlHttpOnly: true,
  responses: records.length,
  counts,
  activePolicyReceipts: active,
  disabledPolicyReceipts: disabled,
  replays,
  legacyOrderReceipts: legacy,
  reviewHoldOrderReceipts: review,
  records,
};
await writeFile(path.join(dir, 'acceptance.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, records: undefined }));
