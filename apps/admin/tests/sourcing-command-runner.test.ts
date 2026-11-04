import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import {
  createSourcingCommandRunner,
  sourcingRunnerBusy,
  type CommandAdapter,
} from '../src/features/market/sourcing-command-runner.ts';
import {
  maySendCommand,
  type AdminSourcingCommand,
} from '../src/features/market/sourcing-admin-command.ts';
import {
  acceptAdminAuthorization,
  acceptAdminOwner,
  preserveAdminJournal,
} from '../src/auth/admin-auth-boundary.ts';
import { inventorySourcingStockInvalidations } from '../src/features/market/sourcing-command-protocol.ts';
const owner = 'qa-owner',
  key = ['admin', 'sourcing-command', owner] as const;
const request = 'a'.repeat(32),
  task = 'b'.repeat(32),
  resource = 'c'.repeat(32),
  uuid = 'd'.repeat(32),
  version = 'AAAAAAAAAAE=';
const receive = (): AdminSourcingCommand => ({
  kind: 'receive',
  id: uuid,
  reference: 'SR-1',
  requestId: request,
  taskId: task,
  resourceId: resource,
  body: {
    requestId: uuid,
    requestVersion: version,
    taskVersion: version,
    channel: 'manual',
    originSystem: 'QA',
    companyKey: '01',
    warehouseKey: '01',
    sourceReceiptKey: 'physical-001',
    receivedAt: '2026-10-24T00:00:00Z',
    reason: 'QA physical receipt',
    acknowledgeHistorical: false,
    lines: [
      {
        offerLineId: 'e'.repeat(32),
        sourceReceiptLineKey: '001',
        mappingId: 'f'.repeat(32),
        mappingVersion: version,
        sourceQuantity: '1',
        trackingMode: 'none',
        stockVersion: null,
        units: [],
      },
    ],
  },
  phase: 'pending',
});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let active = true,
    failGet = false,
    reads = 0,
    errors = 0;
  const reports: unknown[] = [];
  const adapter: CommandAdapter = {
    path: '/qa-receive',
    method: 'POST',
    receiptPath: '/qa-command',
    permitted: true,
    validate(value, receipt) {
      assert.deepEqual(value, { ok: true, replayed: receipt });
    },
    async readFresh() {
      reads++;
      if (failGet) throw new Error('GET unavailable');
      return {
        updates: [{ key: ['admin', 'qa-target'], value: { current: true } }],
        focus: { taskId: task },
        invalidate: [],
      };
    },
  };
  const runner = () =>
    createSourcingCommandRunner({
      client,
      viewerId: owner,
      active: () => active,
      adapter: () => adapter,
      onError: (error) => {
        errors++;
        reports.push(error);
      },
      status: (error) =>
        error && typeof error === 'object' && 'status' in error ? Number(error.status) : null,
    });
  return {
    client,
    runner,
    adapter,
    setActive: (value: boolean) => (active = value),
    failGet: (value: boolean) => (failGet = value),
    reads: () => reads,
    errors: () => errors,
    reports: () => reports,
  };
}
test('sales and inventory mounts share the same account mutex while a complete mutation response is pending', async () => {
  const env = setup(),
    response = deferred<unknown>();
  try {
    const first = env.runner().send(receive(), () => response.promise);
    assert.equal(sourcingRunnerBusy(env.client, owner), true);
    let calls = 0;
    assert.equal(
      await env.runner().send(receive(), async () => {
        calls++;
        return { ok: true, replayed: false };
      }),
      false,
    );
    assert.equal(calls, 0);
    response.resolve({ ok: true, replayed: false });
    assert.equal(await first, true);
    assert.equal(env.client.getQueryData(key), null);
    assert.equal(sourcingRunnerBusy(env.client, owner), false);
  } finally {
    env.client.clear();
  }
});
test('a lost receive response keeps its full frozen body and a later 409 does not erase uncertainty', async () => {
  const env = setup();
  try {
    const command = receive();
    await env.runner().send(command, async () => {
      throw { status: 0 };
    });
    const unknown = env.client.getQueryData<AdminSourcingCommand>(key)!;
    assert.equal(unknown.phase, 'unknown');
    assert.equal(unknown.uncertain, true);
    assert.equal(Object.isFrozen(unknown.body), true);
    if (command.kind !== 'receive') throw new Error('fixture');
    command.body.lines[0].sourceQuantity = '2';
    assert.equal((unknown as ReturnType<typeof receive>).body.requestId, uuid);
    await env.runner().send(unknown, async (_path, body) => {
      assert.deepEqual(body, unknown.body);
      throw { status: 409 };
    });
    assert.equal(env.client.getQueryData<AdminSourcingCommand>(key)?.phase, 'unknown');
    assert.equal(env.client.getQueryData<AdminSourcingCommand>(key)?.id, uuid);
  } finally {
    env.client.clear();
  }
});
test('known receive with failed GET remains refresh and permits GET recovery without a second mutation', async () => {
  const env = setup();
  let writes = 0;
  try {
    env.failGet(true);
    await env.runner().send(receive(), async () => {
      writes++;
      return { ok: true, replayed: false };
    });
    const stored = env.client.getQueryData<AdminSourcingCommand>(key)!;
    assert.equal(stored.phase, 'refresh');
    assert.equal(stored.uncertain, false);
    assert.equal(maySendCommand(stored, stored), false);
    assert.equal(
      await env.runner().send(stored, async () => {
        writes++;
        return { ok: true, replayed: false };
      }),
      false,
    );
    env.failGet(false);
    assert.equal(await env.runner().refresh(stored), true);
    assert.equal(writes, 1);
    assert.equal(env.reads(), 2);
    assert.equal(env.client.getQueryData(key), null);
  } finally {
    env.client.clear();
  }
});
test('late success after navigation keeps only a known command and does not apply private GET state', async () => {
  const env = setup(),
    response = deferred<unknown>();
  try {
    const sent = env.runner().send(receive(), () => response.promise);
    env.setActive(false);
    response.resolve({ ok: true, replayed: false });
    assert.equal(await sent, false);
    assert.equal(env.client.getQueryData<AdminSourcingCommand>(key)?.phase, 'refresh');
    assert.equal(env.reads(), 0);
    assert.equal(env.client.getQueryData(['admin', 'qa-target']), undefined);
    env.setActive(true);
    assert.equal(
      await env.runner().refresh(env.client.getQueryData<AdminSourcingCommand>(key)!),
      true,
    );
  } finally {
    env.client.clear();
  }
});
test('auth invalidation during fresh GET never repopulates private cache or clears the preserved command', async () => {
  const env = setup(),
    fresh = deferred<Awaited<ReturnType<CommandAdapter['readFresh']>>>();
  try {
    env.adapter.readFresh = () => fresh.promise;
    const sent = env.runner().send(receive(), async () => ({ ok: true, replayed: false }));
    await Promise.resolve();
    await Promise.resolve();
    env.setActive(false);
    preserveAdminJournal(env.client, owner, 'unavailable');
    fresh.resolve({
      updates: [{ key: ['admin', 'qa-target'], value: { private: true } }],
      focus: { taskId: task },
      invalidate: [],
    });
    assert.equal(await sent, false);
    assert.equal(env.client.getQueryData<AdminSourcingCommand>(key)?.phase, 'refresh');
    assert.equal(env.client.getQueryData(['admin', 'qa-target']), undefined);
  } finally {
    env.client.clear();
  }
});
test('temporary auth loss preserves receipt command for the same owner and another verified owner clears it', async () => {
  const env = setup();
  try {
    await env.runner().send(receive(), async () => {
      throw { status: 503 };
    });
    const before = env.client.getQueryData<AdminSourcingCommand>(key)!;
    preserveAdminJournal(env.client, owner, 'unavailable');
    acceptAdminOwner(env.client, owner, owner);
    assert.deepEqual(env.client.getQueryData(key), before);
    acceptAdminOwner(env.client, owner, 'other-owner');
    assert.equal(env.client.getQueryData(key), undefined);
  } finally {
    env.client.clear();
  }
});
test('a synchronous access 401 cannot overwrite uncertainty established by the auth boundary during the same attempt', async () => {
  const env = setup();
  try {
    await env.runner().send(receive(), async () => {
      preserveAdminJournal(env.client, owner, 'unavailable');
      throw { status: 401 };
    });
    const stored = env.client.getQueryData<AdminSourcingCommand>(key)!;
    assert.equal(stored.phase, 'unknown');
    assert.equal(stored.uncertain, true);
    assert.equal(stored.id, uuid);
    assert.deepEqual(stored.body, receive().body);
    acceptAdminOwner(env.client, owner, owner);
    await env.runner().send(stored, async () => {
      throw { status: 409 };
    });
    assert.equal(env.client.getQueryData<AdminSourcingCommand>(key)?.phase, 'unknown');
  } finally {
    env.client.clear();
  }
});
test('a receipt 404 leaves an unknown command and success waits for fresh target reads', async () => {
  const env = setup();
  try {
    await env.runner().send(receive(), async () => {
      throw { status: 0 };
    });
    const stored = env.client.getQueryData<AdminSourcingCommand>(key)!;
    assert.equal(
      await env.runner().recover(stored, async () => {
        throw { status: 404 };
      }),
      false,
    );
    assert.equal(env.client.getQueryData<AdminSourcingCommand>(key)?.phase, 'unknown');
    assert.equal(
      await env.runner().recover(stored, async () => ({ ok: true, replayed: true })),
      true,
    );
    assert.equal(env.client.getQueryData(key), null);
  } finally {
    env.client.clear();
  }
});
test('receipt recovery clears the obsolete transport error while preserving unknown until receipt and fresh reads succeed', async () => {
  const env = setup(),
    receipt = deferred<unknown>(),
    failure = { status: 503 };
  try {
    await env.runner().send(receive(), async () => {
      throw failure;
    });
    const stored = env.client.getQueryData<AdminSourcingCommand>(key)!;
    assert.equal(env.reports().at(-1), failure);
    const recovering = env.runner().recover(stored, () => receipt.promise);
    assert.equal(env.reports().at(-1), undefined);
    assert.equal(env.client.getQueryData<AdminSourcingCommand>(key)?.phase, 'unknown');
    receipt.resolve({ ok: true, replayed: true });
    assert.equal(await recovering, true);
    assert.equal(env.client.getQueryData(key), null);
    assert.deepEqual(env.reports(), [undefined, failure, undefined, undefined]);
  } finally {
    env.client.clear();
  }
});
test('retry and known refresh clear prior errors but retain each current failed attempt', async () => {
  const env = setup(),
    first = { status: 503 },
    retryFailure = { status: 409 };
  try {
    await env.runner().send(receive(), async () => {
      throw first;
    });
    const unknown = env.client.getQueryData<AdminSourcingCommand>(key)!;
    await env.runner().send(unknown, async () => {
      assert.equal(env.reports().at(-1), undefined);
      throw retryFailure;
    });
    assert.equal(env.reports().at(-1), retryFailure);
    assert.equal(env.client.getQueryData<AdminSourcingCommand>(key)?.phase, 'unknown');
    env.failGet(true);
    await env.runner().send(unknown, async () => ({ ok: true, replayed: false }));
    const known = env.client.getQueryData<AdminSourcingCommand>(key)!;
    assert.equal(known.phase, 'refresh');
    assert.match((env.reports().at(-1) as Error).message, /وضعیت جاری دریافت نشد/);
    await env.runner().refresh(known);
    assert.equal(env.reports().at(-2), undefined);
    assert.match((env.reports().at(-1) as Error).message, /وضعیت جاری دریافت نشد/);
    env.failGet(false);
    assert.equal(await env.runner().refresh(known), true);
    assert.equal(env.reports().at(-1), undefined);
    assert.equal(env.client.getQueryData(key), null);
  } finally {
    env.client.clear();
  }
});
test('rejected operations and a late recovery after view invalidation cannot clear or report page errors', async () => {
  const env = setup(),
    receipt = deferred<unknown>(),
    failure = { status: 503 };
  try {
    await env.runner().send(receive(), async () => {
      throw failure;
    });
    const stored = env.client.getQueryData<AdminSourcingCommand>(key)!,
      before = env.reports().length;
    env.adapter.permitted = false;
    assert.equal(
      await env.runner().send(stored, async () => ({ ok: true, replayed: false })),
      false,
    );
    assert.equal(
      await env.runner().recover(stored, async () => ({ ok: true, replayed: true })),
      false,
    );
    assert.equal(await env.runner().refresh({ ...stored, phase: 'refresh' }), false);
    assert.equal(env.reports().length, before);
    env.adapter.permitted = true;
    const recovering = env.runner().recover(stored, () => receipt.promise);
    assert.equal(env.reports().at(-1), undefined);
    const started = env.reports().length;
    acceptAdminAuthorization(
      env.client,
      owner,
      owner,
      ['inventory.read', 'inventory.write'],
      ['sales.read'],
    );
    receipt.resolve({ ok: true, replayed: true });
    assert.equal(await recovering, false);
    assert.equal(env.reports().length, started);
    assert.equal(env.client.getQueryData<AdminSourcingCommand>(key)?.phase, 'refresh');
    assert.equal(env.client.getQueryData(['admin', 'qa-target']), undefined);
  } finally {
    env.client.clear();
  }
});
test('receipt-only recovery installs a read-only refresh slot and cannot ever become a mutation retry', async () => {
  const env = setup();
  try {
    const command: AdminSourcingCommand = {
      kind: 'recovered',
      id: uuid,
      reference: 'QA receipt',
      target: {
        domain: 'receiving',
        operation: 'receive',
        requestId: request,
        taskId: task,
        resourceId: resource,
      },
      body: { requestId: uuid },
      phase: 'refresh',
    };
    env.failGet(true);
    await env.runner().recover(command, async () => ({ ok: true, replayed: true }));
    const stored = env.client.getQueryData<AdminSourcingCommand>(key)!;
    assert.equal(stored.phase, 'refresh');
    assert.equal(maySendCommand(null, { ...stored, phase: 'pending' }), false);
    env.failGet(false);
    assert.equal(await env.runner().refresh(stored), true);
  } finally {
    env.client.clear();
  }
});
test('a foreign receipt or command cannot replace an unresolved command in the shared slot', async () => {
  const env = setup();
  try {
    await env.runner().send(receive(), async () => {
      throw { status: 0 };
    });
    const other = { ...receive(), id: 'f'.repeat(32) };
    let reads = 0;
    assert.equal(
      await env.runner().recover(other, async () => {
        reads++;
        return { ok: true, replayed: true };
      }),
      false,
    );
    assert.equal(reads, 0);
    assert.equal(env.client.getQueryData<AdminSourcingCommand>(key)?.id, uuid);
  } finally {
    env.client.clear();
  }
});
test('permission loss blocks sending, receipt lookup and known refresh without revealing or changing the journal', async () => {
  const env = setup();
  try {
    env.failGet(true);
    await env.runner().send(receive(), async () => ({ ok: true, replayed: false }));
    const known = env.client.getQueryData<AdminSourcingCommand>(key)!;
    env.adapter.permitted = false;
    env.failGet(false);
    const reads = env.reads();
    assert.equal(await env.runner().refresh(known), false);
    assert.equal(env.reads(), reads);
    let calls = 0;
    assert.equal(
      await env.runner().recover(known, async () => {
        calls++;
        return { ok: true, replayed: true };
      }),
      false,
    );
    assert.equal(
      await env.runner().send(receive(), async () => {
        calls++;
        return { ok: true, replayed: false };
      }),
      false,
    );
    assert.equal(calls, 0);
    assert.deepEqual(env.client.getQueryData(key), known);
  } finally {
    env.client.clear();
  }
});
test('permission boundary invalidates a finished GET before React unmount can run', async () => {
  const env = setup(),
    fresh = deferred<Awaited<ReturnType<CommandAdapter['readFresh']>>>();
  try {
    env.adapter.readFresh = () => fresh.promise;
    const sent = env.runner().send(receive(), async () => ({ ok: true, replayed: false }));
    await Promise.resolve();
    await Promise.resolve();
    acceptAdminAuthorization(
      env.client,
      owner,
      owner,
      ['inventory.read', 'inventory.write'],
      ['sales.read'],
    );
    fresh.resolve({
      updates: [{ key: ['admin', 'qa-target'], value: { private: true } }],
      focus: { taskId: task },
      invalidate: [],
    });
    assert.equal(await sent, false);
    assert.equal(env.client.getQueryData(['admin', 'qa-target']), undefined);
    assert.equal(env.client.getQueryData<AdminSourcingCommand>(key)?.phase, 'refresh');
  } finally {
    env.client.clear();
  }
});
test('a write already sent before permission loss may acknowledge history but cannot read or display its private target', async () => {
  const env = setup(),
    response = deferred<unknown>();
  try {
    const sent = env.runner().send(receive(), () => response.promise);
    acceptAdminAuthorization(
      env.client,
      owner,
      owner,
      ['inventory.read', 'inventory.write'],
      ['sales.read'],
    );
    response.resolve({ ok: true, replayed: false });
    assert.equal(await sent, false);
    assert.equal(env.client.getQueryData<AdminSourcingCommand>(key)?.phase, 'refresh');
    assert.equal(env.reads(), 0);
    assert.equal(env.client.getQueryData(['admin', 'qa-target']), undefined);
  } finally {
    env.client.clear();
  }
});
test('discarding a definite failure starts stock-dependent fresh reads before opening the shared slot for a new editor', async () => {
  const env = setup(),
    fresh = deferred<{ stockVersion: string }>(),
    queryKeys = [
      ['admin', 'sourcing-allocation-candidate', task],
      ['admin', 'allocation-unit-picker', task, 'e'.repeat(32), version],
      ['admin', 'serial-page-v2', 'SKU-01', { state: 'available', query: '' }],
    ],
    reads = [0, 0, 0];
  const observers = queryKeys.map((queryKey, index) => {
    env.client.setQueryData(queryKey, { stockVersion: version }, { updatedAt: 1 });
    const observer = new QueryObserver(env.client, {
      queryKey,
      staleTime: Infinity,
      queryFn: () => {
        reads[index]++;
        return fresh.promise;
      },
    });
    const unsubscribe = observer.subscribe(() => {});
    return { observer, unsubscribe };
  });
  let cleared = false;
  const stop = env.client.getQueryCache().subscribe((event) => {
    if (
      event.type === 'updated' &&
      event.query.queryKey[1] === 'sourcing-command' &&
      event.query.state.data === null
    ) {
      cleared = true;
      for (const queryKey of queryKeys) {
        assert.equal(env.client.getQueryState(queryKey)?.isInvalidated, true);
        assert.equal(env.client.getQueryState(queryKey)?.fetchStatus, 'fetching');
      }
    }
  });
  try {
    await env.runner().send(receive(), async () => {
      throw { status: 409 };
    });
    const failed = env.client.getQueryData<AdminSourcingCommand>(key)!;
    assert.equal(failed.phase, 'failed');
    assert.equal(env.runner().discardFailed(failed, inventorySourcingStockInvalidations()), true);
    assert.equal(cleared, true);
    assert.equal(env.client.getQueryData(key), null);
    assert.deepEqual(reads, [1, 1, 1]);
    fresh.resolve({ stockVersion: 'AAAAAAAAAAI=' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    for (const queryKey of queryKeys)
      assert.deepEqual(env.client.getQueryData(queryKey), { stockVersion: 'AAAAAAAAAAI=' });
  } finally {
    stop();
    for (const { observer, unsubscribe } of observers) {
      unsubscribe();
      observer.destroy();
    }
    env.client.clear();
  }
});
test('failed discard cannot clear uncertain, busy, foreign, inactive or unauthorized commands', async () => {
  const env = setup();
  try {
    for (const phase of ['pending', 'unknown', 'refresh'] as const) {
      const command = { ...receive(), phase };
      env.client.setQueryData(key, command);
      assert.equal(env.runner().discardFailed({ ...command, phase: 'failed' }, []), false);
      assert.deepEqual(env.client.getQueryData(key), command);
    }
    const failed = { ...receive(), phase: 'failed' as const, uncertain: false };
    env.client.setQueryData(key, { ...failed, uncertain: true });
    assert.equal(env.runner().discardFailed(failed, []), false);
    env.client.setQueryData(key, failed);
    assert.equal(env.runner().discardFailed({ ...failed, id: 'f'.repeat(32) }, []), false);
    env.setActive(false);
    assert.equal(env.runner().discardFailed(failed, []), false);
    env.setActive(true);
    env.adapter.permitted = false;
    assert.equal(env.runner().discardFailed(failed, []), false);
    env.adapter.permitted = true;
    const response = deferred<unknown>(),
      sending = env.runner().send(failed, () => response.promise);
    assert.equal(env.runner().discardFailed(failed, []), false);
    response.reject({ status: 409 });
    await sending;
    assert.equal(env.client.getQueryData<AdminSourcingCommand>(key)?.phase, 'failed');
    assert.equal(
      env.runner().discardFailed(env.client.getQueryData<AdminSourcingCommand>(key)!, []),
      true,
    );
  } finally {
    env.client.clear();
  }
});
