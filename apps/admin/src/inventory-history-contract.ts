import { z } from 'zod';

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const sequence = z
  .string()
  .regex(/^[1-9]\d{0,18}$/)
  .refine((v) => BigInt(v) <= 9223372036854775807n);
export const movementFiltersSchema = z
  .object({
    variantId: identifier.nullable(),
    direction: z.enum(['all', 'in', 'out']),
    fromAt: z.iso.datetime({ offset: true }).nullable(),
    toAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict()
  .refine((f) => !f.fromAt || !f.toAt || Date.parse(f.fromAt) < Date.parse(f.toAt));
export type MovementFilters = z.infer<typeof movementFiltersSchema>;
export const emptyMovementFilters: MovementFilters = {
  variantId: null,
  direction: 'all',
  fromAt: null,
  toAt: null,
};
const entry = z
  .object({
    id: sequence,
    variantId: identifier,
    delta: z.number().int().min(-2147483648).max(2147483647),
    balance: z.number().int().min(0).max(2147483647),
    reason: z.string().max(500),
    actorId: z.string().max(64),
    requestId: z.string().max(64),
    at: z.iso.datetime({ offset: true }),
  })
  .strict();
export const movementPageSchema = z
  .object({
    version: z.literal(1),
    pageSize: z.literal(50),
    items: z.array(entry).max(50),
    nextCursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,256}$/)
      .nullable(),
  })
  .strict()
  .refine(
    (p) =>
      (!p.nextCursor || p.items.length === 50) &&
      p.items.every((row, i) => i === 0 || BigInt(row.id) < BigInt(p.items[i - 1].id)),
  );
export type MovementPage = z.infer<typeof movementPageSchema>;

export function movementPath(filters: MovementFilters, cursor: string | null) {
  const value = movementFiltersSchema.parse(filters);
  const query = new URLSearchParams({ direction: value.direction });
  if (value.variantId) query.set('variantId', value.variantId);
  if (value.fromAt) query.set('fromAt', value.fromAt);
  if (value.toAt) query.set('toAt', value.toAt);
  if (cursor)
    query.set(
      'cursor',
      z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,256}$/)
        .parse(cursor),
    );
  return '/admin/inventory/movements?' + query.toString();
}
export function readMovementPage(raw: unknown, filters: MovementFilters): MovementPage {
  const parsed = movementPageSchema.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.items.some(
      (row) =>
        (filters.variantId && row.variantId.toUpperCase() !== filters.variantId.toUpperCase()) ||
        (filters.direction === 'in' && row.delta <= 0) ||
        (filters.direction === 'out' && row.delta >= 0) ||
        (filters.fromAt && Date.parse(row.at) < Date.parse(filters.fromAt)) ||
        (filters.toAt && Date.parse(row.at) >= Date.parse(filters.toAt)),
    )
  )
    throw new Error('پاسخ گردش انبار معتبر نیست؛ دوباره دریافت کنید.');
  return parsed.data;
}
export function localMovementTime(value: string): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error('زمان انتخاب‌شده معتبر نیست.');
  const date = new Date(value);
  const parts = value.split(/[-T:]/).map(Number);
  if (
    !Number.isFinite(date.getTime()) ||
    date.getFullYear() !== parts[0] ||
    date.getMonth() + 1 !== parts[1] ||
    date.getDate() !== parts[2] ||
    date.getHours() !== parts[3] ||
    date.getMinutes() !== parts[4]
  )
    throw new Error('زمان انتخاب‌شده در منطقهٔ دستگاه معتبر نیست.');
  return date.toISOString();
}
