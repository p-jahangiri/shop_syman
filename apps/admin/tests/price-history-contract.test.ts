import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyPriceHistoryFilters,
  localPriceHistoryTime,
  priceHistoryFiltersSchema,
  priceHistoryMoney,
  priceHistoryPageSchema,
  priceHistoryPath,
  priceHistoryPlot,
  readPriceHistoryPage,
} from '../src/api/contracts/catalog/price-history-contract.ts';

const at = '2026-10-30T12:00:00.1234567Z';
const item = (id = 'e1') => ({
  id,
  variantId: 'v1',
  oldPriceRial: '9223372036854775806',
  newPriceRial: '9223372036854775807',
  changedBy: 'staff-1',
  changedAt: at,
});
const page = () => ({
  schemaVersion: 1 as const,
  productId: 'p1',
  pageSize: 50 as const,
  asOfAt: at,
  variants: [
    { id: 'v1', sku: 'CURRENT-SKU', isActive: false, currentPriceRial: '9223372036854775807' },
  ],
  items: [item()],
  nextCursor: null as string | null,
});

test('price history preserves Int64 money, inactive current metadata and exact historical actor identifiers', () => {
  const raw = page();
  raw.items[0].changedBy = 'historical-system:' + 'x'.repeat(1900);
  const result = readPriceHistoryPage(raw, 'P1', emptyPriceHistoryFilters);
  assert.equal(result.items[0].newPriceRial, '9223372036854775807');
  assert.equal(result.items[0].changedBy, raw.items[0].changedBy);
  assert.equal(result.variants[0].isActive, false);
  assert.equal(result.variants[0].sku, 'CURRENT-SKU');
  assert.equal(
    priceHistoryMoney('9223372036854775807'),
    9223372036854775807n.toLocaleString('fa-IR') + ' ریال',
  );
  assert.equal(priceHistoryMoney('0'), '۰ ریال');
  for (const amount of [
    Number('9223372036854775807'),
    '9223372036854775808',
    '01',
    '-1',
    '1.2',
    '۱۲',
    '',
    ' 1',
  ]) {
    const value = page();
    Object.assign(value.items[0], { newPriceRial: amount });
    assert.throws(() => readPriceHistoryPage(value, 'p1', emptyPriceHistoryFilters));
  }
  const zero = page();
  zero.items[0].oldPriceRial = '0';
  assert.equal(
    readPriceHistoryPage(zero, 'p1', emptyPriceHistoryFilters).items[0].oldPriceRial,
    '0',
  );
});

test('history rejects wrong identity, hidden graph, duplicated or unrelated variants/events and no-op changes', () => {
  assert.throws(() => readPriceHistoryPage(page(), 'other', emptyPriceHistoryFilters));
  const invalid = [
    { ...page(), privateCustomer: {} },
    { ...page(), items: [{ ...item(), ownerId: 'secret' }] },
    { ...page(), variants: [...page().variants, { ...page().variants[0], id: 'V1' }] },
    { ...page(), items: [item(), { ...item('E1') }] },
    { ...page(), items: [{ ...item(), variantId: 'other' }] },
    { ...page(), items: [{ ...item(), oldPriceRial: item().newPriceRial }] },
    { ...page(), items: [{ ...item(), changedBy: 'x'.repeat(2001) }] },
    { ...page(), variants: [{ ...page().variants[0], currentPriceRial: 'bad' }] },
    { ...page(), nextCursor: 'opaque' },
    { ...page(), items: Array.from({ length: 51 }, (_, i) => item('e' + i)) },
  ];
  for (const raw of invalid)
    assert.throws(() => readPriceHistoryPage(raw, 'p1', emptyPriceHistoryFilters));
  const full = {
    ...page(),
    items: Array.from({ length: 50 }, (_, i) => item('e' + String(50 - i).padStart(3, '0'))),
    nextCursor: 'opaque',
  };
  assert.equal(readPriceHistoryPage(full, 'p1', emptyPriceHistoryFilters).items.length, 50);
});

test('malformed money fails safeParse and returns the fixed localized response error without a raw BigInt conversion error', () => {
  for (const bad of ['bad', '1.5', '۱۲', 'private-value-in-invalid-money', '9'.repeat(20000)]) {
    const raw = page();
    raw.items[0].newPriceRial = bad;
    assert.doesNotThrow(() => {
      const parsed = priceHistoryPageSchema.safeParse(raw);
      assert.equal(parsed.success, false);
    });
    assert.throws(
      () => readPriceHistoryPage(raw, 'p1', emptyPriceHistoryFilters),
      (error: unknown) =>
        error instanceof Error &&
        !(error instanceof SyntaxError) &&
        error.message === 'پاسخ تاریخچهٔ قیمت معتبر نیست؛ اطلاعات را دوباره دریافت کنید.',
    );
  }
});

test('UTC bounds retain 100ns precision and exclude the upper boundary without inventing timestamp tie chronology', () => {
  const filters = {
    ...emptyPriceHistoryFilters,
    fromAt: '2026-10-30T12:00:00.1234566Z',
    toAt: '2026-10-30T12:00:00.1234568Z',
  };
  assert.ok(priceHistoryFiltersSchema.safeParse(filters).success);
  assert.equal(readPriceHistoryPage(page(), 'p1', filters).items.length, 1);
  assert.throws(() => readPriceHistoryPage(page(), 'p1', { ...filters, toAt: at }));
  assert.throws(() =>
    readPriceHistoryPage(page(), 'p1', { ...filters, fromAt: '2026-10-30T12:00:00.1234568Z' }),
  );
  assert.throws(() =>
    readPriceHistoryPage(
      { ...page(), asOfAt: '2026-10-30T12:00:00.1234566Z' },
      'p1',
      emptyPriceHistoryFilters,
    ),
  );
  const newer = { ...item('new'), changedAt: '2026-10-30T12:00:00.1234568Z' };
  assert.throws(() =>
    readPriceHistoryPage(
      { ...page(), asOfAt: newer.changedAt, items: [item(), newer] },
      'p1',
      emptyPriceHistoryFilters,
    ),
  );
  assert.equal(
    readPriceHistoryPage(
      { ...page(), items: [item('z'), item('a')] },
      'p1',
      emptyPriceHistoryFilters,
    ).items.length,
    2,
  );
  assert.throws(() =>
    readPriceHistoryPage(
      { ...page(), items: [item('a'), item('z')] },
      'p1',
      emptyPriceHistoryFilters,
    ),
  );
  for (const bad of [
    '2026-02-30T12:00:00Z',
    '2026-10-30T12:00:00+03:30',
    '2026-10-30T12:00:00',
    '2026-10-30T12:00:00.12345678Z',
  ])
    assert.ok(
      !priceHistoryFiltersSchema.safeParse({ ...emptyPriceHistoryFilters, fromAt: bad }).success,
    );
});

test('direction, selected variant and strict URL filters cannot silently broaden history scope', () => {
  const f = {
    ...emptyPriceHistoryFilters,
    variantId: 'v1',
    direction: 'increase' as const,
    fromAt: '2026-10-30T00:00:00.000Z',
  };
  const path = new URL('http://localhost' + priceHistoryPath('p1', f, 'opaque_123'));
  assert.equal(path.pathname, '/admin/products/p1/price-history');
  assert.deepEqual(Object.fromEntries(path.searchParams), {
    direction: 'increase',
    variantId: 'v1',
    fromAt: f.fromAt,
    cursor: 'opaque_123',
  });
  assert.equal(readPriceHistoryPage(page(), 'p1', f).items.length, 1);
  for (const patch of [{ variantId: 'other' }, { direction: 'decrease' as const }])
    assert.throws(() => readPriceHistoryPage(page(), 'p1', { ...f, ...patch }));
  assert.throws(() => priceHistoryPath('../private', f, null));
  assert.throws(() => priceHistoryPath('p1', { ...f, extra: true } as typeof f, null));
  assert.throws(() => priceHistoryPath('p1', f, 'bad?cursor'));
});

test('per-variant plot keeps adjacent Int64 values distinct and converts only bounded normalized coordinates', () => {
  const original = item();
  const input = [
    original,
    { ...item('other'), variantId: 'v2', oldPriceRial: '0', newPriceRial: '999' },
  ];
  const result = priceHistoryPlot(input, 'v1');
  assert.equal(result.length, 1);
  assert.equal(result[0].oldX, 50);
  assert.equal(result[0].newX, 950);
  assert.equal(result[0].oldPriceRial, original.oldPriceRial);
  assert.equal(result[0].newPriceRial, original.newPriceRial);
  assert.ok(
    result.every((row) =>
      [row.oldX, row.newX].every((v) => Number.isInteger(v) && v >= 0 && v <= 1000),
    ),
  );
  assert.deepEqual(priceHistoryPlot(input, 'missing'), []);
  assert.equal(input[0], original);
  assert.equal(
    priceHistoryPlot([{ ...item(), oldPriceRial: '2', newPriceRial: '0' }], 'v1')[0].increasing,
    false,
  );
});

test('local time conversion validates calendar and roundtrips the device timezone rather than accepting rolled dates', () => {
  assert.equal(localPriceHistoryTime(''), null);
  assert.equal(
    localPriceHistoryTime('2026-10-30T12:30'),
    new Date('2026-10-30T12:30').toISOString(),
  );
  for (const bad of ['2026-02-30T12:30', '2026-10-30T25:00', '2026-10-30T12:30Z', '2026-1-1T00:00'])
    assert.throws(() => localPriceHistoryTime(bad));
});
