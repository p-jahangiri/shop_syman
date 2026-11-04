import test from 'node:test';
import assert from 'node:assert/strict';
import { OrderDigitalJournal } from '../src/state/orders/order-digital-journal.ts';
import { digitalDeliveryMetadata } from '@sayman/web-shared/lib/orders/order-digital-contract.ts';
import {
  digitalPage,
  digitalInput,
  digitalResult,
} from '@sayman/web-shared/testing/order-digital.test-fixtures.ts';
test('digital unknown retains metadata only, has no POST retry, blocks new commands and accepts only exact receipt', () => {
  const journal = new OrderDigitalJournal(),
    input = digitalInput(),
    meta = digitalDeliveryMetadata(digitalPage(), input);
  journal.bind('actor');
  journal.begin('actor', meta);
  meta.lines[0].quantity = 99;
  const snapshot = journal.snapshot('actor')!;
  assert.equal(snapshot.metadata.lines[0].quantity, 1);
  assert.ok(!JSON.stringify(snapshot).includes(input.lines[0].contents[0]));
  assert.ok(!('retry' in journal));
  journal.interrupt();
  journal.clear('actor');
  assert.equal(journal.snapshot('actor')!.state, 'unknown');
  assert.throws(() => journal.begin('actor', snapshot.metadata));
  assert.throws(() =>
    journal.finish('actor', snapshot.metadata, { ...digitalResult(), orderId: 'f'.repeat(32) }),
  );
  journal.fail('actor', snapshot.metadata, 404, 'not_found');
  assert.equal(journal.snapshot('actor')!.state, 'unknown');
  assert.equal(
    journal.finish('actor', snapshot.metadata, { ...digitalResult(), replayed: true }),
    true,
  );
  assert.equal(journal.snapshot('actor')!.state, 'done');
  journal.clear('actor');
  assert.equal(journal.snapshot('actor'), null);
});
test('digital definitive rejection permits explicit new attempt while late outcomes cannot cross logout or actor boundary', () => {
  const journal = new OrderDigitalJournal(),
    meta = digitalDeliveryMetadata(digitalPage(), digitalInput());
  journal.bind('first');
  journal.begin('first', meta);
  journal.fail('first', meta, 409, 'version_conflict');
  assert.equal(journal.snapshot('first')!.state, 'rejected');
  journal.clear('first');
  journal.begin('first', meta);
  journal.bind(null);
  journal.bind('second');
  journal.begin('second', meta);
  assert.equal(journal.finish('first', meta, digitalResult()), false);
  journal.fail('first', meta, 500, 'late');
  assert.equal(journal.snapshot('second')!.state, 'pending');
  journal.bind(null);
  assert.equal(journal.snapshot('second'), null);
});
test('definitive digital capacity and metadata errors keep only finite actionable failure categories', () => {
  const journal = new OrderDigitalJournal(),
    meta = digitalDeliveryMetadata(digitalPage(), digitalInput());
  journal.bind('actor');
  for (const [code, expected] of [
    ['fulfillment_capacity_conflict', 'capacity'],
    ['digital_delivery_capacity_conflict', 'capacity'],
    ['digital_delivery_metadata_capacity_conflict', 'metadata'],
    ['PRIVATE-CODE-MUST-NOT-BE-STORED', null],
  ] as const) {
    journal.begin('actor', meta);
    journal.fail('actor', meta, 409, code);
    assert.equal(journal.snapshot('actor')!.failure, expected);
    assert.equal(journal.snapshot('actor')!.state, 'rejected');
    assert.ok(
      !JSON.stringify(journal.snapshot('actor')).includes('PRIVATE-CODE-MUST-NOT-BE-STORED'),
    );
    journal.clear('actor');
  }
});
