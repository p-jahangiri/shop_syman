import { z } from 'zod';

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const moneyPattern = /^(0|[1-9]\d{0,18})$/;
const money = z
  .string()
  .regex(moneyPattern)
  .refine((v) => moneyPattern.test(v) && BigInt(v) <= 9223372036854775807n);
const utc = z.iso
  .datetime()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/)
  .refine((v) => !v.startsWith('0000'));
const wireUtc = utc.refine((v) => /\.\d{7}Z$/.test(v));
// Lexicographic comparison at SQL/.NET 100ns precision; Date loses sub-ms digits.
function timeKey(value: string) {
  const [seconds, fraction = ''] = value.slice(0, -1).split('.');
  return seconds + '.' + fraction.padEnd(7, '0');
}
const cursorSchema = z.string().regex(/^[A-Za-z0-9_-]{1,1024}$/);
export const priceHistoryFiltersSchema = z
  .object({
    variantId: identifier.nullable(),
    direction: z.enum(['all', 'increase', 'decrease']),
    fromAt: utc.nullable(),
    toAt: utc.nullable(),
  })
  .strict()
  .refine((f) => !f.fromAt || !f.toAt || timeKey(f.fromAt) <= timeKey(f.toAt));
export type PriceHistoryFilters = z.infer<typeof priceHistoryFiltersSchema>;
export const emptyPriceHistoryFilters: PriceHistoryFilters = {
  variantId: null,
  direction: 'all',
  fromAt: null,
  toAt: null,
};
const variantSchema = z
  .object({
    id: identifier,
    sku: z.string().min(1).max(80),
    isActive: z.boolean(),
    currentPriceRial: money,
  })
  .strict();
const itemSchema = z
  .object({
    id: identifier,
    variantId: identifier,
    oldPriceRial: money,
    newPriceRial: money,
    changedBy: z.string().max(2000),
    changedAt: wireUtc,
  })
  .strict()
  .refine((v) => v.oldPriceRial !== v.newPriceRial);
export const priceHistoryPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    productId: identifier,
    asOfAt: wireUtc,
    pageSize: z.literal(50),
    variants: z.array(variantSchema).max(500),
    items: z.array(itemSchema).max(50),
    nextCursor: cursorSchema.nullable(),
  })
  .strict()
  .refine(
    (v) =>
      (!v.nextCursor || v.items.length === 50) &&
      new Set(v.variants.map((x) => x.id.toLowerCase())).size === v.variants.length &&
      new Set(v.items.map((x) => x.id.toLowerCase())).size === v.items.length &&
      v.items.every(
        (x, i) =>
          v.variants.some((variant) => variant.id.toLowerCase() === x.variantId.toLowerCase()) &&
          timeKey(x.changedAt) <= timeKey(v.asOfAt) &&
          (i === 0 ||
            timeKey(x.changedAt) < timeKey(v.items[i - 1].changedAt) ||
            (timeKey(x.changedAt) === timeKey(v.items[i - 1].changedAt) &&
              x.id < v.items[i - 1].id)),
      ),
  );
export type PriceHistoryPage = z.infer<typeof priceHistoryPageSchema>;
export type PriceHistoryItem = PriceHistoryPage['items'][number];

export function priceHistoryPath(
  productId: string,
  filters: PriceHistoryFilters,
  cursor: string | null,
) {
  identifier.parse(productId);
  const value = priceHistoryFiltersSchema.parse(filters),
    query = new URLSearchParams({ direction: value.direction });
  if (value.variantId) query.set('variantId', value.variantId);
  if (value.fromAt) query.set('fromAt', value.fromAt);
  if (value.toAt) query.set('toAt', value.toAt);
  if (cursor) query.set('cursor', cursorSchema.parse(cursor));
  return '/admin/products/' + encodeURIComponent(productId) + '/price-history?' + query.toString();
}
export function readPriceHistoryPage(
  raw: unknown,
  productId: string,
  filters: PriceHistoryFilters,
): PriceHistoryPage {
  const parsed = priceHistoryPageSchema.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.productId.toLowerCase() !== productId.toLowerCase() ||
    (filters.variantId !== null &&
      !parsed.data.variants.some(
        (variant) => variant.id.toLowerCase() === filters.variantId?.toLowerCase(),
      )) ||
    parsed.data.items.some(
      (row) =>
        (filters.variantId && row.variantId.toLowerCase() !== filters.variantId.toLowerCase()) ||
        (filters.direction === 'increase' &&
          BigInt(row.newPriceRial) <= BigInt(row.oldPriceRial)) ||
        (filters.direction === 'decrease' &&
          BigInt(row.newPriceRial) >= BigInt(row.oldPriceRial)) ||
        (filters.fromAt && timeKey(row.changedAt) < timeKey(filters.fromAt)) ||
        (filters.toAt && timeKey(row.changedAt) >= timeKey(filters.toAt)),
    )
  )
    throw new Error('پاسخ تاریخچهٔ قیمت معتبر نیست؛ اطلاعات را دوباره دریافت کنید.');
  return parsed.data;
}
export function localPriceHistoryTime(value: string): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error('زمان انتخاب‌شده معتبر نیست.');
  const at = new Date(value),
    parts = value.split(/[-T:]/).map(Number);
  if (
    !Number.isFinite(at.getTime()) ||
    at.getFullYear() !== parts[0] ||
    at.getMonth() + 1 !== parts[1] ||
    at.getDate() !== parts[2] ||
    at.getHours() !== parts[3] ||
    at.getMinutes() !== parts[4]
  )
    throw new Error('زمان انتخاب‌شده در منطقهٔ دستگاه معتبر نیست.');
  return at.toISOString();
}
export function priceHistoryMoney(value: string) {
  return BigInt(money.parse(value)).toLocaleString('fa-IR') + ' ریال';
}
// Money stays bigint. Only bounded SVG coordinates are converted to Number.
export function priceHistoryPlot(items: readonly PriceHistoryItem[], variantId: string) {
  const selected = items.filter((row) => row.variantId.toLowerCase() === variantId.toLowerCase());
  if (!selected.length) return [];
  const amounts = selected.flatMap((row) => [BigInt(row.oldPriceRial), BigInt(row.newPriceRial)]);
  const low = amounts.reduce((a, b) => (a < b ? a : b)),
    high = amounts.reduce((a, b) => (a > b ? a : b)),
    span = high - low;
  const x = (value: string) =>
    span === 0n ? 500 : 50 + Number(((BigInt(value) - low) * 900n) / span);
  return selected.map((row) => ({
    ...row,
    oldX: x(row.oldPriceRial),
    newX: x(row.newPriceRial),
    increasing: BigInt(row.newPriceRial) > BigInt(row.oldPriceRial),
  }));
}
