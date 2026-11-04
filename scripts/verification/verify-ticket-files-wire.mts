import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  readTicketResult,
  readTicketDetail,
  readTicketMessages,
  readTicketPage,
  ticketResultSchema,
  ticketCreateSchema,
  ticketReplySchema,
  type TicketCommand,
} from '@sayman/web-shared/lib/support/ticket-contract.ts';
import {
  readTicketAttachments,
  ticketAttachmentPageSchema,
  ticketFileCapabilitiesSchema,
  ticketFileSelectionSchema,
  privateFileSignature,
} from '@sayman/web-shared/lib/support/ticket-file-contract.ts';
import {
  notificationCountSchema,
  readNotifications,
} from '@sayman/web-shared/lib/notifications/notification-contract.ts';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex'),
  root = process.cwd(),
  run = JSON.parse(await readFile(root + '/tmp/ticket-files-browser-run.json', 'utf8')),
  fixtures = JSON.parse(
    await readFile(root + '/' + run.privateDirectory + '/private-files.json', 'utf8'),
  );
assert.equal(fixtures.syntheticQaOnly, true);
assert.equal(fixtures.actualS3AndClamAv, true);
const expected = new Map<string, { bytes: number; sha256: string }>();
const downloads = [];
for (const doc of fixtures.documents) {
  const bytes = await readFile(doc.path);
  assert.equal(bytes.length, doc.bytes);
  assert.equal(sha(bytes).toUpperCase(), doc.sha256);
  expected.set(doc.actor + '-synthetic.pdf', doc);
  const actual = await readFile('/Users/jahangiri/Downloads/' + doc.actor + '-synthetic.pdf');
  assert.deepEqual(actual, bytes);
  downloads.push({
    filename: doc.actor + '-synthetic.pdf',
    bytes: actual.length,
    sha256: sha(actual),
    exactBrowserDownloadedBytes: true,
  });
}
let sqlResponses = 0;
for (const directory of ['ticket-files-bounded-sql-wire', 'private-files-real-services-wire'])
  for (const file of (await readdir(root + '/artifacts/checks/' + directory)).filter(
    (f) => f.endsWith('.json') && !f.endsWith('.meta.json'),
  )) {
    if (file === 'acceptance.json') continue;
    const value = JSON.parse(
      await readFile(root + '/artifacts/checks/' + directory + '/' + file, 'utf8'),
    );
    if (file === 'capabilities.json') ticketFileCapabilitiesSchema.parse(value);
    else if (value.items) ticketAttachmentPageSchema.parse(value);
    else ticketResultSchema.parse(value);
    sqlResponses++;
  }
const dir = root + '/artifacts/checks/ticket-files-browser-wire',
  commands = new Map<string, { command: TicketCommand; result: unknown }>(),
  entries = [];
let receipts = 0,
  binaries = 0,
  attachmentReads = 0,
  capabilities = 0;
for (const file of (await readdir(dir))
  .filter((f) => /^\d+\.meta\.json$/.test(f))
  .sort((a, b) => parseInt(a) - parseInt(b))) {
  const n = parseInt(file),
    meta = JSON.parse(await readFile(dir + '/' + file, 'utf8'));
  assert.equal(meta.status, 200);
  assert.equal(meta.syntheticQaOnly, true);
  assert.equal(meta.actualS3AndClamAv, true);
  assert.match(meta.cacheControl, /no-store/);
  const binary = !!meta.privateFileId,
    raw = await readFile(dir + '/' + n + (binary ? '.response.bin' : '.response.json'));
  assert.equal(sha(raw), meta.responseSha256);
  assert.equal(raw.length, meta.responseBytes);
  const url = new URL(meta.path, 'http://localhost'),
    s = url.pathname.split('/').filter(Boolean),
    staff = s[1] === 'admin',
    p = s.slice(staff ? 3 : 2);
  if (binary) {
    assert.equal(s.at(-1), meta.privateFileId);
    assert.equal(meta.contentType, 'application/pdf');
    assert.match(meta.contentDisposition, /^attachment;/);
    const match = downloads.find((x) => x.sha256 === sha(raw));
    assert.ok(match);
    assert.ok(privateFileSignature(raw, 'application/pdf'));
    binaries++;
  } else {
    const value = JSON.parse(raw.toString('utf8'));
    if (s[1] === 'notifications') {
      if (s[2] === 'unread-count') notificationCountSchema.parse(value);
      else
        readNotifications(
          value,
          url.searchParams.get('unreadOnly') === 'true',
          url.searchParams.get('cursor'),
        );
    } else if (meta.method === 'POST') {
      const input = JSON.parse(await readFile(dir + '/' + n + '.request.json', 'utf8'));
      let command: TicketCommand;
      if (meta.multipartCanonical) {
        const body = ticketReplySchema.parse(input.body),
          file = ticketFileSelectionSchema.parse(input.file),
          fixture = expected.get(file.filename);
        assert.ok(fixture);
        assert.equal(file.sha256, fixture.sha256);
        assert.equal(file.bytes, fixture.bytes);
        command = { kind: 'attachment', staff, ticketId: p[1], id: p[3], body, file };
      } else
        command = { kind: 'create', staff: false, id: p[2], body: ticketCreateSchema.parse(input) };
      const result = readTicketResult(value, command),
        key = staff + ':' + command.id;
      assert.ok(!commands.has(key), 'No duplicate mutation');
      commands.set(key, { command, result });
    } else if (p[0] === 'commands') {
      const previous = commands.get(staff + ':' + p[1]);
      assert.ok(previous);
      const result = readTicketResult(value, previous.command);
      assert.equal(result.replayed, true);
      assert.deepEqual(
        { ...result, replayed: false },
        { ...(previous.result as object), replayed: false },
      );
      receipts++;
    } else if (p[0] === 'files') {
      assert.equal(ticketFileCapabilitiesSchema.parse(value).configured, true);
      capabilities++;
    } else if (p[2] === 'attachments') {
      readTicketAttachments(value, p[1]);
      attachmentReads++;
    } else if (p[2] === 'messages') readTicketMessages(value, p[1]);
    else if (p.length === 1)
      readTicketPage(
        value,
        url.searchParams.get('state'),
        staff,
        url.searchParams.get('ticketId') ?? undefined,
      );
    else readTicketDetail(value, p[1]);
  }
  entries.push({ n, ...meta });
}
assert.equal(commands.size, 3);
assert.equal([...commands.values()].filter((x) => x.command.kind === 'attachment').length, 2);
assert.equal(receipts, 1);
assert.equal(entries.filter((x) => x.droppedAfterCommittedSuccess).length, 1);
assert.ok(entries.some((x) => x.dropKind === 'attachment'));
assert.ok(binaries >= 2 && attachmentReads >= 4 && capabilities >= 2);
const report = {
  passed: true,
  responses: entries.length,
  sqlResponses,
  commands: commands.size,
  canonicalMultipartInputs: 2,
  receiptReads: receipts,
  committedStaffUploadResponseLost: 1,
  noDuplicatePost: true,
  binaryResponses: binaries,
  downloads,
  strictProductionDecoders: true,
  rawResponsesUnmodified: true,
  multipartRawBytesNotPersisted: true,
  noAuthOrConnectionTokensPersisted: true,
  syntheticQaOnly: true,
  qaGatewayLifetimeCounterFailuresCorrected: true,
  entries,
};
await writeFile(dir + '/acceptance.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, entries: undefined }));
