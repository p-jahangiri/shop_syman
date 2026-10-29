import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cmsBlogContentSchema,
  publishedCmsBlogContent,
  cmsBlogPostCommandSchema,
  readCmsBlogPostResult,
  cmsPublicBlogPostSchema,
  cmsBlogPublicListSchema,
  emptyCmsBlogContent,
} from './cms-blog-post-contract.ts';
import { CmsBlogPostJournal } from './cms-blog-post-journal.ts';
import { fetchBlogPost, fetchBlogList } from './cms-blog-fetch.ts';
import { blogPostStructuredData } from './blog-seo.ts';
import { languageSwitchTarget } from './language-switch-target.ts';
import { storefrontSnapshot } from './fixtures.ts';
import { jsonLd } from './seo.ts';
const id = (n: number) => n.toString(16).padStart(32, '0'),
  v = 'AAAAAAAAAAE=',
  v2 = 'AAAAAAAAAAI=',
  at = '2026-10-28T03:00:00.0000000Z',
  hash = 'a'.repeat(64);
const content = () => ({
  body: {
    fa: {
      title: 'مقالهٔ نمونه',
      description: 'نمونه',
      blocks: [
        {
          id: id(8),
          kind: 'Text' as const,
          visibility: 'All' as const,
          heading: '',
          text: 'متن نمونه',
        },
      ],
    },
    en: {
      title: 'Sample article',
      description: 'Sample',
      blocks: [
        {
          id: id(9),
          kind: 'Text' as const,
          visibility: 'All' as const,
          heading: '',
          text: 'Sample text',
        },
      ],
    },
  },
  authorKind: 'Organization' as const,
  bylineFa: 'تیم نمونه',
  bylineEn: 'Sample team',
  cover: null,
  coverAltFa: null,
  coverAltEn: null,
  tags: [
    { slug: 'a-b', nameFa: 'الف', nameEn: 'AB' },
    { slug: 'guide', nameFa: 'راهنما', nameEn: 'Guide' },
  ],
});
const previous = () => ({
  id: id(1),
  slug: 'sample-article',
  isDemo: true,
  version: v,
  publication: 1,
  publishedRevisionId: id(2),
  draft: content(),
  published: content(),
  firstPublishedAt: at,
  draftHash: hash,
});
const command = () =>
  cmsBlogPostCommandSchema.parse({
    id: id(3),
    postId: id(1),
    input: { action: 'Publish', version: v, confirmed: true },
    previous: previous(),
  });
const result = () => ({
  commandId: id(3),
  postId: id(1),
  slug: 'sample-article',
  version: v2,
  action: 'Publish',
  publication: 2,
  revisionId: id(4),
  publishedRevisionId: id(4),
  draftHash: hash,
  replayed: false,
});
const post = () => ({
  schemaVersion: 1 as const,
  id: id(1),
  slug: 'sample-article',
  locale: 'en' as const,
  revisionId: id(2),
  firstPublishedAt: at,
  publishedAt: at,
  isDemo: false,
  title: 'Sample article',
  description: 'Sample',
  authorKind: 'Organization' as const,
  byline: 'Sample team',
  cover: null,
  coverAlt: null,
  tags: [{ slug: 'guide', name: 'Guide' }],
  blocks: content().body.en.blocks,
});
const summary = () => {
  const { schemaVersion: _, blocks: __, ...s } = post();
  return s;
};
const list = () => ({
  schemaVersion: 1,
  locale: 'en',
  tag: null,
  items: [summary()],
  nextCursor: null,
});
const response = (value: unknown, status = 200) =>
    Response.json(value, { status, headers: { 'X-Sayman-Blog': '1' } }),
  env = { SHOP_DATA_MODE: 'api', SHOP_API_URL: 'http://api.local' };
test('blog publication requires explicit bilingual public author and approved cover/tags while an empty draft is valid', () => {
  cmsBlogContentSchema.parse(emptyCmsBlogContent());
  publishedCmsBlogContent(content());
  assert.throws(() => publishedCmsBlogContent(emptyCmsBlogContent()));
  for (const patch of [
    { authorKind: 'Robot' },
    { authorKind: null },
    { bylineFa: 'private\nname' },
    { cover: '/products/example.svg' },
    { tags: [content().tags[1], content().tags[0]] },
    { tags: [content().tags[0], content().tags[0]] },
    { actorId: 'private-identity' },
  ])
    assert.equal(cmsBlogContentSchema.safeParse({ ...content(), ...patch }).success, false);
  assert.equal(
    cmsPublicBlogPostSchema.safeParse({ ...post(), email: 'must-not-leak@example.test' }).success,
    false,
  );
});
test('article receipt binds actor journal review, exact version, publication and retained draft hash', () => {
  readCmsBlogPostResult(result(), command());
  for (const patch of [
    { commandId: id(7) },
    { postId: id(7) },
    { version: v },
    { publication: 3 },
    { slug: 'other-article' },
    { draftHash: 'b'.repeat(64) },
    { revisionId: id(2), publishedRevisionId: id(2) },
  ])
    assert.throws(() => readCmsBlogPostResult({ ...result(), ...patch }, command()));
  const j = new CmsBlogPostJournal(),
    c = command();
  j.bind('editor');
  j.begin('editor', c);
  j.interrupt();
  j.fail('editor', c, 404, 'not_found');
  assert.equal(j.snapshot('editor')?.state, 'unknown');
  assert.equal(j.snapshot('other'), null);
  assert.equal(j.finish('editor', c, { ...result(), replayed: true }), true);
  j.bind(null);
  assert.equal(j.snapshot('editor'), null);
  assert.equal(j.finish('editor', c, result()), false);
});
test('public list is bounded, locale/filter bound and ordered with full UTC tick precision', () => {
  cmsBlogPublicListSchema.parse(list());
  assert.equal(cmsBlogPublicListSchema.safeParse({ ...list(), tag: 'unknown' }).success, false);
  assert.equal(
    cmsBlogPublicListSchema.safeParse({ ...list(), items: [{ ...summary(), locale: 'fa' }] })
      .success,
    false,
  );
  assert.equal(
    cmsBlogPublicListSchema.safeParse({ ...list(), items: [summary(), summary()] }).success,
    false,
  );
  assert.equal(
    cmsBlogPublicListSchema.safeParse({ ...list(), nextCursor: 'token' }).success,
    false,
  );
  cmsBlogPublicListSchema.parse({
    ...list(),
    items: [{ ...summary(), id: id(3), firstPublishedAt: '2026-10-28T03:00:00+00:00' }, summary()],
  });
});
test('blog fetch recognizes only the installed resource and bounds anonymous responses without fallback', async () => {
  let seen = false;
  assert.equal(
    (
      await fetchBlogPost('sample-article', 'en', env, async (url, init) => {
        seen = true;
        assert.equal(String(url), 'http://api.local/api/content/blog/en/sample-article');
        assert.equal(init?.credentials, 'omit');
        assert.equal(init?.redirect, 'error');
        assert.equal(init?.cache, 'no-store');
        assert.deepEqual([...new Headers(init?.headers).keys()], ['accept']);
        return response(post());
      })
    ).status,
    'ready',
  );
  assert.ok(seen);
  assert.equal(
    (
      await fetchBlogPost('sample-article', 'en', env, async () =>
        response({ title: 'not_found' }, 404),
      )
    ).status,
    'missing',
  );
  for (const bad of [
    new Response(null, { status: 404 }),
    response({ ...post(), locale: 'fa' }),
    Response.json(post(), { headers: { 'X-Sayman-Blog': '1', 'Set-Cookie': 'forbidden=1' } }),
    new Response(' '.repeat(131073), {
      headers: { 'X-Sayman-Blog': '1', 'Content-Type': 'application/json' },
    }),
  ])
    assert.equal(
      (await fetchBlogPost('sample-article', 'en', env, async () => bad)).status,
      'unavailable',
    );
  assert.equal(
    (
      await fetchBlogPost('sample-article', 'en', { SHOP_DATA_MODE: 'preview' }, async () =>
        response(post()),
      )
    ).status,
    'unavailable',
  );
  assert.equal(
    (await fetchBlogList('en', null, null, env, async () => response(list()))).status,
    'ready',
  );
  assert.equal(
    (await fetchBlogList('fa', null, null, env, async () => response(list()))).status,
    'unavailable',
  );
  assert.equal(
    (
      await fetchBlogList('en', ['guide'], null, env, async () => {
        throw Error('Must not fetch invalid filter');
      })
    ).status,
    'invalid',
  );
  assert.equal(
    (
      await fetchBlogList('en', null, 'token', env, async () =>
        response({ title: 'cms_blog_cursor_expired_conflict' }, 409),
      )
    ).status,
    'expired',
  );
});
test('blog language switch restarts only its locale-bound public list cursor', () => {
  assert.equal(
    languageSwitchTarget('/fa/blog', '?tag=guide&cursor=opaque', '#articles', 'en'),
    '/en/blog?tag=guide#articles',
  );
  assert.equal(
    languageSwitchTarget('/fa/blog/sample', '?x=1', '#body', 'en'),
    '/en/blog/sample?x=1#body',
  );
  assert.equal(
    languageSwitchTarget('/fa/catalog', '?cursor=original&q=phone', '', 'en'),
    '/en/catalog?cursor=original&q=phone',
  );
});
test('BlogPosting uses explicit author and retained dates under the existing indexing gate and escapes script delimiters', () => {
  const snapshot = structuredClone(storefrontSnapshot);
  snapshot.dataSource = 'api';
  snapshot.isPreview = false;
  snapshot.site.seo = { ...snapshot.site.seo, allowIndexing: true };
  const seo = { SHOP_PUBLIC_URL: 'https://shop.example', SHOP_ENABLE_INDEXING: 'true' },
    p = { ...post(), byline: 'Team </script><script>not-code</script>' };
  const data = blogPostStructuredData(snapshot, p, 'en', seo);
  assert.equal(data.length, 1);
  assert.deepEqual(data[0].author, { '@type': 'Organization', name: p.byline });
  assert.equal(data[0].datePublished, at);
  assert.equal(data[0].dateModified, at);
  assert.equal(data[0].url, 'https://shop.example/en/blog/sample-article');
  assert.ok(!jsonLd(data).includes('</script>'));
  assert.deepEqual(blogPostStructuredData(snapshot, { ...p, isDemo: true }, 'en', seo), []);
  assert.deepEqual(blogPostStructuredData({ ...snapshot, isPreview: true }, p, 'en', seo), []);
  assert.deepEqual(blogPostStructuredData(snapshot, p, 'fa', seo), []);
});
