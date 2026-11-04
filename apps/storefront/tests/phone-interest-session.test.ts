import test from 'node:test';
import assert from 'node:assert/strict';
import { isPhoneInterestPath } from '../lib/market/phone-interest-path.ts';
import {
  CustomerSessionStore,
  SessionError,
  type CustomerSession,
} from '../lib/account/customer-session.ts';
import {
  startPhoneInterest,
  finishPhoneInterest,
  pendingPhoneInterest,
  sendPhoneInterest,
  type PhoneInterestCommand,
} from '../lib/market/phone-interest-client.ts';
import {
  phoneTestCommand as fixture,
  phoneTestResult as result,
  phoneTestId as configuration,
  phoneTestOtherId as other,
  phoneTestOwner as owner,
  phoneTestCommandId as command,
} from './phone-discovery.test-fixtures.ts';
const base = '/api/phones/interests',
  listing = fixture.listingId,
  write = base + '/' + listing + '/commands/' + command,
  session = (id = owner, token = 'one'): CustomerSession => ({
    accessToken: 'phone-contract-test-token-' + token,
    expiresIn: 600,
    requiresMfa: false,
    requiresEnrollment: false,
    user: { id, displayName: 'Synthetic test', userName: 'synthetic' },
  }),
  lock = async <T>(run: () => Promise<T>) => run(),
  pending = () => false;
const valid: [string, string][] = [
  [base, 'GET'],
  [base + '?cursor=' + configuration, 'GET'],
  [base + '/' + listing + '/' + configuration, 'GET'],
  [base + '/commands/' + command, 'GET'],
  [write, 'PUT'],
];
const invalid: [string, string][] = [
  [base, 'POST'],
  [base, 'PUT'],
  [write, 'GET'],
  [write, 'POST'],
  [write, 'DELETE'],
  [base + '/' + listing + '/' + configuration, 'PUT'],
  [base + '/commands/' + command, 'PUT'],
  [base + '?owner=' + other, 'GET'],
  [base + '?cursor=' + configuration + '&cursor=' + other, 'GET'],
  [base + '?cursor=', 'GET'],
  [base + '?cursor=BAD', 'GET'],
  [write + '?cursor=' + configuration, 'PUT'],
  [base + '/' + listing + '/' + configuration + '?owner=' + other, 'GET'],
  [base + '/commands/' + command + '?cursor=' + configuration, 'GET'],
  [base + '/commands/' + '0'.repeat(32), 'GET'],
  [base + '/' + listing + '/' + '0'.repeat(32), 'GET'],
  ['/api/phones/en/search', 'POST'],
  ['/api/phones/en/' + listing, 'GET'],
  ['/api/admin/market/' + listing + '/phone-configurations', 'GET'],
  ['https://evil.example' + base, 'GET'],
  ['//evil.example' + base, 'GET'],
  [base + '/../interests', 'GET'],
  [base + '/%2e%2e/interests', 'GET'],
  [base + '/' + listing + '%2fadmin/' + configuration, 'GET'],
  [base + '#secret', 'GET'],
  [base + '-forged', 'GET'],
  [base + '-forged/' + listing + '/' + configuration, 'GET'],
  [base + '-forged/' + listing + '/commands/' + command, 'PUT'],
  [base + '/', 'GET'],
];

test('phone interest session allowlist is exact, bounded and separate from public discovery', () => {
  for (const [path, method] of valid) assert.equal(isPhoneInterestPath(path, method), true, path);
  for (const [path, method] of invalid)
    assert.equal(isPhoneInterestPath(path, method), false, path);
});

test('actual CustomerSessionStore fetch reaches every legitimate interest resource with current private authority', async (t) => {
  const store = new CustomerSessionStore(undefined, async () => session(), lock, pending);
  await store.restore();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (path: string, init: RequestInit) => {
    calls++;
    assert.ok(valid.some(([value, method]) => value === path && method === (init.method ?? 'GET')));
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer ' + session().accessToken);
    assert.equal(init.credentials, 'same-origin');
    assert.equal(init.cache, 'no-store');
    assert.ok(init.signal instanceof AbortSignal);
    return Response.json({});
  });
  for (const [path, method] of valid)
    await store.fetch(path, {
      method,
      headers: { Authorization: 'Bearer forged' },
      ...(method === 'PUT' ? { body: JSON.stringify(fixture.input) } : {}),
    });
  assert.equal(calls, valid.length);
});

test('actual session transport rejects forged interest routes, methods and query authority before fetching', async (t) => {
  const store = new CustomerSessionStore(undefined, async () => session(), lock, pending);
  await store.restore();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json({});
  });
  for (const [path, method] of invalid)
    await assert.rejects(
      store.fetch(path, { method }),
      (e) => e instanceof SessionError && e.kind === 'unavailable',
      path,
    );
  assert.equal(calls, 0);
});

test('interest responses after logout or a401 refresh to another account are discarded without cross-owner retry', async (t) => {
  let resolve!: (value: Response) => void;
  const waiting = new Promise<Response>((done) => (resolve = done)),
    store = new CustomerSessionStore(undefined, async () => session(), lock, pending);
  await store.restore();
  t.mock.method(globalThis, 'fetch', async () => waiting);
  const response = store.fetch(base + '/' + listing + '/' + configuration);
  store.remote('signout');
  resolve(Response.json({ private: 'old-owner' }));
  await assert.rejects(response, (e) => e instanceof SessionError && e.kind === 'changed');
  let refreshes = 0,
    calls = 0;
  const replacement = new CustomerSessionStore(
    undefined,
    async () => session(++refreshes === 1 ? owner : other),
    lock,
    pending,
  );
  await replacement.restore();
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(null, { status: 401 });
  });
  await assert.rejects(
    replacement.fetch(write, { method: 'PUT', body: JSON.stringify(fixture.input) }),
    (e) => e instanceof SessionError && e.kind === 'changed',
  );
  assert.equal(calls, 1);
});

test('same-owner401 refresh retries the exact frozen interest UUID/body with the renewed token', async (t) => {
  let refreshes = 0;
  const store = new CustomerSessionStore(
    undefined,
    async () => session(owner, String(++refreshes)),
    lock,
    pending,
  );
  await store.restore();
  const c = structuredClone(fixture) as PhoneInterestCommand,
    bodies: string[] = [],
    headers: string[] = [];
  startPhoneInterest(c);
  try {
    t.mock.method(globalThis, 'fetch', async (path: string, init: RequestInit) => {
      assert.equal(path, write);
      bodies.push(String(init.body));
      headers.push(new Headers(init.headers).get('Authorization')!);
      return bodies.length === 1 ? new Response(null, { status: 401 }) : Response.json(result);
    });
    assert.equal(
      (await sendPhoneInterest(store.fetch, c)).interest.configuration.id,
      configuration,
    );
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0], bodies[1]);
    assert.equal(bodies[0], JSON.stringify(c.input));
    assert.notEqual(headers[0], headers[1]);
    assert.deepEqual(pendingPhoneInterest(owner), c);
  } finally {
    finishPhoneInterest(owner, c.requestId);
  }
});

test('actual Guid D session owner can journal and send an interest without changing owner identity or public resource IDs', async (t) => {
  const identity = '6b21c80f-6aba-4c15-8c6a-98ee20710b48',
    store = new CustomerSessionStore(undefined, async () => session(identity), lock, pending);
  await store.restore();
  assert.equal(store.snapshot().session!.user.id, identity);
  const c = { ...structuredClone(fixture), owner: identity } as PhoneInterestCommand;
  startPhoneInterest(c);
  try {
    assert.deepEqual(pendingPhoneInterest(identity), c);
    assert.equal(pendingPhoneInterest(identity.replaceAll('-', '')), null);
    assert.equal(pendingPhoneInterest(identity.toUpperCase()), null);
    finishPhoneInterest(identity.toUpperCase(), c.requestId);
    assert.ok(pendingPhoneInterest(identity));
    t.mock.method(globalThis, 'fetch', async (path: string, init: RequestInit) => {
      assert.equal(path, write);
      const body = JSON.parse(String(init.body));
      assert.equal(body.configurationId, configuration);
      assert.equal('owner' in body, false);
      assert.equal(
        new Headers(init.headers).get('Authorization'),
        'Bearer ' + session(identity).accessToken,
      );
      return Response.json(result);
    });
    assert.equal(
      (await sendPhoneInterest(store.fetch, pendingPhoneInterest(identity)!)).interest.configuration
        .id,
      configuration,
    );
    assert.equal(pendingPhoneInterest(identity)!.owner, identity);
  } finally {
    finishPhoneInterest(identity, c.requestId);
  }
  assert.equal(pendingPhoneInterest(identity), null);
});
