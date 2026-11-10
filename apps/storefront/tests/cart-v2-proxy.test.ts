import assert from 'node:assert/strict';
import test from 'node:test';
import { proxyCartV2, proxyCartConversion } from '../lib/checkout/cart-v2-proxy.ts';
import { isCustomerCartV2Path } from '../lib/checkout/cart-v2-path.ts';
import { requestCartV2 } from '../lib/checkout/cart-v2-client.ts';
import {
  cart2Snapshot,
  cart2Candidate,
  cart2Command,
  cart2Mutation,
  cart2Removal,
  cart2Ids,
} from './cart-v2.test-fixtures.ts';
const env = {
    SHOP_API_URL: 'https://api.example.test',
    SHOP_PUBLIC_URL: 'https://shop.example.test',
    SHOP_DATA_MODE: 'api',
  },
  authorization = 'Bearer ' + 'a'.repeat(30);
const req = (path: string, method = 'GET', body?: unknown, auth = true) =>
  new Request(env.SHOP_PUBLIC_URL + path, {
    method,
    headers: {
      ...(auth ? { Authorization: authorization } : {}),
      ...(method === 'GET'
        ? {}
        : { Origin: env.SHOP_PUBLIC_URL, 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const purchase = [cart2Ids.request, 'offers', cart2Ids.offer, 'purchase'],
  convert = [...purchase.slice(0, 3), 'convert'];
const command = cart2Command(),
  commandId = command.body.requestId;
test('Cart2 customer allowlist is exact by method and excludes API/admin/arbitrary command paths', () => {
  for (const [path, method] of [
    ['/api/cart/fa/v2', 'GET'],
    ['/api/cart/en/v2', 'PUT'],
    ['/api/cart/fa/v2/merge', 'POST'],
    [`/api/cart/fa/v2/offers/${cart2Ids.agreement}`, 'DELETE'],
    [`/api/sourcing/requests/${cart2Ids.request}/offers/${cart2Ids.offer}/convert`, 'POST'],
    [
      `/api/sourcing/requests/${cart2Ids.request}/offers/${cart2Ids.offer}/commands/convert/${commandId}`,
      'GET',
    ],
  ])
    assert.equal(isCustomerCartV2Path(path, method), true, path);
  for (const [path, method] of [
    ['/api/cart/fa/v2', 'DELETE'],
    ['/api/cart/fa/v2/merge', 'GET'],
    ['/api/cart/fa/v2?owner=x', 'GET'],
    ['/api/cart/fa/v2/', 'GET'],
    ['/api/admin/cart/fa/v2', 'GET'],
    [`/api/cart/fa/v2/offers/${'0'.repeat(32)}`, 'DELETE'],
    [`/api/cart/fa/v2/offers/${cart2Ids.agreement}/commands/convert/${commandId}`, 'GET'],
  ])
    assert.equal(isCustomerCartV2Path(path, method), false, path);
});
test('Cart2 GET forwards only its cookie and preserves complete private V2 response', async () => {
  const request = req('/api/cart/fa/v2', 'GET', undefined, false);
  request.headers.set('Cookie', 'other=secret; sayman_cart=' + 'b'.repeat(43));
  const response = await proxyCartV2(request, 'fa', [], env, (async (url, init) => {
    assert.equal(url, env.SHOP_API_URL + '/api/cart/fa/v2');
    assert.equal(new Headers(init?.headers).get('Cookie'), 'sayman_cart=' + 'b'.repeat(43));
    assert.equal(new Headers(init?.headers).get('X-Sayman-Cart-Prices'), null);
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.redirect, 'error');
    return Response.json(cart2Snapshot(), {
      headers: { 'Set-Cookie': 'sayman_cart=' + 'c'.repeat(43) + '; HttpOnly; Path=/api/cart' },
    });
  }) as typeof fetch);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).offerLines[0].unitPriceRial, '9007199254740993');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.match(response.headers.get('Set-Cookie')!, /^sayman_cart=/);
});
test('Cart2 allows an explicit comparison-price opt-in on private cart snapshots', async () => {
  const request = req('/api/cart/fa/v2', 'GET', undefined, false);
  request.headers.set('X-Sayman-Cart-Prices', 'compare-at');
  const snapshot = cart2Snapshot('ordinary');
  const response = await proxyCartV2(request, 'fa', [], env, (async (_url, init) => {
    assert.equal(new Headers(init?.headers).get('X-Sayman-Cart-Prices'), 'compare-at');
    return Response.json({
      ...snapshot,
      ordinaryLines: [{ ...snapshot.ordinaryLines[0], compareAtRial: '120' }],
    });
  }) as typeof fetch);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal((await response.json()).ordinaryLines[0].compareAtRial, '120');
});
test('Cart2 merge requires a member, exact empty input, trusted origin and no query', async () => {
  let sent = 0;
  const fetcher = (async () => {
    sent++;
    return Response.json(cart2Snapshot());
  }) as typeof fetch;
  assert.equal(
    (
      await proxyCartV2(
        req('/api/cart/fa/v2/merge', 'POST', {}, false),
        'fa',
        ['merge'],
        env,
        fetcher,
      )
    ).status,
    401,
  );
  const foreign = req('/api/cart/fa/v2/merge', 'POST', {});
  foreign.headers.set('Origin', 'https://foreign.test');
  assert.equal((await proxyCartV2(foreign, 'fa', ['merge'], env, fetcher)).status, 403);
  assert.equal(
    (
      await proxyCartV2(
        req('/api/cart/fa/v2/merge', 'POST', { ownerId: 'x' }),
        'fa',
        ['merge'],
        env,
        fetcher,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await proxyCartV2(
        req('/api/cart/fa/v2/merge?owner=x', 'POST', {}),
        'fa',
        ['merge'],
        env,
        fetcher,
      )
    ).status,
    404,
  );
  assert.equal(sent, 0);
  assert.equal(
    (await proxyCartV2(req('/api/cart/fa/v2/merge', 'POST', {}), 'fa', ['merge'], env, fetcher))
      .status,
    200,
  );
});
test('Cart2 PUT refuses accepted quantities, money and missing explicit version before upstream', async () => {
  let sent = 0;
  const fetcher = (async () => {
    sent++;
    return Response.json(cart2Snapshot());
  }) as typeof fetch;
  for (const body of [
    { lines: [], offerLines: [], version: null },
    { lines: [{ variantId: 'x', quantity: 1, unitPriceRial: '1' }], version: null },
    { lines: [] },
  ])
    assert.equal(
      (await proxyCartV2(req('/api/cart/fa/v2', 'PUT', body), 'fa', [], env, fetcher)).status,
      400,
    );
  assert.equal(sent, 0);
});
test('Cart2 boundary fails closed on legacy/malformed/private/oversized upstream responses', async () => {
  const base = cart2Snapshot();
  for (const response of [
    Response.json({ ...base, schemaVersion: 1 }),
    Response.json({ ...base, ownerId: 'private' }),
    Response.json({ ...base, locale: 'en' }),
    new Response('x'.repeat(2097153), { headers: { 'Content-Type': 'application/json' } }),
  ])
    assert.equal(
      (
        await proxyCartV2(
          req('/api/cart/fa/v2'),
          'fa',
          [],
          env,
          (async () => response) as typeof fetch,
        )
      ).status,
      503,
    );
});
test('candidate proxy binds public request/offer and rejects private units or foreign proof', async () => {
  for (const value of [
    { ...cart2Candidate(), requestId: 'a'.repeat(32) },
    { ...cart2Candidate(), units: ['private-unit'] },
  ])
    assert.equal(
      (
        await proxyCartConversion(
          req('/api/sourcing/requests/' + purchase.join('/')),
          purchase,
          env,
          (async () => Response.json(value)) as typeof fetch,
        )
      ).status,
      503,
    );
  const response = await proxyCartConversion(
    req('/api/sourcing/requests/' + purchase.join('/')),
    purchase,
    env,
    (async () => Response.json(cart2Candidate())) as typeof fetch,
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).allocation.allocationId, cart2Ids.allocation);
});
test('conversion proxy preserves frozen input and validates complete body-bound mutation', async () => {
  const path = '/api/sourcing/requests/' + convert.join('/');
  const response = await proxyCartConversion(req(path, 'POST', command.body), convert, env, (async (
    url,
    init,
  ) => {
    assert.equal(url, env.SHOP_API_URL + path);
    assert.deepEqual(JSON.parse(init?.body as string), command.body);
    assert.equal(new Headers(init?.headers).get('Cookie'), null);
    return Response.json(cart2Mutation(), { status: 201 });
  }) as typeof fetch);
  assert.equal(response.status, 201);
  assert.equal((await response.json()).commandId, commandId.replaceAll('-', ''));
  const bad = await proxyCartConversion(req(path, 'POST', command.body), convert, env, (async () =>
    Response.json({ ...cart2Mutation(), agreementId: 'f'.repeat(32) })) as typeof fetch);
  assert.equal(bad.status, 503);
});
test('D UUID route accepts canonical N replay receipts for convert and removal', async () => {
  const path = [...purchase.slice(0, 3), 'commands', 'convert', commandId];
  assert.equal(
    (
      await proxyCartConversion(
        req('/api/sourcing/requests/' + path.join('/')),
        path,
        env,
        (async () => Response.json(cart2Mutation(true))) as typeof fetch,
      )
    ).status,
    200,
  );
  const tail = ['offers', cart2Ids.agreement, 'commands', 'remove', commandId];
  assert.equal(
    (
      await proxyCartV2(req('/api/cart/fa/v2/' + tail.join('/')), 'fa', tail, env, (async () =>
        Response.json(cart2Removal(true))) as typeof fetch)
    ).status,
    200,
  );
  assert.equal(
    (
      await proxyCartV2(req('/api/cart/fa/v2/' + tail.join('/')), 'fa', tail, env, (async () =>
        Response.json(cart2Removal(false))) as typeof fetch)
    ).status,
    503,
  );
});
test('Cart2 mutation body is bounded and upstream errors never display raw private details', async () => {
  const path = '/api/sourcing/requests/' + convert.join('/');
  const large = req(path, 'POST', { ...command.body, note: 'x'.repeat(17000) });
  assert.equal(
    (
      await proxyCartConversion(large, convert, env, (async () => {
        throw new Error('must not forward');
      }) as typeof fetch)
    ).status,
    413,
  );
  const response = await proxyCartConversion(
    req(path, 'POST', command.body),
    convert,
    env,
    (async () =>
      Response.json(
        { title: 'bad <private>', detail: 'customer-secret' },
        { status: 500 },
      )) as typeof fetch,
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { title: 'cart_unavailable' });
});
test('Cart2 client uses V2 read/write/merge and rejects V1 or wrong locale without fallback', async () => {
  const paths: string[] = [];
  const fetcher = async (path: string, init: RequestInit) => {
    paths.push(path);
    assert.equal(new Headers(init.headers).get('X-Sayman-Cart-Prices'), 'compare-at');
    if (init.method === 'PUT')
      assert.deepEqual(JSON.parse(init.body as string), { lines: [], version: null });
    return Response.json(cart2Snapshot());
  };
  await requestCartV2(fetcher, 'fa');
  await requestCartV2(fetcher, 'fa', 'PUT', { lines: [], version: null });
  await requestCartV2(fetcher, 'fa', 'POST');
  assert.deepEqual(paths, ['/api/cart/fa/v2', '/api/cart/fa/v2', '/api/cart/fa/v2/merge']);
  await assert.rejects(
    requestCartV2(async () => Response.json({ ...cart2Snapshot(), schemaVersion: 1 }), 'fa'),
  );
  await assert.rejects(
    requestCartV2(async () => Response.json({ ...cart2Snapshot(), locale: 'en' }), 'fa'),
  );
});
