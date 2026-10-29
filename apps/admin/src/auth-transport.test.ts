import test from 'node:test';
import assert from 'node:assert/strict';
import { AdminAuthTransport, type AuthLockRunner } from './auth-transport.ts';
import { SessionChanged } from './session-access.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
test('old refresh Set-Cookie settles before later password, MFA and logout cookie writes', async () => {
  const transport = new AdminAuthTransport();
  const old = deferred<void>();
  const events: string[] = [];
  let cookie = 'A';
  const refresh = transport.run(
    async () => {
      events.push('refresh-A:send');
      await old.promise;
      cookie = 'A-refreshed';
      events.push('refresh-A:cookie');
    },
    () => true,
  );
  await tick();
  const password = transport.run(
    async () => {
      events.push('password-B:send');
      cookie = 'B-pending';
      events.push('password-B:cookie');
    },
    () => true,
  );
  const mfa = transport.run(
    async () => {
      events.push('MFA-B:send');
      cookie = 'B';
      events.push('MFA-B:cookie');
    },
    () => true,
  );
  await tick();
  assert.deepEqual(events, ['refresh-A:send']);
  old.resolve();
  await Promise.all([refresh, password, mfa]);
  assert.equal(cookie, 'B');
  assert.deepEqual(events, [
    'refresh-A:send',
    'refresh-A:cookie',
    'password-B:send',
    'password-B:cookie',
    'MFA-B:send',
    'MFA-B:cookie',
  ]);
  await transport.run(
    async () => {
      cookie = '';
      events.push('logout:cookie');
    },
    () => true,
  );
  assert.equal(cookie, '');
});
test('a queued old MFA intent cannot reach the wire after another login generation supersedes it', async () => {
  const transport = new AdminAuthTransport();
  const held = deferred<void>();
  let generation = 1,
    writes = 0,
    cookie = 'A';
  const holder = transport.run(
    () => held.promise,
    () => true,
  );
  await tick();
  const original = generation;
  const oldMfa = transport.run(
    async () => {
      writes++;
      cookie = 'A';
    },
    () => generation === original,
  );
  const rejected = assert.rejects(oldMfa, SessionChanged);
  generation = 2;
  const loginB = transport.run(
    async () => {
      cookie = 'B';
    },
    () => generation === 2,
  );
  held.resolve();
  await Promise.all([holder, rejected, loginB]);
  assert.equal(writes, 0);
  assert.equal(cookie, 'B');
});
test('abandoning a queued auth request cancels that queue entry instead of sending it after the lock becomes free', async () => {
  const transport = new AdminAuthTransport({ waitMs: 1000 });
  const held = deferred<void>();
  const holder = transport.run(
    () => held.promise,
    () => true,
  );
  await tick();
  let abandonedSends = 0;
  const cancel = new AbortController();
  const abandoned = transport.run(
    async () => {
      abandonedSends++;
    },
    () => true,
    cancel.signal,
  );
  const rejected = assert.rejects(abandoned);
  cancel.abort();
  await rejected;
  held.resolve();
  await holder;
  await tick();
  assert.equal(abandonedSends, 0);
});
test('queue wait has a bounded deadline and a timed-out entry can never execute later', async () => {
  const transport = new AdminAuthTransport({ waitMs: 10, networkMs: 1000 });
  const held = deferred<void>();
  const holder = transport.run(
    () => held.promise,
    () => true,
  );
  await tick();
  let lateWrites = 0;
  await assert.rejects(
    transport.run(
      async () => {
        lateWrites++;
      },
      () => true,
    ),
    (error) => error instanceof DOMException && error.name === 'TimeoutError',
  );
  held.resolve();
  await holder;
  await tick();
  assert.equal(lateWrites, 0);
});
test('network timeout aborts the live request and holds the lock until that request and body decode actually settle', async () => {
  const transport = new AdminAuthTransport({ waitMs: 1000, networkMs: 10 });
  const events: string[] = [];
  let cookie = 'A';
  const settled = deferred<void>();
  const old = transport.run(
    (signal) =>
      new Promise<void>((_, reject) => {
        events.push('old:send');
        signal.addEventListener(
          'abort',
          () => {
            events.push('old:abort');
            settled.promise.then(() => {
              events.push('old:settled');
              reject(signal.reason);
            });
          },
          { once: true },
        );
      }),
    () => true,
  );
  const oldRejected = assert.rejects(old);
  const next = transport.run(
    async () => {
      events.push('new:send');
      cookie = 'B';
    },
    () => true,
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(events, ['old:send', 'old:abort']);
  settled.resolve();
  await Promise.all([oldRejected, next]);
  assert.deepEqual(events, ['old:send', 'old:abort', 'old:settled', 'new:send']);
  assert.equal(cookie, 'B');
});
test('the browser lock runner receives a cancellable wait signal and stale intents are checked inside its callback', async () => {
  const release = deferred<void>();
  let lockSignal: AbortSignal | undefined,
    wire = 0;
  const withLock: AuthLockRunner = async (signal, operation) => {
    lockSignal = signal;
    await release.promise;
    if (signal.aborted) throw signal.reason;
    return operation();
  };
  const transport = new AdminAuthTransport({ withLock, waitMs: 1000 });
  let current = true;
  const queued = transport.run(
    async () => {
      wire++;
    },
    () => current,
  );
  const rejected = assert.rejects(queued, SessionChanged);
  assert.ok(lockSignal);
  current = false;
  release.resolve();
  await rejected;
  assert.equal(wire, 0);
});
