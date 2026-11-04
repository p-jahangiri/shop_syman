import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SessionAccess,
  SessionUnavailable,
  SessionChanged,
  type RenewedAccess,
} from '../src/auth/session-access.ts';
test('a suspended timer cannot send an expired access token with the next mutation', async () => {
  let now = 0;
  const gate = new SessionAccess(() => now);
  gate.setToken('old', 900);
  let renewals = 0,
    accepted = 0,
    writes = 0;
  gate.setRenewal(async () => {
    renewals++;
    return { token: 'fresh', expiresIn: 900, accepted: () => accepted++ };
  });
  now = 21 * 60 * 1000;
  await gate.beforeRequest('/admin/products');
  writes++;
  assert.equal(gate.token, 'fresh');
  assert.equal(renewals, 1);
  assert.equal(accepted, 1);
  assert.equal(writes, 1);
});
test('concurrent reads and writes share one renewal before their first send', async () => {
  let now = 0;
  const gate = new SessionAccess(() => now);
  gate.setToken('old', 900);
  now = 850000;
  let resolve!: (value: RenewedAccess) => void;
  let calls = 0;
  let accepted = 0;
  gate.setRenewal(() => {
    calls++;
    return new Promise((r) => {
      resolve = r;
    });
  });
  const waiting = Array.from({ length: 30 }, (_, i) =>
    gate.beforeRequest(i % 2 ? '/admin/inventory/v/adjust' : '/admin/products'),
  );
  await Promise.resolve();
  assert.equal(calls, 1);
  resolve({ token: 'new', expiresIn: 900, accepted: () => accepted++ });
  await Promise.all(waiting);
  assert.equal(accepted, 1);
  assert.equal(gate.token, 'new');
});
test('a failed renewal prevents the command and does not retry it', async () => {
  let now = 0;
  const gate = new SessionAccess(() => now);
  gate.setToken('old', 900);
  now = 900000;
  let calls = 0,
    writes = 0;
  gate.setRenewal(async () => {
    calls++;
    throw Error('offline');
  });
  await assert.rejects(
    gate.beforeRequest('/admin/inventory/v/adjust').then(() => writes++),
    /offline/,
  );
  assert.equal(calls, 1);
  assert.equal(writes, 0);
  gate.setRenewal(async () => ({ token: 'new', expiresIn: 900, accepted: () => {} }));
  await gate.beforeRequest('/admin/inventory/v/adjust');
  assert.equal(gate.token, 'new');
});
test('logout during renewal cannot restore the old session or send its waiting command', async () => {
  let now = 0;
  const gate = new SessionAccess(() => now);
  gate.setToken('old', 900);
  now = 900000;
  let resolve!: (value: RenewedAccess) => void;
  let accepted = 0;
  gate.setRenewal(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const waiting = gate.beforeRequest('/admin/products');
  await Promise.resolve();
  gate.setToken('');
  gate.setRenewal(null);
  resolve({ token: 'late', expiresIn: 900, accepted: () => accepted++ });
  await assert.rejects(waiting, SessionUnavailable);
  assert.equal(gate.token, '');
  assert.equal(accepted, 0);
});
test('a newer login supersedes an in-flight renewal', async () => {
  let now = 0;
  const gate = new SessionAccess(() => now);
  gate.setToken('old', 900);
  now = 900000;
  let resolve!: (value: RenewedAccess) => void;
  gate.setRenewal(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const waiting = gate.beforeRequest('/admin/products');
  await Promise.resolve();
  gate.setToken('another-session', 900);
  resolve({
    token: 'late',
    expiresIn: 900,
    accepted: () => assert.fail('must not accept stale renewal'),
  });
  await assert.rejects(waiting, SessionChanged);
  assert.equal(gate.token, 'another-session');
});
test('a timer that accepted the shared renewal does not invalidate its waiting requests', async () => {
  let now = 0;
  const gate = new SessionAccess(() => now);
  gate.setToken('old', 900);
  now = 900000;
  let resolve!: (value: RenewedAccess) => void;
  gate.setRenewal(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const waiting = gate.beforeRequest('/admin/products');
  await Promise.resolve();
  gate.setToken('shared-fresh', 900);
  resolve({
    token: 'shared-fresh',
    expiresIn: 900,
    accepted: () => assert.fail('timer already accepted'),
  });
  await waiting;
  assert.equal(gate.token, 'shared-fresh');
});
test('refresh itself and short-lived MFA grants never recursively renew', async () => {
  const gate = new SessionAccess(() => 1000);
  let calls = 0;
  gate.setRenewal(async () => {
    calls++;
    throw Error('unexpected');
  });
  gate.setToken('expired', 0);
  await gate.beforeRequest('/auth/refresh');
  gate.setToken('mfa-pending');
  await gate.beforeRequest('/auth/mfa/verify');
  gate.setToken('');
  await gate.beforeRequest('/auth/password');
  assert.equal(calls, 0);
});
test('a successful-looking renewal without usable access blocks the waiting command', async () => {
  for (const value of [
    { token: '', expiresIn: 900 },
    { token: 'new', expiresIn: 0 },
    { token: 'new', expiresIn: NaN },
  ]) {
    const gate = new SessionAccess(() => 0);
    gate.setToken('old', 0);
    gate.setRenewal(async () => ({
      ...value,
      accepted: () => assert.fail('must not accept invalid access'),
    }));
    await assert.rejects(gate.beforeRequest('/admin/products'), SessionUnavailable);
  }
});
test('a locked or MFA-only access cannot send private requests before the owner is verified again', async () => {
  const gate = new SessionAccess(() => 0);
  let writes = 0;
  for (const token of ['', 'synthetic-mfa-grant']) {
    gate.setToken(token);
    await assert.rejects(
      gate.beforeRequest('/admin/sourcing/requests').then(() => writes++),
      SessionUnavailable,
    );
  }
  assert.equal(writes, 0);
  gate.setToken('verified-access', 600);
  await gate.beforeRequest('/admin/sourcing/requests');
  writes++;
  assert.equal(writes, 1);
});
