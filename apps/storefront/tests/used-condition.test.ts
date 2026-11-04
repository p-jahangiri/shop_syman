import assert from 'node:assert/strict';
import test from 'node:test';
import { usedConditionSchema } from '@sayman/web-shared/lib/catalog/used-condition-contract.ts';
import { quoteSnapshotV5Schema } from '@sayman/web-shared/lib/checkout/quote-v5-contract.ts';
import { orderDetailV2Schema } from '@sayman/web-shared/lib/orders/order-v2-contract.ts';
import { quote5Snapshot, order2Detail } from '@sayman/web-shared/testing/order-v2.test-fixtures.ts';
export const inspection = {
  inspectionId: '1234567890abcdef1234567890abcdef',
  technicalState: 'unknown',
  batteryState: 'unknown',
  batteryHealthPercent: null,
  screenState: 'damaged',
  bodyState: 'worn',
  repairState: 'unknown',
  notesFa: 'آسیب مشاهده‌شده؛ متن ساده <script>',
  notesEn: 'Observed damage; plain text',
  inspectedAt: '2026-10-24T10:00:00Z',
};
test('unknown battery stays null, measured zero and one hundred are valid', () => {
  assert.equal(usedConditionSchema.parse(inspection).batteryHealthPercent, null);
  for (const n of [0, 100])
    assert.equal(
      usedConditionSchema.parse({
        ...inspection,
        batteryState: 'measured',
        batteryHealthPercent: n,
      }).batteryHealthPercent,
      n,
    );
});
test('invalid or forged health facts cannot enter the UI contract', () => {
  for (const patch of [
    { batteryState: 'measured' },
    { batteryHealthPercent: 0 },
    { batteryState: 'measured', batteryHealthPercent: 101 },
    { batteryState: 'measured', batteryHealthPercent: -1 },
    { technicalState: 'healthy' },
    { notesFa: '\u202ehidden' },
    { privateSerial: 'secret' },
    { inspectionId: '0'.repeat(32) },
    { inspectedAt: '2026-10-24T10:00:00+03:30' },
  ])
    assert.equal(usedConditionSchema.safeParse({ ...inspection, ...patch }).success, false);
});
test('ordinary quote carries exact SKU report and unsafe rial remains a decimal string', () => {
  const q = quote5Snapshot();
  const lines = q.lines.map((line) =>
    line.lineKind === 'ordinary' ? { ...line, usedCondition: inspection } : line,
  );
  const parsed = quoteSnapshotV5Schema.parse({ ...q, lines });
  assert.equal(
    parsed.lines.find((l) => l.lineKind === 'ordinary')!.usedCondition!.inspectionId,
    inspection.inspectionId,
  );
  assert.equal(parsed.itemsSubtotalRial, q.itemsSubtotalRial);
});
test('an accepted market offer cannot silently become a used-device agreement', () => {
  const q = quote5Snapshot();
  assert.equal(
    quoteSnapshotV5Schema.safeParse({
      ...q,
      lines: q.lines.map((l) => ({ ...l, usedCondition: inspection })),
    }).success,
    false,
  );
});
test('historical order keeps its own report and previous new-device contracts remain valid', () => {
  const previous = order2Detail();
  assert.equal(orderDetailV2Schema.safeParse(previous).success, true);
  const lines = previous.lines.map((l) =>
    l.lineKind === 'ordinary' ? { ...l, usedCondition: inspection } : l,
  );
  const parsed = orderDetailV2Schema.parse({ ...previous, lines });
  assert.equal(
    parsed.lines.find((l) => l.lineKind === 'ordinary')!.usedCondition!.screenState,
    'damaged',
  );
});
const photo = {
  url: '/media/catalog/' + 'a'.repeat(32) + '/card.webp',
  altFa: 'خط روی بدنهٔ همین دستگاه',
  altEn: 'Scratch on this unit’s case',
};
test('inspection photo gallery is optional for legacy reports, allows explicit clear and admits only twelve unique issued assets with bilingual alternatives', () => {
  const legacy = usedConditionSchema.parse(inspection);
  assert.equal('photos' in legacy, false);
  assert.deepEqual(usedConditionSchema.parse({ ...inspection, photos: [] }).photos, []);
  assert.deepEqual(usedConditionSchema.parse({ ...inspection, photos: [photo] }).photos, [photo]);
  for (const photos of [
    [photo, photo],
    Array.from({ length: 13 }, (_, i) => ({
      ...photo,
      url: `/media/catalog/${(i + 1).toString(16).padStart(32, '0')}/card.webp`,
    })),
    [{ ...photo, url: 'https://outside.example/device.webp' }],
    [{ ...photo, url: photo.url.replace('card', 'zoom') }],
    [{ ...photo, url: '/api' + photo.url }],
    [{ ...photo, url: photo.url + '?token=private' }],
    [{ ...photo, url: photo.url + '\n' }],
    [{ ...photo, url: photo.url.replace('a'.repeat(32), '0'.repeat(32)) }],
    [{ ...photo, altFa: '' }],
    [{ ...photo, altEn: '  ' }],
    [{ ...photo, altFa: 'x'.repeat(161) }],
    [{ ...photo, altEn: 'line\nprivate' }],
    [{ ...photo, altFa: '\u202econcealed' }],
  ])
    assert.equal(usedConditionSchema.safeParse({ ...inspection, photos }).success, false);
  assert.equal(usedConditionSchema.safeParse({ ...inspection, photos: null }).success, false);
});
test('quote and order snapshots preserve exact inspection photo order independently of a later cleared revision', () => {
  const original = {
    ...inspection,
    photos: [
      photo,
      {
        ...photo,
        url: photo.url.replace('a'.repeat(32), 'b'.repeat(32)),
        altFa: 'صفحهٔ همین دستگاه',
        altEn: 'This unit’s screen',
      },
    ],
  };
  const q = quote5Snapshot(),
    quote = quoteSnapshotV5Schema.parse({
      ...q,
      lines: q.lines.map((l) =>
        l.lineKind === 'ordinary' ? { ...l, usedCondition: original } : l,
      ),
    });
  const previous = order2Detail(),
    order = orderDetailV2Schema.parse({
      ...previous,
      lines: previous.lines.map((l) =>
        l.lineKind === 'ordinary' ? { ...l, usedCondition: original } : l,
      ),
    });
  const cleared = usedConditionSchema.parse({
    ...inspection,
    inspectionId: 'c'.repeat(32),
    photos: [],
  });
  assert.deepEqual(cleared.photos, []);
  assert.deepEqual(
    quote.lines.find((l) => l.lineKind === 'ordinary')!.usedCondition!.photos,
    original.photos,
  );
  assert.deepEqual(
    order.lines.find((l) => l.lineKind === 'ordinary')!.usedCondition!.photos,
    original.photos,
  );
});
