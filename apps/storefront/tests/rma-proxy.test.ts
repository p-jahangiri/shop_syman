import test from 'node:test';
import assert from 'node:assert/strict';
import { proxyOrderReturns, proxyReturns } from '../lib/orders/rma-proxy.ts';

const id = '1'.repeat(32),
  commandId = '2'.repeat(32),
  orderId = '3'.repeat(32),
  policyId = '4'.repeat(32);
const version = 'AAAAAAAAAAE=',
  at = '2026-10-30T00:00:00Z',
  hash = 'A'.repeat(64);
const environment = {
  SHOP_DATA_MODE: 'api',
  SHOP_API_URL: 'http://127.0.0.1:5080',
  SHOP_PUBLIC_URL: 'http://127.0.0.1:3000',
};
const headers = {
  Authorization: 'Bearer ' + 'x'.repeat(30),
  Origin: environment.SHOP_PUBLIC_URL,
  Cookie: 'never-forward=1',
  'Content-Type': 'application/json',
};
const policy = {
  id: policyId,
  revision: 1,
  version,
  enabled: true,
  physicalReturns: true,
  digitalComplaints: true,
  conditionsFa: 'شرایط نمونه',
  conditionsEn: 'Synthetic conditions',
  windowMode: 'deliveryDays',
  windowDays: 3,
  maxOpenPerOwner: null,
  at,
};
const current = {
  schemaVersion: 1,
  current: policy,
  canRefund: false,
  refundAvailability: 'provider_unconfigured',
};
const publicPolicy = {
  schemaVersion: 1,
  configured: true,
  enabled: true,
  physicalReturns: true,
  digitalComplaints: true,
  conditionsFa: policy.conditionsFa,
  conditionsEn: policy.conditionsEn,
  windowMode: 'deliveryDays',
  windowDays: 3,
  canRefund: false,
  refundAvailability: 'provider_unconfigured',
};
const identity = {
  lineKey: 'line-one',
  variantId: 'variant-one',
  sku: 'SYNTHETIC',
  name: 'Synthetic item',
  label: 'Sample',
  isDigital: false,
  orderedQuantity: 1,
  handedOffOrAvailableQuantity: 1,
};
const summary = {
  id,
  reference: 'RMA-1',
  orderId,
  locale: 'fa',
  kind: 'physicalReturn',
  state: 'submitted',
  outcome: null,
  isOpen: true,
  version,
  itemCount: 1,
  createdAt: at,
  changedAt: at,
};
const detail = {
  schemaVersion: 1,
  case: summary,
  originalSnapshotVersion: 1,
  snapshotHash: hash,
  policy,
  reason: 'Synthetic reason',
  lines: [{ ...identity, quantity: 1 }],
  events: [
    {
      sequence: '1',
      action: 'submitted',
      state: 'submitted',
      outcome: null,
      author: 'customer',
      at,
      message: null,
    },
  ],
  canWithdraw: true,
  canRefund: false,
  refundAvailability: 'provider_unconfigured',
  canReceive: false,
  canRestock: false,
  canReship: false,
};
const context = {
  schemaVersion: 1,
  orderId,
  originalSnapshotVersion: 1,
  orderVersion: version,
  orderState: 'Paid',
  snapshotHash: hash,
  policy: current,
  lines: [{ ...identity, requestableQuantity: 1 }],
  canRequest: true,
  blockers: [],
  canRefund: false,
  canRestock: false,
  canReship: false,
};
const result = { schemaVersion: 1, commandId, payloadHash: hash, replayed: false, case: detail };
const create = {
  policyRevisionId: policyId,
  orderVersion: version,
  kind: 'physicalReturn',
  lines: [{ lineKey: 'line-one', quantity: 1 }],
  reason: 'Synthetic reason',
  acknowledgeNoFinancialAction: true,
};
const withdraw = { version, reason: 'Synthetic withdrawal', confirmed: true };
function request(
  scope: 'returns' | 'orders',
  path: string[],
  options: RequestInit = {},
  search = '',
) {
  return new Request(
    environment.SHOP_PUBLIC_URL +
      '/api/' +
      scope +
      (path.length ? '/' + path.join('/') : '') +
      search,
    { headers, ...options },
  );
}
function upstream(value: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(value, {
    status,
    headers: { 'X-Sayman-Returns-Contract': 'rma-v1', ...extra },
  });
}

test('public RMA policy is anonymous, strips credentials, and preserves configured/null semantics', async () => {
  let calls = 0;
  const fetcher = (async (url, init) => {
    calls++;
    assert.equal(url, environment.SHOP_API_URL + '/api/returns/policy');
    const forwarded = new Headers(init?.headers);
    for (const key of ['Authorization', 'Cookie', 'Origin', 'X-Sayman-Client'])
      assert.equal(forwarded.has(key), false);
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.cache, 'no-store');
    return upstream(publicPolicy);
  }) as typeof fetch;
  const response = await proxyReturns(
    request('returns', ['policy']),
    ['policy'],
    environment,
    fetcher,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), publicPolicy);
  assert.equal(response.headers.get('Cache-Control'), 'public, no-store');
  assert.match(response.headers.get('X-Robots-Tag')!, /noindex/);
  const empty = {
    ...publicPolicy,
    configured: false,
    enabled: false,
    physicalReturns: false,
    digitalComplaints: false,
    conditionsFa: null,
    conditionsEn: null,
    windowMode: null,
    windowDays: null,
  };
  assert.equal(
    (
      await proxyReturns(request('returns', ['policy']), ['policy'], environment, (async () =>
        upstream(empty)) as typeof fetch)
    ).status,
    200,
  );
  assert.equal(
    (
      await proxyReturns(request('returns', ['policy']), ['policy'], environment, (async () =>
        upstream({ ...empty, conditionsFa: 'invented' })) as typeof fetch)
    ).status,
    503,
  );
  assert.equal(calls, 1);
});

test('RMA private reads bind context, case, command, and staff visibility without forwarding cookies', async () => {
  const routes = [
    { scope: 'orders' as const, path: [orderId, 'returns', 'context'], value: context },
    {
      scope: 'returns' as const,
      path: [],
      value: { schemaVersion: 1, items: [summary], nextCursor: null },
    },
    { scope: 'returns' as const, path: [id], value: detail },
    { scope: 'returns' as const, path: ['commands', commandId], value: result },
  ];
  for (const route of routes) {
    const proxy = route.scope === 'orders' ? proxyOrderReturns : proxyReturns;
    const response = await proxy(request(route.scope, route.path), route.path, environment, (async (
      url,
      init,
    ) => {
      assert.equal(
        url,
        environment.SHOP_API_URL +
          '/api/' +
          route.scope +
          (route.path.length ? '/' + route.path.join('/') : ''),
      );
      const forwarded = new Headers(init?.headers);
      assert.equal(forwarded.get('Authorization'), headers.Authorization);
      assert.equal(forwarded.get('X-Sayman-Client'), 'storefront');
      assert.equal(forwarded.has('Cookie'), false);
      return upstream(route.value);
    }) as typeof fetch);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), route.value);
    assert.match(response.headers.get('Cache-Control')!, /private, no-store/);
    assert.match(response.headers.get('X-Robots-Tag')!, /noindex/);
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(response.headers.get('X-Sayman-Returns-Contract'), 'rma-v1');
  }
  for (const value of [
    { ...detail, case: { ...summary, id: orderId } },
    { ...detail, case: { ...summary, ownerId: 'another' } },
    { ...detail, events: [{ ...detail.events[0], staffNote: 'Private staff note' }] },
  ])
    assert.equal(
      (
        await proxyReturns(request('returns', [id]), [id], environment, (async () =>
          upstream(value)) as typeof fetch)
      ).status,
      503,
    );
  assert.equal(
    (
      await proxyOrderReturns(
        request('orders', [orderId, 'returns', 'context']),
        [orderId, 'returns', 'context'],
        environment,
        (async () => upstream({ ...context, orderId: id })) as typeof fetch,
      )
    ).status,
    503,
  );
  assert.equal(
    (
      await proxyReturns(
        request('returns', ['commands', commandId]),
        ['commands', commandId],
        environment,
        (async () => upstream({ ...result, commandId: id })) as typeof fetch,
      )
    ).status,
    503,
  );
});

test('RMA create and withdrawal PUT preserve idempotent bindings and never imply financial actions', async () => {
  for (const route of [
    {
      scope: 'orders' as const,
      path: [orderId, 'returns', 'commands', commandId],
      input: create,
      status: 201,
    },
    {
      scope: 'returns' as const,
      path: [id, 'withdrawals', commandId],
      input: withdraw,
      status: 200,
    },
  ]) {
    const proxy = route.scope === 'orders' ? proxyOrderReturns : proxyReturns;
    const response = await proxy(
      request(route.scope, route.path, { method: 'PUT', body: JSON.stringify(route.input) }),
      route.path,
      environment,
      (async (_url, init) => {
        assert.equal(init?.method, 'PUT');
        assert.deepEqual(JSON.parse(String(init?.body)), route.input);
        assert.equal(new Headers(init?.headers).get('Content-Type'), 'application/json');
        return upstream(result, route.status);
      }) as typeof fetch,
    );
    assert.equal(response.status, route.status);
    if (route.status === 201) assert.equal(response.headers.get('Location'), '/api/returns/' + id);
    assert.deepEqual(await response.json(), result);
    const wrong = await proxy(
      request(route.scope, route.path, { method: 'PUT', body: JSON.stringify(route.input) }),
      route.path,
      environment,
      (async () =>
        upstream({
          ...result,
          case: {
            ...detail,
            case: { ...summary, [route.scope === 'orders' ? 'orderId' : 'id']: policyId },
          },
        })) as typeof fetch,
    );
    assert.equal(wrong.status, 503);
  }
});

test('RMA paths, verbs, queries, origin and bearer are rejected before an upstream call', async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return upstream(detail);
  }) as typeof fetch;
  for (const [path, options, search, expected] of [
    [[id], { method: 'POST', body: '{}' }, '', 405],
    [[id, 'refund'], {}, '', 400],
    [['0'.repeat(32)], {}, '', 400],
    [[id], {}, '?owner=another', 400],
    [[], {}, '?state=paid', 400],
    [[], {}, '?state=submitted&state=withdrawn', 400],
    [[], {}, '?after=' + 'x'.repeat(181), 400],
    [[], {}, '?after=YWJj%0A', 400],
    [[id], { headers: {} }, '', 401],
    [[id], { headers: { ...headers, Origin: 'https://evil.example' } }, '', 403],
    [[id], { headers: { ...headers, 'Sec-Fetch-Site': 'cross-site' } }, '', 403],
    [
      [id, 'withdrawals', commandId],
      {
        method: 'PUT',
        body: JSON.stringify(withdraw),
        headers: { Authorization: headers.Authorization, 'Content-Type': 'application/json' },
      },
      '',
      403,
    ],
  ] as const) {
    assert.equal(
      (
        await proxyReturns(
          request('returns', [...path], options, search),
          [...path],
          environment,
          fetcher,
        )
      ).status,
      expected,
    );
  }
  for (const config of [
    { ...environment, SHOP_DATA_MODE: 'preview' },
    { ...environment, SHOP_API_URL: 'http://user:pass@127.0.0.1:5080' },
    { ...environment, SHOP_API_URL: 'http://127.0.0.1:5080/nested' },
  ])
    assert.equal((await proxyReturns(request('returns', [id]), [id], config, fetcher)).status, 503);
  assert.equal(calls, 0);
});

test('RMA request boundary rejects unknown fields, duplicate escaped nested keys and oversized or invalid UTF-8 JSON', async () => {
  const path = [orderId, 'returns', 'commands', commandId];
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return upstream(result);
  }) as typeof fetch;
  for (const body of [
    JSON.stringify({ ...create, refundRial: '100' }),
    JSON.stringify({ ...create, acknowledgeNoFinancialAction: false }),
    JSON.stringify(create).replace('"reason":', '"reason":"hidden","rea\\u0073on":'),
    JSON.stringify(create).replace('"quantity":1', '"quantity":1,"QUANTITY":1'),
    JSON.stringify({ ...create, lines: [{ ...create.lines[0], ownerId: 'another' }] }),
    '{"nested":' + '['.repeat(33) + '0' + ']'.repeat(33) + '}',
    '{',
  ])
    assert.equal(
      (
        await proxyOrderReturns(
          request('orders', path, { method: 'PUT', body }),
          path,
          environment,
          fetcher,
        )
      ).status,
      400,
    );
  assert.equal(
    (
      await proxyOrderReturns(
        request('orders', path, { method: 'PUT', body: new Uint8Array([0xff]) }),
        path,
        environment,
        fetcher,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await proxyOrderReturns(
        request('orders', path, { method: 'PUT', body: 'x'.repeat(32769) }),
        path,
        environment,
        fetcher,
      )
    ).status,
    413,
  );
  assert.equal(
    (
      await proxyOrderReturns(
        request('orders', path, {
          method: 'PUT',
          body: '{}',
          headers: { ...headers, 'Content-Type': 'text/plain' },
        }),
        path,
        environment,
        fetcher,
      )
    ).status,
    415,
  );
  assert.equal(calls, 0);
});

test('RMA preserves empty401/403 and installed404 while unknown APIs cannot masquerade as missing requests', async () => {
  for (const status of [401, 403]) {
    const response = await proxyReturns(
      request('returns', [id]),
      [id],
      environment,
      (async () => new Response(null, { status })) as typeof fetch,
    );
    assert.equal(response.status, status);
    assert.equal(await response.text(), '');
  }
  const missing = await proxyReturns(request('returns', [id]), [id], environment, (async () =>
    upstream({ title: 'rma_not_found' }, 404)) as typeof fetch);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { title: 'rma_not_found' });
  assert.equal(
    (
      await proxyReturns(request('returns', [id]), [id], environment, (async () =>
        Response.json({ title: 'not_found' }, { status: 404 })) as typeof fetch)
    ).status,
    503,
  );
});

test('RMA response boundary fails closed on cookies, redirects, foreign contracts, ambiguous JSON and both size paths', async () => {
  const marked = { 'X-Sayman-Returns-Contract': 'rma-v1', 'Content-Type': 'application/json' };
  for (const upstreamResponse of [
    () => Response.json(detail),
    () => upstream(detail, 200, { 'Set-Cookie': 'forbidden=1' }),
    () => upstream(detail, 200, { 'X-Sayman-Returns-Contract': 'other-v1' }),
    () =>
      new Response(JSON.stringify(detail), { headers: { ...marked, 'Content-Type': 'text/html' } }),
    () => new Response(new Uint8Array([0xff]), { headers: marked }),
    () => new Response('{', { headers: marked }),
    () =>
      new Response(
        JSON.stringify(detail).replace('"schemaVersion":1', '"schemaVersion":1,"SchemaVersion":1'),
        { headers: marked },
      ),
    () => upstream(detail, 200, { 'Content-Length': '2097153' }),
    () => new Response('x'.repeat(2097153), { headers: marked }),
    () => new Response(null, { status: 302, headers: { Location: 'https://evil.example' } }),
    () =>
      new Response('<html>Unavailable</html>', {
        status: 503,
        headers: { 'Content-Type': 'text/html' },
      }),
  ]) {
    const response = await proxyReturns(request('returns', [id]), [id], environment, (async () =>
      upstreamResponse()) as typeof fetch);
    assert.equal(response.status, 503);
    assert.equal(response.headers.has('Set-Cookie'), false);
    assert.match(response.headers.get('Cache-Control')!, /private, no-store/);
  }
});

test('RMA accepts a valid historical detail at the exact2MiB response bound without truncation', async () => {
  const large = {
    ...detail,
    case: { ...summary, itemCount: 4 },
    lines: Array.from({ length: 4 }, (_, i) => ({
      ...identity,
      lineKey: 'line-' + i,
      variantId: 'variant-' + i,
      quantity: 1,
      label: '',
    })),
  };
  let remaining = 2097152 - new TextEncoder().encode(JSON.stringify(large)).byteLength;
  for (const line of large.lines) {
    const size = Math.min(524288, remaining);
    line.label = 'x'.repeat(size);
    remaining -= size;
  }
  assert.equal(remaining, 0);
  assert.equal(new TextEncoder().encode(JSON.stringify(large)).byteLength, 2097152);
  const response = await proxyReturns(request('returns', [id]), [id], environment, (async () =>
    upstream(large)) as typeof fetch);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), large);
});
