import test from 'node:test';
import assert from 'node:assert/strict';
import {
  creditDocumentPageSchema,
  creditDocumentPath,
  creditDocumentForm,
  isCreditDocumentPath,
  readCreditDocumentResult,
  readCreditDocuments,
  type CreditDocumentCommand,
} from './credit-document-contract.ts';
import { CreditDocumentJournal, customerCreditDocumentJournal } from './credit-document-journal.ts';
import { selectedTicketFile, boundedPrivateBytes } from './ticket-file-contract.ts';
import { proxyCreditDocument } from './credit-document-proxy.ts';
import { proxyCreditApplications } from './credit-application-proxy.ts';
import { downloadPrivateCreditDocument } from './credit-document-download.ts';
import { CustomerSessionStore } from './customer-session.ts';
const appId = 'a'.repeat(32),
  revisionId = 'b'.repeat(32),
  consentId = 'c'.repeat(32),
  commandId = 'd'.repeat(32),
  fileId = 'e'.repeat(32),
  at = '2026-10-27T00:00:00+00:00',
  version = 'AAAAAAAAAAE=',
  pdf = new TextEncoder().encode('%PDF-1.7\nSynthetic credit document QA only.\n%%EOF\n');
const app = () => ({
  id: appId,
  planId: 'synthetic',
  requestedAmountRial: '9007199254740993',
  locale: 'fa',
  state: 'Draft',
  version: 'AAAAAAAAAAI=',
  createdAt: at,
  changedAt: at,
});
const file = () => new File([pdf], 'مدرک ساختگی.pdf', { type: 'application/pdf' });
const selected = () => selectedTicketFile(file());
async function command(): Promise<CreditDocumentCommand> {
  return {
    id: commandId,
    applicationId: appId,
    body: {
      version,
      consentId,
      requirementsRevisionId: revisionId,
      documentKey: 'synthetic',
      replacesFileId: null,
    },
    file: (await selected()).metadata,
  };
}
const attachment = () => ({
  id: fileId,
  consentId,
  requirementsRevisionId: revisionId,
  documentKey: 'synthetic',
  replacesFileId: null,
  at,
  file: { filename: 'مدرک ساختگی.pdf', contentType: 'application/pdf' as const, bytes: pdf.length },
});
const result = () => ({
  schemaVersion: 1,
  replayed: false,
  commandId,
  application: app(),
  attachment: attachment(),
});
const page = () => ({
  schemaVersion: 1,
  application: app(),
  currentConsentId: consentId,
  configured: true,
  canUpload: true,
  maxAttachments: 48,
  blockers: [],
  items: [{ attachment: attachment(), isCurrent: true }],
});
const env = {
    SHOP_DATA_MODE: 'api',
    SHOP_API_URL: 'http://127.0.0.1:5080',
    SHOP_PUBLIC_URL: 'http://127.0.0.1:3000',
  },
  headers = {
    Authorization: 'Bearer ' + 'x'.repeat(32),
    Origin: env.SHOP_PUBLIC_URL,
    Cookie: 'must-not-forward=1',
  };
const downloadHeaders = () => ({
  'Content-Type': 'application/pdf',
  'Content-Length': String(pdf.length),
  'Content-Disposition': 'attachment; filename="synthetic.pdf"',
  'X-Sayman-Private-File': fileId,
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
});
test('document paths allow only owner upload/receipt and scoped owner or reviewer reads', () => {
  for (const staff of [false, true]) {
    const p =
      (staff ? '/api/admin/credit/' : '/api/credit/') + 'applications/' + appId + '/documents';
    assert.ok(isCreditDocumentPath(p, 'GET', staff));
    assert.ok(isCreditDocumentPath(p + '/files/' + fileId, 'GET', staff));
    assert.equal(isCreditDocumentPath(p + '/commands/' + commandId, 'POST', staff), !staff);
    assert.equal(isCreditDocumentPath(p + '/commands/' + commandId, 'GET', staff), !staff);
    for (const suffix of [
      '?owner=x',
      '#hash',
      '/files/' + '0'.repeat(32),
      '/files/%2f' + fileId,
      '/unrecognized',
    ])
      assert.equal(isCreditDocumentPath(p + suffix, 'GET', staff), false);
    assert.equal(isCreditDocumentPath(p + '/files/' + fileId, 'DELETE', staff), false);
  }
});
test('document results bind the original consent, case, definition, replacement and file metadata without losing large rial', async () => {
  const c = await command();
  assert.equal(
    readCreditDocumentResult(result(), c).application.requestedAmountRial,
    '9007199254740993',
  );
  for (const change of [
    { consentId: 'f'.repeat(32) },
    { requirementsRevisionId: 'f'.repeat(32) },
    { documentKey: 'other' },
    { replacesFileId: 'f'.repeat(32) },
    { file: { ...attachment().file, filename: 'changed.pdf' } },
    { file: { ...attachment().file, bytes: pdf.length + 1 } },
  ])
    assert.throws(() =>
      readCreditDocumentResult({ ...result(), attachment: { ...attachment(), ...change } }, c),
    );
  assert.throws(() => readCreditDocumentResult({ ...result(), commandId: 'f'.repeat(32) }, c));
  assert.throws(() =>
    readCreditDocumentResult({ ...result(), application: { ...app(), ownerId: 'injected' } }, c),
  );
});
test('document history validates current consent, replacement lineage, role and unavailable storage coherently', () => {
  assert.ok(readCreditDocuments(page(), appId));
  assert.throws(() => readCreditDocuments(page(), appId, true));
  assert.ok(readCreditDocuments({ ...page(), canUpload: false }, appId, true));
  assert.throws(() => readCreditDocuments(page(), 'f'.repeat(32)));
  for (const change of [
    { configured: false },
    { currentConsentId: null },
    { items: [page().items[0], page().items[0]] },
    { blockers: ['private_file_unavailable'] },
    { application: { ...app(), requestedAmountRial: Number('9007199254740993') } },
    {
      items: [{ attachment: { ...attachment(), replacesFileId: 'f'.repeat(32) }, isCurrent: true }],
    },
  ])
    assert.equal(creditDocumentPageSchema.safeParse({ ...page(), ...change }).success, false);
  const previous = { ...attachment(), id: 'f'.repeat(32) },
    replacement = { ...attachment(), replacesFileId: previous.id };
  assert.ok(
    readCreditDocuments(
      {
        ...page(),
        items: [
          { attachment: replacement, isCurrent: true },
          { attachment: previous, isCurrent: false },
        ],
      },
      appId,
    ),
  );
  assert.equal(
    creditDocumentPageSchema.safeParse({
      ...page(),
      items: [
        { attachment: previous, isCurrent: false },
        { attachment: replacement, isCurrent: true },
      ],
    }).success,
    false,
  );
  assert.ok(
    readCreditDocuments(
      { ...page(), configured: false, canUpload: false, blockers: ['private_file_unavailable'] },
      appId,
    ),
  );
});
test('document journal retains frozen bytes for unknown recovery and erases them on receipt or verified account change', async () => {
  const j = new CreditDocumentJournal(),
    c = await command(),
    blob = (await selected()).blob;
  j.bind('owner');
  j.begin('owner', c, blob);
  c.body.documentKey = 'changed';
  j.interrupt();
  const retry = j.retry('owner');
  assert.equal(retry.body.documentKey, 'synthetic');
  assert.deepEqual(new Uint8Array(await j.file('owner', retry).arrayBuffer()), pdf);
  j.fail('owner', retry, 404, 'not_found');
  assert.equal(j.snapshot('owner')!.state, 'unknown');
  assert.throws(() => j.begin('owner', retry, blob));
  assert.ok(j.finish('owner', retry, { ...result(), replayed: true }));
  assert.throws(() => j.file('owner', retry));
  j.bind('other');
  assert.equal(j.finish('owner', retry, result()), false);
  const session = {
    accessToken: 'x'.repeat(50),
    expiresIn: 600,
    requiresMfa: false,
    requiresEnrollment: false,
    user: { id: 'qa-document', displayName: 'Synthetic', userName: 'qa' },
  };
  const store = new CustomerSessionStore(
    async () => session,
    async () => session,
    async (f) => f(),
    () => false,
  );
  await store.login('qa', 'synthetic');
  customerCreditDocumentJournal.begin('qa-document', await command(), blob);
  store.remote('signout');
  assert.equal(customerCreditDocumentJournal.snapshot('qa-document'), null);
});
test('document BFF sends only bounded multipart with bearer and validates actual returned attachment', async () => {
  const c = await command(),
    path = creditDocumentPath(c),
    url = env.SHOP_PUBLIC_URL + path;
  let calls = 0;
  const fetcher: typeof fetch = async (target, init) => {
    calls++;
    assert.equal(target, env.SHOP_API_URL + path);
    const h = new Headers(init?.headers);
    assert.equal(h.get('Cookie'), null);
    assert.equal(h.get('Authorization'), headers.Authorization);
    const f = await new Response(init?.body, {
      headers: { 'Content-Type': h.get('Content-Type')! },
    }).formData();
    assert.equal(f.get('consentId'), consentId);
    assert.equal(f.get('sha256'), c.file.sha256);
    assert.deepEqual(new Uint8Array(await (f.get('file') as File).arrayBuffer()), pdf);
    return Response.json(result());
  };
  let response = await proxyCreditApplications(
    new Request(url, {
      method: 'POST',
      headers,
      body: creditDocumentForm(c, (await selected()).blob),
    }),
    path.slice('/api/credit/'.length).split('/'),
    env,
    fetcher,
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control')!, /private, no-store/);
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.equal(calls, 1);
  const form = creditDocumentForm(c, (await selected()).blob);
  form.append('ownerId', 'forged');
  response = await proxyCreditDocument(
    new Request(url, { method: 'POST', headers, body: form }),
    env,
    fetcher,
  );
  assert.equal(response.status, 400);
  assert.equal(calls, 1);
  const bad = creditDocumentForm(c, (await selected()).blob);
  bad.set('sha256', 'A'.repeat(64));
  response = await proxyCreditDocument(
    new Request(url, { method: 'POST', headers, body: bad }),
    env,
    fetcher,
  );
  assert.equal(response.status, 400);
  assert.equal(calls, 1);
  response = await proxyCreditDocument(
    new Request(url, {
      method: 'POST',
      headers,
      body: creditDocumentForm(c, (await selected()).blob),
    }),
    env,
    async () =>
      Response.json({ ...result(), attachment: { ...attachment(), consentId: 'f'.repeat(32) } }),
  );
  assert.equal(response.status, 503);
});
test('document BFF refuses origin, range, cookies and wrong receipt resource before exposing private bytes', async () => {
  const c = await command(),
    url = env.SHOP_PUBLIC_URL + creditDocumentPath(c);
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return Response.json({ ...result(), replayed: true });
  };
  let response = await proxyCreditDocument(
    new Request(url, { headers: { ...headers, Origin: 'https://wrong.example' } }),
    env,
    fetcher,
  );
  assert.equal(response.status, 403);
  response = await proxyCreditDocument(
    new Request(url, { headers: { ...headers, Range: 'bytes=0-10' } }),
    env,
    fetcher,
  );
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
  response = await proxyCreditDocument(new Request(url, { headers }), env, fetcher);
  assert.equal(response.status, 200);
  response = await proxyCreditDocument(new Request(url, { headers }), env, async () =>
    Response.json(result()),
  );
  assert.equal(response.status, 503);
  response = await proxyCreditDocument(new Request(url, { headers }), env, async () =>
    Response.json({ ...result(), replayed: true }, { headers: { 'Set-Cookie': 'forbidden=1' } }),
  );
  assert.equal(response.status, 503);
});
test('credit downloads are byte-exact, private, bounded and checked again when the view loses authority', async () => {
  const path = '/api/credit/applications/' + appId + '/documents/files/' + fileId,
    url = env.SHOP_PUBLIC_URL + path;
  const response = await proxyCreditDocument(
    new Request(url, { headers }),
    env,
    async () => new Response(pdf, { headers: downloadHeaders() }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), pdf);
  assert.match(response.headers.get('Content-Security-Policy')!, /sandbox/);
  const wrong = await proxyCreditDocument(
    new Request(url, { headers }),
    env,
    async () =>
      new Response(pdf, {
        headers: { ...downloadHeaders(), 'X-Sayman-Private-File': 'f'.repeat(32) },
      }),
  );
  assert.equal(wrong.status, 503);
  let allowed = true;
  await assert.rejects(
    downloadPrivateCreditDocument(
      async () => {
        allowed = false;
        return new Response(pdf, { headers: downloadHeaders() });
      },
      () => allowed,
      path,
      fileId,
      attachment().file,
      new AbortController().signal,
    ),
  );
});
test('unfinished credit download bodies retain their two-slot bound until consumed or cancelled', async () => {
  const url =
      env.SHOP_PUBLIC_URL + '/api/credit/applications/' + appId + '/documents/files/' + fileId,
    fetcher: typeof fetch = async () => new Response(pdf, { headers: downloadHeaders() });
  const first = await proxyCreditDocument(new Request(url, { headers }), env, fetcher),
    second = await proxyCreditDocument(new Request(url, { headers }), env, fetcher);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(
    (await proxyCreditDocument(new Request(url, { headers }), env, fetcher)).status,
    429,
  );
  await first.body!.cancel();
  await second.arrayBuffer();
  const third = await proxyCreditDocument(new Request(url, { headers }), env, fetcher);
  assert.equal(third.status, 200);
  await third.body!.cancel();
});
test('aborted multipart reads cancel the underlying reader and cannot return a partial file as complete', async () => {
  let cancelled = false;
  const abort = new AbortController(),
    stream = new ReadableStream<Uint8Array>({
      pull() {},
      cancel() {
        cancelled = true;
      },
    });
  const reading = boundedPrivateBytes(stream, 1024, abort.signal);
  abort.abort();
  await assert.rejects(reading);
  assert.equal(cancelled, true);
});
test('routine token refresh preserves document download authority while a new login to the same account invalidates the old view', async () => {
  const session = {
    accessToken: 'x'.repeat(50),
    expiresIn: 600,
    requiresMfa: false,
    requiresEnrollment: false,
    user: { id: 'qa-document-binding', displayName: 'Synthetic', userName: 'qa' },
  };
  const store = new CustomerSessionStore(
    async () => ({ ...session }),
    async () => ({ ...session, accessToken: 'y'.repeat(50) }),
    async (f) => f(),
    () => false,
  );
  await store.login('qa', 'synthetic');
  const revision = store.viewRevision(),
    owner = store.snapshot().session!.user.id,
    allowed = () =>
      store.viewRevision() === revision &&
      store.snapshot().status === 'member' &&
      store.snapshot().session?.user.id === owner,
    path = '/api/credit/applications/' + appId + '/documents/files/' + fileId;
  const blob = await downloadPrivateCreditDocument(
    async () => {
      await store.restore(true);
      return new Response(pdf, { headers: downloadHeaders() });
    },
    allowed,
    path,
    fileId,
    attachment().file,
    new AbortController().signal,
  );
  assert.equal(blob.size, pdf.length);
  assert.equal(allowed(), true);
  await store.login('qa', 'synthetic');
  assert.equal(allowed(), false);
  await assert.rejects(
    downloadPrivateCreditDocument(
      async () => new Response(pdf, { headers: downloadHeaders() }),
      allowed,
      path,
      fileId,
      attachment().file,
      new AbortController().signal,
    ),
  );
});
test('customer credit file transfers have enough time for bounded scan/storage while metadata reads keep their short deadline', async () => {
  const session = {
      accessToken: 'x'.repeat(50),
      expiresIn: 600,
      requiresMfa: false,
      requiresEnrollment: false,
      user: { id: 'qa-document-deadline', displayName: 'Synthetic', userName: 'qa' },
    },
    store = new CustomerSessionStore(
      async () => session,
      async () => session,
      async (f) => f(),
      () => false,
    );
  await store.login('qa', 'synthetic');
  const originalFetch = globalThis.fetch,
    originalTimeout = AbortSignal.timeout,
    delays: number[] = [];
  try {
    AbortSignal.timeout = (delay: number) => {
      delays.push(delay);
      return new AbortController().signal;
    };
    globalThis.fetch = async () => Response.json({});
    await store.fetch('/api/credit/applications/' + appId + '/documents/commands/' + commandId, {
      method: 'POST',
      body: new FormData(),
    });
    await store.fetch('/api/credit/applications/' + appId + '/documents/files/' + fileId);
    await store.fetch('/api/credit/applications/' + appId + '/documents');
    await store.fetch('/api/credit/applications/' + appId + '/documents/commands/' + commandId);
    assert.deepEqual(delays, [45000, 45000, 15000, 15000]);
  } finally {
    globalThis.fetch = originalFetch;
    AbortSignal.timeout = originalTimeout;
  }
});
