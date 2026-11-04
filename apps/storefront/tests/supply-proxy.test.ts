import test from 'node:test';
import assert from 'node:assert/strict';
import { proxySourcingRequests } from '../lib/market/sourcing-proxy.ts';
import {
  supplyTestDetail as detail,
  supplyTestEvents as events,
  supplyTestPage as page,
  supplyTestRequest as requestId,
  supplyTestTask as taskId,
} from './supply.test-fixtures.ts';
const origin = 'http://sayman-supply.localhost:3107',
  environment = {
    SHOP_API_URL: 'http://127.0.0.1:5181',
    SHOP_PUBLIC_URL: origin,
    SHOP_DATA_MODE: 'api',
  },
  bearer = 'Bearer ' + 'own-qa-token-'.repeat(4),
  root = [requestId, 'supply'],
  child = [...root, taskId];
const request = (
  path: string[],
  method = 'GET',
  headers: Record<string, string> = {},
  query = '',
) =>
  new Request(origin + '/api/sourcing/requests/' + path.join('/') + query, {
    method,
    headers: { Origin: origin, Authorization: bearer, ...headers },
  });
const never: typeof fetch = async () => {
  throw new Error('Upstream must not be called');
};
test('supply BFF dispatch supports only customer GET list/detail/history and rejects all staff operations', async () => {
  for (const [path, value] of [
    [root, page],
    [child, detail],
    [[...child, 'events'], events],
  ] as const)
    assert.equal(
      (
        await proxySourcingRequests(request([...path]), [...path], environment, async () =>
          Response.json(value),
        )
      ).status,
      200,
    );
  for (const method of ['POST', 'PUT', 'DELETE'])
    assert.equal(
      (await proxySourcingRequests(request(child, method), child, environment, never)).status,
      404,
    );
  for (const path of [
    [...child, 'cancel'],
    [...child, 'requested'],
    [...child, 'ordered'],
    [...child, 'commands', 'start', taskId],
    [requestId, 'supply', '..', 'admin'],
    [requestId, 'supply', '0'.repeat(32)],
  ])
    assert.equal(
      (await proxySourcingRequests(request(path), path, environment, never)).status,
      404,
    );
});
test('supply BFF fails closed for unconfigured/preview, wrong origin, missing bearer or extra query authority', async () => {
  assert.equal(
    (
      await proxySourcingRequests(
        request(child),
        child,
        { ...environment, SHOP_DATA_MODE: 'preview' },
        never,
      )
    ).status,
    503,
  );
  assert.equal(
    (
      await proxySourcingRequests(
        request(child, 'GET', { Origin: 'https://evil.test' }),
        child,
        environment,
        never,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await proxySourcingRequests(
        request(child, 'GET', { Authorization: '' }),
        child,
        environment,
        never,
      )
    ).status,
    401,
  );
  for (const query of [
    '?ownerId=other',
    '?cursor=a&cursor=b',
    '?cursor=',
    '?cursor=a&ownerId=other',
    '?cursor=' + 'a'.repeat(201),
  ])
    assert.equal(
      (await proxySourcingRequests(request(root, 'GET', {}, query), root, environment, never))
        .status,
      400,
    );
  assert.equal(
    (await proxySourcingRequests(request(child, 'GET', {}, '?cursor=a'), child, environment, never))
      .status,
    400,
  );
});
test('supply BFF forwards exact read-only authority without cookies and keeps every response private', async () => {
  const path = [...child, 'events'];
  const result = await proxySourcingRequests(
    request(
      path,
      'GET',
      {
        Cookie: 'sayman_admin_refresh=private; sayman_cart=private',
        'X-Sayman-Admin': '1',
        'X-Forwarded-For': 'spoof',
      },
      '?cursor=abc_-',
    ),
    path,
    environment,
    async (url, init) => {
      assert.equal(
        url,
        'http://127.0.0.1:5181/api/sourcing/requests/' + path.join('/') + '?cursor=abc_-',
      );
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('Authorization'), bearer);
      assert.equal(headers.has('Cookie'), false);
      assert.equal(headers.has('X-Sayman-Admin'), false);
      assert.equal(headers.has('X-Forwarded-For'), false);
      assert.equal(init?.method, 'GET');
      assert.equal(init?.body, undefined);
      assert.equal(init?.cache, 'no-store');
      assert.equal(init?.credentials, 'omit');
      assert.equal(init?.redirect, 'error');
      return Response.json(events, { headers: { 'Set-Cookie': 'secret=never-forward' } });
    },
  );
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(result.headers.get('Vary'), 'Cookie, Authorization');
  assert.equal(result.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.equal(result.headers.has('Set-Cookie'), false);
});
test('supply BFF binds exact parent/task and rejects private or payable upstream projections', async () => {
  for (const value of [
    { ...detail, requestId: 'f'.repeat(32) },
    { ...detail, task: { ...detail.task, id: 'f'.repeat(32) } },
    { ...detail, internalNote: 'private' },
    { ...detail, sourceKey: 'private' },
    { ...detail, canPay: true },
    { ...detail, reservedForRequest: true },
  ])
    assert.equal(
      (
        await proxySourcingRequests(request(child), child, environment, async () =>
          Response.json(value),
        )
      ).status,
      503,
    );
  for (const value of [
    { ...page, requestId: 'f'.repeat(32) },
    { ...page, startCandidate: { offerId: detail.task.offerId } },
    { ...page, pageSize: 50 },
  ])
    assert.equal(
      (
        await proxySourcingRequests(request(root), root, environment, async () =>
          Response.json(value),
        )
      ).status,
      503,
    );
});
test('supply BFF bounds all UTF8 pages/details and hides diagnostics without accepting malformed content', async () => {
  for (const path of [root, child, [...child, 'events']]) {
    const oversized = await proxySourcingRequests(
      request(path),
      path,
      environment,
      async () =>
        new Response(' '.repeat(524289), { headers: { 'Content-Type': 'application/json' } }),
    );
    assert.equal(oversized.status, 503);
  }
  for (const value of [
    new Response(new Uint8Array([0xc3, 0x28]), { headers: { 'Content-Type': 'application/json' } }),
    new Response('{}', { headers: { 'Content-Type': 'text/html' } }),
    Response.json(detail, { status: 201 }),
  ])
    assert.equal(
      (await proxySourcingRequests(request(child), child, environment, async () => value)).status,
      503,
    );
  const error = await proxySourcingRequests(request(child), child, environment, async () =>
    Response.json(
      { title: 'sql_failure', detail: 'Private account and supplier data' },
      { status: 500 },
    ),
  );
  assert.equal(error.status, 503);
  assert.deepEqual(await error.json(), { title: 'sql_failure' });
});
