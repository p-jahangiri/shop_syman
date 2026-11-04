import test from 'node:test';
import assert from 'node:assert/strict';
import {
  upfrontBodySchema,
  upfrontPageSchema,
  upfrontSummarySchema,
  upfrontCustomerSchema,
  readUpfrontResult,
  upfrontAdminBase,
  isCreditUpfrontPath,
  type UpfrontCommand,
} from '@sayman/web-shared/lib/credit/credit-upfront-contract.ts';
import { CreditUpfrontJournal } from '@sayman/web-shared/lib/credit/credit-upfront-journal.ts';
import { proxyCreditUpfront } from '../lib/credit/credit-upfront-proxy.ts';
const id = 'a'.repeat(32),
  eventId = 'b'.repeat(32),
  cmdId = 'c'.repeat(32),
  version = 'AAAAAAAAAAE=',
  at = '2026-10-28T00:00:00.000Z',
  summary = {
    id: eventId,
    confirmationId: 'd'.repeat(32),
    orderId: id,
    sequence: 1,
    action: 'ConfirmReceipt',
    state: 'ReceiptConfirmed',
    requiredAmountRial: '9223372036854775807',
    acknowledgedAmountRial: '9223372036854775807',
    version,
    occurredAt: at,
    recordedAt: at,
    bankVerified: false,
  };
const body = {
    action: 'ConfirmReceipt' as const,
    orderVersion: version,
    scheduleVersion: version,
    version: null,
    reference: 'Synthetic receipt only',
    note: 'Sample 🎮',
    occurredAt: at,
    confirmed: true as const,
    acknowledgedClosedOrder: false,
  },
  command: UpfrontCommand = { id: cmdId, ownerId: 'QA_OWNER', orderId: id, body };
const result = {
  schemaVersion: 1,
  commandId: cmdId,
  orderId: id,
  event: {
    summary,
    reference: body.reference,
    note: body.note,
    orderVersion: version,
    scheduleVersion: version,
    previousVersion: null,
    acknowledgedClosedOrder: false,
  },
  replayed: false,
  bankVerified: false,
  canPay: false,
  canFulfill: false,
};
const customer = {
  schemaVersion: 1,
  orderId: id,
  requiredAmountRial: summary.requiredAmountRial,
  current: summary,
  bankVerified: false,
  canPay: false,
  canFulfill: false,
};
test('upfront money stays decimal Int64 strings, zero is separate and private fields cannot enter customer summary', () => {
  assert.equal(upfrontSummarySchema.parse(summary).requiredAmountRial, '9223372036854775807');
  for (const value of ['9223372036854775808', '01', '1\n', 1, Number.MAX_SAFE_INTEGER])
    assert.equal(
      upfrontSummarySchema.safeParse({
        ...summary,
        requiredAmountRial: value,
        acknowledgedAmountRial: value,
      }).success,
      false,
    );
  const zero = {
    ...summary,
    action: 'ConfirmNoUpfrontDue',
    state: 'NoUpfrontDue',
    requiredAmountRial: '0',
    acknowledgedAmountRial: '0',
  };
  assert.equal(upfrontSummarySchema.safeParse(zero).success, true);
  assert.equal(
    upfrontSummarySchema.safeParse({ ...zero, action: 'ConfirmReceipt', state: 'ReceiptConfirmed' })
      .success,
    false,
  );
  assert.equal(upfrontCustomerSchema.safeParse(customer).success, true);
  for (const c of [
    { ...customer, reference: 'secret' },
    { ...customer, canFulfill: true },
    { ...customer, bankVerified: true },
    { ...customer, current: { ...summary, note: 'private' } },
  ])
    assert.equal(upfrontCustomerSchema.safeParse(c).success, false);
});
test('confirmation fields are explicit, canonical, UTC and never accept browser supplied amounts', () => {
  upfrontBodySchema.parse(body);
  assert.equal(upfrontBodySchema.safeParse({ ...body, amountRial: '1' }).success, false);
  for (const b of [
    { ...body, confirmed: false },
    { ...body, reference: '' },
    { ...body, occurredAt: '2026-10-28T03:30:00+03:30' },
    { ...body, occurredAt: at + '\n' },
    { ...body, reference: '\u202econcealed' },
    { ...body, action: 'RevokeConfirmation', reference: '', note: 'reason' },
    { ...body, action: 'ConfirmNoUpfrontDue' },
    { ...body, acknowledgedClosedOrder: true },
  ])
    assert.equal(upfrontBodySchema.safeParse(b).success, false);
  assert.throws(() => upfrontAdminBase('OWNER\n', id));
  assert.throws(() => upfrontAdminBase('OWNER', id + '\n'));
});
test('receipts bind the reviewed order/schedule/previous version, note, occurrence and closed acknowledgement', () => {
  assert.equal(readUpfrontResult(result, command).event.summary.id, eventId);
  assert.equal(
    readUpfrontResult(
      {
        ...result,
        event: {
          ...result.event,
          summary: { ...summary, occurredAt: '2026-10-28T00:00:00+00:00' },
        },
      },
      command,
    ).orderId,
    id,
  );
  for (const r of [
    { ...result, commandId: eventId },
    { ...result, event: { ...result.event, scheduleVersion: 'AAAAAAAAAAI=' } },
    { ...result, event: { ...result.event, previousVersion: version } },
    { ...result, event: { ...result.event, reference: 'unrelated' } },
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
    assert.throws(() => readUpfrontResult(r, command));
});
test('unknown outcome keeps exact command and survives re-verification while logout clears its private draft', () => {
  const j = new CreditUpfrontJournal();
  j.bind('staff');
  j.begin('staff', command);
  j.fail('staff', command, 0, 'unavailable');
  assert.equal(j.snapshot('staff')?.state, 'unknown');
  assert.throws(() => j.begin('staff', { ...command, id: eventId }));
  j.bind('staff');
  assert.deepEqual(j.retry('staff'), command);
  j.fail('staff', command, 409, 'conflict');
  assert.equal(j.snapshot('staff')?.state, 'unknown');
  assert.equal(j.finish('staff', command, result), true);
  j.clear('staff');
  j.begin('staff', command);
  j.interrupt();
  j.bind(null);
  assert.equal(j.snapshot('staff'), null);
  assert.equal(j.finish('staff', command, result), false);
});
test('customer BFF is owned read-only, bearer-only, bounded and excludes cookies and every finance field', async () => {
  const path = '/api/credit/orders/' + id + '/upfront',
    environment = {
      SHOP_DATA_MODE: 'api',
      SHOP_API_URL: 'http://127.0.0.1:5080',
      SHOP_PUBLIC_URL: 'http://127.0.0.1:3000',
    },
    headers = {
      Authorization: 'Bearer ' + 'a'.repeat(30),
      Cookie: 'private=do-not-forward',
      Origin: 'http://127.0.0.1:3000',
    };
  let calls = 0;
  const fetcher = (async (url, init) => {
    calls++;
    assert.equal(url, 'http://127.0.0.1:5080' + path);
    assert.equal(init?.method, 'GET');
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('Cookie'), null);
    return new Response(JSON.stringify(customer), {
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  let response = await proxyCreditUpfront(
    new Request('http://127.0.0.1:3000' + path, { headers }),
    environment,
    fetcher,
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control')!, /private, no-store/);
  assert.match(response.headers.get('X-Robots-Tag')!, /noindex/);
  assert.equal(calls, 1);
  assert.equal(isCreditUpfrontPath(path, 'POST'), false);
  assert.equal(isCreditUpfrontPath(path + '?owner=foreign'), false);
  assert.equal(
    (
      await proxyCreditUpfront(
        new Request('http://127.0.0.1:3000' + path, { method: 'POST', headers, body: '{}' }),
        environment,
        fetcher,
      )
    ).status,
    404,
  );
  assert.equal(
    (await proxyCreditUpfront(new Request('http://127.0.0.1:3000' + path), environment, fetcher))
      .status,
    401,
  );
  assert.equal(calls, 1);
  for (const make of [
    () =>
      new Response(JSON.stringify({ ...customer, note: 'private' }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    () =>
      new Response(JSON.stringify({ ...customer, orderId: eventId }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    () =>
      new Response(JSON.stringify(customer), {
        headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'unsafe=1' },
      }),
    () =>
      new Response(new Uint8Array([0xc3, 0x28]), {
        headers: { 'Content-Type': 'application/json' },
      }),
    () => new Response('x'.repeat(262145), { headers: { 'Content-Type': 'application/json' } }),
  ]) {
    response = await proxyCreditUpfront(
      new Request('http://127.0.0.1:3000' + path, { headers }),
      environment,
      (async () => make()) as typeof fetch,
    );
    assert.equal(response.status, 503);
  }
});
test('customer session transport permits only the upfront GET and rejects a late response after logout', async () => {
  const { CustomerSessionStore } = await import('../lib/account/customer-session.ts');
  const saved = globalThis.fetch,
    path = '/api/credit/orders/' + id + '/upfront',
    session = {
      accessToken: 'synthetic-upfront-private-session',
      expiresIn: 600,
      requiresMfa: false,
      requiresEnrollment: false,
      user: { id: 'QA_OWNER', displayName: 'Synthetic owner', userName: 'qa-owner' },
    };
  let calls = 0;
  let release: ((response: Response) => void) | undefined;
  globalThis.fetch = (async (url, init) => {
    calls++;
    assert.equal(url, path);
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer ' + session.accessToken);
    assert.equal(init?.cache, 'no-store');
    if (calls === 1)
      return new Response(JSON.stringify(customer), {
        headers: { 'Content-Type': 'application/json' },
      });
    return await new Promise<Response>((resolve) => {
      release = resolve;
    });
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
    await assert.rejects(store.fetch(path + '?owner=FOREIGN'));
    assert.equal(calls, 1);
    const pending = store.fetch(path);
    store.remote('signout');
    release!(new Response(JSON.stringify(customer)));
    await assert.rejects(pending);
    assert.equal(store.snapshot().session, null);
  } finally {
    globalThis.fetch = saved;
  }
});

test('committed correction is an explicit existing-certificate amendment with a private reason, never a closed-order acknowledgement', () => {
  const committed = { ...body, version, acknowledgedCommittedOrder: true };
  assert.equal(upfrontBodySchema.safeParse(committed).success, true);
  for (const patch of [
    { version: null },
    { note: '' },
    { acknowledgedClosedOrder: true },
    { amountRial: '1' },
  ])
    assert.equal(upfrontBodySchema.safeParse({ ...committed, ...patch }).success, false);
  assert.equal(upfrontBodySchema.safeParse(body).success, true);
  assert.equal(
    upfrontCustomerSchema.safeParse({
      ...customer,
      current: { ...summary, acknowledgedCommittedOrder: true },
    }).success,
    false,
  );
});
test('committed amendment receipt cannot acquire or lose its reviewed acknowledgement during unknown-result recovery', () => {
  const c: UpfrontCommand = {
      ...command,
      body: { ...body, version, acknowledgedCommittedOrder: true },
    },
    r = {
      ...result,
      event: {
        ...result.event,
        summary: { ...summary, sequence: 3, version: 'AAAAAAAAAAI=' },
        previousVersion: version,
        acknowledgedCommittedOrder: true,
      },
    };
  assert.equal(readUpfrontResult(r, c).event.acknowledgedCommittedOrder, true);
  assert.throws(() =>
    readUpfrontResult({ ...r, event: { ...r.event, acknowledgedCommittedOrder: false } }, c),
  );
  assert.throws(() =>
    readUpfrontResult(
      { ...result, event: { ...result.event, acknowledgedCommittedOrder: true } },
      command,
    ),
  );
  assert.equal(
    readUpfrontResult(result, { ...command, body: { ...body, acknowledgedCommittedOrder: false } })
      .commandId,
    cmdId,
  );
});
test('committed page capabilities remain bounded by the shipment blocker and an existing original confirmation', () => {
  const p = {
    schemaVersion: 1,
    orderId: id,
    orderVersion: version,
    orderState: 'CreditApproved',
    requiredAmountRial: summary.requiredAmountRial,
    scheduleVersion: version,
    current: summary,
    canConfirmReceipt: false,
    canConfirmNoUpfrontDue: false,
    canRevoke: true,
    blockers: [],
    bankVerified: false,
    canPay: false,
    canFulfill: false,
  };
  assert.equal(upfrontPageSchema.safeParse(p).success, true);
  assert.equal(
    upfrontPageSchema.safeParse({ ...p, blockers: ['shipment_already_dispatched'] }).success,
    false,
  );
  assert.equal(
    upfrontPageSchema.safeParse({
      ...p,
      canRevoke: false,
      blockers: ['shipment_already_dispatched'],
    }).success,
    true,
  );
  assert.equal(
    upfrontPageSchema.safeParse({ ...p, canRevoke: false, canConfirmReceipt: true, current: null })
      .success,
    false,
  );
});
