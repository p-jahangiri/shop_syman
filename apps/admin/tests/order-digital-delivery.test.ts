import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import * as contract from '@sayman/web-shared/lib/orders/order-digital-contract.ts';
import {
  digitalPage,
  digitalOrder,
  digitalInput,
  digitalResult,
  blockedDigitalPage,
} from '@sayman/web-shared/testing/order-digital.test-fixtures.ts';
import {
  digitalUiHarness,
  uiElements,
  uiText,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
import { OrderDigitalJournal } from '../src/state/orders/order-digital-journal.ts';
const component = fileURLToPath(
  new URL('../src/features/orders/order-digital-delivery.tsx', import.meta.url),
);
function setup(request: (path: string, init?: RequestInit) => Promise<unknown>) {
  const journal = new OrderDigitalJournal();
  journal.bind('actor');
  let revision = 0,
    closes = 0;
  const harness = digitalUiHarness(
    component,
    {
      '../../api/api': { api: request, ApiError: class ApiError extends Error {} },
      '../../components/tables/admin-table': { AdminTable: 'AdminTable' },
      '../../components/ui': {
        Busy: 'Busy',
        Check: 'Check',
        ErrorBox: 'ErrorBox',
        Field: 'Field',
        Modal: 'Modal',
      },
      '../../auth/admin-view-authority': { adminViewRevision: () => revision },
      '../../state/orders/order-digital-journal': { orderDigitalJournal: journal },
      '../../state/orders/order-parcel-journal': {
        orderParcelJournal: { snapshot: () => null, subscribe: () => () => {} },
      },
      '../../state/orders/order-shipment-journal': {
        shipmentJournalSnapshot: () => null,
        subscribeShipmentJournal: () => () => {},
      },
      '@tanstack/react-query': { useQueryClient: () => ({ async invalidateQueries() {} }) },
      '@sayman/web-shared/lib/orders/order-digital-contract.ts': contract,
    },
    {},
    'export { DigitalDeliveryForm };',
  );
  const node = (match: (n: ReturnType<typeof uiElements>[number]) => boolean) => {
    const found = uiElements(harness.tree()).find(match);
    assert.ok(found);
    return found;
  };
  async function fill() {
    harness.mount('DigitalDeliveryForm', {
      page: digitalPage(),
      viewerId: 'actor',
      writable: true,
      onClose: () => {
        closes++;
      },
      onChanged() {},
    });
    await harness.settle();
    (
      node((n) => n.type === 'input' && n.props.type === 'number').props.onChange as (
        e: unknown,
      ) => void
    )({ target: { value: '1' } });
    await harness.settle();
    (node((n) => n.type === 'textarea').props.onChange as (e: unknown) => void)({
      target: { value: digitalInput().lines[0].contents[0] },
    });
    (
      node((n) => n.type === 'input' && n.props.maxLength === 400).props.onChange as (
        e: unknown,
      ) => void
    )({ target: { value: digitalInput().reason } });
    await harness.settle();
    (node((n) => n.type === 'Check').props.onChange as (e: unknown) => void)({
      target: { checked: true },
    });
    await harness.settle();
  }
  const submit = () =>
    (node((n) => n.type === 'form').props.onSubmit as (e: unknown) => void)({
      preventDefault() {},
    });
  return {
    harness,
    journal,
    node,
    fill,
    submit,
    closes: () => closes,
    revoke() {
      revision++;
    },
  };
}
test('actual admin digital form erases draft before network, stores metadata only and binds receipt to submitted UUID', async () => {
  let resolve!: (value: unknown) => void,
    body = '',
    path = '';
  const x = setup(async (p, init) => {
    path = p;
    body = String(init?.body);
    return new Promise((r) => {
      resolve = r;
    });
  });
  await x.fill();
  x.submit();
  await x.harness.settle();
  assert.match(path, /\/fulfillment\/digital\/commands\/[a-f0-9]{32}$/);
  assert.equal(JSON.parse(body).lines[0].contents[0], digitalInput().lines[0].contents[0]);
  const entry = x.journal.snapshot('actor')!;
  assert.equal(entry.state, 'pending');
  assert.ok(!JSON.stringify(entry).includes('PRIVATE-TEST-CODE'));
  assert.ok(!JSON.stringify(entry).includes(digitalInput().reason));
  assert.equal(uiElements(x.harness.tree()).filter((n) => n.type === 'textarea').length, 0);
  resolve({ ...digitalResult(), commandId: entry.metadata.commandId });
  await x.harness.settle();
  assert.equal(x.journal.snapshot('actor')!.state, 'done');
  assert.equal(x.closes(), 1);
  x.harness.unmount();
});
test('actual admin unknown outcome exposes GET receipt recovery only and never repeats private request', async () => {
  let posts = 0;
  const x = setup(async () => {
    posts++;
    throw Error('lost response');
  });
  await x.fill();
  x.submit();
  await x.harness.settle();
  assert.equal(posts, 1);
  assert.equal(x.journal.snapshot('actor')!.state, 'unknown');
  const meta = x.journal.snapshot('actor')!.metadata;
  assert.equal(meta.orderId, digitalOrder);
  assert.throws(() => x.journal.begin('actor', meta));
  x.harness.unmount();
  const requests: string[] = [];
  const panel = digitalUiHarness(component, {
    '../../api/api': {
      async api(path: string) {
        requests.push(path);
        return { ...digitalResult(), commandId: meta.commandId, replayed: true };
      },
      ApiError: Error,
    },
    '../../components/tables/admin-table': {},
    '../../components/ui': {},
    '../../auth/admin-view-authority': { adminViewRevision: () => 0 },
    '../../state/orders/order-digital-journal': { orderDigitalJournal: x.journal },
    '../../state/orders/order-parcel-journal': {},
    '../../state/orders/order-shipment-journal': {},
    '@tanstack/react-query': { useQueryClient: () => ({ async invalidateQueries() {} }) },
    '@sayman/web-shared/lib/orders/order-digital-contract.ts': contract,
  });
  panel.mount('DigitalJournalPanel', { viewerId: 'actor', writable: true });
  await panel.settle();
  const button = uiElements(panel.tree()).find(
    (n) => n.type === 'button' && /دریافت رسید همین فرمان/.test(uiText(n)),
  );
  assert.ok(button);
  (button.props.onClick as () => void)();
  await panel.settle();
  assert.deepEqual(requests, [
    contract.digitalBase('OWNER', digitalOrder) + '/commands/' + meta.commandId,
  ]);
  assert.equal(x.journal.snapshot('actor')!.state, 'done');
  assert.equal(posts, 1);
  panel.unmount();
});
test('actual admin digital form will not send a stale form after access revision changes', async () => {
  let requests = 0;
  const x = setup(async () => {
    requests++;
    return digitalResult();
  });
  await x.fill();
  x.revoke();
  x.submit();
  await x.harness.settle();
  assert.equal(requests, 0);
  assert.equal(x.journal.snapshot('actor'), null);
  x.harness.unmount();
});
test('closing the admin workspace during a sent command switches to GET-recoverable uncertainty without retaining text', async () => {
  let resolve!: (value: unknown) => void;
  const x = setup(
    async () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await x.fill();
  x.submit();
  await x.harness.settle();
  const meta = x.journal.snapshot('actor')!.metadata;
  assert.equal(x.journal.snapshot('actor')!.state, 'pending');
  x.harness.unmount();
  assert.equal(x.journal.snapshot('actor')!.state, 'unknown');
  assert.ok(!JSON.stringify(x.journal.snapshot('actor')).includes('PRIVATE-TEST-CODE'));
  resolve({ ...digitalResult(), commandId: meta.commandId });
  await x.harness.settle();
  assert.equal(x.journal.snapshot('actor')!.state, 'done');
});
test('actual admin unallocated digital workspace displays historical rights and blockers without opening a delivery form', async () => {
  const empty = { snapshot: () => null, subscribe: () => () => {} };
  const h = digitalUiHarness(component, {
    '../../api/api': {
      api() {
        throw Error('No mutation');
      },
      ApiError: Error,
    },
    '../../components/tables/admin-table': { AdminTable: 'AdminTable' },
    '../../components/ui': {
      Busy: 'Busy',
      Check: 'Check',
      ErrorBox: 'ErrorBox',
      Field: 'Field',
      Modal: 'Modal',
    },
    '../../auth/admin-view-authority': { adminViewRevision: () => 0 },
    '../../state/orders/order-digital-journal': { orderDigitalJournal: empty },
    '../../state/orders/order-parcel-journal': { orderParcelJournal: empty },
    '../../state/orders/order-shipment-journal': {
      shipmentJournalSnapshot: empty.snapshot,
      subscribeShipmentJournal: empty.subscribe,
    },
    '@tanstack/react-query': {
      useQueryClient: () => ({ async invalidateQueries() {} }),
      useQuery: () => ({
        data: contract.readAdminDigitalDeliveries(blockedDigitalPage(), 'OWNER', digitalOrder),
        isPending: false,
        isFetching: false,
      }),
    },
    '@sayman/web-shared/lib/orders/order-digital-contract.ts': contract,
  });
  h.mount('OrderDigitalDeliveryManager', {
    viewerId: 'actor',
    ownerId: 'OWNER',
    orderId: digitalOrder,
    writable: true,
  });
  await h.settle();
  const tree = h.tree();
  assert.match(uiText(tree), /پرداخت یا وضعیت مالی مستقل سفارش تأیید نشده/);
  assert.match(uiText(tree), /موجودی این سفارش هنوز متعهد/);
  const prepare = uiElements(tree).find(
    (n) => n.type === 'button' && /آماده‌سازی تحویل دیجیتال/.test(uiText(n)),
  );
  assert.ok(prepare);
  assert.equal(prepare.props.disabled, true);
  assert.equal(
    uiElements(tree).filter((n) => n.type === 'form' || n.type === 'textarea' || n.type === 'Modal')
      .length,
    0,
  );
  h.unmount();
});
test('actual multi-line draft cannot allocate a 101st textarea, shrinking frees capacity and closing clears private text', async () => {
  let calls = 0;
  const x = setup(async () => {
      calls++;
      throw Error('No request expected');
    }),
    page = digitalPage(),
    line = page.lines[0];
  page.lines = [
    { ...line, ordered: 100, remaining: 100 },
    {
      ...line,
      lineKey: 'SECOND',
      variantId: 'SECOND_V',
      sku: 'SECOND-CODE',
      ordered: 100,
      remaining: 100,
    },
  ];
  x.harness.mount('DigitalDeliveryForm', {
    page,
    viewerId: 'actor',
    writable: true,
    onClose() {},
    onChanged() {},
  });
  await x.harness.settle();
  const numbers = () =>
      uiElements(x.harness.tree()).filter((n) => n.type === 'input' && n.props.type === 'number'),
    areas = () => uiElements(x.harness.tree()).filter((n) => n.type === 'textarea'),
    change = (node: ReturnType<typeof uiElements>[number], value: string) =>
      (node.props.onChange as (e: unknown) => void)({ target: { value } });
  // Both handlers come from the same render: functional state validation must
  // enforce the shared cap even before React paints the first update.
  const initial = numbers();
  change(initial[0], '100');
  change(initial[1], '1');
  await x.harness.settle();
  assert.equal(areas().length, 100);
  assert.equal(numbers()[1].props.value, 0);
  assert.equal(numbers()[1].props.max, 0);
  change(areas()[0], 'PRIVATE-CAP-TEST');
  await x.harness.settle();
  change(numbers()[1], '1');
  await x.harness.settle();
  assert.equal(areas().length, 100);
  change(numbers()[0], '99');
  await x.harness.settle();
  assert.equal(areas().length, 99);
  assert.equal(numbers()[1].props.max, 1);
  change(numbers()[1], '1');
  await x.harness.settle();
  assert.equal(areas().length, 100);
  assert.equal(areas()[0].props.value, 'PRIVATE-CAP-TEST');
  (x.node((n) => n.type === 'Modal').props.onClose as () => void)();
  await x.harness.settle();
  assert.equal(areas().length, 0);
  assert.ok(!JSON.stringify(x.harness.tree()).includes('PRIVATE-CAP-TEST'));
  assert.equal(x.journal.snapshot('actor'), null);
  assert.equal(calls, 0);
  x.harness.unmount();
});
