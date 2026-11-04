import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadAccountOverview,
  readAccountUnread,
  type AccountOverviewUpdate,
} from '../lib/account/account-overview.ts';
import type { CartFetch } from '../lib/checkout/cart-client.ts';
import { order2Detail } from '@sayman/web-shared/testing/order-v2.test-fixtures.ts';

const orderPath = '/api/orders/v2',
  addressPath = '/api/addresses',
  countPaths = [
    '/api/notifications/unread-count',
    '/api/notifications/credit-reminders/unread-count',
  ];
const orderPage = () => ({
  schemaVersion: 2,
  items: [{ ...order2Detail().summary, payableTotalRial: '9223372036854775807' }],
  nextCursor: 'next_page_-',
});
const addresses = () => ({
  schemaVersion: 1,
  capacity: 20,
  items: [
    {
      id: 'a'.repeat(32),
      label: 'خانه',
      contactName: 'دریافت‌کنندهٔ آزمایشی',
      contactPhone: '09123456789',
      delivery: {
        countryCode: 'IR',
        province: 'تهران',
        city: 'تهران',
        address: 'نشانی نمونهٔ آزمون، بدون اطلاعات واقعی',
        postalCode: '1234567890',
      },
      isDefault: true,
      createdAt: '2026-10-30T00:00:00Z',
      updatedAt: '2026-10-30T00:00:00Z',
      version: 'AAAAAAAAAAE=',
    },
  ],
});
const count = (unreadCount = '0') => Response.json({ schemaVersion: 1, unreadCount });
const normalResponse = (path: string) => {
  if (path === orderPath) return Response.json(orderPage());
  if (path === addressPath) return Response.json(addresses());
  assert.ok(countPaths.includes(path), `Unexpected private read: ${path}`);
  return count();
};

test('account sections render independently, read only one order page and preserve exact money', async () => {
  const orders = Promise.withResolvers<Response>(),
    addressReady = Promise.withResolvers<AccountOverviewUpdate>(),
    updates: AccountOverviewUpdate[] = [],
    requests: string[] = [],
    controller = new AbortController();
  const resultPromise = loadAccountOverview(
    async (path, init) => {
      requests.push(path);
      assert.equal(init.method, 'GET');
      assert.equal(init.cache, 'no-store');
      assert.equal(init.signal, controller.signal);
      assert.equal(init.body, undefined);
      assert.equal(init.headers, undefined);
      return path === orderPath ? orders.promise : normalResponse(path);
    },
    controller.signal,
    (update) => {
      updates.push(update);
      if (update.kind === 'addresses') addressReady.resolve(update);
    },
  );
  const firstAddress = await addressReady.promise;
  assert.equal(firstAddress.status, 'ready');
  assert.equal(
    updates.some((update) => update.kind === 'orders'),
    false,
  );
  orders.resolve(Response.json(orderPage()));
  const result = await resultPromise;
  assert.deepEqual(requests.toSorted(), [orderPath, addressPath, ...countPaths].toSorted());
  assert.equal(updates.length, 3);
  assert.deepEqual(result.orders, { status: 'ready', data: orderPage() });
  assert.deepEqual(result.addresses, { status: 'ready', data: addresses() });
  assert.deepEqual(result.notifications, {
    status: 'ready',
    data: { support: '0', creditReminders: '0', total: '0' },
  });
});

test('an unavailable address service does not discard orders or replace failure with an empty book', async () => {
  const updates: AccountOverviewUpdate[] = [];
  const result = await loadAccountOverview(
    async (path) =>
      path === addressPath
        ? Response.json({ title: 'private upstream details' }, { status: 503 })
        : normalResponse(path),
    undefined,
    (update) => updates.push(update),
  );
  assert.deepEqual(result.addresses, { status: 'unavailable' });
  assert.equal(result.orders.status, 'ready');
  assert.equal(result.notifications.status, 'ready');
  assert.deepEqual(
    updates.find((update) => update.kind === 'addresses'),
    {
      kind: 'addresses',
      status: 'unavailable',
    },
  );
  assert.equal(JSON.stringify(result).includes('private upstream details'), false);
});

test('unread counts stay decimal strings even when the exact total exceeds SQL bigint', async () => {
  const result = await readAccountUnread(async (path) => {
    assert.ok(countPaths.includes(path));
    return count('9223372036854775807');
  });
  assert.deepEqual(result, {
    support: '9223372036854775807',
    creditReminders: '9223372036854775807',
    total: '18446744073709551614',
  });
});

test('a failed or invalid unread source never produces a partial total or an invented zero', async () => {
  const invalid = [
    () => new Response(null, { status: 503 }),
    () => Response.json({ schemaVersion: 1, unreadCount: 1 }),
    () => count('9223372036854775808'),
    () => count('01'),
    () => Response.json({ schemaVersion: 1, unreadCount: '1', ownerId: 'private' }),
    () => new Response('not JSON'),
    () => new Response(new Uint8Array([255])),
    () => new Response(' '.repeat(1025)),
    () => new Response('{}', { headers: { 'Content-Length': '1025' } }),
  ];
  for (const badResponse of invalid) {
    const result = await loadAccountOverview(async (path) =>
      path === countPaths[1] ? badResponse() : normalResponse(path),
    );
    assert.deepEqual(result.notifications, { status: 'unavailable' });
    assert.equal(result.orders.status, 'ready');
    assert.equal(result.addresses.status, 'ready');
  }
});

test('malformed private order or address contracts are unavailable independently', async () => {
  const invalidPages = [
    [orderPath, { ...orderPage(), items: [{ ...orderPage().items[0], payableTotalRial: 1 }] }],
    [addressPath, { ...addresses(), items: [{ ...addresses().items[0], isDefault: false }] }],
  ] as const;
  for (const [failedPath, body] of invalidPages) {
    const result = await loadAccountOverview(async (path) =>
      path === failedPath ? Response.json(body) : normalResponse(path),
    );
    assert.deepEqual(result[failedPath === orderPath ? 'orders' : 'addresses'], {
      status: 'unavailable',
    });
    assert.equal(result[failedPath === orderPath ? 'addresses' : 'orders'].status, 'ready');
    assert.equal(result.notifications.status, 'ready');
  }
});

test('an aborted account read starts no requests and emits no section updates', async () => {
  const controller = new AbortController(),
    updates: AccountOverviewUpdate[] = [];
  controller.abort();
  await assert.rejects(
    loadAccountOverview(
      async () => {
        assert.fail('An already cancelled account must not issue a request');
      },
      controller.signal,
      (update) => updates.push(update),
    ),
    { name: 'AbortError' },
  );
  assert.deepEqual(updates, []);
});

test('late reads from a cancelled account cannot publish ready or unavailable sections', async () => {
  const responseGate = Promise.withResolvers<void>(),
    controller = new AbortController(),
    updates: AccountOverviewUpdate[] = [];
  // Deliberately ignore AbortSignal in this transport to exercise a late server response.
  const fetcher: CartFetch = async (path) => {
    await responseGate.promise;
    return normalResponse(path);
  };
  const result = loadAccountOverview(fetcher, controller.signal, (update) => updates.push(update));
  controller.abort();
  responseGate.resolve();
  await assert.rejects(result, { name: 'AbortError' });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(updates, []);
});

test('separate reads retain no previous owner data or global account cache', async () => {
  const first = await loadAccountOverview(async (path) => normalResponse(path));
  assert.equal(first.addresses.status, 'ready');
  const second = await loadAccountOverview(async () => new Response(null, { status: 401 }));
  assert.deepEqual(second, {
    orders: { status: 'unavailable' },
    addresses: { status: 'unavailable' },
    notifications: { status: 'unavailable' },
  });
});
