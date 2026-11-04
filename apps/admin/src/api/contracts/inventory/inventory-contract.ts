import { z } from 'zod';
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const version = z
  .string()
  .regex(/^[A-Za-z0-9+/]{11}=$/)
  .nullable();
const count = z
  .string()
  .regex(/^(0|[1-9]\d{0,18})$/)
  .refine((v) => BigInt(v) <= 9223372036854775807n);
export const inventorySummarySchema = z
  .object({ stockRecords: count, availableVariants: count, reservedVariants: count })
  .strict();
export const catalogSummarySchema = z.object({ products: count, categories: count }).strict();
export const inventoryRowSchema = z
  .object({
    variantId: identifier,
    productId: identifier,
    sku: z.string().max(80),
    nameFa: z.string().max(250),
    nameEn: z.string().max(250),
    isActive: z.boolean(),
    productStatus: z.enum(['Draft', 'Published', 'Hidden']),
    onHand: z.number().int().min(0).max(2147483647),
    reserved: z.number().int().min(0).max(2147483647),
    sourcingReserved: z.number().int().min(0).max(2147483647),
    available: z.number().int().min(0).max(2147483647),
    version,
  })
  .strict()
  .refine(
    (r) =>
      r.reserved + r.sourcingReserved <= r.onHand &&
      r.available === r.onHand - r.reserved - r.sourcingReserved &&
      (r.version !== null || (r.onHand === 0 && r.reserved === 0 && r.sourcingReserved === 0)),
  );
export const inventoryPageSchema = z
  .object({
    version: z.literal(2),
    pageSize: z.literal(50),
    items: z.array(inventoryRowSchema).max(50),
    nextCursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,300}$/)
      .nullable(),
  })
  .strict()
  .refine(
    (p) =>
      (!p.nextCursor || p.items.length === 50) &&
      new Set(p.items.map((r) => r.variantId.toLowerCase())).size === p.items.length,
  );
export type InventoryRow = z.infer<typeof inventoryRowSchema>;
export const inventoryFiltersSchema = z
  .object({ query: z.string().trim().max(120), active: z.enum(['all', 'true', 'false']) })
  .strict()
  .refine(
    (v) =>
      v.query
        .replace(/\u200c/g, ' ')
        .split(/\s+/)
        .filter(Boolean).length <= 8,
  );
export type InventoryFilters = z.infer<typeof inventoryFiltersSchema>;
export const emptyInventoryFilters: InventoryFilters = { query: '', active: 'all' };
export const inventoryWorkspaceFiltersSchema = inventoryFiltersSchema
  .safeExtend({
    minAvailable: z.number().int().min(0).max(2147483647).nullable(),
    maxAvailable: z.number().int().min(0).max(2147483647).nullable(),
    sort: z.enum(['name', 'sku', 'available']),
    direction: z.enum(['asc', 'desc']),
    page: z.number().int().min(0).max(1000000),
    pageSize: z.union([z.literal(25), z.literal(50)]),
  })
  .refine(
    (f) => f.minAvailable === null || f.maxAvailable === null || f.minAvailable <= f.maxAvailable,
  );
export type InventoryWorkspaceFilters = z.infer<typeof inventoryWorkspaceFiltersSchema>;
export const emptyInventoryWorkspace: InventoryWorkspaceFilters = {
  ...emptyInventoryFilters,
  minAvailable: null,
  maxAvailable: null,
  sort: 'name',
  direction: 'asc',
  page: 0,
  pageSize: 25,
};
const inventoryWorkspacePageSchema = z
  .object({
    items: z.array(inventoryRowSchema).max(50),
    total: z.number().int().min(0).max(2147483647),
    page: z.number().int().min(0),
    pageSize: z.union([z.literal(25), z.literal(50)]),
  })
  .strict();
export function inventoryWorkspacePath(filters: InventoryWorkspaceFilters) {
  const { minAvailable, maxAvailable, ...base } = inventoryWorkspaceFiltersSchema.parse(filters);
  const params = new URLSearchParams(
    Object.entries(base).map(([key, value]) => [key, String(value)]),
  );
  if (minAvailable !== null) params.set('minAvailable', String(minAvailable));
  if (maxAvailable !== null) params.set('maxAvailable', String(maxAvailable));
  return '/admin/inventory/workspace/variants?' + params;
}
export function readInventoryWorkspace(raw: unknown, filters: InventoryWorkspaceFilters) {
  const parsed = inventoryWorkspacePageSchema.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.page !== filters.page ||
    parsed.data.pageSize !== filters.pageSize ||
    parsed.data.items.length > filters.pageSize ||
    new Set(parsed.data.items.map((row) => row.variantId.toLowerCase())).size !==
      parsed.data.items.length ||
    parsed.data.items.some(
      (row) => filters.active !== 'all' && row.isActive !== (filters.active === 'true'),
    )
  )
    throw new Error('پاسخ جدول موجودی معتبر نیست؛ دوباره دریافت کنید.');
  return parsed.data;
}
export function inventoryPath(filters: InventoryFilters, cursor: string | null) {
  const value = inventoryFiltersSchema.parse(filters);
  const query = new URLSearchParams({ query: value.query, active: value.active });
  if (cursor)
    query.set(
      'cursor',
      z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,300}$/)
        .parse(cursor),
    );
  return '/admin/inventory/v2/variants?' + query;
}
export function inventoryDetailPath(id: string) {
  return '/admin/inventory/v2/variants/' + encodeURIComponent(identifier.parse(id));
}
export function readInventoryPage(raw: unknown, filters: InventoryFilters) {
  const parsed = inventoryPageSchema.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.items.some(
      (r) => filters.active !== 'all' && r.isActive !== (filters.active === 'true'),
    )
  )
    throw new Error('پاسخ موجودی معتبر نیست؛ اطلاعات را دوباره دریافت کنید.');
  return parsed.data;
}
const digits = (v: string) =>
  v.replace(/[۰-۹٠-٩]/g, (c) =>
    String('۰۱۲۳۴۵۶۷۸۹'.includes(c) ? '۰۱۲۳۴۵۶۷۸۹'.indexOf(c) : '٠١٢٣٤٥٦٧٨٩'.indexOf(c)),
  );
export function inventoryCount(value: string) {
  const text = digits(value.trim());
  const number = Number(text);
  if (!/^\d{1,10}$/.test(text) || number > 2147483647)
    throw new Error('تعداد باید عدد صحیح و نامنفی باشد.');
  return number;
}
export function stockAdjustmentPreview(mode: 'count' | 'delta', input: string, row: InventoryRow) {
  const value = digits(input.trim()).replace(/^\u2212/, '-');
  const delta = mode === 'count' ? inventoryCount(value) - row.onHand : Number(value);
  if (mode === 'delta' && !/^-?\d{1,7}$/.test(value))
    throw new Error('تغییر را با عدد صحیح وارد کنید.');
  if (Math.abs(delta) > 1000000) throw new Error('حداکثر تغییر در هر ثبت یک میلیون واحد است.');
  const onHand = row.onHand + delta;
  const available = onHand - row.reserved - row.sourcingReserved;
  if (available < 0) throw new Error('موجودی پس از ثبت باید رزرو سفارش و تأمین را پوشش دهد.');
  if (onHand > 2147483647) throw new Error('تعداد از سقف قابل ثبت بیشتر است.');
  return { delta, onHand, available };
}
export function stockAdjustment(
  delta: string,
  reason: string,
  rowVersion: string | null,
  requestId: string,
) {
  const parsed = z
    .object({
      delta: z
        .string()
        .transform(digits)
        .refine((v) => /^-?[1-9]\d{0,6}$/.test(v) && Math.abs(Number(v)) <= 1000000)
        .transform(Number),
      reason: z.string().trim().min(1).max(500),
      version,
      requestId: z.uuid(),
    })
    .safeParse({ delta: delta.trim(), reason, version: rowVersion, requestId });
  if (!parsed.success)
    throw new Error(
      'تعداد صحیح غیرصفر بین منفی و مثبت یک میلیون و دلیل حداکثر ۵۰۰ نویسه وارد کنید.',
    );
  return parsed.data;
}
export function formatAdminCount(value: string | number | undefined) {
  return value === undefined ? '—' : new Intl.NumberFormat('fa-IR').format(BigInt(value));
}
