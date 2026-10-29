import test from 'node:test';
import assert from 'node:assert/strict';
import {
  creditApplicationCreateSchema,
  creditApplicationSummarySchema,
  creditApplicationDetailSchema,
  readCreditApplicationResult,
  readCreditApplicationPage,
  type CreditApplicationCommand,
} from './credit-application-contract.ts';
import {
  CreditApplicationJournal,
  customerCreditApplicationJournal,
} from './credit-application-journal.ts';
import { isCreditApplicationPath } from './credit-application-path.ts';
import { proxyCreditApplications } from './credit-application-proxy.ts';
import { CustomerSessionStore } from './customer-session.ts';
import { parseCreditRequestedToman } from './credit-application-form.ts';
const id = 'a'.repeat(32),
  commandId = 'b'.repeat(32),
  version = 'AAAAAAAAAAE=',
  amount = '9007199254740993';
const input = () => ({
  planId: 'plan-synthetic',
  planVersion: version,
  requestedAmountRial: amount,
  locale: 'fa' as const,
});
const summary = () => ({
  id,
  planId: 'plan-synthetic',
  requestedAmountRial: amount,
  locale: 'fa',
  state: 'Draft',
  version,
  createdAt: '2026-10-27T00:00:00.1234567Z',
  changedAt: '2026-10-27T00:00:00.1234567Z',
});
const command = (): Extract<CreditApplicationCommand, { kind: 'create' }> => ({
  kind: 'create',
  id: commandId,
  body: input(),
});
const result = () => ({ schemaVersion: 1, replayed: false, commandId, application: summary() });
const plan = () => ({
  id: 'plan-synthetic',
  version,
  nameFa: 'طرح ساختگی',
  nameEn: 'Synthetic plan',
  months: 6,
  markupBasisPoints: 3000,
  downPaymentBasisPoints: 2500,
  intervalMonths: 1,
  roundingUnitRial: '10',
  minAmountRial: null,
  maxAmountRial: null,
  categoryIds: [],
});
test('Persian and Arabic decimal input converts a large toman request to exact integer rial', () => {
  assert.equal(parseCreditRequestedToman('۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹٫۳'), 9007199254740993n);
  assert.equal(parseCreditRequestedToman('٩٠٠٧١٩٩٢٥٤٧٤٠٩٩.٣'), 9007199254740993n);
  assert.equal(parseCreditRequestedToman('922337203685477580.7'), 9223372036854775807n);
  for (const value of ['1.11', '1٫2٫3', '-1', '922337203685477580.8'])
    assert.equal(parseCreditRequestedToman(value), undefined);
});
test('credit DTOs keep exact positive Int64 rial and reject ownership, approval and changed resource injection', () => {
  assert.equal(creditApplicationCreateSchema.parse(input()).requestedAmountRial, amount);
  for (const value of ['0', '01', '۱۰۰', '-1', '1.0', '9223372036854775808'])
    assert.equal(
      creditApplicationCreateSchema.safeParse({ ...input(), requestedAmountRial: value }).success,
      false,
    );
  assert.equal(
    creditApplicationSummarySchema.safeParse({ ...summary(), ownerId: 'another' }).success,
    false,
  );
  assert.equal(
    creditApplicationSummarySchema.safeParse({
      ...summary(),
      requestedAmountRial: Number('9007199254740993'),
    }).success,
    false,
  );
  assert.equal(
    creditApplicationCreateSchema.safeParse({ ...input(), approved: true }).success,
    false,
  );
  const detail = {
    schemaVersion: 1,
    application: summary(),
    plan: plan(),
    canSubmit: false,
    blockers: ['credit_submission_not_configured'],
  };
  assert.deepEqual(creditApplicationDetailSchema.parse(detail), detail);
  assert.equal(
    creditApplicationDetailSchema.safeParse({
      ...detail,
      plan: { ...plan(), roundingUnitRial: 10 },
    }).success,
    false,
  );
  assert.equal(
    creditApplicationDetailSchema.safeParse({ ...detail, canSubmit: true }).success,
    false,
  );
  assert.equal(
    creditApplicationDetailSchema.safeParse({ ...detail, plan: { ...plan(), id: 'different' } })
      .success,
    false,
  );
  assert.equal(
    creditApplicationDetailSchema.safeParse({
      ...detail,
      plan: { ...plan(), maxAmountRial: '100' },
    }).success,
    false,
  );
  assert.throws(() =>
    readCreditApplicationResult({ ...result(), commandId: 'c'.repeat(32) }, command()),
  );
  assert.throws(() =>
    readCreditApplicationResult(
      { ...result(), application: { ...summary(), requestedAmountRial: '9007199254740994' } },
      command(),
    ),
  );
  assert.throws(() =>
    readCreditApplicationPage(
      { schemaVersion: 1, state: null, items: [summary()], nextCursor: null },
      'Draft',
    ),
  );
});
test('credit path scopes accept only bounded customer commands and current private staff reads', () => {
  for (const path of [
    '/api/credit/plans',
    '/api/credit/plans?after=plan-name',
    '/api/credit/applications',
    '/api/credit/applications?state=Draft',
    '/api/credit/applications/' + id,
    '/api/credit/commands/' + commandId,
  ])
    assert.equal(isCreditApplicationPath(path), true, path);
  assert.equal(
    isCreditApplicationPath('/api/credit/applications/commands/' + commandId, 'POST'),
    true,
  );
  assert.equal(
    isCreditApplicationPath('/api/credit/applications/' + id + '/cancel/' + commandId, 'PUT'),
    true,
  );
  assert.equal(isCreditApplicationPath('/api/admin/credit/applications/' + id, 'GET', true), true);
  for (const path of [
    '/api/credit/applications?owner=other',
    '/api/credit/applications?state=Draft&state=Cancelled',
    '/api/credit/applications?state=Unknown',
    '/api/credit/commands/' + '0'.repeat(32),
    '/api/credit/plans?cursor=x',
    '/api/credit/applications#private',
    '/api/credit/%2e%2e/auth',
  ])
    assert.equal(isCreditApplicationPath(path), false, path);
  assert.equal(
    isCreditApplicationPath(
      '/api/admin/credit/applications/' + id + '/cancel/' + commandId,
      'PUT',
      true,
    ),
    false,
  );
  assert.equal(isCreditApplicationPath('/api/admin/credit/plans', 'GET', true), false);
});
test('unknown credit commands freeze the original amount and UUID and stay unknown through uncertain failures', () => {
  const journal = new CreditApplicationJournal();
  journal.bind('owner');
  const c = command();
  journal.begin('owner', c);
  c.body.requestedAmountRial = '100';
  journal.fail('owner', journal.snapshot('owner')!.command, 0, 'offline');
  const original = journal.retry('owner');
  assert.equal('requestedAmountRial' in original.body && original.body.requestedAmountRial, amount);
  assert.equal(original.id, commandId);
  journal.fail('owner', original, 409, 'conflict');
  assert.equal(journal.snapshot('owner')!.state, 'unknown');
  assert.throws(() => journal.begin('owner', command()));
  journal.finish('owner', original, result());
  assert.equal(journal.snapshot('owner')!.state, 'done');
  journal.bind('different');
  assert.equal(journal.snapshot('owner'), null);
  assert.equal(journal.finish('owner', original, result()), false);
});
test('customer session binds credit memory, permits exact new routes and erases it on remote logout', async () => {
  const session = {
    accessToken: 'a'.repeat(50),
    expiresIn: 600,
    requiresMfa: false,
    requiresEnrollment: false,
    user: { id: 'owner-qa', displayName: 'Synthetic QA', userName: 'qa' },
  };
  const store = new CustomerSessionStore(
    async () => session,
    async () => session,
    async (fn) => fn(),
    () => false,
  );
  await store.login('qa', 'synthetic');
  customerCreditApplicationJournal.begin('owner-qa', command());
  customerCreditApplicationJournal.interrupt();
  assert.equal(customerCreditApplicationJournal.snapshot('owner-qa')!.state, 'unknown');
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (path, init) => {
    calls++;
    assert.equal(path, '/api/credit/applications');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer ' + session.accessToken);
    return Response.json({});
  };
  try {
    await store.fetch('/api/credit/applications');
    await assert.rejects(() => store.fetch('/api/admin/credit/applications'));
    assert.equal(calls, 1);
    store.remote('signout');
    assert.equal(customerCreditApplicationJournal.snapshot('owner-qa'), null);
  } finally {
    globalThis.fetch = previous;
    customerCreditApplicationJournal.bind(null);
  }
});
test('credit BFF never forwards cookies, bounds input and binds successful receipts to the exact frozen request', async () => {
  const env = {
      SHOP_DATA_MODE: 'api',
      SHOP_API_URL: 'http://127.0.0.1:5080',
      SHOP_PUBLIC_URL: 'http://sayman-ui.localhost:3105',
    },
    path = ['applications', 'commands', commandId],
    url = env.SHOP_PUBLIC_URL + '/api/credit/' + path.join('/'),
    headers = {
      Authorization: 'Bearer ' + 'x'.repeat(30),
      Origin: env.SHOP_PUBLIC_URL,
      Cookie: 'must-not-forward=1',
      'Content-Type': 'application/json',
    };
  let calls = 0;
  const fetcher: typeof fetch = async (target, init) => {
    calls++;
    assert.equal(target, env.SHOP_API_URL + '/api/credit/' + path.join('/'));
    assert.equal(new Headers(init?.headers).get('Cookie'), null);
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.redirect, 'error');
    assert.deepEqual(JSON.parse(String(init?.body)), input());
    return Response.json(result());
  };
  let response = await proxyCreditApplications(
    new Request(url, { method: 'POST', headers, body: JSON.stringify(input()) }),
    path,
    env,
    fetcher,
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control')!, /private, no-store/);
  assert.match(response.headers.get('X-Robots-Tag')!, /noindex/);
  assert.equal(calls, 1);
  response = await proxyCreditApplications(
    new Request(url, {
      method: 'POST',
      headers: { ...headers, Origin: 'https://wrong.example' },
      body: '{}',
    }),
    path,
    env,
    fetcher,
  );
  assert.equal(response.status, 403);
  response = await proxyCreditApplications(
    new Request(url, { method: 'POST', headers, body: 'x'.repeat(8193) }),
    path,
    env,
    fetcher,
  );
  assert.equal(response.status, 413);
  assert.equal(calls, 1);
  for (const change of ['cookie', 'wrong-id', 'oversize']) {
    const fake: typeof fetch = async () =>
      change === 'cookie'
        ? Response.json(result(), { headers: { 'Set-Cookie': 'forbidden=1' } })
        : change === 'wrong-id'
          ? Response.json({ ...result(), commandId: 'c'.repeat(32) })
          : new Response('x'.repeat(262145));
    response = await proxyCreditApplications(
      new Request(url, { method: 'POST', headers, body: JSON.stringify(input()) }),
      path,
      env,
      fake,
    );
    assert.equal(response.status, 503, change);
    assert.equal(response.headers.get('Set-Cookie'), null);
  }
});
