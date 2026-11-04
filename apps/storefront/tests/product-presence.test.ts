import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchProductPresence } from '../lib/catalog/product-presence.ts';
import { previewLookup } from '../lib/catalog/catalog-preview.ts';
import { lookupInputSchema } from '../lib/catalog/catalog-contract.ts';
import { storefrontSnapshot } from '../lib/data/fixtures.ts';
const slug = storefrontSnapshot.products[0].slug,
  env = { SHOP_DATA_MODE: 'api', SHOP_API_URL: 'http://api.local', NODE_ENV: 'production' },
  empty = (locale = 'fa') => ({ version: 1, locale, products: [] });
test('preview product existence is explicit in production and missing slugs cannot stream success', async () => {
  assert.equal(
    await fetchProductPresence(slug, 'fa', { SHOP_DATA_MODE: 'preview', NODE_ENV: 'production' }),
    'unavailable',
  );
  assert.equal(
    await fetchProductPresence(slug, 'fa', {
      SHOP_DATA_MODE: 'preview',
      NODE_ENV: 'production',
      SHOP_ENABLE_PREVIEW: 'true',
    }),
    'ready',
  );
  assert.equal(
    await fetchProductPresence('missing-product-qa', 'en', { SHOP_DATA_MODE: 'preview' }),
    'missing',
  );
  assert.equal(
    await fetchProductPresence('../private', 'fa', env, async () => {
      throw Error('Must not fetch invalid slug');
    }),
    'missing',
  );
});
test('public presence uses the exact existing lookup and never forwards account cookies or authorization', async () => {
  const refs = lookupInputSchema.parse({ slugs: [slug] });
  let called = 0;
  assert.equal(
    await fetchProductPresence(slug, 'en', env, async (url, options) => {
      called++;
      assert.equal(String(url), 'http://api.local/api/catalog/en/lookup');
      assert.equal(options?.method, 'POST');
      assert.equal(options?.credentials, 'omit');
      assert.equal(options?.redirect, 'error');
      assert.equal(options?.cache, 'no-store');
      assert.deepEqual(JSON.parse(String(options?.body)), refs);
      assert.deepEqual([...new Headers(options?.headers).keys()], ['content-type']);
      return Response.json(previewLookup('en', refs));
    }),
    'ready',
  );
  assert.equal(called, 1);
  assert.equal(
    await fetchProductPresence(slug, 'fa', env, async () => Response.json(empty())),
    'missing',
  );
});
test('outages malformed unrelated oversized or cookie-setting responses fail closed without preview fallback', async () => {
  const refs = lookupInputSchema.parse({ slugs: [slug] });
  for (const response of [
    new Response(null, { status: 404 }),
    new Response(null, { status: 503 }),
    new Response('html', { headers: { 'Content-Type': 'text/html' } }),
    Response.json({ ...empty(), locale: 'en' }),
    Response.json({ version: 1, locale: 'fa', products: [{ slug: 'someone-else' }] }),
    Response.json(empty(), { headers: { 'Set-Cookie': 'unexpected=1' } }),
    Response.json(empty(), { headers: { 'Content-Length': '1048577' } }),
    new Response(' '.repeat(1048577), { headers: { 'Content-Type': 'application/json' } }),
    new Response(new Uint8Array([255]), { headers: { 'Content-Type': 'application/json' } }),
  ])
    assert.equal(await fetchProductPresence(slug, 'fa', env, async () => response), 'unavailable');
  assert.equal(
    await fetchProductPresence(slug, 'fa', env, async () => {
      throw Error('offline');
    }),
    'unavailable',
  );
  for (const base of [
    'http://user:secret@api.local',
    'http://api.local/path',
    'file:///tmp/a',
    'http://api.local?token=x',
  ])
    assert.equal(
      await fetchProductPresence(slug, 'fa', { ...env, SHOP_API_URL: base }, async () =>
        Response.json(previewLookup('fa', refs)),
      ),
      'unavailable',
    );
});
