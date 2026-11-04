import test from 'node:test';
import assert from 'node:assert/strict';
import { isCustomerSupplyPath } from '../lib/market/supply-path.ts';
import {
  CustomerSessionStore,
  SessionError,
  type CustomerSession,
} from '../lib/account/customer-session.ts';
import {
  supplyReadMayApply,
  type SupplyReadCurrent,
  type SupplyReadTicket,
} from '../lib/market/supply-view.ts';
import {
  supplyTestRequest as requestId,
  supplyTestTask as taskId,
} from './supply.test-fixtures.ts';
const root = `/api/sourcing/requests/${requestId}/supply`,
  child = root + '/' + taskId;
test('supply paths allow only bounded owner reads and block all mutations before sending bearer', () => {
  for (const path of [
    root,
    root + '?cursor=abc_-',
    child,
    child + '/events',
    child + '/events?cursor=abc_-',
  ])
    assert.equal(isCustomerSupplyPath(path), true);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])
    assert.equal(isCustomerSupplyPath(child, method), false);
  for (const path of [
    root + '/',
    root + '?ownerId=other',
    root + '?cursor=a&cursor=b',
    child + '?cursor=a',
    child + '/cancel',
    child + '/requested',
    child + '/receipts',
    child + '/commands/start/' + taskId,
    root + '/../admin',
    root + '/%2e%2e/admin',
    root + '/' + '0'.repeat(32),
    root + '/' + 'A'.repeat(32),
    'https://evil.test' + root,
    '/api/admin/sourcing/requests/' + requestId + '/supply',
  ])
    assert.equal(isCustomerSupplyPath(path), false);
});
test('read callbacks require the same verified owner, request, task, epoch and mounted view', () => {
  const ticket: SupplyReadTicket = { owner: 'one', requestId, taskId, epoch: 4 },
    current: SupplyReadCurrent = {
      ...ticket,
      mounted: true,
      status: 'member',
      verifiedOwner: 'one',
    };
  assert.equal(supplyReadMayApply(ticket, current), true);
  for (const changed of [
    { mounted: false },
    { status: 'restoring' },
    { status: 'unavailable' },
    { status: 'guest' },
    { verifiedOwner: null },
    { verifiedOwner: 'two' },
    { owner: 'two' },
    { requestId: 'f'.repeat(32) },
    { taskId: 'f'.repeat(32) },
    { epoch: 5 },
  ])
    assert.equal(supplyReadMayApply(ticket, { ...current, ...changed }), false);
});
test('actual customer session transport keeps supply reads private and discards late responses after owner changes', async (t) => {
  const member = (id = 'one'): CustomerSession => ({
    accessToken: 'qa-token-never-persisted-' + id,
    expiresIn: 600,
    requiresMfa: false,
    requiresEnrollment: false,
    user: { id, userName: id, displayName: id },
  });
  const store = new CustomerSessionStore(
    async () => undefined,
    async () => member(),
    async (run) => run(),
    () => false,
  );
  await store.restore();
  let calls = 0;
  let resolve!: (response: Response) => void;
  const delayed = new Promise<Response>((r) => {
    resolve = r;
  });
  t.mock.method(globalThis, 'fetch', async (path: string, init: RequestInit) => {
    calls++;
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer ' + member().accessToken);
    assert.equal(init.cache, 'no-store');
    assert.equal(init.credentials, 'same-origin');
    return path.endsWith('/events') ? delayed : Response.json({});
  });
  await store.fetch(root);
  await store.fetch(child);
  for (const method of ['POST', 'PUT', 'DELETE'])
    await assert.rejects(
      store.fetch(child, { method }),
      (error) => error instanceof SessionError && error.kind === 'unavailable',
    );
  assert.equal(calls, 2);
  const pending = store.fetch(child + '/events');
  store.remote('signout');
  resolve(Response.json({ private: 'old owner response' }));
  await assert.rejects(
    pending,
    (error) => error instanceof SessionError && error.kind === 'changed',
  );
  assert.equal(calls, 3);
});
test('temporary auth unavailability closes supply transport until the same owner is verified again', async (t) => {
  const member: CustomerSession = {
    accessToken: 'qa-token-never-persisted-one',
    expiresIn: 600,
    requiresMfa: false,
    requiresEnrollment: false,
    user: { id: 'one', userName: 'one', displayName: 'one' },
  };
  let refreshes = 0,
    calls = 0;
  const store = new CustomerSessionStore(
    async () => undefined,
    async () => {
      if (++refreshes === 2) throw new SessionError('unavailable');
      return member;
    },
    async (run) => run(),
    () => false,
  );
  await store.restore();
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json({});
  });
  await store.restore(true);
  assert.equal(store.snapshot().status, 'unavailable');
  assert.equal(store.snapshot().session, null);
  await assert.rejects(
    store.fetch(child),
    (error) => error instanceof SessionError && error.kind === 'unavailable',
  );
  assert.equal(calls, 0);
  await store.restore();
  assert.equal(store.snapshot().status, 'member');
  assert.equal(store.snapshot().session?.user.id, 'one');
  await store.fetch(child);
  assert.equal(calls, 1);
  store.remote('signout');
});
