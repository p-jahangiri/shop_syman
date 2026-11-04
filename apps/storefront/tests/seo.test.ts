import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storefrontSnapshot } from '../lib/data/fixtures.ts';
import type { StorefrontSnapshot } from '@sayman/web-shared/lib/shared/types.ts';
import {
  canIndex,
  publicOrigin,
  pageMetadata,
  catalogTarget,
  jsonLd,
  productStructuredData,
  sitemapEntries,
  publicMedia,
  languageUrls,
} from '../lib/seo/seo.ts';
const env = { SHOP_PUBLIC_URL: 'https://shop.example', SHOP_ENABLE_INDEXING: 'true' };
function live(locale: 'fa' | 'en' = 'fa'): StorefrontSnapshot {
  return {
    ...structuredClone(storefrontSnapshot),
    dataSource: 'api',
    isPreview: false,
    locale,
    site: {
      ...storefrontSnapshot.site,
      seo: { title: 'Custom title', description: 'Custom description', allowIndexing: true },
    },
  };
}
test('indexing requires all independent deployment and published-content gates', () => {
  const s = live();
  assert.equal(canIndex(s, env), true);
  for (const draft of [
    { ...s, isPreview: true },
    { ...s, dataSource: 'fixture' as const },
    { ...s, site: { ...s.site, seo: { allowIndexing: false } } },
  ])
    assert.equal(canIndex(draft, env), false);
  for (const config of [
    {},
    { ...env, SHOP_ENABLE_INDEXING: 'false' },
    { ...env, SHOP_PUBLIC_URL: 'http://127.0.0.1:3000' },
    { ...env, SHOP_PUBLIC_URL: 'https://localhost' },
    { ...env, SHOP_PUBLIC_URL: 'https://192.168.1.12' },
  ])
    assert.equal(canIndex(s, config), false);
});
test('canonical URLs use only a trusted origin and remove noncanonical facets and variant IDs', () => {
  for (const url of [
    'javascript:alert(1)',
    'https://secret:password@shop.example',
    'https://shop.example/path',
    'https://shop.example/?token=secret',
    'http://shop.example',
    '//evil.example',
    'invalid',
  ])
    assert.equal(publicOrigin({ SHOP_PUBLIC_URL: url }), undefined);
  const s = live();
  const target = catalogTarget(s, {
    category: s.categories[0].key,
    q: 'private search',
    sort: 'price',
  });
  const m = pageMetadata(
    s,
    'en',
    target.path,
    'Title',
    'Description',
    { noindex: target.noindex },
    env,
  );
  assert.equal(
    m.alternates?.canonical,
    `https://shop.example/en/catalog?category=${s.categories[0].key}`,
  );
  assert.deepEqual(m.robots, { index: false, follow: true });
  assert.equal(JSON.stringify(m).includes('private search'), false);
  assert.equal(catalogTarget(s, { category: ['a', 'b'] }).noindex, true);
  assert.equal(pageMetadata(s, 'fa', '/', 'Title', 'Description', {}, {}).alternates, undefined);
});
test('public metadata uses CMS content, locales and only unsigned public images', () => {
  const m = pageMetadata(
    live(),
    'fa',
    '/',
    'Custom title',
    'Custom description',
    { image: '/media/share.jpg' },
    env,
  );
  assert.equal((m.title as { absolute: string }).absolute, 'Custom title | سایمان');
  assert.equal(m.description, 'Custom description');
  assert.equal(m.alternates?.languages?.en, 'https://shop.example/en');
  for (const path of [
    '//evil.example/x.jpg',
    'https://secret:password@media.example/a.jpg',
    'https://media.example/a.jpg?signature=secret',
    '/media/x.jpg?token=secret',
    '/api/credit/private.jpg',
  ])
    assert.equal(publicMedia(path, env.SHOP_PUBLIC_URL), undefined);
});
test('CMS metadata can advertise only its verified published translation without invented alternate pages', () => {
  const metadata = pageMetadata(
    live('en'),
    'en',
    '/pages/english-only',
    'Published page',
    'Only the English translation is published.',
    { availableLocales: ['en'] },
    env,
  );
  assert.deepEqual(metadata.alternates?.languages, {
    en: 'https://shop.example/en/pages/english-only',
  });
  assert.equal(metadata.alternates?.canonical, 'https://shop.example/en/pages/english-only');
  assert.deepEqual(
    metadata.openGraph && 'alternateLocale' in metadata.openGraph
      ? metadata.openGraph.alternateLocale
      : undefined,
    [],
  );
  assert.deepEqual(languageUrls(env.SHOP_PUBLIC_URL, '/blog/guide', ['fa', 'fa']), {
    fa: 'https://shop.example/fa/blog/guide',
    'x-default': 'https://shop.example/fa/blog/guide',
  });
  assert.deepEqual(languageUrls(env.SHOP_PUBLIC_URL, '/blog/guide', []), {});
});
test('product structured data preserves Int64 money, stock, current locale and contains no invented reviews', () => {
  const s = live();
  const p = s.products[0];
  p.variants[0].priceRial = '9223372036854775807';
  p.variants[0].stock = 0;
  const data = productStructuredData(s, p, 'en', env);
  const offers = data[0].offers as {
    price: string;
    priceCurrency: string;
    availability: string;
    url: string;
  }[];
  assert.equal(offers[0].price, '9223372036854775807');
  assert.equal(offers[0].priceCurrency, 'IRR');
  assert.equal(offers[0].availability, 'https://schema.org/OutOfStock');
  assert.equal(offers[0].url.startsWith('https://shop.example/en/product/'), true);
  assert.equal(data[0].aggregateRating, undefined);
  assert.equal(
    (data[0].offers as { itemCondition: string }[])[0].itemCondition,
    'https://schema.org/NewCondition',
  );
  assert.equal(data[1]['@type'], 'BreadcrumbList');
  assert.deepEqual(productStructuredData({ ...s, isPreview: true }, p, 'fa', env), []);
  assert.deepEqual(productStructuredData(s, p, 'fa', {}), []);
});
test('product schema honors public deployment and published indexing gates, including localhost', () => {
  const snapshot = live();
  for (const configuration of [
    {},
    { ...env, SHOP_ENABLE_INDEXING: 'false' },
    { ...env, SHOP_PUBLIC_URL: 'http://127.0.0.1:3000' },
    { ...env, SHOP_PUBLIC_URL: 'https://localhost' },
  ])
    assert.deepEqual(
      productStructuredData(snapshot, snapshot.products[0], 'fa', configuration),
      [],
    );
  snapshot.site.seo!.allowIndexing = false;
  assert.deepEqual(productStructuredData(snapshot, snapshot.products[0], 'fa', env), []);
});
test('used-device offers declare their actual condition without inventing ratings or health claims', () => {
  const snapshot = live();
  const product = snapshot.products[0];
  product.variants[0].usedCondition = {
    inspectionId: '11111111111111111111111111111111',
    technicalState: 'unknown',
    batteryState: 'unknown',
    batteryHealthPercent: null,
    screenState: 'unknown',
    bodyState: 'unknown',
    repairState: 'unknown',
    notesFa: '',
    notesEn: '',
    inspectedAt: '2026-10-29T00:00:00Z',
  };
  const data = productStructuredData(snapshot, product, 'fa', env);
  assert.equal(
    (data[0].offers as { itemCondition: string }[])[0].itemCondition,
    'https://schema.org/UsedCondition',
  );
  assert.equal(data[0].aggregateRating, undefined);
  assert.equal(JSON.stringify(data).includes('batteryHealth'), false);
});
test('CMS script delimiters and Unicode separators cannot escape the JSON-LD script', () => {
  const input = { name: '</script><img src=x onerror=alert(1)> & \u2028\u2029' };
  const output = jsonLd(input);
  assert.equal(/[<>&\u2028\u2029]/.test(output), false);
  assert.deepEqual(JSON.parse(output), input);
});
test('sitemap includes only eligible localized public canonical pages, without made-up dates or private routes', () => {
  const fa = live(),
    en = live('en');
  const entries = sitemapEntries([fa, en], env);
  assert.ok(entries.length > 10);
  assert.equal(
    entries.some((e) => /account|cart|checkout|wishlist|\?q=|variant=/.test(e.url)),
    false,
  );
  assert.equal(
    entries.some((e) => e.lastModified),
    false,
  );
  assert.equal(entries[0].alternates?.languages?.en, 'https://shop.example/en');
  en.site.seo = { allowIndexing: false };
  assert.equal(
    sitemapEntries([fa, en], env).some((e) => e.url.includes('/en')),
    false,
  );
  assert.deepEqual(sitemapEntries([{ ...fa, isPreview: true }], env), []);
});
