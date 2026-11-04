import test from 'node:test';
import assert from 'node:assert/strict';
import { proxySourcingRequests } from '../lib/market/sourcing-proxy.ts';
import {
  offerTestAction as action,
  offerTestDetail as detail,
  offerTestId as id,
  offerTestMutation as mutation,
  offerTestPage as page,
  offerTestRequest as requestId,
} from '@sayman/web-shared/testing/offer.test-fixtures.ts';
const origin = 'http://sayman-offers.localhost:3107',
  env = { SHOP_API_URL: 'http://127.0.0.1:5181', SHOP_PUBLIC_URL: origin, SHOP_DATA_MODE: 'api' },
  bearer = 'Bearer ' + 'own-qa-token-'.repeat(4),
  base = [requestId, 'offers', id];
const request = (
  path: string[],
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
  query = '',
) =>
  new Request(origin + '/api/sourcing/requests/' + path.join('/') + query, {
    method,
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      Authorization: bearer,
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const never: typeof fetch = async () => {
  throw new Error('Upstream must not be called');
};
test('offer BFF opens only owner child reads, consent actions and operation-bound receipts', async () => {
  for (const path of [
    [requestId, 'offers', '..', 'admin'],
    [...base, 'save'],
    [...base, 'publish'],
    [...base, 'withdraw'],
    [...base, 'commands', 'save', action.requestId],
    [requestId, 'offers', '0'.repeat(32)],
  ])
    assert.equal(
      (await proxySourcingRequests(request(path, 'POST', action), path, env, never)).status,
      404,
    );
  // Cart2 now owns convert; an old consent body cannot cross that boundary.
  assert.equal(
    (
      await proxySourcingRequests(
        request([...base, 'convert'], 'POST', action),
        [...base, 'convert'],
        env,
        never,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await proxySourcingRequests(
        request([...base, 'accept'], 'POST', action, { Origin: 'https://evil.test' }),
        [...base, 'accept'],
        env,
        never,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await proxySourcingRequests(
        request(base, 'GET', undefined, { Authorization: '' }),
        base,
        env,
        never,
      )
    ).status,
    401,
  );
  assert.equal(
    (await proxySourcingRequests(request(base), base, { ...env, SHOP_DATA_MODE: 'preview' }, never))
      .status,
    503,
  );
  for (const query of ['?ownerId=other', '?cursor=a&cursor=b', '?cursor=a&ownerId=other'])
    assert.equal(
      (
        await proxySourcingRequests(
          request([requestId, 'offers'], 'GET', undefined, {}, query),
          [requestId, 'offers'],
          env,
          never,
        )
      ).status,
      400,
    );
});
test('offer BFF forwards exact authority and current canonical body without cookies or forged headers', async () => {
  const path = [...base, 'accept'];
  const response = await proxySourcingRequests(
    request(path, 'POST', action, {
      Cookie: 'sayman_cart=private; sayman_admin_refresh=private',
      'X-Sayman-Admin': '1',
      'X-Forwarded-For': 'spoof',
    }),
    path,
    env,
    async (url, init) => {
      assert.equal(url, 'http://127.0.0.1:5181/api/sourcing/requests/' + path.join('/'));
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('Authorization'), bearer);
      assert.equal(headers.has('Cookie'), false);
      assert.equal(headers.has('X-Sayman-Admin'), false);
      assert.equal(headers.has('X-Forwarded-For'), false);
      assert.equal(init?.cache, 'no-store');
      assert.equal(init?.credentials, 'omit');
      assert.equal(init?.redirect, 'error');
      assert.deepEqual(JSON.parse(String(init?.body)), action);
      return Response.json(mutation, { headers: { 'Set-Cookie': 'secret=never-forward' } });
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.equal(response.headers.has('Set-Cookie'), false);
});
test('offer BFF rejects overposting and UTF8 body excess before making upstream mutations', async () => {
  const path = [...base, 'accept'];
  for (const body of [
    { ...action, ownerId: 'other' },
    { ...action, unitPriceRial: '1' },
    { ...action, stock: 1 },
    { ...action, termsHash: 'a'.repeat(64) },
  ])
    assert.equal(
      (await proxySourcingRequests(request(path, 'POST', body), path, env, never)).status,
      400,
    );
  assert.equal(
    (
      await proxySourcingRequests(
        request(path, 'POST', { ...action, note: 'آ'.repeat(9000) }),
        path,
        env,
        never,
      )
    ).status,
    413,
  );
  const chunked = new Request(origin + '/api/sourcing/requests/' + path.join('/'), {
    method: 'POST',
    headers: { Origin: origin, Authorization: bearer, 'Content-Type': 'application/json' },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(JSON.stringify({ ...action, note: 'آ'.repeat(9000) })),
        );
        controller.close();
      },
    }),
    duplex: 'half',
  } as RequestInit);
  assert.equal((await proxySourcingRequests(chunked, path, env, never)).status, 413);
});
test('offer BFF response binds parent, child and operation and rejects unpublished or payable data', async () => {
  assert.equal(
    (await proxySourcingRequests(request(base), base, env, async () => Response.json(detail)))
      .status,
    200,
  );
  for (const value of [
    { ...detail, requestId: 'f'.repeat(32) },
    {
      ...detail,
      offer: { ...detail.offer, summary: { ...detail.offer.summary, id: 'f'.repeat(32) } },
    },
    { ...detail, canPay: true },
    { ...detail, ownerId: 'private' },
  ])
    assert.equal(
      (await proxySourcingRequests(request(base), base, env, async () => Response.json(value)))
        .status,
      503,
    );
  const list = [requestId, 'offers'];
  assert.equal(
    (
      await proxySourcingRequests(request(list), list, env, async () =>
        Response.json({ ...page, requestId: 'f'.repeat(32) }),
      )
    ).status,
    503,
  );
  const path = [...base, 'accept'];
  for (const value of [
    { ...mutation, requestId: 'f'.repeat(32) },
    { ...mutation, offerId: 'f'.repeat(32) },
    { ...mutation, operation: 'decline', state: 'Declined', acceptanceId: null },
  ])
    assert.equal(
      (
        await proxySourcingRequests(request(path, 'POST', action), path, env, async () =>
          Response.json(value),
        )
      ).status,
      503,
    );
});
test('offer receipt lookup is read-only, strictly replayed and404 remains a sanitized unresolved lookup', async () => {
  const path = [...base, 'commands', 'accept', action.requestId];
  const response = await proxySourcingRequests(request(path), path, env, async (_url, init) => {
    assert.equal(init?.method, 'GET');
    assert.equal(init?.body, undefined);
    return Response.json({ ...mutation, replayed: true });
  });
  assert.equal(response.status, 200);
  assert.equal(
    (await proxySourcingRequests(request(path), path, env, async () => Response.json(mutation)))
      .status,
    503,
  );
  const missing = await proxySourcingRequests(request(path), path, env, async () =>
    Response.json({ title: 'not_found', detail: 'Private details' }, { status: 404 }),
  );
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { title: 'not_found' });
});
test('offer BFF applies bounded UTF8 responses and hides upstream diagnostics', async () => {
  for (const upstream of [
    new Response(' '.repeat(524289), { headers: { 'Content-Type': 'application/json' } }),
    new Response('{"a":"\uFFFD"}', { headers: { 'Content-Type': 'text/html' } }),
    new Response(new Uint8Array([0xc3, 0x28]), { headers: { 'Content-Type': 'application/json' } }),
  ])
    assert.equal(
      (await proxySourcingRequests(request(base), base, env, async () => upstream)).status,
      503,
    );
  const response = await proxySourcingRequests(request(base), base, env, async () =>
    Response.json({ title: 'sql_failure', detail: 'SQL and customer note' }, { status: 500 }),
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { title: 'sql_failure' });
});
