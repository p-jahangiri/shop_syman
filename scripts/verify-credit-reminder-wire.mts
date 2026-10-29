import {
  creditReminderPolicyCurrentSchema,
  creditReminderPolicyHistorySchema,
  creditReminderPolicyResultSchema,
  readCreditReminderPolicyResult,
  type CreditReminderPolicyCommand,
} from '../apps/storefront/lib/credit-reminder-policy-contract.ts';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  creditReminderPageSchema,
  creditReminderHistorySchema,
  creditReminderResultSchema,
  readCreditReminderResult,
  type CreditReminderPage,
} from '../apps/storefront/lib/credit-reminder-contract.ts';
import {
  readCreditInbox,
  readCreditInboxAcknowledgement,
} from '../apps/storefront/lib/credit-inbox-contract.ts';
import { notificationCountSchema } from '../apps/storefront/lib/notification-contract.ts';
const dir = process.argv[2];
assert.ok(dir && path.isAbsolute(dir));
const files = (await readdir(dir)).filter(
  (f) => /^[a-f0-9]{32}\.json$/.test(f) || /^[0-9]+\.response\.json$/.test(f),
);
const records = [];
const samples = [];
const counts: Record<string, number> = {};
const pages: CreditReminderPage[] = [];
let requestBindings = 0,
  policyBindings = 0;
const policyRevisions = new Map<
    string,
    NonNullable<ReturnType<typeof creditReminderPolicyCurrentSchema.parse>['current']>
  >(),
  policyCommands = new Map<string, CreditReminderPolicyCommand>();
for (const file of files) {
  const bytes = await readFile(path.join(dir, file)),
    metaFile = file.endsWith('.response.json')
      ? file.replace('.response.json', '.meta.json')
      : file.replace('.json', '.meta.json'),
    meta = JSON.parse(await readFile(path.join(dir, metaFile), 'utf8'));
  assert.equal(meta.actualSqlHttpResponse, true);
  assert.equal(meta.syntheticQaOnly, true);
  assert.equal(meta.status, 200);
  const u = new URL(meta.path, 'http://qa.invalid'),
    raw = JSON.parse(bytes.toString());
  let kind: string;
  if (u.pathname.startsWith('/api/admin/credit/reminder-policy')) {
    const tail = u.pathname.slice('/api/admin/credit/reminder-policy'.length);
    if (tail.startsWith('/commands/')) {
      const r = creditReminderPolicyResultSchema.parse(raw);
      assert.equal(r.commandId, u.pathname.split('/').at(-1));
      policyRevisions.set(r.policy.current!.version, r.policy.current!);
      kind = meta.method === 'POST' ? 'policyCommand' : 'policyReceipt';
    } else if (tail === '/history') {
      const h = creditReminderPolicyHistorySchema.parse(raw);
      for (const r of h.items) policyRevisions.set(r.version, r);
      kind = 'policyHistory';
    } else {
      assert.equal(tail, '');
      const p = creditReminderPolicyCurrentSchema.parse(raw);
      if (p.current) policyRevisions.set(p.current.version, p.current);
      kind = 'policyPage';
    }
  } else if (u.pathname.startsWith('/api/admin/credit/')) {
    const matched =
      /^\/api\/admin\/credit\/orders\/([A-Za-z0-9_-]{1,64})\/([a-f0-9]{32})\/cheques\/([a-f0-9]{32})\/reminders(.*)$/.exec(
        u.pathname,
      );
    assert.ok(matched);
    if (matched[4].startsWith('/commands/')) {
      const r = creditReminderResultSchema.parse(raw);
      assert.equal(r.commandId, u.pathname.split('/').at(-1));
      assert.equal(r.event.summary.orderId, matched[2]);
      assert.equal(r.event.summary.chequeId, matched[3]);
      kind = meta.method === 'POST' ? 'command' : 'receipt';
    } else if (matched[4] === '/history') {
      const h = creditReminderHistorySchema.parse(raw);
      assert.equal(h.orderId, matched[2]);
      assert.equal(h.chequeId, matched[3]);
      kind = 'history';
    } else {
      assert.equal(matched[4], '');
      const p = creditReminderPageSchema.parse(raw);
      assert.equal(p.orderId, matched[2]);
      assert.equal(p.cheque.id, matched[3]);
      pages.push(p);
      kind = 'page';
    }
  } else {
    assert.ok(u.pathname.startsWith('/api/notifications/credit-reminders'));
    assert.ok(
      !/SYNTHETIC-PRIVATE|instrumentReference|receiptNote|previewFingerprint|orderVersion|actorId|protectedPayload/.test(
        bytes.toString(),
      ),
    );
    if (u.pathname.endsWith('/unread-count')) {
      notificationCountSchema.parse(raw);
      kind = 'count';
    } else if (meta.method === 'PUT') {
      readCreditInboxAcknowledgement(raw, u.pathname.split('/').at(-2)!);
      kind = 'ack';
    } else {
      readCreditInbox(
        raw,
        u.searchParams.get('unreadOnly') === 'true',
        u.searchParams.get('cursor'),
      );
      kind = 'inbox';
    }
  }
  counts[kind] = (counts[kind] ?? 0) + 1;
  records.push({ file, kind, sha256: createHash('sha256').update(bytes).digest('hex') });
  samples.push({ meta, url: u, raw, kind });
}
for (const sample of samples) {
  if (sample.kind !== 'command') continue;
  const r = creditReminderResultSchema.parse(sample.raw),
    s = r.event.summary,
    p = pages.find(
      (p) =>
        p.canSend &&
        p.orderId === s.orderId &&
        p.cheque.id === s.chequeId &&
        p.previewFingerprint === s.previewFingerprint &&
        p.orderVersion === s.orderVersion &&
        p.nextSequence === s.sequence,
    );
  assert.ok(p, 'A real preceding preview is required');
  const m = /\/orders\/([^/]+)\//.exec(sample.url.pathname)!;
  const body = sample.meta.requestBody ?? sample.meta.originalRequestBody;
  if (body) {
    readCreditReminderResult(r, {
      id: r.commandId,
      ownerId: m[1],
      orderId: s.orderId,
      chequeId: s.chequeId,
      body,
      previewSnapshot: p,
    });
    requestBindings++;
  } else {
    assert.equal(s.amountRial, p.cheque.amountRial);
    assert.equal(s.dueDate, p.cheque.dueDate);
    assert.equal(s.ledgerVersion, p.cheque.version);
    assert.equal(s.civilDay, p.today);
  }
}
for (const sample of samples) {
  if (sample.kind !== 'policyCommand') continue;
  const r = creditReminderPolicyResultSchema.parse(sample.raw),
    body = sample.meta.requestBody ?? sample.meta.originalRequestBody;
  assert.ok(body, 'Policy POST must retain the actual posted review');
  const previous = body.version === null ? null : policyRevisions.get(body.version);
  assert.notEqual(previous, undefined, 'Previous exact policy revision must be captured');
  const command = { id: r.commandId, body, previous: { ...r.policy, current: previous ?? null } };
  readCreditReminderPolicyResult(r, command);
  policyCommands.set(r.commandId, command);
  policyBindings++;
}
for (const sample of samples) {
  if (sample.kind !== 'policyReceipt') continue;
  const r = creditReminderPolicyResultSchema.parse(sample.raw),
    command = policyCommands.get(r.commandId);
  assert.ok(command, 'Recovered receipt needs its actual original POST');
  readCreditReminderPolicyResult(r, command);
}
if (counts.page)
  for (const kind of ['page', 'command', 'receipt', 'inbox', 'count', 'ack'])
    assert.ok(counts[kind] > 0, kind);
if (counts.policyPage) assert.ok(counts.policyCommand > 0, 'policy commands');
assert.ok(records.length > 0);
const result = {
  passed: true,
  syntheticQaOnly: true,
  actualSqlHttpOnly: true,
  responses: records.length,
  counts,
  commandsBoundToActualPostedBodyAndPreview: requestBindings,
  policyCommandsBoundToActualPostedBodyAndPreviousRevision: policyBindings,
  records,
};
await writeFile(path.join(dir, 'acceptance.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, records: undefined }));
