import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inventorySupplyDetailV2Schema,
  inventorySupplyPageV2Schema,
  inventorySupplyPath,
  supplyAdminDetailSchema,
  supplyAdminDetailV2Schema,
  supplyAdminPageV2Schema,
} from './supply-contract.ts';
import {
  supplyTestHeldAdminDetailV2 as held,
  supplyTestAdminPageV2 as page,
  supplyTestInventoryV2 as inventory,
  supplyTestIds as ids,
} from './supply.test-fixtures.ts';
test('administrative Supply2 presents an exact held allocation while the unchanged Supply1 cannot accept it', () => {
  assert.equal(supplyAdminDetailV2Schema.parse(held).reservedForRequest, true);
  assert.equal(supplyAdminDetailSchema.safeParse(held).success, false);
  assert.equal(
    supplyAdminPageV2Schema.parse({ ...page, items: [held.task], reservedForRequest: true })
      .reservedForRequest,
    true,
  );
  for (const extra of [{ canCheckout: true }, { canPay: true }, { reservedForRequest: false }])
    assert.equal(supplyAdminDetailV2Schema.safeParse({ ...held, ...extra }).success, false);
  const expired = {
    ...held,
    reservedForRequest: false,
    task: {
      ...held.task,
      reservedForRequest: false,
      allocation: { ...held.task.allocation, effectiveState: 'Expired' },
    },
  };
  assert.equal(supplyAdminDetailV2Schema.parse(expired).reservedForRequest, false);
});
test('warehouse Supply2 exposes a stock-share summary without device identity, customer, price or supplier notes', () => {
  const value = {
    ...inventory,
    task: { ...inventory.task, reservedForRequest: true, task: held.task },
  };
  assert.equal(inventorySupplyDetailV2Schema.parse(value).task.reservedForRequest, true);
  assert.equal(
    inventorySupplyPageV2Schema.parse({
      schemaVersion: 2,
      pageSize: 50,
      items: [
        {
          requestId: ids.request,
          requestReference: 'SR-1',
          requestVersion: inventory.task.requestVersion,
          task: held.task,
        },
      ],
      nextCursor: null,
    }).items[0].task.allocation?.quantity,
    2,
  );
  for (const extra of [
    { unitIds: ['private-device'] },
    { ownerId: 'private-owner' },
    { unitPriceRial: '9007199254740993' },
    { sourceKey: 'private-supplier' },
    { internalNote: 'private-note' },
    { quantity: 1 },
    { lines: [{ ...held.task.allocation.lines[0], variantId: 'other-sku' }] },
  ])
    assert.equal(
      inventorySupplyDetailV2Schema.safeParse({
        ...value,
        task: {
          ...value.task,
          task: { ...held.task, allocation: { ...held.task.allocation, ...extra } },
        },
      }).success,
      false,
    );
  assert.equal(
    inventorySupplyPath({ state: 'all', query: '' }, null),
    '/admin/inventory/sourcing-tasks/v2',
  );
  assert.equal(
    inventorySupplyPath({ state: 'PendingSupply', query: 'SKU' }, null),
    '/admin/inventory/sourcing-tasks/v2?state=PendingSupply&query=SKU',
  );
});
