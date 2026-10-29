import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adminOrderPageV2Schema,
  adminOrderMatches,
  adminOrderDetailPath,
  adminOrderListPath,
  adminOrderCancelPath,
} from './orders-contract.ts';
import { listAdminOrdersV2, readAdminOrderV2, cancelAdminOrderV2 } from './orders-client.ts';
import { invalidateAdminViews } from './admin-view-authority.ts';
import { SessionChanged } from './session-access.ts';
import { order2Detail, order2Id } from '../../storefront/lib/order-v2.test-fixtures.ts';
const summary = () => ({ ...order2Detail().summary, ownerId: 'customer-qa' });
test('admin order2 list preserves owner scope and snapshot version without exposing contact details', () => {
  const value = adminOrderPageV2Schema.parse({ schemaVersion: 2, items: [summary()] });
  assert.equal(value.items[0].ownerId, 'customer-qa');
  assert.equal(value.items[0].originalSnapshotVersion, 2);
  assert.equal(value.nextCursor, null);
  for (const patch of [
    { items: [{ ...summary(), ownerId: undefined }] },
    { items: [{ ...summary(), contactPhone: '09123456789' }] },
    { items: [summary(), summary()] },
    { schemaVersion: 1 },
  ])
    assert.equal(
      adminOrderPageV2Schema.safeParse({ schemaVersion: 2, items: [summary()], ...patch }).success,
      false,
    );
});
test('admin order2 detail retains full accepted conditions and independently priced lines for the same SKU', () => {
  const order = adminOrderMatches(order2Detail(), order2Id);
  assert.equal(order.lines.length, 3);
  assert.equal(new Set(order.lines.map((l) => l.lineId)).size, 3);
  assert.equal(new Set(order.lines.map((l) => l.variantId)).size, 1);
  assert.equal(order.lines[1].unitPriceRial, '9007199254740993');
  assert.ok(order.lines[1].accepted!.termsFa);
  assert.ok(order.lines[1].accepted!.termsEn);
  assert.equal(order.canPay, false);
  assert.throws(() => adminOrderMatches({ ...order2Detail(), schemaVersion: 1 }, order2Id));
  assert.throws(() =>
    adminOrderMatches(
      { ...order2Detail(), summary: { ...order2Detail().summary, id: 'f'.repeat(32) } },
      order2Id,
    ),
  );
});
test('admin order2 accepts the actual creation reason and rejects arbitrary digit-bearing reasons', () => {
  const order = order2Detail();
  assert.equal(adminOrderMatches(order, order2Id).events[0].reason, 'temporary_order_v2_created');
  for (const reason of ['temporary_order_v3_created', 'order_2_paid'])
    assert.throws(() =>
      adminOrderMatches(
        { ...order, events: order.events.map((e) => ({ ...e, reason })) },
        order2Id,
      ),
    );
});
test('admin all-history order2 decoder accepts legacy metadata with unknown price version as null', () => {
  const value = order2Detail();
  const line = { ...value.lines[0], categoryId: null, priceVersion: null };
  const legacy = {
    ...value,
    originalSnapshotVersion: 1,
    summary: {
      ...value.summary,
      originalSnapshotVersion: 1,
      itemCount: 1,
      payableTotalRial: '130',
    },
    lines: [line],
    events: value.events.map((e) => ({ ...e, reason: 'temporary_order_created' })),
    itemsSubtotalRial: '123',
    goodsTotalRial: '123',
    payableTotalRial: '130',
  };
  assert.equal(adminOrderMatches(legacy, order2Id).originalSnapshotVersion, 1);
  assert.throws(() =>
    adminOrderMatches({ ...legacy, lines: [{ ...line, priceVersion: '' }] }, order2Id),
  );
});
test('admin order2 clients use only versioned owner-bound paths and cancel with current version', async () => {
  assert.equal(adminOrderListPath('abc_-'), '/admin/orders/v2?cursor=abc_-');
  assert.equal(
    adminOrderDetailPath('customer-qa', order2Id),
    `/admin/orders/v2/customer-qa/${order2Id}`,
  );
  assert.equal(adminOrderCancelPath(order2Id), `/admin/orders/v2/${order2Id}/cancel`);
  for (const f of [
    () => adminOrderListPath('../admin'),
    () => adminOrderDetailPath('../other', order2Id),
    () => adminOrderCancelPath('../admin'),
  ])
    assert.throws(f);
  await listAdminOrdersV2(async (path) => {
    assert.equal(path, '/admin/orders/v2');
    return { schemaVersion: 2, items: [summary()] };
  }, null);
  const order = await readAdminOrderV2(
    async (path) => {
      assert.equal(path, `/admin/orders/v2/customer-qa/${order2Id}`);
      return order2Detail();
    },
    'customer-qa',
    order2Id,
  );
  await cancelAdminOrderV2(
    async (path, init) => {
      assert.equal(path, `/admin/orders/v2/${order2Id}/cancel`);
      assert.equal(init?.method, 'POST');
      assert.deepEqual(JSON.parse(String(init?.body)), {
        ownerId: 'customer-qa',
        version: order.summary.version,
      });
      return {
        ...order2Detail(),
        summary: { ...order2Detail().summary, state: 'Cancelled' },
        canCancel: false,
      };
    },
    'customer-qa',
    order,
  );
});
test('admin order2 delayed reads and writes cannot repopulate a cleared authorization cache', async () => {
  let release: (value: unknown) => void = () => {};
  const response = new Promise<unknown>((resolve) => {
    release = resolve;
  });
  const pending = readAdminOrderV2(async () => response, 'customer-qa', order2Id);
  invalidateAdminViews();
  release(order2Detail());
  await assert.rejects(pending, (e) => e instanceof SessionChanged);
  let finish: (value: unknown) => void = () => {};
  const result = new Promise<unknown>((resolve) => {
    finish = resolve;
  });
  const order = adminOrderMatches(order2Detail(), order2Id);
  const cancelling = cancelAdminOrderV2(async () => result, 'customer-qa', order);
  invalidateAdminViews();
  finish({
    ...order2Detail(),
    summary: { ...order2Detail().summary, state: 'Cancelled' },
    canCancel: false,
  });
  await assert.rejects(cancelling, (e) => e instanceof SessionChanged);
});
