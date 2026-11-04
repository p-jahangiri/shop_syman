import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyMovementFilters,
  localMovementTime,
  movementFiltersSchema,
  movementPageSchema,
  movementPath,
  readMovementPage,
} from '../src/api/contracts/inventory/inventory-history-contract.ts';
const entry = (id = '9007199254740993') => ({
  id,
  variantId: 'V1',
  delta: 1,
  balance: 2,
  reason: 'رسید کالا',
  actorId: 'staff',
  requestId: 'request',
  at: '2026-10-23T12:00:00Z',
});
const page = (items = [entry()]) => ({ version: 1, pageSize: 50, items, nextCursor: null });
test('movement ids remain decimal strings beyond the JavaScript safe integer range', () => {
  const value = readMovementPage(
    page([entry('9223372036854775807'), entry()]),
    emptyMovementFilters,
  );
  assert.equal(value.items[0].id, '9223372036854775807');
  assert.equal(BigInt(value.items[0].id), 9223372036854775807n);
  for (const id of ['0', '01', '9223372036854775808', '-1'])
    assert.equal(movementPageSchema.safeParse(page([entry(id)])).success, false);
  assert.equal(
    movementPageSchema.safeParse(page([{ ...entry(), id: 9007199254740992 } as never])).success,
    false,
  );
});
test('private/financial fields, oversized pages and unstable duplicate ordering fail closed', () => {
  for (const value of [
    { ...page(), customer: {} },
    page([{ ...entry(), priceRial: '1' } as never]),
    page([entry(), entry()]),
    page([entry('1'), entry('2')]),
    page(Array.from({ length: 51 }, (_, i) => entry(String(100 - i)))),
    { ...page(), nextCursor: 'cursor' },
  ])
    assert.throws(() => readMovementPage(value, emptyMovementFilters));
  assert.equal(
    movementPageSchema.safeParse({
      ...page(Array.from({ length: 50 }, (_, i) => entry(String(100 - i)))),
      nextCursor: 'valid_cursor-1',
    }).success,
    true,
  );
});
test('response rows must match the requested variant, direction and half-open time range', () => {
  const filters = {
    variantId: 'v1',
    direction: 'in' as const,
    fromAt: '2026-10-23T12:00:00Z',
    toAt: '2026-10-23T13:00:00Z',
  };
  assert.equal(readMovementPage(page(), filters).items.length, 1);
  for (const patch of [
    { variantId: 'v2' },
    { delta: -1 },
    { at: '2026-10-23T11:59:59Z' },
    { at: '2026-10-23T13:00:00Z' },
  ])
    assert.throws(() => readMovementPage(page([{ ...entry(), ...patch }]), filters));
});
test('query parameters encode identifiers, UTC offsets and opaque cursors without coercing ids', () => {
  const path = movementPath(
    { ...emptyMovementFilters, variantId: 'variant_1', fromAt: '2026-10-23T12:00:00+03:30' },
    'opaque_cursor',
  );
  const query = new URL('https://qa.example' + path).searchParams;
  assert.equal(query.get('variantId'), 'variant_1');
  assert.equal(query.get('fromAt'), '2026-10-23T12:00:00+03:30');
  assert.equal(query.get('cursor'), 'opaque_cursor');
  assert.equal(query.get('direction'), 'all');
  assert.equal(query.has('toAt'), false);
  assert.throws(() => movementPath(emptyMovementFilters, 'bad/cursor'));
  assert.equal(
    movementFiltersSchema.safeParse({ ...emptyMovementFilters, variantId: '../private' }).success,
    false,
  );
});
test('time filters use an increasing range and invalid local dates never silently roll over', () => {
  assert.equal(
    movementFiltersSchema.safeParse({
      ...emptyMovementFilters,
      fromAt: '2026-10-23T13:00:00Z',
      toAt: '2026-10-23T12:00:00Z',
    }).success,
    false,
  );
  assert.equal(localMovementTime(''), null);
  assert.equal(localMovementTime('2026-10-23T12:30'), new Date(2026, 9, 23, 12, 30).toISOString());
  for (const value of ['bad', '2026-02-30T12:00', '2026-13-01T12:00', '2026-10-23T25:00'])
    assert.throws(() => localMovementTime(value));
});
