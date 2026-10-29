import { z } from 'zod';
import type { PurchaseMethod, ChequePlan } from './types';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  version = z.string().regex(/^[A-Za-z0-9+/]{11}=$/),
  cursor = z.string().regex(/^[A-Za-z0-9_-]{1,512}$/);
const decimal = z
  .string()
  .refine((v) => /^(0|[1-9]\d{0,18})$/.test(v) && BigInt(v) <= 9223372036854775807n, {
    abort: true,
  });
export const purchaseKind = z.enum(['online', 'cheque', 'installment']);
const baseRow = {
  id,
  nameFa: z.string().max(200),
  nameEn: z.string().max(200),
  enabled: z.boolean(),
  categoryCount: z.number().int().min(0).max(2147483647),
};
const methodRow = z
  .object({ ...baseRow, kind: purchaseKind, requiresApproval: z.boolean() })
  .strict();
const planTerms = {
  months: z.number().int().min(1).max(60),
  intervalMonths: z.number().int().min(1).max(60),
  markupBasisPoints: z.number().int().min(0).max(100000),
  downPaymentBasisPoints: z.number().int().min(0).max(10000),
  roundingUnitRial: z.union([z.literal(1), z.literal(10)]),
};
const validTerms = (p: { months: number; intervalMonths: number }) =>
  p.intervalMonths <= p.months && p.months % p.intervalMonths === 0;
const planRow = z
  .object({ ...baseRow, ...planTerms })
  .strict()
  .refine(validTerms);
const validPage = (p: { items: { id: string }[]; nextCursor: string | null }) =>
  (!p.nextCursor || p.items.length === 50) &&
  new Set(p.items.map((r) => r.id.toLowerCase())).size === p.items.length;
export const methodsPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    pageSize: z.literal(50),
    items: z.array(methodRow).max(50),
    nextCursor: cursor.nullable(),
  })
  .strict()
  .refine(validPage);
export const plansPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    pageSize: z.literal(50),
    items: z.array(planRow).max(50),
    nextCursor: cursor.nullable(),
  })
  .strict()
  .refine(validPage);
export type MethodRow = z.infer<typeof methodRow>;
export type PlanRow = z.infer<typeof planRow>;
export const purchaseFiltersSchema = z
  .object({
    query: z
      .string()
      .trim()
      .max(120)
      .refine(
        (v) =>
          v
            .replace(/\u200c/g, ' ')
            .split(/\s+/)
            .filter(Boolean).length <= 8,
      ),
    enabled: z.enum(['all', 'true', 'false']),
    kind: z.enum(['all', 'online', 'cheque', 'installment']),
    categoryId: id.nullable(),
  })
  .strict();
export type PurchaseFilters = z.infer<typeof purchaseFiltersSchema>;
export type PurchaseScope = 'method' | 'plan';
export const emptyPurchaseFilters: PurchaseFilters = {
  query: '',
  enabled: 'all',
  kind: 'all',
  categoryId: null,
};
export function purchasePagePath(
  scope: PurchaseScope,
  filter: PurchaseFilters,
  after: string | null,
) {
  const f = purchaseFiltersSchema.parse(filter);
  if (scope === 'plan' && f.kind !== 'all') throw Error('Plan kind filter is unsupported');
  const q = new URLSearchParams({ query: f.query, enabled: f.enabled });
  if (scope === 'method') q.set('kind', f.kind);
  if (f.categoryId) q.set('categoryId', f.categoryId);
  if (after) q.set('cursor', cursor.parse(after));
  return `/admin/${scope === 'method' ? 'purchase-methods-page' : 'cheque-plans-page'}?${q}`;
}
export function readMethodsPage(raw: unknown, filter: PurchaseFilters) {
  const checked = methodsPageSchema.safeParse(raw);
  if (!checked.success) throw Error('پاسخ فهرست روش‌های خرید معتبر نیست؛ دوباره دریافت کنید.');
  const page = checked.data;
  if (
    page.items.some(
      (m) =>
        (filter.enabled !== 'all' && m.enabled !== (filter.enabled === 'true')) ||
        (filter.kind !== 'all' && m.kind !== filter.kind),
    )
  )
    throw Error('پاسخ فهرست با فیلتر انتخاب‌شده مطابقت ندارد؛ دوباره دریافت کنید.');
  return page;
}
export function readPlansPage(raw: unknown, filter: PurchaseFilters) {
  const checked = plansPageSchema.safeParse(raw);
  if (!checked.success) throw Error('پاسخ فهرست طرح‌های چکی معتبر نیست؛ دوباره دریافت کنید.');
  const page = checked.data;
  if (
    filter.kind !== 'all' ||
    page.items.some((p) => filter.enabled !== 'all' && p.enabled !== (filter.enabled === 'true'))
  )
    throw Error('پاسخ طرح‌ها با فیلتر انتخاب‌شده مطابقت ندارد؛ دوباره دریافت کنید.');
  return page;
}
const categoryIds = z
  .array(id)
  .max(500)
  .refine((v) => new Set(v.map((s) => s.toLowerCase())).size === v.length);
const amountFields = { minAmountRial: decimal.nullable(), maxAmountRial: decimal.nullable() };
const limits = (v: { minAmountRial: string | null; maxAmountRial: string | null }) =>
  v.maxAmountRial === null || BigInt(v.maxAmountRial) >= BigInt(v.minAmountRial ?? '0');
const methodData = z
  .object({
    id,
    nameFa: z.string().min(1).max(200),
    nameEn: z.string().min(1).max(200),
    kind: purchaseKind,
    descriptionFa: z.string().max(2000),
    descriptionEn: z.string().max(2000),
    enabled: z.boolean(),
    requiresApproval: z.boolean(),
    ...amountFields,
    categoryIds,
    version,
  })
  .strict()
  .refine(limits)
  .refine((v) => v.kind !== 'cheque' || v.requiresApproval);
const planData = z
  .object({
    id,
    nameFa: z.string().min(1).max(200),
    nameEn: z.string().min(1).max(200),
    enabled: z.boolean(),
    ...planTerms,
    ...amountFields,
    categoryIds,
    version,
  })
  .strict()
  .refine(limits)
  .refine(validTerms);
export const methodDetailSchema = z
  .object({ schemaVersion: z.literal(1), method: methodData })
  .strict();
export const planDetailSchema = z.object({ schemaVersion: z.literal(1), plan: planData }).strict();
export function readMethodDetail(raw: unknown, expected: string): PurchaseMethod {
  const checked = methodDetailSchema.safeParse(raw);
  if (!checked.success) throw Error('جزئیات روش خرید معتبر نیست؛ دوباره دریافت کنید.');
  const m = checked.data.method;
  if (m.id.toLowerCase() !== id.parse(expected).toLowerCase())
    throw Error('جزئیات دریافتی با روش انتخاب‌شده مطابقت ندارد؛ دوباره دریافت کنید.');
  const { categoryIds, minAmountRial, maxAmountRial, ...rest } = m;
  return {
    ...rest,
    minAmountRial: minAmountRial ?? undefined,
    maxAmountRial: maxAmountRial ?? undefined,
    categories: categoryIds.map((categoryId) => ({ categoryId })),
  };
}
export function readPlanDetail(raw: unknown, expected: string): ChequePlan {
  const checked = planDetailSchema.safeParse(raw);
  if (!checked.success) throw Error('جزئیات طرح چکی معتبر نیست؛ دوباره دریافت کنید.');
  const p = checked.data.plan;
  if (p.id.toLowerCase() !== id.parse(expected).toLowerCase())
    throw Error('جزئیات دریافتی با طرح انتخاب‌شده مطابقت ندارد؛ دوباره دریافت کنید.');
  const { categoryIds, minAmountRial, maxAmountRial, ...rest } = p;
  return {
    ...rest,
    minAmountRial: minAmountRial ?? undefined,
    maxAmountRial: maxAmountRial ?? undefined,
    categories: categoryIds.map((categoryId) => ({ categoryId })),
  };
}
export const purchaseSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    methods: decimal,
    enabledMethods: decimal,
    plans: decimal,
    enabledPlans: decimal,
  })
  .strict()
  .refine(
    (v) =>
      BigInt(v.enabledMethods) <= BigInt(v.methods) && BigInt(v.enabledPlans) <= BigInt(v.plans),
  );
const digits = (v: string) =>
  v
    .normalize('NFKC')
    .trim()
    .replace(/[۰-۹٠-٩]/g, (c) =>
      String('۰۱۲۳۴۵۶۷۸۹'.includes(c) ? '۰۱۲۳۴۵۶۷۸۹'.indexOf(c) : '٠١٢٣٤٥٦٧٨٩'.indexOf(c)),
    );
const amount = z
  .string()
  .max(64)
  .transform(digits)
  .transform((v) => (v === '' ? null : v))
  .pipe(decimal.nullable());
const integer = (max: number, min = 0) =>
  z
    .string()
    .max(20)
    .transform(digits)
    .pipe(z.string().regex(/^\d+$/))
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));
const names = {
  nameFa: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().min(1).max(200),
};
export const methodInputSchema = z
  .object({
    ...names,
    kind: purchaseKind,
    descriptionFa: z.string().max(2000),
    descriptionEn: z.string().max(2000),
    enabled: z.boolean(),
    requiresApproval: z.boolean(),
    minAmountRial: amount,
    maxAmountRial: amount,
    categoryIds,
    version: version.nullable(),
  })
  .strict()
  .refine(limits);
export const planInputSchema = z
  .object({
    ...names,
    enabled: z.boolean(),
    months: integer(60, 1),
    intervalMonths: integer(60, 1),
    markupBasisPoints: integer(100000),
    downPaymentBasisPoints: integer(10000),
    roundingUnitRial: integer(10, 1).refine((v) => v === 1 || v === 10),
    minAmountRial: amount,
    maxAmountRial: amount,
    categoryIds,
    version: version.nullable(),
  })
  .strict()
  .refine(limits)
  .refine(validTerms);
