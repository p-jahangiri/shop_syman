import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  digitalUiHarness,
  uiElements,
  uiText,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
import * as parcel from '@sayman/web-shared/lib/orders/order-parcel-contract.ts';
import { parcelPage, parcelOrder } from '@sayman/web-shared/testing/order-parcel.test-fixtures.ts';
const file = fileURLToPath(new URL('../src/features/orders/order-parcels.tsx', import.meta.url));
function render(hasDigital: boolean, hasPhysical: boolean) {
  const reads: boolean[] = [];
  const empty = { snapshot: () => null, subscribe: () => () => {} };
  const h = digitalUiHarness(file, {
    '../../components/tables/admin-table': { AdminTable: 'AdminTable' },
    '@tanstack/react-query': {
      useQuery: (options: { enabled: boolean }) => {
        reads.push(options.enabled);
        return { data: parcelPage(), isPending: false };
      },
      useQueryClient() {},
    },
    '../../components/forms/persian-date-field': { PersianDateField: 'PersianDateField' },
    '../../api/api': { ApiError: Error },
    '../../components/ui': {},
    '../../auth/admin-view-authority': { adminViewRevision: () => 0 },
    '../../state/orders/order-parcel-journal': { orderParcelJournal: empty },
    '../../state/orders/order-digital-journal': { orderDigitalJournal: empty },
    '../../state/orders/order-shipment-journal': {
      subscribeShipmentJournal: empty.subscribe,
      shipmentJournalSnapshot: empty.snapshot,
    },
    './order-shipment': { OrderShipmentManager: 'OrderShipmentManager' },
    '@sayman/web-shared/lib/orders/order-parcel-contract.ts': parcel,
  });
  const tree = h.mount('OrderFulfillmentManager', {
    viewerId: 'actor',
    ownerId: 'OWNER',
    orderId: parcelOrder,
    writable: true,
    orderState: 'Paid',
    hasDigital,
    hasPhysical,
  });
  return { h, tree, reads };
}
test('actual digital-only order routing neither reads nor renders physical shipping controls', () => {
  const x = render(true, false);
  assert.equal(x.tree, null);
  assert.deepEqual(x.reads, [false]);
  x.h.unmount();
});
test('actual mixed order routing retains parcel workflow and never offers legacy all-order shipment', () => {
  const mixed = render(true, true);
  assert.ok(
    uiElements(mixed.tree).some(
      (n) => typeof n.type === 'function' && n.type.name === 'OrderParcelManager',
    ),
  );
  assert.ok(!uiText(mixed.tree).includes('یک بسته برای تمام سفارش'));
  mixed.h.unmount();
  const physical = render(false, true);
  assert.match(uiText(physical.tree), /یک بسته برای تمام سفارش/);
  physical.h.unmount();
});
