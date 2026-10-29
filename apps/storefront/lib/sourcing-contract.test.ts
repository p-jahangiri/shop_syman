import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sourcingCartSchema,
  sourcingCartInputSchema,
  sourcingSubmitSchema,
  sourcingDetailSchema,
  sourcingRequestPageSchema,
  sourcingEventsSchema,
  sourcingMutationSchema,
  sourcingAttributeSchema,
  sourcingAttributeText,
} from './sourcing-contract.ts';
import {
  sourcingTestCart as cart,
  sourcingTestModel as model,
  sourcingTestDetail as detail,
  sourcingTestCandidate as candidate,
  sourcingTestSubmit as submit,
  sourcingTestSummary as summary,
  sourcingTestMutation as mutation,
  sourcingTestDate as at,
} from './sourcing.test-fixtures.ts';
test('typed sourcing snapshots preserve numeric zero, false, unknown and bilingual historical units', () => {
  const parsed = sourcingCartSchema.parse(cart),
    attributes = parsed.lines[0].candidate.model!.attributes;
  assert.equal(attributes[0].number, '0.00000000');
  assert.equal(attributes[1].bool, false);
  assert.equal(attributes[1].number, null);
  assert.equal(sourcingAttributeText(attributes[1], 'fa'), 'خیر');
  assert.equal(sourcingAttributeText(attributes[0], 'en'), '0.00000000 mAh');
  assert.equal(sourcingAttributeText(attributes[0], 'fa'), '۰٫۰۰۰۰۰۰۰۰ میلی‌آمپرساعت');
  assert.equal(
    sourcingAttributeSchema.safeParse({ ...model.attributes[0], number: 0 }).success,
    false,
  );
  assert.equal(
    sourcingAttributeSchema.safeParse({ ...model.attributes[0], number: '1e10' }).success,
    false,
  );
  assert.equal(
    sourcingAttributeSchema.safeParse({ ...model.attributes[1], number: '1' }).success,
    false,
  );
});
test('sourcing cart keeps explicit reference null and never accepts purchase amounts or hidden model fields', () => {
  assert.equal(sourcingCartSchema.parse(cart).lines[0].candidate.sourceUrl, null);
  const unavailable = {
    listingId: candidate.listingId,
    referencePriceRial: null,
    referencePriceCurrent: false,
    isDemo: false,
    issue: 'unavailable',
  };
  assert.equal(
    sourcingCartSchema.safeParse({
      ...cart,
      hasIssues: true,
      lines: [{ listingId: candidate.listingId, quantity: 1, candidate: unavailable }],
    }).success,
    true,
  );
  for (const input of [
    { ...cart, canPay: true },
    { ...cart, totalRial: '1' },
    { ...cart, hasIssues: true },
    { ...cart, lines: [...cart.lines, ...cart.lines] },
    { ...cart, lines: [{ ...cart.lines[0], quantity: 0 }] },
    {
      ...cart,
      lines: [{ ...cart.lines[0], candidate: { ...candidate, referencePriceRial: undefined } }],
    },
    {
      ...cart,
      lines: [{ ...cart.lines[0], candidate: { ...candidate, model: { ...model, stock: 5 } } }],
    },
  ])
    assert.equal(sourcingCartSchema.safeParse(input).success, false);
});
test('submit owns no source or price authority and binds all distinct fingerprints plus current cart version', () => {
  assert.equal(sourcingSubmitSchema.safeParse(submit).success, true);
  for (const input of [
    { ...submit, ownerId: 'other' },
    { ...submit, expected: [] },
    { ...submit, expected: [...submit.expected, ...submit.expected] },
    { ...submit, cartVersion: 'AAAAAAAAAAF=' },
    { ...submit, note: 'x'.repeat(501) },
    { ...submit, requestId: '00000000-0000-0000-0000-000000000000' },
    { ...submit, referencePriceRial: '1' },
  ])
    assert.equal(sourcingSubmitSchema.safeParse(input).success, false);
  assert.equal(sourcingCartInputSchema.safeParse({ version: null, lines: [] }).success, true);
  assert.equal(
    sourcingCartInputSchema.safeParse({
      version: null,
      lines: [{ listingId: candidate.listingId, quantity: 1000001 }],
    }).success,
    false,
  );
});
test('customer request details reject staff authority and preserve large event/reference identifiers as strings', () => {
  assert.equal(sourcingDetailSchema.safeParse(detail).success, true);
  assert.equal(sourcingMutationSchema.parse(mutation).eventId, '9007199254740993');
  for (const input of [
    { ...detail, summary: { ...summary, ownerId: 'other' } },
    { ...detail, canReview: true },
    { ...detail, canCancel: false },
    { ...detail, summary: { ...summary, lineCount: 2 } },
    { ...detail, lines: [{ ...detail.lines[0], quantity: 1 }] },
    { ...detail, lines: [{ ...detail.lines[0], referencePriceRial: 123 }] },
  ])
    assert.equal(sourcingDetailSchema.safeParse(input).success, false);
  assert.equal(
    sourcingMutationSchema.safeParse({ ...mutation, eventId: Number('9007199254740993') }).success,
    false,
  );
  assert.equal(sourcingMutationSchema.safeParse({ ...mutation, canPay: true }).success, false);
});
test('customer list and event pages are independently bounded and exclude internal staff data', () => {
  const page = { schemaVersion: 1, pageSize: 20, items: [summary], nextCursor: null };
  assert.equal(sourcingRequestPageSchema.safeParse(page).success, true);
  assert.equal(sourcingRequestPageSchema.safeParse({ ...page, pageSize: 50 }).success, false);
  assert.equal(
    sourcingRequestPageSchema.safeParse({ ...page, items: [summary, summary] }).success,
    false,
  );
  const event = {
      id: '9007199254740993',
      stateBefore: null,
      stateAfter: 'Submitted',
      actorKind: 'customer',
      reasonCode: 'submitted',
      publicMessage: '',
      at,
    },
    events = { schemaVersion: 1, pageSize: 20, items: [event], nextCursor: null };
  assert.equal(sourcingEventsSchema.safeParse(events).success, true);
  for (const input of [
    { ...event, actorId: 'private-staff' },
    { ...event, internalNote: 'private' },
    { ...event, stateBefore: 'Cancelled' },
    { ...event, id: Number('9007199254740993') },
  ])
    assert.equal(sourcingEventsSchema.safeParse({ ...events, items: [input] }).success, false);
});

test('typed wire rejects missing values instead of rendering corrupt snapshots as unknown', () => {
  const base = {
    attributeId: 'typed',
    key: 'typed',
    labelFa: 'ویژگی',
    labelEn: 'Attribute',
    options: [],
  };
  const option = { id: 'choice', labelFa: 'گزینه', labelEn: 'Choice' };
  const valid = [
    { ...base, dataType: 'Text', textFa: '', textEn: '' },
    { ...base, dataType: 'Number', number: '0.00000000' },
    { ...base, dataType: 'Bool', bool: false },
    { ...base, dataType: 'Select', options: [option] },
    { ...base, dataType: 'MultiSelect', options: [option] },
  ];
  for (const value of valid)
    assert.equal(sourcingAttributeSchema.safeParse(value).success, true, value.dataType);
  const malformed = [
    { ...valid[0], textFa: null },
    { ...valid[0], textEn: undefined },
    { ...valid[1], number: null },
    { ...valid[1], number: undefined },
    { ...valid[2], bool: null },
    { ...valid[2], bool: undefined },
    { ...valid[3], options: [] },
    { ...valid[4], options: [] },
    { ...valid[3], options: [option, { ...option, id: 'second' }] },
    { ...valid[4], options: [option, { ...option, id: 'CHOICE' }] },
    { ...valid[1], number: '100000000000000000000' },
    { ...valid[1], number: '0.000000001' },
  ];
  for (const value of malformed) {
    assert.equal(sourcingAttributeSchema.safeParse(value).success, false, JSON.stringify(value));
    assert.equal(
      sourcingDetailSchema.safeParse({
        ...detail,
        lines: [{ ...detail.lines[0], model: { ...model, attributes: [value] } }],
      }).success,
      false,
    );
  }
});
