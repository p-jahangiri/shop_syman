import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  digitalUiHarness,
  uiElements,
  uiText,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
import * as money from '../src/utils/finance-inputs.ts';
import * as chargeContract from '../src/api/contracts/finance/checkout-charge-contract.ts';
import * as display from '@sayman/web-shared/lib/checkout/checkout-shipping.ts';
import { order2Detail } from '@sayman/web-shared/testing/order-v2.test-fixtures.ts';
import { orderDetailV2Schema } from '../src/api/contracts/orders/orders-contract.ts';

test('actual charge editor submits postpaid and unitemized tax without leaking old flat fees or a stale tax rate', async () => {
  const sent: Record<string, unknown>[] = [];
  const h = digitalUiHarness(
    fileURLToPath(new URL('../src/pages/finance/charges.tsx', import.meta.url)),
    {
      '@tanstack/react-query': {
        useQueryClient: () => ({ invalidateQueries() {} }),
      },
      '../../api/api': {
        save: async (_path: string, value: Record<string, unknown>) => {
          sent.push(structuredClone(value));
          return { ...value, version: 'AAAAAAAAAAI=', id: 1 };
        },
        ApiError: class extends Error {},
      },
      '../../components/ui': { Field: 'Field', ErrorBox: 'ErrorBox', Modal: 'Modal', Busy: 'Busy' },
      '../../auth/admin-view-authority': { adminViewRevision: () => 0 },
      '../../features/finance/finance-review-box': { FinanceReviewBox: 'FinanceReviewBox' },
      '../../utils/finance-inputs': money,
      '../../api/contracts/finance/checkout-charge-contract': chargeContract,
      '../../styles/finance/finance-workspace.css': {},
    },
    {},
    'export { ChargeForm };',
  );
  h.mount('ChargeForm', {
    initial: {
      version: 'AAAAAAAAAAE=',
      shippingMode: 'flat',
      shippingNameFa: 'روش ثبت‌شده',
      shippingNameEn: 'Recorded method',
      shippingDescriptionFa: '',
      shippingDescriptionEn: '',
      shippingFeeRial: '123456789012345678',
      shippingFreeFromRial: '999999999999999999',
      taxMode: 'inclusive',
      taxRateBasisPoints: 925,
      taxBase: 'goods_shipping',
      taxRounding: 'half_up',
    },
    onClose() {},
    onBusy() {},
  });
  const select = (label: string) => {
    const field = uiElements(h.tree()).find(
      (node) => node.type === 'Field' && node.props.label === label,
    );
    assert.ok(field);
    const node = uiElements(field.props.children).find((node) => node.type === 'select');
    assert.ok(node);
    return node;
  };
  (select('سیاست ارسال').props.onChange as (event: unknown) => void)({
    target: { value: 'postpaid' },
  });
  await h.settle();
  (select('نحوهٔ محاسبه').props.onChange as (event: unknown) => void)({
    target: { value: 'included_unitemized' },
  });
  await h.settle();
  assert.ok(
    !uiElements(h.tree()).some(
      (node) => node.type === 'Field' && node.props.label === 'نرخ (درصد)',
    ),
  );
  assert.match(uiText(h.tree()), /جداگانه به حمل‌کننده می‌پردازد/);
  assert.match(uiText(h.tree()), /مالیات دیگری اضافه نمی‌شود/);
  const form = () => uiElements(h.tree()).find((node) => node.type === 'form')!;
  const submit = () =>
    (form().props.onSubmit as (event: unknown) => void)({
      preventDefault() {},
      currentTarget: { querySelector: () => null },
    });
  submit();
  await h.settle();
  assert.equal(sent.length, 0, 'preview must not send a write');
  const review = () => uiElements(h.tree()).find((node) => node.type === 'FinanceReviewBox')!;
  (review().props.onBack as () => void)();
  await h.settle();
  (select('نحوهٔ محاسبه').props.onChange as (event: unknown) => void)({
    target: { value: 'inclusive' },
  });
  await h.settle();
  submit();
  await h.settle();
  assert.equal(sent.length, 0, 'a hidden old rate must be entered again explicitly');
  assert.ok(
    uiElements(h.tree()).find((node) => node.type === 'Field' && node.props.label === 'نرخ (درصد)')
      ?.props.error,
  );
  (select('نحوهٔ محاسبه').props.onChange as (event: unknown) => void)({
    target: { value: 'included_unitemized' },
  });
  await h.settle();
  submit();
  await h.settle();
  const confirm = review().props.onConfirm as () => void;
  confirm();
  confirm();
  await h.settle();
  assert.equal(sent.length, 1, 'double confirm cannot submit twice');
  assert.deepEqual(sent[0], {
    shippingMode: 'postpaid',
    shippingNameFa: 'روش ثبت‌شده',
    shippingNameEn: 'Recorded method',
    shippingDescriptionFa: '',
    shippingDescriptionEn: '',
    shippingFeeRial: null,
    shippingFreeFromRial: null,
    taxMode: 'included_unitemized',
    taxRateBasisPoints: null,
    taxBase: 'goods_shipping',
    taxRounding: 'half_up',
    version: 'AAAAAAAAAAE=',
  });
  h.unmount();
});

function settingsEditor(version: string) {
  const sent: Record<string, unknown>[] = [],
    errors: Record<string, unknown> = {};
  let values: Record<string, unknown> | undefined;
  const h = digitalUiHarness(
    fileURLToPath(new URL('../src/pages/orders/orders.tsx', import.meta.url)),
    {
      '@tanstack/react-query': {
        useQueryClient: () => ({ invalidateQueries() {} }),
        useMutation: () => ({
          isPending: false,
          mutate: (value: Record<string, unknown>) => sent.push(structuredClone(value)),
        }),
      },
      'react-hook-form': {
        useForm: (options: { defaultValues: Record<string, unknown> }) => {
          values ??= { ...options.defaultValues };
          return {
            register: (name: string) => ({
              name,
              value: values![name],
              onChange: (event: { target: { value: string } }) => {
                values![name] = event.target.value;
              },
            }),
            handleSubmit: (send: (value: unknown) => unknown) => () => send({ ...values }),
            setError: (key: string, error: unknown) => {
              errors[key] = error;
            },
            formState: { errors },
          };
        },
      },
      zod: { z },
      '../../api/api': {},
      '../../components/ui': { Check: 'Check', Field: 'Field', ErrorBox: 'ErrorBox' },
      '../../components/forms/forms': { FormActions: 'FormActions' },
      '../../components/tables/admin-table': {},
      '../../features/orders/order-parcels': {},
      '../../features/orders/order-digital-delivery': {},
      '../../features/finance/credit-order-information': {},
      '../../features/orders/order-shipment': {},
      '@sayman/web-shared/components/catalog/used-condition': {},
      '@sayman/web-shared/lib/checkout/checkout-shipping.ts': display,
      '../../api/orders-client': {},
      '../../auth/admin-view-authority': {},
      '../../styles/orders/sales-order-workspace.css': {},
    },
    {},
    'export { SettingsForm };',
  );
  h.mount('SettingsForm', {
    initial: {
      id: 1,
      temporaryOrdersEnabled: false,
      chequeOrdersEnabled: false,
      reservationMinutes: 15,
      maxOpenOrdersPerCustomer: 5,
      version,
    },
    onClose() {},
  });
  const input = (name: string) =>
    uiElements(h.tree()).find((node) => node.type === 'input' && node.props.name === name)!;
  const submit = () =>
    (uiElements(h.tree()).find((node) => node.type === 'form')!.props.onSubmit as () => void)();
  return { h, sent, errors, input, submit };
}

test('actual unsaved order settings prefill60 minutes but require an explicit open-order cap before any mutation', () => {
  const x = settingsEditor('');
  assert.equal(x.input('minutes').props.value, '60');
  assert.equal(x.input('max').props.value, '');
  assert.equal(x.input('max').props.required, true);
  x.submit();
  assert.equal(x.sent.length, 0);
  assert.ok(x.errors.max);
  (x.input('max').props.onChange as (event: unknown) => void)({ target: { value: '۲' } });
  x.submit();
  assert.deepEqual(x.sent, [
    {
      temporaryOrdersEnabled: false,
      chequeOrdersEnabled: false,
      reservationMinutes: 60,
      maxOpenOrdersPerCustomer: 2,
      version: null,
    },
  ]);
  x.h.unmount();
});

test('actual saved settings preserve fetched reservation/cap/version and enforce the configurable1..10 limit', () => {
  const x = settingsEditor('AAAAAAAAAAI=');
  assert.equal(x.input('minutes').props.value, '15');
  assert.equal(x.input('max').props.value, '5');
  for (const value of ['۰', '۱۱']) {
    (x.input('max').props.onChange as (event: unknown) => void)({ target: { value } });
    x.submit();
  }
  assert.equal(x.sent.length, 0);
  (x.input('max').props.onChange as (event: unknown) => void)({ target: { value: '۳' } });
  x.submit();
  assert.equal(x.sent[0].maxOpenOrdersPerCustomer, 3);
  assert.equal(x.sent[0].reservationMinutes, 15);
  assert.equal(x.sent[0].version, 'AAAAAAAAAAI=');
  x.h.unmount();
});

test('actual admin order history renders unknown included tax and external carrier payment only for immutable flags', () => {
  const old = order2Detail();
  const current = orderDetailV2Schema.parse({
    ...old,
    shippingMode: 'postpaid',
    shippingRial: '0',
    taxRial: null,
    taxIncluded: true,
    taxBreakdownKnown: false,
    payableTotalRial: old.goodsTotalRial,
    summary: { ...old.summary, payableTotalRial: old.goodsTotalRial },
  });
  for (const order of [current, orderDetailV2Schema.parse(old)]) {
    const h = digitalUiHarness(
      fileURLToPath(new URL('../src/pages/orders/orders.tsx', import.meta.url)),
      {
        '@tanstack/react-query': {
          useQueryClient: () => ({}),
          useQuery: () => ({ isPending: false, data: order }),
          useMutation: () => ({ isPending: false }),
        },
        'react-hook-form': {},
        zod: { z },
        '../../api/api': {},
        '../../components/ui': { Field: 'Field', Busy: 'Busy', ErrorBox: 'ErrorBox' },
        '../../components/forms/forms': {},
        '../../components/tables/admin-table': { AdminTable: 'AdminTable' },
        '../../features/orders/order-parcels': {},
        '../../features/orders/order-digital-delivery': {},
        '../../features/finance/credit-order-information': {},
        '../../features/orders/order-shipment': {},
        '@sayman/web-shared/components/catalog/used-condition': {},
        '@sayman/web-shared/lib/checkout/checkout-shipping.ts': display,
        '../../api/orders-client': {},
        '../../auth/admin-view-authority': { adminViewRevision: () => 0 },
        '../../styles/orders/sales-order-workspace.css': {},
      },
      {},
      'export { OrderDetails };',
    );
    h.mount('OrderDetails', {
      summary: { ...order.summary, ownerId: 'OWNER' },
      now: Date.parse(order.summary.createdAt),
      viewerId: 'STAFF',
      inventoryReadable: false,
      inventoryWritable: false,
    });
    const text = uiText(h.tree());
    assert.equal(text.includes(display.postpaidShippingNotice('fa')), order === current);
    assert.equal(text.includes(display.postpaidShippingAmountLabel('fa')), order === current);
    assert.equal(text.includes(display.unitemizedTaxLabel('fa')), order === current);
    assert.ok(!text.includes('NaN'));
    h.unmount();
  }
});
