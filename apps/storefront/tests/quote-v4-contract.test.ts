import assert from 'node:assert/strict';
import test from 'node:test';
import { quoteSnapshotV4Schema, quoteV4MatchesInput } from '../lib/checkout/quote-v4-contract.ts';
import {
  quoteSnapshotSchema,
  quoteInputSchema,
} from '@sayman/web-shared/lib/checkout/quote-contract.ts';
import { requestQuoteV4 } from '../lib/checkout/quote-v4-client.ts';
import {
  bindQuoteV4Owner,
  readQuoteV4Attempt,
  startQuoteV4Attempt,
  finishQuoteV4Attempt,
  failQuoteV4Attempt,
} from '../lib/checkout/quote-v4-journal.ts';
import { quote4Snapshot, quote4Method } from '@sayman/web-shared/testing/quote-v4.test-fixtures.ts';
import {
  CustomerSessionStore,
  SessionError,
  type CustomerSession,
} from '../lib/account/customer-session.ts';
const input = quoteInputSchema.parse({
  cartVersion: 'AAAAAAAAAAE=',
  methodId: 'cash',
  requestId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
});
test('Quote4 preserves ordinary and two agreed prices for the same SKU above 2^53', () => {
  const q = quoteSnapshotV4Schema.parse(quote4Snapshot());
  assert.equal(q.lines.length, 3);
  assert.equal(new Set(q.lines.map((l) => l.variantId)).size, 1);
  assert.equal(q.lines[1].unitPriceRial, '9007199254740993');
  assert.equal(q.itemsSubtotalRial, '9007199254742115');
  assert.equal(q.lines[1].priceVersion, null);
  assert.equal(q.lines[0].accepted, null);
  assert.equal(q.canPay, false);
});
test('Quote4 and historical Quote1–3 do not deserialize into each other', () => {
  assert.equal(quoteSnapshotSchema.safeParse(quote4Snapshot()).success, false);
  assert.equal(
    quoteSnapshotV4Schema.safeParse({ ...quote4Snapshot(), schemaVersion: 3 }).success,
    false,
  );
});
test('Quote4 rejects unknown fields, missing explicit provenance, malformed ids/versions and mismatched lanes', () => {
  const q = quote4Snapshot();
  for (const patch of [
    { ownerId: 'secret' },
    {
      lines: q.lines.map((l) =>
        l.lineKind === 'acceptedOffer' ? { ...l, accepted: undefined } : l,
      ),
    },
    { lines: q.lines.map((l) => ({ ...l, lineId: '0'.repeat(32) })) },
    { lines: q.lines.map((l) => (l.lineKind === 'ordinary' ? { ...l, priceVersion: null } : l)) },
    { lines: q.lines.map((l) => (l.accepted ? { ...l, priceVersion: 'AAAAAAAAAAE=' } : l)) },
    {
      lines: q.lines.map((l) =>
        l.accepted ? { ...l, accepted: { ...l.accepted, agreementVersion: 'AAAAAAAAAAB=' } } : l,
      ),
    },
  ])
    assert.equal(quoteSnapshotV4Schema.safeParse({ ...q, ...patch }).success, false);
});
test('Quote4 rejects duplicate identity while permitting equal variant identity', () => {
  const q = quote4Snapshot();
  for (const lines of [
    [q.lines[0], q.lines[1], q.lines[1]],
    q.lines.map((l, i) => (i === 2 ? { ...l, lineId: q.lines[1].lineId } : l)),
    q.lines.map((l, i) =>
      i === 2
        ? {
            ...l,
            accepted: {
              ...q.lines[1].accepted!,
              agreementLineId: l.accepted!.agreementLineId,
              offerLineId: l.accepted!.offerLineId,
              allocationVersion: 'AAAAAAAAAAQ=',
            },
          }
        : l,
    ),
    q.lines.map((l, i) =>
      i === 2
        ? { ...l, accepted: { ...l.accepted!, acceptanceId: q.lines[1].accepted!.acceptanceId } }
        : l,
    ),
  ])
    assert.equal(quoteSnapshotV4Schema.safeParse({ ...q, lines }).success, false);
});
test('Quote4 rejects forged totals, unsafe numeric money, aggregate limits and quantity edits', () => {
  const q = quote4Snapshot();
  for (const patch of [
    { itemsSubtotalRial: '1' },
    { payableTotalRial: '0' },
    {
      lines: q.lines.map((l, i) =>
        i === 1 ? { ...l, unitPriceRial: Number('9007199254740993') } : l,
      ),
    },
    { lines: q.lines.map((l, i) => (i === 1 ? { ...l, quantity: 2 } : l)) },
    {
      lines: q.lines.map((l) => ({
        ...l,
        quantity: 1000000,
        unitPriceRial: '1',
        lineTotalRial: '1000000',
      })),
      itemsSubtotalRial: '3000000',
      goodsTotalRial: '3000000',
    },
  ])
    assert.equal(quoteSnapshotV4Schema.safeParse({ ...q, ...patch }).success, false);
});
test('Quote4 always fences ordering, payment and temporary ordering', () => {
  const q = quote4Snapshot(true);
  for (const patch of [
    { canPay: true },
    { canPlaceOrder: true },
    { blockers: [] },
    { temporaryOrder: { ...q.temporaryOrder, canCreate: true } },
    { temporaryOrder: { ...q.temporaryOrder, blockers: [] } },
    { temporaryOrder: null },
    { chargeRules: null },
  ])
    assert.equal(quoteSnapshotV4Schema.safeParse({ ...q, ...patch }).success, false);
});
test('Quote4 preview and saved quote have fixed UTC deadlines bounded by every hold and five minutes', () => {
  const q = quote4Snapshot();
  assert.equal(quoteSnapshotV4Schema.safeParse(q).success, true);
  for (const patch of [
    { expiresAt: null },
    { expiresAt: q.createdAt },
    { expiresAt: '2026-10-24T12:05:01Z' },
    { expiresAt: '2026-10-24T12:04:01Z' },
    { createdAt: '2026-10-24T15:30:00+03:30' },
    {
      lines: q.lines.map((l) =>
        l.accepted
          ? { ...l, accepted: { ...l.accepted, purchaseUntil: '2026-10-24T12:03:00Z' } }
          : l,
      ),
    },
  ])
    assert.equal(quoteSnapshotV4Schema.safeParse({ ...q, ...patch }).success, false);
});
test('Quote4 selected method must be the exact eligible method and preview cannot impersonate a saved quote', () => {
  const q = quote4Snapshot(true);
  assert.equal(quoteV4MatchesInput(q, 'en', input).quoteId, q.quoteId);
  for (const patch of [
    { quoteId: null },
    { selectedMethod: { ...quote4Method, requiresApproval: true } },
    { selectedMethod: { ...quote4Method, name: 'Forged' } },
    { methods: [{ ...quote4Method, enabled: false }] },
  ])
    assert.equal(quoteSnapshotV4Schema.safeParse({ ...q, ...patch }).success, false);
  assert.throws(() => quoteV4MatchesInput(q, 'fa', input));
  assert.throws(() => quoteV4MatchesInput(q, 'en', { ...input, cartVersion: 'AAAAAAAAAAI=' }));
});
test('Quote4 validates shipping/tax and included tax with exact integer arithmetic', () => {
  const q = quote4Snapshot();
  const charged = {
    ...q,
    shippingRial: '1999',
    taxRial: '9007199254744114',
    payableTotalRial: '9007199254744114',
    chargeRules: {
      ...q.chargeRules,
      version: 'AAAAAAAAAAI=',
      shippingMode: 'flat',
      shippingFeeRial: '1999',
      shippingReason: 'flat',
      taxMode: 'inclusive',
      taxRateBasisPoints: 10000,
      taxBase: 'goods_shipping',
      taxableBaseRial: '9007199254744114',
      taxIncluded: true,
      taxRounding: 'up',
    },
  };
  charged.taxRial = '4503599627372057';
  assert.equal(quoteSnapshotV4Schema.safeParse(charged).success, true);
  assert.equal(
    quoteSnapshotV4Schema.safeParse({ ...charged, payableTotalRial: '13510798882116171' }).success,
    false,
  );
});
test('Quote4 cheque review preserves exact principal, markup, schedule and configured plan', () => {
  const q = quote4Snapshot(true),
    method = { ...quote4Method, id: 'cheque', kind: 'cheque', requiresApproval: true },
    plan = {
      id: 'six',
      name: 'Six months',
      months: 6,
      markupBasisPoints: 1250,
      downPaymentBasisPoints: 2500,
      intervalMonths: 2,
      roundingUnitRial: 10,
      enabled: true,
      categoryIds: [],
      minAmountRial: null,
      maxAmountRial: null,
    };
  const value = {
    ...q,
    lines: [{ ...q.lines[1], unitPriceRial: '100003', lineTotalRial: '100003' }],
    itemsSubtotalRial: '100003',
    markupRial: '9380',
    downPaymentRial: '25010',
    goodsTotalRial: '109383',
    methods: [method],
    plans: [plan],
    selectedMethod: method,
    selectedPlan: plan,
    requiresApproval: true,
    installments: [
      { sequence: 1, monthOffset: 2, amountRial: '28120' },
      { sequence: 2, monthOffset: 4, amountRial: '28120' },
      { sequence: 3, monthOffset: 6, amountRial: '28133' },
    ],
    chargeRules: { ...q.chargeRules, taxableBaseRial: '109383' },
  };
  assert.equal(quoteSnapshotV4Schema.safeParse(value).success, true);
  for (const patch of [
    { requiresApproval: false },
    { installments: [] },
    { selectedPlan: { ...plan, name: 'Forged' } },
    {
      installments: value.installments.map((i, n) => (n === 2 ? { ...i, amountRial: '28132' } : i)),
    },
  ])
    assert.equal(quoteSnapshotV4Schema.safeParse({ ...value, ...patch }).success, false);
});
test('Quote4 client rejects oversized, malformed, cross-contract and foreign input responses without fallback', async () => {
  for (const response of [
    new Response('x'.repeat(524289)),
    new Response(new Uint8Array([255])),
    Response.json({ ...quote4Snapshot(true), schemaVersion: 3 }),
    Response.json({ ...quote4Snapshot(true), cartVersion: 'AAAAAAAAAAI=' }),
  ])
    await assert.rejects(requestQuoteV4(async () => response, 'en', input));
  await assert.rejects(
    requestQuoteV4(
      async () => Response.json({ title: 'private <secret>' }, { status: 500 }),
      'en',
      input,
    ),
    (e) => e instanceof Error && e.message === 'quote_unavailable',
  );
});
test('Quote4 RAM journal freezes retries, survives uncertainty and clears only for verified owner changes or explicit resolution', async () => {
  bindQuoteV4Owner(null);
  bindQuoteV4Owner('owner');
  const started = startQuoteV4Attempt('owner', 'en', input);
  started.input.methodId = 'forged';
  assert.equal(readQuoteV4Attempt('owner')!.input.methodId, 'cash');
  assert.equal(readQuoteV4Attempt('foreign'), null);
  const sent: string[] = [];
  const transport = async (_path: string, init: RequestInit) => {
    sent.push(init.body as string);
    if (sent.length === 1) throw new Error('response_lost');
    return Response.json(quote4Snapshot(true));
  };
  await assert.rejects(requestQuoteV4(transport, 'en', readQuoteV4Attempt('owner')!.input));
  assert.equal(failQuoteV4Attempt('owner', input.requestId!, 0), true);
  assert.equal(failQuoteV4Attempt('owner', input.requestId!, 409), true);
  assert.throws(() =>
    startQuoteV4Attempt('owner', 'en', {
      ...input,
      requestId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
    }),
  );
  bindQuoteV4Owner('owner');
  await requestQuoteV4(transport, 'en', readQuoteV4Attempt('owner')!.input);
  assert.equal(sent[0], sent[1]);
  assert.equal(finishQuoteV4Attempt('foreign', input.requestId!), false);
  assert.equal(finishQuoteV4Attempt('owner', input.requestId!), true);
  assert.equal(readQuoteV4Attempt('owner'), null);
  startQuoteV4Attempt('owner', 'en', input);
  bindQuoteV4Owner('other');
  assert.equal(readQuoteV4Attempt('owner'), null);
  bindQuoteV4Owner(null);
});
test('Quote4 pending calculation survives failed refresh only for the same verified owner and is cleared by logout', async () => {
  const session = (owner: string): CustomerSession => ({
    accessToken: 'a'.repeat(30),
    expiresIn: 300,
    requiresMfa: false,
    requiresEnrollment: false,
    user: { id: owner, displayName: 'QA', userName: 'qa' },
  });
  let owner = 'owner',
    unavailable = false;
  const store = new CustomerSessionStore(
    async () => undefined,
    async () => {
      if (unavailable) throw new SessionError('unavailable');
      return session(owner);
    },
    async (run) => run(),
    () => false,
  );
  await store.restore();
  startQuoteV4Attempt('owner', 'en', input);
  failQuoteV4Attempt('owner', input.requestId!, 0);
  unavailable = true;
  await store.restore();
  assert.equal(store.snapshot().status, 'unavailable');
  await assert.rejects(store.fetch('/api/cart/en/v2/quote', { method: 'POST' }));
  assert.ok(readQuoteV4Attempt('owner'));
  unavailable = false;
  await store.restore();
  assert.ok(readQuoteV4Attempt('owner'));
  owner = 'other';
  await store.restore();
  assert.equal(readQuoteV4Attempt('owner'), null);
  startQuoteV4Attempt('other', 'en', input);
  await store.logout();
  assert.equal(readQuoteV4Attempt('other'), null);
});
test('a delayed Quote4 response after an account switch cannot return private prices or settle another owner’s request', async (t) => {
  let owner = 'first';
  const session = (): CustomerSession => ({
      accessToken: 'a'.repeat(30),
      expiresIn: 300,
      requiresMfa: false,
      requiresEnrollment: false,
      user: { id: owner, displayName: 'QA', userName: 'qa' },
    }),
    store = new CustomerSessionStore(
      async () => undefined,
      async () => session(),
      async (run) => run(),
      () => false,
    );
  await store.restore();
  startQuoteV4Attempt('first', 'en', input);
  let release: (response: Response) => void = () => {};
  const response = new Promise<Response>((resolve) => {
    release = resolve;
  });
  t.mock.method(globalThis, 'fetch', async (_path: string, init: RequestInit) => {
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer ' + 'a'.repeat(30));
    return response;
  });
  const waiting = requestQuoteV4(store.fetch, 'en', input);
  store.remote('signout');
  owner = 'second';
  await store.restore();
  startQuoteV4Attempt('second', 'en', {
    ...input,
    requestId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
  });
  release(Response.json(quote4Snapshot(true)));
  await assert.rejects(waiting, (e) => e instanceof SessionError && e.kind === 'changed');
  assert.equal(readQuoteV4Attempt('first'), null);
  assert.equal(finishQuoteV4Attempt('first', input.requestId!), false);
  assert.equal(
    readQuoteV4Attempt('second')!.input.requestId,
    'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
  );
  store.remote('signout');
});
test('a different verified owner returned by refresh also rejects an earlier 200 without a login/logout event', async (t) => {
  let owner = 'first';
  const session = (): CustomerSession => ({
      accessToken: (owner === 'first' ? 'a' : 'b').repeat(30),
      expiresIn: 300,
      requiresMfa: false,
      requiresEnrollment: false,
      user: { id: owner, displayName: 'QA', userName: 'qa' },
    }),
    store = new CustomerSessionStore(
      async () => undefined,
      async () => session(),
      async (run) => run(),
      () => false,
    );
  await store.restore();
  startQuoteV4Attempt('first', 'en', input);
  let release: (response: Response) => void = () => {};
  const response = new Promise<Response>((resolve) => {
    release = resolve;
  });
  t.mock.method(globalThis, 'fetch', async () => response);
  const waiting = requestQuoteV4(store.fetch, 'en', input);
  owner = 'second';
  await store.restore(true);
  assert.equal(store.snapshot().session?.user.id, 'second');
  release(Response.json(quote4Snapshot(true)));
  await assert.rejects(waiting, (e) => e instanceof SessionError && e.kind === 'changed');
  assert.equal(readQuoteV4Attempt('first'), null);
  store.remote('signout');
});
