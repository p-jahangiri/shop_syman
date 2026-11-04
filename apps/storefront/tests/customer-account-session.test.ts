import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CustomerSessionStore,
  SessionError,
  type CustomerSession,
  type SessionTransport,
} from '../lib/account/customer-session.ts';

const session = (id = 'account-one', token = 'first'): CustomerSession => ({
  accessToken: 'synthetic-memory-token-' + token,
  expiresIn: 600,
  requiresMfa: false,
  requiresEnrollment: false,
  user: { id, displayName: 'Synthetic account', userName: id },
});
const directLock = async <T>(run: () => Promise<T>) => run();
function memoryPending() {
  let pending = false;
  return (value?: boolean) => {
    if (value !== undefined) pending = value;
    return pending;
  };
}

test('credential changes immediately clear private state and require fresh sign-in after cookie cleanup', async () => {
  const cleanup = Promise.withResolvers<void>(),
    pending = memoryPending(),
    broadcasts: string[] = [],
    requests: { path: string; body: unknown; token: string | undefined }[] = [];
  const transport: SessionTransport = async (path, body, token) => {
    requests.push({ path, body, token });
    if (path === 'logout') {
      await cleanup.promise;
      return undefined;
    }
    return session('account-one', 'fresh');
  };
  const store = new CustomerSessionStore(
    transport,
    async () => session(),
    directLock,
    pending,
    (event) => broadcasts.push(event),
  );
  await store.restore();
  const changed = store.credentialsChanged('account-one', store.viewRevision());
  assert.equal(store.snapshot().session, null);
  assert.equal(store.snapshot().logoutPending, true);
  assert.equal(pending(), true);
  assert.deepEqual(broadcasts, ['signout']);
  await assert.rejects(store.fetch('/api/account/profile'));
  cleanup.resolve();
  assert.equal(await changed, true);
  assert.equal(store.snapshot().status, 'guest');
  assert.equal(pending(), false);
  assert.deepEqual(requests, [{ path: 'logout', body: {}, token: undefined }]);
  await store.login('synthetic-user', 'Synthetic!Password23');
  assert.equal(store.snapshot().status, 'member');
  assert.equal(store.snapshot().session?.accessToken, session('account-one', 'fresh').accessToken);
  store.remote('signout');
});

test('uncertain cookie cleanup stays explicit and retry logs out before any refresh', async () => {
  const pending = memoryPending(),
    broadcasts: string[] = [];
  let logouts = 0,
    refreshes = 0;
  const store = new CustomerSessionStore(
    async (path) => {
      assert.equal(path, 'logout');
      if (++logouts === 1) throw new SessionError('unavailable');
      return undefined;
    },
    async () => {
      refreshes++;
      return session();
    },
    directLock,
    pending,
    (event) => broadcasts.push(event),
  );
  await store.restore();
  await assert.rejects(
    store.credentialsChanged('account-one', store.viewRevision()),
    (error) => error instanceof SessionError && error.kind === 'unavailable',
  );
  assert.equal(store.snapshot().status, 'unavailable');
  assert.equal(store.snapshot().session, null);
  assert.equal(store.snapshot().logoutPending, true);
  assert.equal(pending(), true);
  assert.deepEqual(broadcasts, ['signout']);
  await store.restore();
  assert.equal(refreshes, 1);
  assert.equal(logouts, 2);
  assert.equal(store.snapshot().status, 'guest');
  assert.equal(pending(), false);
});

test('credential-change broadcast clears another tab before cleanup can finish and rejects its late private response', async (t) => {
  const cleanup = Promise.withResolvers<void>(),
    response = Promise.withResolvers<Response>(),
    other = new CustomerSessionStore(undefined, async () => session(), directLock, memoryPending());
  await other.restore();
  t.mock.method(globalThis, 'fetch', async () => response.promise);
  const privateRead = other.fetch('/api/account/profile');
  const broadcasts: string[] = [];
  const source = new CustomerSessionStore(
    async () => {
      await cleanup.promise;
      return undefined;
    },
    async () => session(),
    directLock,
    memoryPending(),
    (event) => {
      broadcasts.push(event);
      other.remote(event);
    },
  );
  await source.restore();
  const changed = source.credentialsChanged('account-one', source.viewRevision());
  assert.equal(other.snapshot().status, 'guest');
  assert.equal(other.snapshot().session, null);
  assert.deepEqual(broadcasts, ['signout']);
  response.resolve(Response.json({ private: 'old account response' }));
  await assert.rejects(
    privateRead,
    (error) => error instanceof SessionError && error.kind === 'changed',
  );
  cleanup.resolve();
  assert.equal(await changed, true);
});

test('an old owner or an earlier login of the same owner cannot trigger credential cleanup', async () => {
  for (const replacement of ['account-two', 'account-one']) {
    const broadcasts: string[] = [];
    let cleanupCalls = 0;
    const store = new CustomerSessionStore(
      async (path) => {
        if (path === 'logout') {
          cleanupCalls++;
          return undefined;
        }
        return session(replacement, 'replacement');
      },
      async () => session(),
      directLock,
      memoryPending(),
      (event) => broadcasts.push(event),
    );
    await store.restore();
    const oldRevision = store.viewRevision();
    await store.login('synthetic-user', 'Synthetic!Password23');
    broadcasts.length = 0;
    assert.equal(await store.credentialsChanged('account-one', oldRevision), false);
    assert.equal(await store.credentialsChanged('unrelated-owner', store.viewRevision()), false);
    assert.equal(cleanupCalls, 0);
    assert.deepEqual(broadcasts, []);
    assert.equal(store.snapshot().session?.user.id, replacement);
    store.remote('signout');
  }
});

test('a late failed cleanup cannot clear a newer session or report its outcome as the old account', async () => {
  const cleanup = Promise.withResolvers<void>();
  let owner = 'account-one';
  const store = new CustomerSessionStore(
    async () => {
      await cleanup.promise;
      return undefined;
    },
    async () => session(owner),
    directLock,
    memoryPending(),
  );
  await store.restore();
  const changed = store.credentialsChanged(owner, store.viewRevision());
  owner = 'account-two';
  store.remote('signin');
  await store.restore();
  cleanup.reject(new SessionError('unavailable'));
  assert.equal(await changed, false);
  assert.equal(store.snapshot().status, 'member');
  assert.equal(store.snapshot().session?.user.id, 'account-two');
  assert.equal(store.snapshot().logoutPending, false);
  store.remote('signout');
});

test('cleanup queued behind another tab sign-in must not revoke that new shared-cookie session', async () => {
  const release = Promise.withResolvers<void>();
  let cleanupCalls = 0,
    owner = 'account-one';
  const queuedLock = async <T>(run: () => Promise<T>) => {
    await release.promise;
    return run();
  };
  const store = new CustomerSessionStore(
    async () => {
      cleanupCalls++;
      return undefined;
    },
    async () => session(owner),
    queuedLock,
    memoryPending(),
  );
  await store.restore();
  const changed = store.credentialsChanged(owner, store.viewRevision());
  owner = 'account-two';
  store.remote('signin');
  await store.restore();
  release.resolve();
  assert.equal(await changed, false);
  assert.equal(cleanupCalls, 0, 'Do not send logout using the replacement refresh cookie');
  assert.equal(store.snapshot().session?.user.id, 'account-two');
  store.remote('signout');
});

test('account transport permits only exact customer routes and strips forged authorization', async (t) => {
  const store = new CustomerSessionStore(
    undefined,
    async () => session(),
    directLock,
    memoryPending(),
  );
  await store.restore();
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (path: string, init: RequestInit) => {
    requests.push(path);
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer ' + session().accessToken);
    assert.equal(init.cache, 'no-store');
    assert.equal(init.credentials, 'same-origin');
    return Response.json({});
  });
  for (const [path, method] of [
    ['/api/account/profile', 'GET'],
    ['/api/account/profile', 'PUT'],
    ['/api/account/password', 'POST'],
  ])
    await store.fetch(path, { method, headers: { Authorization: 'Bearer forged' } });
  for (const [path, method] of [
    ['/api/account/profile?owner=other', 'GET'],
    ['/api/account/profile/', 'GET'],
    ['/api/account/profile/other', 'GET'],
    ['/api/account/profile', 'DELETE'],
    ['/api/account/profile', 'PATCH'],
    ['/api/account/password', 'GET'],
    ['/api/account/password', 'PUT'],
    ['/api/account/password?request=1', 'POST'],
    ['/api/account/../admin/profile', 'PUT'],
    ['/api/account/%70rofile', 'GET'],
    ['/api/admin/account/profile', 'GET'],
    ['https://other.example/api/account/profile', 'GET'],
  ])
    await assert.rejects(
      store.fetch(path, { method }),
      (error) => error instanceof SessionError && error.kind === 'unavailable',
    );
  assert.equal(requests.length, 3);
  store.remote('signout');
});

test('old account responses cannot return after a different user or a fresh login of the same user', async (t) => {
  for (const replacement of ['account-two', 'account-one']) {
    const response = Promise.withResolvers<Response>(),
      store = new CustomerSessionStore(
        async () => session(replacement, 'replacement'),
        async () => session(),
        directLock,
        memoryPending(),
      );
    await store.restore();
    const mock = t.mock.method(globalThis, 'fetch', async () => response.promise);
    const read = store.fetch('/api/account/profile');
    await store.login('synthetic-user', 'Synthetic!Password23');
    response.resolve(Response.json({ private: 'old account profile' }));
    await assert.rejects(
      read,
      (error) => error instanceof SessionError && error.kind === 'changed',
    );
    assert.equal(store.snapshot().session?.user.id, replacement);
    mock.mock.restore();
    store.remote('signout');
  }
});
