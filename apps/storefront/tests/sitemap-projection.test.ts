import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sitemapManifests,
  sitemapPage,
  sitemapManifestSchema,
  sitemapPageSchema,
  sitemapIndex,
  sitemapPageXml,
  type SitemapManifest,
} from '../lib/seo/sitemap-projection.ts';
import { sitemapIndexResponse, sitemapFileResponse } from '../lib/seo/sitemap-http.ts';
const environment = {
  SHOP_DATA_MODE: 'api',
  SHOP_API_URL: 'http://127.0.0.1:5181',
  SHOP_PUBLIC_URL: 'https://shop.example',
  SHOP_ENABLE_INDEXING: 'true',
};
const manifest = (locale: 'fa' | 'en' = 'fa'): SitemapManifest => ({
  version: 1,
  dataSource: 'api',
  locale,
  isPreview: false,
  allowIndexing: true,
  pageSize: 1000,
  productCount: '1001',
  categoryCount: '1',
});
const fetchManifests: typeof fetch = async (url) =>
  Response.json(manifest(String(url).includes('/en/') ? 'en' : 'fa'));
test('disabled deployments and preview do not read any API or publish sitemap URLs', async () => {
  for (const env of [
    { ...environment, SHOP_DATA_MODE: 'preview' },
    { ...environment, SHOP_PUBLIC_URL: 'http://127.0.0.1:3105' },
    { ...environment, SHOP_ENABLE_INDEXING: 'false' },
  ]) {
    let calls = 0;
    const result = await sitemapManifests(env, async () => {
      calls++;
      throw new Error('must not read');
    });
    assert.deepEqual(result, []);
    assert.equal(calls, 0);
  }
  assert.deepEqual(
    await sitemapManifests(environment, async (url) =>
      Response.json({ ...manifest(String(url).includes('/en/') ? 'en' : 'fa'), isPreview: true }),
    ),
    [],
  );
});
test('manifests are strict, retain count boundaries and never accept graph or financial data', () => {
  assert.equal(sitemapManifestSchema.parse(manifest()).productCount, '1001');
  for (const patch of [
    { productCount: 1001 },
    { productCount: '50000001' },
    { productCount: '01' },
    { pageSize: 50000 },
    { products: [] },
    { authSettings: {} },
    { dataSource: 'fixture' },
  ])
    assert.equal(sitemapManifestSchema.safeParse({ ...manifest(), ...patch }).success, false);
});
test('index pages include every product/category partition at the 1000-row boundary', async () => {
  const all = await sitemapManifests(environment, fetchManifests);
  const xml = sitemapIndex(environment.SHOP_PUBLIC_URL, all);
  assert.equal((xml.match(/<sitemap>/g) ?? []).length, 8);
  assert.match(xml, /https:\/\/shop.example\/sitemap-fa-products-2\.xml/);
  assert.match(xml, /categories-1\.xml/);
  assert.doesNotMatch(xml, /products-3\.xml|lastmod|checkout|account|\/sitemaps\//);
  const overflow = [{ ...manifest(), productCount: '50000000' }, manifest('en')];
  assert.throws(() => sitemapIndex(environment.SHOP_PUBLIC_URL, overflow));
});
test('only allowed locales with real translations receive reciprocal self-referencing alternatives', () => {
  const page = sitemapPageSchema.parse({
    version: 1,
    locale: 'fa',
    kind: 'products',
    page: 1,
    pageSize: 1000,
    items: [
      { key: 'both-languages', fa: true, en: true },
      { key: 'persian-only', fa: true, en: false },
    ],
  });
  const xml = sitemapPageXml(environment.SHOP_PUBLIC_URL, 'fa', [manifest(), manifest('en')], page);
  assert.match(xml, /hreflang="fa" href="https:\/\/shop.example\/fa\/product\/both-languages"/);
  assert.match(xml, /hreflang="en" href="https:\/\/shop.example\/en\/product\/both-languages"/);
  assert.doesNotMatch(xml, /en\/product\/persian-only/);
  const restricted = sitemapPageXml(environment.SHOP_PUBLIC_URL, 'fa', [manifest()], page);
  assert.doesNotMatch(restricted, /hreflang="en"/);
});
test('unsafe keys, duplicate URLs, wrong locale flags and private fields reject the entire page', () => {
  const page = {
    version: 1,
    locale: 'fa',
    kind: 'products',
    page: 1,
    pageSize: 1000,
    items: [{ key: 'phone', fa: true, en: true }],
  };
  for (const patch of [
    { items: [{ key: '../account', fa: true, en: true }] },
    { items: [page.items[0], page.items[0]] },
    { items: [{ key: 'phone', fa: false, en: true }] },
    { items: [{ ...page.items[0], priceRial: '1' }] },
    { page: 0 },
  ])
    assert.equal(sitemapPageSchema.safeParse({ ...page, ...patch }).success, false);
});
test('public requests never forward credentials and match response locale/kind/page', async () => {
  const value = await sitemapPage(environment, 'en', 'categories', 2, async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:5181/api/catalog/en/sitemap/categories?page=2');
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).has('Authorization'), false);
    return Response.json({
      version: 1,
      locale: 'en',
      kind: 'categories',
      page: 2,
      pageSize: 1000,
      items: [{ key: 'c1', fa: true, en: true }],
    });
  });
  assert.equal(value.items[0].key, 'c1');
  await assert.rejects(
    sitemapPage(environment, 'en', 'products', 1, async () =>
      Response.json({ ...value, kind: 'products', page: 2 }),
    ),
  );
  await assert.rejects(sitemapManifests(environment, async () => Response.json(manifest('fa'))));
});
test('service failure is retryable and never produces a partial or fixture sitemap', async () => {
  const result = await sitemapIndexResponse(
    new Request('https://evil.example/sitemap.xml'),
    environment,
    async () => Response.json({ private: 'must not be returned' }, { status: 503 }),
  );
  assert.equal(result.status, 503);
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
  assert.equal(result.headers.get('Retry-After'), '60');
  assert.deepEqual(await result.json(), { title: 'sitemap_unavailable' });
});
test('HTTP file validation refuses private paths and out-of-range files before any page read', async () => {
  for (const file of ['products-0.xml', 'products-01.xml', 'products-50001.xml', 'private.xml']) {
    let calls = 0;
    const result = await sitemapFileResponse(
      new Request('https://shop.example'),
      'fa',
      file,
      environment,
      async () => {
        calls++;
        throw new Error();
      },
    );
    assert.equal(result.status, 404);
    assert.equal(calls, 0);
  }
  const missing = await sitemapFileResponse(
    new Request('https://shop.example'),
    'fa',
    'products-3.xml',
    environment,
    fetchManifests,
  );
  assert.equal(missing.status, 404);
});
test('XML URLs use only the trusted origin, escape category queries and omit made-up dates', async () => {
  const response = await sitemapFileResponse(
    new Request('https://evil.example/sitemaps/fa/site.xml'),
    'fa',
    'site.xml',
    environment,
    fetchManifests,
  );
  const xml = await response.text();
  assert.match(xml, /https:\/\/shop.example\/fa/);
  assert.doesNotMatch(xml, /evil\.example|lastmod|priority|changefreq/);
  assert.equal(response.headers.get('Content-Type'), 'application/xml; charset=utf-8');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});
