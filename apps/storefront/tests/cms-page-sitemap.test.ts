import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cmsSitemapManifestSchema,
  cmsSitemapPageSchema,
  cmsSitemapManifests,
  cmsSitemapPage,
  cmsSitemapIndex,
  cmsSitemapPageXml,
} from '../lib/content/cms-page-sitemap.ts';
import { sitemapIndexResponse, sitemapFileResponse } from '../lib/seo/sitemap-http.ts';
import type { SitemapManifest } from '../lib/seo/sitemap-projection.ts';
const env = {
  SHOP_DATA_MODE: 'api',
  SHOP_API_URL: 'http://127.0.0.1:5181',
  SHOP_PUBLIC_URL: 'https://shop.example',
  SHOP_ENABLE_INDEXING: 'true',
};
const catalog = (locale: 'fa' | 'en' = 'fa'): SitemapManifest => ({
  version: 1,
  dataSource: 'api',
  locale,
  isPreview: false,
  allowIndexing: true,
  pageSize: 1000,
  productCount: '1001',
  categoryCount: '1',
});
const manifest = (locale: 'fa' | 'en' = 'fa') => ({
  version: 1 as const,
  dataSource: 'api' as const,
  locale,
  isPreview: false,
  allowIndexing: true,
  pageSize: 1000 as const,
  pageCount: '1001',
});
const page = (locale: 'fa' | 'en' = 'fa', n = 1) => ({
  version: 1 as const,
  locale,
  kind: 'pages' as const,
  page: n,
  pageSize: 1000 as const,
  items: [
    {
      key: 'guide',
      fa: true as const,
      en: true as const,
      lastModified: '2026-10-27T16:00:00.1234567+00:00',
    },
  ],
});
test('CMS projection stays strict and never accepts content graphs, identity or numeric counts', () => {
  cmsSitemapManifestSchema.parse(manifest());
  cmsSitemapPageSchema.parse(page());
  for (const patch of [
    { pageCount: 1001 },
    { pageCount: '01' },
    { pageCount: '50000001' },
    { content: {} },
    { ownerId: 'private' },
  ])
    assert.equal(cmsSitemapManifestSchema.safeParse({ ...manifest(), ...patch }).success, false);
  for (const item of [
    { ...page().items[0], bodyJson: 'private' },
    { ...page().items[0], key: '../account' },
    { ...page().items[0], fa: false },
    { ...page().items[0], lastModified: '2026-10-27T16:00:00+03:30' },
  ])
    assert.equal(cmsSitemapPageSchema.safeParse({ ...page(), items: [item] }).success, false);
  assert.equal(
    cmsSitemapPageSchema.safeParse({ ...page(), items: [...page().items, ...page().items] })
      .success,
    false,
  );
});
test('disabled environments, catalogue preview and locale opt-out never call the CMS API', async () => {
  for (const [environment, allowed] of [
    [{ ...env, SHOP_ENABLE_INDEXING: 'false' }, [catalog()]],
    [env, [{ ...catalog(), isPreview: true }]],
    [env, [{ ...catalog(), allowIndexing: false }]],
    [env, []],
  ] as const) {
    let calls = 0;
    assert.deepEqual(
      await cmsSitemapManifests(environment, [...allowed], async () => {
        calls++;
        throw Error('Do not read');
      }),
      [],
    );
    assert.equal(calls, 0);
  }
});
test('CMS gate intersects catalogue and published locale permission without adding a disabled alternate', async () => {
  const all = await cmsSitemapManifests(env, [catalog(), catalog('en')], async (url) =>
    Response.json({
      ...manifest(String(url).endsWith('/en') ? 'en' : 'fa'),
      allowIndexing: !String(url).endsWith('/en'),
    }),
  );
  assert.equal(all.length, 1);
  const xml = cmsSitemapPageXml(env.SHOP_PUBLIC_URL, 'fa', all, page());
  assert.match(xml, /fa\/pages\/guide/);
  assert.doesNotMatch(xml, /hreflang="en"/);
  assert.match(xml, /<lastmod>2026-10-27T16:00:00.1234567\+00:00<\/lastmod>/);
  assert.deepEqual(
    await cmsSitemapManifests(env, [catalog()], async () =>
      Response.json({ ...manifest(), isPreview: true }),
    ),
    [],
  );
});
test('combined index includes all CMS partitions and enforces one shared 50000-file cap', () => {
  const xml = cmsSitemapIndex(
    env.SHOP_PUBLIC_URL,
    [catalog(), catalog('en')],
    [manifest(), manifest('en')],
  );
  assert.equal((xml.match(/<sitemap>/g) ?? []).length, 12);
  assert.match(xml, /sitemap-fa-pages-2\.xml/);
  assert.match(xml, /sitemap-en-products-2\.xml/);
  assert.doesNotMatch(xml, /pages-3\.xml|\/sitemaps\//);
  assert.throws(() =>
    cmsSitemapIndex(env.SHOP_PUBLIC_URL, [catalog()], [{ ...manifest(), pageCount: '50000000' }]),
  );
  assert.throws(() => cmsSitemapIndex(env.SHOP_PUBLIC_URL, [catalog()], [manifest('en')]));
});
test('requests are bounded anonymous uncached and bound to locale and page, with fatal UTF8 decoding', async () => {
  const value = await cmsSitemapPage(env, 'en', 2, async (url, options) => {
    assert.equal(String(url), 'http://127.0.0.1:5181/api/content/page-sitemap/en/entries?page=2');
    assert.equal(options?.credentials, 'omit');
    assert.equal(options?.cache, 'no-store');
    assert.equal(options?.redirect, 'error');
    const h = new Headers(options?.headers);
    assert.equal(h.has('Cookie'), false);
    assert.equal(h.has('Authorization'), false);
    return Response.json(page('en', 2));
  });
  assert.equal(value.locale, 'en');
  await assert.rejects(cmsSitemapPage(env, 'fa', 1, async () => Response.json(page('en'))));
  await assert.rejects(
    cmsSitemapPage(
      env,
      'fa',
      1,
      async () =>
        new Response(new Uint8Array([0xc3, 0x28]), {
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  );
  await assert.rejects(
    cmsSitemapPage(
      env,
      'fa',
      1,
      async () =>
        new Response('x'.repeat(524289), { headers: { 'Content-Type': 'application/json' } }),
    ),
  );
  await assert.rejects(
    cmsSitemapPage({ ...env, SHOP_API_URL: 'https://upstream.example/path' }, 'fa', 1, async () =>
      Response.json(page()),
    ),
  );
});
const fetcher: typeof fetch = async (url) => {
  const u = new URL(String(url)),
    locale = u.pathname.includes('/en/') || u.pathname.endsWith('/en') ? 'en' : 'fa';
  if (u.pathname.includes('/blog-sitemap/'))
    return Response.json({
      version: 1,
      dataSource: 'api',
      locale,
      isPreview: false,
      allowIndexing: true,
      pageSize: 1000,
      postCount: '0',
    });
  if (u.pathname.endsWith('/entries'))
    return Response.json(page(locale, Number(u.searchParams.get('page'))));
  return Response.json(u.pathname.includes('/page-sitemap/') ? manifest(locale) : catalog(locale));
};
test('native XML handlers include CMS and canonical origin while keeping catalogue files independent', async () => {
  const req = new Request('https://attacker.example/sitemap.xml', {
      headers: { Cookie: 'private=1', Authorization: 'Bearer private' },
    }),
    index = await sitemapIndexResponse(req, env, fetcher);
  assert.equal(index.status, 200);
  const xml = await index.text();
  assert.match(xml, /https:\/\/shop.example\/sitemap-fa-pages-1\.xml/);
  assert.doesNotMatch(xml, /attacker/);
  const response = await sitemapFileResponse(req, 'fa', 'pages-2.xml', env, fetcher);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /\/fa\/pages\/guide/);
  for (const file of ['pages-0.xml', 'pages-01.xml', 'pages-50001.xml', 'pages-3.xml'])
    assert.equal((await sitemapFileResponse(req, 'fa', file, env, fetcher)).status, 404, file);
  let cmsCalls = 0;
  const site = await sitemapFileResponse(req, 'fa', 'site.xml', env, async (url) => {
    if (String(url).includes('page-sitemap')) {
      cmsCalls++;
      throw Error('CMS down');
    }
    return Response.json(catalog(String(url).includes('/en/') ? 'en' : 'fa'));
  });
  assert.equal(site.status, 200);
  assert.equal(cmsCalls, 0);
});
test('CMS source failure or mixed private data produces whole-response 503 rather than a partial index', async () => {
  const req = new Request('https://shop.example/sitemap.xml');
  for (const bad of [
    () => new Response('', { status: 503 }),
    () => Response.json({ ...manifest(), draftJson: 'private' }),
  ]) {
    const response = await sitemapIndexResponse(req, env, async (url) => {
      const u = new URL(String(url)),
        locale = u.pathname.includes('/en/') || u.pathname.endsWith('/en') ? 'en' : 'fa';
      if (u.pathname.includes('/blog-sitemap/'))
        return Response.json({
          version: 1,
          dataSource: 'api',
          locale,
          isPreview: false,
          allowIndexing: true,
          pageSize: 1000,
          postCount: '0',
        });
      return u.pathname.includes('/page-sitemap/') ? bad() : Response.json(catalog(locale));
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Retry-After'), '60');
    assert.match(response.headers.get('Cache-Control') ?? '', /no-store/);
    assert.doesNotMatch(await response.text(), /<sitemap/);
  }
});
