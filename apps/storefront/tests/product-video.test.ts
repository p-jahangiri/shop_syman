import fs from 'node:fs';
import vm from 'node:vm';
import testing from 'next/experimental/testing/server.js';
const { unstable_doesMiddlewareMatch: doesProxyMatch } = testing;
import test from 'node:test';
import assert from 'node:assert/strict';
import { validProductVideoUrl } from '../lib/catalog/product-video.ts';
import { proxyPublicVideo } from '../lib/media/public-video-proxy.ts';
const route = 'https://store.example.test/media/videos/' + 'a'.repeat(32) + '/clip.mp4';
const destination = 'http://127.0.0.1:5080/api/media/videos/' + 'a'.repeat(32) + '/clip.mp4';
const tag = '"' + 'a'.repeat(64) + '"';
function response(status = 206, extra: Record<string, string> = {}) {
  return new Response(new Uint8Array([0, 1, 2, 3]), {
    status,
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': '4',
      'Content-Range': 'bytes 0-3/100',
      ETag: tag,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Shop-Public-Resource': 'catalog-video-v1',
      ...extra,
    },
  });
}
test('product video accepts issued files and safe direct HTTPS, while rejecting scripts, page embeds and credentials', () => {
  for (const url of [
    '/media/videos/' + 'a'.repeat(32) + '/clip.mp4',
    'https://cdn.example.test/movie.webm?version=2',
  ])
    assert.equal(validProductVideoUrl(url), true, url);
  for (const url of [
    'javascript:alert(1)',
    '//evil.example.test/a.mp4',
    'https://user:password@example.test/a.mp4',
    'https://example.test/watch?v=1',
    'https://example.test/a.mp4#fragment',
    '/media/videos/../clip.mp4',
  ])
    assert.equal(validProductVideoUrl(url), false, url);
});
test('range video streaming forwards only public range metadata and omits account credentials', async () => {
  const original = globalThis.fetch;
  let init: RequestInit | undefined;
  globalThis.fetch = async (_url, options) => {
    init = options;
    return response();
  };
  try {
    const result = await proxyPublicVideo(
      new Request(route, {
        headers: {
          Range: 'bytes=0-3',
          Cookie: 'private=1',
          Authorization: 'Bearer synthetic-only',
        },
      }),
      destination,
    );
    assert.equal(result.status, 206);
    assert.equal(await result.arrayBuffer().then((v) => v.byteLength), 4);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Cookie'), null);
    assert.equal(headers.get('Authorization'), null);
    assert.equal(headers.get('Range'), 'bytes=0-3');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.credentials, 'omit');
    assert.equal(result.headers.get('content-range'), 'bytes 0-3/100');
  } finally {
    globalThis.fetch = original;
  }
});
test('private, oversized, wrong-content and mismatched range responses fail closed', async () => {
  const original = globalThis.fetch;
  try {
    const cases: Record<string, string>[] = [
      { 'Set-Cookie': 'private=1' },
      { 'Content-Length': '41943041' },
      { 'Content-Type': 'text/html' },
      { 'Content-Range': 'bytes 4-7/100' },
      { 'Cache-Control': 'private, no-store' },
    ];
    for (const extra of cases) {
      globalThis.fetch = async () => response(206, extra);
      const result = await proxyPublicVideo(
        new Request(route, { headers: { Range: 'bytes=0-3' } }),
        destination,
      );
      assert.equal(result.status, 503, JSON.stringify(extra));
      assert.equal(result.headers.has('Set-Cookie'), false);
    }
  } finally {
    globalThis.fetch = original;
  }
});
test('multiple byte ranges are rejected before any upstream request', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return response();
  };
  try {
    assert.equal(
      (
        await proxyPublicVideo(
          new Request(route, { headers: { Range: 'bytes=0-3,4-8' } }),
          destination,
        )
      ).status,
      416,
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});
test('a truncated stream errors rather than returning a complete cacheable video body', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    response(206, { 'Content-Length': '5', 'Content-Range': 'bytes 0-4/100' });
  try {
    const result = await proxyPublicVideo(
      new Request(route, { headers: { Range: 'bytes=0-4' } }),
      destination,
    );
    assert.equal(result.status, 206);
    await assert.rejects(() => result.arrayBuffer(), /Incomplete video/);
  } finally {
    globalThis.fetch = original;
  }
});

test('issued videos reach their binary route directly, while ordinary pages retain locale and private routing', () => {
  const source = fs.readFileSync(new URL('../proxy.ts', import.meta.url), 'utf8');
  const literal = /export const config = (\{[\s\S]*?\n\});/.exec(source);
  assert.ok(literal);
  const config = vm.runInNewContext('(' + literal[1] + ')');
  for (const suffix of ['clip.mp4', 'clip.webm'])
    assert.equal(
      doesProxyMatch({
        config,
        nextConfig: {},
        url: '/media/videos/' + 'a'.repeat(32) + '/' + suffix,
      }),
      false,
    );
  for (const url of ['/fa/account', '/fa/product/example', '/media/videosx/clip.mp4'])
    assert.equal(doesProxyMatch({ config, nextConfig: {}, url }), true, url);
});
