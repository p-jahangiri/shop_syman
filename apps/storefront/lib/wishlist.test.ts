import test from 'node:test';
import assert from 'node:assert/strict';
import {
  wishlistSchema,
  readWishlist,
  mergeWishlist,
  isWishlistPath,
} from './wishlist-contract.ts';
import { WishlistController } from './wishlist-client.ts';
import { proxyWishlist } from './wishlist-proxy.ts';
const page = (
  ids: string[] = [],
  version: string | null = ids.length ? 'AAAAAAAAAAE=' : null,
  owner = 'OWNER',
) => ({ schemaVersion: 1, ownerId: owner, capacity: 200, version, productIds: ids });
const response = (value: unknown, status = 200) => Response.json(value, { status });
test('wishlist contract binds owner and explicit null, sorted distinct IDs and SQL version', () => {
  assert.equal(readWishlist(page(), 'owner').version, null);
  for (const value of [
    { ...page(), version: undefined },
    { ...page(['a']), productIds: ['a', 'a'] },
    page(['z', 'a']),
    page(['a'], null),
    { ...page(), ownerId: '../other' },
    page(['a'], 'AAAAAAAAAAF='),
  ])
    assert.equal(wishlistSchema.safeParse(value).success, false);
  assert.throws(() => readWishlist(page(), 'OTHER'));
  assert.equal(wishlistSchema.safeParse({ ...page(), privateNote: 'secret' }).success, false);
});
test('explicit wishlist merge preserves both lists and rejects over-capacity without truncation', () => {
  assert.deepEqual(mergeWishlist(['a', 'b'], ['b', 'c']), ['a', 'b', 'c']);
  assert.throws(() =>
    mergeWishlist(
      Array.from({ length: 200 }, (_, i) => 'p' + i),
      ['another'],
    ),
  );
});
test('private wishlist path allows only exact GET and PUT with no query or child aliases', () => {
  assert.equal(isWishlistPath('/api/wishlist', 'PUT'), true);
  for (const p of [
    '/api/wishlist?owner=other',
    '/api/wishlist/',
    '/api/wishlist/other',
    'https://example.test/api/wishlist',
  ])
    assert.equal(isWishlistPath(p), false);
  assert.equal(isWishlistPath('/api/wishlist', 'POST'), false);
});
test('a cut response reloads current state without resending PUT or merging another selection', async () => {
  const calls: string[] = [];
  let stored = page();
  const c = new WishlistController(async (_, init) => {
    calls.push(init?.method ?? 'GET');
    if (init?.method === 'PUT') {
      stored = page(['a']);
      throw Error('cut after commit');
    }
    return response(stored);
  });
  c.bind('owner');
  await c.load();
  assert.equal(await c.replace(['a']), false);
  assert.deepEqual(calls, ['GET', 'PUT', 'GET']);
  assert.deepEqual(c.snapshot().data?.productIds, ['a']);
  assert.equal(c.snapshot().issue, 'unknown');
  assert.equal(c.snapshot().failed, false);
});
test('CAS conflict refetches the other devices list and never replays the stale desired set', async () => {
  let count = 0;
  const bodies: unknown[] = [];
  const c = new WishlistController(async (_, init) => {
    if (init?.method === 'PUT') {
      bodies.push(JSON.parse(String(init.body)));
      return response({ title: 'wishlist_version_conflict' }, 409);
    }
    return response(count++ ? page(['b']) : page());
  });
  c.bind('owner');
  await c.load();
  await c.replace(['a']);
  assert.deepEqual(c.snapshot().data?.productIds, ['b']);
  assert.equal(c.snapshot().issue, 'changed');
  assert.equal(bodies.length, 1);
});
test('signout and owner switch discard a late private response and prevent a followup read', async () => {
  let resolve!: (r: Response) => void;
  const c = new WishlistController(
    async () =>
      new Promise<Response>((r) => {
        resolve = r;
      }),
  );
  c.bind('owner');
  const loading = c.load();
  c.bind(null);
  c.bind('other');
  resolve(response(page(['private'])));
  await loading;
  assert.equal(c.snapshot().owner, 'OTHER');
  assert.equal(c.snapshot().data, null);
  assert.equal(c.snapshot().busy, false);
});
test('signout while writing cannot expose or import the old account success', async () => {
  let resolve!: (r: Response) => void;
  let requests = 0;
  const c = new WishlistController(async (_, init) => {
    requests++;
    return init?.method === 'PUT'
      ? new Promise<Response>((r) => {
          resolve = r;
        })
      : response(page());
  });
  c.bind('owner');
  await c.load();
  const writing = c.replace(['private']);
  c.bind(null);
  resolve(response(page(['private'])));
  assert.equal(await writing, false);
  assert.equal(c.snapshot().data, null);
  assert.equal(requests, 2);
});
test('wrong-owner response fails closed without accepting private items', async () => {
  const c = new WishlistController(async () =>
    response(page(['private'], 'AAAAAAAAAAE=', 'OTHER')),
  );
  c.bind('owner');
  await c.load();
  assert.equal(c.snapshot().data, null);
  assert.equal(c.snapshot().failed, true);
});
const env = {
    SHOP_DATA_MODE: 'api',
    SHOP_API_URL: 'http://127.0.0.1:5181',
    SHOP_PUBLIC_URL: 'http://sayman-ui.localhost:3105',
  },
  bearer = 'Bearer ' + 'a'.repeat(32),
  origin = env.SHOP_PUBLIC_URL;
test('wishlist BFF forwards exact bounded JSON and bearer, strips private upstream cookies and uses no-store', async () => {
  let called = 0;
  const result = await proxyWishlist(
    new Request(origin + '/api/wishlist', {
      method: 'PUT',
      headers: { Origin: origin, Authorization: bearer, Cookie: 'owner=secret' },
      body: JSON.stringify({ productIds: ['a'], version: null }),
    }),
    env,
    async (url, init) => {
      called++;
      assert.equal(url, env.SHOP_API_URL + '/api/wishlist');
      assert.equal(new Headers(init?.headers).get('Cookie'), null);
      assert.equal(new Headers(init?.headers).get('Authorization'), bearer);
      assert.equal(init?.cache, 'no-store');
      assert.equal(init?.redirect, 'error');
      assert.equal(init?.credentials, 'omit');
      return response(page(['a']));
    },
  );
  assert.equal(result.status, 200);
  assert.equal(called, 1);
  assert.match(result.headers.get('Cache-Control')!, /no-store/);
  assert.match(result.headers.get('X-Robots-Tag')!, /noindex/);
  assert.equal(result.headers.get('Set-Cookie'), null);
});
test('wishlist BFF rejects origin, method, owner query, forged field and oversized request before fetch', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return response(page());
  };
  for (const [request, status] of [
    [
      new Request(origin + '/api/wishlist', {
        method: 'PUT',
        headers: { Authorization: bearer },
        body: '{}',
      }),
      403,
    ],
    [
      new Request(origin + '/api/wishlist?owner=other', { headers: { Authorization: bearer } }),
      404,
    ],
    [
      new Request(origin + '/api/wishlist', {
        method: 'DELETE',
        headers: { Authorization: bearer },
      }),
      404,
    ],
    [
      new Request(origin + '/api/wishlist', {
        method: 'PUT',
        headers: { Authorization: bearer, Origin: origin },
        body: JSON.stringify({ productIds: [], version: null, ownerId: 'OTHER' }),
      }),
      400,
    ],
    [
      new Request(origin + '/api/wishlist', {
        method: 'PUT',
        headers: { Authorization: bearer, Origin: origin },
        body: ' '.repeat(16385),
      }),
      413,
    ],
  ] as const) {
    assert.equal((await proxyWishlist(request, env, fetcher)).status, status);
  }
  assert.equal(calls, 0);
});
test('wishlist BFF refuses malformed success, upstream cookie, UTF8 corruption and unbounded bodies', async () => {
  for (const value of [
    response({ ...page(), capacity: 201 }),
    Response.json(page(), { headers: { 'Set-Cookie': 'session=secret' } }),
    new Response(new Uint8Array([255]), { headers: { 'Content-Type': 'application/json' } }),
    new Response('a'.repeat(32769), { headers: { 'Content-Type': 'application/json' } }),
  ]) {
    const result = await proxyWishlist(
      new Request(origin + '/api/wishlist', { headers: { Authorization: bearer } }),
      env,
      async () => value,
    );
    assert.equal(result.status, 503);
    assert.equal(result.headers.get('Set-Cookie'), null);
  }
});
