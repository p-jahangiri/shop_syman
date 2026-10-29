import test from 'node:test';
import assert from 'node:assert/strict';
import {
  supplyPageSelection,
  supplyReadMayApply,
  supplySelectionChangesView,
  type SupplyReadCurrent,
  type SupplyReadTicket,
} from './supply-view.ts';
const request = 'a'.repeat(32),
  task = 'b'.repeat(32),
  other = 'c'.repeat(32);
test('clicking the already-selected first-page task while loading keeps its current read ticket valid', () => {
  const ticket: SupplyReadTicket = {
    owner: 'qa-customer',
    requestId: request,
    taskId: task,
    epoch: 4,
  };
  const current: SupplyReadCurrent = {
    ...ticket,
    mounted: true,
    status: 'member',
    verifiedOwner: 'qa-customer',
  };
  assert.equal(supplySelectionChangesView(task, null, task), false);
  // The component returns before incrementing its epoch or clearing state.
  assert.equal(supplyReadMayApply(ticket, current), true);
  assert.equal(current.epoch, 4);
  assert.equal(
    supplyReadMayApply(ticket, { ...current, status: 'unavailable', verifiedOwner: null }),
    false,
  );
  assert.equal(supplyReadMayApply(ticket, { ...current, verifiedOwner: 'other-customer' }), false);
});
test('clicking the already-selected task after loading is a no-op and retains its detail/history', () => {
  const view = {
    selected: task,
    eventCursor: null,
    detail: { taskId: task },
    events: [{ id: '1' }],
  };
  assert.equal(supplySelectionChangesView(view.selected, view.eventCursor, task), false);
  assert.equal(view.detail.taskId, task);
  assert.deepEqual(view.events, [{ id: '1' }]);
});
test('another task or returning from a later history page changes effect dependencies and starts a fresh read', () => {
  assert.equal(supplySelectionChangesView(task, null, other), true);
  assert.equal(supplySelectionChangesView(task, 'bounded_cursor', task), true);
  assert.equal(supplySelectionChangesView(null, null, task), true);
});
test('an automatic task replacement resets its old cursor/history and invalidates the old read before React effects', () => {
  const selection = supplyPageSelection(task, [{ id: other }]);
  assert.deepEqual(selection, { selected: other, resetHistory: true });
  const ticket: SupplyReadTicket = { owner: 'qa', requestId: request, taskId: task, epoch: 7 };
  const current: SupplyReadCurrent = {
    ...ticket,
    mounted: true,
    status: 'member',
    verifiedOwner: 'qa',
  };
  const next = { ...current, taskId: selection.selected, epoch: current.epoch + 1 };
  assert.equal(supplyReadMayApply(ticket, next), false);
  assert.equal(supplyReadMayApply({ ...ticket, taskId: other, epoch: 8 }, next), true);
});
test('refresh retaining the current task keeps its history page; an empty replacement clears selection', () => {
  assert.deepEqual(supplyPageSelection(task, [{ id: other }, { id: task }]), {
    selected: task,
    resetHistory: false,
  });
  assert.deepEqual(supplyPageSelection(task, []), { selected: null, resetHistory: true });
  assert.deepEqual(supplyPageSelection(null, []), { selected: null, resetHistory: false });
  assert.deepEqual(supplyPageSelection(null, [{ id: other }]), {
    selected: other,
    resetHistory: true,
  });
});
