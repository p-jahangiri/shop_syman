import test from 'node:test';
import assert from 'node:assert/strict';
import {
  catalogSummarySchema,
  inventorySummarySchema,
  inventoryRowSchema,
  emptyInventoryFilters,
  formatAdminCount,
  inventoryPath,
  inventoryDetailPath,
  readInventoryPage,
  stockAdjustment,
  stockAdjustmentPreview,
  emptyInventoryWorkspace,
  inventoryWorkspacePath,
  readInventoryWorkspace,
} from '../src/api/contracts/inventory/inventory-contract.ts';
const row = () => ({
  variantId: 'v1',
  productId: 'p1',
  sku: 'SKU-1',
  nameFa: 'کالا',
  nameEn: 'Product',
  isActive: true,
  productStatus: 'Draft',
  onHand: 7,
  reserved: 2,
  sourcingReserved: 0,
  available: 5,
  version: 'AAAAAAAAAAE=',
});
const page = (items = [row()]) => ({ version: 2, pageSize: 50, items, nextCursor: null });
test('inventory workspace filters and bounds the server page without exposing private row fields', () => {
  const filters = {
    ...emptyInventoryWorkspace,
    query: 'SKU-1',
    minAvailable: 0,
    maxAvailable: 3,
    page: 2,
  };
  const url = new URL(inventoryWorkspacePath(filters), 'https://local.test');
  assert.equal(url.pathname, '/admin/inventory/workspace/variants');
  assert.equal(url.searchParams.get('minAvailable'), '0');
  assert.equal(url.searchParams.get('maxAvailable'), '3');
  assert.equal(url.searchParams.get('page'), '2');
  assert.throws(() => inventoryWorkspacePath({ ...filters, minAvailable: 4 }));
  const item = { ...row(), sourcingReserved: 2, available: 3 };
  const result = { items: [item], page: 2, pageSize: 25, total: 51 };
  assert.equal(readInventoryWorkspace(result, filters).total, 51);
  assert.throws(() => readInventoryWorkspace({ ...result, page: 1 }, filters));
  assert.throws(() => readInventoryWorkspace({ ...result, items: [item, item] }, filters));
});

test('physical count and relative adjustment protect both kinds of reservations', () => {
  const item = inventoryRowSchema.parse({ ...row(), sourcingReserved: 2, available: 3 });
  assert.deepEqual(stockAdjustmentPreview('count', '۴', item), {
    delta: -3,
    onHand: 4,
    available: 0,
  });
  assert.deepEqual(stockAdjustmentPreview('count', '۷', item), {
    delta: 0,
    onHand: 7,
    available: 3,
  });
  assert.deepEqual(stockAdjustmentPreview('delta', '−۲', item), {
    delta: -2,
    onHand: 5,
    available: 1,
  });
  assert.throws(() => stockAdjustmentPreview('count', '٣', item), /رزرو/);
  assert.throws(() => stockAdjustmentPreview('delta', '۱٫۵', item), /صحیح/);
  assert.throws(() => stockAdjustmentPreview('count', '۱۰۰۰۰۰۸', item), /میلیون/);
});
test('unstocked variants use explicit null version and real zero; inconsistent quantities fail', () => {
  assert.equal(
    inventoryRowSchema.parse({ ...row(), onHand: 0, reserved: 0, available: 0, version: null })
      .version,
    null,
  );
  for (const patch of [
    { version: null },
    { available: 7 },
    { reserved: 8 },
    { onHand: -1 },
    { priceRial: '1' },
  ])
    assert.equal(inventoryRowSchema.safeParse({ ...row(), ...patch }).success, false);
});
test('inventory pages reject duplicate ids, wrong activity, oversized/private data and incomplete cursors', () => {
  for (const value of [
    page([row(), { ...row(), variantId: 'V1' }]),
    page(Array.from({ length: 51 }, (_, i) => ({ ...row(), variantId: 'v' + i }))),
    { ...page(), actor: {} },
    { ...page(), nextCursor: 'cursor' },
  ])
    assert.throws(() => readInventoryPage(value, emptyInventoryFilters));
  assert.throws(() => readInventoryPage(page(), { query: '', active: 'false' }));
  assert.equal(readInventoryPage(page(), emptyInventoryFilters).items[0].available, 5);
});
test('version2 keeps order and sourcing holds separate and subtracts their complete total', () => {
  const parsed = inventoryRowSchema.parse({ ...row(), sourcingReserved: 3, available: 2 });
  assert.equal(parsed.reserved, 2);
  assert.equal(parsed.sourcingReserved, 3);
  assert.equal(parsed.available, 2);
  for (const patch of [
    { sourcingReserved: -1 },
    { sourcingReserved: 6, available: 0 },
    { sourcingReserved: 3, available: 5 },
    { onHand: 2147483647, reserved: 2147483647, sourcingReserved: 2147483647, available: 1 },
    { onHand: 0, reserved: 0, sourcingReserved: 1, available: 0, version: null },
  ])
    assert.equal(inventoryRowSchema.safeParse({ ...row(), ...patch }).success, false);
  assert.equal(
    inventoryRowSchema.parse({
      ...row(),
      onHand: 2147483647,
      reserved: 1,
      sourcingReserved: 2147483646,
      available: 0,
    }).available,
    0,
  );
});
test('version2 never accepts or silently upgrades a historical version1 inventory response', () => {
  const { sourcingReserved: _, ...legacyRow } = row();
  assert.equal(inventoryRowSchema.safeParse(legacyRow).success, false);
  assert.throws(() =>
    readInventoryPage(
      { version: 1, pageSize: 50, items: [legacyRow], nextCursor: null },
      emptyInventoryFilters,
    ),
  );
  assert.throws(() => readInventoryPage({ ...page(), version: 1 }, emptyInventoryFilters));
  assert.equal(readInventoryPage(page(), emptyInventoryFilters).version, 2);
});
test('summary counts beyond safe Number are preserved and formatted through BigInt', () => {
  const summary = inventorySummarySchema.parse({
    stockRecords: '9223372036854775807',
    availableVariants: '9007199254740993',
    reservedVariants: '0',
  });
  assert.equal(summary.availableVariants, '9007199254740993');
  assert.equal(
    formatAdminCount(summary.availableVariants),
    new Intl.NumberFormat('fa-IR').format(9007199254740993n),
  );
  assert.equal(catalogSummarySchema.safeParse({ products: 1, categories: '2' }).success, false);
  assert.equal(formatAdminCount(undefined), '—');
});
test('search and opaque cursors are encoded and bounded before fetch', () => {
  const url = new URL(
    'https://qa.example' + inventoryPath({ query: 'کیبورد ۱۲', active: 'false' }, 'page_cursor'),
  );
  assert.equal(url.pathname, '/admin/inventory/v2/variants');
  assert.equal(url.searchParams.get('query'), 'کیبورد ۱۲');
  assert.equal(url.searchParams.get('active'), 'false');
  assert.equal(url.searchParams.get('cursor'), 'page_cursor');
  assert.throws(() => inventoryPath({ query: 'x'.repeat(121), active: 'all' }, null));
  assert.throws(() => inventoryPath(emptyInventoryFilters, 'bad/cursor'));
});
test('single stock reads use the same version2 endpoint and reject unsafe ids before fetch', () => {
  assert.equal(inventoryDetailPath('Variant_01-A'), '/admin/inventory/v2/variants/Variant_01-A');
  for (const id of ['', 'bad/id', '..', 'x'.repeat(65)])
    assert.throws(() => inventoryDetailPath(id));
});
test('stock adjustment normalizes Persian digits, freezes a typed payload and rejects unsafe quantities', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const value = stockAdjustment('−۲'.replace('−', '-'), ' رسید ', null, id);
  assert.deepEqual(value, { delta: -2, reason: 'رسید', version: null, requestId: id });
  for (const delta of ['0', '1.5', '1000001', '-1000001', '1e3', 'NaN'])
    assert.throws(() => stockAdjustment(delta, 'reason', null, id));
  assert.throws(() => stockAdjustment('1', '', null, id));
  assert.throws(() => stockAdjustment('1', 'x'.repeat(501), null, id));
});
