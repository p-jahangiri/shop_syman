import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '@sayman/web-shared/lib/orders/rma-contract.ts';
import {
  rmaContext,
  rmaDetail,
  rmaResult,
  rmaOrderId,
  rmaCaseId,
  rmaCommandId,
  rmaPublicPolicy,
  rmaCreateBody,
} from '@sayman/web-shared/testing/rma.test-fixtures.ts';
test('RMA current public policy is bilingual/minimal and unconfigured is explicit null, never invented three-day policy', () => {
  assert.equal(c.readRmaPublicPolicy(rmaPublicPolicy()).windowDays, 3);
  const empty = {
    schemaVersion: 1,
    configured: false,
    enabled: false,
    physicalReturns: false,
    digitalComplaints: false,
    conditionsFa: null,
    conditionsEn: null,
    windowMode: null,
    windowDays: null,
    canRefund: false,
    refundAvailability: 'provider_unconfigured',
  };
  assert.equal(c.readRmaPublicPolicy(empty).configured, false);
  for (const x of [
    { ...empty, windowDays: 3 },
    { ...empty, enabled: true },
    { ...rmaPublicPolicy(), version: 'AAAAAAAAAAE=' },
    { ...rmaPublicPolicy(), canRefund: true },
    { ...rmaPublicPolicy(), windowMode: 'manualReview', windowDays: 3 },
  ])
    assert.throws(() => c.readRmaPublicPolicy(x));
});
test('RMA context verifies immutable order binding, quantities and financial blockers', () => {
  assert.equal(c.readRmaContext(rmaContext(), rmaOrderId).lines[0].requestableQuantity, 1);
  assert.throws(() => c.readRmaContext(rmaContext(), rmaCaseId));
  for (const change of [
    { canRequest: true, blockers: ['payment_not_confirmed'] },
    { orderState: 'AwaitingPayment' },
    { lines: [{ ...rmaContext().lines[0], requestableQuantity: 3 }] },
    { canRestock: true },
    { orderVersion: 'AAAAAAAAAAE=\n' },
  ])
    assert.throws(() => c.readRmaContext({ ...rmaContext(), ...change }, rmaOrderId));
  const blocked = { ...rmaContext(), canRequest: false, blockers: ['active_request_exists'] };
  assert.equal(c.readRmaContext(blocked, rmaOrderId).canRequest, false);
});
test('RMA detail and receipt bind order/case/command/audience and reject staff private leakage to customer', () => {
  assert.equal(
    c.readRmaDetail(rmaDetail(), { orderId: rmaOrderId, caseId: rmaCaseId }).case.id,
    rmaCaseId,
  );
  assert.equal(
    c.readRmaDetail(rmaDetail(true), { staff: true, ownerId: 'CUSTOMER' }).case.ownerId,
    'CUSTOMER',
  );
  assert.throws(() => c.readRmaDetail(rmaDetail(true)));
  assert.throws(() =>
    c.readRmaDetail({
      ...rmaDetail(),
      events: [{ ...rmaDetail().events[0], staffNote: 'PRIVATE' }],
    }),
  );
  assert.throws(() => c.readRmaDetail(rmaDetail(true), { staff: true, ownerId: 'OTHER' }));
  assert.equal(
    c.readRmaCommandResult(rmaResult(), {
      commandId: rmaCommandId,
      caseId: rmaCaseId,
      orderId: rmaOrderId,
    }).case.case.reference,
    'RMA-1',
  );
  assert.throws(() => c.readRmaCommandResult(rmaResult(), { commandId: rmaCaseId }));
  for (const change of [
    { canRefund: true },
    { canReceive: true },
    { canRestock: true },
    { canReship: true },
    { lines: [{ ...rmaDetail().lines[0], quantity: 3 }] },
    { lines: [{ ...rmaDetail().lines[0], isDigital: true }] },
    { case: { ...rmaDetail().case, itemCount: 2 } },
    { case: { ...rmaDetail().case, state: 'withdrawn', isOpen: true } },
  ])
    assert.throws(() => c.readRmaDetail({ ...rmaDetail(), ...change }));
});
test('RMA request inputs reject duplicate selection, control/bidi injection, no acknowledgement and invalid review outcome', () => {
  assert.equal(c.rmaCreateInputSchema.parse(rmaCreateBody()).lines.length, 1);
  for (const body of [
    { ...rmaCreateBody(), lines: [...rmaCreateBody().lines, ...rmaCreateBody().lines] },
    { ...rmaCreateBody(), acknowledgeNoFinancialAction: false },
    { ...rmaCreateBody(), reason: 'x\u202ey' },
    { ...rmaCreateBody(), reason: 'x\u0000y' },
    { ...rmaCreateBody(), reason: ' '.repeat(10) },
    { ...rmaCreateBody(), lines: [{ lineKey: 'physical', quantity: 1.1 }] },
  ])
    assert.equal(c.rmaCreateInputSchema.safeParse(body).success, false);
  const review = {
    ownerId: 'CUSTOMER',
    version: 'AAAAAAAAAAE=',
    action: 'startReview',
    outcome: null,
    note: 'private',
    customerMessage: null,
    acknowledgeNoFinancialAction: true,
  };
  assert.equal(c.rmaReviewInputSchema.safeParse(review).success, true);
  assert.equal(c.rmaReviewInputSchema.safeParse({ ...review, outcome: 'followUp' }).success, false);
  assert.equal(
    c.rmaReviewInputSchema.safeParse({ ...review, action: 'completeReview' }).success,
    false,
  );
});
test('private RMA path resolver allows exact GET/PUT with bounded unique queries and excludes public policy', () => {
  for (const [p, m] of [
    [`/api/orders/${rmaOrderId}/returns/context`, 'GET'],
    [`/api/orders/${rmaOrderId}/returns/commands/${rmaCommandId}`, 'PUT'],
    ['/api/returns?state=reviewing&after=YWJjZA%3D%3D', 'GET'],
    [`/api/returns/${rmaCaseId}/withdrawals/${rmaCommandId}`, 'PUT'],
    [`/api/returns/commands/${rmaCommandId}`, 'GET'],
  ])
    assert.equal(c.isCustomerRmaPath(p, m), true, `${p} ${m}`);
  for (const [p, m] of [
    ['/api/returns/policy', 'GET'],
    ['/api/returns', 'PUT'],
    ['/api/returns?state=reviewing&state=submitted', 'GET'],
    ['/api/returns?foo=x', 'GET'],
    ['/api/returns?after=YWJj%0A', 'GET'],
    ['/api/returns/00000000000000000000000000000000', 'GET'],
    ['/api/returns?state=bad', 'GET'],
    ['/api/returns#x', 'GET'],
    [`/api/returns/${rmaCaseId}`, 'PUT'],
    [`/api/returns/${rmaCaseId}/withdrawals/${rmaCommandId}`, 'POST'],
    [`/api/orders/${rmaOrderId}/returns/context`, 'PUT'],
    [`/api/returns/%32${rmaCaseId.slice(1)}`, 'GET'],
  ])
    assert.equal(c.isCustomerRmaPath(p, m), false, `${p} ${m}`);
});
