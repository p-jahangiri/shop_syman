import test from 'node:test';
import assert from 'node:assert/strict';
import { proxyNotifications } from '../lib/notifications/notification-proxy.ts';
const origin = 'http://127.0.0.1:3000',
  env = { SHOP_DATA_MODE: 'api', SHOP_API_URL: 'http://127.0.0.1:5080', SHOP_PUBLIC_URL: origin },
  token = 'Bearer ' + 'a'.repeat(40),
  id = 'b'.repeat(32),
  at = '2026-10-26T00:00:00Z',
  notification = {
    id,
    sequence: '1',
    ticketId: 'c'.repeat(32),
    kind: 'support_reply',
    at,
    readAt: at,
  };
const request = (path = '', method = 'GET', body?: unknown) =>
  new Request(origin + '/api/notifications' + path, {
    method,
    headers: {
      Authorization: token,
      Origin: origin,
      Cookie: 'private=never-forward',
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
test('inbox BFF forwards only bearer and exact {} acknowledgement, with bounded private replies', async () => {
  const response = await proxyNotifications(
    request('/' + id + '/read', 'PUT', {}),
    [id, 'read'],
    env,
    async (url, init) => {
      assert.equal(url, 'http://127.0.0.1:5080/api/notifications/' + id + '/read');
      const h = new Headers(init?.headers);
      assert.equal(h.get('Cookie'), null);
      assert.equal(h.get('Authorization'), token);
      assert.equal(init?.body, '{}');
      assert.equal(init?.credentials, 'omit');
      assert.equal(init?.redirect, 'error');
      assert.equal(init?.cache, 'no-store');
      return Response.json({ schemaVersion: 1, notification });
    },
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control') ?? '', /private, no-store/);
  assert.match(response.headers.get('X-Robots-Tag') ?? '', /noindex/);
});
test('forged input, foreign origin, wrong method and malformed upstream cannot reveal data', async () => {
  const never: typeof fetch = async () => {
    throw Error('Unexpected request');
  };
  assert.equal(
    (
      await proxyNotifications(
        request('/' + id + '/read', 'PUT', { ownerId: 'other' }),
        [id, 'read'],
        env,
        never,
      )
    ).status,
    400,
  );
  assert.equal(
    (await proxyNotifications(request('/' + id + '/read', 'POST', {}), [id, 'read'], env, never))
      .status,
    404,
  );
  assert.equal(
    (
      await proxyNotifications(
        new Request(origin + '/api/notifications', {
          headers: { Origin: 'https://other.invalid', Authorization: token },
        }),
        [],
        env,
        never,
      )
    ).status,
    403,
  );
  for (const value of [
    { schemaVersion: 1, notification: { ...notification, id: 'f'.repeat(32) } },
    { schemaVersion: 1, notification: { ...notification, ownerId: 'other' } },
    { schemaVersion: 1, notification: { ...notification, readAt: null } },
  ])
    assert.equal(
      (
        await proxyNotifications(
          request('/' + id + '/read', 'PUT', {}),
          [id, 'read'],
          env,
          async () => Response.json(value),
        )
      ).status,
      503,
    );
  for (const response of [
    new Response(' '.repeat(65537), { headers: { 'Content-Type': 'application/json' } }),
    new Response(new Uint8Array([0xff]), { headers: { 'Content-Type': 'application/json' } }),
  ])
    assert.equal((await proxyNotifications(request(), [], env, async () => response)).status, 503);
});
