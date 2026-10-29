import test from 'node:test';
import assert from 'node:assert/strict';
import {
  phoneInboxItemSchema,
  phoneInboxPageSchema,
  readPhoneInbox,
  readPhoneInboxAcknowledgement,
} from './phone-inbox-contract.ts';
import { isCustomerNotificationPath } from './notification-path.ts';
import { proxyNotifications } from './notification-proxy.ts';
const id = 'a'.repeat(32),
  configurationId = 'b'.repeat(32),
  origin = 'http://sayman-ui.localhost:3107',
  bearer = 'Bearer ' + 'z'.repeat(40),
  env = { SHOP_API_URL: 'http://127.0.0.1:5080', SHOP_DATA_MODE: 'api', SHOP_PUBLIC_URL: origin };
const item = {
  id,
  sequence: '9007199254740993',
  kind: 'phone_available',
  listingId: 'listing',
  configurationId,
  requestId: null,
  offerId: null,
  storeSlug: 'actual-phone',
  variantId: 'actual-sku',
  at: '2026-10-28T12:00:00.0000001Z',
  readAt: null,
};
const page = { schemaVersion: 1, unreadOnly: false, items: [item], nextCursor: null },
  ack = { schemaVersion: 1, notification: { ...item, readAt: '2026-10-28T12:00:00.0000002Z' } };
const cursor = (before: string, scope = 'A'.repeat(64)) => btoa('1:' + scope + ':' + before);
const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(origin + '/api/notifications/' + path, {
    method,
    headers: {
      Authorization: bearer,
      Origin: origin,
      'Content-Type': 'application/json',
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const never: typeof fetch = async () => {
  throw Error('must not fetch');
};

test('phone inbox schema binds kind-specific targets, strict fields and UTC sub-millisecond chronology', () => {
  assert.equal(phoneInboxItemSchema.safeParse(item).success, true);
  assert.equal(
    phoneInboxItemSchema.safeParse({
      ...item,
      kind: 'sourcing_offer_published',
      requestId: 'c'.repeat(32),
      offerId: 'd'.repeat(32),
      storeSlug: null,
      variantId: null,
    }).success,
    true,
  );
  for (const value of [
    { ...item, storeSlug: null },
    { ...item, requestId: 'c'.repeat(32) },
    { ...item, kind: 'sourcing_offer_published' },
    { ...item, readAt: '2026-10-28T12:00:00.0000000Z' },
    { ...item, at: '2026-10-28T15:30:00+03:30' },
    { ...item, priceRial: '1' },
    { ...item, userId: 'c'.repeat(32) },
    { ...item, sourceUrl: 'https://private.example' },
  ])
    assert.equal(phoneInboxItemSchema.safeParse(value).success, false);
  assert.deepEqual(readPhoneInboxAcknowledgement(ack, id), ack);
  for (const value of [
    { ...ack, notification: item },
    { ...ack, notification: { ...ack.notification, id: configurationId } },
  ])
    assert.throws(() => readPhoneInboxAcknowledgement(value, id));
});

test('phone inbox pagination uses exact descending bigint sequences and a filter-bound fifty-row cursor', () => {
  const rows = Array.from({ length: 50 }, (_, n) => ({
      ...item,
      id: (n + 1).toString(16).padStart(32, '0'),
      sequence: String(9007199254740993n - BigInt(n)),
    })),
    full = { ...page, items: rows, nextCursor: cursor(rows.at(-1)!.sequence) };
  assert.equal(phoneInboxPageSchema.safeParse(full).success, true);
  assert.equal(
    phoneInboxPageSchema.safeParse({ ...full, items: [...rows, rows[0]] }).success,
    false,
  );
  for (const value of [
    { ...page, items: [item, item] },
    { ...page, items: [{ ...item, sequence: '1' }, item] },
    { ...page, nextCursor: cursor('1') },
    { ...full, nextCursor: cursor('1') },
    { ...page, unreadOnly: true, items: [ack.notification] },
  ])
    assert.equal(phoneInboxPageSchema.safeParse(value).success, false);
  assert.throws(() => readPhoneInbox(page, true));
  assert.throws(() => readPhoneInbox(page, false, cursor(item.sequence)));
  assert.throws(() => readPhoneInbox(full, false, cursor('9007199254740994', 'B'.repeat(64))));
  assert.deepEqual(readPhoneInbox(page, false, cursor('9007199254740994')), page);
});

test('phone notification transport allowlist accepts only inbox, count and exact read routes', () => {
  for (const path of [
    '/api/notifications/phones',
    '/api/notifications/phones?unreadOnly=true',
    '/api/notifications/phones?cursor=' + encodeURIComponent(cursor('50')),
    '/api/notifications/phones/unread-count',
  ])
    assert.equal(isCustomerNotificationPath(path), true, path);
  assert.equal(
    isCustomerNotificationPath('/api/notifications/phones/' + id + '/read', 'PUT'),
    true,
  );
  for (const [path, method] of [
    ['/api/notifications/phones?owner=' + id, 'GET'],
    ['/api/notifications/phones?unreadOnly=true&unreadOnly=false', 'GET'],
    ['/api/notifications/phones?cursor=bad', 'GET'],
    ['/api/notifications/phones/unread-count?cursor=' + encodeURIComponent(cursor('50')), 'GET'],
    ['/api/notifications/phones/' + id + '/read?owner=' + id, 'PUT'],
    ['/api/notifications/phones/' + '0'.repeat(32) + '/read', 'PUT'],
    ['/api/notifications/phones/' + id + '/read', 'POST'],
    ['/api/notifications/phones/../unread-count', 'GET'],
    ['/api/notifications/phones#private', 'GET'],
    ['https://other.example/api/notifications/phones', 'GET'],
  ])
    assert.equal(isCustomerNotificationPath(path, method), false, path);
});

test('phone inbox BFF requires bearer and Origin, strips cookies and forwards only same-owner authority', async () => {
  assert.equal(
    (
      await proxyNotifications(
        req('GET', 'phones', undefined, { Authorization: '', Cookie: 'session=private' }),
        ['phones'],
        env,
        never,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await proxyNotifications(
        req('PUT', 'phones/' + id + '/read', {}, { Origin: 'https://other.example' }),
        ['phones', id, 'read'],
        env,
        never,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await proxyNotifications(
        req('PUT', 'phones/' + id + '/read', { owner: configurationId }),
        ['phones', id, 'read'],
        env,
        never,
      )
    ).status,
    400,
  );
  const response = await proxyNotifications(
    req('GET', 'phones', undefined, { Cookie: 'session=private', 'X-Sayman-Admin': '1' }),
    ['phones'],
    env,
    async (url, init) => {
      assert.equal(url, env.SHOP_API_URL + '/api/notifications/phones');
      const h = new Headers(init?.headers);
      assert.equal(h.get('Authorization'), bearer);
      assert.equal(h.get('Origin'), origin);
      assert.equal(h.get('X-Sayman-Client'), 'storefront');
      for (const key of ['Cookie', 'X-Sayman-Admin', 'Host']) assert.equal(h.has(key), false);
      assert.equal(init?.credentials, 'omit');
      assert.equal(init?.cache, 'no-store');
      assert.equal(init?.redirect, 'error');
      return Response.json(page);
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('Vary'), 'Cookie, Authorization');
  assert.equal(response.headers.has('Set-Cookie'), false);
  assert.match(response.headers.get('X-Robots-Tag')!, /noindex/);
});

test('phone inbox BFF rejects foreign acknowledgements, filter drift, cookies, oversized and malformed private data', async () => {
  const path = ['phones', id, 'read'];
  assert.equal(
    (
      await proxyNotifications(req('PUT', path.join('/'), {}), path, env, async () =>
        Response.json(ack),
      )
    ).status,
    200,
  );
  for (const value of [
    { ...ack, notification: { ...ack.notification, id: configurationId } },
    { ...ack, notification: item },
    { ...ack, owner: configurationId },
  ])
    assert.equal(
      (
        await proxyNotifications(req('PUT', path.join('/'), {}), path, env, async () =>
          Response.json(value),
        )
      ).status,
      503,
    );
  for (const response of [
    Response.json(page, { headers: { 'Set-Cookie': 'secret=private' } }),
    Response.json(page, { headers: { 'Content-Length': '65537' } }),
    new Response(' '.repeat(65537), { headers: { 'Content-Type': 'application/json' } }),
    new Response(new Uint8Array([255]), { headers: { 'Content-Type': 'application/json' } }),
    Response.json({ ...page, owner: configurationId }),
  ])
    assert.equal(
      (await proxyNotifications(req('GET', 'phones'), ['phones'], env, async () => response))
        .status,
      503,
    );
  assert.equal(
    (
      await proxyNotifications(req('GET', 'phones?unreadOnly=true'), ['phones'], env, async () =>
        Response.json(page),
      )
    ).status,
    503,
  );
  const denied = await proxyNotifications(req('GET', 'phones'), ['phones'], env, async () =>
    Response.json({ title: 'forbidden', detail: 'private database diagnostics' }, { status: 403 }),
  );
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { title: 'forbidden' });
});
