import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  digitalUiHarness,
  uiElements,
  uiText,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
import { CartError } from '../lib/checkout/cart-client.ts';
import * as form from '@sayman/web-shared/lib/orders/order-form.ts';
import * as journal from '../lib/orders/order-v2-journal.ts';
import * as capacity from '../lib/orders/order-capacity-message.ts';
import { ordinaryPostpaidQuote } from './checkout-shipping.test-fixtures.ts';
import { quote5Snapshot } from '@sayman/web-shared/testing/order-v2.test-fixtures.ts';
const values = {
  contactName: 'Test Recipient',
  contactPhone: '09123456789',
  province: 'Tehran',
  city: 'Tehran',
  address: 'Test-only in-memory delivery address',
  postalCode: '1234567890',
  note: '',
  acknowledgeTemporary: true,
};
for (const locale of ['fa', 'en'] as const)
  for (const mixed of [false, true])
    test(`actual ${locale} ${mixed ? 'mixed' : 'ordinary'} open-order-limit handler gives actionable copy rather than a stock-change message`, async () => {
      journal.bindOrderV2Owner(null);
      journal.bindOrderV2Owner('OWNER');
      const calls: unknown[] = [];
      const component = mixed ? 'orders/order-v2-form' : 'checkout/temporary-order-form';
      const h = digitalUiHarness(
        fileURLToPath(new URL(`../components/${component}.tsx`, import.meta.url)),
        {
          'react-hook-form': {
            useForm: () => ({
              register: (name: string) => ({ name }),
              handleSubmit: (fn: (v: typeof values) => Promise<void>) => () => fn(values),
              setError() {},
              clearErrors() {},
              setValue() {},
              formState: { errors: {} },
            }),
          },
          '../auth/auth-provider': {
            useCustomerSession: () => ({
              status: 'member',
              session: { user: { id: 'OWNER' } },
              store: {
                fetch() {
                  throw Error('No network');
                },
                snapshot: () => ({ status: 'member', session: { user: { id: 'OWNER' } } }),
              },
            }),
          },
          '../navigation/locale-provider': { useI18n: () => ({ locale, digits: String }) },
          '../navigation/localized-link': {
            __esModule: true,
            default: 'Link',
            useRouter: () => ({ push() {} }),
          },
          '../shared/ui': { Button: 'Button' },
          '../address/saved-address-picker': { SavedAddressPicker: 'Picker' },
          '../providers/shop-context': { useShop: () => ({ serverCart: { offerLines: [] } }) },
          '@/lib/address/address-contract': {},
          '@/lib/checkout/cart-client': { CartError },
          '@sayman/web-shared/lib/orders/order-form.ts': form,
          '@/lib/orders/order-capacity-message': capacity,
          '@/lib/orders/order-v2-journal': journal,
          [mixed ? '@/lib/orders/order-v2-client' : '@/lib/orders/order-client']: {
            [mixed ? 'createOrderV2' : 'createOrder']: async (_fetch: unknown, input: unknown) => {
              calls.push(structuredClone(input));
              throw new CartError('open_order_limit_conflict', 409);
            },
          },
        },
        { setInterval: () => 1, clearInterval() {} },
      );
      const q = mixed ? quote5Snapshot() : ordinaryPostpaidQuote();
      q.expiresAt = '2050-01-01T00:00:00Z';
      q.temporaryOrder = { ...q.temporaryOrder!, canCreate: true };
      h.mount(mixed ? 'OrderV2Form' : 'TemporaryOrderForm', {
        quote: q,
        expired: false,
        onCreated() {},
        onInvalidated() {},
      });
      await h.settle();
      const node = uiElements(h.tree()).find((n) => n.type === 'form');
      assert.ok(node);
      await (node.props.onSubmit as () => Promise<void>)();
      await h.settle();
      assert.equal(calls.length, 1);
      assert.match(
        uiText(h.tree()),
        locale === 'fa' ? /سقف سفارش‌های باز شما تکمیل/ : /open-order limit is reached/,
      );
      assert.match(uiText(h.tree()), locale === 'fa' ? /بررسی یا لغو/ : /Review or cancel/);
      assert.doesNotMatch(uiText(h.tree()), /maximum 2|حداکثر ۲/);
      if (mixed) assert.equal(journal.readOrderV2Attempt('OWNER'), null);
      h.unmount();
      journal.bindOrderV2Owner(null);
    });
