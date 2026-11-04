import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  digitalUiHarness,
  uiElements,
  uiText,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
import * as model from '../src/features/catalog/product-editor-model.ts';
import * as contract from '../src/api/contracts/catalog/product-workspace-contract.ts';
import * as fieldErrors from '../src/features/catalog/product-field-errors.ts';
const material = [
  'Dialog',
  'DialogTitle',
  'DialogContent',
  'DialogActions',
  'Box',
  'Chip',
  'Tabs',
  'Tab',
  'Stack',
  'Button',
  'IconButton',
  'Alert',
  'Typography',
  'MenuItem',
  'Checkbox',
  'FormControlLabel',
  'CircularProgress',
];
const fields = [
  'name',
  'category',
  'brand',
  'slug',
  'description',
  'translation',
  'specifications',
  'sku',
  'color',
  'axes',
  'price',
  'discount',
  'warranty',
  'purchaseMethods',
  'images',
  'videos',
].map((key, index) => ({
  key,
  label: key,
  help: 'راهنمای ' + key,
  visible: true,
  sortOrder: index,
  visibilityLocked: [
    'name',
    'category',
    'brand',
    'specifications',
    'sku',
    'axes',
    'price',
    'purchaseMethods',
    'images',
  ].includes(key),
}));
const data = {
  categories: [
    {
      id: 'phones',
      version: 'AAAAAAAAAAE=',
      slug: 'phones',
      imageUrl: '/products/phone-green.svg',
      isActive: true,
      sortOrder: 0,
      translations: [{ locale: 'fa' as const, name: 'گوشی', description: '' }],
      attributes: [],
    },
  ],
  brands: [
    {
      id: 'brand',
      version: 'AAAAAAAAAAE=',
      name: 'Brand',
      slug: 'brand',
      logoUrl: '',
      isActive: true,
    },
  ],
  attributes: [],
  products: [],
};
function setup() {
  const calls: { kind: string; body: unknown }[] = [],
    events: string[] = [];
  const command = {
    blocked: false,
    attempt: null as { phase: string } | null,
    error: undefined as Error | undefined,
    setError() {},
    send: async (kind: string, _id: string, body: unknown) => {
      calls.push({ kind, body });
      return { kind, productId: 'saved' };
    },
  };
  const h = digitalUiHarness(
    fileURLToPath(new URL('../src/features/catalog/product-editor.tsx', import.meta.url)),
    {
      ...Object.fromEntries(material.map((name) => ['@mui/material/' + name, name])),
      '@mui/material/useMediaQuery': () => false,
      '@tanstack/react-query': {},
      '../../api/api': { ApiError: class ApiError extends Error {} },
      '../media/media': { ImageEditor: 'ImageEditor' },
      './product-videos': { ProductVideos: 'ProductVideos' },
      './product-editor-fields': {
        ProductTextField: 'ProductTextField',
        ProductField: 'ProductField',
        ProductAttributeField: 'ProductAttributeField',
      },
      './product-variants-table': { ProductVariantsTable: 'ProductVariantsTable' },
      './product-variant-generator': { ProductVariantGenerator: 'ProductVariantGenerator' },
      './product-quick-create': { ProductQuickCreate: 'ProductQuickCreate' },
      './product-form-settings': { ProductFormSettings: 'ProductFormSettings' },
      '../../hooks/use-product-command': { useProductCommand: () => command },
      './product-field-errors': fieldErrors,
      '../../api/contracts/catalog/product-workspace-contract': contract,
      './product-editor-model': model,
      '../../types/types': { nameOf: () => 'نام' },
    },
    {
      requestAnimationFrame: (callback: () => void) => callback(),
      cancelAnimationFrame() {},
      window: { addEventListener() {}, removeEventListener() {} },
    },
    'export {ProductEditorForm};',
  );
  h.mount('ProductEditorForm', {
    data,
    methods: [],
    plans: [],
    viewerId: 'staff',
    configuration: { schemaVersion: 1, version: null, fields },
    videos: [],
    onClose: () => events.push('closed'),
    onSaved: () => events.push('saved'),
  });
  function node(type: string, path?: string) {
    const root = uiElements(h.tree()),
      all = [
        ...root,
        ...root
          .filter((v) => v.type === 'ProductField' && typeof v.props.children === 'function')
          .flatMap((v) =>
            uiElements(
              (v.props.children as (id: string, label: string) => unknown)('field-id', 'label-id'),
            ),
          ),
      ],
      result = [...all, ...all.flatMap((v) => uiElements(v.props.action))].find(
        (n) => n.type === type && (!path || n.props.path === path || uiText(n) === path),
      );
    assert.ok(result, type + ': ' + path);
    return result;
  }
  return {
    h,
    calls,
    command,
    events,
    node,
    async edit(path: string, value: string) {
      (node('ProductTextField', path).props.onChange as (event: unknown) => void)({
        target: { value },
      });
      await h.settle();
    },
    async tab(value: string) {
      (node('Tabs').props.onChange as (event: unknown, value: string) => void)(null, value);
      await h.settle();
    },
    async save(label = 'ذخیرهٔ پیش‌نویس') {
      await (node('Button', label).props.onClick as () => Promise<void>)();
      await h.settle();
    },
  };
}
test('invalid product never sends a command and marks each affected field locally', async () => {
  const x = setup();
  await x.save();
  assert.equal(x.calls.length, 0);
  for (const path of ['nameFa', 'categoryId', 'brandId'])
    assert.equal(typeof x.node('ProductTextField', path).props.error, 'string');
  assert.ok(uiText(x.h.tree()).includes('فیلد نیاز به اصلاح دارد'));
  x.h.unmount();
});
test('a valid model draft can be saved without inventing price, variants or stock', async () => {
  const x = setup();
  await x.edit('nameFa', 'مدل جدید');
  await x.edit('categoryId', 'phones');
  await x.edit('brandId', 'brand');
  await x.save();
  assert.equal(x.calls.length, 1);
  const input = x.calls[0].body as { product: Record<string, unknown> };
  assert.deepEqual(Array.from(input.product.variants as unknown[]), []);
  assert.equal(input.product.status, 'Draft');
  assert.ok(!('onHand' in input.product));
  assert.ok(!('stock' in input.product));
  assert.deepEqual(x.events, ['saved']);
  x.h.unmount();
});
test('quick category creation preserves the entered product and selects the created category', async () => {
  const x = setup();
  await x.edit('nameFa', 'اطلاعات حفظ‌شده');
  const action = x.node('ProductTextField', 'categoryId').props.helpAction as {
    onClick: () => void;
  };
  action.onClick();
  await x.h.settle();
  const quick = x.node('ProductQuickCreate');
  (quick.props.onCreated as (id: string) => void)('new-category');
  await x.h.settle();
  assert.equal(x.node('ProductTextField', 'nameFa').props.value, 'اطلاعات حفظ‌شده');
  assert.equal(x.node('ProductTextField', 'categoryId').props.value, 'new-category');
  x.h.unmount();
});
test('an unresolved command disables save and preserves the draft instead of sending a fresh request', async () => {
  const x = setup();
  await x.edit('nameFa', 'پیش‌نویس من');
  x.command.blocked = true;
  x.command.attempt = { phase: 'unknown' };
  x.h.rerender();
  await x.h.settle();
  assert.equal(x.node('Button', 'ذخیرهٔ پیش‌نویس').props.disabled, true);
  await x.save();
  assert.equal(x.calls.length, 0);
  assert.equal(x.node('ProductTextField', 'nameFa').props.value, 'پیش‌نویس من');
  x.h.unmount();
});

test('overlapping image and video work keeps the draft locked until both uploads finish', async () => {
  const x = setup();
  await x.edit('nameFa', 'پیش‌نویس رسانه');
  await x.edit('categoryId', 'phones');
  await x.edit('brandId', 'brand');
  async function busy(type: 'ImageEditor' | 'ProductVideos', value: boolean) {
    (x.node(type).props.onBusy as (next: boolean) => void)(value);
    await x.h.settle();
  }
  await busy('ImageEditor', true);
  assert.equal(x.node('ProductVideos').props.disabled, true);
  assert.equal(x.node('Button', 'ذخیرهٔ پیش‌نویس').props.disabled, true);
  await busy('ProductVideos', true);
  assert.equal(x.node('ImageEditor').props.disabled, true);
  await busy('ImageEditor', false);
  assert.equal(x.node('Button', 'ذخیرهٔ پیش‌نویس').props.disabled, true);
  await x.save();
  assert.equal(x.calls.length, 0);
  await busy('ProductVideos', false);
  assert.equal(x.node('Button', 'ذخیرهٔ پیش‌نویس').props.disabled, false);
  assert.equal(x.node('ProductTextField', 'nameFa').props.value, 'پیش‌نویس رسانه');
  x.h.unmount();
});

test('switching editor sections retains the draft and publish validation returns to the hidden section with an error', async () => {
  const x = setup();
  await x.edit('nameFa', 'کالای آزمایشی');
  await x.edit('categoryId', 'phones');
  await x.edit('brandId', 'brand');
  await x.tab('sales');
  await x.edit('status', 'Published');
  await x.save('ذخیره و انتشار کالا');
  assert.equal(x.calls.length, 0);
  assert.equal(x.node('Tabs').props.value, 'variants');
  assert.equal(x.node('ProductVariantsTable').props.active, true);
  assert.ok(
    uiElements(x.h.tree()).some(
      (n) => n.type === 'Tab' && n.props.value === 'media' && String(n.props.label).includes('خطا'),
    ),
  );
  await x.tab('identity');
  assert.equal(x.node('ProductTextField', 'nameFa').props.value, 'کالای آزمایشی');
  assert.equal(x.node('ProductVariantsTable').props.active, false);
  x.h.unmount();
});
