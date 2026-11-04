import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PrivateRealtimeClient,
  type PrivateRealtimeConnection,
} from '@sayman/web-shared/lib/notifications/private-realtime-client.ts';
class Connection implements PrivateRealtimeConnection {
  changed: (value: unknown) => void = () => {};
  closed: () => void = () => {};
  reconnecting: () => void = () => {};
  reconnected: () => void = () => {};
  stops = 0;
  fail = false;
  startWait: Promise<void> = Promise.resolve();
  on(_name: string, callback: (value: unknown) => void) {
    this.changed = callback;
  }
  onclose(callback: () => void) {
    this.closed = callback;
  }
  onreconnecting(callback: () => void) {
    this.reconnecting = callback;
  }
  onreconnected(callback: () => void) {
    this.reconnected = callback;
  }
  async start() {
    await this.startWait;
    if (this.fail) throw Error('Synthetic start failure');
  }
  async stop() {
    this.stops++;
    this.closed();
  }
}
const noNetwork = async () => {
  throw Error('Unexpected network request');
};
test('successful connect and reconnect refresh SQL scopes; invalid private pulse closes instead of leaking fields', async () => {
  const connection = new Connection(),
    client = new PrivateRealtimeClient('/api/realtime', noNetwork, async () => connection),
    scopes: string[] = [];
  client.listen((scope) => scopes.push(scope));
  await client.start();
  assert.equal(client.snapshot(), 'connected');
  assert.deepEqual(scopes, ['support', 'notifications']);
  connection.changed({ schemaVersion: 1, scope: 'support' });
  assert.equal(scopes.length, 3);
  connection.reconnecting();
  assert.equal(client.snapshot(), 'reconnecting');
  connection.reconnected();
  assert.equal(client.snapshot(), 'connected');
  assert.equal(scopes.length, 5);
  connection.changed({ schemaVersion: 1, scope: 'support', owner: 'other' });
  assert.equal(client.snapshot(), 'offline');
  assert.equal(scopes.length, 5);
  assert.equal(connection.stops, 1);
  await client.stop();
});
test('a failed initial connection can retry, while old-owner events remain discarded', async () => {
  const first = new Connection(),
    second = new Connection();
  first.fail = true;
  const connections = [first, second],
    client = new PrivateRealtimeClient('/api/realtime', noNetwork, async () =>
      connections.shift()!,
    );
  let count = 0;
  client.listen(() => count++);
  await client.start();
  assert.equal(client.snapshot(), 'offline');
  assert.equal(count, 0);
  await client.retry();
  assert.equal(client.snapshot(), 'connected');
  assert.equal(count, 2);
  first.changed({ schemaVersion: 1, scope: 'support' });
  assert.equal(count, 2);
  await client.stop();
  second.changed({ schemaVersion: 1, scope: 'support' });
  assert.equal(count, 2);
  assert.equal(client.snapshot(), 'stopped');
});
test('stopping during async setup prevents the old connection from publishing into another page', async () => {
  let resolve!: () => void;
  const connection = new Connection();
  connection.startWait = new Promise<void>((r) => {
    resolve = r;
  });
  const client = new PrivateRealtimeClient('/api/realtime', noNetwork, async () => connection);
  let count = 0;
  client.listen(() => count++);
  const start = client.start();
  await Promise.resolve();
  await client.stop();
  resolve();
  await start;
  connection.changed({ schemaVersion: 1, scope: 'notifications' });
  assert.equal(count, 0);
  assert.equal(client.snapshot(), 'stopped');
  assert.ok(connection.stops >= 1);
});
test('bound transport cannot start under another account or return its late private response', async () => {
  const { bindRealtimeTransport } =
    await import('@sayman/web-shared/lib/notifications/private-realtime-client.ts');
  let allowed = false,
    calls = 0;
  const send = bindRealtimeTransport(
    async () => {
      calls++;
      return new Response('private');
    },
    () => allowed,
  );
  await assert.rejects(send('/api/realtime', {}));
  assert.equal(calls, 0);
  allowed = true;
  const late = bindRealtimeTransport(
    async () => {
      calls++;
      allowed = false;
      return new Response('private');
    },
    () => allowed,
  );
  await assert.rejects(late('/api/realtime', {}));
  assert.equal(calls, 1);
});
