import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtimeRefreshGate, type RealtimeScheduler } from './realtime-refresh.ts';
function timers() {
  const callbacks: { run: () => void; cancelled: boolean }[] = [];
  const schedule: RealtimeScheduler = (run) => {
    const task = { run, cancelled: false };
    callbacks.push(task);
    return () => {
      task.cancelled = true;
    };
  };
  return {
    schedule,
    callbacks,
    fire: () => {
      const task = callbacks.shift();
      if (task && !task.cancelled) task.run();
    },
  };
}
test('live invalidations wait for an unresolved command and coalesce before resuming', () => {
  const time = timers();
  let busy = true,
    count = 0;
  const gate = new RealtimeRefreshGate(
    () => count++,
    () => busy,
    time.schedule,
  );
  gate.changed();
  gate.changed();
  assert.equal(time.callbacks.length, 0);
  busy = false;
  gate.resume();
  assert.equal(time.callbacks.length, 1);
  busy = true;
  time.fire();
  assert.equal(count, 0);
  busy = false;
  gate.resume();
  time.fire();
  assert.equal(count, 1);
  gate.resume();
  assert.equal(time.callbacks.length, 0);
});
test('an event during mark-read cannot trigger a generation change until the write settles', () => {
  const time = timers();
  let reading = true,
    refreshes = 0;
  const gate = new RealtimeRefreshGate(
    () => {
      assert.equal(reading, false);
      refreshes++;
    },
    () => reading,
    time.schedule,
  );
  gate.changed();
  assert.equal(time.callbacks.length, 0);
  reading = false;
  gate.resume();
  time.fire();
  assert.equal(refreshes, 1);
});
test('discarded owner subscriptions cannot refresh a later account after their timer fires', () => {
  const time = timers();
  let count = 0;
  const gate = new RealtimeRefreshGate(
    () => count++,
    () => false,
    time.schedule,
  );
  gate.changed();
  const delayed = time.callbacks[0].run;
  gate.dispose();
  delayed();
  gate.changed();
  gate.resume();
  assert.equal(count, 0);
});
