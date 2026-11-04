import { z } from 'zod';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const version = z.string().regex(/^[A-Za-z0-9+/]{11}=$/);
const money = z
  .string()
  .refine((v) => /^(0|[1-9]\d{0,18})$/.test(v) && BigInt(v) <= 9223372036854775807n);
const optional = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((v) => v ?? undefined);
export const productStatus = z.enum(['Draft', 'Published', 'Hidden']);
export const productSummarySchema = z
  .object({
    id,
    slug: z.string().max(150),
    nameFa: z.string().max(250),
    nameEn: z.string().max(250),
    categoryId: id,
    brandId: id,
    status: productStatus,
    featured: z.boolean(),
    variantCount: z.number().int().min(0).max(2147483647),
  })
  .strict();
export const productsPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    pageSize: z.literal(50),
    items: z.array(productSummarySchema).max(50),
    nextCursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,300}$/)
      .nullable(),
  })
  .strict()
  .refine(
    (v) =>
      (!v.nextCursor || v.items.length === 50) &&
      new Set(v.items.map((r) => r.id.toLowerCase())).size === v.items.length,
  );
export type ProductSummary = z.infer<typeof productSummarySchema>;
export const productFiltersSchema = z
  .object({
    query: z.string().trim().max(120),
    status: z.enum(['all', 'Draft', 'Published', 'Hidden']),
    categoryId: id.nullable(),
    brandId: id.nullable(),
  })
  .strict()
  .refine(
    (v) =>
      v.query
        .replace(/\u200c/g, ' ')
        .split(/\s+/)
        .filter(Boolean).length <= 8,
  );
export type ProductFilters = z.infer<typeof productFiltersSchema>;
export const emptyProductFilters: ProductFilters = {
  query: '',
  status: 'all',
  categoryId: null,
  brandId: null,
};
export function productsPath(filters: ProductFilters, cursor: string | null) {
  const value = productFiltersSchema.parse(filters);
  const params = new URLSearchParams({ query: value.query, status: value.status });
  if (value.categoryId) params.set('categoryId', value.categoryId);
  if (value.brandId) params.set('brandId', value.brandId);
  if (cursor)
    params.set(
      'cursor',
      z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,300}$/)
        .parse(cursor),
    );
  return '/admin/products?' + params;
}
export function readProductsPage(raw: unknown, filters: ProductFilters) {
  const parsed = productsPageSchema.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.items.some(
      (r) =>
        (filters.status !== 'all' && r.status !== filters.status) ||
        (filters.categoryId && r.categoryId.toLowerCase() !== filters.categoryId.toLowerCase()) ||
        (filters.brandId && r.brandId.toLowerCase() !== filters.brandId.toLowerCase()),
    )
  )
    throw new Error('پاسخ فهرست کالا معتبر نیست؛ دوباره دریافت کنید.');
  return parsed.data;
}
export function productLookupPath(ids: string[]) {
  z.array(id)
    .max(24)
    .refine((v) => new Set(v.map((x) => x.toLowerCase())).size === v.length)
    .parse(ids);
  const params = new URLSearchParams();
  for (const value of ids) params.append('ids', value);
  return '/admin/catalog/product-lookup?' + params;
}
export function readProductLookup(raw: unknown, ids: string[]) {
  const parsed = z.array(productSummarySchema).max(24).safeParse(raw);
  const keys = new Set(ids.map((x) => x.toLowerCase()));
  if (
    !parsed.success ||
    new Set(parsed.data.map((r) => r.id.toLowerCase())).size !== parsed.data.length ||
    parsed.data.some((r) => !keys.has(r.id.toLowerCase()))
  )
    throw new Error('پاسخ کالاهای انتخاب‌شده معتبر نیست.');
  return parsed.data;
}
const value = z
  .object({
    attributeId: id,
    valueTextFa: optional(z.string()),
    valueTextEn: optional(z.string()),
    valueNumber: optional(z.number().finite()),
    valueBool: optional(z.boolean()),
    valueOptionId: optional(id),
    selections: z.array(z.object({ optionId: id }).strict()),
  })
  .strict();
const method = z.object({ methodId: id }).strict();
const variant = z
  .object({
    id,
    version,
    sku: z.string().max(80),
    priceRial: money,
    compareAtPriceRial: optional(money),
    color: z.string(),
    colorNameFa: z.string(),
    colorNameEn: z.string(),
    labelFa: z.string(),
    labelEn: z.string(),
    warrantyFa: z.string(),
    warrantyEn: z.string(),
    isActive: z.boolean(),
    attributes: z.array(value),
    purchaseMethods: z.array(method),
  })
  .strict();
export const productDetailSchema = z
  .object({
    schemaVersion: z.literal(1),
    product: z
      .object({
        id,
        version,
        slug: z.string().max(150),
        categoryId: id,
        brandId: id,
        status: productStatus,
        isDigital: z.boolean(),
        featured: z.boolean(),
        translations: z
          .array(
            z
              .object({
                locale: z.enum(['fa', 'en']),
                name: z.string().max(250),
                description: z.string(),
                badge: optional(z.string()),
              })
              .strict(),
          )
          .max(2),
        attributes: z.array(value),
        variants: z.array(variant),
        media: z.array(z.object({ url: z.string(), sortOrder: z.number().int() }).strict()),
        purchaseMethods: z.array(method),
        creditPlans: z.array(z.object({ planId: id }).strict()),
      })
      .strict(),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.product.translations.map((t) => t.locale)).size === v.product.translations.length &&
      new Set(v.product.variants.map((t) => t.id.toLowerCase())).size === v.product.variants.length,
  );
export function readProductDetail(raw: unknown, expectedId: string) {
  const parsed = productDetailSchema.safeParse(raw);
  if (!parsed.success || parsed.data.product.id.toLowerCase() !== expectedId.toLowerCase())
    throw new Error('جزئیات کالا معتبر نیست؛ ویرایش آغاز نشد.');
  const product = parsed.data.product;
  return {
    ...product,
    translations: (['fa', 'en'] as const).map(
      (locale) =>
        product.translations.find((t) => t.locale === locale) ?? {
          locale,
          name: '',
          description: '',
          badge: undefined,
        },
    ),
  };
}
export function toggleProductSelection(value: string[], itemId: string) {
  const found = value.some((id) => id.toLowerCase() === itemId.toLowerCase());
  return found
    ? value.filter((id) => id.toLowerCase() !== itemId.toLowerCase())
    : value.length >= 24
      ? value
      : [...value, itemId];
}
