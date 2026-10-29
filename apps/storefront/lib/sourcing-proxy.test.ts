import test from 'node:test';
import assert from 'node:assert/strict';
import { proxySourcingCart, proxySourcingRequests } from './sourcing-proxy.ts';
import {
  sourcingTestCart as cart,
  sourcingTestSubmit as submit,
  sourcingTestMutation as mutation,
  sourcingTestDetail as detail,
  sourcingTestRequest as id,
  sourcingTestSummary as summary,
} from './sourcing.test-fixtures.ts';
const origin = 'http://sayman-sourcing.localhost:3107',
  env = { SHOP_API_URL: 'http://127.0.0.1:5181', SHOP_PUBLIC_URL: origin, SHOP_DATA_MODE: 'api' },
  bearer = 'Bearer ' + 'own-qa-token-'.repeat(4),
  guest = 'a'.repeat(43);
const request = (
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  new Request(origin + path, {
    method,
    headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const never: typeof fetch = async () => {
  throw new Error('Upstream must not be called.');
};
test('sourcing BFF requires exact mutation origin, correct authority and bounded canonical paths', async () => {
  assert.equal(
    (
      await proxySourcingCart(
        request(
          '/api/cart/fa/sourcing',
          'PUT',
          { version: null, lines: [] },
          { Origin: 'https://evil.example' },
        ),
        'fa',
        [],
        env,
        never,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await proxySourcingCart(
        request('/api/cart/fa/sourcing/submit', 'POST', submit),
        'fa',
        ['submit'],
        env,
        never,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await proxySourcingCart(
        request('/api/cart/fa/sourcing', 'GET', undefined, { Authorization: 'Basic supplied' }),
        'fa',
        [],
        env,
        never,
      )
    ).status,
    401,
  );
  assert.equal(
    (await proxySourcingRequests(request('/api/sourcing/requests'), [], env, never)).status,
    401,
  );
  for (const path of [['../admin'], [id, 'review'], [id, 'unavailable'], [id, 'cancel', 'extra']])
    assert.equal(
      (await proxySourcingRequests(request('/api/sourcing/requests', 'POST', {}), path, env, never))
        .status,
      404,
    );
  assert.equal(
    (
      await proxySourcingCart(
        request('/api/cart/fa/sourcing'),
        'fa',
        [],
        { ...env, SHOP_DATA_MODE: 'preview' },
        never,
      )
    ).status,
    503,
  );
});
test('sourcing guest cart forwards only the existing cart cookie, never unrelated session cookies or forged authority', async () => {
  const response = await proxySourcingCart(
    request('/api/cart/fa/sourcing', 'GET', undefined, {
      Cookie: `sayman_cart=${guest}; sayman_admin_refresh=private; other=private`,
      'X-Sayman-Admin': '1',
      'X-Forwarded-For': 'spoof',
    }),
    'fa',
    [],
    env,
    async (url, init) => {
      assert.equal(url, 'http://127.0.0.1:5181/api/cart/fa/sourcing');
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('Cookie'), 'sayman_cart=' + guest);
      assert.equal(headers.has('Authorization'), false);
      assert.equal(headers.has('X-Sayman-Admin'), false);
      assert.equal(headers.has('X-Forwarded-For'), false);
      assert.equal(init?.cache, 'no-store');
      assert.equal(init?.redirect, 'error');
      return Response.json(cart, {
        headers: { 'Set-Cookie': `sayman_cart=${guest}; Path=/api/cart; HttpOnly` },
      });
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.getSetCookie().length, 1);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.match(response.headers.get('Vary')!, /Cookie/);
});
test('source selection and submit input reject forged customer, financial and snapshot fields before forwarding', async () => {
  for (const body of [
    { version: null, lines: [], ownerId: 'other' },
    { version: null, lines: [{ listingId: 'a', quantity: 1, referencePriceRial: '1' }] },
    { version: null, lines: [{ listingId: 'a', quantity: 1000001 }] },
  ])
    assert.equal(
      (await proxySourcingCart(request('/api/cart/fa/sourcing', 'PUT', body), 'fa', [], env, never))
        .status,
      400,
    );
  for (const body of [
    { ...submit, ownerId: 'other' },
    { ...submit, model: { id: 'fake' } },
    { ...submit, note: 'x'.repeat(501) },
  ])
    assert.equal(
      (
        await proxySourcingCart(
          request('/api/cart/fa/sourcing/submit', 'POST', body, { Authorization: bearer }),
          'fa',
          ['submit'],
          env,
          never,
        )
      ).status,
      400,
    );
  assert.equal(
    (
      await proxySourcingCart(
        request(
          '/api/cart/fa/sourcing/submit',
          'POST',
          { note: 'x'.repeat(17000) },
          { Authorization: bearer },
        ),
        'fa',
        ['submit'],
        env,
        never,
      )
    ).status,
    413,
  );
});
test('private tracking forwards bearer without guest/owner cookies and validates exact request binding', async () => {
  const response = await proxySourcingRequests(
    request('/api/sourcing/requests/' + id, 'GET', undefined, {
      Authorization: bearer,
      Cookie: 'sayman_cart=' + guest,
    }),
    [id],
    env,
    async (url, init) => {
      assert.equal(url, 'http://127.0.0.1:5181/api/sourcing/requests/' + id);
      assert.equal(new Headers(init?.headers).get('Authorization'), bearer);
      assert.equal(new Headers(init?.headers).has('Cookie'), false);
      return Response.json(detail, { headers: { 'Set-Cookie': 'private=never-forward' } });
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.has('Set-Cookie'), false);
  assert.equal(
    (
      await proxySourcingRequests(
        request('/api/sourcing/requests/' + id, 'GET', undefined, { Authorization: bearer }),
        [id],
        env,
        async () => Response.json({ ...detail, summary: { ...summary, id: 'c'.repeat(32) } }),
      )
    ).status,
    503,
  );
  for (const query of ['?ownerId=other', '?cursor=x&cursor=y', '?cursor=x&ownerId=other'])
    assert.equal(
      (
        await proxySourcingRequests(
          request('/api/sourcing/requests' + query, 'GET', undefined, { Authorization: bearer }),
          [],
          env,
          never,
        )
      ).status,
      400,
    );
});
test('submit replay and cancel transport keep exact command identity and no payment capability', async () => {
  const result = await proxySourcingCart(
    request('/api/cart/fa/sourcing/submit', 'POST', submit, {
      Authorization: bearer,
      Cookie: 'sayman_cart=' + guest,
    }),
    'fa',
    ['submit'],
    env,
    async (url, init) => {
      assert.equal(url, 'http://127.0.0.1:5181/api/cart/fa/sourcing/submit');
      assert.equal(JSON.parse(String(init?.body)).requestId, submit.requestId);
      assert.equal(new Headers(init?.headers).get('Cookie'), 'sayman_cart=' + guest);
      return Response.json({ ...mutation, replayed: true });
    },
  );
  assert.equal(result.status, 200);
  assert.equal((await result.json()).replayed, true);
  const cancelled = await proxySourcingRequests(
    request(
      '/api/sourcing/requests/' + id + '/cancel',
      'POST',
      { requestId: submit.requestId, version: submit.cartVersion },
      { Authorization: bearer },
    ),
    [id, 'cancel'],
    env,
    async () => Response.json({ ...mutation, state: 'Cancelled' }),
  );
  assert.equal(cancelled.status, 200);
});
test('success payloads reject leaked admin fields, malformed data and excess stream sizes while failures are sanitized', async () => {
  for (const upstream of [
    Response.json({ ...cart, canPay: true }),
    Response.json({ ...cart, totalRial: '1' }),
    new Response('<html>provider detail</html>', { headers: { 'Content-Type': 'text/html' } }),
    new Response(' '.repeat(2097153), { headers: { 'Content-Type': 'application/json' } }),
  ])
    assert.equal(
      (
        await proxySourcingCart(
          request('/api/cart/fa/sourcing'),
          'fa',
          [],
          env,
          async () => upstream,
        )
      ).status,
      503,
    );
  const response = await proxySourcingRequests(
    request('/api/sourcing/requests', 'GET', undefined, { Authorization: bearer }),
    [],
    env,
    async () =>
      Response.json({ title: 'database_failure', detail: 'Private note and SQL' }, { status: 500 }),
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { title: 'database_failure' });
  assert.equal(
    (
      await proxySourcingRequests(
        request('/api/sourcing/requests', 'GET', undefined, { Authorization: bearer }),
        [],
        env,
        async () =>
          Response.json({
            schemaVersion: 1,
            pageSize: 20,
            items: [{ ...summary, ownerId: 'staff-only' }],
            nextCursor: null,
          }),
      )
    ).status,
    503,
  );
});
test('own command receipt recovery is read-only and never opens staff operations or proves404 is terminal', async () => {
  const path = ['commands', 'submit', submit.requestId];
  const result = await proxySourcingRequests(
    request('/api/sourcing/requests/' + path.join('/'), 'GET', undefined, {
      Authorization: bearer,
    }),
    path,
    env,
    async (url, init) => {
      assert.equal(url, 'http://127.0.0.1:5181/api/sourcing/requests/' + path.join('/'));
      assert.equal(init?.method, 'GET');
      assert.equal(init?.body, undefined);
      return Response.json({ ...mutation, replayed: true });
    },
  );
  assert.equal(result.status, 200);
  assert.equal((await result.json()).replayed, true);
  assert.equal(
    (
      await proxySourcingRequests(
        request('/api/sourcing/requests/commands/review/' + submit.requestId, 'GET', undefined, {
          Authorization: bearer,
        }),
        ['commands', 'review', submit.requestId],
        env,
        never,
      )
    ).status,
    404,
  );
  const missing = await proxySourcingRequests(
    request('/api/sourcing/requests/' + path.join('/'), 'GET', undefined, {
      Authorization: bearer,
    }),
    path,
    env,
    async () => Response.json({ title: 'not_found', detail: 'private' }, { status: 404 }),
  );
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { title: 'not_found' });
});
