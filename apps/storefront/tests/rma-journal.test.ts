import test from 'node:test';
import assert from 'node:assert/strict';
import { rmaRequest } from '@sayman/web-shared/lib/orders/rma-client.ts';
import { RmaJournal, rmaCommand } from '@sayman/web-shared/lib/orders/rma-journal.ts';
import {
  rmaCreateBody,
  rmaOrderId,
  rmaCommandId,
  rmaResult,
  rmaCaseId,
} from '@sayman/web-shared/testing/rma.test-fixtures.ts';
function storage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}
test('RMA journal stores only opaque actor/route IDs, restores unknown receipt-only and purges private body on success/logout', () => {
  const s = storage(),
    a = new RmaJournal('test', s);
  a.bind('OWNER');
  const command = rmaCommand('create', rmaCreateBody(), { orderId: rmaOrderId }, rmaCommandId);
  a.begin('OWNER', command);
  const saved = s.getItem('test')!;
  assert.ok(saved.includes(rmaCommandId));
  for (const secret of [
    'دلیل',
    'reason',
    'body',
    'policyRevisionId',
    'orderVersion',
    'payloadHash',
  ])
    assert.equal(saved.includes(secret), false, secret);
  assert.equal(a.snapshot('OWNER')!.command.body !== null, true);
  a.interrupt();
  assert.equal(a.snapshot('OWNER')!.state, 'unknown');
  assert.throws(() => a.begin('OWNER', command));
  a.clear('OWNER');
  assert.equal(a.snapshot('OWNER')!.state, 'unknown');
  const b = new RmaJournal('test', s);
  b.bind('OWNER');
  assert.equal(b.snapshot('OWNER')!.state, 'unknown');
  assert.equal(b.snapshot('OWNER')!.command.body, null);
  assert.equal(b.finish('OTHER', rmaCommandId, rmaResult()), false);
  assert.equal(b.finish('OWNER', rmaCommandId, rmaResult()), true);
  assert.equal(s.getItem('test'), null);
  assert.equal(b.snapshot('OWNER')!.command.body, null);
  b.bind(null);
  assert.equal(b.snapshot('OWNER'), null);
  assert.equal(s.getItem('test'), null);
});
test('RMA timeout/401/5xx/receipt404 remain unresolved and fresh commands cannot overwrite UUID; definite validation rejects safely', () => {
  const a = new RmaJournal();
  a.bind('OWNER');
  const command = rmaCommand('create', rmaCreateBody(), { orderId: rmaOrderId }, rmaCommandId);
  a.begin('OWNER', command);
  a.fail('OWNER', rmaCommandId, 503, 'rma_unavailable');
  a.fail('OWNER', rmaCommandId, 404, 'rma_not_found');
  assert.equal(a.snapshot('OWNER')!.state, 'unknown');
  assert.throws(() => a.begin('OWNER', { ...command, commandId: rmaCaseId }));
  assert.throws(() => a.finish('OWNER', rmaCommandId, { ...rmaResult(), commandId: rmaCaseId }));
  assert.equal(a.snapshot('OWNER')!.state, 'unknown');
  a.bind('OTHER');
  assert.equal(a.snapshot('OWNER'), null);
  assert.equal(a.snapshot('OTHER'), null);
  const b = new RmaJournal();
  b.bind('OWNER');
  b.begin('OWNER', command);
  b.fail('OWNER', rmaCommandId, 400, 'invalid_rma');
  assert.equal(b.snapshot('OWNER')!.state, 'rejected');
  assert.equal(b.snapshot('OWNER')!.command.body, null);
  b.clear('OWNER');
  assert.equal(b.snapshot('OWNER'), null);
});
test('RMA live create receipt must match exact immutable selected quantities, policy and reason before becoming done', () => {
  const a = new RmaJournal();
  a.bind('OWNER');
  a.begin('OWNER', rmaCommand('create', rmaCreateBody(), { orderId: rmaOrderId }, rmaCommandId));
  assert.throws(() =>
    a.finish('OWNER', rmaCommandId, {
      ...rmaResult(),
      case: { ...rmaResult().case, reason: 'OTHER' },
    }),
  );
  assert.equal(a.snapshot('OWNER')!.state, 'pending');
  assert.equal(a.finish('OWNER', rmaCommandId, rmaResult()), true);
});
test('RMA actor switch and initial logout discard stale or malformed opaque storage without replay', () => {
  const s = storage();
  s.setItem('test', JSON.stringify({ actor: 'OWNER', command: { body: { reason: 'SECRET' } } }));
  const a = new RmaJournal('test', s);
  a.bind('OWNER');
  assert.equal(a.snapshot('OWNER'), null);
  assert.equal(s.getItem('test'), null);
  a.begin('OWNER', rmaCommand('create', rmaCreateBody(), { orderId: rmaOrderId }, rmaCommandId));
  const b = new RmaJournal('test', s);
  b.bind(null);
  assert.equal(s.getItem('test'), null);
  assert.equal(b.snapshot('OWNER'), null);
});

test('same-actor permission changes redact private RAM while retaining exact opaque unknown receipt recovery without mutation replay', async () => {
  const s = storage(),
    a = new RmaJournal('test', s);
  a.bind('OWNER');
  a.begin('OWNER', rmaCommand('create', rmaCreateBody(), { orderId: rmaOrderId }, rmaCommandId));
  const before = s.getItem('test');
  a.redactForPermissionsChange();
  const e = a.snapshot('OWNER')!;
  assert.equal(e.state, 'unknown');
  assert.equal(e.command.body, null);
  assert.equal(e.result, null);
  assert.equal(e.code, null);
  assert.equal(e.command.commandId, rmaCommandId);
  assert.equal(e.command.orderId, rmaOrderId);
  assert.equal(s.getItem('test'), before);
  assert.equal(a.hasUnresolved(), true);
  assert.throws(() =>
    a.begin('OWNER', rmaCommand('create', rmaCreateBody(), { orderId: rmaOrderId }, rmaCaseId)),
  );
  a.redactForPermissionsChange();
  assert.equal(s.getItem('test'), before);
  const restored = new RmaJournal('test', s);
  restored.bind('OWNER');
  assert.equal(restored.snapshot('OWNER')!.state, 'unknown');
  assert.equal(restored.snapshot('OWNER')!.command.body, null);
  const calls: { path: string; method: string; body: unknown }[] = [];
  const raw = await rmaRequest(
    async (path, init) => {
      calls.push({ path, method: init?.method ?? 'GET', body: init?.body });
      return Response.json(rmaResult(), { headers: { 'X-Sayman-Returns-Contract': 'rma-v1' } });
    },
    restored.snapshot('OWNER')!.command.receiptPath,
    { method: 'GET' },
  );
  assert.equal(restored.finish('OWNER', rmaCommandId, raw), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, `/api/returns/commands/${rmaCommandId}`);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].body, undefined);
  assert.equal(restored.snapshot('OWNER')!.state, 'done');
  restored.redactForPermissionsChange();
  assert.equal(restored.snapshot('OWNER'), null);
  assert.equal(s.getItem('test'), null);
});

test('permission changes drop completed/rejected private history and logout or different actor still clears retained unknown markers', () => {
  const s = storage(),
    a = new RmaJournal('test', s);
  a.bind('OWNER');
  const command = rmaCommand('create', rmaCreateBody(), { orderId: rmaOrderId }, rmaCommandId);
  a.begin('OWNER', command);
  a.finish('OWNER', rmaCommandId, rmaResult());
  assert.equal(
    (a.snapshot('OWNER')!.result as ReturnType<typeof rmaResult>).case.reason,
    'دلیل خصوصی مشتری',
  );
  a.redactForPermissionsChange();
  assert.equal(a.snapshot('OWNER'), null);
  a.begin('OWNER', command);
  a.fail('OWNER', rmaCommandId, 409, 'rma_policy_conflict');
  a.redactForPermissionsChange();
  assert.equal(a.snapshot('OWNER'), null);
  a.begin('OWNER', command);
  a.redactForPermissionsChange();
  assert.ok(s.getItem('test'));
  a.bind('OTHER');
  assert.equal(a.snapshot('OWNER'), null);
  assert.equal(a.snapshot('OTHER'), null);
  assert.equal(s.getItem('test'), null);
  a.bind('OWNER');
  a.begin('OWNER', command);
  a.redactForPermissionsChange();
  a.bind(null);
  assert.equal(a.snapshot('OWNER'), null);
  assert.equal(s.getItem('test'), null);
});
