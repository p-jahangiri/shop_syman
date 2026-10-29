import assert from 'node:assert/strict';
import test from 'node:test';
import { proxyTicket } from './ticket-proxy.ts';
const origin = 'http://127.0.0.1:3105',
  env = { SHOP_PUBLIC_URL: origin, SHOP_API_URL: 'http://127.0.0.1:5181', SHOP_DATA_MODE: 'api' },
  id = 'a'.repeat(32),
  cmd = 'b'.repeat(32),
  token = 'Bearer ' + 'q'.repeat(40),
  summary = {
    id,
    subject: 'private subject',
    locale: 'en',
    state: 'Open',
    version: 'AAAAAAAAAAE=',
    messageCount: 1,
    createdAt: '2026-10-26T00:00:00Z',
    changedAt: '2026-10-26T00:00:00Z',
  },
  body = { subject: 'private subject', body: 'Private message', locale: 'en' };
const request = (path: string, method = 'GET', value?: unknown) =>
  new Request(origin + '/api/support/' + path, {
    method,
    headers: {
      Authorization: token,
      Origin: origin,
      'Content-Type': 'application/json',
      Cookie: 'must-not-leave-browser',
    },
    ...(value ? { body: JSON.stringify(value) } : {}),
  });
test('support proxy forwards only bearer and normalized command with bounded private response', async () => {
  let calls = 0;
  const response = await proxyTicket(
    request('tickets/commands/' + cmd, 'POST', body),
    ['tickets', 'commands', cmd],
    env,
    async (url, init) => {
      calls++;
      assert.equal(url, env.SHOP_API_URL + '/api/support/tickets/commands/' + cmd);
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('Cookie'), null);
      assert.equal(headers.get('Authorization'), token);
      assert.equal(init?.credentials, 'omit');
      assert.equal(init?.redirect, 'error');
      assert.equal(init?.cache, 'no-store');
      assert.equal(init?.body, JSON.stringify(body));
      return Response.json({
        schemaVersion: 1,
        replayed: false,
        commandId: cmd,
        ticket: summary,
        messageId: 'c'.repeat(32),
      });
    },
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control') ?? '', /private, no-store/);
  assert.equal(calls, 1);
});
test('forged owner, unsupported action and foreign origins cannot reach the upstream', async () => {
  const never: typeof fetch = async () => {
    throw Error('Must not call');
  };
  for (const [req, path, status] of [
    [
      request('tickets/commands/' + cmd, 'POST', { ...body, ownerId: 'other' }),
      ['tickets', 'commands', cmd],
      400,
    ],
    [request('tickets/' + id, 'DELETE'), ['tickets', id], 404],
    [
      new Request(origin + '/api/support/tickets', {
        headers: { Authorization: token, Origin: 'https://foreign.invalid' },
      }),
      ['tickets'],
      403,
    ],
  ] as const) {
    const response = await proxyTicket(req, [...path], env, never);
    assert.equal(response.status, status);
  }
});
test('a successful response with another ticket, private fields, bad UTF8 or oversized body fails closed', async () => {
  for (const value of [
    { schemaVersion: 1, ticket: { ...summary, id: cmd } },
    { schemaVersion: 1, ticket: { ...summary, ownerId: 'private' } },
    null,
  ]) {
    const response = await proxyTicket(request('tickets/' + id), ['tickets', id], env, async () =>
      value === null
        ? new Response(new Uint8Array([0xff]), { headers: { 'Content-Type': 'application/json' } })
        : Response.json(value),
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { title: 'ticket_unavailable' });
  }
  const large = await proxyTicket(
    request('tickets/' + id),
    ['tickets', id],
    env,
    async () =>
      new Response('x'.repeat(1048577), { headers: { 'Content-Type': 'application/json' } }),
  );
  assert.equal(large.status, 503);
});
