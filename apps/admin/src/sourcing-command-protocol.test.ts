import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import {
  commandMethod,
  commandPath,
  commandTarget,
  freezeCommand,
  maySendCommand,
  type AdminSourcingCommand,
  type RecoveredAdminCommand,
} from './sourcing-admin-command.ts';
import {
  commandPermitted,
  createCommandAdapter,
  receiptPath,
} from './sourcing-command-protocol.ts';
import { receivingInputSchema } from './supply-contract.ts';
import {
  supplyTestAdminDetailV2 as detail,
  supplyTestAdminPageV2 as page,
  supplyTestIds as ids,
  supplyTestInventoryV2 as inventory,
  supplyTestMapping as mapping,
  supplyTestMutation as mutation,
  supplyTestReceipt as receipt,
  supplyTestReceiptInput as input,
  supplyTestVersion as version,
} from './supply.test-fixtures.ts';
import { sourcingTestDetail } from '../../storefront/lib/sourcing.test-fixtures.ts';
import { offerTestPage } from '../../storefront/lib/offer.test-fixtures.ts';
import { createSourcingCommandRunner } from './sourcing-command-runner.ts';
const supply = (): AdminSourcingCommand => ({
  kind: 'supply-start',
  id: ids.command,
  requestId: ids.request,
  offerId: ids.offer,
  taskId: ids.task,
  reference: 'SR-1',
  phase: 'pending',
  body: {
    requestId: ids.command,
    requestVersion: version,
    offerVersion: version,
    termsHash: 'A'.repeat(64),
  },
});
const receive = (): AdminSourcingCommand => ({
  kind: 'receive',
  id: ids.command,
  requestId: ids.request,
  taskId: ids.task,
  resourceId: ids.receipt,
  reference: 'SR-1',
  phase: 'pending',
  body: receivingInputSchema.parse(input),
});
const mappingCommand = (): AdminSourcingCommand => {
  const { id: resourceId, version: mapVersion, ...fields } = mapping;
  return {
    kind: 'mapping-save',
    id: ids.command,
    resourceId,
    reference: 'QA map',
    phase: 'pending',
    body: { ...fields, requestId: ids.command, version: mapVersion },
  };
};
const permissions = { sales: true, financial: true, inventory: true };
test('procurement and physical receive permissions are independent of financial Offer writes', () => {
  assert.equal(
    commandPermitted(supply(), { sales: true, financial: false, inventory: false }),
    true,
  );
  assert.equal(
    commandPermitted(supply(), { sales: false, financial: true, inventory: true }),
    false,
  );
  assert.equal(
    commandPermitted(receive(), { sales: true, financial: true, inventory: false }),
    false,
  );
  assert.equal(
    commandPermitted(receive(), { sales: false, financial: false, inventory: true }),
    true,
  );
  assert.equal(
    commandPermitted(mappingCommand(), { sales: false, financial: true, inventory: false }),
    false,
  );
});
test('supply resource, mapping and receiving use distinct exact paths and receipt targets in one slot', () => {
  assert.equal(commandMethod(supply()), 'PUT');
  assert.equal(
    commandPath(supply()),
    `/admin/sourcing/requests/${ids.request}/offers/${ids.offer}/supply/${ids.task}`,
  );
  assert.equal(
    receiptPath(supply()),
    `/admin/sourcing/requests/${ids.request}/supply/${ids.task}/commands/start/${ids.command}`,
  );
  assert.equal(commandMethod(receive()), 'POST');
  assert.equal(
    commandPath(receive()),
    `/admin/inventory/sourcing-requests/${ids.request}/tasks/${ids.task}/receipts/${ids.receipt}`,
  );
  assert.equal(
    receiptPath(receive()),
    `/admin/inventory/sourcing-receipts/${ids.receipt}/commands/${ids.command}`,
  );
  assert.equal(commandMethod(mappingCommand()), 'PUT');
  assert.equal(
    receiptPath(mappingCommand()),
    `/admin/inventory/receiving-unit-mappings/${ids.mapping}/commands/${ids.command}`,
  );
  assert.equal(maySendCommand(supply(), receive()), false);
  assert.equal(maySendCommand(mappingCommand(), receive()), false);
});
test('new frozen journal cannot retarget resource, task, request, document or unit mapping when retried', () => {
  const command = receive(),
    stored = freezeCommand(command);
  assert.equal(maySendCommand(stored, { ...stored, phase: 'unknown' }), true);
  for (const patch of [
    { resourceId: '9'.repeat(32) },
    { taskId: '9'.repeat(32) },
    { requestId: '9'.repeat(32) },
  ])
    assert.equal(maySendCommand(stored, { ...stored, ...patch } as AdminSourcingCommand), false);
  if (stored.kind !== 'receive') throw new Error('fixture');
  assert.throws(() => {
    stored.body.sourceReceiptKey = 'new';
  });
  assert.throws(() => {
    stored.body.lines[0].mappingVersion = 'AAAAAAAAAAI=';
  });
  assert.equal(
    maySendCommand(stored, { ...stored, body: { ...stored.body, sourceReceiptKey: 'changed' } }),
    false,
  );
});
test('supply historical acknowledgement binds operation, parent, task and selected accepted Offer', () => {
  const adapter = createCommandAdapter(supply(), permissions, async () => null);
  assert.doesNotThrow(() => adapter.validate(mutation, false));
  assert.doesNotThrow(() => adapter.validate({ ...mutation, replayed: true }, true));
  for (const patch of [
    { operation: 'requested' },
    { requestId: '9'.repeat(32) },
    { taskId: '9'.repeat(32) },
    { offerId: '9'.repeat(32) },
    { replayed: false },
  ])
    assert.throws(() => adapter.validate({ ...mutation, replayed: true, ...patch }, true));
});
test('mapping receipt includes original command UUID and does not treat a current GET as command proof', () => {
  const adapter = createCommandAdapter(mappingCommand(), permissions, async () => null),
    result = {
      schemaVersion: 1,
      id: ids.mapping,
      version,
      commandId: ids.command,
      at: '2026-10-24T00:00:00Z',
      replayed: true,
    };
  assert.doesNotThrow(() => adapter.validate(result, true));
  assert.throws(() => adapter.validate({ ...result, commandId: '9'.repeat(32) }, true));
  assert.throws(() => adapter.validate(mapping, true));
});
test('known Supply refresh applies direct target GETs only when parent, Offer page and child page agree', async () => {
  const parent = {
    ...sourcingTestDetail,
    summary: {
      ...sourcingTestDetail.summary,
      id: ids.request,
      reference: 'SR-1',
      state: 'Reviewing',
      ownerId: 'QA',
    },
    canCancel: false,
    canReview: false,
    canMarkUnavailable: true,
  };
  const offerPage = {
    ...offerTestPage,
    requestId: ids.request,
    pageSize: 50,
    requestReference: 'SR-1',
    canCancelRequest: false,
  };
  const records = new Map<string, unknown>([
    [`/admin/sourcing/requests/${ids.request}`, parent],
    [`/admin/sourcing/requests/${ids.request}/offers`, offerPage],
    [`/admin/sourcing/requests/${ids.request}/supply/v2/${ids.task}`, detail],
    [`/admin/sourcing/requests/${ids.request}/supply/v2`, page],
  ]);
  const adapter = createCommandAdapter(supply(), permissions, async (path) => {
    if (!records.has(path)) throw new Error('unexpected private path');
    return records.get(path);
  });
  const fresh = await adapter.readFresh();
  assert.equal(fresh.focus.taskId, ids.task);
  assert.equal(fresh.updates.length, 4);
  records.set(`/admin/sourcing/requests/${ids.request}/supply/v2`, {
    ...page,
    requestVersion: 'AAAAAAAAAAI=',
  });
  await assert.rejects(() => adapter.readFresh());
});
test('receive refresh requires the immutable document and fresh progress showing its received quantity', async () => {
  const current = {
    ...inventory,
    task: {
      ...inventory.task,
      task: {
        ...inventory.task.task,
        receivedQuantity: 1,
        remainingQuantity: 1,
        receiptProgress: 'Partial',
        effectiveState: 'PartiallyReceived',
      },
      lines: inventory.task.lines.map((line) => ({
        ...line,
        receivedQuantity: 1,
        remainingQuantity: 1,
      })),
    },
  };
  const adapter = createCommandAdapter(receive(), permissions, async (path) =>
    path.includes('/sourcing-receipts/') ? receipt : current,
  );
  const fresh = await adapter.readFresh();
  assert.equal(fresh.focus.receiptId, ids.receipt);
  assert.equal(fresh.updates.length, 2);
  const stale = createCommandAdapter(receive(), permissions, async (path) =>
    path.includes('/sourcing-receipts/') ? receipt : inventory,
  );
  await assert.rejects(() => stale.readFresh());
});
test('known receive refresh also refreshes current allocation stock, its unit picker and SerialV2 without another write', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    viewerId = 'qa-receive-stock-refresh',
    journal = ['admin', 'sourcing-command', viewerId] as const;
  const queryKeys = [
      ['admin', 'sourcing-allocation-candidate', ids.task],
      [
        'admin',
        'allocation-unit-picker',
        ids.task,
        ids.line,
        version,
        { state: 'available', query: '' },
      ],
      ['admin', 'serial-page-v2', 'SKU-01', { state: 'available', query: '' }],
    ],
    otherTask = ['admin', 'sourcing-allocation-candidate', '9'.repeat(32)],
    counts = [0, 0, 0, 0];
  const observers = [...queryKeys, otherTask].map((queryKey, index) => {
    client.setQueryData(queryKey, { stockVersion: version }, { updatedAt: 1 });
    const observer = new QueryObserver(client, {
      queryKey,
      staleTime: Infinity,
      queryFn: async () => {
        counts[index]++;
        return { stockVersion: 'AAAAAAAAAAI=' };
      },
    });
    const unsubscribe = observer.subscribe(() => {});
    return { observer, unsubscribe };
  });
  try {
    const current = {
      ...inventory,
      task: {
        ...inventory.task,
        task: {
          ...inventory.task.task,
          receivedQuantity: 1,
          remainingQuantity: 1,
          receiptProgress: 'Partial',
          effectiveState: 'PartiallyReceived',
        },
        lines: inventory.task.lines.map((line) => ({
          ...line,
          receivedQuantity: 1,
          remainingQuantity: 1,
        })),
      },
    };
    const command = { ...receive(), phase: 'refresh' as const };
    client.setQueryData(journal, command);
    let reads = 0;
    const runner = createSourcingCommandRunner({
      client,
      viewerId,
      active: () => true,
      adapter: (value) =>
        createCommandAdapter(value, permissions, async (path) => {
          reads++;
          if (path === `/admin/inventory/sourcing-receipts/${ids.receipt}`) return receipt;
          if (path === `/admin/inventory/sourcing-tasks/v2/${ids.task}`) return current;
          throw new Error('unexpected private path');
        }),
    });
    assert.equal(await runner.refresh(command), true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(reads, 2);
    assert.equal(client.getQueryData(journal), null);
    assert.deepEqual(counts, [1, 1, 1, 0]);
    for (const queryKey of queryKeys)
      assert.deepEqual(client.getQueryData(queryKey), { stockVersion: 'AAAAAAAAAAI=' });
    assert.deepEqual(client.getQueryData(otherTask), { stockVersion: version });
  } finally {
    for (const { observer, unsubscribe } of observers) {
      unsubscribe();
      observer.destroy();
    }
    client.clear();
  }
});
test('manual recovery is a target-bound read-only journal without fabricated prices, stock or version fields', () => {
  const recovered: RecoveredAdminCommand = {
    kind: 'recovered',
    id: ids.command,
    reference: 'QA',
    target: commandTarget(receive()),
    body: { requestId: ids.command },
    phase: 'refresh',
  };
  assert.equal(receiptPath(recovered), receiptPath(receive()));
  assert.equal(maySendCommand(null, { ...recovered, phase: 'pending' }), false);
  assert.deepEqual(Object.keys(recovered.body), ['requestId']);
});
