import test from 'node:test';
import assert from 'node:assert/strict';
import {
  offerActionSchema,
  offerAdminDetailSchema,
  offerAdminPageSchema,
  offerDataSchema,
  offerDetailSchema,
  offerMutationMatches,
  offerMutationSchema,
  offerPageSchema,
  offerPublishSchema,
  offerRialSchema,
  offerSaveSchema,
  offerSkuSchema,
  sourcingAttributeText,
} from './offer-contract.ts';
import {
  offerTestAction as action,
  offerTestData as data,
  offerTestDetail as detail,
  offerTestPage as page,
  offerTestMutation as mutation,
  offerTestSave as save,
  offerTestSku as sku,
  offerTestId as id,
  offerTestRequest as requestId,
  offerTestSummary as summary,
} from './offer.test-fixtures.ts';
test('offer wire keeps exact integer rial and all five typed values with explicit inherited methods', () => {
  const value = offerDetailSchema.parse(detail);
  assert.equal(value.offer.summary.totalRial, '9007199254740993');
  assert.equal(value.offer.lines[0].unitPriceRial, '9007199254740993');
  assert.equal(value.offer.lines[0].sku.variantMethodIds, null);
  const attributes = value.offer.lines[0].sku.attributes;
  assert.equal(attributes[0].number, '0.00000000');
  assert.equal(attributes[1].bool, false);
  assert.equal(sourcingAttributeText(attributes[0], 'en'), '0.00000000 GB');
  assert.equal(sourcingAttributeText(attributes[1], 'fa'), 'خیر');
  assert.deepEqual(
    attributes.map((item) => item.dataType),
    ['Number', 'Bool', 'Text', 'Select', 'MultiSelect'],
  );
  assert.equal(
    offerSkuSchema.parse({
      ...sku,
      color: 'ر'.repeat(2000),
      attributes: [{ ...sku.attributes[0], unitFa: 'و'.repeat(2000) }],
    }).color.length,
    2000,
  );
  for (const value of ['0', '9007199254740993', '9223372036854775807'])
    assert.equal(offerRialSchema.parse(value), value);
  for (const value of ['01', '-1', '1.0', '1e2', '9223372036854775808', 1, 9007199254740992])
    assert.equal(offerRialSchema.safeParse(value).success, false);
  for (const value of ['1.0', 'bad', '', '9'.repeat(100)]) {
    assert.doesNotThrow(() =>
      offerDataSchema.safeParse({
        ...data,
        lines: [{ ...data.lines[0], unitPriceRial: value, lineTotalRial: value }],
      }),
    );
    assert.doesNotThrow(() =>
      offerSaveSchema.safeParse({ ...save, lines: [{ ...save.lines[0], unitPriceRial: value }] }),
    );
    assert.doesNotThrow(() => offerMutationSchema.safeParse({ ...mutation, eventId: value }));
  }
});
test('offer detail and page enforce privacy, child role capabilities and exact additive schema', () => {
  for (const value of [
    { ...detail, ownerId: 'other' },
    { ...detail, canPay: true },
    { ...detail, reserved: true },
    { ...detail, canPublish: true },
    { ...detail, canMarkRequestUnavailable: true },
    { ...detail, offer: { ...data, summary: { ...summary, publishedAt: null } } },
  ])
    assert.equal(offerDetailSchema.safeParse(value).success, false);
  assert.equal(
    offerAdminDetailSchema.safeParse({
      ...detail,
      canAccept: false,
      canDecline: false,
      canCancelRequest: false,
      canMarkRequestUnavailable: true,
    }).success,
    true,
  );
  assert.equal(
    offerAdminPageSchema.safeParse({
      ...page,
      pageSize: 50,
      canCancelRequest: false,
      canMarkRequestUnavailable: true,
    }).success,
    true,
  );
  for (const value of [
    { ...page, pageSize: 50 },
    { ...page, items: [summary, summary] },
    {
      ...page,
      items: [{ ...summary, state: 'Withdrawn', effectiveState: 'Withdrawn', publishedAt: null }],
    },
    {
      ...page,
      items: [{ ...summary, state: 'Draft', effectiveState: 'Draft', publishedAt: null }],
    },
  ])
    assert.equal(offerPageSchema.safeParse(value).success, false);
});
test('offer snapshots reject arithmetic mismatch, duplicate identities and inherited-null ambiguity', () => {
  for (const value of [
    { ...data, summary: { ...summary, totalRial: '9007199254740992' } },
    { ...data, lines: [{ ...data.lines[0], lineTotalRial: '1' }] },
    { ...data, summary: { ...summary, itemCount: 2 } },
    { ...data, lines: [{ ...data.lines[0], sku: { ...sku, productId: 'another-model' } }] },
  ])
    assert.equal(offerDataSchema.safeParse(value).success, false);
  const { variantMethodIds: _, ...missing } = sku;
  assert.equal(offerSkuSchema.safeParse(missing).success, false);
  assert.equal(
    offerDataSchema.safeParse({ ...data, lines: [...data.lines, ...data.lines] }).success,
    false,
  );
  assert.equal(
    offerPageSchema.safeParse({ ...page, items: [{ ...summary, effectiveState: 'Expired' }] })
      .success,
    true,
  );
  assert.equal(
    offerPageSchema.safeParse({
      ...page,
      items: [{ ...summary, state: 'Declined', effectiveState: 'Expired' }],
    }).success,
    false,
  );
});
test('offer commands require current versions, explicit bilingual terms, UTC and checked totals', () => {
  const value = offerSaveSchema.parse({ ...save, termsFa: '  آزمون\r\nشرایط  ' });
  assert.equal(value.termsFa, 'آزمون\nشرایط');
  assert.equal(offerActionSchema.parse(action).termsHash, action.termsHash);
  assert.equal(
    offerSaveSchema.parse({ ...save, lines: [{ ...save.lines[0], unitPriceRial: '0' }] }).lines[0]
      .unitPriceRial,
    '0',
  );
  for (const value of [
    { ...save, ownerId: 'forged' },
    { ...save, termsEn: '' },
    { ...save, lines: [{ ...save.lines[0], unitPriceRial: '9223372036854775807', quantity: 2 }] },
    { ...save, acceptUntil: '2026-10-25T10:00:00+03:30' },
    { ...save, purchaseUntil: '2026-10-24T10:00:00Z' },
    { ...save, lines: [save.lines[0], save.lines[0]] },
    { ...save, termsFa: 'x\tprivate' },
    { ...save, termsFa: 'x\u0085private' },
    { ...save, lines: [{ ...save.lines[0], stock: 1 }] },
  ])
    assert.equal(offerSaveSchema.safeParse(value).success, false);
  assert.equal(offerPublishSchema.parse(action).supersedesOfferId, null);
  assert.equal(offerPublishSchema.safeParse({ ...action, supersedesOfferId: id }).success, false);
  assert.equal(
    offerPublishSchema.safeParse({
      ...action,
      supersedesOfferId: id,
      supersedesVersion: action.version,
    }).success,
    true,
  );
});
test('offer acknowledgement binds both resources and operation with immutable historical consent', () => {
  const result = offerMutationSchema.parse(mutation);
  assert.equal(result.eventId, '9007199254740993');
  assert.equal(offerMutationMatches(result, requestId, id, 'accept'), true);
  assert.equal(offerMutationMatches(result, 'f'.repeat(32), id, 'accept'), false);
  assert.equal(offerMutationMatches(result, requestId, 'f'.repeat(32), 'accept'), false);
  assert.equal(offerMutationMatches(result, requestId, id, 'decline'), false);
  for (const value of [
    { ...mutation, state: 'Published' },
    { ...mutation, acceptanceId: null },
    { ...mutation, canPay: true },
    { ...mutation, operation: 'decline', state: 'Declined' },
    { ...mutation, requestVersion: 'stale' },
  ])
    assert.equal(offerMutationSchema.safeParse(value).success, false);
  assert.equal(
    offerMutationSchema.safeParse({
      ...mutation,
      operation: 'decline',
      state: 'Declined',
      acceptanceId: null,
      replayed: true,
    }).success,
    true,
  );
});
