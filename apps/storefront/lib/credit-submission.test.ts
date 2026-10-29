import test from 'node:test';
import assert from 'node:assert/strict';
import {
  creditSubmissionBodySchema,
  creditSubmissionCapabilitiesSchema,
  creditSubmissionDetailSchema,
  isCreditSubmissionPath,
  creditSubmissionCommandPath,
  readCreditSubmissionCapabilities,
  readCreditSubmissionResult,
  readCreditSubmissionDetail,
  readCreditSubmissionPage,
  type CreditSubmissionCommand,
} from './credit-submission-contract.ts';
import {
  CreditSubmissionJournal,
  customerCreditSubmissionJournal,
} from './credit-submission-journal.ts';
import { isCreditApplicationPath } from './credit-application-path.ts';
import { proxyCreditApplications } from './credit-application-proxy.ts';
import { CustomerSessionStore } from './customer-session.ts';
const appId = 'a'.repeat(32),
  revisionId = 'b'.repeat(32),
  consentId = 'c'.repeat(32),
  commandId = 'd'.repeat(32),
  subId = 'e'.repeat(32),
  at = '2026-10-27T08:00:00+00:00',
  before = 'AAAAAAAAAAE=',
  after = 'AAAAAAAAAAI=';
const application = () => ({
  id: appId,
  planId: 'synthetic',
  requestedAmountRial: '9007199254740993',
  locale: 'fa',
  state: 'Submitted',
  version: after,
  createdAt: at,
  changedAt: at,
});
const summary = () => ({
  id: subId,
  consentId,
  requirementsRevisionId: revisionId,
  locale: 'en',
  documentCount: 0,
  submittedAt: at,
});
const command = (): CreditSubmissionCommand => ({
  id: commandId,
  applicationId: appId,
  body: {
    applicationVersion: before,
    consentId,
    requirementsRevisionId: revisionId,
    requirementsVersion: before,
    locale: 'en',
    note: 'Synthetic QA 😀',
    reviewRequested: true,
  },
});
const result = () => ({
  schemaVersion: 1,
  replayed: false,
  commandId,
  application: application(),
  submission: summary(),
  note: command().body.note,
});
const capabilities = () => ({
  schemaVersion: 1,
  application: { ...application(), state: 'Draft', version: before },
  consentId,
  requirementsRevisionId: revisionId,
  requirementsVersion: before,
  canSubmit: true,
  canWithdraw: false,
  requiredDocumentCount: 0,
  selectedDocumentCount: 0,
  missingDocumentKeys: [],
  blockers: [],
  latestSubmission: null,
});
const plan = () => ({
  id: 'synthetic',
  version: before,
  nameFa: 'طرح ساختگی',
  nameEn: 'Synthetic',
  months: 6,
  markupBasisPoints: 3000,
  downPaymentBasisPoints: 2500,
  intervalMonths: 1,
  roundingUnitRial: '1',
  minAmountRial: null,
  maxAmountRial: null,
  categoryIds: [],
});
const detail = () => ({
  schemaVersion: 1,
  application: application(),
  submission: summary(),
  plan: plan(),
  consent: {
    id: consentId,
    locale: 'fa',
    acceptedAt: at,
    requirements: {
      id: revisionId,
      createdAt: at,
      content: {
        titleFa: 'شرایط ساختگی',
        titleEn: 'Synthetic terms',
        termsFa: 'صرفاً آزمون',
        termsEn: 'Synthetic only',
        consentLabelFa: 'خواندم',
        consentLabelEn: 'Read',
        enabled: true,
        documents: [],
      },
    },
  },
  note: command().body.note,
  documents: [],
});
const env = {
    SHOP_DATA_MODE: 'api',
    SHOP_API_URL: 'http://127.0.0.1:5080',
    SHOP_PUBLIC_URL: 'http://127.0.0.1:3000',
  },
  headers = {
    Authorization: 'Bearer ' + 'x'.repeat(32),
    Origin: env.SHOP_PUBLIC_URL,
    'Content-Type': 'application/json',
    Cookie: 'never-forward=1',
  };
async function proxy(
  path: string,
  method: string,
  body: unknown,
  fetcher: typeof fetch,
  extra: Record<string, string> = {},
) {
  return proxyCreditApplications(
    new Request(env.SHOP_PUBLIC_URL + path, {
      method,
      headers: { ...headers, ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    path.slice('/api/credit/'.length).split('/'),
    env,
    fetcher,
  );
}
test('submission paths expose only owner command/receipt and scoped owner/reviewer reads', () => {
  for (const staff of [false, true]) {
    const base = (staff ? '/api/admin/credit' : '/api/credit') + '/applications/' + appId;
    for (const suffix of ['/submission', '/submissions', '/submissions/' + subId]) {
      assert.ok(isCreditSubmissionPath(base + suffix, 'GET', staff));
      assert.ok(isCreditApplicationPath(base + suffix, 'GET', staff));
      for (const extra of ['?owner=x', '#hash', '/extra'])
        assert.equal(isCreditSubmissionPath(base + suffix + extra, 'GET', staff), false);
    }
    for (const method of ['GET', 'POST'])
      assert.equal(
        isCreditSubmissionPath(base + '/submissions/commands/' + commandId, method, staff),
        !staff,
      );
    assert.equal(isCreditSubmissionPath(base + '/submissions/' + subId, 'PUT', staff), false);
    assert.equal(
      isCreditSubmissionPath(base.replace(appId, '0'.repeat(32)) + '/submission', 'GET', staff),
      false,
    );
  }
  assert.ok(isCreditApplicationPath('/api/admin/credit/applications?state=Submitted', 'GET', true));
});
test('submission input requires explicit review intent, exact versions and valid bounded Unicode', () => {
  assert.ok(creditSubmissionBodySchema.parse(command().body));
  for (const patch of [
    { reviewRequested: false },
    { reviewRequested: undefined },
    { approved: true },
    { note: ' broken' },
    { note: 'broken\ud800' },
    { note: 'x'.repeat(2001) },
    { consentId: '0'.repeat(32) },
    { requirementsVersion: 'bad' },
  ])
    assert.equal(
      creditSubmissionBodySchema.safeParse({ ...command().body, ...patch }).success,
      false,
    );
});
test('submission receipt binds the frozen case, consent, revision, note and language and retains large rial exactly', () => {
  const c = command();
  assert.equal(
    readCreditSubmissionResult(result(), c).application.requestedAmountRial,
    '9007199254740993',
  );
  for (const patch of [
    { note: 'changed' },
    { commandId: subId },
    { application: { ...application(), state: 'Draft' } },
    { application: { ...application(), version: before } },
    { submission: { ...summary(), consentId: subId } },
    { submission: { ...summary(), requirementsRevisionId: subId } },
    { submission: { ...summary(), locale: 'fa' } },
  ])
    assert.throws(() => readCreditSubmissionResult({ ...result(), ...patch }, c));
});
test('capability decoding checks state, blockers, missing documents and owner versus staff authority', () => {
  assert.ok(readCreditSubmissionCapabilities(capabilities(), appId));
  assert.throws(() => readCreditSubmissionCapabilities(capabilities(), appId, true));
  assert.ok(readCreditSubmissionCapabilities({ ...capabilities(), canSubmit: false }, appId, true));
  for (const patch of [
    { blockers: ['credit_required_documents_missing'] },
    { missingDocumentKeys: ['sample'] },
    { application: application() },
    { canWithdraw: true },
    { requirementsVersion: null },
    { blockers: ['credit_plan_changed', 'credit_plan_changed'] },
  ])
    assert.equal(
      creditSubmissionCapabilitiesSchema.safeParse({ ...capabilities(), ...patch }).success,
      false,
    );
  const submitted = {
    ...capabilities(),
    application: application(),
    canSubmit: false,
    canWithdraw: true,
    latestSubmission: summary(),
    blockers: ['application_submitted'],
  };
  assert.ok(readCreditSubmissionCapabilities(submitted, appId));
  assert.throws(() => readCreditSubmissionCapabilities(submitted, appId, true));
});
test('snapshot detail binds immutable consent and required document metadata instead of current policy', () => {
  assert.ok(readCreditSubmissionDetail(detail(), appId, subId));
  assert.throws(() => readCreditSubmissionDetail(detail(), appId, consentId));
  assert.ok(
    readCreditSubmissionPage(
      { schemaVersion: 1, applicationId: appId, items: [summary()], nextCursor: null },
      appId,
    ),
  );
  assert.throws(() =>
    readCreditSubmissionPage(
      { schemaVersion: 1, applicationId: appId, items: [summary(), summary()], nextCursor: null },
      appId,
    ),
  );
  const d = detail();
  d.consent.requirements.content.documents.push({
    key: 'sample',
    nameFa: 'نمونه',
    nameEn: 'Sample',
    helpFa: '',
    helpEn: '',
    required: true,
    maxBytes: 100,
    contentTypes: ['application/pdf'],
  } as never);
  assert.equal(creditSubmissionDetailSchema.safeParse(d).success, false);
  assert.equal(
    creditSubmissionDetailSchema.safeParse({
      ...detail(),
      consent: { ...detail().consent, id: subId },
    }).success,
    false,
  );
});
test('unknown submission journal freezes input and cannot be cleared or overwritten until receipt resolves it', () => {
  const j = new CreditSubmissionJournal(),
    c = command();
  j.bind('owner');
  j.begin('owner', c);
  c.body.note = 'changed';
  j.interrupt();
  assert.throws(() => j.begin('owner', command()));
  j.clear('owner');
  assert.equal(j.snapshot('owner')!.state, 'unknown');
  const retry = j.retry('owner');
  assert.equal(retry.body.note, 'Synthetic QA 😀');
  j.fail('owner', retry, 404, 'not_found');
  assert.equal(j.snapshot('owner')!.state, 'unknown');
  assert.ok(j.finish('owner', retry, { ...result(), replayed: true }));
  assert.equal(j.snapshot('owner')!.state, 'done');
  j.bind('other');
  assert.equal(j.finish('owner', retry, result()), false);
  assert.equal(j.snapshot('owner'), null);
});
test('verified signout erases private submission notes and frozen commands', async () => {
  const session = {
      accessToken: 'x'.repeat(50),
      expiresIn: 600,
      requiresMfa: false,
      requiresEnrollment: false,
      user: { id: 'qa-submit', displayName: 'Synthetic', userName: 'qa' },
    },
    store = new CustomerSessionStore(
      async () => session,
      async () => session,
      async (f) => f(),
      () => false,
    );
  await store.login('qa', 'synthetic');
  customerCreditSubmissionJournal.begin('qa-submit', command());
  store.remote('signout');
  assert.equal(customerCreditSubmissionJournal.snapshot('qa-submit'), null);
});
test('submission BFF forwards exact bounded JSON with bearer and no cookies and validates the returned frozen command', async () => {
  const c = command(),
    path = creditSubmissionCommandPath(c);
  let calls = 0;
  const response = await proxy(path, 'POST', c.body, async (target, init) => {
    calls++;
    assert.equal(target, env.SHOP_API_URL + path);
    assert.equal(new Headers(init?.headers).get('Cookie'), null);
    assert.equal(new Headers(init?.headers).get('Authorization'), headers.Authorization);
    assert.deepEqual(JSON.parse(init!.body as string), c.body);
    return Response.json(result());
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.match(response.headers.get('Cache-Control')!, /private, no-store/);
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.equal(
    (
      await proxy(path, 'POST', c.body, async () =>
        Response.json({ ...result(), note: 'substitute' }),
      )
    ).status,
    503,
  );
  assert.equal(
    (
      await proxy(path, 'POST', { ...c.body, approved: true }, async () => {
        throw Error('must not call');
      })
    ).status,
    400,
  );
});
test('submission BFF fails closed on receipt resource, origin, response cookies and oversized input/output', async () => {
  const c = command(),
    path = creditSubmissionCommandPath(c),
    fetcher: typeof fetch = async () => Response.json({ ...result(), replayed: true });
  assert.equal((await proxy(path, 'GET', undefined, fetcher)).status, 200);
  assert.equal(
    (await proxy(path, 'GET', undefined, async () => Response.json(result()))).status,
    503,
  );
  assert.equal(
    (
      await proxy(path, 'GET', undefined, async () =>
        Response.json({ ...result(), replayed: true, commandId: subId }),
      )
    ).status,
    503,
  );
  assert.equal(
    (
      await proxy(path, 'GET', undefined, async () =>
        Response.json({ ...result(), replayed: true }, { headers: { 'Set-Cookie': 'unsafe=1' } }),
      )
    ).status,
    503,
  );
  assert.equal(
    (await proxy(path, 'POST', c.body, fetcher, { Origin: 'https://wrong.example' })).status,
    403,
  );
  assert.equal(
    (await proxy(path, 'POST', { ...c.body, note: 'x'.repeat(9000) }, fetcher)).status,
    413,
  );
  assert.equal(
    (
      await proxy(
        path,
        'GET',
        undefined,
        async () =>
          new Response('x'.repeat(262145), { headers: { 'Content-Type': 'application/json' } }),
      )
    ).status,
    503,
  );
});
