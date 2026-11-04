import test from 'node:test';
import assert from 'node:assert/strict';
import {
  creditOrderInputSchema,
  creditOrderCommandSchema,
  creditOrderResultSchema,
  creditOrderDetailSchema,
  creditQuoteHistorySchema,
  readCreditOrderResult,
  isCreditOrderPath,
  type CreditOrderCommand,
} from '@sayman/web-shared/lib/credit/credit-order-contract.ts';
import {
  CreditOrderJournal,
  customerCreditOrderJournal,
} from '@sayman/web-shared/lib/credit/credit-order-journal.ts';
import { proxyCreditOrders } from '../lib/credit/credit-order-proxy.ts';
import { CustomerSessionStore } from '../lib/account/customer-session.ts';
const appId = 'a'.repeat(32),
  scopeId = 'b'.repeat(32),
  reviewId = 'c'.repeat(32),
  subId = 'd'.repeat(32),
  commandId = 'e'.repeat(32),
  quoteId = 'f'.repeat(32),
  baseId = '1'.repeat(32),
  version = 'AAAAAAAAAAE=',
  created = '2026-10-27T12:00:00+00:00',
  until = '2026-10-27T12:03:00+00:00';
const method = {
  id: 'cheque',
  kind: 'cheque',
  name: 'Synthetic cheque',
  description: 'QA',
  enabled: true,
  requiresApproval: true,
  categoryIds: [],
  minAmountRial: null,
  maxAmountRial: null,
};
const plan = {
  id: 'qa',
  name: 'Synthetic plan',
  months: 2,
  markupBasisPoints: 0,
  downPaymentBasisPoints: 0,
  intervalMonths: 1,
  roundingUnitRial: 1,
  enabled: true,
  categoryIds: [],
  minAmountRial: null,
  maxAmountRial: null,
};
function core() {
  return {
    schemaVersion: 3,
    locale: 'en',
    quoteId: baseId,
    cartVersion: version,
    pricingFingerprint: 'A'.repeat(64),
    createdAt: created,
    expiresAt: '2026-10-27T12:05:00Z',
    lines: [
      {
        variantId: 'v',
        productId: 'p',
        sellerId: 'store',
        categoryId: 'phones',
        sku: 'QA',
        name: 'Synthetic item',
        label: 'QA variant',
        warranty: 'QA',
        isDigital: false,
        quantity: 1,
        unitPriceRial: '9007199254740993',
        lineTotalRial: '9007199254740993',
        priceVersion: version,
      },
    ],
    itemsSubtotalRial: '9007199254740993',
    markupRial: '0',
    downPaymentRial: '0',
    goodsTotalRial: '9007199254740993',
    shippingRequired: true,
    shippingRial: '12345',
    taxRial: '0',
    payableTotalRial: '9007199254753338',
    methods: [method],
    plans: [plan],
    selectedMethod: method,
    selectedPlan: plan,
    installments: [
      { sequence: 1, monthOffset: 1, amountRial: '4503599627370496' },
      { sequence: 2, monthOffset: 2, amountRial: '4503599627370497' },
    ],
    requiresApproval: true,
    canPlaceOrder: false,
    blockers: ['credit_approval_required'],
    chargeRules: {
      version,
      shippingMode: 'flat',
      shippingName: 'Synthetic delivery',
      shippingDescription: 'QA',
      shippingFeeRial: '12345',
      shippingFreeFromRial: null,
      shippingReason: 'flat',
      taxMode: 'exempt',
      taxRateBasisPoints: null,
      taxBase: 'goods',
      taxRounding: 'half_up',
      taxableBaseRial: '9007199254740993',
      taxIncluded: false,
    },
    temporaryOrder: {
      canCreate: false,
      reservationMinutes: 15,
      requiresSignIn: true,
      blockers: ['method_not_supported'],
      settingsVersion: null,
    },
  };
}
function authority() {
  return {
    applicationId: appId,
    applicationVersion: version,
    scopeId,
    scopeVersion: version,
    reviewId,
    submissionId: subId,
    limitBasis: 'PayableTotalRial',
    limitAmountRial: '9007199254753338',
    expiresAt: until,
    planId: 'qa',
    planVersion: version,
    planSnapshotHash: 'B'.repeat(64),
  };
}
function quote() {
  return {
    schemaVersion: 1,
    id: quoteId,
    locale: 'en',
    createdAt: created,
    expiresAt: until,
    fingerprint: 'C'.repeat(64),
    authority: authority(),
    assessment: {
      limitBasis: 'PayableTotalRial',
      limitAmountRial: '9007199254753338',
      assessedAmountRial: '9007199254753338',
      withinLimit: true,
      blockers: ['credit_order_not_configured'],
    },
    ordinaryQuote: core(),
    acceptedQuote: null,
    canPlaceOrder: false,
    canPay: false,
  };
}

const orderId = '2'.repeat(32),
  acceptedAt = '2026-10-27T12:01:00Z';
function body() {
  return {
    creditQuoteId: quoteId,
    fingerprint: 'C'.repeat(64),
    contactName: 'Synthetic recipient',
    contactPhone: '09100000000',
    delivery: {
      countryCode: 'IR',
      province: 'تهران',
      city: 'تهران',
      address: 'نشانی کاملاً ساختگی برای آزمون نرم‌افزار',
      postalCode: '1234567890',
    },
    note: 'Synthetic QA only',
    quoteAccepted: true as const,
    acknowledgeTemporary: true as const,
  };
}
function cmd(): CreditOrderCommand {
  return creditOrderCommandSchema.parse({ id: commandId, body: body(), quoteSnapshot: quote() });
}
function order() {
  return {
    schemaVersion: 2,
    originalSnapshotVersion: 1,
    summary: {
      id: orderId,
      reference: 'SM-1',
      locale: 'en',
      state: 'AwaitingPayment',
      createdAt: acceptedAt,
      expiresAt: until,
      payableTotalRial: core().payableTotalRial,
      itemCount: 1,
      version,
      originalSnapshotVersion: 1,
    },
    quoteId: baseId,
    contactName: body().contactName,
    contactPhone: body().contactPhone,
    delivery: body().delivery,
    note: body().note,
    shippingRequired: true,
    methodName: method.name,
    shippingName: core().chargeRules.shippingName,
    itemsSubtotalRial: core().itemsSubtotalRial,
    goodsTotalRial: core().goodsTotalRial,
    shippingRial: '12345',
    taxRial: '0',
    payableTotalRial: core().payableTotalRial,
    taxIncluded: false,
    lines: [
      {
        ...core().lines[0],
        lineId: '3'.repeat(32),
        lineKind: 'ordinary',
        categoryId: null,
        accepted: null,
      },
    ],
    events: [
      { state: 'AwaitingPayment', at: acceptedAt, reason: 'credit_temporary_order_created' },
    ],
    canCancel: true,
    canPay: false,
    paymentAvailability: 'credit_settlement_pending',
  };
}
function result() {
  return {
    schemaVersion: 1,
    replayed: false,
    commandId,
    credit: {
      orderId,
      creditQuoteId: quoteId,
      applicationId: appId,
      scopeId,
      quoteFingerprint: 'C'.repeat(64),
      limitBasis: 'PayableTotalRial',
      limitAmountRial: authority().limitAmountRial,
      assessedAmountRial: authority().limitAmountRial,
      acceptedAt,
      settlementState: 'Pending',
      canPay: false,
    },
    order: order(),
  };
}
const environment = {
    SHOP_DATA_MODE: 'api',
    SHOP_API_URL: 'http://127.0.0.1:5080',
    SHOP_PUBLIC_URL: 'http://127.0.0.1:3000',
  },
  headers = {
    Authorization: 'Bearer ' + 'x'.repeat(32),
    Origin: environment.SHOP_PUBLIC_URL,
    Cookie: 'never-forward=1',
    'Content-Type': 'application/json',
  },
  path = '/api/credit-orders/commands/' + commandId;
test('credit order paths isolate creation, owned receipts, readiness and paginated history', () => {
  for (const verb of ['GET', 'POST']) assert.ok(isCreditOrderPath(path, verb));
  for (const p of [
    '/api/credit-orders/' + orderId,
    '/api/credit-orders/quotes',
    '/api/credit-orders/quotes?cursor=YWJj',
    '/api/credit-orders/quotes/' + quoteId + '/readiness',
  ])
    assert.ok(isCreditOrderPath(p));
  for (const p of [
    path + '?owner=foreign',
    path + '#hash',
    path + '/extra',
    '/api/credit-orders/quotes?cursor=abc&cursor=abc',
    '/api/credit-orders/quotes?owner=foreign',
    path.replace(commandId, '0'.repeat(32)),
  ])
    assert.equal(isCreditOrderPath(p), false);
  assert.equal(isCreditOrderPath('/api/credit-orders/' + orderId, 'POST'), false);
  assert.equal(isCreditOrderPath(path, 'PUT'), false);
});
test('input normalizes Persian contact digits and rejects client money, absent acknowledgements and nested authority', () => {
  const input = creditOrderInputSchema.parse({
    ...body(),
    contactPhone: '+۹۸ ۹۱۰-۰۰۰۰۰۰۰',
    delivery: { ...body().delivery, postalCode: '۱۲۳۴۵۶۷۸۹۰' },
  });
  assert.equal(input.contactPhone, '09100000000');
  assert.equal(input.delivery?.postalCode, '1234567890');
  for (const patch of [
    { amountRial: '1' },
    { ownerId: 'foreign' },
    { scopeId },
    { quoteAccepted: false },
    { acknowledgeTemporary: undefined },
    { delivery: { ...body().delivery, approved: true } },
  ])
    assert.equal(creditOrderInputSchema.safeParse({ ...body(), ...patch }).success, false);
  assert.ok(creditOrderCommandSchema.parse(cmd()));
  assert.equal('quoteSnapshot' in cmd().body, false);
});
test('receipt binds exact large rial, scope, quote, contact, expiry and original lines without claiming settlement', () => {
  const c = cmd();
  assert.equal(readCreditOrderResult(result(), c).order.payableTotalRial, '9007199254753338');
  for (const patch of [
    { commandId: orderId },
    { credit: { ...result().credit, scopeId: orderId } },
    { credit: { ...result().credit, limitAmountRial: '9007199254753339' } },
    { order: { ...order(), contactPhone: '09111111111' } },
    { order: { ...order(), canPay: true } },
    { order: { ...order(), lines: [{ ...order().lines[0], name: 'Changed item' }] } },
    { order: { ...order(), summary: { ...order().summary, expiresAt: '2026-10-27T12:04:00Z' } } },
  ])
    assert.throws(() => readCreditOrderResult({ ...result(), ...patch }, c));
  assert.ok(creditOrderResultSchema.parse({ ...result(), replayed: true }));
});
test('current cancelled order is distinct from immutable creation receipt and retains the original calculation', () => {
  const r = result(),
    o = order();
  const detail = {
    schemaVersion: 1,
    credit: r.credit,
    calculation: quote(),
    order: {
      ...o,
      summary: { ...o.summary, state: 'Cancelled' },
      canCancel: false,
      events: [
        ...o.events,
        { state: 'Cancelled', at: '2026-10-27T12:02:00Z', reason: 'unpaid_order_cancelled' },
      ],
    },
  };
  assert.ok(creditOrderDetailSchema.parse(detail));
  assert.equal(creditOrderResultSchema.safeParse({ ...r, order: detail.order }).success, false);
  assert.equal(
    creditOrderDetailSchema.safeParse({
      ...detail,
      calculation: { ...quote(), authority: { ...authority(), scopeId: orderId } },
    }).success,
    false,
  );
});
test('unknown order journal freezes full quote and input, keeps ambiguity through missing receipts and clears on account change', () => {
  const j = new CreditOrderJournal();
  j.bind('owner');
  const c = cmd();
  j.begin('owner', c);
  c.body.contactName = 'changed';
  j.interrupt();
  j.clear('owner');
  assert.equal(j.snapshot('owner')?.state, 'unknown');
  const retry = j.retry('owner');
  assert.equal(retry.body.contactName, 'Synthetic recipient');
  j.fail('owner', retry, 404, 'not_found');
  assert.equal(j.snapshot('owner')?.state, 'unknown');
  assert.throws(() => j.begin('owner', cmd()));
  assert.ok(j.finish('owner', retry, { ...result(), replayed: true }));
  j.bind('other');
  assert.equal(j.snapshot('owner'), null);
  assert.equal(j.finish('owner', retry, result()), false);
});
test('customer BFF is bounded cookie-free private JSON with strict input and receipt binding', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (target, init) => {
    calls++;
    assert.equal(target, environment.SHOP_API_URL + path);
    assert.equal(init?.credentials, 'omit');
    assert.equal(new Headers(init?.headers).get('Cookie'), null);
    assert.deepEqual(JSON.parse(String(init?.body)), body());
    return Response.json(result());
  };
  const call = (
    input: unknown = body(),
    extra: Record<string, string> = {},
    fetcherOverride = fetcher,
  ) =>
    proxyCreditOrders(
      new Request(environment.SHOP_PUBLIC_URL + path, {
        method: 'POST',
        headers: { ...headers, ...extra },
        body: JSON.stringify(input),
      }),
      environment,
      fetcherOverride,
    );
  const r = await call();
  assert.equal(r.status, 200);
  assert.match(r.headers.get('Cache-Control')!, /private, no-store/);
  assert.match(r.headers.get('X-Robots-Tag')!, /noindex/);
  assert.equal(r.headers.get('Set-Cookie'), null);
  assert.equal((await call({ ...body(), amountRial: '1' })).status, 400);
  assert.equal((await call(body(), { 'Content-Length': '16385' })).status, 413);
  assert.equal((await call(body(), { Origin: 'https://foreign.example' })).status, 403);
  assert.equal(calls, 1);
  assert.equal(
    (await call(body(), {}, async () => Response.json({ ...result(), commandId: orderId }))).status,
    503,
  );
  assert.equal(
    (
      await call(body(), {}, async () =>
        Response.json(result(), { headers: { 'Set-Cookie': 'not-allowed=1' } }),
      )
    ).status,
    503,
  );
  assert.equal(
    (
      await call(
        body(),
        {},
        async () =>
          new Response(new Uint8Array([255]), { headers: { 'Content-Type': 'application/json' } }),
      )
    ).status,
    503,
  );
});
test('history and readiness BFF permit only owned bounded read contracts and canonical query', async () => {
  const history = {
    schemaVersion: 1,
    items: [
      {
        id: quoteId,
        locale: 'en',
        createdAt: created,
        expiresAt: until,
        fingerprint: 'C'.repeat(64),
        planName: 'Synthetic',
        payableTotalRial: core().payableTotalRial,
        limitBasis: 'PayableTotalRial',
        limitAmountRial: authority().limitAmountRial,
        assessedAmountRial: authority().limitAmountRial,
        withinLimit: true,
        orderId: null,
      },
    ],
    nextCursor: null,
  };
  assert.ok(creditQuoteHistorySchema.parse(history));
  assert.equal(
    creditQuoteHistorySchema.safeParse({
      ...history,
      items: [{ ...history.items[0], payableTotalRial: 123 }],
    }).success,
    false,
  );
  const h = await proxyCreditOrders(
    new Request(environment.SHOP_PUBLIC_URL + '/api/credit-orders/quotes', { headers }),
    environment,
    async () => Response.json(history),
  );
  assert.equal(h.status, 200);
  const readyPath = '/api/credit-orders/quotes/' + quoteId + '/readiness',
    ready = {
      schemaVersion: 1,
      creditQuoteId: quoteId,
      fingerprint: 'C'.repeat(64),
      expiresAt: until,
      canCreate: true,
      blockers: [],
      canPay: false,
    };
  assert.equal(
    (
      await proxyCreditOrders(
        new Request(environment.SHOP_PUBLIC_URL + readyPath, { headers }),
        environment,
        async () => Response.json(ready),
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await proxyCreditOrders(
        new Request(environment.SHOP_PUBLIC_URL + readyPath, { headers }),
        environment,
        async () => Response.json({ ...ready, creditQuoteId: orderId }),
      )
    ).status,
    503,
  );
  const receipt = await proxyCreditOrders(
    new Request(environment.SHOP_PUBLIC_URL + path, { headers }),
    environment,
    async () => Response.json({ ...result(), replayed: true }),
  );
  assert.equal(receipt.status, 200);
});
test('authenticated session route gate attaches bearer and remote logout hides the frozen order journal', async () => {
  const session = {
      accessToken: 'x'.repeat(50),
      expiresIn: 600,
      requiresMfa: false,
      requiresEnrollment: false,
      user: { id: 'qa-credit-order', displayName: 'Synthetic', userName: 'qa' },
    },
    store = new CustomerSessionStore(
      async () => session,
      async () => session,
      async (f) => f(),
      () => false,
    ),
    original = globalThis.fetch;
  await store.login('qa', 'synthetic');
  customerCreditOrderJournal.begin(session.user.id, cmd());
  try {
    globalThis.fetch = async (target, init) => {
      assert.equal(target, '/api/credit-orders/quotes');
      assert.equal(
        new Headers(init?.headers).get('Authorization'),
        'Bearer ' + session.accessToken,
      );
      return Response.json({});
    };
    await store.fetch('/api/credit-orders/quotes');
    await assert.rejects(() => store.fetch('/api/credit-orders/quotes?owner=foreign'));
    store.remote('signout');
    assert.equal(customerCreditOrderJournal.snapshot(session.user.id), null);
  } finally {
    globalThis.fetch = original;
  }
});

test('explicit review hold binds the policy and original price deadline while retaining scope and stock boundaries', () => {
  const q = {
      ...quote(),
      expiresAt: core().expiresAt,
      authority: { ...authority(), expiresAt: '2026-10-27T13:00:00Z' },
    },
    policyVersion = 'AAAAAAAAAAI=',
    expiresAt = '2026-10-27T12:51:00Z',
    c = creditOrderCommandSchema.parse({
      ...cmd(),
      quoteSnapshot: q,
      body: { ...body(), reviewHoldPolicyVersion: policyVersion },
    }),
    r = {
      ...result(),
      order: { ...order(), summary: { ...order().summary, expiresAt } },
      reviewHold: {
        policyRevisionId: '4'.repeat(32),
        policyVersion,
        minutes: 60,
        quoteExpiresAt: q.expiresAt,
        expiresAt,
      },
    };
  assert.equal(readCreditOrderResult(r, c).reviewHold?.policyVersion, policyVersion);
  for (const wrong of [
    { ...r, reviewHold: { ...r.reviewHold, policyVersion: version } },
    { ...r, reviewHold: { ...r.reviewHold, quoteExpiresAt: '2026-10-27T12:04:00Z' } },
    { ...r, reviewHold: undefined },
    { ...r, reviewHold: { ...r.reviewHold, minutes: 30 } },
  ])
    assert.throws(() => readCreditOrderResult(wrong, c));
  const prior = cmd();
  assert.equal('reviewHoldPolicyVersion' in prior.body, false);
  assert.equal(JSON.stringify(creditOrderInputSchema.parse(body())), JSON.stringify(body()));
  assert.equal(readCreditOrderResult(result(), prior).reviewHold, undefined);
});
