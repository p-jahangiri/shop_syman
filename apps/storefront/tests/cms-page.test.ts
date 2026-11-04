import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cmsPageContentSchema,
  cmsPageInputSchema,
  cmsPageDetailSchema,
  cmsPageHistorySchema,
  cmsPageResultSchema,
  cmsPublicPageSchema,
  publishedCmsPageContent,
  readCmsPageResult,
  type CmsPageCommand,
} from '@sayman/web-shared/lib/content/cms-page-contract.ts';
import { CmsPageJournal } from '@sayman/web-shared/lib/content/cms-page-journal.ts';
import { fetchCmsPage } from '../lib/content/cms-page-fetch.ts';
const id = 'a'.repeat(32),
  cmd = 'b'.repeat(32),
  rev = 'c'.repeat(32),
  version = 'AAAAAAAAAAA=';
const content = () => ({
  fa: {
    title: 'نمونه 🎮',
    description: '<b>متن ساده</b>',
    blocks: [
      {
        id,
        kind: 'Text' as const,
        visibility: 'All' as const,
        heading: 'عنوان',
        text: 'متن\nخط دوم',
      },
    ],
  },
  en: {
    title: 'Sample',
    description: '',
    blocks: [
      { id, kind: 'Callout' as const, visibility: 'Mobile' as const, heading: '', text: 'Sample' },
    ],
  },
});
const command = (): CmsPageCommand => ({
  id: cmd,
  pageId: null,
  input: { action: 'Create', slug: 'sample-page', isDemo: true, content: content() },
});
const result = () => ({
  commandId: cmd,
  pageId: id,
  slug: 'sample-page',
  version,
  action: 'Create',
  publication: 0,
  revisionId: null,
  publishedRevisionId: null,
  draftHash: 'd'.repeat(64),
  replayed: false,
});
const page = () => ({
  id,
  slug: 'sample-page',
  locale: 'fa',
  revisionId: rev,
  publishedAt: '2026-10-27T16:00:00.1234567+00:00',
  isDemo: true,
  ...content().fa,
});
test('page publication requires both real language bodies while draft may be incomplete', () => {
  assert.ok(cmsPageContentSchema.safeParse(content()).success);
  publishedCmsPageContent(content());
  const empty = { ...content(), en: { title: '', description: '', blocks: [] } };
  assert.ok(cmsPageContentSchema.safeParse(empty).success);
  assert.throws(() => publishedCmsPageContent(empty));
});
test('approved blocks reject executable targets, unknown fields, duplicate IDs and invalid Unicode', () => {
  assert.ok(
    cmsPageContentSchema.safeParse({
      ...content(),
      fa: {
        ...content().fa,
        blocks: [
          {
            id,
            kind: 'Image',
            visibility: 'All',
            image: '/media/catalog/' + id + '/card.webp',
            alt: 'Catalog image',
          },
        ],
      },
    }).success,
  );
  for (const block of [
    { ...content().fa.blocks[0], kind: 'Html' },
    { ...content().fa.blocks[0], html: '<script>' },
    { id, kind: 'Image', visibility: 'All', image: 'https://evil/a.png', alt: 'x' },
    {
      id,
      kind: 'Links',
      visibility: 'All',
      heading: '',
      links: [{ label: 'bad', href: '//evil' }],
    },
    { ...content().fa.blocks[0], text: '\ud800' },
  ])
    assert.equal(
      cmsPageContentSchema.safeParse({ ...content(), fa: { ...content().fa, blocks: [block] } })
        .success,
      false,
    );
  assert.equal(
    cmsPageContentSchema.safeParse({
      ...content(),
      fa: { ...content().fa, blocks: [...content().fa.blocks, ...content().fa.blocks] },
    }).success,
    false,
  );
});
test('write commands require deliberate publication and cannot rename the stable address', () => {
  assert.ok(cmsPageInputSchema.safeParse(command().input).success);
  for (const v of [
    { action: 'Publish', version },
    { action: 'Publish', version, confirmed: true, content: content() },
    { action: 'Save', version, content: content(), slug: 'renamed' },
    { action: 'Restore', version, confirmed: true },
    { action: 'Create', slug: 'sample', isDemo: true, content: content(), paid: true },
  ])
    assert.equal(cmsPageInputSchema.safeParse(v).success, false);
});
test('private/public decoders reject draft and actor leakage, inconsistent publication and non-UTC time', () => {
  cmsPublicPageSchema.parse(page());
  for (const p of [
    { ...page(), draft: content() },
    { ...page(), actorId: 'private' },
    { ...page(), publishedAt: '2026-10-27T16:00:00+03:30' },
  ])
    assert.equal(cmsPublicPageSchema.safeParse(p).success, false);
  assert.equal(
    cmsPageDetailSchema.safeParse({
      id,
      slug: 'sample-page',
      isDemo: true,
      version,
      publication: 1,
      publishedRevisionId: rev,
      draft: content(),
      published: null,
    }).success,
    false,
  );
});
test('historical receipt belongs to exact command, page, action and publication transition', () => {
  readCmsPageResult(result(), command());
  for (const r of [
    { ...result(), commandId: rev },
    { ...result(), slug: 'other' },
    { ...result(), publication: 1 },
    { ...result(), action: 'Publish' },
  ])
    assert.throws(() => readCmsPageResult(r, command()));
  assert.equal(
    cmsPageResultSchema.safeParse({ ...result(), version: 'AAAAAAAAAAB=' }).success,
    false,
  );
});
test('page history is descending contiguous and cursor names the last visible publication', () => {
  cmsPageHistorySchema.parse({
    items: [
      { id, publication: 2, action: 'Publish', at: page().publishedAt },
      { id: rev, publication: 1, action: 'Unpublish', at: page().publishedAt },
    ],
    nextBefore: null,
  });
  assert.equal(
    cmsPageHistorySchema.safeParse({
      items: [
        { id, publication: 3, action: 'Publish', at: page().publishedAt },
        { id: rev, publication: 1, action: 'Restore', at: page().publishedAt },
      ],
      nextBefore: null,
    }).success,
    false,
  );
});
test('RAM journal freezes exact input, keeps ambiguity sticky and discards another actor response', () => {
  const j = new CmsPageJournal();
  j.bind('a');
  const c = command();
  j.begin('a', c);
  c.input.content!.fa.title = 'changed after send';
  assert.equal(j.snapshot('a')!.command.input.content!.fa.title, 'نمونه 🎮');
  const saved = j.snapshot('a')!.command;
  j.interrupt();
  j.fail('a', saved, 409, 'conflict');
  assert.equal(j.snapshot('a')!.state, 'unknown');
  assert.throws(() => j.begin('a', command()));
  assert.deepEqual(j.retry('a'), saved);
  j.fail('a', saved, 503, 'network');
  assert.equal(j.finish('a', saved, { ...result(), replayed: true }), true);
  j.clear('a');
  assert.equal(j.snapshot('a'), null);
  j.begin('a', saved);
  j.bind('b');
  assert.equal(j.finish('a', saved, result()), false);
  assert.equal(j.snapshot('b'), null);
});
test('public fetch is anonymous bounded uncached and binds both locale and slug', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (url, options) => {
    calls++;
    assert.equal(String(url), 'http://127.0.0.1:5080/api/content/pages/fa/sample-page');
    assert.equal(options?.cache, 'no-store');
    assert.equal(options?.credentials, 'omit');
    assert.equal(options?.redirect, 'error');
    return Response.json(page());
  };
  const env = { SHOP_DATA_MODE: 'api', SHOP_API_URL: 'http://127.0.0.1:5080' };
  assert.equal((await fetchCmsPage('sample-page', 'fa', env, fetcher)).status, 'ready');
  assert.equal(
    (await fetchCmsPage('sample-page', 'en', env, async () => Response.json(page()))).status,
    'unavailable',
  );
  assert.equal(
    (await fetchCmsPage('sample-page', 'fa', env, async () => new Response('', { status: 404 })))
      .status,
    'missing',
  );
  assert.equal((await fetchCmsPage('../escape', 'fa', env, fetcher)).status, 'missing');
  assert.equal(calls, 1);
  assert.equal(
    (
      await fetchCmsPage(
        'sample-page',
        'fa',
        env,
        async () =>
          new Response('x'.repeat(131073), { headers: { 'Content-Type': 'application/json' } }),
      )
    ).status,
    'unavailable',
  );
  assert.equal(
    (
      await fetchCmsPage(
        'sample-page',
        'fa',
        env,
        async () =>
          new Response(new Uint8Array([0xc3, 0x28]), {
            headers: { 'Content-Type': 'application/json' },
          }),
      )
    ).status,
    'unavailable',
  );
});
