import test from 'node:test';
import assert from 'node:assert/strict';
import {
  redirectSource,
  validRedirectTarget,
  redirectInputSchema,
  redirectResolutionSchema,
  readRedirectResult,
  type RedirectCommand,
} from '@sayman/web-shared/lib/content/cms-redirect-contract.ts';
import { fetchCmsRedirect } from '../lib/content/cms-redirect-fetch.ts';
import { CmsRedirectJournal } from '@sayman/web-shared/lib/content/cms-redirect-journal.ts';
const source = '/fa/pages/old-phone',
  id = 'a'.repeat(32),
  rule = {
    version: 1,
    dataSource: 'api',
    sourcePath: source,
    found: true,
    isDemo: false,
    targetPath: '/fa/catalog',
    status: 301,
  };
const command: RedirectCommand = {
  id,
  redirectId: null,
  input: {
    action: 'Create',
    sourcePath: source,
    isDemo: true,
    targetPath: '/fa/catalog',
    status: 302,
  },
};
const result = {
  commandId: id,
  redirectId: 'b'.repeat(32),
  sourcePath: source,
  isDemo: true,
  version: 'AAAAAAAAAAE=',
  action: 'Create',
  publication: 0,
  revisionId: null,
  publishedRevisionId: null,
  draft: { targetPath: '/fa/catalog', status: 302 },
  replayed: false,
};
test('redirect paths are exact public same-locale routes and no status is invented', () => {
  for (const p of [
    '/fa/pages/a\n',
    '/fa/cart',
    '/fa/pages/a?x=1',
    '/fa/pages/%61',
    '/fa/pages/a/',
    '//evil.test',
  ])
    assert.equal(redirectSource.safeParse(p).success, false, p);
  assert.equal(validRedirectTarget(source, '/fa/moments'), true);
  for (const p of ['/en/catalog', source, 'https://evil.test', '/fa/catalog#x', '/fa/support\n'])
    assert.equal(validRedirectTarget(source, p), false, p);
  const draft = redirectInputSchema.parse({ action: 'Create', sourcePath: source, isDemo: false });
  assert.equal(draft.status, undefined);
  assert.equal(redirectInputSchema.safeParse({ ...draft, status: 307 }).success, false);
  assert.equal(redirectInputSchema.safeParse({ ...draft, status: '301' }).success, false);
  assert.equal(redirectInputSchema.safeParse({ ...draft, paid: true }).success, false);
  assert.equal(
    redirectInputSchema.safeParse({ action: 'Publish', version: 'AAAAAAAAAAE=' }).success,
    false,
  );
});
test('public DTO has no private fields or inconsistent absence and receipts bind exact intent', () => {
  assert.equal(redirectResolutionSchema.safeParse(rule).success, true);
  for (const r of [
    { ...rule, actor: 'x' },
    { ...rule, found: false },
    { ...rule, targetPath: '/en/catalog' },
    { ...rule, status: 307 },
    { ...rule, sourcePath: source + '\n' },
  ])
    assert.equal(redirectResolutionSchema.safeParse(r).success, false);
  assert.equal(readRedirectResult(result, command).redirectId, result.redirectId);
  for (const r of [
    { ...result, isDemo: false },
    { ...result, sourcePath: '/fa/pages/another' },
    { ...result, draft: { targetPath: '/fa/support', status: 302 } },
    { ...result, draft: { targetPath: '/fa/catalog', status: 301 } },
  ])
    assert.throws(() => readRedirectResult(r, command));
});
test('anonymous bounded resolver validates actual path and skips all ineligible/private routes', async () => {
  let calls = 0;
  const fetcher = (async (url, init) => {
    calls++;
    assert.equal(
      String(url),
      'http://127.0.0.1:5080/api/content/redirects/resolve?path=' + encodeURIComponent(source),
    );
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.headers, undefined);
    return new Response(JSON.stringify(rule), { headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  const env = { SHOP_DATA_MODE: 'api', SHOP_API_URL: 'http://127.0.0.1:5080' };
  assert.equal((await fetchCmsRedirect(source, env, fetcher)).status, 'ready');
  for (const path of [
    '/fa/account',
    '/fa/cart',
    '/fa/catalog',
    '/fa',
    '/sitemap.xml',
    '/fa/product/a/',
  ])
    assert.equal((await fetchCmsRedirect(path, env, fetcher)).status, 'skip');
  assert.equal(calls, 1);
  assert.equal(
    (await fetchCmsRedirect('/en/product/a', { SHOP_DATA_MODE: 'preview' }, fetcher)).status,
    'skip',
  );
  assert.equal(calls, 1);
});
test('API failure, redirects, schema, oversize and fatal UTF8 never become absence', async () => {
  const env = { SHOP_API_URL: 'http://127.0.0.1:5080' };
  for (const response of [
    () => new Response('{}', { status: 404 }),
    () => new Response('{}', { status: 503 }),
    () =>
      new Response(JSON.stringify({ ...rule, sourcePath: '/fa/pages/other' }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    () => new Response('x'.repeat(4097), { headers: { 'Content-Type': 'application/json' } }),
    () =>
      new Response(new Uint8Array([0xc3, 0x28]), {
        headers: { 'Content-Type': 'application/json' },
      }),
    () => new Response('{}', { headers: { 'Content-Type': 'text/html' } }),
  ])
    assert.equal(
      (await fetchCmsRedirect(source, env, (async () => response()) as typeof fetch)).status,
      'unavailable',
    );
  const absent = { ...rule, found: false, isDemo: false, targetPath: null, status: null };
  const load = await fetchCmsRedirect(
    source,
    env,
    (async () =>
      new Response(JSON.stringify(absent), {
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch,
  );
  assert.equal(load.status, 'ready');
  if (load.status === 'ready') assert.equal(load.rule.found, false);
});
test('uncertain commands keep exact UUID, actor and receipt; logout erases private intent', () => {
  const journal = new CmsRedirectJournal();
  journal.bind('staff');
  journal.begin('staff', command);
  journal.fail('staff', command, 0, 'unavailable');
  assert.equal(journal.snapshot('staff')?.state, 'unknown');
  assert.throws(() => journal.begin('staff', { ...command, id: 'c'.repeat(32) }));
  assert.deepEqual(journal.retry('staff'), command);
  journal.fail('staff', command, 409, 'conflict');
  assert.equal(journal.snapshot('staff')?.state, 'unknown');
  assert.equal(journal.finish('staff', command, result), true);
  journal.clear('staff');
  assert.equal(journal.snapshot('staff'), null);
  journal.begin('staff', command);
  journal.bind(null);
  assert.equal(journal.snapshot('staff'), null);
  assert.equal(journal.finish('staff', command, result), false);
});
