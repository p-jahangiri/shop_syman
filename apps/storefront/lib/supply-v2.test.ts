import test from 'node:test';
import assert from 'node:assert/strict';
import { supplyAllocationHeld } from './supply-allocation.ts';
import { supplyDetailSchema, supplyDetailV2Schema, supplyPageV2Schema } from './supply-contract.ts';
import { isCustomerSupplyPath } from './supply-path.ts';
import { proxySourcingRequests } from './sourcing-proxy.ts';
import { readSourcingSupplyView } from './supply-client.ts';
import { CartError } from './cart-client.ts';
import {
  supplyTestAllocation as allocation,
  supplyTestHeldDetailV2 as held,
  supplyTestDetailV2 as empty,
  supplyTestEvents as events,
  supplyTestPageV2 as page,
  supplyTestRequest as requestId,
  supplyTestTask as taskId,
} from './supply.test-fixtures.ts';
test('Supply2 truthfully separates physical receipt, actual allocation and unavailable purchase while Supply1 stays strict', () => {
  assert.equal(supplyDetailV2Schema.parse(empty).reservedForRequest, false);
  assert.equal(supplyDetailV2Schema.parse(held).reservedForRequest, true);
  assert.equal(supplyDetailV2Schema.parse(held).canPay, false);
  assert.equal(supplyDetailSchema.safeParse(held).success, false);
  assert.equal(
    supplyPageV2Schema.parse({ ...page, items: [held.task], reservedForRequest: true }).items[0]
      .allocation?.quantity,
    3,
  );
  for (const extra of [
    { reservedForRequest: false },
    { canCheckout: true },
    { canPay: true },
    { schemaVersion: 1 },
  ])
    assert.equal(supplyDetailV2Schema.safeParse({ ...held, ...extra }).success, false);
  const expired = {
    ...held,
    reservedForRequest: false,
    task: {
      ...held.task,
      reservedForRequest: false,
      allocation: { ...allocation, effectiveState: 'Expired' },
    },
  };
  assert.equal(supplyDetailV2Schema.parse(expired).reservedForRequest, false);
  assert.equal(
    supplyDetailV2Schema.safeParse({ ...expired, reservedForRequest: true }).success,
    false,
  );
});
test('allocation lineage, full quantity and private fields remain strictly bounded in customer Supply2', () => {
  for (const extra of [
    { unitIds: ['private-device'] },
    { ownerId: 'private-owner' },
    { priceRial: '9007199254740993' },
    { internalNote: 'private supplier' },
    { quantity: 2 },
    { expiresAt: '2031-01-01T00:00:00Z' },
    { lines: [{ ...allocation.lines[0], offerLineId: '9'.repeat(32) }] },
    { lines: [{ ...allocation.lines[0], variantId: 'other-sku' }] },
  ])
    assert.equal(
      supplyDetailV2Schema.safeParse({
        ...held,
        task: { ...held.task, allocation: { ...allocation, ...extra } },
      }).success,
      false,
    );
  assert.equal(
    supplyPageV2Schema.safeParse({ ...page, items: [held.task], reservedForRequest: false })
      .success,
    false,
  );
  assert.equal(
    supplyPageV2Schema.safeParse({ ...page, startCandidate: { offerId: held.task.offerId } })
      .success,
    false,
  );
});
test('an open view stops claiming the hold at its exact deadline and cannot revive a server-expired or absent allocation', () => {
  const at = Date.parse(allocation.expiresAt);
  assert.equal(supplyAllocationHeld(true, allocation, at - 1), true);
  assert.equal(supplyAllocationHeld(true, allocation, at), false);
  assert.equal(supplyAllocationHeld(true, allocation, at + 1), false);
  assert.equal(supplyAllocationHeld(false, allocation, at - 1), false);
  assert.equal(
    supplyAllocationHeld(true, { ...allocation, effectiveState: 'Expired' }, at - 1),
    false,
  );
  assert.equal(supplyAllocationHeld(true, null, at - 1), false);
});
test('Supply2 BFF and session paths authorize only its bounded GET reads; events retain the prior route and contract', async () => {
  const origin = 'http://sayman-supply.localhost:3107',
    environment = {
      SHOP_API_URL: 'http://127.0.0.1:5181',
      SHOP_PUBLIC_URL: origin,
      SHOP_DATA_MODE: 'api',
    },
    root = [requestId, 'supply', 'v2'],
    child = [...root, taskId],
    bearer = 'Bearer ' + 'own-qa-token-'.repeat(4);
  for (const [path, value] of [
    [root, { ...page, items: [held.task], reservedForRequest: true }],
    [child, held],
  ] as const) {
    const url = '/api/sourcing/requests/' + path.join('/');
    assert.equal(isCustomerSupplyPath(url), true);
    const result = await proxySourcingRequests(
      new Request(origin + url, { headers: { Origin: origin, Authorization: bearer } }),
      [...path],
      environment,
      async (upstream, init) => {
        assert.equal(upstream, environment.SHOP_API_URL + url);
        assert.equal(init?.method, 'GET');
        assert.equal(init?.cache, 'no-store');
        return Response.json(value);
      },
    );
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
    assert.equal((await result.json()).reservedForRequest, true);
  }
  for (const suffix of ['/events', '/cancel', '/convert', '?ownerId=other', '?cursor=abc'])
    assert.equal(isCustomerSupplyPath('/api/sourcing/requests/' + child.join('/') + suffix), false);
  const mismatch = await proxySourcingRequests(
    new Request(origin + '/api/sourcing/requests/' + child.join('/'), {
      headers: { Origin: origin, Authorization: bearer },
    }),
    child,
    environment,
    async () =>
      Response.json({
        ...held,
        task: { ...held.task, allocation: { ...allocation, unitIds: ['private'] } },
      }),
  );
  assert.equal(mismatch.status, 503);
});
test('view revalidation rejects a concurrently released allocation even when Market versions are unchanged', async () => {
  let reads = 0;
  await assert.rejects(
    readSourcingSupplyView(
      async (path) =>
        Response.json(path.includes('/events') ? events : ++reads === 1 ? held : empty),
      requestId,
      taskId,
    ),
    (error) => error instanceof CartError && error.status === 503,
  );
  assert.equal(reads, 2);
});
