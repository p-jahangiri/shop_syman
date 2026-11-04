import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchSupportContent } from '../lib/content/support-content-fetch.ts';
const environment = { SHOP_DATA_MODE: 'api', SHOP_API_URL: 'http://127.0.0.1:5080' };
const empty = { schemaVersion: 1, locale: 'fa', revision: 0, content: null };
function fetcher(fn: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  return fn as typeof fetch;
}
test('support SSR reads the exact public locale without cache, cookies or redirects', async () => {
  let count = 0;
  const value = await fetchSupportContent(
    'fa',
    environment,
    fetcher(async (url, init) => {
      count++;
      assert.equal(url, 'http://127.0.0.1:5080/api/content/support/fa');
      assert.equal(init?.cache, 'no-store');
      assert.equal(init?.credentials, 'omit');
      assert.equal(init?.redirect, 'error');
      assert.ok(init?.signal);
      return Response.json(empty);
    }),
  );
  assert.equal(count, 1);
  assert.deepEqual(value, { status: 'ready', page: empty });
});
test('preview and malformed origin do not send a network request', async () => {
  let count = 0;
  const no = fetcher(async () => {
    count++;
    throw Error('unexpected');
  });
  assert.equal(
    (await fetchSupportContent('fa', { SHOP_DATA_MODE: 'preview' }, no)).status,
    'preview',
  );
  for (const url of [
    'http://user:password@example.test',
    'http://example.test/path',
    'http://example.test?x=1',
    'http://example.test/#fragment',
    'file:///secret',
  ])
    assert.equal(
      (await fetchSupportContent('fa', { ...environment, SHOP_API_URL: url }, no)).status,
      'unavailable',
    );
  assert.equal(count, 0);
});
test('failed, non-JSON, oversized, wrong-language and invalid UTF8 support responses fail without fallback', async () => {
  const responses = [
    new Response('down', { status: 503 }),
    new Response(JSON.stringify(empty)),
    Response.json({ ...empty, locale: 'en' }),
    Response.json({ ...empty, draftJson: 'private' }),
    new Response(new Uint8Array([0xff]), { headers: { 'Content-Type': 'application/json' } }),
    new Response(' '.repeat(131073), { headers: { 'Content-Type': 'application/json' } }),
    new Response('{}', {
      headers: { 'Content-Type': 'application/json', 'Content-Length': '131073' },
    }),
  ];
  for (const response of responses)
    assert.deepEqual(
      await fetchSupportContent(
        'fa',
        environment,
        fetcher(async () => response),
      ),
      { status: 'unavailable', page: null },
    );
  assert.equal(
    (
      await fetchSupportContent(
        'fa',
        environment,
        fetcher(async () => {
          throw Error('network');
        }),
      )
    ).status,
    'unavailable',
  );
});
