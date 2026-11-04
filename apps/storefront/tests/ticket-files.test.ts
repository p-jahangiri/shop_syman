import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectedTicketFile,
  isTicketFilePath,
  privateFileMetadataSchema,
  privateFileMaximum,
  readTicketAttachments,
  readPrivateFileDownload,
  ticketFileCapabilitiesSchema,
} from '@sayman/web-shared/lib/support/ticket-file-contract.ts';
import { downloadPrivateTicketFile } from '@sayman/web-shared/lib/support/ticket-file-download.ts';
import { ticketCommandRequest } from '@sayman/web-shared/lib/support/ticket-command-request.ts';
import { TicketJournal } from '@sayman/web-shared/lib/support/ticket-journal.ts';
import type { TicketCommand } from '@sayman/web-shared/lib/support/ticket-contract.ts';
import { proxyTicketFile } from '../lib/support/ticket-file-proxy.ts';
const ticket = 'a'.repeat(32),
  commandId = 'b'.repeat(32),
  fileId = 'c'.repeat(32),
  message = 'd'.repeat(32),
  pdf = new TextEncoder().encode('%PDF-1.7\nSynthetic private file QA only.\n%%EOF\n');
const file = () => new File([pdf], 'مدرک نمونه.pdf', { type: 'application/pdf' });
const environment = {
  SHOP_DATA_MODE: 'api',
  SHOP_API_URL: 'http://127.0.0.1:5080',
  SHOP_PUBLIC_URL: 'http://127.0.0.1:3000',
};
const auth = { Authorization: 'Bearer ' + 'synthetic'.repeat(4), Origin: 'http://127.0.0.1:3000' };
const reply = { version: 'AAAAAAAAAAA=', body: 'متن همراه فایل نمونه', locale: 'fa' as const };
const result = {
  schemaVersion: 1,
  replayed: false,
  commandId,
  ticket: {
    id: ticket,
    subject: 'تیکت نمونه',
    locale: 'fa',
    state: 'Open',
    version: 'AAAAAAAAAAE=',
    messageCount: 2,
    createdAt: '2026-10-26T00:00:00Z',
    changedAt: '2026-10-26T00:00:01Z',
  },
  messageId: message,
};
const downloadHeaders = () => ({
  'Content-Type': 'application/pdf',
  'Content-Length': String(pdf.length),
  'Content-Disposition': "attachment; filename*=UTF-8''synthetic.pdf",
  'X-Sayman-Private-File': fileId,
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
});
async function selection() {
  return selectedTicketFile(file());
}
async function command(): Promise<Extract<TicketCommand, { kind: 'attachment' }>> {
  return {
    kind: 'attachment',
    staff: false,
    id: commandId,
    ticketId: ticket,
    body: reply,
    file: (await selection()).metadata,
  };
}
test('private selection validates actual bytes and generates a canonical digest without mutating the immutable source', async () => {
  const selected = await selection();
  assert.equal(selected.metadata.filename, 'مدرک نمونه.pdf');
  assert.match(selected.metadata.sha256, /^[A-F0-9]{64}$/);
  assert.deepEqual(new Uint8Array(await selected.blob.arrayBuffer()), pdf);
  await assert.rejects(
    selectedTicketFile(
      new File(['<html>synthetic misleading bytes</html>'], 'document.pdf', {
        type: 'application/pdf',
      }),
    ),
  );
  await assert.rejects(
    selectedTicketFile(new File([pdf], '../document.pdf', { type: 'application/pdf' })),
  );
  await assert.rejects(selectedTicketFile(new File([pdf], 'document.pdf', { type: 'text/html' })));
  await assert.rejects(
    selectedTicketFile(
      new File([new Uint8Array(privateFileMaximum + 1)], 'document.pdf', {
        type: 'application/pdf',
      }),
    ),
  );
});
test('private attachment contracts reject unknown fields, unsafe filenames, resource mismatch and duplicate message links', async () => {
  const selected = (await selection()).metadata,
    { sha256, ...metadata } = selected;
  assert.ok(privateFileMetadataSchema.safeParse(metadata).success);
  for (const name of ['../document.pdf', 'bad\r\n.pdf', 'bad\u202e.pdf', 'unpaired\ud800.pdf'])
    assert.equal(
      privateFileMetadataSchema.safeParse({ ...metadata, filename: name }).success,
      false,
    );
  assert.equal(
    privateFileMetadataSchema.safeParse({ ...metadata, ownerId: 'forbidden' }).success,
    false,
  );
  const item = {
    id: fileId,
    messageId: message,
    author: 'customer',
    at: '2026-10-26T00:00:01Z',
    file: metadata,
  };
  assert.equal(
    readTicketAttachments({ schemaVersion: 1, ticketId: ticket, items: [item] }, ticket).items
      .length,
    1,
  );
  assert.throws(() =>
    readTicketAttachments({ schemaVersion: 1, ticketId: fileId, items: [item] }, ticket),
  );
  assert.throws(() =>
    readTicketAttachments({ schemaVersion: 1, ticketId: ticket, items: [item, item] }, ticket),
  );
  assert.throws(() =>
    ticketFileCapabilitiesSchema.parse({
      schemaVersion: 1,
      configured: true,
      maxBytes: 1,
      contentTypes: ['application/pdf'],
      maxPerTicket: 20,
    }),
  );
});
test('file path allowlist is exact for audience, method, query and canonical identifiers', () => {
  assert.ok(isTicketFilePath('/api/support/files/capabilities'));
  assert.ok(isTicketFilePath(`/api/support/tickets/${ticket}/attachments`));
  assert.ok(isTicketFilePath(`/api/support/tickets/${ticket}/attachments/${fileId}`));
  assert.ok(
    isTicketFilePath(`/api/admin/support/tickets/${ticket}/attachments/${commandId}`, 'POST', true),
  );
  for (const path of [
    `/api/support/tickets/${ticket}/attachments/${fileId}?owner=x`,
    `/api/support/tickets/${ticket}/attachments/${'0'.repeat(32)}`,
    `/api/support/tickets/${ticket}/attachments/%2f${fileId}`,
    'https://other.example/api/support/files/capabilities',
    '/api/admin/support/files/capabilities',
  ])
    assert.equal(isTicketFilePath(path), false);
  assert.equal(
    isTicketFilePath(`/api/support/tickets/${ticket}/attachments/${fileId}`, 'DELETE'),
    false,
  );
});
test('attachment journal retains original bytes and metadata across unknown/retry, then clears them on confirmed receipt or owner change', async () => {
  const c = await command(),
    blob = (await selection()).blob,
    journal = new TicketJournal();
  journal.bind('owner');
  assert.throws(() => journal.begin('owner', c));
  journal.begin('owner', c, blob);
  journal.fail('owner', c, 0, 'network');
  assert.equal(journal.snapshot('owner')!.state, 'unknown');
  assert.deepEqual(new Uint8Array(await journal.file('owner', c).arrayBuffer()), pdf);
  const retry = journal.retry('owner');
  assert.deepEqual(retry, c);
  const request = ticketCommandRequest(retry, journal.file('owner', retry));
  assert.equal(request.method, 'POST');
  assert.equal(request.headers, undefined);
  const form = request.body as FormData;
  assert.equal(form.get('sha256'), c.file.sha256);
  assert.equal(form.get('version'), reply.version);
  assert.deepEqual(new Uint8Array(await (form.get('file') as File).arrayBuffer()), pdf);
  journal.finish('owner', retry, result);
  assert.throws(() => journal.file('owner', retry));
  journal.begin('owner', { ...c, id: 'e'.repeat(32) }, blob);
  journal.interrupt();
  journal.bind('other-owner');
  assert.equal(journal.snapshot('owner'), null);
  assert.throws(() => journal.file('owner', c));
});
test('a corrupt or foreign receipt cannot erase unknown attachment bytes', async () => {
  const c = await command(),
    journal = new TicketJournal();
  journal.bind('owner');
  journal.begin('owner', c, (await selection()).blob);
  journal.fail('owner', c, 503, 'unknown');
  assert.throws(() => journal.finish('owner', c, { ...result, commandId: fileId }));
  assert.equal(journal.file('owner', c).size, pdf.length);
  journal.fail('owner', c, 429, 'rate_limit');
  assert.equal(journal.snapshot('owner')!.state, 'unknown');
});
test('download validates marker, exact authorized metadata, private headers and actual signature/length', async () => {
  const { sha256, ...metadata } = (await selection()).metadata;
  const blob = await readPrivateFileDownload(
    new Response(pdf, { headers: downloadHeaders() }),
    fileId,
    metadata,
  );
  assert.equal(blob.size, pdf.length);
  for (const change of [
    { 'X-Sayman-Private-File': ticket },
    { 'Content-Type': 'text/html' },
    { 'Cache-Control': 'public' },
    { 'Content-Disposition': 'inline' },
    { 'X-Robots-Tag': 'index' },
  ])
    await assert.rejects(
      readPrivateFileDownload(
        new Response(pdf, { headers: { ...downloadHeaders(), ...change } }),
        fileId,
        metadata,
      ),
    );
  await assert.rejects(
    readPrivateFileDownload(
      new Response(pdf.slice(1), { headers: downloadHeaders() }),
      fileId,
      metadata,
    ),
  );
});
test('late private downloads are discarded if account authority changes while the body arrives', async () => {
  const { sha256, ...metadata } = (await selection()).metadata;
  let allowed = true,
    release: () => void = () => {};
  let started: () => void = () => {};
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        started();
        return new Promise<void>((resolve) => {
          release = () => {
            allowed = false;
            controller.enqueue(pdf);
            controller.close();
            resolve();
          };
        });
      },
    },
    { highWaterMark: 0 },
  );
  const pending = downloadPrivateTicketFile(
    async () => new Response(body, { headers: downloadHeaders() }),
    () => allowed,
    `/api/support/tickets/${ticket}/attachments/${fileId}`,
    fileId,
    metadata,
    new AbortController().signal,
  );
  await reading;
  release();
  await assert.rejects(pending);
});
test('BFF upload forwards only the configured origin, bearer and unchanged bounded multipart; no cookies or redirects', async () => {
  const c = await command(),
    form = ticketCommandRequest(c, (await selection()).blob).body as FormData;
  let called = 0;
  const response = await proxyTicketFile(
    new Request(`http://127.0.0.1:3000/api/support/tickets/${ticket}/attachments/${commandId}`, {
      method: 'POST',
      headers: { ...auth, Cookie: 'never-forward' },
      body: form,
    }),
    environment,
    async (url, init) => {
      called++;
      assert.equal(
        String(url),
        `http://127.0.0.1:5080/api/support/tickets/${ticket}/attachments/${commandId}`,
      );
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('Cookie'), null);
      assert.equal(headers.get('Authorization'), auth.Authorization);
      assert.equal(headers.get('Origin'), auth.Origin);
      assert.equal(init?.redirect, 'error');
      assert.equal(init?.credentials, 'omit');
      const received = await new Response(init?.body, {
        headers: { 'Content-Type': headers.get('Content-Type')! },
      }).formData();
      assert.equal(received.get('sha256'), c.file.sha256);
      assert.deepEqual(new Uint8Array(await (received.get('file') as File).arrayBuffer()), pdf);
      return Response.json(result);
    },
  );
  assert.equal(response.status, 200);
  assert.equal(called, 1);
  assert.deepEqual(await response.json(), result);
  assert.match(response.headers.get('Cache-Control')!, /no-store/);
});
test('BFF refuses untrusted origin, missing authentication, multipart extras and forged digest before upstream', async () => {
  let calls = 0;
  const upstream = async () => {
    calls++;
    return Response.json(result);
  };
  for (const [headers, status] of [
    [{ ...auth, Origin: 'https://other.example' }, 403],
    [{}, 401],
  ] as const) {
    const response = await proxyTicketFile(
      new Request('http://127.0.0.1:3000/api/support/files/capabilities', { headers }),
      environment,
      upstream,
    );
    assert.equal(response.status, status);
  }
  for (const mutation of ['extra', 'digest']) {
    const c = await command(),
      form = ticketCommandRequest(c, (await selection()).blob).body as FormData;
    if (mutation === 'extra') form.append('ownerId', 'forbidden');
    else form.set('sha256', 'A'.repeat(64));
    const response = await proxyTicketFile(
      new Request(`http://127.0.0.1:3000/api/support/tickets/${ticket}/attachments/${commandId}`, {
        method: 'POST',
        headers: auth,
        body: form,
      }),
      environment,
      upstream,
    );
    assert.equal(response.status, 400);
  }
  assert.equal(calls, 0);
});
test('BFF private downloads reject upstream redirection cookies, wrong markers and truncation; errors cannot echo private content', async () => {
  const request = () =>
    new Request(`http://127.0.0.1:3000/api/support/tickets/${ticket}/attachments/${fileId}`, {
      headers: auth,
    });
  let response = await proxyTicketFile(
    request(),
    environment,
    async () => new Response(pdf, { headers: downloadHeaders() }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), pdf);
  for (const headers of [
    { ...downloadHeaders(), 'Set-Cookie': 'forbidden=1' },
    { ...downloadHeaders(), 'X-Sayman-Private-File': ticket },
  ]) {
    response = await proxyTicketFile(
      request(),
      environment,
      async () => new Response(pdf, { headers }),
    );
    assert.equal(response.status, 503);
  }
  response = await proxyTicketFile(
    request(),
    environment,
    async () => new Response(pdf.slice(1), { headers: downloadHeaders() }),
  );
  assert.equal(response.status, 503);
  response = await proxyTicketFile(request(), environment, async () =>
    Response.json(
      { title: 'private_file_rejected', detail: 'private content must not be echoed' },
      { status: 400 },
    ),
  );
  assert.deepEqual(await response.json(), { title: 'private_file_rejected' });
});
test('BFF retains a download slot until its response body is consumed or canceled, independently of upload admission', async () => {
  const request = () =>
      new Request(`http://127.0.0.1:3000/api/support/tickets/${ticket}/attachments/${fileId}`, {
        headers: auth,
      }),
    upstream = async () => new Response(pdf, { headers: downloadHeaders() });
  const first = await proxyTicketFile(request(), environment, upstream),
    second = await proxyTicketFile(request(), environment, upstream);
  try {
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const busy = await proxyTicketFile(request(), environment, upstream);
    assert.equal(busy.status, 429);
    await first.body!.cancel();
    const recovered = await proxyTicketFile(request(), environment, upstream);
    assert.equal(recovered.status, 200);
    assert.deepEqual(new Uint8Array(await recovered.arrayBuffer()), pdf);
  } finally {
    await second.body?.cancel();
  }
});
