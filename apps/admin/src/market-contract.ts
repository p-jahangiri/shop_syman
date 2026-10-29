import { z } from 'zod';
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const version = z.string().regex(/^[A-Za-z0-9+/]{11}=$/);
const hash = z.string().regex(/^[0-9A-F]{64}$/);
const uuid = z.string().uuid();
const optional = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? null);
const rial = z
  .string()
  .regex(/^\d{1,19}$/)
  .refine((value) => BigInt(value) > 0n && BigInt(value) <= 9223372036854775807n);
const status = z.enum(['Draft', 'Published', 'Hidden']);
export const marketDetailsSchema = z
  .object({
    status,
    sourceKey: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    sourceItemKey: z.string().min(1).max(120),
    sourceNameFa: z.string().min(1).max(200),
    sourceNameEn: z.string().min(1).max(200),
    sourceUrl: optional(z.string().max(1500)),
    availability: z.enum(['unknown', 'available', 'unavailable']),
    observedAt: optional(z.iso.datetime({ offset: true })),
    validUntil: optional(z.iso.datetime({ offset: true })),
    referencePriceRial: optional(rial),
    isDemo: z.boolean(),
  })
  .strict();
export const marketPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    pageSize: z.literal(50),
    items: z
      .array(
        z
          .object({
            id,
            modelId: id,
            nameFa: z.string(),
            nameEn: z.string(),
            status,
            sourceKey: z.string(),
            sourceItemKey: z.string(),
            isDemo: z.boolean(),
            version,
          })
          .strict(),
      )
      .max(50),
    nextCursor: optional(z.string().min(1).max(512)),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.items.map((item) => item.id.toLowerCase())).size === value.items.length,
  );
export const marketSavedSchema = z.object({ id }).strict();
export const marketDetailSchema = z
  .object({ schemaVersion: z.literal(1), id, modelId: id, details: marketDetailsSchema, version })
  .strict();
export const modelAttributeSchema = z
  .object({
    attributeId: id,
    textFa: optional(z.string()),
    textEn: optional(z.string()),
    number: optional(z.string().regex(/^-?\d+(?:\.\d{1,8})?$/)),
    bool: optional(z.boolean()),
    optionId: optional(id),
    optionIds: optional(z.array(id).max(500)),
  })
  .strict();
export const marketModelInputSchema = z
  .object({
    categoryId: id,
    brandId: id,
    slug: z.string().min(1).max(150),
    translations: z
      .array(
        z
          .object({
            locale: z.enum(['fa', 'en']),
            name: z.string().max(250),
            description: z.string().max(8000),
          })
          .strict(),
      )
      .length(2),
    attributes: z.array(modelAttributeSchema).max(500),
    imageUrls: z.array(z.string().max(1500)).max(24),
    version: optional(version),
  })
  .strict();
export const marketModelSchema = z
  .object({
    schemaVersion: z.literal(1),
    model: z
      .object({ input: marketModelInputSchema, storefrontStatus: status, hasOffers: z.boolean() })
      .strict(),
  })
  .strict();
export const expectedSchema = z
  .object({
    rowNumber: z.number().int().min(2).max(51),
    listingId: optional(id),
    listingVersion: optional(version),
    modelId: optional(id),
    modelVersion: optional(version),
    metadataFingerprint: hash,
  })
  .strict()
  .refine(
    (e) =>
      (e.listingId === null) === (e.listingVersion === null) &&
      (e.modelId === null) === (e.modelVersion === null) &&
      (!e.listingId || !!e.modelId),
  );
export const previewSchema = z
  .object({
    schemaVersion: z.literal(1),
    fileHash: hash,
    rows: z
      .array(
        z
          .object({
            rowNumber: z.number().int().min(2).max(51),
            operation: z.enum(['create', 'link', 'update', 'invalid']),
            nameFa: z.string(),
            nameEn: z.string(),
            sourceKey: z.string(),
            sourceItemKey: z.string(),
            status: z.string(),
            referencePriceRial: optional(z.string()),
            hasStorefrontOffers: z.boolean(),
            expected: optional(expectedSchema),
            issues: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    validRows: z.number().int().min(0).max(50),
    invalidRows: z.number().int().min(0).max(50),
    canCommit: z.boolean(),
  })
  .strict()
  .refine(
    (value) =>
      value.validRows + value.invalidRows === value.rows.length &&
      value.invalidRows === value.rows.filter((row) => row.issues.length > 0).length &&
      value.canCommit === (value.invalidRows === 0) &&
      new Set(value.rows.map((row) => row.rowNumber)).size === value.rows.length &&
      value.rows.every(
        (row) =>
          row.issues.length > 0 ||
          (row.expected?.rowNumber === row.rowNumber &&
            row.operation !== 'invalid' &&
            (!row.referencePriceRial || rial.safeParse(row.referencePriceRial).success)),
      ),
  );
export const importResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: uuid,
    payloadHash: hash,
    created: z.number().int().min(0).max(50),
    updated: z.number().int().min(0).max(50),
    rows: z
      .array(
        z
          .object({
            rowNumber: z.number().int().min(2).max(51),
            listingId: id,
            modelId: id,
            operation: z.enum(['create', 'link', 'update']),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    replayed: z.boolean(),
  })
  .strict()
  .refine(
    (value) =>
      value.created + value.updated === value.rows.length &&
      value.updated === value.rows.filter((row) => row.operation === 'update').length &&
      new Set(value.rows.map((row) => row.rowNumber)).size === value.rows.length &&
      new Set(value.rows.map((row) => row.listingId.toLowerCase())).size === value.rows.length &&
      new Set(value.rows.map((row) => row.modelId.toLowerCase())).size === value.rows.length,
  );
export type MarketDetails = z.infer<typeof marketDetailsSchema>;
export type MarketModelInput = z.infer<typeof marketModelInputSchema>;
export type ModelAttribute = z.infer<typeof modelAttributeSchema>;
export type ImportPreview = z.infer<typeof previewSchema>;
export type ImportResult = z.infer<typeof importResultSchema>;
export interface ImportCommand {
  csv: string;
  requestId: string;
  expected: z.infer<typeof expectedSchema>[];
}
export function readImportResult(
  raw: unknown,
  requestId: string,
  expected?: ImportCommand['expected'],
): ImportResult {
  const parsed = importResultSchema.parse(raw);
  if (parsed.requestId.toLowerCase() !== requestId.toLowerCase())
    throw new Error('رسید با شناسهٔ این درخواست مطابقت ندارد.');
  if (
    expected &&
    (parsed.rows.length !== expected.length ||
      parsed.rows.some((row) => {
        const previous = expected.find((item) => item.rowNumber === row.rowNumber);
        return (
          !previous ||
          (previous.listingId &&
            previous.listingId.toLowerCase() !== row.listingId.toLowerCase()) ||
          (previous.modelId && previous.modelId.toLowerCase() !== row.modelId.toLowerCase())
        );
      }))
  )
    throw new Error('ردیف‌های رسید با پیش‌نمایش مطابقت ندارند.');
  return parsed;
}
export const normalizeMarketDigits = (value: string) =>
  value.replace(/[۰-۹٠-٩]/g, (char) => String(char.charCodeAt(0) - (char >= '۰' ? 0x6f0 : 0x660)));
export function marketListPath(
  query: string,
  status: string,
  categoryId: string,
  cursor: string | null,
  brandId = '',
) {
  const params = new URLSearchParams();
  if (query) params.set('query', query);
  if (status !== 'all') params.set('status', status);
  if (categoryId) params.set('categoryId', categoryId);
  if (brandId) params.set('brandId', brandId);
  if (cursor) params.set('cursor', cursor);
  return '/admin/market' + (params.size ? '?' + params : '');
}
