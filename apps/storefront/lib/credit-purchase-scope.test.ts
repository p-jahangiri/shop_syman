import test from 'node:test';
import assert from 'node:assert/strict';
import {
  creditScopeGrantBodySchema,
  creditScopeRevokeBodySchema,
  creditScopeCommandSchema,
  creditPurchaseScopeDataSchema,
  isCreditPurchaseScopePath,
  creditScopeCommandPath,
  readCreditPurchaseScopePage,
  readCreditScopeResult,
  type CreditScopeCommand,
} from './credit-purchase-scope-contract.ts';
import { CreditScopeJournal, customerCreditScopeJournal } from './credit-purchase-scope-journal.ts';
import { CustomerSessionStore } from './customer-session.ts';
import { isCreditApplicationPath } from './credit-application-path.ts';
import { proxyCreditApplications } from './credit-application-proxy.ts';
const appId = 'a'.repeat(32),
  subId = 'b'.repeat(32),
  reviewId = 'c'.repeat(32),
  scopeId = 'd'.repeat(32),
  commandId = 'e'.repeat(32),
  at = '2026-10-27T10:00:00+00:00',
  until = '2026-10-28T10:00:00Z',
  before = 'AAAAAAAAAAE=',
  after = 'AAAAAAAAAAI=';
const app = () => ({
  id: appId,
  planId: 'qa',
  requestedAmountRial: '9007199254740993',
  locale: 'fa',
  state: 'Approved',
  version: after,
  createdAt: at,
  changedAt: at,
});
const scope = () => ({
  id: scopeId,
  version: after,
  reviewId,
  submissionId: subId,
  limitBasis: 'PayableTotalRial',
  limitAmountRial: '9007199254740993',
  expiresAt: until,
  grantedAt: at,
  state: 'Active',
  revocation: null,
});
const grant = (): CreditScopeCommand => ({
  id: commandId,
  applicationId: appId,
  staff: true,
  kind: 'Grant',
  approval: { approvedAmountRial: '9007199254740993', expiresAt: until, submissionId: subId },
  body: {
    applicationVersion: before,
    reviewId,
    limitBasis: 'PayableTotalRial',
    grantConfirmed: true,
  },
});
const revoke = (): CreditScopeCommand => ({
  id: commandId,
  applicationId: appId,
  staff: false,
  kind: 'Revoke',
  body: {
    applicationVersion: before,
    scopeVersion: after,
    locale: 'fa',
    note: 'یادداشت ساختگی 😀',
    revokeConfirmed: true,
  },
});
const result = () => ({
  schemaVersion: 1,
  replayed: false,
  commandId,
  kind: 'Grant',
  application: app(),
  scope: scope(),
});
const revoked = () => ({
  ...result(),
  kind: 'Revoke',
  scope: {
    ...scope(),
    state: 'Revoked',
    revocation: { actorKind: 'Owner', locale: 'fa', note: 'یادداشت ساختگی 😀', at },
  },
});
const page = () => ({
  schemaVersion: 1,
  application: app(),
  reviewId,
  scope: scope(),
  canGrant: false,
  canRevoke: true,
  eligibleForQuote: true,
  grantBlockers: ['credit_scope_already_granted'],
  quoteBlockers: [],
  canPlaceOrder: false,
  canPay: false,
});
test('purchase scope routes exclude owner grants, query injection, zero IDs and unrelated methods', () => {
  for (const staff of [false, true]) {
    const base =
      (staff ? '/api/admin/credit' : '/api/credit') + '/applications/' + appId + '/purchase-scope';
    for (const suffix of ['', '/commands/' + commandId]) {
      assert.ok(isCreditPurchaseScopePath(base + suffix, 'GET', staff));
      assert.ok(isCreditApplicationPath(base + suffix, 'GET', staff));
      for (const extra of ['?owner=forged', '#hash', '/extra'])
        assert.equal(isCreditPurchaseScopePath(base + suffix + extra, 'GET', staff), false);
    }
    assert.equal(isCreditPurchaseScopePath(base + '/grant/' + commandId, 'POST', staff), staff);
    assert.ok(isCreditPurchaseScopePath(base + '/revoke/' + commandId, 'POST', staff));
    assert.equal(isCreditPurchaseScopePath(base + '/revoke/' + commandId, 'PUT', staff), false);
    assert.equal(
      isCreditPurchaseScopePath(base.replace(appId, '0'.repeat(32)), 'GET', staff),
      false,
    );
  }
  assert.match(creditScopeCommandPath(grant()), /\/grant\//);
  assert.match(creditScopeCommandPath(revoke(), true), /\/commands\//);
});
test('grant has explicit basis and confirmation with no client price, while revocation requires staff reason', () => {
  const c = grant();
  assert.equal(c.kind, 'Grant');
  if (c.kind !== 'Grant') return;
  assert.ok(creditScopeGrantBodySchema.parse(c.body));
  for (const patch of [
    { grantConfirmed: false },
    { grantConfirmed: undefined },
    { limitBasis: '' },
    { limitBasis: 'Wallet' },
    { amountRial: '1' },
    { expiresAt: until },
    { ownerId: 'forged' },
  ])
    assert.equal(creditScopeGrantBodySchema.safeParse({ ...c.body, ...patch }).success, false);
  const r = revoke();
  assert.ok(creditScopeRevokeBodySchema.parse(r.body));
  assert.ok(creditScopeCommandSchema.parse({ ...r, body: { ...r.body, note: '' } }));
  assert.equal(
    creditScopeCommandSchema.safeParse({ ...r, staff: true, body: { ...r.body, note: '' } })
      .success,
    false,
  );
  for (const patch of [{ revokeConfirmed: false }, { note: 'bad\ud800' }, { locale: 'xx' }])
    assert.equal(creditScopeRevokeBodySchema.safeParse({ ...r.body, ...patch }).success, false);
  assert.equal(creditScopeCommandSchema.safeParse({ ...c, staff: false }).success, false);
});
test('scope decoding binds limit, UTC, state, review, case and absence of ordering capability', () => {
  assert.ok(readCreditPurchaseScopePage(page(), appId));
  for (const patch of [
    { canGrant: true },
    { canPlaceOrder: true },
    { canPay: true },
    { eligibleForQuote: false },
    { reviewId: subId },
    { scope: { ...scope(), limitAmountRial: Number('9007199254740993') } },
    { scope: { ...scope(), expiresAt: at } },
    { scope: { ...scope(), state: 'Revoked' } },
    { scope: { ...scope(), limitAmountRial: '9007199254740994' } },
  ])
    assert.throws(() => readCreditPurchaseScopePage({ ...page(), ...patch }, appId));
  assert.ok(
    readCreditPurchaseScopePage(
      {
        ...page(),
        scope: null,
        canGrant: false,
        canRevoke: false,
        eligibleForQuote: false,
        grantBlockers: ['credit_scope_grant_write_required'],
        quoteBlockers: ['credit_scope_required'],
      },
      appId,
    ),
  );
  assert.equal(
    creditPurchaseScopeDataSchema.safeParse({ ...scope(), expiresAt: '2026-10-28T10:00:00+03:30' })
      .success,
    false,
  );
});
test('receipt preserves exact approved money and expiry, binds actor audience and keeps historical Active grant after revocation', () => {
  const c = grant();
  assert.equal(readCreditScopeResult(result(), c).scope.limitAmountRial, '9007199254740993');
  assert.ok(readCreditScopeResult({ ...result(), replayed: true }, c));
  for (const patch of [
    { commandId: scopeId },
    { application: { ...app(), version: before } },
    { scope: { ...scope(), limitBasis: 'InstallmentsTotalRial' } },
    { scope: { ...scope(), limitAmountRial: '9007199254740992' } },
    { scope: { ...scope(), expiresAt: '2026-10-29T10:00:00Z' } },
    { scope: { ...scope(), submissionId: reviewId } },
  ])
    assert.throws(() => readCreditScopeResult({ ...result(), ...patch }, c));
  assert.ok(readCreditScopeResult(revoked(), revoke()));
  assert.throws(() =>
    readCreditScopeResult(
      {
        ...revoked(),
        scope: {
          ...revoked().scope,
          revocation: { ...revoked().scope.revocation, actorKind: 'Staff' },
        },
      },
      revoke(),
    ),
  );
  assert.throws(() =>
    readCreditScopeResult(
      { ...revoked(), scope: { ...revoked().scope, revocation: null } },
      revoke(),
    ),
  );
});
test('unknown scope journal retains frozen approval and UUID, blocks replacement and clears on account change', () => {
  const j = new CreditScopeJournal(),
    c = grant();
  j.bind('staff');
  j.begin('staff', c);
  if (c.kind === 'Grant') c.approval.approvedAmountRial = '1';
  j.interrupt();
  j.clear('staff');
  assert.equal(j.snapshot('staff')!.state, 'unknown');
  const retry = j.retry('staff');
  if (retry.kind === 'Grant') assert.equal(retry.approval.approvedAmountRial, '9007199254740993');
  j.fail('staff', retry, 404, 'not_found');
  assert.equal(j.snapshot('staff')!.state, 'unknown');
  assert.throws(() => j.begin('staff', grant()));
  assert.ok(j.finish('staff', retry, { ...result(), replayed: true }));
  j.bind('other');
  assert.equal(j.snapshot('staff'), null);
  assert.equal(j.finish('staff', retry, result()), false);
});
test('remote signout clears private revocation journal immediately', async () => {
  const session = {
      accessToken: 'x'.repeat(50),
      expiresIn: 600,
      requiresMfa: false,
      requiresEnrollment: false,
      user: { id: 'qa-scope', displayName: 'Synthetic', userName: 'qa' },
    },
    store = new CustomerSessionStore(
      async () => session,
      async () => session,
      async (f) => f(),
      () => false,
    );
  await store.login('qa', 'synthetic');
  customerCreditScopeJournal.begin('qa-scope', revoke());
  store.remote('signout');
  assert.equal(customerCreditScopeJournal.snapshot('qa-scope'), null);
});
test('customer BFF permits only owner revocation, bounds input and verifies actor-bound receipts without cookies', async () => {
  const env = {
      SHOP_DATA_MODE: 'api',
      SHOP_API_URL: 'http://127.0.0.1:5080',
      SHOP_PUBLIC_URL: 'http://127.0.0.1:3000',
    },
    c = revoke(),
    path = creditScopeCommandPath(c),
    headers = {
      Authorization: 'Bearer ' + 'x'.repeat(32),
      Cookie: 'never-forward=1',
      Origin: env.SHOP_PUBLIC_URL,
      'Content-Type': 'application/json',
    };
  const fetcher: typeof fetch = async (target, init) => {
    assert.equal(target, env.SHOP_API_URL + path);
    assert.equal(new Headers(init?.headers).get('Cookie'), null);
    assert.deepEqual(JSON.parse(String(init?.body)), c.body);
    return Response.json(revoked());
  };
  const call = (p: string, body: unknown = c.body, f: typeof fetch = fetcher) =>
    proxyCreditApplications(
      new Request(env.SHOP_PUBLIC_URL + p, { method: 'POST', headers, body: JSON.stringify(body) }),
      p.slice('/api/credit/'.length).split('/'),
      env,
      f,
    );
  const response = await call(path);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control')!, /no-store/);
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.equal((await call(path.replace('/revoke/', '/grant/'))).status, 404);
  assert.equal((await call(path, { ...c.body, ownerId: 'forged' })).status, 400);
  assert.equal(
    (
      await call(path, c.body, async () =>
        Response.json({ ...revoked(), scope: { ...revoked().scope, limitAmountRial: '1.1' } }),
      )
    ).status,
    503,
  );
  const receipt = creditScopeCommandPath(c, true);
  assert.equal(
    (
      await proxyCreditApplications(
        new Request(env.SHOP_PUBLIC_URL + receipt, { headers }),
        receipt.slice('/api/credit/'.length).split('/'),
        env,
        async () => Response.json({ ...revoked(), replayed: true }),
      )
    ).status,
    200,
  );
});
test('used scope points to one retained order, blocks fresh quotes/revocation and never changes historical grant receipts', () => {
  const used = {
    ...scope(),
    state: 'Used',
    use: { orderId: 'f'.repeat(32), creditQuoteId: '1'.repeat(32), at },
  };
  assert.ok(
    readCreditPurchaseScopePage(
      {
        ...page(),
        scope: used,
        canRevoke: false,
        eligibleForQuote: false,
        quoteBlockers: ['credit_scope_used'],
      },
      appId,
    ),
  );
  for (const bad of [
    { ...used, use: undefined },
    { ...used, state: 'Active' },
    { ...used, use: { ...used.use, at: until } },
    { ...used, revocation: { actorKind: 'Owner', locale: 'fa', note: '', at } },
  ])
    assert.equal(creditPurchaseScopeDataSchema.safeParse(bad).success, false);
  assert.throws(() => readCreditPurchaseScopePage({ ...page(), scope: used }, appId));
  assert.ok(readCreditScopeResult(result(), grant()));
});
