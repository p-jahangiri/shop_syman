import test from 'node:test';
import assert from 'node:assert/strict';
import { CustomerSessionStore } from '../lib/account/customer-session.ts';
import { customerDigitalPath } from '@sayman/web-shared/lib/orders/order-digital-contract.ts';
import {
  digitalOrder,
  digitalDelivery,
} from '@sayman/web-shared/testing/order-digital.test-fixtures.ts';
test('real customer session transport permits only exact digital GETs, adds current owner access and discards late content after logout', async (t) => {
  const session = {
    accessToken: 'test-token-never-persisted-digital',
    expiresIn: 600,
    requiresMfa: false,
    requiresEnrollment: false,
    user: { id: 'OWNER', displayName: 'Synthetic owner', userName: 'owner' },
  };
  let pendingLogout = false;
  const store = new CustomerSessionStore(
    undefined,
    async () => session,
    async (run) => run(),
    (value?: boolean) => {
      if (value !== undefined) pendingLogout = value;
      return pendingLogout;
    },
  );
  await store.restore();
  let calls = 0,
    delayed = false,
    resolve!: (r: Response) => void;
  const late = new Promise<Response>((r) => {
    resolve = r;
  });
  t.mock.method(globalThis, 'fetch', async (_path: string, init: RequestInit) => {
    calls++;
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer ' + session.accessToken);
    assert.equal(init.cache, 'no-store');
    return delayed ? late : Response.json({});
  });
  for (const v2 of [true, false]) {
    await store.fetch(customerDigitalPath(digitalOrder, undefined, v2));
    await store.fetch(customerDigitalPath(digitalOrder, digitalDelivery, v2));
  }
  assert.equal(calls, 4);
  const path = customerDigitalPath(digitalOrder);
  for (const wrong of [
    path + '?owner=OTHER',
    path + '/',
    path + '/commands/' + digitalDelivery,
    path.replace(digitalOrder, '0'.repeat(32)),
  ])
    await assert.rejects(store.fetch(wrong));
  await assert.rejects(store.fetch(path, { method: 'POST', body: '{}' }));
  assert.equal(calls, 4);
  delayed = true;
  const content = store.fetch(customerDigitalPath(digitalOrder, digitalDelivery));
  store.remote('signout');
  resolve(Response.json({ private: 'late text' }));
  await assert.rejects(content, /changed/);
  assert.equal(store.snapshot().session, null);
});
