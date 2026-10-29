import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  upfrontPageSchema,
  upfrontCustomerSchema,
  upfrontHistorySchema,
  upfrontResultSchema,
  upfrontCommandSchema,
  readUpfrontResult,
  type UpfrontCommand,
} from '../apps/storefront/lib/credit-upfront-contract.ts';
import {
  clearancePageSchema,
  clearanceCustomerSchema,
  clearanceHistorySchema,
  clearanceResultSchema,
  clearanceCommandSchema,
  readClearanceResult,
  type ClearanceCommand,
  type ClearancePage,
} from '../apps/storefront/lib/credit-clearance-contract.ts';
const dir = process.argv[2];
assert.ok(dir && path.isAbsolute(dir));
const files = (await readdir(dir)).filter(
    (f) => /^[a-f0-9]{32}\.json$/.test(f) || /^\d+\.response\.json$/.test(f),
  ),
  counts: Record<string, number> = {},
  records = [],
  samples = [],
  commands = new Map<string, UpfrontCommand>();
const clearancePages = new Map<string, ClearancePage>(),
  clearanceCommands = new Map<string, ClearanceCommand>();
let clearancePostBindings = 0,
  clearanceReceiptBindings = 0;
let positive = 0,
  zero = 0,
  revoked = 0,
  committed = 0,
  postBindings = 0,
  receiptBindings = 0;
for (const file of files) {
  const bytes = await readFile(path.join(dir, file)),
    meta = JSON.parse(
      await readFile(
        path.join(
          dir,
          file.endsWith('.response.json')
            ? file.replace('.response.json', '.meta.json')
            : file.replace('.json', '.meta.json'),
        ),
        'utf8',
      ),
    );
  assert.equal(meta.actualSqlHttpResponse, true);
  assert.equal(meta.syntheticQaOnly, true);
  if (meta.status !== 200) {
    records.push({ file, kind: 'rejected', status: meta.status });
    continue;
  }
  const raw = JSON.parse(bytes.toString()),
    u = new URL(meta.path, 'http://qa.invalid'),
    parts = u.pathname.split('/');
  let kind: string;
  if (/\/clearance(?:\/|$)/.test(u.pathname)) {
    if (u.pathname.includes('/commands/')) {
      const v = clearanceResultSchema.parse(raw);
      assert.equal(v.commandId, parts.at(-1));
      assert.equal(v.orderId, parts[6]);
      kind = meta.method === 'POST' ? 'clearanceCommand' : 'clearanceReceipt';
    } else if (u.pathname.endsWith('/history')) {
      clearanceHistorySchema.parse(raw);
      kind = 'clearanceHistory';
    } else if (u.pathname.startsWith('/api/admin/')) {
      const v = clearancePageSchema.parse(raw);
      assert.equal(v.orderId, parts[6]);
      clearancePages.set(parts[5] + ':' + parts[6] + ':' + v.previewFingerprint, v);
      kind = 'clearancePage';
    } else {
      clearanceCustomerSchema.parse(raw);
      kind = 'clearanceCustomer';
    }
  } else if (u.pathname.startsWith('/api/credit/')) {
    const v = upfrontCustomerSchema.parse(raw);
    assert.equal(v.orderId, parts[4]);
    kind = 'customer';
  } else if (u.pathname.includes('/commands/')) {
    const v = upfrontResultSchema.parse(raw);
    assert.equal(v.orderId, parts[6]);
    assert.equal(v.commandId, parts.at(-1));
    if (v.event.summary.state === 'ReceiptConfirmed') positive++;
    if (v.event.summary.state === 'NoUpfrontDue') zero++;
    if (v.event.summary.state === 'Revoked') revoked++;
    if (v.event.acknowledgedCommittedOrder) committed++;
    kind = meta.method === 'POST' ? 'command' : 'receipt';
  } else if (u.pathname.endsWith('/history')) {
    const v = upfrontHistorySchema.parse(raw);
    assert.equal(v.orderId, parts[6]);
    kind = 'history';
  } else {
    const v = upfrontPageSchema.parse(raw);
    assert.equal(v.orderId, parts[6]);
    kind = 'page';
  }
  counts[kind] = (counts[kind] ?? 0) + 1;
  records.push({ file, kind, sha256: createHash('sha256').update(bytes).digest('hex') });
  samples.push({ raw, meta, parts, kind });
}
for (const s of samples) {
  if (s.kind !== 'command') continue;
  assert.ok(s.meta.requestBody, 'Actual posted body is required');
  const r = upfrontResultSchema.parse(s.raw),
    c = upfrontCommandSchema.parse({
      id: r.commandId,
      ownerId: s.parts[5],
      orderId: r.orderId,
      body: s.meta.requestBody,
    });
  readUpfrontResult(r, c);
  commands.set(c.id, c);
  postBindings++;
}
for (const s of samples) {
  if (s.kind !== 'receipt') continue;
  const r = upfrontResultSchema.parse(s.raw),
    c = commands.get(r.commandId);
  assert.ok(c, 'Receipt must bind to its original captured POST/replay');
  readUpfrontResult(r, c);
  receiptBindings++;
}
for (const s of samples) {
  if (s.kind !== 'clearanceCommand') continue;
  assert.ok(s.meta.requestBody);
  const r = clearanceResultSchema.parse(s.raw),
    preview = clearancePages.get(
      s.parts[5] + ':' + s.parts[6] + ':' + s.meta.requestBody.previewFingerprint,
    );
  assert.ok(preview, 'Actual reviewed clearance page required');
  const c = clearanceCommandSchema.parse({
    id: r.commandId,
    ownerId: s.parts[5],
    orderId: r.orderId,
    body: s.meta.requestBody,
    previewSnapshot: preview,
  });
  readClearanceResult(r, c);
  clearanceCommands.set(c.id, c);
  clearancePostBindings++;
}
for (const s of samples) {
  if (s.kind !== 'clearanceReceipt') continue;
  const r = clearanceResultSchema.parse(s.raw),
    c = clearanceCommands.get(r.commandId);
  assert.ok(c);
  readClearanceResult(r, c);
  clearanceReceiptBindings++;
}
assert.ok(
  counts.page > 0 &&
    counts.command > 0 &&
    counts.receipt > 0 &&
    postBindings > 0 &&
    receiptBindings > 0 &&
    positive > 0 &&
    revoked > 0 &&
    committed > 0,
);
const result = {
  passed: true,
  syntheticQaOnly: true,
  actualSqlHttpOnly: true,
  responses: records.length,
  counts,
  positiveManualConfirmations: positive,
  explicitZeroNoFundsDue: zero,
  revokedConfirmations: revoked,
  committedAcknowledgements: committed,
  clearanceCommandsBoundToActualBodyAndPreview: clearancePostBindings,
  clearanceReceiptBindings,
  commandsBoundToActualPostedBody: postBindings,
  receiptsBoundToOriginalCommand: receiptBindings,
  records,
};
await writeFile(path.join(dir, 'acceptance.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, records: undefined }));
