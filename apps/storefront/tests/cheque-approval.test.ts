import test from 'node:test';
import assert from 'node:assert/strict';
import {
  approvalBodySchema,
  approvalPageSchema,
  readApprovalResult,
  isChequeApprovalPath,
  type ApprovalCommand,
} from '@sayman/web-shared/lib/credit/cheque-approval-contract.ts';
import { ChequeApprovalJournal } from '@sayman/web-shared/lib/credit/cheque-approval-journal.ts';
import { proxyChequeApproval } from '../lib/credit/cheque-approval-proxy.ts';
const id = 'a'.repeat(32),
  chequeId = 'b'.repeat(32),
  cmd = 'c'.repeat(32),
  version = 'AAAAAAAAAAE=',
  at = '2026-10-28T00:00:00.000Z',
  summary = {
    id: 'd'.repeat(32),
    approvalId: 'e'.repeat(32),
    orderId: id,
    chequeId,
    sequence: 1,
    action: 'Approve',
    state: 'Approved',
    version,
    orderVersion: version,
    scheduleVersion: version,
    ledgerVersion: version,
    occurredAt: at,
    recordedAt: at,
    bankVerified: false,
  };
const body = {
    action: 'Approve' as const,
    orderVersion: version,
    scheduleVersion: version,
    ledgerVersion: version,
    version: null,
    note: 'QA 🎮',
    occurredAt: at,
    confirmed: true as const,
    acknowledgedClosedOrder: false,
  },
  command: ApprovalCommand = { id: cmd, ownerId: 'QA_OWNER', orderId: id, chequeId, body };
const result = {
  schemaVersion: 1,
  commandId: cmd,
  orderId: id,
  chequeId,
  event: { summary, note: body.note, previousVersion: null, acknowledgedClosedOrder: false },
  replayed: false,
  bankVerified: false,
  canPay: false,
  canFulfill: false,
};
const cheque = {
  id: chequeId,
  internalReference: 'CH-' + chequeId.toUpperCase(),
  orderId: id,
  scheduleId: 'f'.repeat(32),
  sequence: 1,
  dueDate: '2026-11-28',
  amountRial: '9223372036854775807',
  state: 'Received',
  version,
  occurredAt: at,
  recordedAt: at,
  bankVerified: false,
};
const item = {
  sequence: 1,
  dueDate: cheque.dueDate,
  amountRial: cheque.amountRial,
  cheque,
  current: summary,
  approvedForCurrentCheque: true,
};
const page = {
  schemaVersion: 1,
  orderId: id,
  orderVersion: version,
  orderState: 'AwaitingPayment',
  scheduleVersion: version,
  items: [item],
  allChequesApproved: true,
  bankVerified: false,
  canPay: false,
  canFulfill: false,
};
test('all cheques means every actual current line and matching custody version, never a vacuous or stale approval', () => {
  approvalPageSchema.parse(page);
  for (const p of [
    { ...page, items: [] },
    { ...page, items: [{ ...item, cheque: null, current: null }] },
    { ...page, items: [{ ...item, cheque: { ...cheque, version: 'AAAAAAAAAAI=' } }] },
    { ...page, scheduleVersion: 'AAAAAAAAAAI=' },
    { ...page, items: [{ ...item, cheque: { ...cheque, state: 'BouncedReported' } }] },
    { ...page, items: [{ ...item, current: { ...summary, note: 'secret' } }] },
    { ...page, canFulfill: true },
    { ...page, items: [{ ...item, amountRial: '9223372036854775808' }] },
  ])
    assert.equal(approvalPageSchema.safeParse(p).success, false);
  assert.equal(
    approvalPageSchema.parse({ ...page, items: [], allChequesApproved: false }).allChequesApproved,
    false,
  );
  assert.equal(
    approvalPageSchema.parse({
      ...page,
      items: [
        {
          ...item,
          cheque: { ...cheque, version: 'AAAAAAAAAAI=' },
          approvedForCurrentCheque: false,
        },
      ],
      allChequesApproved: false,
    }).allChequesApproved,
    false,
  );
});
test('human attestation requires explicit review, reason, exact versions and UTC without client amount', () => {
  approvalBodySchema.parse(body);
  for (const b of [
    { ...body, amountRial: '1' },
    { ...body, confirmed: false },
    { ...body, note: '' },
    { ...body, note: '\u202ehidden' },
    { ...body, occurredAt: at + '\n' },
    { ...body, occurredAt: '2026-10-28T03:30:00+03:30' },
    { ...body, action: 'Revoke' },
    { ...body, acknowledgedClosedOrder: true },
  ])
    assert.equal(approvalBodySchema.safeParse(b).success, false);
});
test('receipt binds the reviewed cheque, custody version, previous approval, exact occurrence and reason', () => {
  readApprovalResult(result, command);
  for (const r of [
    { ...result, chequeId: id },
    { ...result, event: { ...result.event, note: 'other' } },
    {
      ...result,
      event: { ...result.event, summary: { ...summary, ledgerVersion: 'AAAAAAAAAAI=' } },
    },
    {
      ...result,
      event: {
        ...result.event,
        summary: {
          ...summary,
          occurredAt: '2026-10-28T00:00:00.0000001Z',
          recordedAt: '2026-10-28T00:00:00.0000001Z',
        },
      },
    },
  ])
    assert.throws(() => readApprovalResult(r, command));
});
test('unknown manual approval stays immutable in RAM and logout rejects late receipts', () => {
  const j = new ChequeApprovalJournal();
  j.bind('finance');
  j.begin('finance', command);
  j.interrupt();
  assert.throws(() => j.begin('finance', { ...command, id: id }));
  assert.deepEqual(j.retry('finance'), command);
  j.fail('finance', command, 409, 'conflict');
  assert.equal(j.snapshot('finance')?.state, 'unknown');
  assert.equal(j.finish('finance', command, result), true);
  j.clear('finance');
  j.begin('finance', command);
  j.bind(null);
  assert.equal(j.finish('finance', command, result), false);
  assert.equal(j.snapshot('finance'), null);
});
test('customer approval BFF uses bearer only, checks ownership, private response shape, byte and UTF8 limits', async () => {
  const path = '/api/credit/orders/' + id + '/cheque-approvals',
    env = {
      SHOP_DATA_MODE: 'api',
      SHOP_API_URL: 'http://127.0.0.1:5080',
      SHOP_PUBLIC_URL: 'http://127.0.0.1:3000',
    },
    headers = {
      Authorization: 'Bearer ' + 'a'.repeat(30),
      Cookie: 'private=not-forwarded',
      Origin: 'http://127.0.0.1:3000',
    };
  let count = 0;
  const f = (async (url, init) => {
    count++;
    assert.equal(url, env.SHOP_API_URL + path);
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('Cookie'), null);
    return Response.json(page);
  }) as typeof fetch;
  let r = await proxyChequeApproval(new Request(env.SHOP_PUBLIC_URL + path, { headers }), env, f);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('Cache-Control')!, /no-store/);
  assert.match(r.headers.get('X-Robots-Tag')!, /noindex/);
  assert.equal(count, 1);
  assert.equal(isChequeApprovalPath(path, 'POST'), false);
  assert.equal(isChequeApprovalPath(path + '?owner=other'), false);
  for (const make of [
    () => Response.json({ ...page, note: 'secret' }),
    () => Response.json({ ...page, orderId: chequeId }),
    () => Response.json(page, { headers: { 'Set-Cookie': 'x=1' } }),
    () => new Response(new Uint8Array([0xc3, 0x28])),
    () => new Response('x'.repeat(262145)),
  ]) {
    r = await proxyChequeApproval(
      new Request(env.SHOP_PUBLIC_URL + path, { headers }),
      env,
      (async () => make()) as typeof fetch,
    );
    assert.equal(r.status, 503);
  }
});
test('actual customer session transport allows approval reads only and rejects late completion after logout', async () => {
  const { CustomerSessionStore } = await import('../lib/account/customer-session.ts'),
    saved = globalThis.fetch,
    path = '/api/credit/orders/' + id + '/cheque-approvals',
    session = {
      accessToken: 'synthetic-cheque-approval-session',
      expiresIn: 600,
      requiresMfa: false,
      requiresEnrollment: false,
      user: { id: 'QA_OWNER', displayName: 'QA', userName: 'qa' },
    };
  let calls = 0,
    release: ((r: Response) => void) | undefined;
  globalThis.fetch = (async (url, init) => {
    calls++;
    assert.equal(url, path);
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer ' + session.accessToken);
    if (calls === 1) return Response.json(page);
    return new Promise<Response>((resolve) => (release = resolve));
  }) as typeof fetch;
  try {
    const store = new CustomerSessionStore(
      undefined,
      async () => session,
      async (run) => run(),
      () => false,
    );
    await store.restore();
    assert.equal((await store.fetch(path)).status, 200);
    await assert.rejects(store.fetch(path, { method: 'POST', body: '{}' }));
    await assert.rejects(store.fetch(path + '?owner=other'));
    assert.equal(calls, 1);
    const pending = store.fetch(path);
    store.remote('signout');
    release!(Response.json(page));
    await assert.rejects(pending);
  } finally {
    globalThis.fetch = saved;
  }
});
