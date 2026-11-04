import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beginShipmentCommand,
  clearShipmentJournal,
  failShipmentCommand,
  finishShipmentCommand,
  interruptShipmentCommand,
  readShipmentJournal,
  shipmentJournalSnapshot,
} from '../src/state/orders/order-shipment-journal.ts';
import {
  shipmentCommand,
  shipmentResult,
} from '@sayman/web-shared/testing/order-shipment.test-fixtures.ts';
test('shipment journal freezes the reviewed command and retries exact bytes after interrupted authentication', () => {
  clearShipmentJournal();
  const command = shipmentCommand(),
    bytes = JSON.stringify(command);
  beginShipmentCommand('actor', command);
  command.input.reason = 'DOM changed';
  assert.equal(JSON.stringify(readShipmentJournal('actor')!.command), bytes);
  assert.equal(readShipmentJournal('another'), null);
  assert.equal(Object.isFrozen(shipmentJournalSnapshot('actor')!.command.input), true);
  assert.throws(() => beginShipmentCommand('actor', readShipmentJournal('actor')!.command));
  interruptShipmentCommand();
  assert.equal(readShipmentJournal('actor')!.state, 'unknown');
  const retry = readShipmentJournal('actor')!.command;
  beginShipmentCommand('actor', retry);
  assert.equal(JSON.stringify(readShipmentJournal('actor')!.command), bytes);
  finishShipmentCommand('actor', retry, shipmentResult());
  assert.equal(readShipmentJournal('actor')!.state, 'done');
  clearShipmentJournal();
});
test('shipment journal refuses unrelated receipts and ignores responses after owner clearing', () => {
  clearShipmentJournal();
  const command = shipmentCommand();
  beginShipmentCommand('first', command);
  assert.throws(() =>
    finishShipmentCommand('first', command, { ...shipmentResult(), commandId: 'f'.repeat(32) }),
  );
  failShipmentCommand('first', command, 'unknown', 'lost response');
  assert.throws(() =>
    beginShipmentCommand('first', {
      ...command,
      input: { ...command.input, commandId: 'f'.repeat(32) },
    }),
  );
  clearShipmentJournal('first');
  beginShipmentCommand('second', command);
  assert.equal(finishShipmentCommand('first', command, shipmentResult()), false);
  assert.equal(failShipmentCommand('first', command, 'rejected', 'late'), false);
  assert.equal(readShipmentJournal('second')!.state, 'pending');
  clearShipmentJournal();
});
