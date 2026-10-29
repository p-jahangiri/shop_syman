import test from 'node:test';
import assert from 'node:assert/strict';
import {
  customerPageSchema,
  customerDetailSchema,
  customerOrdersOverviewSchema,
  readCustomerPage,
  readCustomerDetail,
  customerListPath,
  customerHistoryPath,
  emptyCustomerFilters,
  customerMessagesSchema,
} from './customers-contract.ts';
const account = {
  id: 'customer-one',
  userName: 'member',
  displayName: 'مشتری نمونه',
  isActive: true,
  isStaff: false,
  emailVerified: false,
  phoneVerified: true,
  createdAt: '2026-10-29T00:00:00Z',
};
const orders = {
  ownerId: account.id,
  totalOrders: '3',
  confirmedPurchases: '1',
  awaitingPaymentOrders: '1',
  demoOrders: '0',
  lastOrderAt: '2026-10-29T00:00:00Z',
};
const support = {
  ownerId: account.id,
  totalTickets: '2',
  openTickets: '1',
  lastTicketAt: '2026-10-29T00:00:00Z',
};
const page = {
  schemaVersion: 1,
  pageSize: 50,
  canReadOrders: true,
  canReadSupport: true,
  items: [{ account, orders, support }],
  nextCursor: null,
};
test('customer overview rejects cross-owner history, duplicate accounts and inconsistent permission summaries', () => {
  assert.equal(readCustomerPage(page, emptyCustomerFilters).items.length, 1);
  for (const changed of [
    { ...page, items: [...page.items, ...page.items] },
    { ...page, nextCursor: 'page-two' },
    { ...page, canReadOrders: false },
    { ...page, items: [{ account, orders: { ...orders, ownerId: 'another' }, support }] },
    { ...page, items: [{ account: { ...account, passwordHash: 'never' }, orders, support }] },
  ])
    assert.equal(customerPageSchema.safeParse(changed).success, false);
  assert.throws(() => readCustomerPage(page, { ...emptyCustomerFilters, active: 'false' }));
  assert.throws(() => readCustomerPage(page, { ...emptyCustomerFilters, kind: 'staff' }));
  const restricted = { ...page, canReadOrders: false, items: [{ account, orders: null, support }] };
  assert.equal(customerPageSchema.parse(restricted).items[0].orders, null);
});
test('profile binds identity and overview owners and refuses authentication metadata', () => {
  const detail = {
    schemaVersion: 1,
    identity: { account, email: null, phoneNumber: '09120000000' },
    orders,
    support,
  };
  assert.equal(readCustomerDetail(detail, account.id).identity.account.phoneVerified, true);
  assert.throws(() => readCustomerDetail(detail, 'another'));
  assert.equal(
    customerDetailSchema.safeParse({
      ...detail,
      identity: { ...detail.identity, securityStamp: 'private' },
    }).success,
    false,
  );
});
test('overview counts stay exact decimal integers and never infer successful purchase from all orders', () => {
  const exact = customerOrdersOverviewSchema.parse({ ...orders, totalOrders: '9007199254740993' });
  assert.equal(exact.totalOrders, '9007199254740993');
  assert.equal(exact.confirmedPurchases, '1');
  for (const changed of [
    { totalOrders: 3 },
    { totalOrders: '03' },
    { confirmedPurchases: '3' },
    { demoOrders: '4' },
    { totalOrders: '9223372036854775808' },
  ])
    assert.equal(customerOrdersOverviewSchema.safeParse({ ...orders, ...changed }).success, false);
});
test('customer filters and history encode only the selected identity and supported section', () => {
  assert.match(customerListPath({ ...emptyCustomerFilters, query: 'علی &' }, 'opaque'), /query=/);
  assert.equal(
    customerHistoryPath('customer-one', 'orders', null),
    '/admin/customers/customer-one/orders',
  );
  assert.throws(() => customerHistoryPath('owner/another', 'tickets', null));
  assert.throws(() => customerListPath({ ...emptyCustomerFilters, query: 'x '.repeat(9) }, null));
  assert.equal(
    customerMessagesSchema.safeParse({
      schemaVersion: 1,
      customerId: account.id,
      ticketId: 'a'.repeat(32),
      items: [],
      nextCursor: null,
    }).success,
    true,
  );
});
