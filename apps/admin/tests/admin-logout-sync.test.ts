import test from 'node:test';
import assert from 'node:assert/strict';
import {
  connectAdminLogoutSync,
  isAdminLogoutSignal,
  type AdminLogoutPort,
} from '../src/auth/admin-logout-sync.ts';
test('logout signal carries no identity, token or authority and rejects other messages', () => {
  assert.equal(isAdminLogoutSignal({ type: 'logout', version: 1 }), true);
  for (const v of [
    null,
    [],
    { type: 'login', version: 1 },
    { type: 'logout', version: '1' },
    { type: 'logout', version: 1, accessToken: 'forged' },
    { type: 'logout', version: 1, owner: 'other' },
  ])
    assert.equal(isAdminLogoutSignal(v), false);
});
test('a same-origin logout clears the other tab once, cannot renew authority, and unsubscribes on close', () => {
  const ports = new Set<{ handler: ((e: MessageEvent) => void) | null; closed: boolean }>();
  function make(): AdminLogoutPort {
    const p = { handler: null as ((e: MessageEvent) => void) | null, closed: false };
    ports.add(p);
    return {
      postMessage(value) {
        for (const peer of ports)
          if (peer !== p && !peer.closed)
            peer.handler?.({ data: structuredClone(value) } as MessageEvent);
      },
      addEventListener(_, handler) {
        p.handler = handler;
      },
      removeEventListener() {
        p.handler = null;
      },
      close() {
        p.closed = true;
      },
    };
  }
  let a = 0,
    b = 0;
  const first = connectAdminLogoutSync(() => a++, make),
    second = connectAdminLogoutSync(() => b++, make);
  first.publish();
  assert.equal(a, 0);
  assert.equal(b, 1);
  second.close();
  first.publish();
  assert.equal(b, 1);
  first.close();
  first.publish();
  assert.equal(b, 1);
});
test('channel failures never block an explicit local logout and closed listeners ignore queued messages', () => {
  let listener: ((e: MessageEvent) => void) | undefined,
    calls = 0;
  const sync = connectAdminLogoutSync(
    () => calls++,
    () => ({
      postMessage() {
        throw Error('closed');
      },
      addEventListener(_, cb) {
        listener = cb;
      },
      removeEventListener() {},
      close() {},
    }),
  );
  assert.doesNotThrow(() => sync.publish());
  listener!({ data: { type: 'logout', version: 1, token: 'unexpected' } } as MessageEvent);
  assert.equal(calls, 0);
  sync.close();
  listener!({ data: { type: 'logout', version: 1 } } as MessageEvent);
  assert.equal(calls, 0);
  assert.doesNotThrow(() =>
    connectAdminLogoutSync(
      () => {},
      () => {
        throw Error('unavailable');
      },
    ).publish(),
  );
});
