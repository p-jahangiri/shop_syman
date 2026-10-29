import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptySerialFilters,
  serialStockSchema,
  readSerialCommand,
  receiptAttempt,
  type SerialUnit,
} from './serial-contract.ts';
import {
  serialStockV2Schema,
  serialItemV2Schema,
  serialPageV2Schema,
  serialPathV2,
  readSerialPageV2,
  toSerialStockV1,
  canRetireSerialV2,
  retireAttemptV2,
  type SerialStockV2,
  type SerialItemV2,
} from './serial-contract-v2.ts';

const id = '11111111111141118111111111111111',
  other = '22222222222242228222222222222222',
  request = '11111111-1111-4111-8111-111111111111';
const stock = (patch: Partial<SerialStockV2> = {}): SerialStockV2 => ({
  variantId: 'variant',
  mode: 'imei',
  onHand: 2,
  reserved: 0,
  sourcingReserved: 1,
  available: 1,
  version: 'AAAAAAAAAAE=',
  ...patch,
});
const unit = (patch: Partial<SerialUnit> = {}): SerialUnit => ({
  id,
  variantId: 'variant',
  serial: null,
  imei1: '490154203237518',
  imei2: null,
  state: 'available',
  orderId: null,
  reservationId: null,
  warrantyUntil: null,
  createdAt: '2026-10-24T00:00:00Z',
  changedAt: '2026-10-24T00:00:00Z',
  version: 'AAAAAAAAAAE=',
  ...patch,
});
const item = (patch: Partial<SerialItemV2> = {}): SerialItemV2 => ({
  unit: unit(),
  hasActiveClaim: true,
  ...patch,
});
const page = (patch: Record<string, unknown> = {}) => ({
  schemaVersion: 2,
  pageSize: 50,
  stock: stock(),
  items: [item()],
  nextCursor: null,
  ...patch,
});

test('serial2 stock distinguishes sourcing holds and requires the exact remaining availability', () => {
  assert.equal(serialStockV2Schema.parse(stock()).available, 1);
  assert.equal(
    serialStockV2Schema.parse(
      stock({ onHand: 2147483647, reserved: 1, sourcingReserved: 2147483646, available: 0 }),
    ).available,
    0,
  );
  for (const patch of [
    { available: 2 },
    { sourcingReserved: -1 },
    { reserved: 2 },
    { onHand: 2147483647, reserved: 2147483647, sourcingReserved: 2147483647 },
    { version: null },
    { ownerId: 'private' },
  ])
    assert.equal(serialStockV2Schema.safeParse({ ...stock(), ...patch }).success, false);
  const { sourcingReserved: _, ...missing } = stock();
  assert.equal(serialStockV2Schema.safeParse(missing).success, false);
  assert.equal(
    serialStockV2Schema.parse(
      stock({
        mode: 'none',
        onHand: 0,
        reserved: 0,
        sourcingReserved: 0,
        available: 0,
        version: null,
      }),
    ).version,
    null,
  );
});
test('serial2 wrappers are explicit and reject private additions or historical unwrapped pages', () => {
  assert.equal(serialItemV2Schema.parse(item()).hasActiveClaim, true);
  for (const value of [
    { unit: unit() },
    { unit: unit(), hasActiveClaim: 'true' },
    { ...item(), allocationId: id },
    { ...item(), ownerId: 'owner' },
    { ...item(), unit: { ...unit(), priceRial: '1' } },
  ])
    assert.equal(serialItemV2Schema.safeParse(value).success, false);
  assert.equal(serialPageV2Schema.safeParse({ ...page(), schemaVersion: 1 }).success, false);
  assert.equal(serialPageV2Schema.safeParse(page({ items: [unit()] })).success, false);
  assert.equal(serialPageV2Schema.safeParse({ ...page(), supplier: {} }).success, false);
});
test('serial2 related rows keep physical counts aliases variant and ordering without assuming claims are available', () => {
  assert.equal(
    serialPageV2Schema.safeParse(
      page({
        stock: stock({ onHand: 1, reserved: 1, sourcingReserved: 0, available: 0 }),
        items: [item({ unit: unit({ state: 'assigned', orderId: other, reservationId: other }) })],
      }),
    ).success,
    true,
  );
  for (const value of [
    page({ items: [item(), item()] }),
    page({ items: [item({ unit: unit({ id: other }) }), item()] }),
    page({ stock: stock({ sourcingReserved: 0, available: 2 }) }),
    page({ items: [item({ unit: unit({ variantId: 'other' }) })] }),
    page({
      stock: stock({ onHand: 0, reserved: 0, sourcingReserved: 0, available: 0 }),
      items: [item({ unit: unit({ state: 'retired' }), hasActiveClaim: false })],
      nextCursor: 'cursor',
    }),
  ])
    assert.equal(serialPageV2Schema.safeParse(value).success, false);
});
test('available serial2 reads require physical available units without active claims and bind the normalized prefix', () => {
  assert.throws(() => readSerialPageV2(page(), 'variant', { state: 'available', query: '' }));
  assert.throws(() => readSerialPageV2(page(), 'wrong', emptySerialFilters));
  assert.throws(() => readSerialPageV2(page(), 'variant', { state: 'retired', query: '' }));
  assert.throws(() => readSerialPageV2(page(), 'variant', { state: 'all', query: 'ABC' }));
  const unclaimed = page({ items: [item({ hasActiveClaim: false })] });
  assert.equal(
    readSerialPageV2(unclaimed, 'VARIANT', { state: 'available', query: '۴۹۰' }).items.length,
    1,
  );
  // Ordinary order holds need not yet identify a device; unclaimed physical
  // rows may outnumber public availability and the server still guards writes.
  const reserved = page({
    stock: stock({ reserved: 1, sourcingReserved: 0 }),
    items: [
      item({ hasActiveClaim: false }),
      item({ hasActiveClaim: false, unit: unit({ id: other, imei1: '356938035643809' }) }),
    ],
  });
  assert.equal(
    readSerialPageV2(reserved, 'variant', { state: 'available', query: '' }).items.length,
    2,
  );
});
test('serial2 seek URLs use the independent512 bound and reject partial pages or a repeated cursor', () => {
  const seek = 'x'.repeat(512),
    url = new URL(
      'http://qa' + serialPathV2('variant', { state: 'available', query: ' ab-۱۲ ' }, seek),
    );
  assert.equal(url.pathname, '/admin/inventory/variants/variant/serials/v2');
  assert.equal(url.searchParams.get('query'), 'AB-12');
  assert.equal(url.searchParams.get('cursor'), seek);
  assert.throws(() => serialPathV2('../private', emptySerialFilters, null));
  assert.throws(() => serialPathV2('variant', emptySerialFilters, 'x'.repeat(513)));
  assert.throws(() => serialPathV2('variant', emptySerialFilters, 'bad/cursor'));
  assert.equal(serialPageV2Schema.safeParse(page({ nextCursor: seek })).success, false);
  const items = Array.from({ length: 50 }, (_, i) =>
    item({
      unit: unit({
        id: (i + 1).toString(16).padStart(32, '0'),
        serial: 'SERIAL-' + i,
        imei1: null,
      }),
      hasActiveClaim: false,
    }),
  );
  const full = page({
    stock: stock({ mode: 'serial', onHand: 50, sourcingReserved: 0, available: 50 }),
    items,
    nextCursor: seek,
  });
  assert.equal(serialPageV2Schema.safeParse(full).success, true);
  assert.throws(() => readSerialPageV2(full, 'variant', emptySerialFilters, seek));
  assert.equal(serialPageV2Schema.safeParse({ ...full, nextCursor: seek + 'x' }).success, false);
});
test('legacy command snapshots are projected with exact V1 members and retain the current Stock token', () => {
  const source = stock(),
    projected = toSerialStockV1(source);
  assert.deepEqual(Object.keys(projected).sort(), [
    'mode',
    'onHand',
    'reserved',
    'variantId',
    'version',
  ]);
  assert.equal(projected.version, source.version);
  assert.equal(projected.reserved, 0);
  assert.equal(serialStockSchema.safeParse(source).success, false);
  source.onHand = 9;
  assert.equal(projected.onHand, 2);
});
test('retirement requires an unclaimed available unit and real free capacity even if another unit is held', () => {
  const free = item({ hasActiveClaim: false });
  assert.equal(canRetireSerialV2(stock(), free), true);
  assert.equal(canRetireSerialV2(stock(), item()), false);
  assert.equal(canRetireSerialV2(stock({ onHand: 1, available: 0 }), free), false);
  assert.equal(
    canRetireSerialV2(
      stock(),
      item({
        hasActiveClaim: false,
        unit: unit({ state: 'assigned', orderId: other, reservationId: other }),
      }),
    ),
    false,
  );
  const attempt = retireAttemptV2(stock(), free, 'Synthetic retirement', request);
  assert.equal(attempt.body.version, 'AAAAAAAAAAE=');
  assert.equal(attempt.kind === 'retire' && attempt.body.unitVersion, 'AAAAAAAAAAE=');
  assert.equal(attempt.stock.onHand, 2);
  assert.equal('sourcingReserved' in attempt.stock, false);
  assert.throws(() => retireAttemptV2(stock(), item(), 'reason', request));
  assert.throws(() => retireAttemptV2(stock({ onHand: 1, available: 0 }), free, 'reason', request));
});
test('a legacy command receipt is historical proof and cannot be decoded as current serial2 stock', () => {
  const before = stock({ onHand: 1, sourcingReserved: 1, available: 0 }),
    attempt = receiptAttempt(
      toSerialStockV1(before),
      '356938035643809',
      'Synthetic receipt',
      request,
    );
  const result = {
    schemaVersion: 1,
    stock: { variantId: 'variant', mode: 'imei', onHand: 2, reserved: 0, version: 'AAAAAAAAAAI=' },
    units: [unit({ imei1: '356938035643809', version: 'AAAAAAAAAAI=' })],
  };
  assert.equal(readSerialCommand(result, attempt).stock.onHand, 2);
  assert.equal(serialPageV2Schema.safeParse(result).success, false);
  const fresh = readSerialPageV2(
    page({
      stock: stock({ version: 'AAAAAAAAAAM=' }),
      items: [
        item({
          hasActiveClaim: false,
          unit: unit({ imei1: '356938035643809', version: 'AAAAAAAAAAI=' }),
        }),
      ],
    }),
    'variant',
    emptySerialFilters,
  );
  assert.equal(fresh.stock.sourcingReserved, 1);
  assert.equal(fresh.stock.available, 1);
  assert.equal(before.available, 0);
});
