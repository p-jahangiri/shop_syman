import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
const dir = process.argv[2];
assert.ok(dir);
const files = (await readdir(dir))
    .filter((x) => x.endsWith('.meta.json'))
    .sort((a, b) => parseInt(a) - parseInt(b)),
  commands = new Map<string, { command: TicketCommand; raw: string; result?: string }>(),
  entries = [];
let inputs = 0,
  success = 0,
  rejected = 0,
  dropped = 0,
  latest: ReturnType<typeof readTicketDetail>['ticket'] | null = null;
const messageIds = new Set<string>();
const dropIds = { create: new Set<string>(), reply: new Set<string>() };
const sha = (raw: Uint8Array) => createHash('sha256').update(raw).digest('hex');
for (const name of files) {
  const n = parseInt(name),
    meta = JSON.parse(await readFile(`${dir}/${name}`, 'utf8')),
    raw = await readFile(`${dir}/${n}.response.json`);
  assert.equal(meta.syntheticQaOnly, true);
  assert.equal(sha(raw), meta.responseSha256);
  const data = JSON.parse(raw.toString('utf8')),
    url = new URL(meta.path, 'http://localhost'),
    staff = url.pathname.startsWith('/api/admin/'),
    parts = url.pathname.split('/').slice(staff ? 4 : 3);
  let command: TicketCommand | undefined;
  if (meta.method !== 'GET') {
    inputs++;
    const bodyRaw = await readFile(`${dir}/${n}.request.json`);
    assert.equal(sha(bodyRaw), meta.requestSha256);
    const body = JSON.parse(bodyRaw.toString('utf8')),
      id = parts.at(-1)!;
    command =
      parts[1] === 'commands'
        ? { id, kind: 'create', staff: false, body: ticketCreateSchema.parse(body) }
        : parts[2] === 'replies'
          ? { id, kind: 'reply', staff, ticketId: parts[1], body: ticketReplySchema.parse(body) }
          : {
              id,
              kind: 'state',
              staff,
              ticketId: parts[1],
              body: ticketStateInputSchema.parse(body),
            };
    const key = String(staff) + ':' + id,
      existing = commands.get(key);
    if (existing) assert.equal(existing.raw, bodyRaw.toString('utf8'));
    else commands.set(key, { command, raw: bodyRaw.toString('utf8') });
  }
  if (meta.status === 409) {
    rejected++;
    assert.ok(command?.kind === 'reply' && staff);
    assert.equal(data.title, 'ticket_version_conflict');
    assert.equal(meta.droppedAfterCommittedSuccess, false);
  } else {
    assert.equal(meta.status, 200);
    assert.match(meta.cacheControl, /no-store/);
    success++;
    if (command) {
      const result = readTicketResult(data, command),
        key = String(staff) + ':' + command.id,
        entry = commands.get(key)!;
      const canonical = JSON.stringify({ ...result, replayed: false });
      if (entry.result) assert.equal(entry.result, canonical);
      else entry.result = canonical;
    } else if (parts[0] === 'commands') {
      const entry = commands.get(String(staff) + ':' + parts[1]);
      assert.ok(entry);
      const result = readTicketResult(data, entry.command);
      assert.equal(result.replayed, true);
      assert.equal(JSON.stringify({ ...result, replayed: false }), entry.result);
    } else if (parts.length === 1)
      readTicketPage(
        data,
        url.searchParams.get('state'),
        staff,
        url.searchParams.get('ticketId') ?? undefined,
      );
    else if (parts.length === 2) latest = readTicketDetail(data, parts[1]).ticket;
    else {
      const page = readTicketMessages(data, parts[1]);
      for (const item of page.items) {
        messageIds.add(item.id);
        assert.doesNotMatch(item.body, /نسخهٔ قدیمی باید رد شود/);
      }
    }
    if (meta.droppedAfterCommittedSuccess) {
      dropped++;
      assert.ok(command);
      assert.ok(meta.dropKind === 'create' || meta.dropKind === 'reply');
      dropIds[meta.dropKind as 'create' | 'reply'].add(command.id);
    }
  }
  entries.push({ response: `${n}.response.json`, ...meta });
}
assert.equal(files.length, 61);
assert.equal(inputs, 8);
assert.equal(rejected, 1);
assert.equal(dropped, 4);
assert.equal(dropIds.create.size, 1);
assert.equal(dropIds.reply.size, 1);
assert.equal(messageIds.size, 3);
assert.ok(latest);
assert.equal(latest.state, 'Open');
assert.equal(latest.messageCount, 3);
await writeFile(
  `${dir}/acceptance.json`,
  JSON.stringify(
    {
      passed: true,
      responses: files.length,
      successResponses: success,
      conflictResponses: rejected,
      inputs,
      committedResponsesLost: dropped,
      sameUuidAndByteBodyRetried: true,
      historicalReceiptsPreserved: true,
      strictProductionDecoders: true,
      plainTextMessages: true,
      uniqueMessages: 3,
      latestTicket: latest.id,
      latestState: latest.state,
      staleReplyNotPersisted: true,
      syntheticQaOnly: true,
      entries,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({ passed: true, responses: files.length, inputs, dropped, uniqueMessages: 3 }),
);
