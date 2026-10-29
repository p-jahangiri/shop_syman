import test from 'node:test';
import assert from 'node:assert/strict';
import {
  creditReviewBodySchema,
  creditReviewDataSchema,
  creditReviewCapabilitiesSchema,
  isCreditReviewPath,
  readCreditReviewResult,
  readCreditReviewCapabilities,
  readCreditReviewDetail,
  readCreditReviewPage,
  type CreditReviewCommand,
} from './credit-review-contract.ts';
import { CreditReviewJournal } from './credit-review-journal.ts';
import { isCreditApplicationPath } from './credit-application-path.ts';
import { proxyCreditApplications } from './credit-application-proxy.ts';
import { parseCreditReviewExpiryUtc } from './credit-review-form.ts';
const appId = 'a'.repeat(32),
  subId = 'b'.repeat(32),
  reviewId = 'c'.repeat(32),
  commandId = 'd'.repeat(32),
  at = '2026-10-27T10:00:00+00:00',
  until = '2026-10-27T11:00:00Z',
  before = 'AAAAAAAAAAE=',
  after = 'AAAAAAAAAAI=';
const app = () => ({
  id: appId,
  planId: 'synthetic',
  requestedAmountRial: '9007199254740993',
  locale: 'fa',
  state: 'Approved',
  version: after,
  createdAt: at,
  changedAt: at,
});
const command = (): CreditReviewCommand => ({
  id: commandId,
  applicationId: appId,
  body: {
    applicationVersion: before,
    submissionId: subId,
    outcome: 'Approved',
    locale: 'fa',
    note: 'دلیل ساختگی بررسی 😀',
    approvedAmountRial: '9007199254740993',
    expiresAt: until,
    reviewConfirmed: true,
  },
});
const review = () => ({
  id: reviewId,
  submissionId: subId,
  outcome: 'Approved',
  locale: 'fa',
  approvedAmountRial: '9007199254740993',
  expiresAt: until,
  at,
});
const result = () => ({
  schemaVersion: 1,
  replayed: false,
  commandId,
  application: app(),
  review: review(),
  note: command().body.note,
});
const caps = () => ({
  schemaVersion: 1,
  application: { ...app(), state: 'Submitted', version: before },
  submissionId: subId,
  canReview: true,
  canApprove: true,
  blockers: [],
  approvalBlockers: [],
});
test('review paths expose customer history only and staff scoped decisions with actor-only receipts', () => {
  for (const staff of [false, true]) {
    const base = (staff ? '/api/admin/credit' : '/api/credit') + '/applications/' + appId;
    for (const suffix of ['/reviews', '/reviews/' + reviewId]) {
      assert.ok(isCreditReviewPath(base + suffix, 'GET', staff));
      assert.ok(isCreditApplicationPath(base + suffix, 'GET', staff));
      for (const extra of ['?owner=forged', '#hash', '/extra'])
        assert.equal(isCreditReviewPath(base + suffix + extra, 'GET', staff), false);
    }
    assert.equal(isCreditReviewPath(base + '/review', 'GET', staff), staff);
    for (const method of ['POST', 'GET'])
      assert.equal(
        isCreditReviewPath(base + '/reviews/commands/' + commandId, method, staff),
        staff,
      );
    assert.equal(isCreditReviewPath(base + '/reviews/' + reviewId, 'DELETE', staff), false);
    assert.equal(
      isCreditReviewPath(base.replace(appId, '0'.repeat(32)) + '/reviews', 'GET', staff),
      false,
    );
  }
  for (const state of ['Approved', 'Declined'])
    assert.ok(
      isCreditApplicationPath('/api/admin/credit/applications?state=' + state, 'GET', true),
    );
});
test('review input never invents a decision amount expiry or manual confirmation and rejects malformed text', () => {
  assert.ok(creditReviewBodySchema.parse(command().body));
  for (const patch of [
    { reviewConfirmed: false },
    { reviewConfirmed: undefined },
    { outcome: 'Automatic' },
    { note: '' },
    { note: 'bad\ud800' },
    { note: 'x'.repeat(2001) },
    { approvedAmountRial: null },
    { approvedAmountRial: '1.1' },
    { approvedAmountRial: Number('9007199254740993') },
    { expiresAt: null },
    { expiresAt: '2026-10-27T11:00:00+03:30' },
    { outcome: 'Returned' },
    { outcome: 'Declined' },
    { ownerId: 'forged' },
  ])
    assert.equal(creditReviewBodySchema.safeParse({ ...command().body, ...patch }).success, false);
  assert.ok(
    creditReviewBodySchema.parse({
      ...command().body,
      outcome: 'Returned',
      approvedAmountRial: null,
      expiresAt: null,
    }),
  );
});
test('UTC expiry parsing does not reinterpret local time and rejects rollover, expiry and timezone injection', () => {
  const now = Date.parse('2026-10-27T10:00:00Z');
  assert.equal(parseCreditReviewExpiryUtc('2026-10-27T11:30', now), '2026-10-27T11:30:00.000Z');
  for (const value of [
    '2026-10-27T10:00',
    '2026-10-26T11:30',
    '2026-02-30T11:30',
    '2027-02-29T11:30',
    '2026-10-27T25:00',
    '2026-10-27T11:30+03:30',
    '2026-10-27 11:30',
  ])
    assert.equal(parseCreditReviewExpiryUtc(value, now), undefined);
  assert.equal(parseCreditReviewExpiryUtc('2028-02-29T11:30', now), '2028-02-29T11:30:00.000Z');
});
test('decision receipt preserves exact large rial and binds outcome note consent language submission and command', () => {
  const c = command();
  assert.equal(readCreditReviewResult(result(), c).review.approvedAmountRial, '9007199254740993');
  assert.ok(
    readCreditReviewResult(
      { ...result(), review: { ...review(), expiresAt: '2026-10-27T11:00:00+00:00' } },
      c,
    ),
  );
  for (const patch of [
    { commandId: reviewId },
    { note: 'changed' },
    { application: { ...app(), version: before } },
    { review: { ...review(), submissionId: reviewId } },
    { review: { ...review(), locale: 'en' } },
    { review: { ...review(), approvedAmountRial: '9007199254740992' } },
    { review: { ...review(), expiresAt: '2026-10-27T12:00:00Z' } },
  ])
    assert.throws(() => readCreditReviewResult({ ...result(), ...patch }, c));
  const returned = {
    ...c,
    body: { ...c.body, outcome: 'Returned' as const, approvedAmountRial: null, expiresAt: null },
  };
  assert.ok(
    readCreditReviewResult(
      {
        ...result(),
        application: { ...app(), state: 'Draft' },
        review: { ...review(), outcome: 'Returned', approvedAmountRial: null, expiresAt: null },
      },
      returned,
    ),
  );
});
test('review decoding rejects invalid approval constraints and enforces cap authority and historical resource scope', () => {
  assert.ok(readCreditReviewCapabilities(caps(), appId));
  assert.equal(
    creditReviewCapabilitiesSchema.safeParse({ ...caps(), canApprove: false }).success,
    false,
  );
  assert.ok(
    readCreditReviewCapabilities(
      { ...caps(), canApprove: false, approvalBlockers: ['private_file_unavailable'] },
      appId,
    ),
  );
  assert.ok(
    readCreditReviewCapabilities(
      {
        ...caps(),
        canReview: false,
        canApprove: false,
        blockers: ['credit_review_write_required'],
      },
      appId,
    ),
  );
  assert.equal(
    creditReviewCapabilitiesSchema.safeParse({ ...caps(), submissionId: null }).success,
    false,
  );
  assert.equal(creditReviewDataSchema.safeParse({ ...review(), expiresAt: at }).success, false);
  assert.equal(
    creditReviewDataSchema.safeParse({ ...review(), outcome: 'Declined' }).success,
    false,
  );
  const detail = {
    schemaVersion: 1,
    application: { ...app(), state: 'Submitted' },
    review: { ...review(), outcome: 'Returned', approvedAmountRial: null, expiresAt: null },
    note: command().body.note,
  };
  assert.ok(readCreditReviewDetail(detail, appId, reviewId));
  assert.throws(() => readCreditReviewDetail(detail, appId, subId));
  assert.ok(
    readCreditReviewPage(
      { schemaVersion: 1, applicationId: appId, items: [review()], nextCursor: null },
      appId,
    ),
  );
  assert.throws(() =>
    readCreditReviewPage(
      {
        schemaVersion: 1,
        applicationId: appId,
        items: [review(), { ...review(), id: subId }],
        nextCursor: null,
      },
      appId,
    ),
  );
});
test('unknown review journal keeps frozen note amount and UUID and cannot be cleared after uncertain outcome', () => {
  const j = new CreditReviewJournal(),
    c = command();
  j.bind('staff');
  j.begin('staff', c);
  c.body.note = 'changed';
  j.interrupt();
  j.clear('staff');
  assert.equal(j.snapshot('staff')!.state, 'unknown');
  const retry = j.retry('staff');
  assert.equal(retry.body.note, 'دلیل ساختگی بررسی 😀');
  j.fail('staff', retry, 404, 'not_found');
  assert.equal(j.snapshot('staff')!.state, 'unknown');
  assert.throws(() => j.begin('staff', command()));
  assert.ok(j.finish('staff', retry, { ...result(), replayed: true }));
  j.bind('other');
  assert.equal(j.snapshot('staff'), null);
  assert.equal(j.finish('staff', retry, result()), false);
});
test('customer BFF forwards only bounded private history reads and rejects customer or staff decision impersonation', async () => {
  const env = {
      SHOP_DATA_MODE: 'api',
      SHOP_API_URL: 'http://127.0.0.1:5080',
      SHOP_PUBLIC_URL: 'http://127.0.0.1:3000',
    },
    path = '/api/credit/applications/' + appId + '/reviews/' + reviewId,
    headers = {
      Authorization: 'Bearer ' + 'x'.repeat(32),
      Cookie: 'never-forward=1',
      Origin: env.SHOP_PUBLIC_URL,
    },
    fetcher: typeof fetch = async (target, init) => {
      assert.equal(target, env.SHOP_API_URL + path);
      assert.equal(new Headers(init?.headers).get('Cookie'), null);
      return Response.json({
        schemaVersion: 1,
        application: app(),
        review: review(),
        note: command().body.note,
      });
    };
  const response = await proxyCreditApplications(
    new Request(env.SHOP_PUBLIC_URL + path, { headers }),
    path.slice('/api/credit/'.length).split('/'),
    env,
    fetcher,
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control')!, /no-store/);
  assert.equal(response.headers.get('Set-Cookie'), null);
  const denied = path.replace(reviewId, 'commands/' + commandId);
  assert.equal(
    (
      await proxyCreditApplications(
        new Request(env.SHOP_PUBLIC_URL + denied, { method: 'POST', headers, body: '{}' }),
        denied.slice('/api/credit/'.length).split('/'),
        env,
        fetcher,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await proxyCreditApplications(
        new Request(env.SHOP_PUBLIC_URL + path, { headers }),
        path.slice('/api/credit/'.length).split('/'),
        env,
        async () =>
          Response.json({
            schemaVersion: 1,
            application: app(),
            review: { ...review(), id: subId },
            note: command().body.note,
          }),
      )
    ).status,
    503,
  );
});
