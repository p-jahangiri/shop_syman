import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  digitalUiHarness,
  uiElements,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
import { storefrontSnapshot } from '../lib/data/fixtures.ts';
import { localeFormat, translate } from '../lib/navigation/i18n.ts';
import * as purchasing from '../lib/catalog/purchasing.ts';
import * as commerce from '@sayman/web-shared/lib/shared/commerce.ts';

test('quick add and video reflect the selected variant and active store settings', async () => {
  const snapshot = structuredClone(storefrontSnapshot);
  const source = snapshot.products[0];
  const method = { ...snapshot.purchaseMethods[0], enabled: true };
  const variant = { ...source.variants[0], id: 'first', stock: 2, purchaseMethodIds: [method.id] };
  const other = { ...variant, id: 'second', purchaseMethodIds: [] };
  const product = {
    ...source,
    purchaseMethodIds: [method.id],
    variants: [variant, other],
    videos: [{ url: 'https://store.example/clip.mp4', variantId: variant.id }],
  };
  snapshot.purchaseMethods = [method];
  const added: string[] = [];
  const h = digitalUiHarness(
    fileURLToPath(new URL('../components/catalog/product-card.tsx', import.meta.url)),
    {
      '@/components/navigation/locale-provider': {
        useStorefront: () => snapshot,
        useI18n: () => ({
          locale: 'fa',
          ...localeFormat('fa'),
          t: <T>(value: T, variables?: unknown[]) => translate(value, 'fa', variables),
        }),
      },
      '@/components/navigation/localized-link': { __esModule: true, default: 'Link' },
      '@/components/media/content-image': { __esModule: true, default: 'Image' },
      '@/lib/catalog/purchasing': purchasing,
      '@sayman/web-shared/lib/shared/commerce.ts': commerce,
      '../providers/shop-provider': {
        useShop: () => ({
          wishlist: [],
          compare: [],
          ready: true,
          add: (id: string) => added.push(id),
        }),
      },
      './product-presentation.css': {},
    },
  );
  h.mount('ProductCard', { product, variantId: variant.id });
  await h.settle();
  const elements = () => uiElements(h.tree());
  const quickAdd = () =>
    elements().find((node) => node.type === 'button' && node.props.className === 'add-circle');
  const video = () => elements().find((node) => node.props.className === 'product-card-video');
  const details = () =>
    elements().find((node) => node.props.className === 'add-circle product-card-details');
  const actions = elements().find((node) => node.props.className === 'product-card-actions');
  const image = elements().find((node) => node.props.className === 'product-picture');
  assert.ok(actions && image);
  assert.equal(
    uiElements(actions.props.children).filter((node) => node.type === 'button').length,
    2,
  );
  assert.ok(!uiElements(image.props.children).some((node) => node.type === 'button'));
  assert.equal(quickAdd()?.props.disabled, false);
  (quickAdd()!.props.onClick as () => void)();
  assert.deepEqual(added, [variant.id]);
  assert.equal(video()?.props.href, `/product/${product.slug}?variant=first#product-videos`);
  assert.ok(!elements().some((node) => node.props.className === 'color-dots'));

  h.rerender({ product, variantId: other.id });
  await h.settle();
  assert.equal(quickAdd(), undefined);
  assert.equal(video(), undefined);
  assert.equal(details()?.props.href, `/product/${product.slug}?variant=second`);

  method.enabled = false;
  h.rerender({ product, variantId: variant.id });
  await h.settle();
  assert.equal(quickAdd(), undefined);
  assert.ok(video());
  h.unmount();
});
