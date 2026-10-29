import { CapturedValues } from './captured-values.mts';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  readNotifications,
  readNotificationResult,
  notificationCountSchema,
  notificationPageSchema,
  notificationReadSchema,
} from '../apps/storefront/lib/notification-contract.ts';
const dir = process.argv[2];
assert.ok(dir);
const entries = [],
  values = new CapturedValues();
for (const name of [
  'all',
  'unread-count',
  'unread',
  'other-owner',
  'read',
  'read-concurrent',
  'read-repeat',
  'count-after-read',
  'unread-after-read',
]) {
  const raw = await readFile(`${dir}/${name}.json`),
    meta = JSON.parse(await readFile(`${dir}/${name}.meta.json`, 'utf8')),
    value = JSON.parse(raw.toString('utf8'));
  assert.equal(meta.actualSqlHttpResponse, true);
  assert.equal(meta.syntheticQaOnly, true);
  assert.equal(meta.status, 200);
  assert.match(meta.cacheControl, /no-store/);
  if (meta.method === 'PUT') readNotificationResult(value, meta.path.split('/')[3]);
  else if (meta.path.endsWith('/unread-count')) notificationCountSchema.parse(value);
  else readNotifications(value, meta.path.includes('unreadOnly=true'));
  values.set(name, value);
  entries.push({ name, sha256: createHash('sha256').update(raw).digest('hex'), ...meta });
}
assert.equal(values.read('all', notificationPageSchema).items.length, 3);
assert.deepEqual(
  values.read('all', notificationPageSchema).items.map((x) => x.kind),
  ['support_reopened', 'support_closed', 'support_reply'],
);
assert.equal(values.read('unread-count', notificationCountSchema).unreadCount, '3');
assert.equal(values.read('count-after-read', notificationCountSchema).unreadCount, '0');
assert.deepEqual(
  values.read('read', notificationReadSchema),
  values.read('read-concurrent', notificationReadSchema),
);
assert.deepEqual(
  values.read('read', notificationReadSchema),
  values.read('read-repeat', notificationReadSchema),
);
assert.equal(values.read('other-owner', notificationPageSchema).items.length, 0);
assert.equal(values.read('unread-after-read', notificationPageSchema).items.length, 0);
await writeFile(
  `${dir}/acceptance.json`,
  JSON.stringify(
    {
      passed: true,
      responses: 9,
      actualSqlHttpResponseBodies: true,
      rawBodiesUnmodified: true,
      strictProductionDecoders: true,
      noOwnerOrMessageFields: true,
      concurrentAndRepeatedReadTimestampExact: true,
      otherOwnerEmpty: true,
      syntheticQaOnly: true,
      entries,
    },
    null,
    2,
  ) + '\n',
);
console.log('9 real SQL HTTP notification responses passed production decoders.');
