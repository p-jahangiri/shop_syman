import { z } from 'zod';
import { productVideoSchema } from './product-video-contract.ts';
import { productDetailSchema } from './products-contract.ts';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const selection = <T extends z.ZodType<string>>(item: T, max: number) =>
  z
    .array(item)
    .max(max)
    .refine((values) => new Set(values.map((value) => value.toLowerCase())).size === values.length)
    .default([]);
const statusSelection = z.enum(['Draft', 'Published', 'Hidden', 'archived']);
const version = z.string().regex(/^[A-Za-z0-9+/]{11}=$/);
const integer = z
  .string()
  .regex(/^(0|[1-9]\d{0,18})$/)
  .pipe(z.string().refine((v) => BigInt(v) <= 9223372036854775807n));
const variantCount = integer.refine((v) => BigInt(v) <= 2147483647n);
const instant = z.iso.datetime({ precision: 3 });
const term = z
  .string()
  .trim()
  .max(120)
  .refine(
    (v) =>
      v
        .replace(/\u200c/g, ' ')
        .split(/\s+/)
        .filter(Boolean).length <= 8,
  );
const nullable = <T extends z.ZodType>(value: T) => value.nullish().transform((v) => v ?? null);
export const workspaceFiltersSchema = z
  .object({
    search: term,
    name: term,
    minPriceRial: integer.nullable(),
    maxPriceRial: integer.nullable(),
    minStock: integer.nullable(),
    maxStock: integer.nullable(),
    minVariants: variantCount.nullable(),
    maxVariants: variantCount.nullable(),
    updatedFrom: instant.nullable(),
    updatedBefore: instant.nullable(),
    status: z.enum(['all', 'Draft', 'Published', 'Hidden', 'archived']),
    categoryId: id.nullable(),
    brandId: id.nullable(),
    categoryIds: selection(id, 32),
    brandIds: selection(id, 32),
    statuses: selection(statusSelection, 4),
    availability: z.enum(['all', 'available', 'empty']),
    sort: z.enum(['name', 'category', 'brand', 'status', 'price', 'stock', 'variants', 'updated']),
    direction: z.enum(['asc', 'desc']),
    page: z.number().int().min(0).max(100000),
    pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]),
  })
  .strict()
  .refine(
    (f) =>
      [
        [f.minPriceRial, f.maxPriceRial],
        [f.minStock, f.maxStock],
        [f.minVariants, f.maxVariants],
      ].every(([min, max]) => min === null || max === null || BigInt(min) <= BigInt(max)) &&
      (f.updatedFrom === null || f.updatedBefore === null || f.updatedFrom < f.updatedBefore),
  );
export type WorkspaceFilters = z.infer<typeof workspaceFiltersSchema>;
export const initialWorkspaceFilters: WorkspaceFilters = {
  search: '',
  name: '',
  minPriceRial: null,
  maxPriceRial: null,
  minStock: null,
  maxStock: null,
  minVariants: null,
  maxVariants: null,
  updatedFrom: null,
  updatedBefore: null,
  status: 'all',
  categoryId: null,
  brandId: null,
  categoryIds: [],
  brandIds: [],
  statuses: [],
  availability: 'all',
  sort: 'updated',
  direction: 'desc',
  page: 0,
  pageSize: 25,
};
const row = z
  .object({
    id,
    version,
    slug: z.string().max(150),
    nameFa: z.string().max(250),
    nameEn: z.string().max(250),
    categoryId: id,
    categoryName: z.string().max(250),
    brandId: id,
    brandName: z.string().max(120),
    status: z.enum(['Draft', 'Published', 'Hidden']),
    archived: z.boolean(),
    featured: z.boolean(),
    isDigital: z.boolean(),
    variantCount: z.number().int().nonnegative(),
    activeVariantCount: z.number().int().nonnegative(),
    minPriceRial: nullable(integer),
    maxPriceRial: nullable(integer),
    availableQuantity: integer,
    imageUrl: nullable(z.string().max(2000)),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine(
    (v) =>
      v.activeVariantCount <= v.variantCount &&
      ((v.minPriceRial === null && v.maxPriceRial === null) ||
        (v.minPriceRial !== null &&
          v.maxPriceRial !== null &&
          BigInt(v.minPriceRial) <= BigInt(v.maxPriceRial))),
  );
export type WorkspaceProductRow = z.infer<typeof row>;
const page = z
  .object({
    schemaVersion: z.literal(1),
    page: z.number().int().nonnegative(),
    pageSize: z.number().int(),
    totalCount: integer,
    items: z.array(row).max(100),
  })
  .strict();
export function workspaceProductsPath(filters: WorkspaceFilters) {
  const f = workspaceFiltersSchema.parse(filters),
    params = new URLSearchParams();
  for (const [key, value] of Object.entries(f)) {
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(','));
    } else if (value !== null && (key !== 'name' || value !== '')) {
      params.set(key, String(value));
    }
  }
  return '/admin/catalog/workspace/products?' + params;
}
function inRange(value: string | null, min: string | null, max: string | null) {
  if (min === null && max === null) return true;
  return (
    value !== null &&
    (min === null || BigInt(value) >= BigInt(min)) &&
    (max === null || BigInt(value) <= BigInt(max))
  );
}
export function readWorkspaceProducts(value: unknown, filters: WorkspaceFilters) {
  const result = page.safeParse(value);
  const { categoryId, brandId, status } = filters;
  const categoryIds = new Set((filters.categoryIds ?? []).map((id) => id.toLowerCase()));
  const brandIds = new Set((filters.brandIds ?? []).map((id) => id.toLowerCase()));
  const statuses = new Set(filters.statuses);
  if (
    !result.success ||
    result.data.page !== filters.page ||
    result.data.pageSize !== filters.pageSize ||
    result.data.items.length > filters.pageSize ||
    new Set(result.data.items.map((v) => v.id.toLowerCase())).size !== result.data.items.length ||
    result.data.items.some(
      (v) =>
        (statuses.size
          ? !statuses.has(v.archived ? 'archived' : v.status)
          : v.archived !== (status === 'archived') ||
            (status !== 'all' && status !== 'archived' && v.status !== status)) ||
        (categoryIds.size
          ? !categoryIds.has(v.categoryId.toLowerCase())
          : categoryId && v.categoryId.toLowerCase() !== categoryId.toLowerCase()) ||
        (brandIds.size
          ? !brandIds.has(v.brandId.toLowerCase())
          : brandId && v.brandId.toLowerCase() !== brandId.toLowerCase()) ||
        (filters.availability === 'available' && v.availableQuantity === '0') ||
        (filters.availability === 'empty' && v.availableQuantity !== '0') ||
        !inRange(v.minPriceRial, filters.minPriceRial, filters.maxPriceRial) ||
        !inRange(v.availableQuantity, filters.minStock, filters.maxStock) ||
        !inRange(String(v.variantCount), filters.minVariants, filters.maxVariants) ||
        (filters.updatedFrom !== null &&
          Date.parse(v.updatedAt) < Date.parse(filters.updatedFrom)) ||
        (filters.updatedBefore !== null &&
          Date.parse(v.updatedAt) >= Date.parse(filters.updatedBefore)),
    )
  )
    throw new Error('پاسخ جدول کالاها با فیلترهای جاری سازگار نیست؛ تازه‌سازی کنید.');
  return result.data;
}
const detail = z
  .object({
    schemaVersion: z.literal(1),
    product: productDetailSchema.shape.product,
    archived: z.boolean(),
    videos: z.array(productVideoSchema).max(8),
  })
  .strict();
export function readWorkspaceDetail(value: unknown, expectedId: string) {
  const parsed = detail.safeParse(value);
  if (!parsed.success || parsed.data.product.id.toLowerCase() !== expectedId.toLowerCase())
    throw new Error('جزئیات کالا معتبر نیست؛ فرم ویرایش باز نشد.');
  return parsed.data;
}
export const productReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: z.string().regex(/^[a-f0-9]{32}$/),
    kind: z.enum(['save', 'prices', 'archive', 'restore', 'fields']),
    productId: nullable(id),
    productVersion: nullable(version),
    variantIds: z.array(id).max(500),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.variantIds.map((x) => x.toLowerCase())).size === v.variantIds.length &&
      v.productVersion !== null &&
      (v.kind === 'fields'
        ? v.productId === null && v.variantIds.length === 0
        : v.productId !== null),
  );
export type ProductReceipt = z.infer<typeof productReceiptSchema>;
export function readProductReceipt(
  value: unknown,
  expected: { requestId: string; kind: ProductReceipt['kind']; productId?: string | null },
) {
  const parsed = productReceiptSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.requestId !== expected.requestId ||
    parsed.data.kind !== expected.kind ||
    (expected.productId != null && parsed.data.productId !== expected.productId)
  )
    throw new Error('رسید تغییر کالا قابل تأیید نیست؛ رسید همان تلاش را بررسی کنید.');
  return parsed.data;
}
const fieldKeys = [
  'name',
  'category',
  'brand',
  'slug',
  'description',
  'translation',
  'specifications',
  'sku',
  'color',
  'axes',
  'price',
  'discount',
  'warranty',
  'purchaseMethods',
  'images',
  'videos',
];
export const formFieldsSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: nullable(version),
    fields: z
      .array(
        z
          .object({
            key: z.string().regex(/^[a-zA-Z]{1,40}$/),
            label: z.string().min(1).max(150),
            help: z.string().max(1000),
            visible: z.boolean(),
            sortOrder: z.number().int().min(0).max(1000),
            visibilityLocked: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.fields.map((f) => f.key)).size === v.fields.length &&
      v.fields.length === fieldKeys.length &&
      fieldKeys.every((key) => v.fields.some((f) => f.key === key)) &&
      v.fields.every((f) => !f.visibilityLocked || f.visible),
  );
export type FormFieldsConfiguration = z.infer<typeof formFieldsSchema>;
export function readFormFields(value: unknown) {
  return formFieldsSchema.parse(value);
}
export const productWorkspaceBase = '/admin/catalog/workspace';
