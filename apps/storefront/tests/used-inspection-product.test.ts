import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  digitalUiHarness,
  uiElements,
  uiText,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
import { storefrontSnapshot } from '../lib/data/fixtures.ts';
import { localeFormat, translate } from '../lib/navigation/i18n.ts';
import * as media from '@sayman/web-shared/lib/media/media-paths.ts';
import * as gallery from '../lib/catalog/used-inspection-photos.ts';
import * as purchasing from '../lib/catalog/purchasing.ts';
import * as phoneConfigurations from '../lib/catalog/phone-configurations.ts';
import * as commerce from '@sayman/web-shared/lib/shared/commerce.ts';
import { usedConditionSchema } from '@sayman/web-shared/lib/catalog/used-condition-contract.ts';

const photo = (asset: string, label: string) => ({
  url: `/media/catalog/${asset.repeat(32)}/card.webp`,
  altFa: label + ' فارسی',
  altEn: label + ' English',
});
const report = (inspectionId: string, photos: ReturnType<typeof photo>[]) =>
  usedConditionSchema.parse({
    inspectionId: inspectionId.repeat(32),
    technicalState: 'unknown',
    batteryState: 'unknown',
    batteryHealthPercent: null,
    screenState: 'unknown',
    bodyState: 'unknown',
    repairState: 'unknown',
    notesFa: '',
    notesEn: '',
    inspectedAt: '2026-10-30T10:00:00Z',
    photos,
  });
for (const locale of ['fa', 'en'] as const)
  test(`actual ${locale} product gallery resets image and zoom synchronously across selected units and immutable inspection revisions`, async () => {
    const snapshot = structuredClone(storefrontSnapshot),
      source = snapshot.products[0],
      base = source.variants[0];
    const a = report('a', [photo('a', 'A1'), photo('b', 'A2')]),
      b = report('b', [photo('c', 'B1')]);
    let product = {
      ...source,
      videos: [{ url: '/media/videos/' + 'a'.repeat(32) + '/clip.mp4', variantId: 'USED_B' }],
      variants: [
        { ...base, id: 'USED_A', label: 'Device A', usedCondition: a },
        { ...base, id: 'USED_B', label: 'Device B', usedCondition: b },
      ],
    };
    const h = digitalUiHarness(
      fileURLToPath(new URL('../components/catalog/product-detail.tsx', import.meta.url)),
      {
        '@sayman/web-shared/components/catalog/used-condition': {
          UsedConditionReport: 'UsedConditionReport',
        },
        './product-reviews': { ProductReviews: 'ProductReviews' },
        './product-detail-presentation.css': {},
        './phone-variant-picker': {
          PhoneColorOptions: 'PhoneColorOptions',
          PhoneConfigurationOptions: 'PhoneConfigurationOptions',
        },
        '@/lib/catalog/phone-configurations': phoneConfigurations,
        '@sayman/web-shared/lib/media/media-paths.ts': media,
        '@/lib/catalog/used-inspection-photos': gallery,
        '@/components/navigation/locale-provider': {
          useI18n: () => ({
            locale,
            ...localeFormat(locale),
            t: <T>(value: T, variables?: unknown[]) => translate(value, locale, variables),
          }),
          useStorefront: () => snapshot,
        },
        '@/components/navigation/localized-link': { __esModule: true, default: 'Link' },
        '@/components/media/content-image': { __esModule: true, default: 'Image' },
        '@/lib/catalog/purchasing': purchasing,
        '@sayman/web-shared/lib/shared/commerce.ts': commerce,
        '../providers/shop-provider': {
          useShop: () => ({
            wishlist: [],
            compare: [],
            cartBusy: false,
            loadError: false,
            ready: true,
          }),
        },
        './product-card': { ProductGrid: 'ProductGrid' },
        './recently-viewed': { RecentlyViewed: 'RecentlyViewed' },
        '../shared/ui': { Button: 'Button', Modal: 'Modal', groupNavigation() {} },
      },
      {
        URL,
        navigator: {},
        window: {
          location: new URL(`http://127.0.0.1:3000/${locale}/product/synthetic?tracking=example`),
          history: { replaceState() {} },
        },
      },
    );
    h.mount('ProductDetail', { product, initialVariantId: 'USED_A' });
    await h.settle();
    assert.ok(uiElements(h.tree()).some((node) => node.props.className === 'purchase-disclaimer'));
    snapshot.dataSource = 'api';
    h.rerender({ product, initialVariantId: 'USED_A' });
    await h.settle();
    assert.ok(!uiElements(h.tree()).some((node) => node.props.className === 'purchase-disclaimer'));
    const main = () =>
        uiElements(h.tree()).find((n) => n.type === 'Image' && n.props.fetchPriority === 'high')!,
      modal = () =>
        uiElements(h.tree()).find((n) => n.type === 'Modal' && n.props.title === product.name)!,
      scopedVideo = () =>
        uiElements(h.tree()).find((node) => node.props.url === product.videos[0].url),
      button = (match: (n: ReturnType<typeof uiElements>[number]) => boolean) => {
        const found = uiElements(h.tree()).find((n) => n.type === 'button' && match(n));
        assert.ok(found);
        return found;
      };
    assert.equal(main().props.src, a.photos![0].url);
    assert.equal(main().props.alt, locale === 'fa' ? a.photos![0].altFa : a.photos![0].altEn);
    assert.ok(
      uiText(h.tree()).includes(
        locale === 'fa' ? 'ویدیوی تنوع‌های دیگر' : 'Videos for other variants',
      ),
    );
    assert.equal(scopedVideo(), undefined);
    assert.ok(uiElements(h.tree()).some((node) => node.props.href === '#product-videos'));
    (
      button((n) =>
        uiElements(n.props.children).some(
          (image) =>
            image.type === 'Image' &&
            image.props.src === media.publicImageVariant(a.photos![1].url, 'thumb'),
        ),
      ).props.onClick as () => void
    )();
    await h.settle();
    assert.equal(main().props.src, a.photos![1].url);
    (button((n) => n.props.className === 'gallery-main').props.onClick as () => void)();
    await h.settle();
    assert.equal(modal().props.open, true);
    (
      button((n) => n.props.role === 'radio' && uiText(n).includes('Device B')).props
        .onClick as () => void
    )();
    await h.settle();
    assert.equal(main().props.src, b.photos![0].url);
    assert.equal(modal().props.open, false);
    await (
      button((n) => /کپی لینک این تنوع|Copy variant link/.test(String(n.props['aria-label']))).props
        .onClick as () => Promise<void>
    )();
    await h.settle();
    const shareLink = uiElements(h.tree()).find((n) => n.props.className === 'product-share-url');
    assert.equal(
      shareLink?.props.value,
      `http://127.0.0.1:3000/${locale}/product/synthetic?variant=USED_B`,
    );
    assert.ok(scopedVideo());
    const details = { open: false };
    const videoSection = uiElements(h.tree()).find((node) => node.props.id === 'product-videos');
    const videoLink = uiElements(h.tree()).find((node) => node.props.href === '#product-videos');
    assert.ok(videoSection && videoLink);
    (videoSection.props.ref as { current: unknown }).current = { querySelector: () => details };
    (videoLink.props.onClick as () => void)();
    assert.equal(details.open, true);
    assert.ok(
      !uiText(h.tree()).includes(
        locale === 'fa' ? 'ویدیوی تنوع‌های دیگر' : 'Videos for other variants',
      ),
    );
    (button((n) => n.props.className === 'gallery-main').props.onClick as () => void)();
    await h.settle();
    const next = report('c', [photo('d', 'B revised')]);
    product = {
      ...product,
      variants: product.variants.map((v) =>
        v.id === 'USED_B' ? { ...v, usedCondition: next } : v,
      ),
    };
    h.rerender({ product, initialVariantId: 'USED_A' });
    assert.equal(main().props.src, next.photos![0].url);
    assert.equal(modal().props.open, false);
    product = {
      ...product,
      variants: product.variants.map((v) =>
        v.id === 'USED_B'
          ? { ...v, usedCondition: { ...next, inspectionId: 'd'.repeat(32), photos: [] } }
          : v,
      ),
    };
    h.rerender({ product, initialVariantId: 'USED_A' });
    assert.equal(main().props.src, product.images?.[0] ?? product.image);
    assert.match(uiText(h.tree()), locale === 'fa' ? /تصاویر عمومی مدل/ : /General model images/);
    assert.equal(b.photos![0].url, photo('c', 'B1').url);
    h.unmount();
  });
