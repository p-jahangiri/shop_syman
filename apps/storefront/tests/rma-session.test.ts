import test from 'node:test';
import assert from 'node:assert/strict';
import { CustomerSessionStore } from '../lib/account/customer-session.ts';
import { customerRmaJournal, rmaCommand } from '@sayman/web-shared/lib/orders/rma-journal.ts';
import {
  rmaCreateBody,
  rmaOrderId,
  rmaCommandId,
  rmaCaseId,
} from '@sayman/web-shared/testing/rma.test-fixtures.ts';

test('real session transport binds return commands to the verified owner and rejects late private responses after signout', async (t) => {
  const identity = {
    accessToken: 'synthetic-rma-token-kept-in-memory',
    expiresIn: 600,
    requiresMfa: false,
    requiresEnrollment: false,
    user: { id: 'RETURN-OWNER', displayName: 'Synthetic owner', userName: 'owner' },
  };
  const store = new CustomerSessionStore(
    undefined,
    async () => identity,
    async (run) => run(),
    () => false,
  );
  await store.restore();
  assert.equal(customerRmaJournal.isBound(identity.user.id), true);
  let calls = 0;
  const pending = Promise.withResolvers<Response>();
  let delayed = false;
  t.mock.method(globalThis, 'fetch', async (_path: string, init: RequestInit) => {
    calls++;
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer ' + identity.accessToken);
    assert.equal(init.cache, 'no-store');
    return delayed ? pending.promise : Response.json({});
  });
  const command = rmaCommand('create', rmaCreateBody(), { orderId: rmaOrderId }, rmaCommandId);
  await store.fetch(command.path, { method: 'PUT', body: JSON.stringify(command.body) });
  for (const path of [
    '/api/returns',
    `/api/returns/${rmaCaseId}`,
    command.receiptPath,
    `/api/orders/${rmaOrderId}/returns/context`,
  ])
    await store.fetch(path);
  assert.equal(calls, 5);
  for (const path of [
    '/api/returns/policy',
    '/api/returns?owner=OTHER',
    '/api/returns?state=submitted&state=reviewing',
    `/api/returns/${rmaCaseId}?owner=OTHER`,
    `/api/admin/returns/${rmaCaseId}`,
    command.path + '/',
  ])
    await assert.rejects(store.fetch(path));
  await assert.rejects(store.fetch(command.path, { method: 'POST', body: '{}' }));
  assert.equal(calls, 5);
  customerRmaJournal.begin(identity.user.id, command);
  delayed = true;
  const response = store.fetch(command.receiptPath);
  store.remote('signout');
  pending.resolve(Response.json({ private: 'late old owner text' }));
  await assert.rejects(response, /changed/);
  assert.equal(customerRmaJournal.snapshot(identity.user.id), null);
  assert.equal(customerRmaJournal.isBound(identity.user.id), false);
});
