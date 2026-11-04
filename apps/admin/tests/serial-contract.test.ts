import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptySerialFilters,
  serialPageSchema,
  serialStockSchema,
  serialUnitSchema,
  serialHistorySchema,
  serialPath,
  serialHistoryPath,
  readSerialPage,
  readSerialHistory,
  parseReceipt,
  modeAttempt,
  receiptAttempt,
  retireAttempt,
  readSerialCommand,
  type SerialStock,
  type SerialUnit,
} from '../src/api/contracts/inventory/serial-contract.ts';
const id = '11111111111141118111111111111111';
const other = '22222222222242228222222222222222';
const request = '11111111-1111-4111-8111-111111111111';
const stock = (patch: Partial<SerialStock> = {}): SerialStock => ({
  variantId: 'variant',
  mode: 'imei',
  onHand: 1,
  reserved: 0,
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
  createdAt: '2026-10-23T12:00:00Z',
  changedAt: '2026-10-23T12:00:00Z',
  version: 'AAAAAAAAAAE=',
  ...patch,
});
const page = (patch: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  pageSize: 50,
  stock: stock(),
  items: [unit()],
  nextCursor: null,
  ...patch,
});
const entry = (n = '9007199254740993') => ({
  id: n,
  unitId: id,
  state: 'available',
  actorId: 'staff',
  reason: 'Receipt',
  orderId: null,
  at: '2026-10-23T12:00:00Z',
});
test('unit nulls and unknown warranty are required explicitly, without financial or identity fields', () => {
  assert.equal(readSerialPage(page(), 'VARIANT', emptySerialFilters).items[0].warrantyUntil, null);
  for (const key of ['serial', 'imei2', 'orderId', 'reservationId', 'warrantyUntil']) {
    const row: Record<string, unknown> = { ...unit() };
    delete row[key];
    assert.equal(serialUnitSchema.safeParse(row).success, false);
  }
  assert.equal(serialUnitSchema.safeParse({ ...unit(), priceRial: '1' }).success, false);
  assert.equal(serialPageSchema.safeParse({ ...page(), customer: {} }).success, false);
});
test('stock counts and versions fail closed instead of becoming zero or untracked', () => {
  for (const patch of [
    { onHand: 1.5 },
    { reserved: 2 },
    { onHand: -1 },
    { version: null },
    { version: 'not-base64' },
    { mode: 'optional' },
  ])
    assert.equal(serialStockSchema.safeParse({ ...stock(), ...patch }).success, false);
  assert.equal(
    serialStockSchema.safeParse(stock({ mode: 'none', onHand: 0, version: null })).success,
    true,
  );
  assert.equal(
    serialPageSchema.safeParse(
      page({
        stock: stock({ mode: 'none', onHand: 0, version: null }),
        items: [unit({ state: 'retired' })],
      }),
    ).success,
    false,
  );
});
test('pages reject overflow, duplicate aliases, wrong sorting and partial continuation state', () => {
  const valid = page({
    stock: stock({ onHand: 2 }),
    items: [unit(), unit({ id: other, imei1: '356938035643809' })],
  });
  assert.equal(serialPageSchema.safeParse(valid).success, true);
  assert.equal(
    serialPageSchema.safeParse({ ...valid, items: [...(valid.items as SerialUnit[])].reverse() })
      .success,
    false,
  );
  for (const value of [
    page({ items: [unit(), unit()] }),
    page({ items: [unit({ id: other }), unit()] }),
    page({ items: Array.from({ length: 51 }, () => unit()) }),
    page({ nextCursor: 'cursor' }),
    page({ items: [unit(), unit({ id: other })] }),
    page({ nextCursor: undefined }),
    page({ stock: stock({ mode: 'none' }) }),
  ])
    assert.equal(serialPageSchema.safeParse(value).success, false);
});
test('response rows must match variant, state and canonical prefix and cannot cycle a cursor', () => {
  assert.throws(() => readSerialPage(page(), 'other', emptySerialFilters));
  assert.throws(() => readSerialPage(page(), 'variant', { state: 'retired', query: '' }));
  assert.throws(() => readSerialPage(page(), 'variant', { state: 'all', query: 'ABC' }));
  assert.equal(
    readSerialPage(page(), 'variant', { state: 'available', query: '۴۹۰' }).items.length,
    1,
  );
});
test('unit states bind assigned devices to an order and never invent a warranty date', () => {
  assert.equal(
    serialUnitSchema.safeParse(unit({ state: 'assigned', orderId: other, reservationId: other }))
      .success,
    true,
  );
  for (const patch of [
    { state: 'assigned' },
    { state: 'delivered', orderId: other },
    { warrantyUntil: '2027-01-01T00:00:00Z' },
    { orderId: other },
    { imei2: '490154203237518' },
    { createdAt: '2027-01-01T00:00:00Z' },
  ])
    assert.equal(serialUnitSchema.safeParse({ ...unit(), ...patch }).success, false);
});
test('history identifiers stay exact above 2^53 and seek positions must strictly descend', () => {
  const value = {
    schemaVersion: 1,
    pageSize: 50,
    items: [entry('9223372036854775807'), entry()],
    nextBefore: null,
  };
  assert.equal(readSerialHistory(value, id, null).items[0].id, '9223372036854775807');
  assert.throws(() => readSerialHistory(value, id, '9007199254740993'));
  for (const raw of [
    { ...value, items: [entry(), entry()] },
    { ...value, items: [{ ...entry(), id: 9007199254740992 }] },
    { ...value, items: [entry('9223372036854775808')] },
    { ...value, nextBefore: '1' },
  ])
    assert.equal(serialHistorySchema.safeParse(raw).success, false);
  assert.throws(() =>
    readSerialHistory({ ...value, items: [{ ...entry(), unitId: other }] }, id, null),
  );
});
test('URLs normalize Persian digits and escape the resource and bounded cursor parameters', () => {
  const q = new URL(
    'http://qa' + serialPath('variant', { state: 'all', query: ' ab-۱۲ ' }, 'opaque_cursor'),
  ).searchParams;
  assert.equal(q.get('query'), 'AB-12');
  assert.equal(q.get('cursor'), 'opaque_cursor');
  assert.throws(() => serialPath('../private', emptySerialFilters, null));
  assert.throws(() => serialPath('variant', emptySerialFilters, 'bad/cursor'));
  assert.throws(() => serialHistoryPath('variant', id, '9223372036854775808'));
  assert.equal(
    serialHistoryPath('variant', id, '9007199254740993').endsWith('before=9007199254740993'),
    true,
  );
});
test('each receipt line is one device even with two valid IMEIs', () => {
  const rows = parseReceipt('۴۹۰۱۵۴۲۰۳۲۳۷۵۱۸,۳۵۶۹۳۸۰۳۵۶۴۳۸۰۹, case-۱۲۳ ', 'imei');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    serial: 'CASE-123',
    imei1: '490154203237518',
    imei2: '356938035643809',
  });
  assert.deepEqual(parseReceipt(' a-۱\n\nｂ-٢ ', 'serial'), [
    { serial: 'A-1', imei1: null, imei2: null },
    { serial: 'B-2', imei1: null, imei2: null },
  ]);
});
test('receipt parsing rejects bad check digits, cross-slot duplicates and oversized batches', () => {
  for (const text of [
    '490154203237519',
    '490154203237518,490154203237518',
    '490154203237518,356938035643809\n356938035643809',
    '490154203237518,,,extra',
  ])
    assert.throws(() => parseReceipt(text, 'imei'));
  assert.throws(() => parseReceipt('abc\n ABC ', 'serial'));
  assert.throws(() =>
    parseReceipt(Array.from({ length: 101 }, (_, i) => 's' + i).join('\n'), 'serial'),
  );
  assert.throws(() => parseReceipt('s', 'none'));
});
test('mode changes require an explicit new choice and empty unreserved inventory', () => {
  assert.throws(() => modeAttempt(stock(), 'serial', request));
  assert.throws(() => modeAttempt(stock({ onHand: 0 }), 'imei', request));
  const attempt = modeAttempt(stock({ mode: 'none', onHand: 0, version: null }), 'imei', request);
  assert.equal(attempt.body.version, null);
  assert.equal(attempt.method, 'PUT');
  assert.throws(() => modeAttempt(stock({ onHand: 0 }), 'serial', 'bad'));
});
test('retirement preserves selected unit and stock versions and rejects reserved quantities', () => {
  const row = unit();
  const source = stock();
  const attempt = retireAttempt(source, row, ' خروج ', request);
  source.onHand = 55;
  row.serial = 'MUTATED';
  assert.equal(attempt.stock.onHand, 1);
  assert.equal(attempt.kind === 'retire' && attempt.unit.serial, null);
  assert.equal(attempt.kind === 'retire' && attempt.body.unitVersion, 'AAAAAAAAAAE=');
  assert.throws(() => retireAttempt(stock({ reserved: 1 }), unit(), 'reason', request));
  assert.throws(() =>
    retireAttempt(
      stock(),
      unit({ state: 'assigned', orderId: other, reservationId: other }),
      'reason',
      request,
    ),
  );
});
test('command receipts must match aliases, counters, state and a changed stock version', () => {
  const attempt = receiptAttempt(stock({ onHand: 0 }), '490154203237518', 'Receipt', request);
  const result = {
    schemaVersion: 1,
    stock: stock({ version: 'AAAAAAAAAAI=' }),
    units: [unit({ version: 'AAAAAAAAAAI=' })],
  };
  assert.equal(readSerialCommand(result, attempt).stock.onHand, 1);
  for (const patch of [
    { stock: stock() },
    { stock: stock({ onHand: 2, version: 'AAAAAAAAAAI=' }) },
    { units: [] },
    { units: [unit({ imei1: '356938035643809' })] },
    { stock: stock({ variantId: 'other', version: 'AAAAAAAAAAI=' }) },
  ])
    assert.throws(() => readSerialCommand({ ...result, ...patch }, attempt));
});
test('retirement and mode snapshots are validated without treating them as a fresh page', () => {
  const attempt = retireAttempt(stock(), unit(), 'reason', request);
  assert.equal(
    readSerialCommand(
      {
        schemaVersion: 1,
        stock: stock({ onHand: 0, version: 'AAAAAAAAAAI=' }),
        units: [unit({ state: 'retired', version: 'AAAAAAAAAAI=' })],
      },
      attempt,
    ).units[0].state,
    'retired',
  );
  const mode = modeAttempt(stock({ onHand: 0 }), 'serial', request);
  assert.equal(
    readSerialCommand(
      {
        schemaVersion: 1,
        stock: stock({ mode: 'serial', onHand: 0, version: 'AAAAAAAAAAI=' }),
        units: [],
      },
      mode,
    ).stock.mode,
    'serial',
  );
});
