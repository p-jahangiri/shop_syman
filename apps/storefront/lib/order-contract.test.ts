import assert from 'node:assert/strict';
import test from 'node:test';
import {
  orderDetailSchema,
  orderInputSchema,
  orderPageSchema,
  orderExpired,
} from './order-contract.ts';
import { createOrder, cancelOrder, listOrders, readOrder } from './order-client.ts';
import {
  normalizeOrderPhone,
  orderReturnTo,
  accountReturnTo,
  validateOrderForm,
} from './order-form.ts';
import { CartError } from './cart-client.ts';
const id = 'a'.repeat(32),
  quoteId = 'b'.repeat(32),
  version = 'AAAAAAAAAAE=';
function detail() {
  return {
    schemaVersion: 1,
    summary: {
      id,
      reference: 'SM-9007199254740993',
      locale: 'fa',
      state: 'AwaitingPayment',
      createdAt: '2026-10-22T12:00:00Z',
      expiresAt: '2026-10-22T12:15:00Z',
      payableTotalRial: '18014398509481993',
      itemCount: 2,
      version,
    },
    quoteId,
    contactName: 'QA Customer',
    contactPhone: '09123456789',
    delivery: {
      countryCode: 'IR',
      province: 'Tehran',
      city: 'Tehran',
      address: 'A sufficiently long QA address',
      postalCode: '1234567890',
    },
    note: '',
    shippingRequired: true,
    methodName: 'Cash',
    shippingName: 'Delivery',
    itemsSubtotalRial: '18014398509481986',
    goodsTotalRial: '18014398509481986',
    shippingRial: '7',
    taxRial: '0',
    payableTotalRial: '18014398509481993',
    taxIncluded: false,
    lines: [
      {
        variantId: 'v',
        productId: 'p',
        sellerId: 'store',
        sku: 'SKU',
        name: 'Product',
        label: 'Variant',
        warranty: 'Warranty',
        isDigital: false,
        quantity: 2,
        unitPriceRial: '9007199254740993',
        lineTotalRial: '18014398509481986',
      },
    ],
    events: [
      { state: 'AwaitingPayment', at: '2026-10-22T12:00:00Z', reason: 'temporary_order_created' },
    ],
    canCancel: true,
    canPay: false,
    paymentAvailability: 'gateway_unconfigured',
  };
}
const input = () =>
  orderInputSchema.parse({
    quoteId,
    requestId: '01234567-89ab-4cde-8012-3456789abcde',
    contactName: 'QA Customer',
    contactPhone: '09123456789',
    delivery: detail().delivery,
    note: null,
    acknowledgeTemporary: true,
  });
test('order contract keeps exact large rial snapshots and its unpaid deadline', () => {
  const o = orderDetailSchema.parse(detail());
  assert.equal(o.payableTotalRial, '18014398509481993');
  assert.equal(o.summary.reference, 'SM-9007199254740993');
  assert.equal(orderExpired(o, Date.parse(o.summary.expiresAt) - 1), false);
  assert.equal(orderExpired(o, Date.parse(o.summary.expiresAt)), true);
});
test('order input rejects injected prices, owners, missing consent and zero request ids', () => {
  for (const patch of [
    { ownerId: 'other' },
    { payableTotalRial: '1' },
    { acknowledgeTemporary: false },
    { requestId: '00000000-0000-0000-0000-000000000000' },
    { quoteId: '../admin' },
  ])
    assert.equal(orderInputSchema.safeParse({ ...input(), ...patch }).success, false);
});
test('order responses reject inconsistent totals, financial numbers, duplicate lines and fake payment readiness', () => {
  const o = detail();
  for (const patch of [
    { payableTotalRial: '1' },
    { itemsSubtotalRial: Number('18014398509481986') },
    { canPay: true },
    { canCancel: false },
    { shippingRequired: false },
    { delivery: null },
    { summary: { ...o.summary, itemCount: 1 } },
    { lines: [o.lines[0], o.lines[0]] },
    { taxRial: '1' },
    { summary: { ...o.summary, payableTotalRial: '1' } },
    { ownerId: 'other' },
  ])
    assert.equal(orderDetailSchema.safeParse({ ...o, ...patch }).success, false);
});
test('digital-only orders omit delivery, preserve zero physical shipping, and included tax is not added twice', () => {
  const o = detail();
  const digital = {
    ...o,
    summary: { ...o.summary, payableTotalRial: o.itemsSubtotalRial },
    lines: o.lines.map((l) => ({ ...l, isDigital: true })),
    shippingRequired: false,
    delivery: null,
    shippingRial: '0',
    payableTotalRial: o.itemsSubtotalRial,
    taxIncluded: true,
    taxRial: '100',
  };
  assert.equal(orderDetailSchema.safeParse(digital).success, true);
  assert.equal(orderDetailSchema.safeParse({ ...digital, delivery: o.delivery }).success, false);
  assert.equal(orderDetailSchema.safeParse({ ...digital, shippingRial: '1' }).success, false);
});
test('order pages accept omitted terminal cursor and reject duplicate ids and leaked staff ownership', () => {
  const summary = detail().summary;
  assert.equal(orderPageSchema.parse({ items: [summary] }).nextCursor, null);
  assert.equal(orderPageSchema.safeParse({ items: [summary, summary] }).success, false);
  assert.equal(
    orderPageSchema.safeParse({ items: [{ ...summary, ownerId: 'staff-only' }] }).success,
    false,
  );
});
test('order client keeps a retry id, checks resource identity and never returns preview data', async () => {
  const v = input();
  let sent = '';
  const fetcher = async (path: string, init: RequestInit) => {
    assert.equal(path, '/api/orders');
    sent = String(init.body);
    return Response.json({ order: detail(), replayed: true });
  };
  const result = await createOrder(fetcher, v);
  assert.equal(result.replayed, true);
  assert.equal(JSON.parse(sent).requestId, v.requestId);
  await assert.rejects(
    createOrder(
      async () => Response.json({ order: { ...detail(), quoteId: id }, replayed: false }),
      v,
    ),
  );
  await assert.rejects(
    readOrder(
      async () =>
        Response.json({ ...detail(), summary: { ...detail().summary, id: 'c'.repeat(32) } }),
      id,
    ),
  );
  await assert.rejects(
    createOrder(async () => Response.json({ title: 'quote_changed_conflict' }, { status: 409 }), v),
    (e) => e instanceof CartError && e.status === 409,
  );
});
test('cancel and list use bounded private paths and versioned input', async () => {
  const cancelled = {
    ...detail(),
    summary: { ...detail().summary, state: 'Cancelled' },
    canCancel: false,
  };
  await cancelOrder(
    async (path, init) => {
      assert.equal(path, `/api/orders/${id}/cancel`);
      assert.deepEqual(JSON.parse(String(init.body)), { version });
      return Response.json(cancelled);
    },
    id,
    version,
  );
  await listOrders(async (path) => {
    assert.equal(path, '/api/orders?cursor=abc_-');
    return Response.json({ items: [], nextCursor: null });
  }, 'abc_-');
  await assert.rejects(
    listOrders(async () => {
      throw new Error('must not call');
    }, '../admin'),
  );
  await assert.rejects(
    readOrder(async () => {
      throw new Error('must not call');
    }, '../admin'),
  );
});
test('contact form normalizes Persian and Arabic numbers and only requires an address for physical goods', () => {
  const v = {
    contactName: 'QA Customer',
    contactPhone: '+۹۸ ۹۱۲-۳۴۵۶۷۸۹',
    province: 'Tehran',
    city: 'Tehran',
    address: 'A sufficiently long address',
    postalCode: '۱۲۳۴۵۶۷۸۹۰',
    note: '',
    acknowledgeTemporary: true,
  };
  assert.equal(normalizeOrderPhone(v.contactPhone), '09123456789');
  assert.equal(validateOrderForm(v, true).success, true);
  assert.equal(validateOrderForm({ ...v, postalCode: '123' }, true).success, false);
  assert.equal(
    validateOrderForm({ ...v, province: '', city: '', address: '', postalCode: '' }, false).success,
    true,
  );
  assert.equal(validateOrderForm({ ...v, contactPhone: '123' }, false).success, false);
  assert.equal(validateOrderForm({ ...v, acknowledgeTemporary: false }, false).success, false);
});
test('sign-in return destinations never allow external URLs or arbitrary site paths', () => {
  for (const path of ['/checkout', '/orders', `/orders/${id}`])
    assert.equal(orderReturnTo(path), path);
  for (const path of [
    null,
    '//evil.example',
    'https://evil.example',
    'javascript:alert(1)',
    '/orders/../admin',
    '/admin',
    '/checkout?returnTo=//evil.example',
    '/orders/UPPERCASE',
  ])
    assert.equal(orderReturnTo(path), null);
});

test('legacy order-tracking account links keep a safe destination after sign-in', () => {
  assert.equal(accountReturnTo(null, 'orders'), '/orders');
  assert.equal(accountReturnTo('/checkout', 'orders'), '/checkout');
  assert.equal(accountReturnTo('//untrusted.example', 'orders'), '/orders');
  assert.equal(accountReturnTo(null, 'profile'), null);
});
