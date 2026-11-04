import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendLibraryImage,
  emptyImageLibraryFilters,
  imageLibraryAssetId,
  imageLibraryFiltersSchema,
  imageLibraryPath,
  localImageLibraryTime,
  readImageLibraryPage,
  type ImageLibraryItem,
  type ImageLibraryPage,
} from '../src/api/contracts/media/image-library-contract.ts';

const at = '2026-10-31T10:00:00.1234567Z';
function item(id = 'a'.repeat(32)): ImageLibraryItem {
  return {
    id,
    url: `/media/catalog/${id}/card.webp`,
    createdAt: at,
    variants: (['thumb', 'card', 'zoom'] as const).map((name) => ({
      name,
      url: `/media/catalog/${id}/${name}.webp`,
      width: 16,
      height: 16,
      bytes: 20,
      sha256: 'b'.repeat(64),
    })),
  };
}
function page(): ImageLibraryPage {
  return { schemaVersion: 1, asOfAt: at, pageSize: 24, items: [item()], nextCursor: null };
}
test('library accepts the existing three issued variants and rejects every private or unknown field level', () => {
  assert.equal(readImageLibraryPage(page(), emptyImageLibraryFilters).items[0].variants.length, 3);
  for (const raw of [
    { ...page(), createdBy: 'staff' },
    { ...page(), items: [{ ...item(), status: 'Ready' }] },
    { ...page(), items: [{ ...item(), originalSha256: 'b'.repeat(64) }] },
    {
      ...page(),
      items: [
        { ...item(), variants: item().variants.map((v) => ({ ...v, storageKey: 'private' })) },
      ],
    },
    { ...page(), items: [{ ...item(), variants: item().variants.slice(0, 2) }] },
    { ...page(), items: [{ ...item(), id: 'A'.repeat(32) }] },
  ])
    assert.throws(() => readImageLibraryPage(raw, emptyImageLibraryFilters), /پاسخ کتابخانه/);
});
test('library image identities, edge/byte limits, hashes and variant uniqueness fail closed', () => {
  for (const patch of [
    { url: '/media/catalog/' + 'c'.repeat(32) + '/card.webp' },
    {
      variants: item().variants.map((v) => ({
        ...v,
        url: 'https://example.test/' + v.name + '.webp',
      })),
    },
    { variants: [item().variants[0], item().variants[0], item().variants[2]] },
    { variants: item().variants.map((v) => ({ ...v, width: v.name === 'thumb' ? 321 : 16 })) },
    { variants: item().variants.map((v) => ({ ...v, height: v.name === 'card' ? 961 : 16 })) },
    { variants: item().variants.map((v) => ({ ...v, width: v.name === 'zoom' ? 1921 : 16 })) },
    { variants: item().variants.map((v) => ({ ...v, bytes: 8388609 })) },
    { variants: item().variants.map((v) => ({ ...v, sha256: 'B'.repeat(64) })) },
    { variants: item().variants.map((v) => ({ ...v, width: 0 })) },
  ])
    assert.throws(
      () =>
        readImageLibraryPage(
          { ...page(), items: [{ ...item(), ...patch }] },
          emptyImageLibraryFilters,
        ),
      /پاسخ کتابخانه/,
    );
});
test('precise UTC and descending time/BIN2 id order prevent out-of-window, repeated and truncated pages', () => {
  const full = {
    ...page(),
    items: Array.from({ length: 24 }, (_, index) =>
      item((255 - index).toString(16).padStart(32, '0')),
    ),
    nextCursor: 'opaque',
  };
  assert.equal(readImageLibraryPage(full, emptyImageLibraryFilters).items.length, 24);
  for (const patch of [
    { items: [item(), item()] },
    { nextCursor: 'opaque' },
    { items: [...full.items, item('f'.repeat(32))] },
    { items: [item('a'.repeat(32)), item('b'.repeat(32))] },
    { asOfAt: '2026-10-31T10:00:00.1234566Z' },
    { asOfAt: '2026-10-31T10:00:00.123Z' },
    { items: [{ ...item(), createdAt: '2026-02-30T10:00:00.1234567Z' }] },
    { nextCursor: 'x'.repeat(1025) },
  ])
    assert.throws(() => readImageLibraryPage({ ...page(), ...patch }, emptyImageLibraryFilters));
  const filters = {
    q: 'aaaa',
    fromAt: '2026-10-31T10:00:00.1234566Z',
    toAt: '2026-10-31T10:00:00.1234568Z',
  };
  assert.equal(readImageLibraryPage(page(), filters).items.length, 1);
  assert.throws(() => readImageLibraryPage(page(), { ...filters, toAt: at }));
  assert.throws(() => readImageLibraryPage(page(), { ...filters, q: 'bbbb' }));
  assert.throws(() =>
    readImageLibraryPage(page(), { ...filters, fromAt: '2026-10-31T10:00:00.1234568Z' }),
  );
});
test('strict filter URLs omit empty values and validate half-open UTC dates and bounded lowercase prefixes', () => {
  assert.equal(imageLibraryPath(emptyImageLibraryFilters, null), '/admin/media/images');
  const filters = { q: 'abcd', fromAt: at, toAt: at };
  assert.ok(imageLibraryFiltersSchema.safeParse(filters).success);
  assert.equal(readImageLibraryPage({ ...page(), items: [] }, filters).items.length, 0);
  const url = new URL('http://localhost' + imageLibraryPath(filters, 'opaque_1'));
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    q: 'abcd',
    fromAt: at,
    toAt: at,
    cursor: 'opaque_1',
  });
  for (const q of ['', 'abc', 'ghij', 'ABCD', 'a'.repeat(33), ' abcd'])
    assert.ok(!imageLibraryFiltersSchema.safeParse({ ...emptyImageLibraryFilters, q }).success);
  for (const time of [
    '0000-01-01T00:00:00Z',
    '2026-02-30T00:00:00Z',
    '2026-10-31T10:00:00+03:30',
    '2026-10-31T10:00:00.12345678Z',
  ])
    assert.ok(
      !imageLibraryFiltersSchema.safeParse({ ...emptyImageLibraryFilters, fromAt: time }).success,
    );
  assert.throws(() =>
    imageLibraryPath(
      { ...emptyImageLibraryFilters, actor: 'secret' } as typeof emptyImageLibraryFilters,
      null,
    ),
  );
  assert.throws(() => imageLibraryPath(emptyImageLibraryFilters, 'bad?cursor'));
});
test('selection appends only the canonical card to current form data and skips the same asset in every issued size', () => {
  const picked = item(),
    original = ['/products/original.svg'];
  const result = appendLibraryImage(original, picked, 2);
  assert.equal(result.reason, 'added');
  assert.deepEqual(result.value, [...original, picked.url]);
  assert.deepEqual(original, ['/products/original.svg']);
  for (const variant of picked.variants) {
    assert.equal(imageLibraryAssetId(variant.url), picked.id);
    assert.equal(appendLibraryImage([variant.url], picked, 2).reason, 'duplicate');
  }
  assert.equal(appendLibraryImage(original, picked, 1).reason, 'full');
  assert.equal(imageLibraryAssetId('https://example.test/' + picked.id), null);
  assert.throws(
    () => appendLibraryImage(original, { ...picked, url: 'javascript:bad' }, 2),
    /تصویر انتخاب/,
  );
});
test('local date handling rejects impossible dates and roundtrips the device timezone', () => {
  assert.equal(localImageLibraryTime(''), null);
  assert.equal(
    localImageLibraryTime('2026-10-31T12:30'),
    new Date('2026-10-31T12:30').toISOString(),
  );
  for (const value of ['2026-02-30T12:30', '2026-10-31T25:00', '2026-10-31T12:30Z'])
    assert.throws(() => localImageLibraryTime(value));
});
