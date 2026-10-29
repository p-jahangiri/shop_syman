import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  readNotifications,
  readNotificationResult,
  notificationCountSchema,
} from '../apps/storefront/lib/notification-contract.ts';
import {
  readTicketPage,
  readTicketDetail,
  readTicketMessages,
  readTicketResult,
  ticketCreateSchema,
  ticketReplySchema,
  ticketStateInputSchema,
  type TicketCommand,
} from '../apps/storefront/lib/ticket-contract.ts';
const dir = process.argv[2];
assert.ok(dir);
const names = (await readdir(dir))
    .filter((n) => /^\d+\.meta\.json$/.test(n))
    .sort((a, b) => parseInt(a) - parseInt(b)),
  entries = [],
  reads = [],
  writes = [],
  pages = [],
  counts = [];
let ticketId: string | undefined,
  supportResponses = 0;
for (const name of names) {
  const meta = JSON.parse(await readFile(`${dir}/${name}`, 'utf8')),
    id = name.split('.')[0],
    raw = await readFile(`${dir}/${id}.response.json`);
  assert.equal(meta.syntheticQaOnly, true);
  assert.equal(meta.status, 200);
  assert.match(meta.cacheControl, /no-store/);
  assert.equal(createHash('sha256').update(raw).digest('hex'), meta.responseSha256);
  const value = JSON.parse(raw.toString('utf8'));
  let body: unknown;
  if (meta.requestSha256) {
    const bytes = await readFile(`${dir}/${id}.request.json`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), meta.requestSha256);
    body = JSON.parse(bytes.toString('utf8'));
  }
  const url = new URL(meta.path, 'http://localhost'),
    segments = url.pathname.split('/').filter(Boolean),
    staff = segments[1] === 'admin';
  if (segments[1] === 'notifications') {
    if (meta.method === 'PUT') {
      assert.deepEqual(body, {});
      const result = readNotificationResult(value, segments[2]);
      reads.push({ meta, result });
    } else if (segments[2] === 'unread-count') counts.push(notificationCountSchema.parse(value));
    else
      pages.push(
        readNotifications(
          value,
          url.searchParams.get('unreadOnly') === 'true',
          url.searchParams.get('cursor'),
        ),
      );
  } else {
    supportResponses++;
    const path = segments.slice(staff ? 3 : 2);
    if (meta.method !== 'GET') {
      let command: TicketCommand;
      if (path[1] === 'commands')
        command = {
          kind: 'create',
          staff: false,
          id: path[2],
          body: ticketCreateSchema.parse(body),
        };
      else if (path[2] === 'replies')
        command = {
          kind: 'reply',
          staff,
          id: path[3],
          ticketId: path[1],
          body: ticketReplySchema.parse(body),
        };
      else
        command = {
          kind: 'state',
          staff,
          id: path[3],
          ticketId: path[1],
          body: ticketStateInputSchema.parse(body),
        };
      const result = readTicketResult(value, command);
      ticketId ??= result.ticket.id;
      assert.equal(result.ticket.id, ticketId);
      writes.push({ command, result });
    } else if (path.length === 1) readTicketPage(value, url.searchParams.get('state'));
    else if (path[2] === 'messages') readTicketMessages(value, path[1]);
    else readTicketDetail(value, path[1]);
  }
  entries.push({ id, ...meta });
}
assert.equal(writes.length, 4);
assert.equal(reads.length, 2);
assert.equal(reads[0].meta.path, reads[1].meta.path);
assert.equal(reads[0].meta.droppedAfterCommittedSuccess, true);
assert.equal(reads[1].meta.droppedAfterCommittedSuccess, false);
assert.deepEqual(reads[0].result, reads[1].result);
assert.equal(entries.filter((x) => x.droppedAfterCommittedSuccess).length, 1);
assert.ok(pages.some((x) => x.items.length === 0));
const last = pages.at(-1)!;
assert.equal(last.items.length, 3);
assert.equal(last.items.filter((x) => x.readAt === null).length, 2);
assert.equal(new Set(last.items.map((x) => x.id)).size, 3);
assert.ok(last.items.every((x) => x.ticketId === ticketId));
assert.deepEqual(
  last.items.map((x) => x.kind),
  ['support_reopened', 'support_closed', 'support_reply'],
);
assert.equal(counts.at(-1)!.unreadCount, '2');
assert.ok(
  pages.some(
    (x) => x.unreadOnly && x.items.length === 2 && x.items.every((i) => i.readAt === null),
  ),
);
assert.equal(supportResponses + pages.length + counts.length + reads.length, entries.length);
await writeFile(
  `${dir}/acceptance.json`,
  JSON.stringify(
    {
      passed: true,
      responses: entries.length,
      inputs: 6,
      supportResponses,
      notificationResponses: entries.length - supportResponses,
      ticketId,
      uniqueNotifications: 3,
      unreadNotifications: 2,
      committedReadResponseLost: 1,
      readRetryTimestampExact: true,
      notificationWithoutMessageOrOwnerFields: true,
      strictProductionDecoders: true,
      rawBodiesUnmodified: true,
      syntheticQaOnly: true,
      entries,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `${entries.length} real browser SQL HTTP responses and 6 inputs passed production decoders.`,
);
