import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CustomerSessionStore,
  SessionError,
  type CustomerSession,
  type SessionTransport,
} from '../lib/account/customer-session.ts';
import {
  startSourcingJournal,
  readSourcingJournal,
  finishSourcingJournal,
  failSourcingJournal,
  type SourcingCommand,
} from '../lib/market/sourcing-journal.ts';
import { offerActionSchema } from '@sayman/web-shared/lib/market/offer-contract.ts';
import {
  offerTestAction,
  offerTestId,
  offerTestRequest,
} from '@sayman/web-shared/testing/offer.test-fixtures.ts';
import {
  sourcingSubmitSchema,
  sourcingMutationSchema,
} from '@sayman/web-shared/lib/market/sourcing-contract.ts';
import {
  sourcingTestSubmit,
  sourcingTestMutation,
} from '@sayman/web-shared/testing/sourcing.test-fixtures.ts';
const session = (id = 'one'): CustomerSession => ({
  accessToken: 'test-token-never-persisted-' + id,
  expiresIn: 600,
  requiresMfa: false,
  requiresEnrollment: false,
  user: { id, displayName: id, userName: id },
});
const lock = async <T>(run: () => Promise<T>) => run();
const memoryPending = () => {
  let pending = false;
  return (value?: boolean) => {
    if (value !== undefined) pending = value;
    return pending;
  };
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
test('missing refresh is guest while an unavailable service never becomes guest', async () => {
  for (const kind of ['invalid', 'unavailable'] as const) {
    const store = new CustomerSessionStore(
      undefined,
      async () => {
        throw new SessionError(kind);
      },
      lock,
      memoryPending(),
    );
    await store.restore();
    assert.equal(store.snapshot().status, kind === 'invalid' ? 'guest' : 'unavailable');
    assert.equal(store.snapshot().session, null);
  }
});
test('parallel session restoration uses one refresh', async () => {
  const waiting = deferred<CustomerSession>();
  let calls = 0;
  const store = new CustomerSessionStore(
    undefined,
    () => {
      calls++;
      return waiting.promise;
    },
    lock,
    memoryPending(),
  );
  const first = store.restore(),
    second = store.restore();
  waiting.resolve(session());
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(store.snapshot().session?.user.id, 'one');
});
test('a refresh arriving after logout cannot restore the account', async () => {
  const waiting = deferred<CustomerSession>();
  const store = new CustomerSessionStore(
    async () => undefined,
    () => waiting.promise,
    lock,
    memoryPending(),
  );
  const refresh = store.restore();
  await store.logout();
  waiting.resolve(session());
  await refresh;
  assert.equal(store.snapshot().status, 'guest');
  assert.equal(store.snapshot().session, null);
});
test('failed logout clears private memory and retry finishes logout before any refresh', async () => {
  let attempts = 0,
    refreshes = 0;
  const pending = memoryPending();
  const store = new CustomerSessionStore(
    async (path) => {
      assert.equal(path, 'logout');
      if (++attempts === 1) throw new SessionError('unavailable');
      return undefined;
    },
    async () => {
      refreshes++;
      return session();
    },
    lock,
    pending,
  );
  await store.restore();
  await assert.rejects(store.logout());
  assert.equal(store.snapshot().session, null);
  assert.equal(store.snapshot().status, 'unavailable');
  assert.equal(pending(), true);
  await store.restore();
  assert.equal(attempts, 2);
  assert.equal(refreshes, 1);
  assert.equal(pending(), false);
  assert.equal(store.snapshot().status, 'guest');
});
test('late password response after a remote logout cannot sign the account in', async () => {
  const waiting = deferred<CustomerSession>();
  const store = new CustomerSessionStore(
    () => waiting.promise,
    async () => {
      throw new SessionError('invalid');
    },
    lock,
    memoryPending(),
  );
  await store.restore();
  const login = store.login('user', 'not-stored');
  store.remote('signout');
  waiting.resolve(session());
  await assert.rejects(login, (e) => e instanceof SessionError && e.kind === 'changed');
  assert.equal(store.snapshot().status, 'guest');
});
test('an old refresh cannot overwrite a newly signed-in account', async () => {
  const waiting = deferred<CustomerSession>();
  const store = new CustomerSessionStore(
    async () => session('new'),
    () => waiting.promise,
    lock,
    memoryPending(),
  );
  const refresh = store.restore();
  await store.login('new', 'not-stored');
  waiting.resolve(session('old'));
  await refresh;
  assert.equal(store.snapshot().session?.user.id, 'new');
});
test('MFA challenge is not a complete customer session', async () => {
  const transport: SessionTransport = async (path) =>
    path === 'password' ? { ...session(), requiresMfa: true } : session();
  const store = new CustomerSessionStore(
    transport,
    async () => {
      throw new SessionError('invalid');
    },
    lock,
    memoryPending(),
  );
  await store.restore();
  const pending = await store.login('user', 'not-stored');
  assert.equal(pending.requiresMfa, true);
  assert.equal(store.snapshot().status, 'guest');
  await store.login('', '', pending.accessToken, '123456');
  assert.equal(store.snapshot().status, 'member');
});
test('a cart 401 never retries under another account', async (t) => {
  let refreshes = 0,
    calls = 0;
  const store = new CustomerSessionStore(
    undefined,
    async () => session(++refreshes === 1 ? 'one' : 'two'),
    lock,
    memoryPending(),
  );
  await store.restore();
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(null, { status: 401 });
  });
  await assert.rejects(
    store.fetch('/api/cart/en'),
    (e) => e instanceof SessionError && e.kind === 'changed',
  );
  assert.equal(calls, 1);
  assert.equal(store.snapshot().session?.user.id, 'two');
});
test('guest cart transport removes supplied bearer and keeps requests private', async (t) => {
  const store = new CustomerSessionStore(
    undefined,
    async () => {
      throw new SessionError('invalid');
    },
    lock,
    memoryPending(),
  );
  await store.restore();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_path: string, init: RequestInit) => {
    calls++;
    assert.equal(new Headers(init.headers).has('Authorization'), false);
    assert.equal(init.cache, 'no-store');
    assert.equal(init.credentials, 'same-origin');
    return Response.json({});
  });
  await store.fetch('/api/cart/fa', { headers: { Authorization: 'Bearer supplied' } });
  await assert.rejects(store.fetch('https://untrusted.example/cart'));
  assert.equal(calls, 1);
});
test('a delayed order response after logout is discarded, including after refresh retry', async (t) => {
  const delayed = deferred<Response>();
  let calls = 0;
  const store = new CustomerSessionStore(
    async () => undefined,
    async () => session(),
    lock,
    memoryPending(),
  );
  await store.restore();
  t.mock.method(globalThis, 'fetch', async () =>
    ++calls === 1 ? new Response(null, { status: 401 }) : delayed.promise,
  );
  const task = store.fetch('/api/orders', { method: 'GET' });
  await new Promise((resolve) => setImmediate(resolve));
  store.remote('signout');
  delayed.resolve(Response.json({ private: 'must not return' }));
  await assert.rejects(task, (e) => e instanceof SessionError && e.kind === 'changed');
  assert.equal(calls, 2);
});
test('order transport adds current bearer only to permitted paths', async (t) => {
  const store = new CustomerSessionStore(undefined, async () => session(), lock, memoryPending());
  await store.restore();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_path: string, init: RequestInit) => {
    calls++;
    assert.equal(new Headers(init.headers).get('Authorization'), `Bearer ${session().accessToken}`);
    assert.equal(init.cache, 'no-store');
    return Response.json({});
  });
  await store.fetch('/api/orders?cursor=abc_-');
  await store.fetch('/api/orders/' + 'a'.repeat(32) + '/cancel', { method: 'POST' });
  for (const path of [
    '/api/orders/../admin',
    '/api/orders?ownerId=other',
    '/api/orders?cursor=a&ownerId=other',
    'https://evil.example/api/orders',
  ])
    await assert.rejects(store.fetch(path));
  assert.equal(calls, 2);
});
test('session address transport accepts only own canonical resources and rejects results after owner changes', async () => {
  const store = new CustomerSessionStore(undefined, async () => session(), lock, memoryPending());
  await store.restore();
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (path, init) => {
      calls++;
      assert.equal(
        new Headers(init?.headers).get('Authorization'),
        'Bearer ' + session().accessToken,
      );
      assert.equal(init?.cache, 'no-store');
      return Response.json({});
    };
    await store.fetch('/api/addresses');
    await store.fetch('/api/addresses/' + 'a'.repeat(32), { method: 'DELETE' });
    for (const path of [
      '/api/addresses?ownerId=other',
      '/api/addresses/../admin',
      '/api/addresses/' + 'A'.repeat(32),
      '/api/addresses/x',
      'https://evil.test/api/addresses',
    ])
      await assert.rejects(store.fetch(path));
    assert.equal(calls, 2);
    const wait = deferred<Response>();
    globalThis.fetch = () => wait.promise;
    const pending = store.fetch('/api/addresses');
    store.remote('signout');
    wait.resolve(Response.json({ private: 'must be discarded' }));
    await assert.rejects(pending, (e) => e instanceof SessionError && e.kind === 'changed');
  } finally {
    globalThis.fetch = original;
  }
});
test('sourcing transport permits only canonical cart/request paths and clears frozen commands synchronously on logout', async (t) => {
  const store = new CustomerSessionStore(
    async () => undefined,
    async () => session(),
    lock,
    memoryPending(),
  );
  await store.restore();
  startSourcingJournal('one', {
    kind: 'submit',
    locale: 'fa',
    body: sourcingSubmitSchema.parse(sourcingTestSubmit),
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (path: string, init: RequestInit) => {
    calls++;
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer ' + session().accessToken);
    assert.equal(init.cache, 'no-store');
    return Response.json({});
  });
  for (const path of [
    '/api/cart/fa/sourcing',
    '/api/cart/en/sourcing/submit',
    '/api/sourcing/requests',
    '/api/sourcing/requests?cursor=abc_-',
    '/api/sourcing/requests/' + 'a'.repeat(32) + '/events?cursor=abc_-',
    '/api/sourcing/requests/' + 'a'.repeat(32) + '/cancel',
  ])
    await store.fetch(path);
  for (const path of [
    '/api/sourcing/requests?ownerId=other',
    '/api/cart/fa/sourcing/admin',
    '/api/sourcing/requests/' + 'a'.repeat(32) + '/review',
    '/api/sourcing/requests/' + 'a'.repeat(32) + '/events?cursor=a&ownerId=b',
    'https://evil.test/api/sourcing/requests',
  ])
    await assert.rejects(store.fetch(path));
  assert.equal(calls, 6);
  await store.logout();
  assert.equal(readSourcingJournal('one'), null);
  assert.equal(
    finishSourcingJournal(
      'one',
      sourcingTestSubmit.requestId,
      sourcingMutationSchema.parse(sourcingTestMutation),
    ),
    false,
  );
});
test('a same-owner restoration hides but preserves a frozen sourcing command until identity is known', async () => {
  const first = new CustomerSessionStore(undefined, async () => session(), lock, memoryPending());
  await first.restore();
  startSourcingJournal('one', {
    kind: 'submit',
    locale: 'fa',
    body: sourcingSubmitSchema.parse(sourcingTestSubmit),
  });
  const refresh = deferred<CustomerSession>();
  const replacement = new CustomerSessionStore(
    undefined,
    () => refresh.promise,
    lock,
    memoryPending(),
  );
  const pending = replacement.restore();
  assert.equal(replacement.snapshot().status, 'restoring');
  assert.ok(readSourcingJournal('one'));
  refresh.resolve(session());
  await pending;
  assert.equal(readSourcingJournal('one')!.command.body.requestId, sourcingTestSubmit.requestId);
  replacement.remote('signout');
  assert.equal(readSourcingJournal('one'), null);
});
test('offer transport allows only owner child paths and discards a late private response after owner changes', async (t) => {
  const store = new CustomerSessionStore(
    async () => undefined,
    async () => session(),
    lock,
    memoryPending(),
  );
  await store.restore();
  const root = '/api/sourcing/requests/' + 'b'.repeat(32) + '/offers',
    child = root + '/' + 'c'.repeat(32);
  let calls = 0;
  const delayed = deferred<Response>();
  t.mock.method(globalThis, 'fetch', async (path: string, init: RequestInit) => {
    calls++;
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer ' + session().accessToken);
    assert.equal(init.cache, 'no-store');
    return path.endsWith('/accept') ? delayed.promise : Response.json({});
  });
  for (const path of [
    root,
    root + '?cursor=abc_-',
    child,
    child + '/events?cursor=abc_-',
    child + '/decline',
    child + '/commands/accept/01234567-89ab-4cde-8012-3456789abcde',
  ])
    await store.fetch(path);
  for (const path of [
    root + '?ownerId=other',
    child + '/publish',
    child + '/withdraw',
    child + '/convert',
    child + '/commands/save/01234567-89ab-4cde-8012-3456789abcde',
    root + '/../admin',
  ])
    await assert.rejects(store.fetch(path));
  assert.equal(calls, 6);
  const waiting = store.fetch(child + '/accept', { method: 'POST' });
  store.remote('signout');
  delayed.resolve(Response.json({ private: 'discard this old owner result' }));
  await assert.rejects(
    waiting,
    (error) => error instanceof SessionError && error.kind === 'changed',
  );
  assert.equal(calls, 7);
});
test('temporary refresh failure hides access but preserves frozen offer and legacy cancellation intent for the same verified owner', async (t) => {
  let networkCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    networkCalls++;
    return Response.json({});
  });
  for (const kind of ['accept', 'decline', 'cancel'] as const) {
    let refreshes = 0;
    const verification = deferred<CustomerSession>();
    const transport: SessionTransport = async (path) => {
      assert.equal(path, 'refresh');
      if (++refreshes === 1) return session();
      if (refreshes === 2) throw new SessionError('unavailable');
      return verification.promise;
    };
    const store = new CustomerSessionStore(
      transport,
      () => transport('refresh', {}),
      lock,
      memoryPending(),
    );
    await store.restore();
    const command: SourcingCommand =
      kind === 'cancel'
        ? {
            kind,
            id: offerTestRequest,
            body: { requestId: offerTestAction.requestId, version: offerTestAction.version },
          }
        : {
            kind,
            id: offerTestRequest,
            offerId: offerTestId,
            reference: 'SR-1',
            body: offerActionSchema.parse(offerTestAction),
          };
    startSourcingJournal('one', command);
    assert.equal(failSourcingJournal('one', command.body.requestId, 0), 'unknown');
    const frozen = readSourcingJournal('one');
    await store.restore(true);
    assert.equal(store.snapshot().status, 'unavailable');
    assert.equal(store.snapshot().session, null);
    assert.equal(store.snapshot().expiresAt, 0);
    assert.deepEqual(readSourcingJournal('one'), frozen);
    await assert.rejects(
      store.fetch(`/api/sourcing/requests/${offerTestRequest}/offers/${offerTestId}/accept`, {
        method: 'POST',
      }),
      (error) => error instanceof SessionError && error.kind === 'unavailable',
    );
    assert.equal(networkCalls, 0);
    const restoring = store.restore();
    assert.equal(store.snapshot().status, 'restoring');
    assert.equal(store.snapshot().session, null);
    assert.deepEqual(readSourcingJournal('one'), frozen);
    verification.resolve(session());
    await restoring;
    assert.equal(store.snapshot().status, 'member');
    assert.equal(store.snapshot().session?.user.id, 'one');
    assert.deepEqual(readSourcingJournal('one'), frozen);
    assert.equal(readSourcingJournal('one')!.uncertain, true);
    store.remote('signout');
    assert.equal(readSourcingJournal('one'), null);
  }
});
test('verification of a different owner after a temporary refresh failure clears the previous offer journal', async () => {
  let refreshes = 0;
  const transport: SessionTransport = async (path) => {
    assert.equal(path, 'refresh');
    if (++refreshes === 1) return session('one');
    if (refreshes === 2) throw new SessionError('unavailable');
    return session('two');
  };
  const store = new CustomerSessionStore(
    transport,
    () => transport('refresh', {}),
    lock,
    memoryPending(),
  );
  await store.restore();
  startSourcingJournal('one', {
    kind: 'accept',
    id: offerTestRequest,
    offerId: offerTestId,
    reference: 'SR-1',
    body: offerActionSchema.parse(offerTestAction),
  });
  failSourcingJournal('one', offerTestAction.requestId, 0);
  await store.restore(true);
  assert.equal(store.snapshot().status, 'unavailable');
  assert.ok(readSourcingJournal('one'));
  await store.restore();
  assert.equal(store.snapshot().session?.user.id, 'two');
  assert.equal(readSourcingJournal('one'), null);
  assert.equal(readSourcingJournal('two'), null);
  store.remote('signout');
});
test('an invalid refresh or explicit logout still clears a preserved unresolved command, even if logout fails', async () => {
  for (const exit of ['invalid-refresh', 'failed-logout'] as const) {
    let refreshes = 0;
    const transport: SessionTransport = async (path) => {
      if (path === 'logout') throw new SessionError('unavailable');
      assert.equal(path, 'refresh');
      if (++refreshes === 1) return session();
      throw new SessionError(refreshes === 2 ? 'unavailable' : 'invalid');
    };
    const store = new CustomerSessionStore(
      transport,
      () => transport('refresh', {}),
      lock,
      memoryPending(),
    );
    await store.restore();
    startSourcingJournal('one', {
      kind: 'accept',
      id: offerTestRequest,
      offerId: offerTestId,
      reference: 'SR-1',
      body: offerActionSchema.parse(offerTestAction),
    });
    failSourcingJournal('one', offerTestAction.requestId, 0);
    await store.restore(true);
    assert.ok(readSourcingJournal('one'));
    if (exit === 'invalid-refresh') {
      await store.restore();
      assert.equal(store.snapshot().status, 'guest');
      assert.equal(store.snapshot().logoutPending, false);
    } else {
      const logout = store.logout();
      assert.equal(readSourcingJournal('one'), null);
      await assert.rejects(
        logout,
        (error) => error instanceof SessionError && error.kind === 'unavailable',
      );
      assert.equal(store.snapshot().status, 'unavailable');
      assert.equal(store.snapshot().logoutPending, true);
    }
    assert.equal(store.snapshot().session, null);
    assert.equal(readSourcingJournal('one'), null);
    store.remote('signout');
  }
});
test('private notification transport stays owner-bound and cannot reach staff, forged filters or unexpected mutations', async (t) => {
  const store = new CustomerSessionStore(undefined, async () => session(), lock, memoryPending());
  await store.restore();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_path: string, init: RequestInit) => {
    calls++;
    assert.equal(new Headers(init.headers).get('Authorization'), `Bearer ${session().accessToken}`);
    assert.equal(init.cache, 'no-store');
    return Response.json({});
  });
  await store.fetch('/api/notifications');
  await store.fetch('/api/notifications/unread-count');
  await store.fetch('/api/notifications/' + 'a'.repeat(32) + '/read', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  for (const path of [
    '/api/notifications?owner=other',
    '/api/admin/notifications',
    '/api/notifications?unreadOnly=1',
    '/api/notifications/../auth',
  ])
    await assert.rejects(store.fetch(path));
  assert.equal(calls, 3);
});
test('realtime uses the current bearer only for exact transport paths and rejects a late old-account poll', async (t) => {
  const store = new CustomerSessionStore(undefined, async () => session(), lock, memoryPending());
  await store.restore();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_path: string, init: RequestInit) => {
    calls++;
    assert.equal(new Headers(init.headers).get('Authorization'), `Bearer ${session().accessToken}`);
    return Response.json({});
  });
  const id = 'a'.repeat(100);
  await store.fetch('/api/realtime/negotiate?negotiateVersion=1', { method: 'POST' });
  await store.fetch('/api/realtime?id=' + id);
  await store.fetch('/api/realtime?id=' + id, { method: 'DELETE' });
  for (const path of [
    '/api/realtime?id=' + id + '&access_token=other',
    '/api/admin/realtime?id=' + id,
    '/api/realtime?id=' + id + '&owner=other',
  ])
    await assert.rejects(store.fetch(path));
  assert.equal(calls, 3);
  const delayed = deferred<Response>();
  t.mock.method(globalThis, 'fetch', async () => delayed.promise);
  const pending = store.fetch('/api/realtime?id=' + id);
  store.remote('signout');
  delayed.resolve(Response.json({ private: 'must not return' }));
  await assert.rejects(pending, (e) => e instanceof SessionError && e.kind === 'changed');
});
