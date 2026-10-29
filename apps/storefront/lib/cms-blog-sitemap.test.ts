import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blogSitemapManifestSchema,
  blogSitemapPageSchema,
  blogSitemapManifests,
  blogSitemapPage,
  blogSitemapLocations,
  blogSitemapPageXml,
} from './cms-blog-sitemap.ts';
import { sitemapIndexResponse, sitemapFileResponse } from './sitemap-http.ts';
const env = {
    SHOP_DATA_MODE: 'api',
    SHOP_API_URL: 'http://api.local',
    SHOP_PUBLIC_URL: 'https://shop.example',
    SHOP_ENABLE_INDEXING: 'true',
  },
  at = '2026-10-28T03:00:00.0000000+00:00';
const catalog = (locale: 'fa' | 'en' = 'fa') => ({
  version: 1 as const,
  dataSource: 'api' as const,
  locale,
  isPreview: false,
  allowIndexing: true,
  pageSize: 1000 as const,
  productCount: '1',
  categoryCount: '1',
});
const manifest = (locale: 'fa' | 'en' = 'fa') => ({
  version: 1 as const,
  dataSource: 'api' as const,
  locale,
  isPreview: false,
  allowIndexing: true,
  pageSize: 1000 as const,
  postCount: '1',
});
const page = (locale: 'fa' | 'en' = 'fa') => ({
  version: 1 as const,
  locale,
  kind: 'blog' as const,
  page: 1,
  pageSize: 1000 as const,
  items: [{ key: 'published-guide', fa: true as const, en: true as const, lastModified: at }],
});
const fetcher: typeof fetch = async (input, init) => {
  const u = new URL(String(input)),
    locale = u.pathname.endsWith('/en') || u.pathname.includes('/en/') ? 'en' : 'fa';
  assert.equal(init?.credentials, 'omit');
  assert.equal(new Headers(init?.headers).has('Cookie'), false);
  assert.equal(new Headers(init?.headers).has('Authorization'), false);
  if (u.pathname.includes('/blog-sitemap/'))
    return Response.json(u.pathname.endsWith('/entries') ? page(locale) : manifest(locale));
  if (u.pathname.includes('/page-sitemap/'))
    return Response.json({ ...manifest(locale), postCount: undefined, pageCount: '0' });
  return Response.json(catalog(locale));
};
test('blog sitemap accepts only public keys and canonical string counts under indexing and sample guards', async () => {
  blogSitemapManifestSchema.parse(manifest());
  blogSitemapPageSchema.parse(page());
  for (const patch of [
    { postCount: 1 },
    { postCount: '01' },
    { postCount: '50000001' },
    { draftJson: 'private' },
  ])
    assert.equal(blogSitemapManifestSchema.safeParse({ ...manifest(), ...patch }).success, false);
  assert.equal(
    blogSitemapPageSchema.safeParse({
      ...page(),
      items: [{ ...page().items[0], authorEmail: 'private' }],
    }).success,
    false,
  );
  assert.deepEqual(
    await blogSitemapManifests({ ...env, SHOP_ENABLE_INDEXING: 'false' }, [catalog()], async () => {
      throw Error('Must not call API');
    }),
    [],
  );
  assert.deepEqual(
    await blogSitemapManifests(env, [{ ...catalog(), isPreview: true }], async () => {
      throw Error('Must not call API');
    }),
    [],
  );
  assert.deepEqual(blogSitemapLocations('https://shop.example', [catalog()], [manifest()]), [
    'https://shop.example/sitemap-fa-blog-1.xml',
  ]);
  const xml = blogSitemapPageXml(
    'https://shop.example',
    'fa',
    [manifest(), manifest('en')],
    page(),
  );
  assert.match(xml, /https:\/\/shop.example\/fa\/blog\/published-guide/);
  assert.match(xml, /hreflang="en"/);
});
test('combined native sitemap index and blog files use only the trusted origin and retain independent catalogue files', async () => {
  const request = new Request('https://attacker.example/sitemap.xml', {
      headers: { Cookie: 'private=1', Authorization: 'Bearer private' },
    }),
    index = await sitemapIndexResponse(request, env, fetcher);
  assert.equal(index.status, 200);
  const xml = await index.text();
  assert.match(xml, /https:\/\/shop.example\/sitemap-fa-blog-1.xml/);
  assert.match(xml, /https:\/\/shop.example\/sitemap-en-blog-1.xml/);
  assert.doesNotMatch(xml, /attacker/);
  const file = await sitemapFileResponse(request, 'en', 'blog-1.xml', env, fetcher);
  assert.equal(file.status, 200);
  assert.match(await file.text(), /\/en\/blog\/published-guide/);
  for (const name of ['blog-0.xml', 'blog-01.xml', 'blog-50001.xml', 'blog-2.xml'])
    assert.equal((await sitemapFileResponse(request, 'fa', name, env, fetcher)).status, 404);
  let blogCalls = 0;
  const site = await sitemapFileResponse(request, 'fa', 'site.xml', env, async (url, init) => {
    if (String(url).includes('blog-sitemap')) {
      blogCalls++;
      throw Error('Blog down');
    }
    return fetcher(url, init);
  });
  assert.equal(site.status, 200);
  assert.equal(blogCalls, 0);
});
test('missing blog API cookies malformed keys and cross-locale replies fail closed without a partial index', async () => {
  const request = new Request('https://shop.example/sitemap.xml');
  for (const bad of [
    () => new Response(null, { status: 404 }),
    () => Response.json({ ...manifest(), privateActor: 'must-not-leak' }),
    () => Response.json(manifest(), { headers: { 'Set-Cookie': 'forbidden=1' } }),
  ]) {
    const result = await sitemapIndexResponse(request, env, async (url, init) =>
      String(url).includes('/blog-sitemap/') ? bad() : fetcher(url, init),
    );
    assert.equal(result.status, 503);
    assert.match(result.headers.get('Cache-Control') ?? '', /no-store/);
    assert.doesNotMatch(await result.text(), /<sitemap/);
  }
  await assert.rejects(blogSitemapPage(env, 'fa', 1, async () => Response.json(page('en'))));
  await assert.rejects(
    blogSitemapPage(
      env,
      'fa',
      1,
      async () =>
        new Response(' '.repeat(524289), { headers: { 'Content-Type': 'application/json' } }),
    ),
  );
});
