import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import {
  allocationBody,
  allocationCandidateSchema,
  allocationCurrentMatches,
  allocationDataSchema,
  allocationEventsSchema,
  allocationInputSchema,
  allocationMutationSchema,
  allocationReleaseSchema,
  type AllocationAdminCommand,
  type AllocationPicks,
} from '../src/api/contracts/market/allocation-contract.ts';
import {
  allocationCurrentFixtures,
  allocationTestCandidate as candidate,
  allocationTestData as data,
  allocationTestIds as ids,
  allocationTestInput as input,
  allocationTestMutation as result,
  allocationTestNow as now,
  allocationTestUnit as unit,
  allocationTestVersion as version,
  allocationTestVersion2 as version2,
} from './allocation.test-fixtures.ts';
import {
  commandMethod,
  commandPath,
  commandTarget,
  freezeCommand,
  maySendCommand,
  type AdminSourcingCommand,
} from '../src/features/market/sourcing-admin-command.ts';
import {
  commandPermitted,
  createCommandAdapter,
  receiptPath,
} from '../src/features/market/sourcing-command-protocol.ts';
import { createSourcingCommandRunner } from '../src/features/market/sourcing-command-runner.ts';
import { manualAllocationReceiptRecovery } from '../src/features/market/sourcing-receipt-recovery.ts';
import { acceptAdminOwner, preserveAdminJournal } from '../src/auth/admin-auth-boundary.ts';
const allocate = (): Extract<AllocationAdminCommand, { kind: 'allocation-allocate' }> => ({
  kind: 'allocation-allocate',
  id: ids.command,
  reference: 'SR-1',
  requestId: ids.request,
  taskId: ids.task,
  offerId: ids.offer,
  resourceId: ids.allocation,
  phase: 'pending',
  body: structuredClone(input),
});
const release = (): Extract<AllocationAdminCommand, { kind: 'allocation-release' }> => ({
  kind: 'allocation-release',
  id: ids.command,
  reference: 'SR-1',
  requestId: ids.request,
  taskId: ids.task,
  offerId: ids.offer,
  resourceId: ids.allocation,
  phase: 'pending',
  body: {
    requestId: ids.command,
    acceptanceId: ids.acceptance,
    version,
    reason: 'Explicit QA release',
  },
});
const permissions = { sales: false, financial: false, inventory: true };
test('allocation body preserves exact accepted lines without a browser price, owner, SKU replacement or quantity cap', () => {
  const body = allocationBody(candidate, ids.command, input.expiresAt, input.reason, {}, now);
  assert.deepEqual(body, input);
  assert.deepEqual(Object.keys(body.lines[0]).sort(), [
    'offerLineId',
    'stockVersion',
    'trackingMode',
    'units',
  ]);
  for (const extra of [
    { ownerId: 'other' },
    { quantity: 1 },
    { unitPriceRial: '1' },
    { variantId: 'other' },
  ])
    assert.equal(allocationInputSchema.safeParse({ ...body, ...extra }).success, false);
  assert.equal(
    allocationInputSchema.safeParse({ ...body, lines: [{ ...body.lines[0], quantity: 1 }] })
      .success,
    false,
  );
  assert.equal(
    allocationReleaseSchema.safeParse({ ...release().body, priceRial: '1' }).success,
    false,
  );
  for (const fields of [
    { ownerId: 'other' },
    { unitPriceRial: '1' },
    { internalNote: 'supplier private' },
  ])
    assert.equal(allocationCandidateSchema.safeParse({ ...candidate, ...fields }).success, false);
});
test('absolute hold deadline has no invented default and is bounded by server consent and the current client instant', () => {
  for (const expires of [
    '',
    'invalid',
    new Date(now).toISOString(),
    new Date(now - 1).toISOString(),
    '2026-10-25T00:00:00.001Z',
    '2026-10-24T15:30:00+03:30',
  ])
    assert.throws(() => allocationBody(candidate, ids.command, expires, input.reason, {}, now));
  for (const reason of ['', ' \n ', 'reason\nsecond line', 'x'.repeat(501)])
    assert.throws(() => allocationBody(candidate, ids.command, input.expiresAt, reason, {}, now));
  assert.equal(
    allocationBody(candidate, ids.command, candidate.purchaseUntil, 'Explicit hold', {}, now)
      .expiresAt,
    candidate.purchaseUntil,
  );
  assert.throws(() =>
    allocationBody(
      { ...candidate, canAttemptAllocation: false },
      ids.command,
      input.expiresAt,
      input.reason,
      {},
      now,
    ),
  );
});
test('repeated SKU lines share a single actual stock capacity and the exact same current Stock token', () => {
  const split = {
    ...candidate,
    lines: [
      { ...candidate.lines[0], quantity: 1 },
      { ...candidate.lines[0], offerLineId: 'f'.repeat(32), quantity: 1 },
    ],
    stock: [{ ...candidate.stock[0], onHand: 2, reserved: 0, available: 2 }],
  };
  const body = allocationBody(split, ids.command, input.expiresAt, input.reason, {}, now);
  assert.equal(body.lines.length, 2);
  assert.deepEqual(
    body.lines.map((line) => line.stockVersion),
    [version, version],
  );
  assert.throws(() =>
    allocationBody(
      { ...split, stock: [{ ...split.stock[0], onHand: 1, available: 1 }] },
      ids.command,
      input.expiresAt,
      input.reason,
      {},
      now,
    ),
  );
  assert.throws(() =>
    allocationBody(
      {
        ...candidate,
        stock: [{ ...candidate.stock[0], onHand: 0, reserved: 0, available: 0, version: null }],
      },
      ids.command,
      input.expiresAt,
      input.reason,
      {},
      now,
    ),
  );
  assert.equal(
    allocationCandidateSchema.safeParse({
      ...candidate,
      stock: [candidate.stock[0], { ...candidate.stock[0], variantId: 'SKU-01' }],
    }).success,
    false,
  );
});
test('tracked allocation requires manual exact unclaimed physical selections and rejects duplicate or stale unit/stock lineage', () => {
  const tracked = {
      ...candidate,
      stock: [{ ...candidate.stock[0], trackingMode: 'serial' as const }],
    },
    second = { ...unit, id: '6'.repeat(32), serial: 'QA-UNIT-02' },
    picked = (u = unit) => ({ unit: u, stockVersion: version, hasActiveClaim: false }),
    picks: AllocationPicks = { [ids.line]: [picked(), picked(second)] };
  const body = allocationBody(tracked, ids.command, input.expiresAt, input.reason, picks, now);
  assert.deepEqual(
    body.lines[0].units.map((unit) => unit.unitId),
    [unit.id, second.id],
  );
  for (const items of [
    [],
    [picked()],
    [picked(), picked()],
    [{ ...picked(), hasActiveClaim: true }, picked(second)],
    [{ ...picked(), stockVersion: version2 }, picked(second)],
    [picked({ ...unit, variantId: 'other-sku' }), picked(second)],
  ])
    assert.throws(() =>
      allocationBody(
        tracked,
        ids.command,
        input.expiresAt,
        input.reason,
        { [ids.line]: items },
        now,
      ),
    );
  assert.throws(() =>
    allocationBody(
      tracked,
      ids.command,
      input.expiresAt,
      input.reason,
      { ...picks, ['f'.repeat(32)]: [] },
      now,
    ),
  );
  assert.throws(() =>
    allocationBody(candidate, ids.command, input.expiresAt, input.reason, picks, now),
  );
  const split = {
    ...tracked,
    lines: [
      { ...tracked.lines[0], quantity: 1 },
      { ...tracked.lines[0], offerLineId: 'f'.repeat(32), quantity: 1 },
    ],
  };
  assert.throws(() =>
    allocationBody(
      split,
      ids.command,
      input.expiresAt,
      input.reason,
      { [ids.line]: [picked()], ['f'.repeat(32)]: [picked()] },
      now,
    ),
  );
  const many = {
    ...tracked,
    lines: [{ ...tracked.lines[0], quantity: 101 }],
    stock: [{ ...tracked.stock[0], onHand: 101, reserved: 0, available: 101 }],
  };
  assert.throws(() =>
    allocationBody(
      many,
      ids.command,
      input.expiresAt,
      input.reason,
      {
        [ids.line]: Array.from({ length: 101 }, (_, i) =>
          picked({ ...unit, id: (i + 1).toString(16).padStart(32, '0'), serial: 'QA-' + i }),
        ),
      },
      now,
    ),
  );
});
test('allocation resource, release receipt and bigint event history retain strict bounded contracts', () => {
  assert.equal(allocationDataSchema.parse(data).lines[0].quantity, 2);
  assert.equal(
    allocationMutationSchema.parse({ ...result, operation: 'release', state: 'Expired' }).state,
    'Expired',
  );
  assert.equal(
    allocationMutationSchema.safeParse({ ...result, operation: 'release', state: 'Active' })
      .success,
    false,
  );
  assert.equal(
    allocationDataSchema.safeParse({ ...data, state: 'Released', effectiveState: 'Active' })
      .success,
    false,
  );
  assert.equal(allocationDataSchema.safeParse({ ...data, ownerId: 'private' }).success, false);
  const events = {
    schemaVersion: 1,
    pageSize: 50,
    items: [
      { id: '9007199254740993', state: 'Active', reason: 'Synthetic QA hold', at: result.at },
    ],
    nextCursor: null,
  };
  assert.equal(allocationEventsSchema.parse(events).items[0].id, '9007199254740993');
  assert.equal(
    allocationEventsSchema.safeParse({ ...events, items: [events.items[0], events.items[0]] })
      .success,
    false,
  );
});
test('allocate and release use one inventory-authorized journal with separate exact resource and receipt paths', () => {
  const command = allocate();
  assert.equal(commandMethod(command), 'PUT');
  assert.equal(commandMethod(release()), 'POST');
  assert.equal(
    commandPath(command),
    `/admin/inventory/sourcing-requests/${ids.request}/tasks/${ids.task}/allocations/${ids.allocation}`,
  );
  assert.equal(commandPath(release()), commandPath(command) + '/release');
  assert.equal(
    receiptPath(command),
    `/admin/inventory/sourcing-allocations/${ids.allocation}/commands/allocate/${ids.command}`,
  );
  assert.equal(
    receiptPath(release()),
    `/admin/inventory/sourcing-allocations/${ids.allocation}/commands/release/${ids.command}`,
  );
  assert.equal(commandTarget(command).domain, 'allocation');
  assert.equal(commandPermitted(command, permissions), true);
  assert.equal(
    commandPermitted(command, { sales: true, financial: true, inventory: false }),
    false,
  );
  assert.equal(maySendCommand(command, release()), false);
  const frozen = freezeCommand(command);
  command.body.lines[0].stockVersion = version2;
  assert.equal(frozen.body.lines[0].stockVersion, version);
  assert.ok(Object.isFrozen(frozen.body.lines[0]));
  assert.equal(maySendCommand(frozen, command), false);
});
test('receipt validation binds actor lookup result to UUID operation target consent and original absolute allocation deadline', () => {
  const adapter = createCommandAdapter(allocate(), permissions, async () => null);
  assert.doesNotThrow(() => adapter.validate(result, false));
  assert.doesNotThrow(() => adapter.validate({ ...result, replayed: true }, true));
  for (const patch of [
    { commandId: '7'.repeat(32) },
    { requestId: '7'.repeat(32) },
    { taskId: '7'.repeat(32) },
    { allocationId: '7'.repeat(32) },
    { offerId: '7'.repeat(32) },
    { acceptanceId: '7'.repeat(32) },
    { expiresAt: '2026-10-24T13:00:00Z' },
    { operation: 'release', state: 'Released' },
  ])
    assert.throws(() => adapter.validate({ ...result, ...patch }, false));
  assert.throws(() => adapter.validate(result, true));
  const releasing = createCommandAdapter(release(), permissions, async () => null);
  for (const state of ['Released', 'Expired'])
    assert.doesNotThrow(() =>
      releasing.validate({ ...result, operation: 'release', state, replayed: true }, true),
    );
});
function privateRead(current: ReturnType<typeof allocationCurrentFixtures>) {
  return async (path: string) =>
    path === `/admin/inventory/sourcing-allocations/${ids.allocation}`
      ? current.data
      : path === `/admin/inventory/sourcing-tasks/${ids.task}/allocation`
        ? current.candidate
        : path === `/admin/inventory/sourcing-tasks/v2/${ids.task}`
          ? current.detail
          : Promise.reject(new Error('Unexpected private GET path'));
}
test('a direct Active resource must be the current candidate ID and version even after its effective deadline', async () => {
  for (const effectiveState of ['Active', 'Expired'] as const) {
    const direct = { ...data, effectiveState },
      current = allocationCurrentFixtures(direct);
    assert.equal(allocationCurrentMatches(direct, current.candidate), true);
    await assert.doesNotReject(
      createCommandAdapter(allocate(), permissions, privateRead(current)).readFresh(),
    );
    for (const active of [
      null,
      { ...direct, id: '9'.repeat(32) },
      { ...direct, version: version2 },
    ]) {
      const torn = allocationCurrentFixtures(direct, active);
      assert.equal(allocationCurrentMatches(direct, torn.candidate), false);
      await assert.rejects(
        createCommandAdapter(allocate(), permissions, privateRead(torn)).readFresh(),
      );
    }
  }
  const changed = allocationCurrentFixtures({ ...data, version: version2 });
  await assert.doesNotReject(
    createCommandAdapter(allocate(), permissions, privateRead(changed)).readFresh(),
  );
});
test('historical allocate recovery accepts a now expired/released/transferred resource without reviving or extending it', async () => {
  for (const state of ['Released', 'Expired', 'Transferred'] as const) {
    const current = allocationCurrentFixtures(
      {
        ...data,
        state,
        effectiveState: state,
        version: version2,
        changedAt: '2026-10-24T13:00:00Z',
      },
      null,
    );
    const fresh = await createCommandAdapter(
      allocate(),
      permissions,
      privateRead(current),
    ).readFresh();
    assert.equal(fresh.focus.allocationId, ids.allocation);
    assert.equal(fresh.updates.length, 3);
    assert.equal((fresh.updates[0].value as typeof data).state, state);
    assert.equal((fresh.updates[1].value as typeof candidate).allocation, null);
  }
  const later = {
      ...data,
      id: '9'.repeat(32),
      version: version2,
      expiresAt: '2026-10-24T18:00:00Z',
    },
    old = {
      ...data,
      state: 'Released' as const,
      effectiveState: 'Released' as const,
      version: version2,
    };
  const current = allocationCurrentFixtures(old, later),
    fresh = await createCommandAdapter(allocate(), permissions, privateRead(current)).readFresh();
  assert.equal((fresh.updates[0].value as typeof data).id, ids.allocation);
  assert.equal((fresh.updates[1].value as typeof candidate).allocation?.id, later.id);
});
test('a terminal direct resource rejects a stale candidate that still advertises the same ID as active', async () => {
  for (const state of ['Released', 'Expired', 'Transferred'] as const) {
    const terminal = {
        ...data,
        state,
        effectiveState: state,
        version: version2,
        changedAt: '2026-10-24T13:00:00Z',
      },
      torn = allocationCurrentFixtures(terminal, data);
    assert.equal(allocationCurrentMatches(terminal, torn.candidate), false);
    await assert.rejects(
      createCommandAdapter(allocate(), permissions, privateRead(torn)).readFresh(),
    );
    for (const active of [null, { ...data, id: '9'.repeat(32) }]) {
      const fresh = allocationCurrentFixtures(terminal, active);
      assert.equal(allocationCurrentMatches(terminal, fresh.candidate), true);
      await assert.doesNotReject(
        createCommandAdapter(allocate(), permissions, privateRead(fresh)).readFresh(),
      );
    }
  }
});
test('fresh GET rejects foreign lineage or disagreement between candidate and Supply2 without requiring stale receipt versions', async () => {
  const good = allocationCurrentFixtures();
  await assert.doesNotReject(
    createCommandAdapter(allocate(), permissions, privateRead(good)).readFresh(),
  );
  for (const patch of [
    { data: { ...good.data, requestId: '7'.repeat(32) } },
    { data: { ...good.data, acceptanceId: '7'.repeat(32) } },
    { candidate: { ...good.candidate, taskVersion: version2 } },
    {
      detail: {
        ...good.detail,
        task: {
          ...good.detail.task,
          task: { ...good.detail.task.task, allocation: null, reservedForRequest: false },
          reservedForRequest: false,
        },
      },
    },
  ])
    await assert.rejects(
      createCommandAdapter(
        allocate(),
        permissions,
        privateRead({ ...good, ...patch } as typeof good),
      ).readFresh(),
    );
  const wrongUnits = {
    ...good,
    data: {
      ...good.data,
      lines: good.data.lines.map((line) => ({
        ...line,
        unitIds: ['5'.repeat(32), '6'.repeat(32)],
      })),
    },
  };
  await assert.rejects(
    createCommandAdapter(allocate(), permissions, privateRead(wrongUnits)).readFresh(),
  );
});
test('manual allocation receipt recovery is permission-bound, opaque and cannot become a mutation retry', () => {
  const fields = {
      operation: 'allocate' as const,
      requestId: ids.request,
      taskId: ids.task,
      resourceId: ids.allocation,
      commandId: ids.command,
    },
    command = manualAllocationReceiptRecovery(fields, true);
  assert.deepEqual(command.body, { requestId: ids.command });
  assert.equal(command.phase, 'refresh');
  assert.equal(command.target.domain, 'allocation');
  assert.equal(maySendCommand(null, { ...command, phase: 'pending' }), false);
  assert.throws(() => manualAllocationReceiptRecovery(fields, false));
  assert.throws(() =>
    manualAllocationReceiptRecovery({ ...fields, resourceId: '0'.repeat(32) }, true),
  );
  assert.throws(() =>
    manualAllocationReceiptRecovery({ ...fields, operation: 'cancel' as 'allocate' }, true),
  );
  const adapter = createCommandAdapter(command, permissions, async () => null);
  assert.doesNotThrow(() => adapter.validate({ ...result, replayed: true }, true));
  assert.throws(() =>
    adapter.validate({ ...result, replayed: true, commandId: '7'.repeat(32) }, true),
  );
});
test('unknown allocation keeps its frozen body through temporary auth loss and historical receipt finishes with GET-only current truth', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    owner = 'qa-allocation-owner',
    key = ['admin', 'sourcing-command', owner] as const;
  let active = true,
    writes = 0;
  const current = allocationCurrentFixtures(
    {
      ...data,
      state: 'Expired',
      effectiveState: 'Expired',
      version: version2,
      changedAt: '2026-10-24T13:00:00Z',
    },
    null,
  );
  const runner = () =>
    createSourcingCommandRunner({
      client,
      viewerId: owner,
      active: () => active,
      adapter: (command) => createCommandAdapter(command, permissions, privateRead(current)),
      status: (error) =>
        error && typeof error === 'object' && 'status' in error ? Number(error.status) : null,
    });
  try {
    await runner().send(allocate(), async () => {
      writes++;
      throw { status: 0 };
    });
    const unknown = client.getQueryData<AdminSourcingCommand>(key)!;
    assert.equal(unknown.phase, 'unknown');
    assert.deepEqual(unknown.body, input);
    preserveAdminJournal(client, owner, 'unavailable');
    active = false;
    let reads = 0;
    assert.equal(
      await runner().recover(unknown, async () => {
        reads++;
        return { ...result, replayed: true };
      }),
      false,
    );
    assert.equal(reads, 0);
    active = true;
    acceptAdminOwner(client, owner, owner);
    assert.equal(
      await runner().recover(client.getQueryData<AdminSourcingCommand>(key)!, async (path) => {
        reads++;
        assert.equal(path, receiptPath(allocate()));
        return { ...result, replayed: true };
      }),
      true,
    );
    assert.equal(writes, 1);
    assert.equal(reads, 1);
    assert.equal(client.getQueryData(key), null);
    assert.equal(
      client.getQueryData<typeof data>(['admin', 'sourcing-allocation', ids.allocation])?.state,
      'Expired',
    );
  } finally {
    client.clear();
  }
});
test('known allocation with a failed GET stays refresh and never sends the completed mutation again', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    owner = 'qa-allocation-refresh',
    key = ['admin', 'sourcing-command', owner] as const;
  let fail = true,
    writes = 0;
  const current = allocationCurrentFixtures();
  const runner = () =>
    createSourcingCommandRunner({
      client,
      viewerId: owner,
      active: () => true,
      adapter: (command) =>
        createCommandAdapter(command, permissions, async (path) => {
          if (fail) throw new Error('GET unavailable');
          return privateRead(current)(path);
        }),
    });
  try {
    await runner().send(allocate(), async () => {
      writes++;
      return result;
    });
    const known = client.getQueryData<AdminSourcingCommand>(key)!;
    assert.equal(known.phase, 'refresh');
    assert.equal(
      await runner().send(known, async () => {
        writes++;
        return result;
      }),
      false,
    );
    fail = false;
    assert.equal(await runner().refresh(known), true);
    assert.equal(writes, 1);
    assert.equal(client.getQueryData(key), null);
  } finally {
    client.clear();
  }
});
