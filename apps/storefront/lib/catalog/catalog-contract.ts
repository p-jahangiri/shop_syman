import { z } from '@sayman/web-shared/lib/config/schema-runtime.ts';
import type { Product } from '@sayman/web-shared/lib/shared/types.ts';
import { snapshotSchema } from '../data/snapshot.ts';
export const productSchema = snapshotSchema.shape.products.element;
const id = z.string().min(1).max(64);
const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(150);
const money = z
  .string()
  .regex(/^\d{1,19}$/)
  .refine((v) => BigInt(v) <= 9223372036854775807n);
const unique = <T>(items: T[]) => new Set(items).size === items.length;
export const catalogConditionSchema = z.enum(['new', 'used']);
export type CatalogCondition = z.infer<typeof catalogConditionSchema>;

function searchTermCount(value: string): number {
  // Match PersianText.Normalize before the backend's distinct/eight-term check.
  // Iterate UTF-16 units like C# char; Unicode whitespace differs from JS \s.
  const normalized = value
    .normalize('NFKC')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6f0))
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660))
    .split('')
    .filter((c) => !/\p{Mn}/u.test(c))
    .map((c) => {
      const lower = c.toLowerCase();
      return lower.length === 1 ? lower : c;
    })
    .join('')
    .replace(/[\p{White_Space}\u200c]+/gu, ' ');
  return new Set(normalized.split(' ').filter(Boolean)).size;
}

export const catalogInputSchema = z
  .object({
    categoryId: id.optional(),
    query: z
      .string()
      .max(200)
      .refine((v) => searchTermCount(v) <= 8)
      .optional(),
    brandIds: z.array(id).max(20).refine(unique).default([]),
    minPriceRial: money.optional(),
    maxPriceRial: money.optional(),
    availableOnly: z.boolean().default(false),
    condition: catalogConditionSchema.optional(),
    sort: z.enum(['selected', 'price-asc', 'price-desc', 'newest']).default('selected'),
    page: z.number().int().min(1).max(10000).default(1),
    pageSize: z.number().int().min(1).max(48).default(12),
    attributes: z
      .array(
        z
          .object({
            key: z.string().min(1).max(150),
            values: z.array(z.string().min(1).max(2000)).min(1).max(20).refine(unique),
          })
          .strict(),
      )
      .max(8)
      .default([]),
  })
  .strict()
  .refine(
    (v) => !v.minPriceRial || !v.maxPriceRial || BigInt(v.minPriceRial) <= BigInt(v.maxPriceRial),
  )
  .refine((v) => !v.attributes.length || !!v.categoryId)
  .refine((v) => unique(v.attributes.map((a) => a.key)));
export type CatalogQuery = z.infer<typeof catalogInputSchema>;
export function catalogBrowseCondition(query: Pick<CatalogQuery, 'condition' | 'query'>) {
  return query.condition ?? (query.query?.trim() ? undefined : 'new');
}
export const lookupInputSchema = z
  .object({
    productIds: z.array(id).max(64).default([]),
    variantIds: z.array(id).max(64).default([]),
    slugs: z.array(slug).max(64).default([]),
  })
  .strict()
  .refine(
    (v) =>
      v.productIds.length + v.variantIds.length + v.slugs.length > 0 &&
      v.productIds.length + v.variantIds.length + v.slugs.length <= 64,
  );
export type ProductLookup = z.infer<typeof lookupInputSchema>;
export function lookupReferencesProduct(refs: ProductLookup, product: Product) {
  const contains = (ids: string[], id: string) =>
    ids.some((value) => value.toLowerCase() === id.toLowerCase());
  return (
    contains(refs.productIds, product.id) ||
    refs.slugs.includes(product.slug) ||
    product.variants.some((v) => contains(refs.variantIds, v.id))
  );
}
export const catalogPageSchema = z
  .object({
    version: z.literal(1),
    locale: z.enum(['fa', 'en']),
    products: z.array(productSchema).max(48),
    matchingVariantIds: z.record(id, id),
    total: z.number().int().nonnegative(),
    page: z.number().int().min(1).max(10000),
    pageSize: z.number().int().min(1).max(48),
    totalPages: z.number().int().nonnegative(),
  })
  .refine(
    (v) =>
      v.products.length <= v.pageSize &&
      v.total >= v.products.length &&
      (!v.products.length || v.page <= v.totalPages) &&
      unique(v.products.map((p) => p.id)) &&
      v.totalPages === Math.ceil(v.total / v.pageSize) &&
      v.products.every((p) => p.variants.some((a) => a.id === v.matchingVariantIds[p.id])) &&
      Object.keys(v.matchingVariantIds).every((id) => v.products.some((p) => p.id === id)),
  );
export type CatalogPage = Omit<z.infer<typeof catalogPageSchema>, 'products'> & {
  products: Product[];
};
export function catalogPageMatchesCondition(page: CatalogPage, condition?: CatalogCondition) {
  if (!condition) return true;
  return page.products.every((product) => {
    const variant = product.variants.find(
      (item) => item.id === page.matchingVariantIds[product.id],
    );
    return variant && Boolean(variant.usedCondition) === (condition === 'used');
  });
}
const catalogSuggestionSchema = z
  .object({
    query: z
      .string()
      .min(1)
      .max(200)
      .refine((value) => searchTermCount(value) <= 8),
    total: z.number().int().positive(),
  })
  .strict();
export type CatalogSearchSuggestion = z.infer<typeof catalogSuggestionSchema>;
export const catalogSearchPageSchema = catalogPageSchema
  .safeExtend({ suggestion: catalogSuggestionSchema.optional() })
  .refine((page) => !page.suggestion || (page.total === 0 && page.page === 1));
export const lookupResponseSchema = z
  .object({
    version: z.literal(1),
    locale: z.enum(['fa', 'en']),
    products: z.array(productSchema).max(64),
  })
  .refine((v) => unique(v.products.map((p) => p.id)));
export const catalogFiltersSchema = z.object({
  brands: z.array(z.object({ id, name: z.string() })),
  attributes: z.array(
    z.object({
      key: z.string().min(1).max(150),
      label: z.string(),
      dataType: z.enum(['text', 'number', 'bool', 'select', 'multiSelect']),
      unit: z
        .string()
        .nullish()
        .transform((v) => v ?? undefined),
      values: z.array(z.object({ value: z.string(), label: z.string() })).max(60),
      truncated: z.boolean(),
      total: z.number().int().nonnegative(),
    }),
  ),
  maxPriceRial: money.nullish().transform((v) => v ?? undefined),
});
export type CatalogFilters = z.infer<typeof catalogFiltersSchema>;
export function catalogQueryFromParams(params: URLSearchParams): CatalogQuery {
  const attributes = Array.from(new Set([...params.keys()].filter((k) => k.startsWith('a.')))).map(
    (k) => ({ key: k.slice(2), values: params.getAll(k) }),
  );
  const conditions = params.getAll('condition');
  return catalogInputSchema.parse({
    categoryId: params.get('category') || undefined,
    query: params.get('q') || undefined,
    brandIds: params.getAll('brand'),
    minPriceRial: params.get('min') || undefined,
    maxPriceRial: params.get('max') || undefined,
    availableOnly: params.get('available') === '1',
    ...(conditions.length && { condition: conditions.length > 1 ? conditions : conditions[0] }),
    sort: params.get('sort') || 'selected',
    page: params.has('page') ? Number(params.get('page')) : 1,
    pageSize: params.has('size') ? Number(params.get('size')) : 12,
    attributes,
  });
}
export function catalogQueryParams(query: CatalogQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.categoryId) params.set('category', query.categoryId);
  if (query.query) params.set('q', query.query);
  for (const brand of query.brandIds) params.append('brand', brand);
  if (query.minPriceRial) params.set('min', query.minPriceRial);
  if (query.maxPriceRial) params.set('max', query.maxPriceRial);
  if (query.availableOnly) params.set('available', '1');
  if (query.condition) params.set('condition', query.condition);
  if (query.sort !== 'selected') params.set('sort', query.sort);
  if (query.page !== 1) params.set('page', String(query.page));
  if (query.pageSize !== 12) params.set('size', String(query.pageSize));
  for (const a of query.attributes)
    for (const value of a.values) params.append(`a.${a.key}`, value);
  return params;
}

const facetValue = z.object({ value: z.string().min(1).max(2000), label: z.string().max(4000) });
export const facetInputSchema = z
  .object({
    categoryId: id,
    condition: catalogConditionSchema.optional(),
    key: z.string().min(1).max(150),
    query: z
      .string()
      .max(100)
      .refine((v) => searchTermCount(v) <= 8)
      .optional(),
    page: z.number().int().min(1).max(10000).default(1),
    pageSize: z.number().int().min(1).max(60).default(20),
    selectedValues: z.array(z.string().min(1).max(2000)).max(20).refine(unique).default([]),
  })
  .strict();
export type FacetQuery = z.infer<typeof facetInputSchema>;
export const facetPageSchema = z
  .object({
    version: z.literal(1),
    locale: z.enum(['fa', 'en']),
    key: z.string().min(1).max(150),
    values: z.array(facetValue).max(60),
    selectedValues: z.array(facetValue).max(20),
    total: z.number().int().nonnegative(),
    page: z.number().int().min(1).max(10000),
    pageSize: z.number().int().min(1).max(60),
    totalPages: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (v) =>
      v.values.length <= v.pageSize &&
      v.total >= v.values.length &&
      (!v.values.length || v.page <= v.totalPages) &&
      v.totalPages === Math.ceil(v.total / v.pageSize) &&
      unique(v.values.map((v) => v.value)) &&
      unique(v.selectedValues.map((v) => v.value)),
  );
export type FacetPage = z.infer<typeof facetPageSchema>;
