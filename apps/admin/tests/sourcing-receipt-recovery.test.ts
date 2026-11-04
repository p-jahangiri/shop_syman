import test from 'node:test';
import assert from 'node:assert/strict';
import {
  manualSourcingReceiptRecovery,
  manualSourcingReceiptScope,
  type ManualSourcingOperation,
} from '../src/features/market/sourcing-receipt-recovery.ts';
import {
  createCommandAdapter,
  receiptPath,
} from '../src/features/market/sourcing-command-protocol.ts';
import { maySendCommand } from '../src/features/market/sourcing-admin-command.ts';
import { supplyTestIds as ids, supplyTestMutation as mutation } from './supply.test-fixtures.ts';
const fields = {
  operation: 'supply-start' as ManualSourcingOperation,
  requestId: ids.request,
  taskId: ids.task,
  offerId: '',
  commandId: ids.command,
};
const sales = { sales: true, financial: false },
  finance = { sales: false, financial: true };
test('all six supply receipt operations recover by explicit request/task/command with no made-up mutation fields', () => {
  for (const operation of ['start', 'requested', 'ordered', 'progress', 'cancel', 'fail']) {
    const command = manualSourcingReceiptRecovery(
      { ...fields, operation: ('supply-' + operation) as ManualSourcingOperation },
      sales,
    );
    assert.equal(command.kind, 'recovered');
    assert.equal(command.phase, 'refresh');
    assert.deepEqual(command.body, { requestId: ids.command });
    assert.deepEqual(command.target, {
      domain: 'supply',
      operation,
      requestId: ids.request,
      taskId: ids.task,
    });
    assert.equal(
      receiptPath(command),
      `/admin/sourcing/requests/${ids.request}/supply/${ids.task}/commands/${operation}/${ids.command}`,
    );
    assert.equal(maySendCommand(null, { ...command, phase: 'pending' }), false);
  }
});
test('financial Offer receipt access does not authorize procurement receipt access or the reverse', () => {
  assert.throws(() => manualSourcingReceiptRecovery(fields, finance));
  assert.throws(() => manualSourcingReceiptRecovery(fields, { sales: false, financial: false }));
  const offer = { ...fields, operation: 'publish' as const, offerId: ids.offer };
  assert.throws(() => manualSourcingReceiptRecovery(offer, sales));
  assert.equal(manualSourcingReceiptRecovery(offer, finance).target.domain, 'offer');
  assert.equal(
    manualSourcingReceiptRecovery({ ...fields, operation: 'review' }, sales).target.domain,
    'request',
  );
});
test('supply form requires a nonzero exact task UUID and cannot accidentally recover an Offer or inventory command', () => {
  for (const taskId of ['', '0'.repeat(32), '../task', ids.task + '?extra=1'])
    assert.throws(() => manualSourcingReceiptRecovery({ ...fields, taskId }, sales));
  for (const patch of [
    { requestId: '0'.repeat(32) },
    { commandId: '0'.repeat(32) },
    { operation: 'receive' },
    { operation: 'mapping-save' },
    { operation: 'supply-save' },
    { operation: 'supply-progress/other' },
  ])
    assert.throws(() =>
      manualSourcingReceiptRecovery({ ...fields, ...patch } as typeof fields, sales),
    );
  assert.equal(manualSourcingReceiptScope('supply-cancel'), 'supply');
  assert.equal(manualSourcingReceiptScope('withdraw'), 'offer');
  assert.equal(manualSourcingReceiptScope('unavailable'), 'request');
});
test('recovered Supply result remains bound to exact requested operation, parent and task', () => {
  const command = manualSourcingReceiptRecovery(fields, sales),
    adapter = createCommandAdapter(
      command,
      { sales: true, financial: false, inventory: false },
      async () => null,
    );
  assert.doesNotThrow(() => adapter.validate({ ...mutation, replayed: true }, true));
  for (const patch of [
    { taskId: '9'.repeat(32) },
    { requestId: '9'.repeat(32) },
    { operation: 'cancel' },
    { replayed: false },
  ])
    assert.throws(() => adapter.validate({ ...mutation, replayed: true, ...patch }, true));
});
