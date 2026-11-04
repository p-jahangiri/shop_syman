import { z } from '../config/schema-runtime.ts';
import { marketIdSchema } from './market-contract.ts';
import { sourcingAttributeSchema, sourcingAttributeText } from './sourcing-contract.ts';

export { sourcingAttributeText };
export const offerIdSchema = z
  .string()
  .regex(/^[a-f0-9]{32}$/)
  .refine((value) => value !== '0'.repeat(32));
export const offerCommandIdSchema = z
  .string()
  .regex(/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/)
  .refine((value) => value.replaceAll('-', '') !== '0'.repeat(32));
export const offerVersionSchema = z.string().regex(/^[A-Za-z0-9+/]{10}[AEIMQUYcgkosw048]=$/);
export const offerFingerprintSchema = z.string().regex(/^[A-F0-9]{64}$/);
function money(value: string): bigint | null {
  if (!/^(?:0|[1-9][0-9]{0,18})$/.test(value)) return null;
  const amount = BigInt(value);
  return amount <= 9223372036854775807n ? amount : null;
}
export const offerRialSchema = z.string().refine((value) => money(value) !== null);
const positiveInt64 = z
  .string()
  .refine((value) => /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n);
const unique = (items: string[]) => new Set(items).size === items.length;
const date = z.iso.datetime({ offset: true });
const utc = date.refine((value) => /(?:Z|\+00:00)$/.test(value));
const cursor = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const reference = z.string().regex(/^SR-[1-9][0-9]{0,18}$/);
const text = (max: number, required = false) =>
  z
    .string()
    .transform((value) => value.replace(/\r\n?/g, '\n').normalize('NFKC').trim())
    .pipe(
      z
        .string()
        .max(max)
        .refine(
          (value) => (!required || value.length > 0) && !/\p{Cc}/u.test(value.replaceAll('\n', '')),
        ),
    );
const publicImage = z
  .string()
  .max(2048)
  .refine(
    (value) =>
      /^\/products\/[A-Za-z0-9/_-]+\.svg$/.test(value) ||
      /^\/media\/catalog\/[a-f0-9]{32}\/(thumb|card|zoom)\.webp$/.test(value) ||
      (() => {
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
      })(),
  );
const optional = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? null);
export const offerAttributeSchema = sourcingAttributeSchema.safeExtend({
  unit: optional(z.string().max(80)),
  unitFa: optional(z.string().max(2000)),
  unitEn: optional(z.string().max(2000)),
});
const attrs = z
  .array(offerAttributeSchema)
  .max(64)
  .refine(
    (value) =>
      unique(value.map((item) => item.attributeId)) && unique(value.map((item) => item.key)),
  );
const identifiers = z.array(marketIdSchema).max(64).refine(unique);
export const offerModelSchema = z
  .object({
    id: marketIdSchema,
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(180),
    categoryId: marketIdSchema,
    categoryNameFa: z.string().max(4000),
    categoryNameEn: z.string().max(4000),
    brandId: marketIdSchema,
    brand: z.string().max(4000),
    nameFa: z.string().min(1).max(4000),
    nameEn: z.string().min(1).max(4000),
    descriptionFa: z.string().max(16000),
    descriptionEn: z.string().max(16000),
    images: z.array(publicImage).min(1).max(24).refine(unique),
    attributes: attrs,
  })
  .strict();
export const offerSkuSchema = z
  .object({
    variantId: marketIdSchema,
    productId: marketIdSchema,
    sellerId: marketIdSchema,
    sku: z.string().min(1).max(80),
    model: offerModelSchema,
    labelFa: z.string().max(2000),
    labelEn: z.string().max(2000),
    color: z.string().max(2000),
    colorNameFa: z.string().max(2000),
    colorNameEn: z.string().max(2000),
    warrantyFa: z.string().max(2000),
    warrantyEn: z.string().max(2000),
    attributes: attrs,
    productMethodIds: identifiers,
    variantMethodIds: identifiers.nullable(),
    chequePlanIds: identifiers,
    publicPriceRial: offerRialSchema,
    version: offerVersionSchema,
    currentFingerprint: offerFingerprintSchema,
    materialFingerprint: offerFingerprintSchema,
  })
  .strict()
  .refine((value) => value.productId === value.model.id);
export const offerStateSchema = z.enum([
  'Draft',
  'Published',
  'Withdrawn',
  'Accepted',
  'Declined',
  'Superseded',
]);
export const offerEffectiveStateSchema = z.enum([
  'Draft',
  'Published',
  'Withdrawn',
  'Accepted',
  'Declined',
  'Superseded',
  'Expired',
]);
export const offerSummarySchema = z
  .object({
    id: offerIdSchema,
    revision: z.number().int().min(1).max(2147483647),
    state: offerStateSchema,
    effectiveState: offerEffectiveStateSchema,
    version: offerVersionSchema,
    termsHash: offerFingerprintSchema,
    totalRial: offerRialSchema,
    lineCount: z.number().int().min(1).max(64),
    itemCount: z.number().int().min(1).max(64000000),
    acceptUntil: date,
    purchaseUntil: date,
    expectedAt: date.nullable(),
    createdAt: date,
    changedAt: date,
    publishedAt: date.nullable(),
    acceptedAt: date.nullable(),
    isDemo: z.boolean(),
  })
  .strict()
  .refine(
    (value) =>
      (value.effectiveState === value.state ||
        (value.effectiveState === 'Expired' && ['Published', 'Accepted'].includes(value.state))) &&
      Date.parse(value.purchaseUntil) >= Date.parse(value.acceptUntil) &&
      Date.parse(value.changedAt) >= Date.parse(value.createdAt) &&
      value.itemCount >= value.lineCount,
  );
export const offerLineSchema = z
  .object({
    lineId: offerIdSchema,
    listingId: offerIdSchema,
    quantity: z.number().int().min(1).max(1000000),
    unitPriceRial: offerRialSchema,
    lineTotalRial: offerRialSchema,
    sku: offerSkuSchema,
  })
  .strict()
  .refine((value) => {
    const unit = money(value.unitPriceRial),
      total = money(value.lineTotalRial);
    return (
      unit !== null &&
      total !== null &&
      Number.isSafeInteger(value.quantity) &&
      unit * BigInt(value.quantity) === total
    );
  });
export const offerDataSchema = z
  .object({
    summary: offerSummarySchema,
    termsFa: z.string().min(1).max(4000),
    termsEn: z.string().min(1).max(4000),
    acceptanceId: offerIdSchema.nullable(),
    lines: z.array(offerLineSchema).min(1).max(64),
  })
  .strict()
  .refine(
    (value) =>
      value.summary.lineCount === value.lines.length &&
      value.summary.itemCount === value.lines.reduce((sum, line) => sum + line.quantity, 0) &&
      value.lines.every((line) => money(line.lineTotalRial) !== null) &&
      money(value.summary.totalRial) ===
        value.lines.reduce((sum, line) => sum + (money(line.lineTotalRial) ?? 0n), 0n) &&
      unique(value.lines.map((line) => line.lineId)) &&
      unique(value.lines.map((line) => line.listingId + ':' + line.sku.variantId)),
  );
const detailFields = {
  schemaVersion: z.literal(1),
  requestId: offerIdSchema,
  requestReference: reference,
  requestVersion: offerVersionSchema,
  offer: offerDataSchema,
  canEditDraft: z.boolean(),
  canPublish: z.boolean(),
  canWithdraw: z.boolean(),
  canAccept: z.boolean(),
  canDecline: z.boolean(),
  canCancelRequest: z.boolean(),
  canMarkRequestUnavailable: z.boolean(),
  blockers: z
    .array(z.string().regex(/^[a-z_]{1,100}$/))
    .max(64)
    .refine(unique),
  consentOnly: z.literal(true),
  canPay: z.literal(false),
};
export const offerDetailSchema = z
  .object({
    ...detailFields,
    canEditDraft: z.literal(false),
    canPublish: z.literal(false),
    canWithdraw: z.literal(false),
    canMarkRequestUnavailable: z.literal(false),
  })
  .strict()
  .refine((value) => value.offer.summary.publishedAt !== null);
export const offerAdminDetailSchema = z
  .object({
    ...detailFields,
    canAccept: z.literal(false),
    canDecline: z.literal(false),
    canCancelRequest: z.literal(false),
  })
  .strict();
const pageFields = {
  schemaVersion: z.literal(1),
  requestId: offerIdSchema,
  requestReference: reference,
  requestVersion: offerVersionSchema,
  items: z.array(offerSummarySchema),
  nextCursor: cursor.nullable(),
  canCancelRequest: z.boolean(),
  canMarkRequestUnavailable: z.boolean(),
  consentOnly: z.literal(true),
  canPay: z.literal(false),
};
export const offerPageSchema = z
  .object({
    ...pageFields,
    pageSize: z.literal(20),
    items: z.array(offerSummarySchema).max(20),
    canMarkRequestUnavailable: z.literal(false),
  })
  .strict()
  .refine(
    (value) =>
      unique(value.items.map((item) => item.id)) &&
      value.items.every((item) => item.state !== 'Draft' && item.publishedAt !== null),
  );
export const offerAdminPageSchema = z
  .object({
    ...pageFields,
    pageSize: z.literal(50),
    items: z.array(offerSummarySchema).max(50),
    canCancelRequest: z.literal(false),
  })
  .strict()
  .refine((value) => unique(value.items.map((item) => item.id)));
export const offerOperationSchema = z.enum(['save', 'publish', 'withdraw', 'accept', 'decline']);
export const offerMutationSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: offerIdSchema,
    offerId: offerIdSchema,
    operation: offerOperationSchema,
    revision: z.number().int().min(1).max(2147483647),
    state: offerStateSchema,
    version: offerVersionSchema,
    requestVersion: offerVersionSchema,
    eventId: positiveInt64,
    acceptanceId: offerIdSchema.nullable(),
    at: date,
    replayed: z.boolean(),
    consentOnly: z.literal(true),
    canPay: z.literal(false),
  })
  .strict()
  .refine(
    (value) =>
      value.state ===
        (
          {
            save: 'Draft',
            publish: 'Published',
            withdraw: 'Withdrawn',
            accept: 'Accepted',
            decline: 'Declined',
          } as const
        )[value.operation] && (value.operation === 'accept') === (value.acceptanceId !== null),
  );
const event = z
  .object({
    id: positiveInt64,
    revision: z.number().int().min(1).max(2147483647),
    stateBefore: offerStateSchema.nullable(),
    stateAfter: offerStateSchema,
    actorKind: z.enum(['customer', 'staff', 'system']),
    reasonCode: z.string().regex(/^[a-z_]{1,100}$/),
    publicMessage: z.string().max(500),
    at: date,
  })
  .strict();
export const offerEventsSchema = z
  .object({
    schemaVersion: z.literal(1),
    pageSize: z.literal(20),
    items: z.array(event).max(20),
    nextCursor: cursor.nullable(),
  })
  .strict()
  .refine((value) => unique(value.items.map((item) => item.id)));
export const offerAdminEventsSchema = z
  .object({
    schemaVersion: z.literal(1),
    pageSize: z.literal(50),
    items: z.array(event).max(50),
    nextCursor: cursor.nullable(),
  })
  .strict()
  .refine((value) => unique(value.items.map((item) => item.id)));
export const offerActionSchema = z
  .object({
    requestId: offerCommandIdSchema,
    requestVersion: offerVersionSchema,
    version: offerVersionSchema,
    termsHash: offerFingerprintSchema,
  })
  .strict();
export const offerPublishSchema = offerActionSchema
  .extend({
    supersedesOfferId: offerIdSchema.nullish().transform((value) => value ?? null),
    supersedesVersion: offerVersionSchema.nullish().transform((value) => value ?? null),
  })
  .strict()
  .refine((value) => (value.supersedesOfferId === null) === (value.supersedesVersion === null));
export const offerSaveLineSchema = z
  .object({
    lineId: offerIdSchema,
    listingId: offerIdSchema,
    variantId: marketIdSchema,
    quantity: z.number().int().min(1).max(1000000),
    unitPriceRial: offerRialSchema,
    materialFingerprint: offerFingerprintSchema,
    currentFingerprint: offerFingerprintSchema,
  })
  .strict();
export const offerSaveSchema = z
  .object({
    requestId: offerCommandIdSchema,
    requestVersion: offerVersionSchema,
    version: offerVersionSchema.nullable(),
    lines: z.array(offerSaveLineSchema).min(1).max(64),
    termsFa: text(4000, true),
    termsEn: text(4000, true),
    acceptUntil: utc,
    purchaseUntil: utc,
    expectedAt: utc.nullish().transform((value) => value ?? null),
  })
  .strict()
  .refine(
    (value) =>
      Date.parse(value.purchaseUntil) >= Date.parse(value.acceptUntil) &&
      unique(value.lines.map((item) => item.lineId)) &&
      unique(value.lines.map((item) => item.listingId + ':' + item.variantId)) &&
      value.lines.every(
        (line) => money(line.unitPriceRial) !== null && Number.isSafeInteger(line.quantity),
      ) &&
      value.lines.reduce(
        (sum, line) => sum + (money(line.unitPriceRial) ?? 0n) * BigInt(line.quantity),
        0n,
      ) <= 9223372036854775807n,
  );
export type OfferDetail = z.infer<typeof offerDetailSchema>;
export type OfferPage = z.infer<typeof offerPageSchema>;
export type OfferMutation = z.infer<typeof offerMutationSchema>;
export type OfferAction = z.infer<typeof offerActionSchema>;
export type OfferSave = z.infer<typeof offerSaveSchema>;
export type OfferPublish = z.infer<typeof offerPublishSchema>;
export type OfferEvents = z.infer<typeof offerEventsSchema>;
export function offerMutationMatches(
  value: OfferMutation,
  requestId: string,
  offerId: string,
  operation: z.infer<typeof offerOperationSchema>,
) {
  return (
    value.requestId === requestId && value.offerId === offerId && value.operation === operation
  );
}
