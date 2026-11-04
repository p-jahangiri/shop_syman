import test from 'node:test';
import assert from 'node:assert/strict';
import {
  creditScheduleCalculationSchema,
  creditScheduleDateSchema,
  creditSchedulePreviewInputSchema,
  creditSchedulePreviewSchema,
  creditScheduleSaveInputSchema,
  creditScheduleCommandSchema,
  creditSchedulePageSchema,
  creditScheduleHistorySchema,
  creditScheduleOrderQueueSchema,
  readCreditSchedulePreview,
  readCreditScheduleResult,
  isCreditSchedulePath,
  isCreditScheduleAdminPath,
  type CreditScheduleCommand,
} from '@sayman/web-shared/lib/credit/credit-schedule-contract.ts';
import { CreditScheduleJournal } from '@sayman/web-shared/lib/credit/credit-schedule-journal.ts';
import { proxyCreditSchedules } from '../lib/credit/credit-schedule-proxy.ts';
import { CustomerSessionStore } from '../lib/account/customer-session.ts';
const orderId = 'a'.repeat(32),
  quoteId = 'b'.repeat(32),
  revisionId = 'c'.repeat(32),
  commandId = 'd'.repeat(32),
  version = 'AAAAAAAAAAE=',
  nextVersion = 'AAAAAAAAAAI=',
  createdAt = '2026-10-27T10:00:00+00:00',
  until = '2026-10-27T10:05:00Z';
function calculation() {
  return {
    calendarKind: 'Gregorian' as const,
    anchorDate: '2026-10-27',
    timeZone: 'Asia/Tehran' as const,
    planDownPaymentRial: '100',
    chargesOutsideChequesRial: '12345',
    upfrontTotalRial: '12445',
    installmentsTotalRial: '9007199254740993',
    payableTotalRial: '9007199254753438',
    lines: [
      { sequence: 1, monthOffset: 1, dueDate: '2026-11-27', amountRial: '4503599627370496' },
      { sequence: 2, monthOffset: 2, dueDate: '2026-12-27', amountRial: '4503599627370497' },
    ],
  };
}
function input() {
  return {
    orderVersion: version,
    scheduleVersion: null,
    calendarKind: 'Gregorian' as const,
    anchorDate: '2026-10-27',
  };
}
function preview() {
  return {
    schemaVersion: 1 as const,
    orderId,
    orderVersion: version,
    scheduleVersion: null,
    fingerprint: 'E'.repeat(64),
    creditQuoteId: quoteId,
    quoteFingerprint: 'F'.repeat(64),
    planName: 'Synthetic schedule QA',
    locale: 'en' as const,
    calculation: calculation(),
    canPay: false as const,
    canFulfill: false as const,
  };
}
function command(): CreditScheduleCommand {
  return creditScheduleCommandSchema.parse({
    id: commandId,
    ownerId: 'qa-owner',
    orderId,
    body: { ...input(), previewFingerprint: preview().fingerprint, confirmed: true },
    previewSnapshot: preview(),
  });
}
function revision() {
  return {
    id: revisionId,
    orderId,
    revision: 1,
    version: nextVersion,
    creditQuoteId: quoteId,
    quoteFingerprint: 'F'.repeat(64),
    planName: 'Synthetic schedule QA',
    locale: 'en' as const,
    calculation: calculation(),
    createdAt,
    state: 'Planned' as const,
    canPay: false as const,
    canFulfill: false as const,
  };
}
function result() {
  return { schemaVersion: 1, replayed: false, commandId, revision: revision() };
}
function page() {
  return {
    schemaVersion: 1,
    orderId,
    orderVersion: version,
    orderState: 'AwaitingPayment',
    current: revision(),
    canAmend: false,
    blockers: [],
    canPay: false,
    canFulfill: false,
  };
}
const own = '/api/credit/orders/' + orderId + '/schedule',
  admin = '/api/admin/credit/orders/qa-owner/' + orderId + '/schedule';
test('civil dates reject rollover, localized digits and timestamps without silently changing a day', () => {
  for (const value of ['2026-10-27', '2024-02-29', '0001-01-01'])
    assert.ok(creditScheduleDateSchema.safeParse(value).success);
  for (const value of [
    '2026-02-30',
    '2025-02-29',
    '2026-2-01',
    '۲۰۲۶-۱۰-۲۷',
    '2026-10-27T00:00:00Z',
    '0000-01-01',
  ])
    assert.equal(creditScheduleDateSchema.safeParse(value).success, false);
});
test('calendar choice is explicit and no client amount, authority or date list can enter a command', () => {
  assert.ok(creditSchedulePreviewInputSchema.parse(input()));
  assert.equal(
    creditSchedulePreviewInputSchema.safeParse({ ...input(), calendarKind: '' }).success,
    false,
  );
  for (const extra of [
    { amountRial: '1' },
    { dueDates: [] },
    { ownerId: 'foreign' },
    { scopeId: orderId },
    { confirmed: false },
  ])
    assert.equal(
      creditScheduleSaveInputSchema.safeParse({ ...command().body, ...extra }).success,
      false,
    );
});
test('exact large rial sums distinguish plan down payment, charges, upfront and cheques', () => {
  assert.equal(
    creditScheduleCalculationSchema.parse(calculation()).installmentsTotalRial,
    '9007199254740993',
  );
  for (const patch of [
    { upfrontTotalRial: '12446' },
    { chargesOutsideChequesRial: '0' },
    { payableTotalRial: 9007199254753438 },
    { planDownPaymentRial: 'NaN' },
    { lines: [{ ...calculation().lines[0], amountRial: '1.5' }, calculation().lines[1]] },
    { lines: [{ ...calculation().lines[0], dueDate: '2026-02-30' }, calculation().lines[1]] },
  ])
    assert.equal(
      creditScheduleCalculationSchema.safeParse({ ...calculation(), ...patch }).success,
      false,
    );
  const prepaid = {
    ...calculation(),
    planDownPaymentRial: '100',
    chargesOutsideChequesRial: '12345',
    upfrontTotalRial: '12445',
    installmentsTotalRial: '0',
    payableTotalRial: '12445',
    lines: [],
  };
  assert.ok(creditScheduleCalculationSchema.parse(prepaid));
});
test('preview and receipt bind the same order versions, calendar, exact dates, amounts and frozen quote', () => {
  assert.ok(readCreditSchedulePreview(preview(), orderId, input()));
  assert.throws(() =>
    readCreditSchedulePreview({ ...preview(), orderId: quoteId }, orderId, input()),
  );
  assert.equal(readCreditScheduleResult(result(), command()).revision.version, nextVersion);
  for (const patch of [
    { commandId: orderId },
    { revision: { ...revision(), creditQuoteId: orderId } },
    { revision: { ...revision(), revision: 2 } },
    { revision: { ...revision(), canFulfill: true } },
    {
      revision: {
        ...revision(),
        calculation: {
          ...calculation(),
          lines: [{ ...calculation().lines[0], dueDate: '2026-11-28' }, calculation().lines[1]],
        },
      },
    },
  ])
    assert.throws(() => readCreditScheduleResult({ ...result(), ...patch }, command()));
  assert.equal(
    creditSchedulePreviewSchema.safeParse({ ...preview(), canPay: true }).success,
    false,
  );
});
test('owned current and history contracts keep revisions ordered and never claim payment or fulfillment', () => {
  assert.ok(creditSchedulePageSchema.parse(page()));
  assert.equal(
    creditSchedulePageSchema.safeParse({ ...page(), orderState: 'Cancelled', canAmend: true })
      .success,
    false,
  );
  assert.ok(
    creditSchedulePageSchema.parse({
      ...page(),
      orderState: 'Cancelled',
      blockers: ['credit_schedule_order_closed'],
    }),
  );
  const second = { ...revision(), id: 'f'.repeat(32), revision: 2, version: 'AAAAAAAAAAM=' };
  assert.ok(
    creditScheduleHistorySchema.parse({
      schemaVersion: 1,
      orderId,
      items: [second, revision()],
      nextRevision: null,
    }),
  );
  assert.equal(
    creditScheduleHistorySchema.safeParse({
      schemaVersion: 1,
      orderId,
      items: [revision(), second],
      nextRevision: null,
    }).success,
    false,
  );
  assert.equal(
    creditScheduleHistorySchema.safeParse({
      schemaVersion: 1,
      orderId,
      items: [{ ...revision(), orderId: quoteId }],
      nextRevision: null,
    }).success,
    false,
  );
  assert.ok(
    creditScheduleOrderQueueSchema.parse({
      schemaVersion: 1,
      items: [
        {
          orderId,
          ownerId: 'qa-owner',
          reference: 'SM-1',
          locale: 'en',
          state: 'AwaitingPayment',
          createdAt,
          expiresAt: until,
          payableTotalRial: calculation().payableTotalRial,
          itemCount: 1,
          version,
        },
      ],
      nextCursor: null,
    }),
  );
});
test('customer routes are read only and staff routes accept only scoped preview or receipt operations', () => {
  for (const p of [own, own + '/history', own + '/history?beforeRevision=20'])
    assert.ok(isCreditSchedulePath(p));
  for (const p of [
    own + '?owner=foreign',
    own + '/history?beforeRevision=01',
    own + '/history?beforeRevision=2147483648',
    own + '/history?beforeRevision=2&beforeRevision=3',
    own.replace(orderId, '0'.repeat(32)),
    own + '#fragment',
  ])
    assert.equal(isCreditSchedulePath(p), false);
  assert.equal(isCreditSchedulePath(own, 'POST'), false);
  for (const p of [
    '/api/admin/credit/orders',
    '/api/admin/credit/orders?cursor=YQ%3D%3D',
    admin,
    admin + '/history?beforeRevision=2',
    admin + '/commands/' + commandId,
  ])
    assert.ok(isCreditScheduleAdminPath(p));
  for (const p of [admin + '/preview', admin + '/commands/' + commandId])
    assert.ok(isCreditScheduleAdminPath(p, 'POST'));
  for (const p of [
    '/api/admin/credit/orders?owner=foreign',
    '/api/admin/credit/orders?cursor=%GG',
    admin + '?owner=foreign',
    admin + '/history?beforeRevision=2147483648',
    admin + '/preview?owner=foreign',
  ])
    assert.equal(isCreditScheduleAdminPath(p), false);
});
test('financial command ambiguity is sticky, freezes preview and cannot cross verified staff accounts', () => {
  const j = new CreditScheduleJournal();
  j.bind('staff');
  const c = command();
  j.begin('staff', c);
  c.body.calendarKind = 'Persian';
  j.interrupt();
  j.clear('staff');
  assert.equal(j.snapshot('staff')?.state, 'unknown');
  const retry = j.retry('staff');
  assert.equal(retry.body.calendarKind, 'Gregorian');
  j.fail('staff', retry, 404, 'not_found');
  assert.equal(j.snapshot('staff')?.state, 'unknown');
  assert.throws(() => j.begin('staff', command()));
  assert.ok(j.finish('staff', retry, { ...result(), replayed: true }));
  j.bind('other-staff');
  assert.equal(j.snapshot('staff'), null);
  assert.equal(j.finish('staff', retry, result()), false);
});
const environment = {
    SHOP_DATA_MODE: 'api',
    SHOP_API_URL: 'http://127.0.0.1:5080',
    SHOP_PUBLIC_URL: 'http://127.0.0.1:3000',
  },
  headers = {
    Authorization: 'Bearer ' + 'x'.repeat(32),
    Origin: environment.SHOP_PUBLIC_URL,
    Cookie: 'must-not-forward=1',
  };
test('customer gateway requires bearer, excludes cookies, bounds JSON and rejects staff editing authority', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (target, init) => {
    calls++;
    assert.equal(target, environment.SHOP_API_URL + own);
    assert.equal(init?.credentials, 'omit');
    assert.equal(new Headers(init?.headers).get('Cookie'), null);
    return Response.json(page());
  };
  const request = new Request(environment.SHOP_PUBLIC_URL + own, { headers }),
    response = await proxyCreditSchedules(request, environment, fetcher);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control')!, /private, no-store/);
  assert.match(response.headers.get('X-Robots-Tag')!, /noindex/);
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.equal(
    (await proxyCreditSchedules(new Request(request.url), environment, fetcher)).status,
    401,
  );
  assert.equal(calls, 1);
  for (const body of [
    { ...page(), canAmend: true },
    { ...page(), orderId: quoteId },
  ])
    assert.equal(
      (await proxyCreditSchedules(request, environment, async () => Response.json(body))).status,
      503,
    );
  assert.equal(
    (
      await proxyCreditSchedules(request, environment, async () =>
        Response.json(page(), { headers: { 'Set-Cookie': 'forbidden=1' } }),
      )
    ).status,
    503,
  );
  assert.equal(
    (
      await proxyCreditSchedules(
        request,
        environment,
        async () =>
          new Response('x', {
            headers: { 'Content-Type': 'application/json', 'Content-Length': '262145' },
          }),
      )
    ).status,
    503,
  );
  assert.equal(
    (
      await proxyCreditSchedules(
        request,
        environment,
        async () =>
          new Response(new Uint8Array([255]), { headers: { 'Content-Type': 'application/json' } }),
      )
    ).status,
    503,
  );
});
test('the verified customer session attaches bearer only to allowed owned schedule reads', async () => {
  const value = {
      accessToken: 'x'.repeat(50),
      expiresIn: 600,
      requiresMfa: false,
      requiresEnrollment: false,
      user: { id: 'qa-customer', displayName: 'Synthetic', userName: 'qa' },
    },
    store = new CustomerSessionStore(
      async () => value,
      async () => value,
      async (f) => f(),
      () => false,
    ),
    prior = globalThis.fetch;
  await store.login('qa', 'synthetic');
  try {
    globalThis.fetch = async (target, init) => {
      assert.equal(target, own);
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer ' + value.accessToken);
      return Response.json(page());
    };
    await store.fetch(own);
    await assert.rejects(() => store.fetch(own, { method: 'POST' }));
    await assert.rejects(() => store.fetch(own + '?ownerId=foreign'));
  } finally {
    globalThis.fetch = prior;
    store.remote('signout');
  }
});
