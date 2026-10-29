import test from 'node:test';
import assert from 'node:assert/strict';
import {
  notificationSchema,
  notificationPageSchema,
  notificationCountSchema,
  notificationTicks,
  readNotifications,
  readNotificationResult,
} from './notification-contract.ts';
import { isCustomerNotificationPath } from './notification-path.ts';
const row = () => ({
  id: 'a'.repeat(32),
  sequence: '9007199254740993',
  ticketId: 'b'.repeat(32),
  kind: 'support_reply',
  at: '2026-10-26T00:00:00.1234567+00:00',
  readAt: null,
});
test('private notification DTO preserves Int64 and refuses owner, message, invented kinds and reversed time', () => {
  const value = row();
  assert.deepEqual(notificationSchema.parse(value), value);
  for (const bad of [
    { ...value, ownerId: 'other' },
    { ...value, body: 'private' },
    { ...value, sequence: Number('9007199254740993') },
    { ...value, sequence: '9223372036854775808' },
    { ...value, kind: 'payment_success' },
    { ...value, readAt: '2026-10-26T00:00:00.1234566Z' },
    { ...value, id: '0'.repeat(32) },
    { ...value, at: 'invalid', readAt: 'invalid' },
  ])
    assert.equal(notificationSchema.safeParse(bad).success, false);
  assert.equal(
    notificationTicks('2026-10-26T00:00:00.1234567Z') -
      notificationTicks('2026-10-26T00:00:00.1234566Z'),
    1n,
  );
  assert.equal(
    notificationCountSchema.safeParse({ schemaVersion: 1, unreadCount: '0' }).success,
    true,
  );
  assert.equal(
    notificationCountSchema.safeParse({ schemaVersion: 1, unreadCount: 0 }).success,
    false,
  );
});
test('inbox filter, order, page boundary and acknowledgement id must match the request', () => {
  const page = { schemaVersion: 1, unreadOnly: true, items: [row()], nextCursor: null };
  assert.deepEqual(readNotifications(page, true), page);
  assert.throws(() => readNotifications(page, false));
  assert.equal(notificationPageSchema.safeParse({ ...page, nextCursor: 'invalid' }).success, false);
  assert.equal(
    notificationPageSchema.safeParse({ ...page, items: [row(), { ...row(), sequence: 'bad' }] })
      .success,
    false,
  );
  assert.equal(notificationPageSchema.safeParse({ ...page, items: [row(), row()] }).success, false);
  assert.equal(
    notificationPageSchema.safeParse({ ...page, items: [{ ...row(), readAt: row().at }] }).success,
    false,
  );
  const cursor = btoa('1:' + 'A'.repeat(64) + ':9007199254740993');
  assert.throws(() => readNotifications(page, true, cursor));
  const result = { schemaVersion: 1, notification: { ...row(), readAt: row().at } };
  assert.deepEqual(readNotificationResult(result, row().id), result);
  assert.throws(() => readNotificationResult(result, 'f'.repeat(32)));
  assert.throws(() => readNotificationResult({ ...result, notification: row() }, row().id));
});
test('private path allowlist only accepts exact inbox reads and explicit mark-read operations', () => {
  for (const path of [
    '/api/notifications',
    '/api/notifications?unreadOnly=true',
    '/api/notifications/unread-count',
  ])
    assert.equal(isCustomerNotificationPath(path), true, path);
  assert.equal(isCustomerNotificationPath('/api/notifications/' + row().id + '/read', 'PUT'), true);
  for (const [path, method] of [
    ['/api/notifications?owner=other', 'GET'],
    ['/api/notifications?unreadOnly=1', 'GET'],
    ['/api/notifications?unreadOnly=true&unreadOnly=false', 'GET'],
    ['/api/notifications?cursor=invalid', 'GET'],
    ['/api/notifications/other', 'GET'],
    ['/api/notifications/' + row().id + '/read', 'POST'],
    ['/api/notifications/' + '0'.repeat(32) + '/read', 'PUT'],
    ['/api/notifications/%2e%2e/auth', 'GET'],
    ['/api/notifications/unread-count?cursor=x', 'GET'],
    ['/api/notifications#private', 'GET'],
  ])
    assert.equal(isCustomerNotificationPath(path, method), false, path);
});
