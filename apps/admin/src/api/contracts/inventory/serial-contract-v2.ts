import { z } from 'zod';
import {
  serialStockSchema,
  serialUnitSchema,
  serialPageSchema,
  serialFiltersSchema,
  retireAttempt,
  type SerialStock,
  type SerialFilters,
  type SerialAttempt,
} from './serial-contract.ts';

const count = z.number().int().min(0).max(2147483647);
const cursor = z.string().regex(/^[A-Za-z0-9_-]{1,512}$/);
export const serialStockV2Schema = serialStockSchema
  .safeExtend({ sourcingReserved: count, available: count })
  .refine(
    (stock) =>
      stock.reserved + stock.sourcingReserved <= stock.onHand &&
      stock.available === stock.onHand - stock.reserved - stock.sourcingReserved &&
      (stock.version !== null || stock.sourcingReserved === 0),
  );
export type SerialStockV2 = z.infer<typeof serialStockV2Schema>;
export const serialItemV2Schema = z
  .object({ unit: serialUnitSchema, hasActiveClaim: z.boolean() })
  .strict();
export type SerialItemV2 = z.infer<typeof serialItemV2Schema>;
const legacyFields = (stock: SerialStockV2) => ({
  variantId: stock.variantId,
  mode: stock.mode,
  onHand: stock.onHand,
  reserved: stock.reserved,
  version: stock.version,
});

// Old command/history contracts retain their exact shape. This is an explicit
// physical snapshot projection, never a current availability calculation.
export function toSerialStockV1(value: SerialStockV2): SerialStock {
  const stock = serialStockV2Schema.parse(value);
  return serialStockSchema.parse(legacyFields(stock));
}
export const serialPageV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    pageSize: z.literal(50),
    stock: serialStockV2Schema,
    items: z.array(serialItemV2Schema).max(50),
    nextCursor: cursor.nullable(),
  })
  .strict()
  .refine(
    (page) =>
      (page.nextCursor === null || page.items.length === 50) &&
      page.items.filter((item) => item.hasActiveClaim).length <=
        page.stock.reserved + page.stock.sourcingReserved &&
      serialPageSchema.safeParse({
        schemaVersion: 1,
        pageSize: 50,
        stock: legacyFields(page.stock),
        items: page.items.map((item) => item.unit),
        nextCursor: null,
      }).success,
  );
export type SerialPageV2 = z.infer<typeof serialPageV2Schema>;

export function serialPathV2(id: string, filters: SerialFilters, after: string | null) {
  const variant = serialStockSchema.shape.variantId.parse(id),
    checked = serialFiltersSchema.parse(filters),
    query = new URLSearchParams(checked);
  if (after !== null) query.set('cursor', cursor.parse(after));
  return '/admin/inventory/variants/' + encodeURIComponent(variant) + '/serials/v2?' + query;
}
export function readSerialPageV2(
  raw: unknown,
  id: string,
  filters: SerialFilters,
  after: string | null = null,
): SerialPageV2 {
  const page = serialPageV2Schema.parse(raw),
    checked = serialFiltersSchema.parse(filters);
  if (
    page.stock.variantId.toLowerCase() !== id.toLowerCase() ||
    (after !== null && page.nextCursor === after) ||
    page.items.some(
      (item) =>
        (checked.state !== 'all' && item.unit.state !== checked.state) ||
        (checked.state === 'available' && item.hasActiveClaim) ||
        (checked.query !== '' &&
          ![item.unit.serial, item.unit.imei1, item.unit.imei2].some((value) =>
            value?.startsWith(checked.query),
          )),
    )
  )
    throw new Error(
      'پاسخ سریال با تنوع، فیلتر و سهم محفوظ واحدها یکسان نیست؛ اطلاعات تازه را دریافت کنید.',
    );
  return page;
}
export function canRetireSerialV2(stock: SerialStockV2, item: SerialItemV2): boolean {
  const current = serialStockV2Schema.safeParse(stock),
    row = serialItemV2Schema.safeParse(item);
  return (
    current.success &&
    row.success &&
    current.data.mode !== 'none' &&
    current.data.available > 0 &&
    row.data.unit.variantId.toLowerCase() === current.data.variantId.toLowerCase() &&
    row.data.unit.state === 'available' &&
    !row.data.hasActiveClaim
  );
}
export function retireAttemptV2(
  stock: SerialStockV2,
  item: SerialItemV2,
  reason: string,
  requestId: string,
): SerialAttempt {
  if (!canRetireSerialV2(stock, item))
    throw new Error('خروج فقط برای واحد موجود، بدون سهم محفوظ و با موجودی آزاد مجاز است.');
  return retireAttempt(toSerialStockV1(stock), item.unit, reason, requestId);
}
