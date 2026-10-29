import { z } from './schema-runtime.ts';

export const marketIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const unique = (values: string[]) => new Set(values).size === values.length;
export const marketAttributeKeySchema = z.string().regex(/^[A-Za-z0-9_-]{1,150}$/);
const attributeValue = z
  .string()
  .min(1)
  .max(2000)
  // eslint-disable-next-line no-control-regex -- Reject forbidden control characters at the trust boundary.
  .refine((value) => !/[\x00-\x08\x0e-\x1f\x7f]/.test(value));
export const marketAttributeSelectionsSchema = z
  .array(
    z
      .object({
        key: marketAttributeKeySchema,
        values: z.array(attributeValue).min(1).max(20).refine(unique),
      })
      .strict(),
  )
  .max(8)
  .refine((values) => unique(values.map((value) => value.key)));
export const marketScopeSchema = z
  .object({
    query: z.string().max(120),
    categoryId: marketIdSchema.nullable(),
    brandId: marketIdSchema.nullable(),
    attributes: marketAttributeSelectionsSchema.refine((values) => values.length > 0).optional(),
  })
  .strict()
  .refine((value) => !value.attributes?.length || value.categoryId !== null);
const publicImage = z
  .string()
  .max(2048)
  .refine((value) => {
    if (
      /^\/products\/[A-Za-z0-9/_-]+\.svg$/.test(value) ||
      /^\/media\/catalog\/[a-f0-9]{32}\/(thumb|card|zoom)\.webp$/.test(value)
    )
      return true;
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        !/[\\\s]/.test(value)
      );
    } catch {
      return false;
    }
  });
const sourceUrl = z
  .string()
  .max(1500)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        !/[\\\s]/.test(value)
      );
    } catch {
      return false;
    }
  });
const date = z.iso.datetime({ offset: true });
const positiveRial = z
  .string()
  .regex(/^[0-9]{1,19}$/)
  .refine((value) => BigInt(value) > 0n && BigInt(value) <= 9223372036854775807n);
// The model is deliberately independent of a sellable Product. Unknown fields
// (including SKU, stock and purchase methods) fail closed at this boundary.
export const marketModelSchema = z
  .object({
    id: marketIdSchema,
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(180),
    categoryId: marketIdSchema,
    brandId: marketIdSchema,
    brand: z.string().min(1).max(4000),
    name: z.string().min(1).max(4000),
    englishName: z.string().min(1).max(4000),
    description: z.string().max(16000),
    image: publicImage,
    images: z.array(publicImage).min(1).max(24).refine(unique),
    attributes: z
      .record(z.string().min(1).max(150), z.string().max(8000))
      .refine((value) => Object.keys(value).length <= 128),
  })
  .strict()
  .refine((value) => value.images.includes(value.image));
export const marketItemSchema = z
  .object({
    id: marketIdSchema,
    model: marketModelSchema,
    sourceName: z.string().min(1).max(200),
    sourceUrl: sourceUrl.nullish().transform((value) => value ?? null),
    availability: z.enum(['unknown', 'available', 'unavailable', 'stale']),
    observedAt: date.nullish().transform((value) => value ?? null),
    validUntil: date.nullish().transform((value) => value ?? null),
    referencePriceRial: positiveRial.nullable(),
    referencePriceCurrent: z.boolean(),
    isDemo: z.boolean(),
  })
  .strict()
  .refine((value) => {
    const dated = value.observedAt !== null && value.validUntil !== null;
    return (
      (value.observedAt === null) === (value.validUntil === null) &&
      (!dated || Date.parse(value.observedAt!) < Date.parse(value.validUntil!)) &&
      (value.availability === 'unknown' || dated) &&
      (value.referencePriceRial === null || dated) &&
      (!value.referencePriceCurrent ||
        (value.referencePriceRial !== null && dated && value.availability !== 'stale'))
    );
  });
export type MarketItem = z.infer<typeof marketItemSchema>;
export const marketPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    locale: z.enum(['fa', 'en']),
    items: z.array(marketItemSchema).max(24),
    total: z.number().int().nonnegative().max(2147483647),
    page: z.number().int().min(1).max(10000),
    pageSize: z.number().int().min(1).max(24),
    totalPages: z.number().int().nonnegative().max(2147483647),
    appliedAttributes: marketAttributeSelectionsSchema
      .refine((values) => values.length > 0)
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.items.length <= value.pageSize &&
      value.items.length <= value.total &&
      value.totalPages === Math.ceil(value.total / value.pageSize) &&
      (!value.items.length || value.page <= value.totalPages) &&
      unique(value.items.map((item) => item.id)) &&
      unique(value.items.map((item) => item.model.id)),
  );
export type MarketPage = z.infer<typeof marketPageSchema>;
export const marketInputSchema = z
  .object({
    query: z
      .string()
      .max(120)
      .refine(
        (value) =>
          // eslint-disable-next-line no-control-regex -- Reject forbidden control characters at the trust boundary.
          !/[\x00-\x08\x0e-\x1f\x7f]/.test(value) &&
          value.normalize('NFKC').trim().split(/\s+/).filter(Boolean).length <= 8,
      )
      .optional(),
    categoryId: marketIdSchema.optional(),
    brandId: marketIdSchema.optional(),
    page: z.number().int().min(1).max(10000).default(1),
    pageSize: z.number().int().min(1).max(24).default(12),
    attributes: marketAttributeSelectionsSchema.optional(),
  })
  .strict()
  .refine((value) => !value.attributes?.length || !!value.categoryId);
export type MarketQuery = z.infer<typeof marketInputSchema>;
const facetCount = z.number().int().min(1).max(2147483647);
export const marketFacetsSchema = z
  .object({
    schemaVersion: z.literal(1),
    locale: z.enum(['fa', 'en']),
    scope: marketScopeSchema,
    categories: z.array(z.object({ id: marketIdSchema, count: facetCount }).strict()).max(200),
    brands: z
      .array(
        z
          .object({ id: marketIdSchema, name: z.string().min(1).max(120), count: facetCount })
          .strict(),
      )
      .max(200),
    moreCategories: z.boolean(),
    moreBrands: z.boolean(),
  })
  .strict()
  .refine(
    (value) =>
      unique(value.categories.map((item) => item.id)) &&
      unique(value.brands.map((item) => item.id)) &&
      (!value.moreCategories || value.categories.length === 200) &&
      (!value.moreBrands || value.brands.length === 200),
  );
export type MarketFacets = z.infer<typeof marketFacetsSchema>;
export const normalizeMarketDigits = (value: string) =>
  value.replace(/[۰-۹٠-٩]/g, (char) => String(char.charCodeAt(0) - (char >= '۰' ? 0x6f0 : 0x660)));
export function marketQueryFromParams(params: URLSearchParams): MarketQuery {
  const allowed = ['q', 'category', 'brand', 'page', 'size'];
  if (params.toString().length > 6500) throw new Error('invalid_market_query');
  const attributes: { key: string; values: string[] }[] = [];
  for (const key of new Set(params.keys())) {
    if (key.startsWith('attr.')) {
      attributes.push({
        key: marketAttributeKeySchema.parse(key.slice(5)),
        values: params.getAll(key),
      });
    } else if (!allowed.includes(key) || params.getAll(key).length !== 1)
      throw new Error('invalid_market_query');
  }
  const number = (key: string, defaultValue: number) => {
    const value = params.get(key);
    if (value === null) return defaultValue;
    const normalized = normalizeMarketDigits(value);
    if (!/^[1-9][0-9]{0,4}$/.test(normalized)) throw new Error('invalid_market_query');
    return Number(normalized);
  };
  return marketInputSchema.parse({
    query: params.get('q') || undefined,
    categoryId: params.get('category') || undefined,
    brandId: params.get('brand') || undefined,
    page: number('page', 1),
    pageSize: number('size', 12),
    ...(attributes.length ? { attributes } : {}),
  });
}
export function marketQueryParams(query: MarketQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.query) params.set('q', query.query);
  if (query.categoryId) params.set('category', query.categoryId);
  if (query.brandId) params.set('brand', query.brandId);
  if (query.page !== 1) params.set('page', String(query.page));
  if (query.pageSize !== 12) params.set('size', String(query.pageSize));
  for (const attribute of query.attributes ?? [])
    for (const value of attribute.values) params.append('attr.' + attribute.key, value);
  return params;
}
export function marketHref(query: MarketQuery) {
  const params = marketQueryParams(query).toString();
  return '/market' + (params ? '?' + params : '');
}
export function marketFreshness(
  item: Pick<MarketItem, 'validUntil' | 'availability' | 'referencePriceCurrent'>,
  now: number,
) {
  const expired = item.validUntil !== null && Date.parse(item.validUntil) <= now;
  return {
    availability: expired ? ('stale' as const) : item.availability,
    priceCurrent: item.referencePriceCurrent && !expired,
  };
}

export const marketFiltersInputSchema = z.object({ categoryId: marketIdSchema }).strict();
export const marketFiltersSchema = z
  .object({
    schemaVersion: z.literal(1),
    locale: z.enum(['fa', 'en']),
    categoryId: marketIdSchema,
    filters: z
      .array(
        z
          .object({
            key: marketAttributeKeySchema,
            label: z.string().min(1).max(2000),
            dataType: z.enum(['text', 'number', 'bool', 'select', 'multiSelect']),
            unit: z.string().max(80).nullable(),
          })
          .strict(),
      )
      .max(64),
    moreFilters: z.boolean(),
    version: z.string().regex(/^[A-F0-9]{64}$/),
  })
  .strict()
  .refine(
    (value) =>
      unique(value.filters.map((item) => item.key)) &&
      (!value.moreFilters || value.filters.length === 64),
  );
export type MarketFilters = z.infer<typeof marketFiltersSchema>;
export const marketValuesInputSchema = z
  .object({
    search: marketInputSchema.refine((value) => !!value.categoryId),
    key: marketAttributeKeySchema,
    query: z
      .string()
      .max(100)
      .refine(
        (value) =>
          // eslint-disable-next-line no-control-regex -- Reject forbidden control characters at the trust boundary.
          !/[\x00-\x08\x0e-\x1f\x7f]/.test(value) &&
          value.normalize('NFKC').trim().split(/\s+/).filter(Boolean).length <= 8,
      )
      .optional(),
    page: z.number().int().min(1).max(10000).default(1),
    pageSize: z.number().int().min(1).max(40).default(20),
    selectedValues: z.array(attributeValue).max(20).refine(unique).optional(),
  })
  .strict();
export type MarketValuesQuery = z.infer<typeof marketValuesInputSchema>;
const countedValue = z
  .object({
    value: attributeValue,
    label: z.string().min(1).max(2000),
    count: z.number().int().min(0).max(2147483647),
  })
  .strict();
export const marketValuesSchema = z
  .object({
    schemaVersion: z.literal(1),
    locale: z.enum(['fa', 'en']),
    scope: marketScopeSchema,
    key: marketAttributeKeySchema,
    valueQuery: z.string().max(100),
    values: z.array(countedValue).max(40),
    selectedValues: z.array(countedValue).max(20),
    total: z.number().int().min(0).max(2147483647),
    page: z.number().int().min(1).max(10000),
    pageSize: z.number().int().min(1).max(40),
    totalPages: z.number().int().min(0).max(2147483647),
  })
  .strict()
  .refine(
    (value) =>
      value.scope.categoryId !== null &&
      unique(value.values.map((item) => item.value)) &&
      unique(value.selectedValues.map((item) => item.value)) &&
      value.values.length <= value.pageSize &&
      value.values.length <= value.total &&
      value.totalPages === Math.ceil(value.total / value.pageSize) &&
      (!value.values.length || value.page <= value.totalPages),
  );
export type MarketValues = z.infer<typeof marketValuesSchema>;
export function sameMarketAttributes(
  left: MarketQuery['attributes'],
  right: MarketQuery['attributes'],
) {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}
