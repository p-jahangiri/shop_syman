import test from 'node:test';
import assert from 'node:assert/strict';
import { proxyPrivateRealtime } from '../lib/notifications/realtime-proxy.ts';
const origin = 'http://127.0.0.1:3000',
  environment = {
    SHOP_DATA_MODE: 'api',
    SHOP_API_URL: 'http://127.0.0.1:5080',
    SHOP_PUBLIC_URL: origin,
  },
  token = 'a'.repeat(100),
  bearer = 'Bearer ' + 'b'.repeat(40),
  negotiation = {
    negotiateVersion: 1,
    connectionId: 'c'.repeat(22),
    connectionToken: token,
    availableTransports: [{ transport: 'LongPolling', transferFormats: ['Text', 'Binary'] }],
  };
const request = (path: string, method = 'GET', body?: string) =>
  new Request(origin + '/api/realtime' + path, {
    method,
    headers: {
      Authorization: bearer,
      Origin: origin,
      Cookie: 'private=never-forward',
      'Content-Type': 'text/plain;charset=UTF-8',
    },
    ...(body === undefined ? {} : { body }),
  });
test('realtime BFF preserves bearer-only negotiation and standard framed transport without forwarding cookies', async () => {
  let calls = 0;
  const response = await proxyPrivateRealtime(
    request('/negotiate?negotiateVersion=1', 'POST'),
    environment,
    async (url, init) => {
      calls++;
      assert.equal(url, 'http://127.0.0.1:5080/api/realtime/negotiate?negotiateVersion=1');
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('Authorization'), bearer);
      assert.equal(headers.get('Cookie'), null);
      assert.equal(init?.cache, 'no-store');
      assert.equal(init?.credentials, 'omit');
      assert.equal(init?.redirect, 'error');
      return Response.json(negotiation);
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), negotiation);
  assert.equal(calls, 1);
  assert.match(response.headers.get('Cache-Control') ?? '', /private, no-store/);
  const frames =
    '{"type":1,"target":"Changed","arguments":[{"schemaVersion":1,"scope":"support"}]}\x1e';
  const poll = await proxyPrivateRealtime(
    request('?id=' + token),
    environment,
    async () =>
      new Response(frames, {
        headers: { 'Content-Type': 'text/plain', 'Set-Cookie': 'must-not-forward=1' },
      }),
  );
  assert.equal(poll.status, 200);
  assert.equal(await poll.text(), frames);
  assert.equal(poll.headers.get('Set-Cookie'), null);
});
test('client invocation, JWT query, missing bearer and foreign origin are rejected before upstream', async () => {
  const never: typeof fetch = async () => {
    throw Error('Unexpected upstream');
  };
  assert.equal(
    (
      await proxyPrivateRealtime(
        request(
          '?id=' + token,
          'POST',
          '{"type":1,"target":"JoinGroup","arguments":["other"]}\x1e',
        ),
        environment,
        never,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await proxyPrivateRealtime(
        request('?id=' + token + '&access_token=secret'),
        environment,
        never,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await proxyPrivateRealtime(
        new Request(origin + '/api/realtime?id=' + token),
        environment,
        never,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await proxyPrivateRealtime(
        new Request(origin + '/api/realtime?id=' + token, {
          headers: { Authorization: bearer, Origin: 'https://foreign.invalid' },
        }),
        environment,
        never,
      )
    ).status,
    403,
  );
});
test('unknown negotiation, redirects, private fields, invalid frames and oversized responses fail closed', async () => {
  for (const bad of [
    { ...negotiation, accessToken: 'private' },
    { url: 'https://other.invalid', accessToken: 'private' },
    {
      ...negotiation,
      availableTransports: [{ transport: 'WebSockets', transferFormats: ['Text'] }],
    },
  ])
    assert.equal(
      (
        await proxyPrivateRealtime(
          request('/negotiate?negotiateVersion=1', 'POST'),
          environment,
          async () => Response.json(bad),
        )
      ).status,
      503,
    );
  for (const raw of [
    '{"type":1,"target":"Changed","arguments":[{"schemaVersion":1,"scope":"support","owner":"other"}]}\x1e',
    'x'.repeat(65537),
  ])
    assert.equal(
      (
        await proxyPrivateRealtime(
          request('?id=' + token),
          environment,
          async () => new Response(raw),
        )
      ).status,
      503,
    );
  assert.equal(
    (
      await proxyPrivateRealtime(
        request('?id=' + token),
        environment,
        async () => new Response(new Uint8Array([0xff])),
      )
    ).status,
    503,
  );
});
