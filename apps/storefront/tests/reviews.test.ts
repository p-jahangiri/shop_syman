import test from 'node:test';
import assert from 'node:assert/strict';
import { proxyReviews } from '../lib/reviews/reviews-proxy.ts';
import { isCustomerReviewsPath } from '../lib/reviews/reviews-path.ts';
import { reviewPage, saveReviewInput } from '@sayman/web-shared/lib/reviews/reviews-contract.ts';
const origin = 'http://127.0.0.1:3000',
  env = { SHOP_PUBLIC_URL: origin, SHOP_API_URL: 'http://127.0.0.1:5181', SHOP_DATA_MODE: 'api' },
  id = 'a'.repeat(32),
  other = 'b'.repeat(32),
  token = 'Bearer ' + 'test-token-'.repeat(4);
const content = {
  revisionId: other,
  locale: 'fa',
  rating: 5,
  displayName: 'نام عمومی',
  title: 'تجربه',
  body: 'متن سادهٔ نظر کاربر',
  at: '2026-10-24T20:00:00+00:00',
};
const page = {
  schemaVersion: 1,
  items: [{ id, productId: 'p1', content, verifiedBuyer: false, reply: null }],
  ratingCounts: [0, 0, 0, 0, 1],
  nextCursor: null,
};
const input = {
  version: null,
  locale: 'fa',
  rating: 5,
  displayName: 'نام عمومی',
  title: 'عنوان',
  body: 'متن ساده برای آزمون',
  publishConsent: true,
};
const never: typeof fetch = async () => {
  assert.fail('Upstream must not be called');
};
const request = (
  path: string[],
  method = 'GET',
  body?: unknown,
  extra: Record<string, string> = {},
  query = '',
) =>
  new Request(origin + '/api/reviews/' + path.join('/') + query, {
    method,
    headers: { Origin: origin, 'Content-Type': 'application/json', Authorization: token, ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
test('reviews boundary excludes private owner keys and forged purchase badges', () => {
  assert(reviewPage.safeParse(page).success);
  assert(
    !reviewPage.safeParse({ ...page, items: [{ ...page.items[0], ownerId: 'secret' }] }).success,
  );
  assert(!saveReviewInput.safeParse({ ...input, verifiedBuyer: true }).success);
  assert(!saveReviewInput.safeParse({ ...input, publishConsent: false }).success);
  assert(isCustomerReviewsPath('/api/reviews/products/p1/mine', 'GET'));
  assert(!isCustomerReviewsPath('/api/reviews/products/p1/mine?ownerId=other', 'GET'));
  assert(!isCustomerReviewsPath('/api/reviews/products/p1/commands/' + id, 'POST'));
  assert(!isCustomerReviewsPath('/api/admin/reviews', 'GET'));
});
test('public review reads strip cookies and bearer and preserve original plain text', async () => {
  const path = ['products', 'p1'];
  const r = await proxyReviews(
    request(path, 'GET', undefined, {
      Cookie: 'sayman_admin_refresh=secret',
      'X-Sayman-Admin': '1',
    }),
    path,
    env,
    async (url, init) => {
      assert.equal(url, 'http://127.0.0.1:5181/api/reviews/products/p1');
      const h = new Headers(init?.headers);
      assert(!h.has('Cookie'));
      assert(!h.has('Authorization'));
      assert(!h.has('X-Sayman-Admin'));
      assert.equal(init?.cache, 'no-store');
      assert.equal(init?.redirect, 'error');
      return Response.json(page, { headers: { 'Set-Cookie': 'must=not-forward' } });
    },
  );
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), page);
  assert(!r.headers.has('Set-Cookie'));
  assert.match(r.headers.get('Cache-Control')!, /no-store/);
});
test('mutation requires account, explicit same origin and strict nonfinancial input', async () => {
  const path = ['products', 'p1', 'commands', id];
  assert.equal(
    (
      await proxyReviews(
        request(path, 'PUT', input, { Origin: 'https://evil.test' }),
        path,
        env,
        never,
      )
    ).status,
    403,
  );
  assert.equal(
    (await proxyReviews(request(path, 'PUT', input, { Authorization: '' }), path, env, never))
      .status,
    401,
  );
  for (const value of [
    { ...input, ownerId: other },
    { ...input, verifiedBuyer: true },
    { ...input, priceRial: '1' },
    { ...input, rating: 0 },
    { ...input, publishConsent: false },
  ])
    assert.equal((await proxyReviews(request(path, 'PUT', value), path, env, never)).status, 400);
  assert.equal(
    (
      await proxyReviews(
        request(path, 'PUT', { ...input, body: 'آ'.repeat(9000) }),
        path,
        env,
        never,
      )
    ).status,
    413,
  );
  for (const query of ['?ownerId=other', '?cursor=1&cursor=2', '?cursor=9223372036854775808'])
    assert.equal(
      (
        await proxyReviews(
          request(['products', 'p1'], 'GET', undefined, {}, query),
          ['products', 'p1'],
          env,
          never,
        )
      ).status,
      400,
    );
  assert.equal(
    (
      await proxyReviews(
        request(path, 'PUT', input),
        path,
        { ...env, SHOP_DATA_MODE: 'preview' },
        never,
      )
    ).status,
    503,
  );
});
test('BFF rejects unrelated product, exposed private fields and malformed or oversized upstream', async () => {
  const path = ['products', 'p1'];
  for (const value of [
    { ...page, items: [{ ...page.items[0], productId: 'p2' }] },
    { ...page, items: [{ ...page.items[0], ownerId: 'secret' }] },
    { ...page, nextCursor: undefined },
  ])
    assert.equal(
      (await proxyReviews(request(path), path, env, async () => Response.json(value))).status,
      503,
    );
  for (const r of [
    new Response(' '.repeat(524289)),
    new Response(new Uint8Array([0xc3, 0x28]), { headers: { 'Content-Type': 'application/json' } }),
  ])
    assert.equal((await proxyReviews(request(path), path, env, async () => r)).status, 503);
});
test('owner GET and save correlate the returned product and never forward private cookies', async () => {
  const review = {
    id,
    productId: 'p1',
    state: 'Pending',
    version: 'AAAAAAAAAAE=',
    content,
    reply: null,
    reportCount: 0,
  };
  const path = ['products', 'p1', 'commands', id];
  const result = { schemaVersion: 1, replayed: false, review, reported: false };
  const r = await proxyReviews(request(path, 'PUT', input), path, env, async (_url, init) => {
    assert.equal(new Headers(init?.headers).get('Authorization'), token);
    assert.deepEqual(JSON.parse(String(init?.body)), input);
    return Response.json(result);
  });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), result);
  assert.equal(
    (
      await proxyReviews(request(path, 'PUT', input), path, env, async () =>
        Response.json({ ...result, review: { ...review, productId: 'wrong' } }),
      )
    ).status,
    503,
  );
});

test('review photo proxy serves only bounded WebP and scopes the bearer to owner photos', async () => {
  const publicPath = ['products', 'p1', 'photos', id, other];
  const ownerPath = [...publicPath, 'mine'];
  const webp = Uint8Array.from('RIFF0000WEBPfake', (letter) => letter.charCodeAt(0));
  assert(!isCustomerReviewsPath('/api/reviews/' + publicPath.join('/'), 'GET'));
  assert(isCustomerReviewsPath('/api/reviews/' + ownerPath.join('/'), 'GET'));
  for (const path of [publicPath, ownerPath]) {
    const result = await proxyReviews(
      request(path, 'GET', undefined, { Cookie: 'staff=private' }),
      path,
      env,
      async (url, init) => {
        assert.equal(url, env.SHOP_API_URL + '/api/reviews/' + path.join('/'));
        const headers = new Headers(init?.headers);
        assert.equal(headers.get('Authorization'), path === ownerPath ? token : null);
        assert(!headers.has('Cookie'));
        return new Response(webp, {
          headers: { 'Content-Type': 'image/webp', 'Set-Cookie': 'private=1' },
        });
      },
    );
    assert.equal(result.status, 200);
    assert.deepEqual(new Uint8Array(await result.arrayBuffer()), webp);
    assert.equal(result.headers.get('Content-Type'), 'image/webp');
    assert.match(result.headers.get('Cache-Control') ?? '', /no-store/);
    assert(!result.headers.has('Set-Cookie'));
  }
  assert.equal(
    (
      await proxyReviews(
        request(ownerPath, 'GET', undefined, { Authorization: '' }),
        ownerPath,
        env,
        never,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await proxyReviews(
        request(publicPath, 'GET', undefined, {}, '?cursor=1'),
        publicPath,
        env,
        never,
      )
    ).status,
    400,
  );
  for (const [body, type] of [
    [new Uint8Array([0, 1, 2]), 'image/webp'],
    [webp, 'text/html'],
    [new Uint8Array(2 * 1024 * 1024 + 1), 'image/webp'],
  ] as const) {
    const result = await proxyReviews(
      request(publicPath),
      publicPath,
      env,
      async () => new Response(body, { headers: { 'Content-Type': type } }),
    );
    assert.equal(result.status, 503);
  }
});
