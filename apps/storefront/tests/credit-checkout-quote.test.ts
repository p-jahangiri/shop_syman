import test from 'node:test';
import assert from 'node:assert/strict';
import {
  creditCheckoutQuoteInputSchema,
  creditCheckoutQuoteCommandSchema,
  creditCheckoutQuoteSchema,
  readCreditCheckoutQuoteResult,
  isCreditCheckoutQuotePath,
  creditCheckoutQuoteCommandPath,
  type CreditCheckoutQuoteCommand,
} from '@sayman/web-shared/lib/credit/credit-checkout-quote-contract.ts';
import {
  CreditCheckoutQuoteJournal,
  customerCreditCheckoutQuoteJournal,
} from '../lib/credit/credit-checkout-quote-journal.ts';
import { proxyCreditCheckoutQuote } from '../lib/credit/credit-checkout-quote-proxy.ts';
import { proxyCartV2 } from '../lib/checkout/cart-v2-proxy.ts';
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
function command(): CreditCheckoutQuoteCommand {
  return {
    id: commandId,
    locale: 'en',
    body: {
      cartVersion: version,
      methodId: 'cheque',
      planId: 'qa',
      applicationId: appId,
      scopeId,
      applicationVersion: version,
      scopeVersion: version,
    },
    scopeSnapshot: {
      reviewId,
      submissionId: subId,
      limitBasis: 'PayableTotalRial',
      limitAmountRial: '9007199254753338',
      expiresAt: until,
    },
  };
}
const result = () => ({ schemaVersion: 1, replayed: false, commandId, quote: quote() });
test('private cheque quote paths accept scoped POST and GET receipts and reject injection or unsupported writes', () => {
  for (const locale of ['fa', 'en']) {
    const path = '/api/cart/' + locale + '/v2/credit-quote/commands/' + commandId;
    for (const method of ['GET', 'POST']) assert.ok(isCreditCheckoutQuotePath(path, method));
    for (const extra of ['?owner=forged', '#hash', '/extra'])
      assert.equal(isCreditCheckoutQuotePath(path + extra, 'GET'), false);
    assert.equal(isCreditCheckoutQuotePath(path, 'PUT'), false);
    assert.ok(isCreditCheckoutQuotePath('/api/cart/' + locale + '/v2/credit-quotes/' + quoteId));
    assert.equal(isCreditCheckoutQuotePath(path.replace(commandId, '0'.repeat(32)), 'POST'), false);
  }
  assert.equal(
    creditCheckoutQuoteCommandPath(command()),
    '/api/cart/en/v2/credit-quote/commands/' + commandId,
  );
});
test('input is selection and versions only; frozen scope metadata is separate from transmitted body', () => {
  const c = command();
  assert.ok(creditCheckoutQuoteCommandSchema.parse(c));
  for (const patch of [
    { payableTotalRial: '1' },
    { limitAmountRial: '1' },
    { ownerId: 'forged' },
    { expiresAt: until },
    { scopeVersion: 'bad' },
    { methodId: 'Cash' },
  ])
    assert.equal(creditCheckoutQuoteInputSchema.safeParse({ ...c.body, ...patch }).success, false);
  assert.equal('scopeSnapshot' in c.body, false);
});
test('server quote assessment preserves large rial and exactly clips expiry to the purchase authority', () => {
  const q = creditCheckoutQuoteSchema.parse(quote());
  assert.equal(q.assessment.assessedAmountRial, '9007199254753338');
  assert.equal(q.ordinaryQuote!.itemsSubtotalRial, '9007199254740993');
  assert.equal(q.canPlaceOrder, false);
  assert.equal(q.canPay, false);
  for (const patch of [
    { canPlaceOrder: true },
    { canPay: true },
    { expiresAt: '2026-10-27T12:04:00Z' },
    { assessment: { ...quote().assessment, assessedAmountRial: '9007199254753337' } },
    { assessment: { ...quote().assessment, withinLimit: false } },
    { assessment: { ...quote().assessment, blockers: [] } },
    { authority: { ...authority(), planId: 'wrong' } },
    { ordinaryQuote: { ...core(), goodsTotalRial: Number('9007199254740993') } },
  ])
    assert.throws(() => creditCheckoutQuoteSchema.parse({ ...quote(), ...patch }));
});
test('installments basis excludes down payment and separate delivery but retains missing charge blockers', () => {
  const q = quote(),
    c = core();
  const unknown = {
    ...c,
    shippingRial: null,
    taxRial: null,
    payableTotalRial: null,
    blockers: ['tax_unconfigured', 'shipping_unconfigured', 'credit_approval_required'],
    chargeRules: {
      ...c.chargeRules,
      shippingMode: 'unconfigured',
      shippingName: '',
      shippingDescription: '',
      shippingFeeRial: null,
      shippingReason: 'unconfigured',
      taxMode: 'unconfigured',
    },
  };
  const own = {
    ...q,
    authority: {
      ...authority(),
      limitBasis: 'InstallmentsTotalRial',
      limitAmountRial: '9007199254740993',
    },
    assessment: {
      limitBasis: 'InstallmentsTotalRial',
      limitAmountRial: '9007199254740993',
      assessedAmountRial: '9007199254740993',
      withinLimit: true,
      blockers: [
        'tax_unconfigured',
        'shipping_unconfigured',
        'credit_quote_final_charges_unavailable',
        'credit_order_not_configured',
      ],
    },
    ordinaryQuote: unknown,
  };
  assert.ok(creditCheckoutQuoteSchema.parse(own));
  assert.throws(() =>
    creditCheckoutQuoteSchema.parse({
      ...own,
      assessment: { ...own.assessment, blockers: ['credit_order_not_configured'] },
    }),
  );
});
test('receipt binds command cart method plan versions and exact approved snapshot while remaining historical after expiry', () => {
  const c = command();
  assert.ok(readCreditCheckoutQuoteResult(result(), c));
  assert.ok(readCreditCheckoutQuoteResult({ ...result(), replayed: true }, c));
  for (const changed of [
    { ...c, body: { ...c.body, cartVersion: 'AAAAAAAAAAI=' } },
    { ...c, scopeSnapshot: { ...c.scopeSnapshot, limitAmountRial: '1' } },
    { ...c, scopeSnapshot: { ...c.scopeSnapshot, expiresAt: '2026-10-27T12:02:00Z' } },
    { ...c, body: { ...c.body, scopeId: subId } },
    { ...c, id: subId },
  ])
    assert.throws(() => readCreditCheckoutQuoteResult(result(), changed));
});
test('unknown quote journal retains UUID and frozen approval; an account switch and remote logout hide it', async () => {
  const j = new CreditCheckoutQuoteJournal(),
    c = command();
  j.bind('owner');
  j.begin('owner', c);
  c.scopeSnapshot.limitAmountRial = '1';
  j.interrupt();
  j.clear('owner');
  assert.equal(j.snapshot('owner')!.state, 'unknown');
  const retry = j.retry('owner');
  assert.equal(retry.scopeSnapshot.limitAmountRial, '9007199254753338');
  j.fail('owner', retry, 404, 'not_found');
  assert.equal(j.snapshot('owner')!.state, 'unknown');
  assert.throws(() => j.begin('owner', command()));
  assert.ok(j.finish('owner', retry, { ...result(), replayed: true }));
  j.bind('other');
  assert.equal(j.snapshot('owner'), null);
  const session = {
      accessToken: 'x'.repeat(50),
      expiresIn: 600,
      requiresMfa: false,
      requiresEnrollment: false,
      user: { id: 'qa-credit-quote', displayName: 'Synthetic', userName: 'qa' },
    },
    store = new CustomerSessionStore(
      async () => session,
      async () => session,
      async (f) => f(),
      () => false,
    );
  await store.login('qa', 'synthetic');
  customerCreditCheckoutQuoteJournal.begin('qa-credit-quote', command());
  store.remote('signout');
  assert.equal(customerCreditCheckoutQuoteJournal.snapshot('qa-credit-quote'), null);
});
test('BFF requires bearer and same origin, strips cookies and binds the request to the private result', async () => {
  const env = {
      SHOP_DATA_MODE: 'api',
      SHOP_API_URL: 'http://127.0.0.1:5080',
      SHOP_PUBLIC_URL: 'http://127.0.0.1:3000',
    },
    c = command(),
    path = creditCheckoutQuoteCommandPath(c),
    headers = {
      Authorization: 'Bearer ' + 'x'.repeat(32),
      Cookie: 'never-forward=1',
      Origin: env.SHOP_PUBLIC_URL,
      'Content-Type': 'application/json',
    };
  const request = (body: unknown = c.body, h = headers) =>
    new Request(env.SHOP_PUBLIC_URL + path, {
      method: 'POST',
      headers: h,
      body: JSON.stringify(body),
    });
  let seen = 0;
  const fetcher: typeof fetch = async (target, init) => {
    seen++;
    assert.equal(target, env.SHOP_API_URL + path);
    assert.equal(new Headers(init?.headers).get('Cookie'), null);
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.cache, 'no-store');
    assert.deepEqual(JSON.parse(String(init?.body)), c.body);
    return Response.json(result());
  };
  assert.equal((await proxyCreditCheckoutQuote(request(), env, fetcher)).status, 200);
  assert.equal(
    (await proxyCartV2(request(), 'en', ['credit-quote', 'commands', commandId], env, fetcher))
      .status,
    200,
  );
  const count = seen;
  assert.equal(
    (await proxyCreditCheckoutQuote(request({ ...c.body, ownerId: 'forged' }), env, fetcher))
      .status,
    400,
  );
  assert.equal(
    (
      await proxyCreditCheckoutQuote(
        request(c.body, { ...headers, Origin: 'http://foreign.test' }),
        env,
        fetcher,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await proxyCreditCheckoutQuote(
        request(c.body, { ...headers, Authorization: '' }),
        env,
        fetcher,
      )
    ).status,
    401,
  );
  assert.equal(seen, count);
  const denied = await proxyCreditCheckoutQuote(request(), env, async () =>
    Response.json(result(), { headers: { 'Set-Cookie': 'forbidden=1' } }),
  );
  assert.equal(denied.status, 503);
  assert.equal(denied.headers.get('Set-Cookie'), null);
  assert.match(denied.headers.get('Cache-Control')!, /no-store/);
});
test('BFF validates exact receipt/detail IDs and response limits; it never forwards an unrelated upstream snapshot', async () => {
  const env = {
      SHOP_DATA_MODE: 'api',
      SHOP_API_URL: 'http://127.0.0.1:5080',
      SHOP_PUBLIC_URL: 'http://127.0.0.1:3000',
    },
    path = creditCheckoutQuoteCommandPath(command()),
    headers = { Authorization: 'Bearer ' + 'x'.repeat(32) };
  assert.equal(
    (
      await proxyCreditCheckoutQuote(
        new Request(env.SHOP_PUBLIC_URL + path, { headers }),
        env,
        async () => Response.json({ ...result(), replayed: true }),
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await proxyCreditCheckoutQuote(
        new Request(env.SHOP_PUBLIC_URL + path, { headers }),
        env,
        async () => Response.json({ ...result(), replayed: true, commandId: subId }),
      )
    ).status,
    503,
  );
  const detail = '/api/cart/en/v2/credit-quotes/' + quoteId;
  assert.equal(
    (
      await proxyCreditCheckoutQuote(
        new Request(env.SHOP_PUBLIC_URL + detail, { headers }),
        env,
        async () => Response.json(quote()),
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await proxyCreditCheckoutQuote(
        new Request(env.SHOP_PUBLIC_URL + detail, { headers }),
        env,
        async () => Response.json({ ...quote(), id: subId }),
      )
    ).status,
    503,
  );
  assert.equal(
    (
      await proxyCreditCheckoutQuote(
        new Request(env.SHOP_PUBLIC_URL + detail, { headers }),
        env,
        async () => Response.json(quote(), { headers: { 'Content-Length': '1048577' } }),
      )
    ).status,
    503,
  );
});

test('customer session permits only the exact cheque quote path and uses the authenticated account bearer', async () => {
  const session = {
      accessToken: 'x'.repeat(50),
      expiresIn: 600,
      requiresMfa: false,
      requiresEnrollment: false,
      user: { id: 'qa-credit-network', displayName: 'Synthetic', userName: 'qa' },
    },
    store = new CustomerSessionStore(
      async () => session,
      async () => session,
      async (f) => f(),
      () => false,
    );
  await store.login('qa', 'synthetic');
  const saved = globalThis.fetch;
  let seen = 0;
  try {
    globalThis.fetch = async (path, init) => {
      seen++;
      assert.equal(path, creditCheckoutQuoteCommandPath(command()));
      assert.equal(
        new Headers(init?.headers).get('Authorization'),
        'Bearer ' + session.accessToken,
      );
      return Response.json(result());
    };
    assert.equal(
      (
        await store.fetch(creditCheckoutQuoteCommandPath(command()), {
          method: 'POST',
          body: JSON.stringify(command().body),
        })
      ).status,
      200,
    );
    await assert.rejects(
      store.fetch(creditCheckoutQuoteCommandPath(command()) + '?owner=forged', { method: 'GET' }),
    );
    assert.equal(seen, 1);
  } finally {
    globalThis.fetch = saved;
    store.remote('signout');
  }
});

test('a fully prepaid cheque plan retains the server zero-financing result for ordinary and accepted-offer quotes', () => {
  const base = core(),
    prepaid = { ...plan, downPaymentBasisPoints: 10000 },
    ordinary = {
      ...base,
      plans: [prepaid],
      selectedPlan: prepaid,
      downPaymentRial: base.goodsTotalRial,
      installments: [],
    };
  assert.ok(creditCheckoutQuoteSchema.parse({ ...quote(), ordinaryQuote: ordinary }));
  const accepted = {
    conversionId: '2'.repeat(32),
    agreementId: '3'.repeat(32),
    agreementLineId: '4'.repeat(32),
    requestId: '5'.repeat(32),
    taskId: '6'.repeat(32),
    offerId: '7'.repeat(32),
    acceptanceId: '8'.repeat(32),
    allocationId: '9'.repeat(32),
    offerLineId: 'a'.repeat(32),
    termsHash: 'A'.repeat(64),
    agreementVersion: version,
    allocationVersion: version,
    purchaseUntil: '2026-10-27T12:10:00Z',
    allocationExpiresAt: '2026-10-27T12:05:00Z',
    revision: 1,
    snapshotHash: 'B'.repeat(64),
    termsFa: 'شرایط ساختگی',
    termsEn: 'Synthetic terms',
    materialFingerprint: 'C'.repeat(64),
    containsDemo: false,
  };
  const mixed = {
    ...ordinary,
    schemaVersion: 5,
    canPay: false,
    lines: [
      {
        ...ordinary.lines[0],
        lineId: 'b'.repeat(32),
        lineKind: 'acceptedOffer',
        priceVersion: null,
        accepted,
      },
    ],
  };
  assert.ok(
    creditCheckoutQuoteSchema.parse({ ...quote(), ordinaryQuote: null, acceptedQuote: mixed }),
  );
  assert.throws(() =>
    creditCheckoutQuoteSchema.parse({
      ...quote(),
      ordinaryQuote: null,
      acceptedQuote: { ...mixed, downPaymentRial: '0' },
    }),
  );
});
