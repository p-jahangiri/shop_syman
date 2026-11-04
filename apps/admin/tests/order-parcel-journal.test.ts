import test from 'node:test';
import assert from 'node:assert/strict';
import { OrderParcelJournal } from '../src/state/orders/order-parcel-journal.ts';
import {
  parcelCommand,
  parcelResult,
} from '@sayman/web-shared/testing/order-parcel.test-fixtures.ts';
test('unresolved parcel commands retain exact RAM-only preview and UUID, require explicit same-body retry and reject unrelated receipts', () => {
  const j = new OrderParcelJournal(),
    c = parcelCommand(),
    bytes = JSON.stringify(c);
  j.bind('actor');
  j.begin('actor', c);
  c.input.reason = 'DOM changed';
  assert.equal(JSON.stringify(j.snapshot('actor')!.command), bytes);
  assert.equal(j.snapshot('another'), null);
  j.interrupt();
  const e = j.snapshot('actor')!;
  assert.equal(e.state, 'unknown');
  j.clear('actor');
  assert.equal(j.snapshot('actor')!.state, 'unknown');
  assert.throws(() => j.begin('actor', parcelCommand()));
  const retry = j.retry('actor');
  assert.equal(JSON.stringify(retry), bytes);
  assert.throws(() => j.finish('actor', retry, { ...parcelResult(), commandId: 'f'.repeat(32) }));
  assert.equal(j.finish('actor', retry, parcelResult()), true);
  assert.equal(j.snapshot('actor')!.state, 'done');
  j.clear('actor');
  assert.equal(j.snapshot('actor'), null);
});
test('logout and authorization changes erase private parcel memory and late receipts cannot cross the boundary', () => {
  const j = new OrderParcelJournal(),
    c = parcelCommand();
  j.bind('first');
  j.begin('first', c);
  j.bind(null);
  j.bind('second');
  j.begin('second', c);
  assert.equal(j.finish('first', c, parcelResult()), false);
  j.fail('first', c, 500, 'late');
  assert.equal(j.snapshot('second')!.state, 'pending');
  j.bind(null);
  j.bind('second');
  assert.equal(j.snapshot('second'), null);
});
