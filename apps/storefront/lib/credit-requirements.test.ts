import test from 'node:test';
import assert from 'node:assert/strict';
import {
  creditRequirementsContentSchema,
  creditRequirementsCurrentSchema,
  creditCaseRequirementsSchema,
  canonicalCreditRequirements,
  readCreditRequirementsResult,
  readCreditCaseRequirements,
  type CreditRequirementsContent,
  type CreditRequirementsCommand,
} from './credit-requirements-contract.ts';
import {
  CreditRequirementsJournal,
  customerCreditConsentJournal,
} from './credit-requirements-journal.ts';
import { isCreditRequirementsPath } from './credit-requirements-path.ts';
import { proxyCreditApplications } from './credit-application-proxy.ts';
import { CustomerSessionStore } from './customer-session.ts';
const appId = 'a'.repeat(32),
  revisionId = 'b'.repeat(32),
  commandId = 'c'.repeat(32),
  consentId = 'd'.repeat(32),
  before = 'AAAAAAAAAAE=',
  after = 'AAAAAAAAAAI=',
  at = '2026-10-27T00:00:00+00:00';
const content = (): CreditRequirementsContent => ({
  titleFa: 'شرایط ساختگی آزمون',
  titleEn: 'Synthetic QA terms',
  termsFa: 'این متن فقط ساختگی و بدون تعهد است.',
  termsEn: 'Synthetic only, no real agreement.',
  consentLabelFa: 'متن ساختگی را در آزمون بررسی کردم.',
  consentLabelEn: 'I reviewed this synthetic test text.',
  enabled: true,
  documents: [
    {
      key: 'sample',
      nameFa: 'مدرک ساختگی',
      nameEn: 'Synthetic proof',
      helpFa: '',
      helpEn: '',
      required: true,
      maxBytes: 8388608,
      contentTypes: ['image/png', 'application/pdf'],
    },
  ],
});
const revision = () => ({
  id: revisionId,
  createdAt: at,
  content: canonicalCreditRequirements(content()),
});
const current = () => ({ schemaVersion: 1, version: before, published: revision() });
const app = () => ({
  id: appId,
  planId: 'synthetic',
  requestedAmountRial: '9007199254740993',
  locale: 'fa',
  state: 'Draft',
  version: after,
  createdAt: at,
  changedAt: at,
});
const consent = () => ({ id: consentId, locale: 'fa', acceptedAt: at, requirements: revision() });
const command = (): Extract<CreditRequirementsCommand, { kind: 'consent' }> => ({
  kind: 'consent',
  id: commandId,
  applicationId: appId,
  body: {
    applicationVersion: before,
    requirementsRevisionId: revisionId,
    requirementsVersion: before,
    locale: 'fa',
    accepted: true,
  },
});
const result = () => ({
  schemaVersion: 1,
  replayed: false,
  commandId,
  application: app(),
  consent: consent(),
});
test('requirements require explicit bilingual content, allowed document types and coherent consent status', () => {
  assert.ok(creditRequirementsContentSchema.safeParse(content()).success);
  assert.ok(
    creditRequirementsCurrentSchema.safeParse({ schemaVersion: 1, version: null, published: null })
      .success,
  );
  for (const change of [
    { termsEn: '' },
    { consentLabelFa: '' },
    { enabled: undefined },
    { titleFa: 'عنوان\u202eگمراه‌کننده' },
    { documents: [{ ...content().documents[0], required: undefined }] },
    { documents: [{ ...content().documents[0], contentTypes: ['image/svg+xml'] }] },
    { documents: [...content().documents, ...content().documents] },
  ])
    assert.equal(
      creditRequirementsContentSchema.safeParse({ ...content(), ...change }).success,
      false,
    );
  const detail = {
    schemaVersion: 1,
    application: app(),
    current: current(),
    consent: null,
    canConsent: true,
  };
  assert.ok(creditCaseRequirementsSchema.safeParse(detail).success);
  assert.equal(
    creditCaseRequirementsSchema.safeParse({ ...detail, canConsent: false }).success,
    false,
  );
  assert.equal(
    creditCaseRequirementsSchema.safeParse({
      ...detail,
      application: { ...app(), ownerId: 'injected' },
    }).success,
    false,
  );
  assert.throws(() => readCreditCaseRequirements(detail, 'e'.repeat(32)));
  assert.ok(
    creditCaseRequirementsSchema.safeParse({ ...detail, consent: consent(), canConsent: false })
      .success,
  );
  assert.equal(
    creditRequirementsCurrentSchema.safeParse({ ...current(), version: null }).success,
    false,
  );
});
test('publication and consent receipts bind the exact command, language, revision and rotated case version', () => {
  assert.equal('application' in readCreditRequirementsResult(result(), command()), true);
  for (const change of [
    { commandId: 'e'.repeat(32) },
    { application: { ...app(), id: 'e'.repeat(32) } },
    { consent: { ...consent(), locale: 'en' } },
    { consent: { ...consent(), requirements: { ...revision(), id: 'e'.repeat(32) } } },
  ])
    assert.throws(() => readCreditRequirementsResult({ ...result(), ...change }, command()));
  const publish: CreditRequirementsCommand = {
      kind: 'publish',
      id: commandId,
      body: { version: before, content: content() },
    },
    published = {
      schemaVersion: 1,
      replayed: false,
      commandId,
      current: { ...current(), version: after },
    };
  assert.ok(readCreditRequirementsResult(published, publish));
  assert.throws(() =>
    readCreditRequirementsResult(
      {
        ...published,
        current: {
          ...published.current,
          published: { ...revision(), content: { ...revision().content, termsFa: 'متن متفاوت' } },
        },
      },
      publish,
    ),
  );
});
test('requirements paths reject staff consent, case owner overrides, duplicate cursors and unexpected operations', () => {
  for (const [path, method, staff] of [
    ['/api/credit/requirements', 'GET', false],
    ['/api/credit/applications/' + appId + '/requirements', 'GET', false],
    ['/api/credit/applications/' + appId + '/consents/' + commandId, 'POST', false],
    ['/api/credit/applications/' + appId + '/consents/' + commandId, 'GET', false],
    ['/api/admin/credit/requirements/commands/' + commandId, 'POST', true],
    ['/api/admin/credit/requirements/history?cursor=YQ%3D%3D', 'GET', true],
    ['/api/admin/credit/applications/' + appId + '/requirements', 'GET', true],
  ] as const)
    assert.equal(isCreditRequirementsPath(path, method, staff), true, path);
  for (const [path, method, staff] of [
    ['/api/admin/credit/applications/' + appId + '/consents/' + commandId, 'POST', true],
    ['/api/credit/requirements?owner=foreign', 'GET', false],
    ['/api/admin/credit/requirements/history?cursor=YQ%3D%3D&cursor=YQ%3D%3D', 'GET', true],
    ['/api/admin/credit/requirements/commands/' + commandId + '?version=x', 'POST', true],
    ['/api/credit/applications/' + '0'.repeat(32) + '/requirements', 'GET', false],
    ['/api/credit/requirements#hidden', 'GET', false],
    ['/api/admin/credit/requirements', 'DELETE', true],
  ] as const)
    assert.equal(isCreditRequirementsPath(path, method, staff), false, path);
});
test('unknown consent memory freezes the accepted revision and clears at verified logout boundaries', async () => {
  const journal = new CreditRequirementsJournal();
  journal.bind('qa');
  const c = command();
  journal.begin('qa', c);
  c.body.requirementsRevisionId = 'e'.repeat(32);
  journal.interrupt();
  const retry = journal.retry('qa');
  assert.equal(
    retry.body && 'requirementsRevisionId' in retry.body && retry.body.requirementsRevisionId,
    revisionId,
  );
  journal.fail('qa', retry, 409, 'conflict');
  assert.equal(journal.snapshot('qa')?.state, 'unknown');
  assert.throws(() => journal.begin('qa', command()));
  assert.equal(journal.finish('qa', retry, result()), true);
  journal.bind('other');
  assert.equal(journal.finish('qa', retry, result()), false);
  const session = {
    accessToken: 'x'.repeat(50),
    expiresIn: 600,
    requiresMfa: false,
    requiresEnrollment: false,
    user: { id: 'qa-consent', displayName: 'Synthetic', userName: 'qa' },
  };
  const store = new CustomerSessionStore(
    async () => session,
    async () => session,
    async (f) => f(),
    () => false,
  );
  await store.login('qa', 'synthetic');
  customerCreditConsentJournal.begin('qa-consent', command());
  store.remote('signout');
  assert.equal(customerCreditConsentJournal.snapshot('qa-consent'), null);
});
test('consent BFF bounds and validates the new body and never relays cookies or a mismatched revision receipt', async () => {
  const env = {
      SHOP_DATA_MODE: 'api',
      SHOP_API_URL: 'http://127.0.0.1:5080',
      SHOP_PUBLIC_URL: 'http://sayman-ui.localhost:3105',
    },
    path = ['applications', appId, 'consents', commandId],
    url = env.SHOP_PUBLIC_URL + '/api/credit/' + path.join('/'),
    headers = {
      Authorization: 'Bearer ' + 'x'.repeat(30),
      Origin: env.SHOP_PUBLIC_URL,
      Cookie: 'forbidden=1',
      'Content-Type': 'application/json',
    };
  let calls = 0;
  const fetcher: typeof fetch = async (target, init) => {
    calls++;
    assert.equal(target, env.SHOP_API_URL + '/api/credit/' + path.join('/'));
    assert.equal(new Headers(init?.headers).get('Cookie'), null);
    assert.deepEqual(JSON.parse(String(init?.body)), command().body);
    return Response.json(result());
  };
  let response = await proxyCreditApplications(
    new Request(url, { method: 'POST', headers, body: JSON.stringify(command().body) }),
    path,
    env,
    fetcher,
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control')!, /private, no-store/);
  assert.match(response.headers.get('X-Robots-Tag')!, /noindex/);
  response = await proxyCreditApplications(
    new Request(url, { method: 'POST', headers, body: 'x'.repeat(8193) }),
    path,
    env,
    fetcher,
  );
  assert.equal(response.status, 413);
  assert.equal(calls, 1);
  const bad: typeof fetch = async () =>
    Response.json({ ...result(), consent: { ...consent(), locale: 'en' } });
  response = await proxyCreditApplications(
    new Request(url, { method: 'POST', headers, body: JSON.stringify(command().body) }),
    path,
    env,
    bad,
  );
  assert.equal(response.status, 503);
  const get = ['applications', appId, 'requirements'];
  response = await proxyCreditApplications(
    new Request(env.SHOP_PUBLIC_URL + '/api/credit/' + get.join('/'), { headers }),
    get,
    env,
    async () =>
      Response.json({
        schemaVersion: 1,
        application: app(),
        current: current(),
        consent: consent(),
        canConsent: false,
      }),
  );
  assert.equal(response.status, 200);
});
