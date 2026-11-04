import test from 'node:test';
import assert from 'node:assert/strict';
import { adminRequestHeaders } from '../src/api/request-headers.ts';
test('native Headers retain SignalR text framing and the current admin bearer', () => {
  const headers = adminRequestHeaders(
    '{"type":6}\x1e',
    'current-token',
    new Headers({
      'Content-Type': 'text/plain;charset=UTF-8',
      'X-SignalR-User-Agent': 'synthetic-test',
    }),
  );
  assert.equal(headers.get('Content-Type'), 'text/plain;charset=UTF-8');
  assert.equal(headers.get('Authorization'), 'Bearer current-token');
  assert.equal(headers.get('X-Sayman-Client'), 'admin');
  assert.equal(headers.get('X-SignalR-User-Agent'), 'synthetic-test');
});
test('JSON defaults, array headers and multipart boundaries retain their existing semantics', () => {
  assert.equal(adminRequestHeaders('{}', 'token').get('Content-Type'), 'application/json');
  assert.equal(
    adminRequestHeaders(undefined, 'token', [['Content-Type', 'text/plain']]).get('Content-Type'),
    'text/plain',
  );
  assert.equal(adminRequestHeaders(new FormData(), 'token').has('Content-Type'), false);
  assert.equal(adminRequestHeaders(undefined, '').has('Authorization'), false);
});
