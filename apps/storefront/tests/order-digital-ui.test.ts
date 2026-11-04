import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { advanceRequestGeneration } from '@sayman/web-shared/lib/data/request-generation.ts';
import * as contract from '@sayman/web-shared/lib/orders/order-digital-contract.ts';
import {
  digitalContent,
  digitalDelivery,
  digitalOrder,
  digitalSummary,
} from '@sayman/web-shared/testing/order-digital.test-fixtures.ts';
import {
  digitalUiHarness,
  uiElements,
  uiText,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';

const widget = fileURLToPath(
  new URL('../components/orders/order-digital-deliveries.tsx', import.meta.url),
);
function setup(locale: 'fa' | 'en', contentFetch?: () => Promise<Response>, copyFails = false) {
  const calls: { path: string; init: RequestInit | undefined }[] = [],
    copies: string[] = [];
  let owner: string | undefined = 'OWNER';
  const store = {
    snapshot: () => ({ session: owner ? { user: { id: owner } } : null }),
    async fetch(path: string, init?: RequestInit) {
      calls.push({ path, init });
      return path.endsWith('/content') && contentFetch
        ? contentFetch()
        : Response.json(
            path.endsWith('/content')
              ? digitalContent()
              : { schemaVersion: 1, orderId: digitalOrder, deliveries: [digitalSummary()] },
            { headers: { 'X-Sayman-Fulfillment-Contract': 'digital-v1' } },
          );
    },
  };
  const harness = digitalUiHarness(
    widget,
    {
      '../auth/auth-provider': {
        useCustomerSession: () => ({ store, session: store.snapshot().session }),
      },
      '../navigation/locale-provider': { useI18n: () => ({ locale, digits: String }) },
      '../shared/ui': { Button: 'Button' },
      '@sayman/web-shared/lib/orders/order-digital-contract.ts': contract,
      '@sayman/web-shared/lib/data/request-generation.ts': { advanceRequestGeneration },
    },
    {
      navigator: {
        clipboard: {
          async writeText(value: string) {
            if (copyFails) throw Error('Clipboard unavailable');
            copies.push(value);
          },
        },
      },
    },
  );
  const button = (match: RegExp) => {
    const node = uiElements(harness.tree()).find(
      (n) => n.type === 'Button' && match.test(uiText(n)),
    );
    assert.ok(node, 'Expected button: ' + match);
    return node;
  };
  return {
    harness,
    calls,
    copies,
    button,
    logout() {
      owner = undefined;
      harness.rerender();
    },
  };
}
for (const locale of ['fa', 'en'] as const)
  test(`actual ${locale} customer digital UI loads metadata only, explicitly reveals escaped text, copies and clears on hide/logout`, async () => {
    const x = setup(locale);
    const first = x.harness.mount('CustomerDigitalDeliveriesCard', { orderId: digitalOrder });
    assert.equal(x.calls.length, 0);
    assert.ok(!uiText(first).includes('PRIVATE-TEST-CODE'));
    await x.harness.settle();
    assert.equal(x.calls.length, 1);
    assert.ok(!uiText(x.harness.tree()).includes('PRIVATE-TEST-CODE'));
    (x.button(/نمایش محتوای خصوصی|Reveal private content/).props.onClick as () => void)();
    await x.harness.settle();
    assert.equal(x.calls.length, 2);
    assert.ok(uiText(x.harness.tree()).includes('PRIVATE-TEST-CODE'));
    const pre = uiElements(x.harness.tree()).find((n) => n.type === 'pre');
    assert.equal(pre?.props.children, 'PRIVATE-TEST-CODE');
    assert.equal(pre?.props.dangerouslySetInnerHTML, undefined);
    await (x.button(/کپی همین متن|Copy this text/).props.onClick as () => Promise<void>)();
    await x.harness.settle();
    assert.deepEqual(x.copies, ['PRIVATE-TEST-CODE']);
    (x.button(/پنهان‌کردن|Hide and clear/).props.onClick as () => void)();
    await x.harness.settle();
    assert.ok(!uiText(x.harness.tree()).includes('PRIVATE-TEST-CODE'));
    (x.button(/نمایش محتوای خصوصی|Reveal private content/).props.onClick as () => void)();
    await x.harness.settle();
    assert.ok(uiText(x.harness.tree()).includes('PRIVATE-TEST-CODE'));
    x.logout();
    assert.ok(!uiText(x.harness.tree()).includes('PRIVATE-TEST-CODE'));
    await x.harness.settle();
    assert.ok(x.calls.every((c) => c.init?.cache === 'no-store' && c.init?.signal));
    x.harness.unmount();
  });
test('actual customer digital UI rejects stale content after selection/order/logout and aborts its request', async () => {
  let resolve!: (value: Response) => void;
  const x = setup(
    'en',
    () =>
      new Promise<Response>((r) => {
        resolve = r;
      }),
  );
  x.harness.mount('CustomerDigitalDeliveriesCard', { orderId: digitalOrder });
  await x.harness.settle();
  (x.button(/Reveal private content/).props.onClick as () => void)();
  await x.harness.settle();
  assert.equal(x.calls[1].path, contract.customerDigitalPath(digitalOrder, digitalDelivery));
  x.logout();
  await x.harness.settle();
  assert.equal(x.calls[1].init?.signal?.aborted, true);
  resolve(
    Response.json(digitalContent(), { headers: { 'X-Sayman-Fulfillment-Contract': 'digital-v1' } }),
  );
  await x.harness.settle();
  assert.ok(!uiText(x.harness.tree()).includes('PRIVATE-TEST-CODE'));
  x.harness.unmount();
});
test('actual customer digital UI rejects wrong contract and mismatched quantities instead of displaying content', async () => {
  for (const wrong of ['header', 'quantity']) {
    const x = setup('en', async () =>
      Response.json(
        { ...digitalContent(), items: wrong === 'quantity' ? [] : digitalContent().items },
        {
          headers: {
            'X-Sayman-Fulfillment-Contract': wrong === 'header' ? 'parcels-v1' : 'digital-v1',
          },
        },
      ),
    );
    x.harness.mount('CustomerDigitalDeliveriesCard', { orderId: digitalOrder });
    await x.harness.settle();
    (x.button(/Reveal private content/).props.onClick as () => void)();
    await x.harness.settle();
    assert.ok(!uiText(x.harness.tree()).includes('PRIVATE-TEST-CODE'));
    assert.match(uiText(x.harness.tree()), /could not be verified/);
    x.harness.unmount();
  }
});
test('actual private text stays literal without HTML or autolinks and clipboard failure leaves an actionable message', async () => {
  const literal = '<script>alert(1)</script> https://example.test/private-code';
  const x = setup(
    'en',
    async () =>
      Response.json(
        { ...digitalContent(), items: [{ ...digitalContent().items[0], content: literal }] },
        { headers: { 'X-Sayman-Fulfillment-Contract': 'digital-v1' } },
      ),
    true,
  );
  x.harness.mount('CustomerDigitalDeliveriesCard', { orderId: digitalOrder });
  await x.harness.settle();
  (x.button(/Reveal private content/).props.onClick as () => void)();
  await x.harness.settle();
  const nodes = uiElements(x.harness.tree()),
    pre = nodes.find((n) => n.type === 'pre');
  assert.equal(pre?.props.children, literal);
  assert.equal(pre?.props.dangerouslySetInnerHTML, undefined);
  assert.equal(nodes.filter((n) => n.type === 'a' || n.type === 'script').length, 0);
  (x.button(/Copy this text/).props.onClick as () => void)();
  await x.harness.settle();
  assert.match(uiText(x.harness.tree()), /Select and copy the text manually/);
  assert.deepEqual(x.copies, []);
  x.harness.rerender({ orderId: digitalDelivery });
  assert.ok(!uiText(x.harness.tree()).includes(literal));
  x.harness.unmount();
});
