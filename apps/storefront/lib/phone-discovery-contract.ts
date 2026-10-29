import { z } from './schema-runtime.ts';
import { marketIdSchema, marketModelSchema, normalizeMarketDigits } from './market-contract.ts';
export const phoneId = z
  .string()
  .regex(/^[a-f0-9]{32}$/)
  .refine((value) => value !== '0'.repeat(32));
const version = z.string().regex(/^[A-Za-z0-9+/]{10}[AEIMQUYcgkosw048]=$/),
  colorKey = z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(64);
const image = z
  .string()
  .max(2048)
  .refine(
    (value) =>
      /^\/products\/[A-Za-z0-9/_-]+\.svg$/.test(value) ||
      /^\/media\/catalog\/[a-f0-9]{32}\/(thumb|card|zoom)\.webp$/.test(value) ||
      (() => {
        try {
          const u = new URL(value);
          return (
            u.protocol === 'https:' &&
            !u.username &&
            !u.password &&
            !u.search &&
            !u.hash &&
            !/[\\\s]/.test(value)
          );
        } catch {
          return false;
        }
      })(),
  );
const fields = {
  id: phoneId,
  ramGb: z.number().int().min(1).max(128),
  storageGb: z.number().int().min(1).max(32768),
  colorKey,
  colorNameFa: z.string().min(1).max(120),
  colorNameEn: z.string().min(1).max(120),
  colorHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable(),
  imageUrl: image.nullable(),
  version,
};
export const phoneConfigurationSnapshotSchema = z
  .object({
    ...fields,
    modelId: marketIdSchema,
    linkedVariantId: marketIdSchema.nullable(),
    fingerprint: z.string().regex(/^[A-F0-9]{64}$/),
  })
  .strict();
export type PhoneConfigurationSnapshot = z.infer<typeof phoneConfigurationSnapshotSchema>;
export const phoneChoiceSchema = z
  .object({
    ...fields,
    availableInStore: z.boolean(),
    storeSlug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(180)
      .nullable(),
    variantId: marketIdSchema.nullable(),
    canRequest: z.boolean(),
    canNotify: z.boolean(),
  })
  .strict()
  .refine((v) => !v.availableInStore || (!!v.storeSlug && !!v.variantId))
  .refine((v) => !(v.availableInStore && v.canRequest));
export const phoneItemSchema = z
  .object({
    id: marketIdSchema,
    model: marketModelSchema,
    isDemo: z.boolean(),
    specifications: z
      .array(
        z
          .object({
            key: z.string().min(1).max(150),
            label: z.string().min(1).max(4000),
            value: z.string().max(8000),
          })
          .strict(),
      )
      .max(64),
    configurations: z.array(phoneChoiceSchema).min(1).max(64),
  })
  .strict()
  .refine((v) => new Set(v.configurations.map((c) => c.id)).size === v.configurations.length);
export type PhoneItem = z.infer<typeof phoneItemSchema>;
export type PhoneChoice = z.infer<typeof phoneChoiceSchema>;
export const phoneSearchSchema = z
  .object({
    query: z
      .string()
      .max(120)
      .refine(
        // eslint-disable-next-line no-control-regex -- Reject forbidden control characters at the trust boundary.
        (v) => !/[\x00-\x1f\x7f]/.test(v) && v.trim().split(/\s+/).filter(Boolean).length <= 8,
      )
      .optional(),
    brandId: marketIdSchema.optional(),
    ramGb: z.number().int().min(1).max(128).optional(),
    storageGb: z.number().int().min(1).max(32768).optional(),
    colorKey: colorKey.optional(),
    page: z.number().int().min(1).max(10000).default(1),
    pageSize: z.number().int().min(1).max(24).default(12),
  })
  .strict();
export type PhoneSearch = z.infer<typeof phoneSearchSchema>;

// Derive card options from real configurations matching all current choices.
// Independent RAM/storage lists would imply combinations the model never had.
export function matchingPhoneChoices(
  choices: PhoneChoice[],
  query: Pick<PhoneSearch, 'ramGb' | 'storageGb' | 'colorKey'>,
): PhoneChoice[] {
  return choices.filter(
    (c) =>
      (!query.ramGb || c.ramGb === query.ramGb) &&
      (!query.storageGb || c.storageGb === query.storageGb) &&
      (!query.colorKey || c.colorKey === query.colorKey),
  );
}
const count = z.number().int().positive().max(2147483647),
  numberFacet = z.object({ value: z.number().int().positive().max(32768), count }).strict();
export const phonePageSchema = z
  .object({
    schemaVersion: z.literal(1),
    locale: z.enum(['fa', 'en']),
    items: z.array(phoneItemSchema).max(24),
    total: z.number().int().nonnegative().max(2147483647),
    page: z.number().int().min(1).max(10000),
    pageSize: z.number().int().min(1).max(24),
    totalPages: z.number().int().nonnegative().max(2147483647),
    facets: z
      .object({
        brands: z
          .array(
            z.object({ id: marketIdSchema, name: z.string().min(1).max(4000), count }).strict(),
          )
          .max(200),
        ramGb: z.array(numberFacet).max(200),
        storageGb: z.array(numberFacet).max(200),
        colors: z
          .array(
            z
              .object({
                key: colorKey,
                nameFa: z.string().min(1).max(120),
                nameEn: z.string().min(1).max(120),
                hex: z
                  .string()
                  .regex(/^#[0-9a-fA-F]{6}$/)
                  .nullable(),
                count,
              })
              .strict(),
          )
          .max(200),
        truncated: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .refine(
    (v) =>
      v.items.length <= v.pageSize &&
      v.items.length <= v.total &&
      v.totalPages === Math.ceil(v.total / v.pageSize) &&
      new Set(v.items.map((i) => i.id)).size === v.items.length,
  );
export type PhonePage = z.infer<typeof phonePageSchema>;
export const phoneCommandId = z.uuid().refine((v) => v !== '00000000-0000-0000-0000-000000000000');
export const phoneInterestInputSchema = z
  .object({ configurationId: phoneId, active: z.boolean(), version: version.nullable() })
  .strict();
export const phoneInterestSchema = z
  .object({
    id: phoneId,
    listingId: marketIdSchema,
    modelNameFa: z.string().min(1).max(250),
    modelNameEn: z.string().min(1).max(250),
    configuration: phoneConfigurationSnapshotSchema,
    state: z.enum(['Active', 'Cancelled', 'Notified']),
    generation: z.number().int().positive(),
    version,
    createdAt: z.iso.datetime({ offset: true }),
    changedAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine((v) => Date.parse(v.changedAt) >= Date.parse(v.createdAt));
export type PhoneInterest = z.infer<typeof phoneInterestSchema>;
export const phoneInterestPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    items: z.array(phoneInterestSchema).max(50),
    nextCursor: phoneId.nullable(),
  })
  .strict();
export const phoneInterestResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: phoneCommandId,
    interest: phoneInterestSchema,
    replayed: z.boolean(),
    canPay: z.literal(false),
  })
  .strict();
export function phoneQueryFromParams(p: URLSearchParams): PhoneSearch {
  if (
    p.toString().length > 2048 ||
    [...p.keys()].some(
      (k) =>
        !['q', 'brand', 'ram', 'storage', 'color', 'page', 'size'].includes(k) ||
        p.getAll(k).length !== 1,
    )
  )
    throw Error('invalid_phone_query');
  const n = (key: string) => {
    const raw = p.get(key);
    if (raw === null) return undefined;
    const value = normalizeMarketDigits(raw);
    if (!/^[1-9][0-9]{0,4}$/.test(value)) throw Error('invalid_phone_query');
    return Number(value);
  };
  return phoneSearchSchema.parse({
    query: p.get('q') || undefined,
    brandId: p.get('brand') || undefined,
    ramGb: n('ram'),
    storageGb: n('storage'),
    colorKey: p.get('color') || undefined,
    page: n('page'),
    pageSize: n('size'),
  });
}
export function phoneQueryParams(q: PhoneSearch) {
  const p = new URLSearchParams();
  if (q.query) p.set('q', q.query);
  if (q.brandId) p.set('brand', q.brandId);
  if (q.ramGb) p.set('ram', String(q.ramGb));
  if (q.storageGb) p.set('storage', String(q.storageGb));
  if (q.colorKey) p.set('color', q.colorKey);
  if (q.page !== 1) p.set('page', String(q.page));
  if (q.pageSize !== 12) p.set('size', String(q.pageSize));
  return p;
}
export function phoneHref(q: PhoneSearch) {
  const p = phoneQueryParams(q).toString();
  return '/market' + (p ? '?' + p : '');
}
