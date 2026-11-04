import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPrivateRealtimePath,
  realtimeNegotiationSchema,
  realtimePulseSchema,
  validRealtimeClientFrames,
  validRealtimeServerFrames,
} from '@sayman/web-shared/lib/notifications/realtime-contract.ts';
const token = 'a'.repeat(80),
  path = '/api/realtime?id=' + token;
test('private realtime paths cannot carry JWT, owner, other origin, duplicate id or unsupported transport', () => {
  for (const [url, method] of [
    [path, 'GET'],
    [path + '&_=1234567890', 'GET'],
    [path, 'POST'],
    [path, 'DELETE'],
    ['/api/realtime/negotiate?negotiateVersion=1', 'POST'],
  ])
    assert.equal(isPrivateRealtimePath(url, method), true, url);
  for (const [url, method] of [
    [path + '&access_token=secret', 'GET'],
    [path + '&owner=other', 'GET'],
    [path + '&id=' + token, 'GET'],
    [path + '&_=1', 'POST'],
    ['/api/admin/realtime?id=' + token, 'GET'],
    ['https://other.invalid' + path, 'GET'],
    ['/api/realtime/negotiate?negotiateVersion=0', 'POST'],
    ['/api/realtime/negotiate?negotiateVersion=1&useStatefulReconnect=true', 'POST'],
    ['/api/realtime?id=small', 'GET'],
    [path, 'PUT'],
  ])
    assert.equal(isPrivateRealtimePath(url, method), false, url);
  assert.equal(isPrivateRealtimePath('/api/admin/realtime?id=' + token, 'GET', true), true);
});
test('negotiation only allows bounded opaque tokens and the explicitly selected standard transport', () => {
  const value = {
    negotiateVersion: 1,
    connectionId: 'b'.repeat(22),
    connectionToken: token,
    availableTransports: [{ transport: 'LongPolling', transferFormats: ['Text', 'Binary'] }],
  };
  assert.deepEqual(realtimeNegotiationSchema.parse(value), value);
  for (const bad of [
    { ...value, accessToken: 'private' },
    { ...value, url: 'https://other.invalid' },
    { ...value, availableTransports: [{ transport: 'WebSockets', transferFormats: ['Text'] }] },
    { ...value, connectionToken: 'Bearer secret' },
    { ...value, connectionToken: 'x'.repeat(4097) },
  ])
    assert.equal(realtimeNegotiationSchema.safeParse(bad).success, false);
});
test('transport frames cannot invoke commands and update pulses contain no private identifiers', () => {
  for (const frame of ['{"protocol":"json","version":1}\x1e', '{"type":6}\x1e{"type":7}\x1e'])
    assert.equal(validRealtimeClientFrames(frame), true);
  for (const frame of [
    '{"type":1,"target":"JoinGroup","arguments":["other"]}\x1e',
    '{"type":6,"owner":"other"}\x1e',
    '{"protocol":"messagepack","version":1}\x1e',
    '{"type":6}',
  ])
    assert.equal(validRealtimeClientFrames(frame), false);
  assert.equal(
    validRealtimeServerFrames(
      '{"type":1,"target":"Changed","arguments":[{"schemaVersion":1,"scope":"support"}]}\x1e',
    ),
    true,
  );
  assert.equal(validRealtimeServerFrames('{}\x1e'), true);
  assert.equal(validRealtimeServerFrames(''), true);
  assert.equal(
    validRealtimeServerFrames(
      '{"type":1,"target":"Changed","arguments":[{"schemaVersion":1,"scope":"support","ticketId":"private"}]}\x1e',
    ),
    false,
  );
  assert.equal(
    realtimePulseSchema.safeParse({ schemaVersion: 1, scope: 'support', owner: 'other' }).success,
    false,
  );
  assert.equal(
    realtimePulseSchema.safeParse({ schemaVersion: 1, scope: 'payments' }).success,
    false,
  );
});
