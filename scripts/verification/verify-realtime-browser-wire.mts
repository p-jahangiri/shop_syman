import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  readNotifications,
  readNotificationResult,
  notificationCountSchema,
} from '@sayman/web-shared/lib/notifications/notification-contract.ts';
import {
  readTicketPage,
  readTicketDetail,
  readTicketMessages,
  readTicketResult,
  ticketCreateSchema,
  ticketReplySchema,
  ticketStateInputSchema,
  type TicketCommand,
} from '@sayman/web-shared/lib/support/ticket-contract.ts';
import {
  validRealtimeServerFrames,
  realtimePulseSchema,
} from '@sayman/web-shared/lib/notifications/realtime-contract.ts';
const dir = process.argv[2];
assert.ok(dir);
const sha = (raw: Uint8Array) => createHash('sha256').update(raw).digest('hex');
const commands = new Map<string, { command: TicketCommand; result: unknown }>(),
  entries = [],
  pages = [],
  counts = [],
  reads = [],
  messages = new Set<string>();
let receipts = 0,
  ticketId: string | undefined;
for (const file of (await readdir(dir))
  .filter((x) => /^\d+\.meta\.json$/.test(x))
  .sort((a, b) => parseInt(a) - parseInt(b))) {
  const n = parseInt(file),
    meta = JSON.parse(await readFile(`${dir}/${file}`, 'utf8')),
    raw = await readFile(`${dir}/${n}.response.json`),
    value = JSON.parse(raw.toString('utf8'));
  assert.equal(meta.syntheticQaOnly, true);
  assert.equal(meta.status, 200);
  assert.match(meta.cacheControl, /no-store/);
  assert.equal(sha(raw), meta.responseSha256);
  let body: unknown;
  if (meta.requestSha256) {
    const bytes = await readFile(`${dir}/${n}.request.json`);
    assert.equal(sha(bytes), meta.requestSha256);
    body = JSON.parse(bytes.toString('utf8'));
  }
  const url = new URL(meta.path, 'http://localhost'),
    s = url.pathname.split('/').filter(Boolean),
    staff = s[1] === 'admin';
  if (s[1] === 'notifications') {
    if (meta.method === 'PUT') {
      assert.deepEqual(body, {});
      reads.push({ meta, result: readNotificationResult(value, s[2]) });
    } else if (s[2] === 'unread-count') counts.push(notificationCountSchema.parse(value));
    else
      pages.push(
        readNotifications(
          value,
          url.searchParams.get('unreadOnly') === 'true',
          url.searchParams.get('cursor'),
        ),
      );
  } else {
    const path = s.slice(staff ? 3 : 2);
    if (meta.method !== 'GET') {
      const command: TicketCommand =
        path[1] === 'commands'
          ? { kind: 'create', staff: false, id: path[2], body: ticketCreateSchema.parse(body) }
          : path[2] === 'replies'
            ? {
                kind: 'reply',
                staff,
                ticketId: path[1],
                id: path[3],
                body: ticketReplySchema.parse(body),
              }
            : {
                kind: 'state',
                staff,
                ticketId: path[1],
                id: path[3],
                body: ticketStateInputSchema.parse(body),
              };
      const result = readTicketResult(value, command),
        key = staff + ':' + command.id;
      assert.ok(!commands.has(key), 'No implicit duplicate command POST');
      commands.set(key, { command, result });
      ticketId ??= result.ticket.id;
      assert.equal(result.ticket.id, ticketId);
    } else if (path[0] === 'commands') {
      const previous = commands.get(staff + ':' + path[1]);
      assert.ok(previous);
      const result = readTicketResult(value, previous.command);
      assert.equal(result.replayed, true);
      assert.deepEqual(
        { ...result, replayed: false },
        { ...(previous.result as object), replayed: false },
      );
      receipts++;
    } else if (path.length === 1) readTicketPage(value, url.searchParams.get('state'), staff);
    else if (path[2] === 'messages') {
      for (const item of readTicketMessages(value, path[1]).items) messages.add(item.id);
    } else readTicketDetail(value, path[1]);
  }
  entries.push(meta);
}
assert.equal(commands.size, 5);
assert.equal(receipts, 1);
assert.equal(messages.size, 3);
assert.equal(reads.length, 1);
assert.equal(reads[0].meta.droppedAfterCommittedSuccess, true);
assert.equal(entries.filter((x) => x.droppedAfterCommittedSuccess).length, 2);
assert.ok(entries.some((x) => x.dropKind === 'reply'));
assert.ok(entries.some((x) => x.dropKind === 'read'));
assert.equal(pages.at(-1)!.items.length, 3);
assert.equal(pages.at(-1)!.items.filter((x) => x.readAt === null).length, 2);
assert.deepEqual(
  pages.at(-1)!.items.map((x) => x.kind),
  ['support_reopened', 'support_closed', 'support_reply'],
);
assert.equal(counts.at(-1)!.unreadCount, '2');
assert.ok(
  pages.some(
    (x) => x.items.length === 1 && x.items[0].readAt === reads[0].result.notification.readAt,
  ),
);
let owner = false,
  staff = false,
  negotiations = 0,
  frames = 0;
const transports = [];
for (const file of (await readdir(dir + '/transport')).filter((x) =>
  /^\d+\.transport\.meta\.json$/.test(x),
)) {
  const meta = JSON.parse(await readFile(`${dir}/transport/${file}`, 'utf8'));
  assert.ok([200, 202].includes(meta.status));
  assert.equal(meta.syntheticQaOnly, true);
  assert.equal(meta.noCookieForwarded, true);
  assert.equal(meta.noNegotiationOrQueryTokensPersisted, true);
  assert.match(
    meta.path,
    /^\/api\/(?:admin\/)?realtime(?:\?id=\[private\]|\/negotiate\?negotiateVersion=1)$/,
  );
  assert.match(meta.cacheControl, /no-store/);
  if (meta.path.includes('/negotiate')) negotiations++;
  transports.push(meta);
}
for (const file of (await readdir(dir + '/transport')).filter((x) => x.endsWith('.frame.txt'))) {
  const raw = await readFile(`${dir}/transport/${file}`),
    meta = JSON.parse(
      await readFile(`${dir}/transport/${file.replace('.frame.txt', '.frame.meta.json')}`, 'utf8'),
    ),
    text = raw.toString('utf8');
  assert.equal(meta.sha256, sha(raw));
  assert.equal(meta.queryTokenNeverPersisted, true);
  assert.ok(validRealtimeServerFrames(text));
  assert.doesNotMatch(text, /connectionToken|accessToken|Bearer|ownerId|ticketId|subject|body/);
  for (const part of text.split('\x1e').filter(Boolean)) {
    const frame = JSON.parse(part);
    if (frame.type === 1) {
      realtimePulseSchema.parse(frame.arguments[0]);
      if (meta.path.startsWith('/api/admin/')) staff = true;
      else owner = true;
    }
  }
  frames++;
}
assert.ok(owner && staff);
assert.ok(negotiations >= 7);
const report = {
  passed: true,
  responses: entries.length,
  inputs: 6,
  commands: 5,
  receiptReads: receipts,
  uniqueMessages: messages.size,
  notifications: 3,
  unread: 2,
  readMutationRetried: false,
  committedResponsesLost: 2,
  transportResponses: transports.length,
  negotiations,
  eventBatches: frames,
  ownerAndStaffPulses: true,
  strictProductionDecoders: true,
  noNegotiationOrConnectionTokensPersisted: true,
  rawBodiesUnmodified: true,
  syntheticQaOnly: true,
  entries,
  transports,
};
await writeFile(dir + '/acceptance.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, entries: undefined, transports: undefined }));
