import test from 'node:test';
import assert from 'node:assert/strict';
import {
  usedDetail,
  usedInput,
  usedResult,
  usedChoices,
  readUsedInspectionResult,
} from '../src/api/contracts/catalog/used-items-contract.ts';
const facts = {
  inspectionId: '1234567890abcdef1234567890abcdef',
  technicalState: 'unknown',
  batteryState: 'unknown',
  batteryHealthPercent: null,
  screenState: 'damaged',
  bodyState: 'worn',
  repairState: 'unknown',
  notesFa: 'مشخصات نمونه',
  notesEn: 'Sample facts',
  inspectedAt: '2026-10-24T10:00:00Z',
};
const detail = {
  schemaVersion: 1,
  variantId: 'v1',
  productId: 'p1',
  sku: 'USED-1',
  variantVersion: 'AAAAAAAAAAE=',
  inspection: null,
};
test('a new SKU requires explicit null report; absent report never becomes a healthy device', () => {
  assert.equal(usedDetail.parse(detail).inspection, null);
  const { inspection, ...missing } = detail;
  assert.equal(usedDetail.safeParse(missing).success, false);
  assert.equal(
    usedDetail.safeParse({ ...detail, inspection: { ...facts, batteryHealthPercent: 100 } })
      .success,
    false,
  );
});
test('receipt preserves exact versioned facts and measured zero rather than treating it as empty', () => {
  const measured = { ...facts, batteryState: 'measured', batteryHealthPercent: 0 };
  const result = usedResult.parse({
    schemaVersion: 1,
    replayed: true,
    detail: { ...detail, inspection: measured },
  });
  assert.equal(result.detail.inspection!.batteryHealthPercent, 0);
  assert.equal(result.replayed, true);
  assert.equal(
    usedInput.safeParse({
      variantVersion: detail.variantVersion,
      inspection: measured,
      isNew: true,
    }).success,
    false,
  );
});
test('bounded search choices expose truncation and reject duplicate SKU identities', () => {
  const item = {
    variantId: 'v1',
    productId: 'p1',
    sku: 'USED-1',
    labelFa: 'نمونه',
    labelEn: 'Sample',
    used: true,
  };
  assert.equal(
    usedChoices.safeParse({ schemaVersion: 1, items: [item], hasMore: true }).success,
    true,
  );
  assert.equal(
    usedChoices.safeParse({
      schemaVersion: 1,
      items: [item, { ...item, variantId: 'V1' }],
      hasMore: false,
    }).success,
    false,
  );
});
test('used inspection receipt binds the entire ordered photo gallery and facts, with empty gallery omission and exact UTC instant compatibility', () => {
  const photo = {
      url: '/media/catalog/' + 'a'.repeat(32) + '/card.webp',
      altFa: 'همین دستگاه',
      altEn: 'This unit',
    },
    input = usedInput.parse({
      variantVersion: detail.variantVersion,
      inspection: { ...facts, photos: [photo] },
    }),
    result = {
      schemaVersion: 1,
      replayed: true,
      detail: {
        ...detail,
        variantVersion: 'AAAAAAAAAAI=',
        inspection: { ...facts, inspectedAt: '2026-10-24T10:00:00.0000000+00:00', photos: [photo] },
      },
    };
  assert.equal(readUsedInspectionResult(result, 'V1', input).replayed, true);
  for (const changed of [
    { ...photo, altFa: 'Another description' },
    { ...photo, url: photo.url.replace('a'.repeat(32), 'b'.repeat(32)) },
  ])
    assert.throws(() =>
      readUsedInspectionResult(
        { ...result, detail: { ...result.detail, inspection: { ...facts, photos: [changed] } } },
        'v1',
        input,
      ),
    );
  assert.throws(() =>
    readUsedInspectionResult(
      {
        ...result,
        detail: {
          ...result.detail,
          inspection: { ...facts, bodyState: 'intact', photos: [photo] },
        },
      },
      'v1',
      input,
    ),
  );
  const clear = usedInput.parse({
    variantVersion: detail.variantVersion,
    inspection: { ...facts, photos: [] },
  });
  assert.ok(
    readUsedInspectionResult(
      { ...result, detail: { ...result.detail, inspection: facts } },
      'v1',
      clear,
    ),
  );
});
