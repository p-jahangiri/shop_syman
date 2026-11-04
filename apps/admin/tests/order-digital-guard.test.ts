import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  digitalUiHarness,
  uiElements,
  uiText,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
import { digitalDeliveryMetadata } from '@sayman/web-shared/lib/orders/order-digital-contract.ts';
import {
  digitalPage,
  digitalInput,
  digitalResult,
} from '@sayman/web-shared/testing/order-digital.test-fixtures.ts';
import { OrderDigitalJournal } from '../src/state/orders/order-digital-journal.ts';
const file = fileURLToPath(
  new URL('../src/features/orders/order-digital-guard.tsx', import.meta.url),
);
test('actual global digital guard survives section navigation, retains the unload warning for uncertainty and removes it on logout', async () => {
  const journal = new OrderDigitalJournal(),
    meta = digitalDeliveryMetadata(digitalPage(), digitalInput()),
    listeners = new Set<
      (event: { preventDefault: () => void; returnValue: string | undefined }) => void
    >();
  let opened = 0;
  const h = digitalUiHarness(
    file,
    { '../../state/orders/order-digital-journal': { orderDigitalJournal: journal } },
    {
      window: {
        addEventListener(
          name: string,
          callback: (event: {
            preventDefault: () => void;
            returnValue: string | undefined;
          }) => void,
        ) {
          assert.equal(name, 'beforeunload');
          listeners.add(callback);
        },
        removeEventListener(
          name: string,
          callback: (event: {
            preventDefault: () => void;
            returnValue: string | undefined;
          }) => void,
        ) {
          assert.equal(name, 'beforeunload');
          listeners.delete(callback);
        },
      },
    },
  );
  journal.bind('actor');
  journal.begin('actor', meta);
  const props = {
    viewerId: 'actor',
    onOpen: () => {
      opened++;
    },
  };
  h.mount('DigitalCommandGuard', props);
  await h.settle();
  assert.equal(listeners.size, 1);
  // The account shell remains mounted while its keyed section subtree changes.
  h.rerender({ ...props, section: 'catalog' });
  await h.settle();
  assert.equal(listeners.size, 1);
  journal.interrupt();
  h.rerender({ ...props, section: 'inventory' });
  await h.settle();
  assert.equal(listeners.size, 1);
  assert.match(uiText(h.tree()), /هنوز مشخص نیست/);
  assert.ok(!uiText(h.tree()).includes('PRIVATE-TEST-CODE'));
  const event = {
    prevented: false,
    returnValue: undefined as string | undefined,
    preventDefault() {
      this.prevented = true;
    },
  };
  for (const listener of listeners) listener(event);
  assert.equal(event.prevented, true);
  assert.equal(event.returnValue, '');
  const button = uiElements(h.tree()).find((n) => n.type === 'button');
  assert.ok(button);
  (button.props.onClick as () => void)();
  assert.equal(opened, 1);
  journal.bind(null);
  h.rerender(props);
  await h.settle();
  assert.equal(listeners.size, 0);
  assert.equal(h.tree(), null);
  h.unmount();
});
test('a verified digital receipt removes the global guard and its listener before a new command', async () => {
  const journal = new OrderDigitalJournal(),
    meta = digitalDeliveryMetadata(digitalPage(), digitalInput());
  let listeners = 0;
  const h = digitalUiHarness(
    file,
    { '../../state/orders/order-digital-journal': { orderDigitalJournal: journal } },
    {
      window: {
        addEventListener() {
          listeners++;
        },
        removeEventListener() {
          listeners--;
        },
      },
    },
  );
  journal.bind('actor');
  journal.begin('actor', meta);
  h.mount('DigitalCommandGuard', { viewerId: 'actor' });
  await h.settle();
  assert.equal(listeners, 1);
  journal.finish('actor', meta, digitalResult());
  h.rerender();
  await h.settle();
  assert.equal(listeners, 0);
  assert.equal(h.tree(), null);
  h.unmount();
});
