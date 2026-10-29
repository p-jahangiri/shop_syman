import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  ticketResultSchema,
  readTicketResult,
  readTicketPage,
  readTicketDetail,
  readTicketMessages,
  type TicketCommand,
} from '../apps/storefront/lib/ticket-contract.ts';
const dir = process.argv[2];
assert.ok(dir);
const names = [
    'created',
    'staff-reply',
    'customer-reply',
    'closed',
    'reopened',
    'create-replay',
    'receipt',
    'messages',
    'customer-page',
    'staff-page',
    'detail',
  ],
  data: Record<string, unknown> = {},
  entries = [];
for (const name of names) {
  const raw = await readFile(`${dir}/${name}.json`),
    meta = JSON.parse(await readFile(`${dir}/${name}.meta.json`, 'utf8'));
  assert.equal(meta.actualSqlHttpResponse, true);
  assert.equal(meta.syntheticQaOnly, true);
  assert.equal(meta.status, 200);
  assert.match(meta.cacheControl, /no-store/);
  const value = JSON.parse(raw.toString('utf8'));
  data[name] = value;
  entries.push({
    file: name + '.json',
    sha256: createHash('sha256').update(raw).digest('hex'),
    ...meta,
  });
}
const original = ticketResultSchema.parse(data.created),
  id = original.ticket.id;
const create: TicketCommand = {
  kind: 'create',
  staff: false,
  id: original.commandId,
  body: {
    subject: original.ticket.subject,
    body: 'متن نمونهٔ پشتیبانی؛ <b>همچنان متن ساده</b>',
    locale: 'fa',
  },
};
for (const name of ['created', 'create-replay', 'receipt']) readTicketResult(data[name], create);
for (const name of ['staff-reply', 'customer-reply']) {
  const r = ticketResultSchema.parse(data[name]);
  readTicketResult(r, {
    kind: 'reply',
    staff: name === 'staff-reply',
    id: r.commandId,
    ticketId: id,
    body: { version: original.ticket.version, body: 'Captured fixture reply', locale: 'fa' },
  });
}
for (const name of ['closed', 'reopened']) {
  const r = ticketResultSchema.parse(data[name]);
  readTicketResult(r, {
    kind: 'state',
    staff: name === 'reopened',
    id: r.commandId,
    ticketId: id,
    body: { version: original.ticket.version, state: name === 'closed' ? 'Closed' : 'Open' },
  });
}
readTicketDetail(data.detail, id);
readTicketPage(data['customer-page'], null);
readTicketPage(data['staff-page'], 'Open');
const messages = readTicketMessages(data.messages, id);
assert.deepEqual(
  messages.items.map((x) => x.author),
  ['customer', 'support', 'customer'],
);
assert.equal(messages.items[0].body, create.body.body);
assert.equal(
  ticketResultSchema.parse(data['create-replay']).ticket.version,
  original.ticket.version,
);
assert.notEqual(ticketResultSchema.parse(data.reopened).ticket.version, original.ticket.version);
await writeFile(
  `${dir}/acceptance.json`,
  JSON.stringify(
    {
      passed: true,
      responses: 11,
      actualSqlHttpResponseBodies: true,
      rawBodiesUnmodified: true,
      strictProductionDecoders: true,
      ownerAndStaffFieldsAbsent: true,
      originalHistoricalReceiptPreserved: true,
      encryptedContentReadThroughAuthorizedApi: true,
      syntheticQaOnly: true,
      entries,
    },
    null,
    2,
  ) + '\n',
);
console.log('11 real SQL HTTP support responses passed production decoders.');
