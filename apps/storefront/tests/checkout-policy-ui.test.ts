import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  digitalUiHarness,
  uiElements,
  uiText,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
import * as display from '@sayman/web-shared/lib/checkout/checkout-shipping.ts';
import * as capacity from '../lib/orders/order-capacity-message.ts';
import { formatToman } from '@sayman/web-shared/lib/shared/money.ts';
import { CartError } from '../lib/checkout/cart-client.ts';
import {
  quoteExpired,
  quoteSnapshotSchema,
} from '@sayman/web-shared/lib/checkout/quote-contract.ts';
import { quoteSnapshotV5Schema } from '@sayman/web-shared/lib/checkout/quote-v5-contract.ts';
import * as orderContract from '@sayman/web-shared/lib/orders/order-v2-contract.ts';
import { quote5Snapshot, order2Detail } from '@sayman/web-shared/testing/order-v2.test-fixtures.ts';
import { ordinaryPostpaidQuote, postpaidQuote } from './checkout-shipping.test-fixtures.ts';
import { advanceRequestGeneration } from '@sayman/web-shared/lib/data/request-generation.ts';

const timers = { setInterval: () => 1, clearInterval() {} };
function common(locale: 'fa' | 'en') {
  const auth = {
    status: 'member',
    session: { user: { id: 'OWNER' } },
    store: {
      snapshot: () => ({ status: 'member', session: { user: { id: 'OWNER' } } }),
      fetch() {
        throw Error('No real fetch is allowed');
      },
    },
  };
  return {
    '@sayman/web-shared/lib/data/request-generation.ts': { advanceRequestGeneration },
    '@sayman/web-shared/lib/checkout/checkout-shipping.ts': display,
    '../../lib/orders/order-capacity-message': capacity,
    '@/lib/orders/order-capacity-message': capacity,
    '../auth/auth-provider': { useCustomerSession: () => auth },
    '../navigation/locale-provider': {
      useI18n: () => ({
        locale,
        digits: String,
        toman: (v: bigint) => formatToman(v.toString(), locale),
        t: (v: string) => v,
      }),
      useStorefront: () => ({
        purchaseMethods: ordinaryPostpaidQuote().methods,
        dataSource: 'api',
      }),
    },
    '../navigation/localized-link': { __esModule: true, default: 'Link' },
    '../shared/ui': { Button: 'Button' },
    '@sayman/web-shared/components/catalog/used-condition': {
      UsedConditionReport: 'UsedConditionReport',
    },
    '@/lib/checkout/cart-client': { CartError },
    '@sayman/web-shared/lib/shared/money.ts': { formatToman },
  };
}

for (const locale of ['fa', 'en'] as const) {
  test(`actual ${locale} ordinary checkout summary and delivery details distinguish postpaid and included-unitemized tax`, async () => {
    const q = { ...ordinaryPostpaidQuote(), locale };
    const cart = { version: q.cartVersion, ordinaryLines: q.lines, offerLines: [] };
    const mocks = {
      ...common(locale),
      '../credit/credit-order-form': {},
      '../credit/credit-checkout-quote-panel': {},
      '@sayman/web-shared/lib/credit/credit-order-journal.ts': {
        customerCreditOrderJournal: { subscribe() {}, snapshot: () => null },
      },
      '../../lib/credit/credit-checkout-quote-journal': {
        customerCreditCheckoutQuoteJournal: { subscribe() {}, snapshot: () => null },
      },
      '../providers/shop-provider': {
        useShop: () => ({
          serverCart: cart,
          ready: true,
          cartIssue: null,
          cartBusy: false,
          retry() {},
        }),
      },
      '@/lib/checkout/quote-client': { requestQuote: async () => q },
      '@sayman/web-shared/lib/checkout/quote-contract.ts': { quoteExpired },
      './temporary-order-form': {},
      './accepted-quote-review': {},
      '../orders/order-v2-form': {},
      './accepted-order-preparation': {},
      '@/lib/orders/order-v2-journal': {},
      '@/lib/checkout/quote-v5-journal': {},
    };
    const h = digitalUiHarness(
      fileURLToPath(new URL('../components/checkout/connected-checkout.tsx', import.meta.url)),
      mocks,
      timers,
      'export { QuoteReview, DeliveryDetails };',
    );
    h.mount('QuoteReview', {});
    await h.settle();
    assert.ok(uiText(h.tree()).includes(display.postpaidShippingAmountLabel(locale)));
    assert.ok(uiText(h.tree()).includes(display.unitemizedTaxLabel(locale)));
    assert.doesNotMatch(uiText(h.tree()), /NaN/);
    h.unmount();
    const detail = digitalUiHarness(
      fileURLToPath(new URL('../components/checkout/connected-checkout.tsx', import.meta.url)),
      mocks,
      timers,
      'export { DeliveryDetails };',
    );
    detail.mount('DeliveryDetails', { quote: q });
    assert.ok(uiText(detail.tree()).includes(display.postpaidShippingNotice(locale)));
    assert.ok(uiText(detail.tree()).includes(display.unitemizedTaxNotice(locale)));
    const digital = quoteSnapshotSchema.parse({
      ...q,
      shippingRequired: false,
      lines: q.lines.map((l) => ({ ...l, isDigital: true })),
      chargeRules: { ...q.chargeRules, shippingReason: 'digital' },
    });
    detail.rerender({ quote: digital });
    assert.ok(!uiText(detail.tree()).includes(display.postpaidShippingNotice(locale)));
    detail.unmount();
  });

  test(`actual ${locale} mixed-order prepare handler displays the same postpaid and unknown-tax snapshot`, async () => {
    const q = quoteSnapshotV5Schema.parse({ ...postpaidQuote(quote5Snapshot()), locale });
    const h = digitalUiHarness(
      fileURLToPath(
        new URL('../components/checkout/accepted-order-preparation.tsx', import.meta.url),
      ),
      {
        ...common(locale),
        '../providers/shop-provider': { useShop: () => ({ retry() {} }) },
        '../orders/order-v2-form': {},
        '@/lib/checkout/quote-v5-client': { requestQuoteV5: async () => q },
        '@/lib/checkout/quote-v5-journal': {
          readQuoteV5Attempt: () => null,
          startQuoteV5Attempt: (_owner: string, language: string, input: unknown) => ({
            locale: language,
            input,
          }),
          finishQuoteV5Attempt: () => true,
          failQuoteV5Attempt: () => false,
        },
      },
      timers,
    );
    h.mount('AcceptedOrderPreparation', {
      cartVersion: q.cartVersion,
      methodId: q.selectedMethod!.id,
      planId: null,
    });
    await h.settle();
    const prepare = uiElements(h.tree()).find(
      (n) => n.type === 'Button' && /دریافت شرایط|Prepare temporary/.test(uiText(n)),
    );
    assert.ok(prepare);
    (prepare.props.onClick as () => void)();
    await h.settle();
    assert.ok(uiText(h.tree()).includes(display.postpaidShippingAmountLabel(locale)));
    assert.ok(uiText(h.tree()).includes(display.unitemizedTaxLabel(locale)));
    assert.ok(uiText(h.tree()).includes(display.postpaidShippingNotice(locale)));
    h.unmount();
  });

  test(`actual ${locale} cheque ordinary and mixed retained calculations disclose external shipping and unknown included tax`, () => {
    for (const accepted of [false, true]) {
      const base = accepted
        ? quoteSnapshotV5Schema.parse(postpaidQuote(quote5Snapshot()))
        : ordinaryPostpaidQuote();
      const method = { ...base.methods[0], id: 'cheque', kind: 'cheque', requiresApproval: true };
      const plan = {
        id: 'fixture',
        name: 'In-memory plan',
        months: 2,
        markupBasisPoints: 0,
        downPaymentBasisPoints: 0,
        intervalMonths: 1,
        roundingUnitRial: 1,
        enabled: true,
        categoryIds: [],
        minAmountRial: null,
        maxAmountRial: null,
      };
      const first = BigInt(base.goodsTotalRial) / 2n;
      const input = {
        ...base,
        methods: [method],
        selectedMethod: method,
        plans: [plan],
        selectedPlan: plan,
        requiresApproval: true,
        blockers: ['credit_approval_required'],
        temporaryOrder: {
          ...base.temporaryOrder,
          canCreate: false,
          blockers: ['order_workflow_unavailable'],
        },
        installments: [
          { sequence: 1, monthOffset: 1, amountRial: first.toString() },
          {
            sequence: 2,
            monthOffset: 2,
            amountRial: (BigInt(base.goodsTotalRial) - first).toString(),
          },
        ],
      };
      const q = accepted ? quoteSnapshotV5Schema.parse(input) : quoteSnapshotSchema.parse(input);
      const h = digitalUiHarness(
        fileURLToPath(
          new URL('../components/credit/credit-checkout-quote-panel.tsx', import.meta.url),
        ),
        {
          ...common(locale),
          './credit-order-form': {},
          '../providers/shop-context': {},
          '@sayman/web-shared/lib/credit/credit-application-contract.ts': {},
          '@sayman/web-shared/lib/credit/credit-purchase-scope-contract.ts': {},
          '@sayman/web-shared/lib/credit/credit-checkout-quote-contract.ts': {},
          '../../lib/credit/credit-checkout-quote-journal': {},
        },
        timers,
      );
      h.mount('CreditCheckoutQuoteSnapshot', {
        quote: {
          id: 'f'.repeat(32),
          locale,
          createdAt: q.createdAt,
          expiresAt: q.expiresAt,
          ordinaryQuote: accepted ? null : q,
          acceptedQuote: accepted ? q : null,
          assessment: { withinLimit: true, assessedAmountRial: q.payableTotalRial, blockers: [] },
          authority: { limitAmountRial: q.payableTotalRial },
        },
        now: 0,
      });
      assert.ok(uiText(h.tree()).includes(display.postpaidShippingAmountLabel(locale)));
      assert.ok(uiText(h.tree()).includes(display.postpaidShippingNotice(locale)));
      assert.ok(uiText(h.tree()).includes(display.unitemizedTaxLabel(locale)));
      assert.doesNotMatch(uiText(h.tree()), /NaN/);
      h.unmount();
    }
  });

  test(`actual ${locale} accepted order2 form describes reservation as a maximum and retains the agreed hard deadlines`, () => {
    const mixed = quoteSnapshotV5Schema.parse(postpaidQuote(quote5Snapshot()));
    const h = digitalUiHarness(
      fileURLToPath(new URL('../components/orders/order-v2-form.tsx', import.meta.url)),
      {
        ...common(locale),
        '../navigation/localized-link': {
          __esModule: true,
          default: 'Link',
          useRouter: () => ({ push() {} }),
        },
        'react-hook-form': {
          useForm: () => ({
            register: (name: string) => ({ name }),
            handleSubmit: () => () => {},
            setError() {},
            clearErrors() {},
            setValue() {},
            formState: { errors: {} },
          }),
        },
        '../address/saved-address-picker': {},
        '@/lib/address/address-contract': {},
        '@sayman/web-shared/lib/orders/order-form.ts': {},
        '@/lib/orders/order-v2-client': {},
        '@/lib/orders/order-v2-journal': { readOrderV2Attempt: () => null },
      },
      timers,
    );
    h.mount('OrderV2Form', { quote: mixed, onCreated() {} });
    const text = uiText(h.tree());
    assert.match(text, /حداکثر مدت|Configured reservation maximum/);
    assert.match(text, /حقوق توافقی موجودی|Accepted stock, price and quoted terms/);
    assert.match(text, /سفارش ثبت‌شده|recorded order/);
    h.unmount();
  });

  test(`actual ${locale} customer order history follows immutable flags and does not infer postpaid from a historical zero/name`, async () => {
    const old = order2Detail();
    const recorded = orderContract.orderDetailV2Schema.parse({
      ...old,
      shippingMode: 'postpaid',
      shippingRial: '0',
      taxRial: null,
      taxIncluded: true,
      taxBreakdownKnown: false,
      payableTotalRial: old.goodsTotalRial,
      summary: { ...old.summary, payableTotalRial: old.goodsTotalRial },
    });
    for (const value of [recorded, orderContract.orderDetailV2Schema.parse(old)]) {
      const h = digitalUiHarness(
        fileURLToPath(new URL('../components/orders/customer-orders.tsx', import.meta.url)),
        {
          ...common(locale),
          '../credit/credit-order-information': {},
          './customer-returns': { CustomerReturns: 'CustomerReturns' },
          './order-payments': {},
          './order-parcels': {},
          './order-digital-deliveries': {},
          '@/lib/orders/order-v2-client': { readOrderV2: async () => value },
          '@sayman/web-shared/lib/orders/order-v2-contract.ts': orderContract,
        },
        timers,
        'export { OrdersView };',
      );
      h.mount('OrdersView', { id: value.summary.id });
      await h.settle();
      assert.equal(
        uiText(h.tree()).includes(display.postpaidShippingNotice(locale)),
        value === recorded,
      );
      assert.equal(
        uiText(h.tree()).includes(display.unitemizedTaxLabel(locale)),
        value === recorded,
      );
      assert.ok(!uiText(h.tree()).includes('NaN'));
      h.unmount();
    }
  });
}
