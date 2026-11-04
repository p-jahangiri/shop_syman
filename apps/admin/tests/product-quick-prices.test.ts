import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  digitalUiHarness,
  uiElements,
  uiText,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
import * as model from '../src/features/catalog/product-editor-model.ts';

test('quick prices display localized amounts without creating changes, then send exact rial with both versions', async () => {
  const material = [
    'Dialog',
    'DialogTitle',
    'DialogContent',
    'DialogActions',
    'Button',
    'Alert',
    'Stack',
    'IconButton',
    'Typography',
    'CircularProgress',
  ];
  let sent: string | undefined;
  let closed = false;
  const harness = digitalUiHarness(
    fileURLToPath(new URL('../src/features/catalog/product-quick-prices.tsx', import.meta.url)),
    {
      ...Object.fromEntries(material.map((name) => ['@mui/material/' + name, name])),
      '@mui/material/useMediaQuery': () => false,
      '@tanstack/react-query': {},
      '../../api/api': {},
      './product-variants-table': { ProductVariantsTable: 'ProductVariantsTable' },
      '../../api/contracts/catalog/product-workspace-contract': {},
      './product-editor-model': model,
      '../../hooks/use-product-command': {
        useProductCommand: () => ({
          blocked: false,
          send: async (_kind: string, _id: string, request: unknown) => {
            sent = JSON.stringify(request);
          },
        }),
      },
    },
    {},
    'export { QuickPricesForm };',
  );
  harness.mount('QuickPricesForm', {
    viewerId: 'viewer',
    onClose: () => {
      closed = true;
    },
    value: {
      detail: {
        archived: false,
        product: {
          id: 'product-id',
          version: 'product-version',
          translations: [{ locale: 'fa', name: 'کالای نمونه' }],
          attributes: [],
          media: [],
          purchaseMethods: [],
          creditPlans: [],
          variants: [
            {
              id: 'variant-id',
              version: 'variant-version',
              attributes: [],
              purchaseMethods: [],
              priceRial: '9007199254740991',
              isActive: true,
            },
          ],
        },
      },
      fields: { fields: [] },
    },
  });
  const table = () =>
    uiElements(harness.tree()).find((node) => node.type === 'ProductVariantsTable')!;
  const save = () =>
    uiElements(harness.tree()).find(
      (node) => node.type === 'Button' && uiText(node) === 'ثبت تغییرات قیمت',
    )!;
  const [row] = table().props.rows as model.ProductVariantDraft[];
  assert.equal(row.price, '۹۰۰٬۷۱۹٬۹۲۵٬۴۷۴٬۰۹۹٫۱');
  assert.equal(save().props.disabled, true);
  (
    table().props.onChange as (
      fn: (rows: model.ProductVariantDraft[]) => model.ProductVariantDraft[],
    ) => void
  )((rows) => rows.map((item) => ({ ...item, price: '۹۰۰٬۷۱۹٬۹۲۵٬۴۷۴٬۰۹۹٫۲' })));
  await harness.settle();
  assert.equal(save().props.disabled, false);
  (save().props.onClick as () => void)();
  await harness.settle();
  assert.ok(closed);
  assert.deepEqual(JSON.parse(sent!), {
    productId: 'product-id',
    version: 'product-version',
    lines: [
      {
        variantId: 'variant-id',
        version: 'variant-version',
        priceRial: '9007199254740992',
        compareAtRial: null,
        isActive: true,
      },
    ],
  });
  harness.unmount();
});
