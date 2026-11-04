import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearanceBodySchema,
  clearancePageSchema,
  clearanceCustomerSchema,
  clearanceCommandSchema,
  readClearanceResult,
  isCreditClearancePath,
} from '@sayman/web-shared/lib/credit/credit-clearance-contract.ts';
import { CreditClearanceJournal } from '@sayman/web-shared/lib/credit/credit-clearance-journal.ts';
import { proxyCreditClearance } from '../lib/credit/credit-clearance-proxy.ts';
const id = 'a'.repeat(32),
  cmd = 'b'.repeat(32),
  v = 'AAAAAAAAAAE=',
  v2 = 'AAAAAAAAAAI=',
  hash = 'A'.repeat(64),
  at = '2026-10-28T00:00:00.000Z';
const evidence = {
  financialFingerprint: hash,
  quoteFingerprint: hash,
  scheduleId: 'c'.repeat(32),
  scheduleVersion: v,
  requiredUpfrontRial: '9007199254740993',
  upfrontId: 'd'.repeat(32),
  upfrontVersion: v,
  upfrontState: 'ReceiptConfirmed',
  upfrontConfirmed: true,
  cheques: [
    {
      sequence: 1,
      dueDate: '2026-11-28',
      amountRial: '9007199254740993',
      chequeId: 'e'.repeat(32),
      ledgerVersion: v,
      ledgerState: 'Received',
      approvalId: 'f'.repeat(32),
      approvalVersion: v,
      approved: true,
    },
  ],
  allChequesApproved: true,
};
const page = {
  schemaVersion: 1,
  orderId: id,
  orderVersion: v,
  orderState: 'AwaitingPayment',
  reservationState: 'Active',
  shipmentState: null,
  evidence,
  evidenceFingerprint: hash,
  previewFingerprint: hash,
  current: null,
  effective: false,
  canApprove: true,
  canRevoke: false,
  blockers: [],
  bankVerified: false,
  canPay: false,
};
const summary = {
  id: '1'.repeat(32),
  orderId: id,
  sequence: 1,
  action: 'Approve',
  state: 'Approved',
  version: v2,
  evidenceFingerprint: hash,
  sourceOrderVersion: v,
  resultOrderVersion: v2,
  recordedAt: at,
  bankVerified: false,
};
const command = clearanceCommandSchema.parse({
  id: cmd,
  ownerId: 'QA_OWNER',
  orderId: id,
  body: {
    action: 'Approve',
    orderVersion: v,
    version: null,
    previewFingerprint: hash,
    note: 'Synthetic private review',
    confirmed: true,
  },
  previewSnapshot: page,
});
const result = {
  schemaVersion: 1,
  commandId: cmd,
  orderId: id,
  event: { summary, note: command.body.note, previousVersion: null },
  initialCommit: true,
  replayed: false,
  bankVerified: false,
  canPay: false,
};
const customer = {
  schemaVersion: 1,
  orderId: id,
  orderState: 'CreditApproved',
  current: summary,
  effective: true,
  bankVerified: false,
  canPay: false,
};
test('financial clearance needs every real current cheque and an exact upfront confirmation without client money', () => {
  clearancePageSchema.parse(page);
  for (const value of [
    { ...page, evidence: { ...evidence, cheques: [] } },
    { ...page, evidence: { ...evidence, upfrontConfirmed: false } },
    {
      ...page,
      evidence: {
        ...evidence,
        cheques: [{ ...evidence.cheques[0], ledgerState: 'BouncedReported' }],
      },
    },
    { ...page, evidence: { ...evidence, requiredUpfrontRial: '9223372036854775808' } },
    { ...page, effective: true },
    { ...page, bankVerified: true },
  ])
    assert.equal(clearancePageSchema.safeParse(value).success, false);
  for (const body of [
    { ...command.body, amountRial: '1' },
    { ...command.body, confirmed: false },
    { ...command.body, note: '' },
    { ...command.body, action: 'Revoke' },
    { ...command.body, note: '\u202ehidden' },
  ])
    assert.equal(clearanceBodySchema.safeParse(body).success, false);
  assert.equal(clearanceCustomerSchema.safeParse({ ...customer, note: 'private' }).success, false);
});
test('financial receipt binds action, evidence, original and result order versions, sequence, note and prior authorization', () => {
  readClearanceResult(result, command);
  for (const value of [
    { ...result, commandId: id },
    { ...result, event: { ...result.event, note: 'other' } },
    {
      ...result,
      event: { ...result.event, summary: { ...summary, evidenceFingerprint: 'B'.repeat(64) } },
    },
    { ...result, event: { ...result.event, summary: { ...summary, resultOrderVersion: v } } },
    { ...result, initialCommit: false },
  ])
    assert.throws(() => readClearanceResult(value, command));
});
test('financial command stays frozen during unknown outcome and logout rejects late completion', () => {
  const j = new CreditClearanceJournal();
  j.bind('finance');
  j.begin('finance', command);
  j.interrupt();
  assert.throws(() => j.begin('finance', command));
  assert.deepEqual(j.retry('finance'), command);
  j.fail('finance', command, 409, 'conflict');
  assert.equal(j.snapshot('finance')?.state, 'unknown');
  assert.equal(j.finish('finance', command, result), true);
  j.clear('finance');
  j.begin('finance', command);
  j.bind(null);
  assert.equal(j.finish('finance', command, result), false);
});
test('credit clearance BFF is read-only, owner bound, cookie free, strict private JSON with bounded UTF8', async () => {
  const path = '/api/credit/orders/' + id + '/clearance',
    env = {
      SHOP_DATA_MODE: 'api',
      SHOP_API_URL: 'http://127.0.0.1:5080',
      SHOP_PUBLIC_URL: 'http://127.0.0.1:3000',
    },
    headers = {
      Authorization: 'Bearer ' + 'a'.repeat(30),
      Cookie: 'not-forwarded=1',
      Origin: env.SHOP_PUBLIC_URL,
    };
  let count = 0;
  const f = (async (url, init) => {
    count++;
    assert.equal(url, env.SHOP_API_URL + path);
    assert.equal(new Headers(init?.headers).get('Cookie'), null);
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.cache, 'no-store');
    return Response.json(customer);
  }) as typeof fetch;
  const response = await proxyCreditClearance(
    new Request(env.SHOP_PUBLIC_URL + path, { headers }),
    env,
    f,
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control')!, /no-store/);
  assert.match(response.headers.get('X-Robots-Tag')!, /noindex/);
  assert.equal(count, 1);
  assert.equal(isCreditClearancePath(path, 'POST'), false);
  assert.equal(isCreditClearancePath(path + '?owner=other'), false);
  for (const create of [
    () => Response.json({ ...customer, orderId: cmd }),
    () => Response.json({ ...customer, actorId: 'secret' }),
    () => Response.json(customer, { headers: { 'Set-Cookie': 'unsafe=1' } }),
    () => new Response(new Uint8Array([0xc3, 0x28])),
    () => new Response('x'.repeat(262145)),
  ])
    assert.equal(
      (
        await proxyCreditClearance(
          new Request(env.SHOP_PUBLIC_URL + path, { headers }),
          env,
          (async () => create()) as typeof fetch,
        )
      ).status,
      503,
    );
});
test('actual session transport permits only clearance GET and rejects completion after cross-tab signout', async () => {
  const { CustomerSessionStore } = await import('../lib/account/customer-session.ts'),
    saved = globalThis.fetch,
    path = '/api/credit/orders/' + id + '/clearance',
    session = {
      accessToken: 'synthetic-clearance-session',
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
    if (calls === 1) return Response.json(customer);
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
    release!(Response.json(customer));
    await assert.rejects(pending);
  } finally {
    globalThis.fetch = saved;
  }
});
test('remaining personal cheque authorization requires explicit partial-dispatch acknowledgment while legacy bodies stay unchanged', () => {
  const current = { ...summary, resultOrderVersion: v };
  const partial = {
    ...page,
    orderState: 'CreditApproved',
    reservationState: 'Allocated',
    shipmentState: 'dispatched',
    current,
    effective: true,
    canApprove: false,
    canRevoke: true,
  };
  const preview = clearancePageSchema.parse(partial);
  const body = { ...command.body, action: 'Revoke', version: current.version };
  assert.equal(
    clearanceCommandSchema.safeParse({ ...command, body, previewSnapshot: preview }).success,
    false,
  );
  const c = clearanceCommandSchema.parse({
    ...command,
    body: { ...body, acknowledgedPartialDispatch: true },
    previewSnapshot: preview,
  });
  assert.equal(c.body.acknowledgedPartialDispatch, true);
  assert.equal('acknowledgedPartialDispatch' in command.body, false);
  const receipt = {
    ...result,
    initialCommit: false,
    event: {
      summary: {
        ...summary,
        id: '2'.repeat(32),
        sequence: 2,
        action: 'Revoke',
        state: 'Revoked',
        version: 'AAAAAAAAAAM=',
        sourceOrderVersion: v,
        resultOrderVersion: v,
      },
      note: body.note,
      previousVersion: current.version,
      acknowledgedPartialDispatch: true,
    },
  };
  assert.equal(readClearanceResult(receipt, c).event.acknowledgedPartialDispatch, true);
  assert.throws(() =>
    readClearanceResult(
      { ...receipt, event: { ...receipt.event, acknowledgedPartialDispatch: undefined } },
      c,
    ),
  );
});
