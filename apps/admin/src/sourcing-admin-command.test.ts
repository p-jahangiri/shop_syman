import test from 'node:test';
import assert from 'node:assert/strict';
import { offerActionSchema, offerSaveSchema, offerSkuSchema } from './offer-contract.ts';
import {
  canMarkUnavailable,
  commandMethod,
  commandPath,
  commandRequest,
  explicitRial,
  freezeCommand,
  isOfferCommand,
  maySendCommand,
  offerControlsFresh,
  offerEditorLines,
  sourcingFailureIsUnknown,
  utcFromInput,
  type AdminSourcingCommand,
  type OfferEditorLine,
} from './sourcing-admin-command.ts';
import {
  offerTestAction,
  offerTestId,
  offerTestListing,
  offerTestRequest,
  offerTestSave,
  offerTestSku,
} from '../../storefront/lib/offer.test-fixtures.ts';

const sku = offerSkuSchema.parse(offerTestSku);
const request = [{ listingId: offerTestListing, quantity: 2, model: { id: sku.productId } }];
const line = (): OfferEditorLine => ({
  lineId: 'd'.repeat(32),
  listingId: offerTestListing,
  quantity: '2',
  price: '9007199254740993',
  sku,
});
const offer = (): AdminSourcingCommand => ({
  id: offerTestAction.requestId,
  kind: 'save',
  requestId: offerTestRequest,
  offerId: offerTestId,
  reference: 'SR-1',
  body: offerSaveSchema.parse(offerTestSave),
  phase: 'unknown',
  uncertain: true,
});
const review = (): AdminSourcingCommand => ({
  id: 'f'.repeat(32),
  kind: 'review',
  targetId: offerTestRequest,
  reference: 'SR-1',
  body: { requestId: 'f'.repeat(32), version: offerTestAction.requestVersion },
  phase: 'pending',
});
test('request and offer commands share one slot and cannot replace each other or a frozen body', () => {
  const stored = offer();
  assert.equal(maySendCommand(null, stored), true);
  assert.equal(maySendCommand(stored, { ...stored, phase: 'pending' }), true);
  assert.equal(maySendCommand(stored, review()), false);
  assert.equal(maySendCommand(review(), stored), false);
  assert.equal(maySendCommand(stored, { ...stored, id: 'e'.repeat(32) }), false);
  assert.equal(
    maySendCommand(stored, { ...stored, requestId: 'e'.repeat(32) } as AdminSourcingCommand),
    false,
  );
  assert.equal(
    maySendCommand(stored, { ...stored, offerId: 'e'.repeat(32) } as AdminSourcingCommand),
    false,
  );
  if (!isOfferCommand(stored) || stored.kind !== 'save') throw new Error('save fixture');
  assert.equal(
    maySendCommand(stored, { ...stored, body: { ...stored.body, termsFa: 'changed body' } }),
    false,
  );
});
test('save uses PUT on the stable offer target while actions use POST without changing request commands', () => {
  const saved = offer();
  assert.equal(commandMethod(saved), 'PUT');
  assert.equal(
    commandPath(saved),
    `/admin/sourcing/requests/${offerTestRequest}/offers/${offerTestId}`,
  );
  assert.equal(commandRequest(saved), offerTestRequest);
  const withdrawal: AdminSourcingCommand = {
    id: offerTestAction.requestId,
    kind: 'withdraw',
    requestId: offerTestRequest,
    offerId: offerTestId,
    reference: 'SR-1',
    body: offerActionSchema.parse(offerTestAction),
    phase: 'unknown',
  };
  assert.equal(commandMethod(withdrawal), 'POST');
  assert.equal(
    commandPath(withdrawal),
    `/admin/sourcing/requests/${offerTestRequest}/offers/${offerTestId}/withdraw`,
  );
  assert.equal(commandPath(review()), `/admin/sourcing/requests/${offerTestRequest}/review`);
});
test('journal freezes a copied complete body including nested line and version after the form changes', () => {
  const original = offer();
  const frozen = freezeCommand(original);
  if (
    !isOfferCommand(frozen) ||
    frozen.kind !== 'save' ||
    !isOfferCommand(original) ||
    original.kind !== 'save'
  )
    throw new Error('save fixture');
  original.body.lines[0].unitPriceRial = '1';
  assert.equal(frozen.body.lines[0].unitPriceRial, '9007199254740993');
  assert.equal(frozen.body.requestVersion, offerTestAction.requestVersion);
  assert.throws(() => {
    frozen.body.lines[0].unitPriceRial = '2';
  });
  assert.throws(() => {
    frozen.body.lines.push({ ...frozen.body.lines[0] });
  });
});
test('a late 4xx cannot clear uncertainty from an earlier offer attempt', () => {
  for (const status of [0, 400, 401, 403, 404, 409, 429, 500, 503, null])
    assert.equal(sourcingFailureIsUnknown(true, status), true);
  assert.equal(sourcingFailureIsUnknown(false, 409), false);
  assert.equal(sourcingFailureIsUnknown(false, 503), true);
});
test('known commit waiting for fresh GETs keeps its slot without permitting a mutation retry', () => {
  const committed = { ...offer(), phase: 'refresh' as const, uncertain: false };
  assert.equal(maySendCommand(committed, committed), false);
  assert.equal(maySendCommand(committed, review()), false);
  assert.equal(maySendCommand(null, committed), false);
  assert.equal(commandRequest(committed), offerTestRequest);
  assert.equal(committed.body.requestId, offerTestAction.requestId);
});
test('cached draft capabilities never authorize controls after a failed or unfinished fresh GET', () => {
  const base = {
    parentVersion: offerTestAction.requestVersion,
    pageVersion: offerTestAction.requestVersion,
    pageError: false,
    pageFetching: false,
    detailVersion: offerTestAction.requestVersion,
    detailError: false,
    detailFetching: false,
    requireDetail: true,
  };
  assert.equal(offerControlsFresh(base), true);
  for (const update of [
    { pageError: true },
    { pageFetching: true },
    { detailError: true },
    { detailFetching: true },
    { pageVersion: undefined },
    { detailVersion: undefined },
    { pageVersion: 'AAAAAAAAAAI=' },
    { detailVersion: 'AAAAAAAAAAI=' },
    { parentVersion: 'AAAAAAAAAAI=' },
  ])
    assert.equal(offerControlsFresh({ ...base, ...update }), false);
  assert.equal(
    offerControlsFresh({ ...base, requireDetail: false, detailVersion: undefined }),
    true,
  );
  assert.equal(offerControlsFresh({ ...base, requireDetail: false, pageError: true }), false);
});
test('legacy base capability requires the child capability from the current request version', () => {
  const version = offerTestAction.requestVersion;
  assert.equal(canMarkUnavailable(true, null, version), false);
  assert.equal(
    canMarkUnavailable(true, { requestVersion: version, canMark: false }, version),
    false,
  );
  assert.equal(
    canMarkUnavailable(true, { requestVersion: 'AAAAAAAAAAI=', canMark: true }, version),
    false,
  );
  assert.equal(
    canMarkUnavailable(false, { requestVersion: version, canMark: true }, version),
    false,
  );
  assert.equal(canMarkUnavailable(true, { requestVersion: version, canMark: true }, version), true);
});
test('editor keeps integer rial precision and requires an explicitly entered price instead of copying public price', () => {
  const result = offerEditorLines(request, [line()]);
  assert.equal(result.total, '18014398509481986');
  assert.equal(result.lines[0].unitPriceRial, '9007199254740993');
  assert.throws(() => offerEditorLines(request, [{ ...line(), price: '' }]));
  assert.equal(explicitRial('۰'), '0');
  assert.equal(explicitRial('۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۳'), '9007199254740993');
  assert.equal(explicitRial('9223372036854775807'), '9223372036854775807');
  for (const value of ['00', '-1', '1.2', '1,000', '9223372036854775808'])
    assert.throws(() => explicitRial(value));
  assert.throws(() => offerEditorLines(request, [{ ...line(), price: '9223372036854775807' }]));
});
test('allocation covers every original model exactly and rejects foreign, repeated or excessive SKU lines', () => {
  assert.throws(() => offerEditorLines(request, []));
  assert.throws(() => offerEditorLines(request, [{ ...line(), quantity: '1' }]));
  assert.throws(() => offerEditorLines(request, [line(), { ...line(), lineId: 'c'.repeat(32) }]));
  assert.throws(() =>
    offerEditorLines(request, [{ ...line(), sku: { ...sku, productId: 'foreign' } }]),
  );
  assert.throws(() => offerEditorLines(request, [{ ...line(), quantity: '1000001' }]));
  assert.throws(() => offerEditorLines(request, [{ ...line(), quantity: '1.5' }]));
  const split = [
    { ...line(), quantity: '1' },
    {
      ...line(),
      lineId: 'c'.repeat(32),
      quantity: '1',
      sku: { ...sku, variantId: 'other-real-sku' },
    },
  ];
  assert.equal(offerEditorLines(request, split).lines.length, 2);
  assert.equal(offerEditorLines(request, [{ ...line(), quantity: '۲', price: '۰' }]).total, '0');
});
test('UTC form dates are explicit and do not depend on the browser local timezone or normalize invalid dates', () => {
  assert.equal(utcFromInput('2026-10-24T10:30'), '2026-10-24T10:30:00.000Z');
  assert.equal(utcFromInput('2026-10-24T10:30:25'), '2026-10-24T10:30:25.000Z');
  for (const value of [
    '',
    '2026-02-30T10:30',
    '2026-10-24T25:00',
    '0000-01-01T00:00',
    '2026-10-24T10:30+03:30',
  ])
    assert.throws(() => utcFromInput(value));
});
