import assert from 'node:assert/strict';
import test from 'node:test';
import { quoteSnapshotV4Schema } from '../lib/checkout/quote-v4-contract.ts';
import { quoteSnapshotV5Schema } from '@sayman/web-shared/lib/checkout/quote-v5-contract.ts';
import {
  orderDetailV2Schema,
  orderPageV2Schema,
} from '@sayman/web-shared/lib/orders/order-v2-contract.ts';
import { orderDetailSchema } from '@sayman/web-shared/lib/orders/order-contract.ts';
import {
  createOrderV2,
  readOrderV2,
  cancelOrderV2,
  listOrdersV2,
} from '../lib/orders/order-v2-client.ts';
import { requestQuoteV5 } from '../lib/checkout/quote-v5-client.ts';
import {
  bindQuoteV5Owner,
  startQuoteV5Attempt,
  readQuoteV5Attempt,
  failQuoteV5Attempt,
  finishQuoteV5Attempt,
} from '../lib/checkout/quote-v5-journal.ts';
import {
  bindOrderV2Owner,
  startOrderV2Attempt,
  readOrderV2Attempt,
  failOrderV2Attempt,
  finishOrderV2Attempt,
} from '../lib/orders/order-v2-journal.ts';
import {
  CustomerSessionStore,
  SessionError,
  type CustomerSession,
} from '../lib/account/customer-session.ts';
import { quote4Snapshot } from '@sayman/web-shared/testing/quote-v4.test-fixtures.ts';
import {
  quote5Snapshot,
  order2Detail,
  order2Input,
  order2Id,
} from '@sayman/web-shared/testing/order-v2.test-fixtures.ts';
import { CartError } from '../lib/checkout/cart-client.ts';
const quoteInput = {
  cartVersion: 'AAAAAAAAAAE=',
  methodId: 'cash',
  planId: null,
  requestId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
};
test('Quote5 is an independent full-terms order quote; Quote4 remains calculator-only', () => {
  const q = quoteSnapshotV5Schema.parse(quote5Snapshot());
  assert.equal(q.schemaVersion, 5);
  assert.equal(q.temporaryOrder.canCreate, true);
  assert.equal(q.canPay, false);
  assert.equal(q.lines[1].accepted!.termsEn, 'QA sample accepted terms');
  assert.equal(q.lines[1].unitPriceRial, '9007199254740993');
  assert.equal(quoteSnapshotV5Schema.safeParse(quote4Snapshot(true)).success, false);
  assert.equal(quoteSnapshotV4Schema.safeParse(quote5Snapshot()).success, false);
  assert.equal(quoteSnapshotV4Schema.parse(quote4Snapshot(true)).temporaryOrder.canCreate, false);
  assert.equal(quoteSnapshotV5Schema.safeParse(quote5Snapshot(false)).success, true);
  assert.equal(quoteSnapshotV5Schema.safeParse(quote5Snapshot(true, false)).success, true);
});
test('Quote5 rejects fake capabilities, missing accepted terms and deadline/amount authority changes', () => {
  const q = quote5Snapshot();
  for (const patch of [
    { canPay: true },
    { canPlaceOrder: true },
    { temporaryOrder: { ...q.temporaryOrder, settingsVersion: null } },
    { temporaryOrder: { ...q.temporaryOrder, blockers: ['temporary_orders_disabled'] } },
    { quoteId: null },
    { requiresApproval: true },
    { expiresAt: '2026-10-24T12:05:00Z' },
    { itemsSubtotalRial: '1' },
    {
      lines: q.lines.map((l) =>
        l.accepted ? { ...l, accepted: { ...l.accepted, termsFa: '' } } : l,
      ),
    },
    {
      lines: q.lines.map((l) =>
        l.accepted ? { ...l, accepted: { ...l.accepted, materialFingerprint: 'invalid' } } : l,
      ),
    },
    { lines: q.lines.map((l) => (l.accepted ? { ...l, accepted: undefined } : l)) },
  ])
    assert.equal(quoteSnapshotV5Schema.safeParse({ ...q, ...patch }).success, false);
});
test('Order2 retains independent prices and line identities for ordinary and two accepted groups sharing one SKU', () => {
  const order = orderDetailV2Schema.parse(order2Detail());
  assert.equal(order.lines.length, 3);
  assert.equal(new Set(order.lines.map((l) => l.variantId)).size, 1);
  assert.equal(new Set(order.lines.map((l) => l.lineId)).size, 3);
  assert.equal(order.lines[1].unitPriceRial, '9007199254740993');
  assert.equal(order.originalSnapshotVersion, 2);
  const old = order2Detail(),
    legacyLine = { ...old.lines[0], categoryId: null, priceVersion: null };
  const legacy = {
    ...old,
    originalSnapshotVersion: 1,
    summary: { ...old.summary, originalSnapshotVersion: 1, itemCount: 1, payableTotalRial: '130' },
    lines: [legacyLine],
    events: old.events.map((e) => ({ ...e, reason: 'temporary_order_created' })),
    itemsSubtotalRial: '123',
    goodsTotalRial: '123',
    payableTotalRial: '130',
  };
  assert.equal(orderDetailV2Schema.safeParse(legacy).success, true);
  assert.equal(
    orderPageV2Schema.safeParse({ schemaVersion: 2, items: [legacy.summary, order.summary] })
      .success,
    false,
  );
  assert.equal(
    orderPageV2Schema.safeParse({
      schemaVersion: 2,
      items: [legacy.summary, { ...order.summary, id: 'f'.repeat(32) }],
    }).success,
    true,
  );
});
test('Order2 admits its exact server creation event without changing the V1 reason grammar', () => {
  const o = order2Detail();
  assert.equal(o.events[0].reason, 'temporary_order_v2_created');
  assert.equal(orderDetailV2Schema.safeParse(o).success, true);
  for (const reason of [
    'temporary_order_v3_created',
    'temporary_order_v22_created',
    'order_2_paid',
    'temporary_order_v2_created<script>',
  ])
    assert.equal(
      orderDetailV2Schema.safeParse({ ...o, events: o.events.map((e) => ({ ...e, reason })) })
        .success,
      false,
    );
  assert.equal(orderDetailSchema.shape.events.element.safeParse(o.events[0]).success, false);
  assert.equal(
    orderDetailSchema.shape.events.element.safeParse({
      ...o.events[0],
      reason: 'temporary_order_created',
    }).success,
    true,
  );
  const line = { ...o.lines[0], categoryId: null, priceVersion: null },
    legacy = {
      ...o,
      originalSnapshotVersion: 1,
      summary: { ...o.summary, originalSnapshotVersion: 1, itemCount: 1, payableTotalRial: '130' },
      lines: [line],
      itemsSubtotalRial: '123',
      goodsTotalRial: '123',
      payableTotalRial: '130',
    };
  assert.equal(orderDetailV2Schema.safeParse(legacy).success, false);
});
test('Order2 rejects downgraded legacy display, inconsistent item count, authority, duplicate lines and staff ownership', () => {
  const o = order2Detail();
  for (const patch of [
    { schemaVersion: 1 },
    { originalSnapshotVersion: 1 },
    { summary: { ...o.summary, itemCount: 2 } },
    { summary: { ...o.summary, ownerId: 'staff-only' } },
    { canPay: true },
    { canCancel: false },
    { payableTotalRial: '1' },
    { lines: [o.lines[0], o.lines[0], o.lines[2]] },
    {
      lines: o.lines.map((l) =>
        l.accepted
          ? { ...l, accepted: { ...l.accepted, allocationExpiresAt: '2026-10-24T12:02:00Z' } }
          : l,
      ),
    },
    { lines: o.lines.map((l) => ({ ...l, lineKind: 'ordinary', accepted: null })) },
  ])
    assert.equal(orderDetailV2Schema.safeParse({ ...o, ...patch }).success, false);
});
test('new clients bind the exact versioned routes, resource identity and price-free frozen request', async () => {
  const sent: string[] = [];
  const input = order2Input();
  const fetcher = async (path: string, init: RequestInit) => {
    assert.equal(path, '/api/orders/v2');
    sent.push(String(init.body));
    return Response.json({ order: order2Detail(), replayed: sent.length > 1 });
  };
  await createOrderV2(fetcher, input);
  await createOrderV2(fetcher, input);
  assert.equal(sent[0], sent[1]);
  assert.deepEqual(JSON.parse(sent[0]), input);
  await readOrderV2(async (path) => {
    assert.equal(path, `/api/orders/v2/${order2Id}`);
    return Response.json(order2Detail());
  }, order2Id);
  await cancelOrderV2(
    async (path) => {
      assert.equal(path, `/api/orders/v2/${order2Id}/cancel`);
      const o = order2Detail();
      return Response.json({
        ...o,
        summary: { ...o.summary, state: 'Cancelled' },
        canCancel: false,
      });
    },
    order2Id,
    'AAAAAAAAAAY=',
  );
  await listOrdersV2(async (path) => {
    assert.equal(path, '/api/orders/v2?cursor=abc_-');
    return Response.json({ schemaVersion: 2, items: [] });
  }, 'abc_-');
  await requestQuoteV5(
    async (path, init) => {
      assert.equal(path, '/api/cart/en/v2/order-quote');
      assert.deepEqual(JSON.parse(String(init.body)), quoteInput);
      return Response.json(quote5Snapshot());
    },
    'en',
    quoteInput,
  );
  await assert.rejects(
    createOrderV2(
      async () =>
        Response.json({ order: { ...order2Detail(), quoteId: order2Id }, replayed: false }),
      input,
    ),
  );
  await assert.rejects(
    readOrderV2(
      async () =>
        Response.json({
          ...order2Detail(),
          summary: { ...order2Detail().summary, id: 'f'.repeat(32) },
        }),
      order2Id,
    ),
  );
});
test('private clients reject malformed or oversized upstream bodies and hide unsafe problem text', async () => {
  for (const response of [new Response(new Uint8Array([255])), new Response('x'.repeat(1048577))])
    await assert.rejects(readOrderV2(async () => response, order2Id));
  await assert.rejects(
    createOrderV2(
      async () => Response.json({ title: 'private <secret>' }, { status: 500 }),
      order2Input(),
    ),
    (e) => e instanceof CartError && e.code === 'order_unavailable',
  );
  await assert.rejects(
    requestQuoteV5(async () => Response.json(quote4Snapshot(true)), 'en', quoteInput),
  );
});
test('Quote5 and Order2 RAM journals retain uncertain UUID/body through later rejection without overwriting another command', () => {
  bindQuoteV5Owner(null);
  bindQuoteV5Owner('owner');
  startQuoteV5Attempt('owner', 'en', quoteInput);
  assert.equal(failQuoteV5Attempt('owner', quoteInput.requestId, 0), true);
  assert.equal(failQuoteV5Attempt('owner', quoteInput.requestId, 409), true);
  assert.throws(() => startQuoteV5Attempt('owner', 'fa', quoteInput));
  assert.equal(readQuoteV5Attempt('other'), null);
  assert.equal(finishQuoteV5Attempt('owner', quoteInput.requestId), true);
  bindOrderV2Owner(null);
  bindOrderV2Owner('owner');
  const started = startOrderV2Attempt('owner', 'en', order2Input(), '2026-10-24T12:04:00Z', 15);
  started.input.contactName = 'forged';
  assert.equal(readOrderV2Attempt('owner')!.input.contactName, 'QA Customer');
  assert.equal(failOrderV2Attempt('owner', order2Input().requestId, 0), true);
  assert.equal(failOrderV2Attempt('owner', order2Input().requestId, 401), true);
  assert.equal(readOrderV2Attempt('owner')!.input.requestId, order2Input().requestId);
  assert.throws(() =>
    startOrderV2Attempt(
      'owner',
      'en',
      { ...order2Input(), requestId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff' },
      '2026-10-24T12:04:00Z',
      15,
    ),
  );
  assert.equal(finishOrderV2Attempt('other', order2Input().requestId), false);
  assert.equal(finishOrderV2Attempt('owner', order2Input().requestId), true);
  bindOrderV2Owner(null);
  bindQuoteV5Owner(null);
});
test('failed identity refresh hides private access but keeps new journals for the same owner; switching or logout clears them', async () => {
  let owner = 'owner',
    unavailable = false;
  const session = (): CustomerSession => ({
    accessToken: 'a'.repeat(30),
    expiresIn: 300,
    requiresMfa: false,
    requiresEnrollment: false,
    user: { id: owner, displayName: 'QA', userName: 'qa' },
  });
  const store = new CustomerSessionStore(
    async () => undefined,
    async () => {
      if (unavailable) throw new SessionError('unavailable');
      return session();
    },
    async (run) => run(),
    () => false,
  );
  await store.restore();
  startQuoteV5Attempt(owner, 'en', quoteInput);
  startOrderV2Attempt(owner, 'en', order2Input(), '2026-10-24T12:04:00Z', 15);
  unavailable = true;
  await store.restore();
  assert.equal(store.snapshot().status, 'unavailable');
  await assert.rejects(store.fetch('/api/orders/v2'));
  assert.ok(readQuoteV5Attempt(owner));
  assert.ok(readOrderV2Attempt(owner));
  unavailable = false;
  await store.restore();
  assert.ok(readOrderV2Attempt(owner));
  owner = 'another';
  await store.restore();
  assert.equal(readOrderV2Attempt('owner'), null);
  assert.equal(readQuoteV5Attempt('owner'), null);
  await store.logout();
});
