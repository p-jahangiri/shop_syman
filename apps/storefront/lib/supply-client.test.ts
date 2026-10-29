import test from 'node:test';
import assert from 'node:assert/strict';
import { CartError } from './cart-client.ts';
import {
  listSourcingSupply,
  readSourcingSupply,
  readSourcingSupplyView,
  sourcingSupplyEvents,
} from './supply-client.ts';
import {
  supplyTestDetailV2 as detail,
  supplyTestEvents as events,
  supplyTestPageV2 as page,
  supplyTestRequest as requestId,
  supplyTestTask as taskId,
} from './supply.test-fixtures.ts';

test('customer supply client reads only its exact parent/task with GET and propagates cancellation', async () => {
  const controller = new AbortController();
  const seen: string[] = [];
  const fetcher = async (path: string, init: RequestInit) => {
    seen.push(path);
    assert.equal(init.method, 'GET');
    assert.equal(init.body, undefined);
    assert.equal(init.signal, controller.signal);
    return Response.json(
      path.includes('/events') ? events : path.endsWith('/supply/v2') ? page : detail,
    );
  };
  assert.equal(
    (await listSourcingSupply(fetcher, requestId, null, controller.signal)).requestId,
    requestId,
  );
  assert.equal(
    (await readSourcingSupply(fetcher, requestId, taskId, controller.signal)).task.id,
    taskId,
  );
  assert.equal(
    (await sourcingSupplyEvents(fetcher, requestId, taskId, 'abc_-', controller.signal)).items[0]
      .id,
    '9007199254740993',
  );
  assert.equal(seen[2], `/api/sourcing/requests/${requestId}/supply/${taskId}/events?cursor=abc_-`);
});
test('supply client rejects foreign targets, staff fields, malformed wire and untrusted path inputs', async () => {
  for (const value of [
    { ...detail, requestId: 'f'.repeat(32) },
    { ...detail, task: { ...detail.task, id: 'f'.repeat(32) } },
    { ...detail, internalNote: 'private' },
    { ...detail, canCheckout: true },
  ])
    await assert.rejects(
      readSourcingSupply(async () => Response.json(value), requestId, taskId),
      (error) => error instanceof CartError && error.status === 503,
    );
  await assert.rejects(
    listSourcingSupply(
      async () => Response.json({ ...page, requestId: 'f'.repeat(32) }),
      requestId,
    ),
    (error) => error instanceof CartError && error.status === 503,
  );
  const never = async () => {
    throw new Error('Transport must not run');
  };
  for (const path of ['../admin', '0'.repeat(32), 'A'.repeat(32)])
    await assert.rejects(
      readSourcingSupply(never, requestId, path),
      (error) => error instanceof CartError && error.status === 404,
    );
  for (const cursor of ['', 'a&ownerId=other', 'a'.repeat(201)])
    await assert.rejects(
      listSourcingSupply(never, requestId, cursor),
      (error) => error instanceof CartError && error.status === 400,
    );
});
test('supply view verifies a fresh matching version around detail and history before display', async () => {
  let details = 0;
  const result = await readSourcingSupplyView(
    async (path) => Response.json(path.includes('/events') ? events : (details++, detail)),
    requestId,
    taskId,
  );
  assert.equal(details, 2);
  assert.equal(result.detail.task.id, taskId);
  assert.equal(result.events.items.length, 1);
  for (const changed of [
    { ...detail, requestVersion: 'AAAAAAAAAAI=' },
    { ...detail, task: { ...detail.task, version: 'AAAAAAAAAAI=' } },
  ]) {
    let reads = 0;
    await assert.rejects(
      readSourcingSupplyView(
        async (path) =>
          Response.json(path.includes('/events') ? events : ++reads === 1 ? detail : changed),
        requestId,
        taskId,
      ),
      (error) => error instanceof CartError && error.status === 503,
    );
  }
});
test('supply client preserves sanitized upstream failures and rejects malformed JSON', async () => {
  await assert.rejects(
    readSourcingSupply(
      async () => Response.json({ title: 'not_found', detail: 'private' }, { status: 404 }),
      requestId,
      taskId,
    ),
    (error) => error instanceof CartError && error.code === 'not_found' && error.status === 404,
  );
  await assert.rejects(
    readSourcingSupply(
      async () => new Response('{broken', { headers: { 'Content-Type': 'application/json' } }),
      requestId,
      taskId,
    ),
    (error) =>
      error instanceof CartError &&
      error.code === 'sourcing_supply_unavailable' &&
      error.status === 503,
  );
});
