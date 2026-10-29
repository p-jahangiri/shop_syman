import { z } from './schema-runtime.ts';
import { phoneConfigurationSnapshotSchema, phoneId } from './phone-discovery-contract.ts';
import { marketIdSchema } from './market-contract.ts';
const id = z
    .string()
    .regex(/^[a-f0-9]{32}$/)
    .refine((value) => value !== '0'.repeat(32)),
  version = z.string().regex(/^[A-Za-z0-9+/]{10}[AEIMQUYcgkosw048]=$/),
  fingerprint = z.string().regex(/^[A-F0-9]{64}$/),
  date = z.iso.datetime({ offset: true }),
  reference = z.string().regex(/^SR-[1-9][0-9]{0,18}$/);
const nullable = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? null);
const unique = (values: string[]) => new Set(values).size === values.length;
const rial = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .refine((value) => BigInt(value) <= 9223372036854775807n);
const image = z
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
const option = z
  .object({ id: marketIdSchema, labelFa: z.string().max(4000), labelEn: z.string().max(4000) })
  .strict();
export const sourcingAttributeSchema = z
  .object({
    attributeId: marketIdSchema,
    key: z.string().min(1).max(150),
    dataType: z.enum(['Text', 'Number', 'Bool', 'Select', 'MultiSelect']),
    labelFa: z.string().max(4000),
    labelEn: z.string().max(4000),
    unit: nullable(z.string().max(100)),
    unitFa: nullable(z.string().max(100)),
    unitEn: nullable(z.string().max(100)),
    textFa: nullable(z.string().max(8000)),
    textEn: nullable(z.string().max(8000)),
    number: nullable(z.string().regex(/^-?(?:0|[1-9][0-9]{0,19})(?:\.[0-9]{1,8})?$/)),
    bool: nullable(z.boolean()),
    options: z.array(option).max(64),
  })
  .strict()
  .refine(
    (value) =>
      unique(value.options.map((item) => item.id.toLowerCase())) &&
      {
        Text:
          value.textFa !== null &&
          value.textEn !== null &&
          value.number === null &&
          value.bool === null &&
          value.options.length === 0,
        Number:
          value.number !== null &&
          value.textFa === null &&
          value.textEn === null &&
          value.bool === null &&
          value.options.length === 0,
        Bool:
          value.bool !== null &&
          value.textFa === null &&
          value.textEn === null &&
          value.number === null &&
          value.options.length === 0,
        Select:
          value.textFa === null &&
          value.textEn === null &&
          value.number === null &&
          value.bool === null &&
          value.options.length === 1,
        MultiSelect:
          value.textFa === null &&
          value.textEn === null &&
          value.number === null &&
          value.bool === null &&
          value.options.length > 0,
      }[value.dataType],
  );
export const sourcingModelSchema = z
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
    images: z.array(image).min(1).max(24).refine(unique),
    version,
    fingerprint,
    hasAvailableStoreOffer: z.boolean(),
    attributes: z.array(sourcingAttributeSchema).max(64),
  })
  .strict()
  .refine(
    (value) =>
      unique(value.attributes.map((item) => item.key)) &&
      unique(value.attributes.map((item) => item.attributeId)),
  );
export type SourcingModel = z.infer<typeof sourcingModelSchema>;
export const sourcingCandidateSchema = z
  .object({
    listingId: marketIdSchema,
    configuration: phoneConfigurationSnapshotSchema.optional(),
    model: nullable(sourcingModelSchema),
    fingerprint: nullable(fingerprint),
    sourceNameFa: nullable(z.string().max(200)),
    sourceNameEn: nullable(z.string().max(200)),
    sourceUrl: nullable(sourceUrl),
    availability: nullable(z.enum(['unknown', 'available', 'unavailable', 'stale'])),
    observedAt: nullable(date),
    validUntil: nullable(date),
    referencePriceRial: rial.nullable(),
    referencePriceCurrent: z.boolean(),
    isDemo: z.boolean(),
    issue: nullable(z.string().regex(/^[a-z_]{1,100}$/)),
  })
  .strict()
  .refine(
    (value) =>
      (value.issue !== null ||
        (value.model !== null &&
          (!value.model.hasAvailableStoreOffer || !!value.configuration) &&
          value.fingerprint !== null &&
          !!value.sourceNameFa &&
          !!value.sourceNameEn &&
          value.availability !== null)) &&
      (!value.referencePriceCurrent ||
        (value.referencePriceRial !== null &&
          value.validUntil !== null &&
          value.availability !== 'stale')) &&
      (value.observedAt === null) === (value.validUntil === null) &&
      (!value.observedAt || Date.parse(value.observedAt) < Date.parse(value.validUntil!)) &&
      (value.availability === null ||
        value.availability === 'unknown' ||
        value.observedAt !== null) &&
      (value.referencePriceRial === null || value.observedAt !== null),
  );
export type SourcingCandidate = z.infer<typeof sourcingCandidateSchema>;
const selection = z
  .object({
    listingId: marketIdSchema,
    configurationId: phoneId.optional(),
    quantity: z.number().int().min(1).max(1000000),
  })
  .strict();
export const sourcingCartInputSchema = z
  .object({ version: nullable(version), lines: z.array(selection).max(24) })
  .strict()
  .refine((value) => unique(value.lines.map((line) => line.listingId)));
export type SourcingCartInput = z.infer<typeof sourcingCartInputSchema>;
export const sourcingCartSchema = z
  .object({
    schemaVersion: z.literal(1),
    locale: z.enum(['fa', 'en']),
    version: nullable(version),
    capacity: z.literal(24),
    requestOnly: z.literal(true),
    canPay: z.literal(false),
    lines: z.array(selection.extend({ candidate: sourcingCandidateSchema }).strict()).max(24),
    hasIssues: z.boolean(),
  })
  .strict()
  .refine(
    (value) =>
      unique(value.lines.map((line) => line.listingId)) &&
      value.lines.every(
        (line) =>
          line.listingId === line.candidate.listingId &&
          (!line.candidate.configuration
            ? line.configurationId === undefined || line.candidate.issue !== null
            : line.configurationId === line.candidate.configuration.id &&
              (!line.candidate.model ||
                line.candidate.configuration.modelId === line.candidate.model.id)),
      ) &&
      value.hasIssues === value.lines.some((line) => line.candidate.issue !== null),
  );
export type SourcingCart = z.infer<typeof sourcingCartSchema>;
const commandId = z.uuid().refine((value) => value !== '00000000-0000-0000-0000-000000000000');
export const sourcingSubmitSchema = z
  .object({
    requestId: commandId,
    cartVersion: version,
    expected: z
      .array(z.object({ listingId: marketIdSchema, fingerprint }).strict())
      .min(1)
      .max(24),
    note: nullable(z.string().trim().max(500)),
  })
  .strict()
  .refine((value) => unique(value.expected.map((item) => item.listingId)));
export type SourcingSubmit = z.infer<typeof sourcingSubmitSchema>;
export const sourcingCancelSchema = z.object({ requestId: commandId, version }).strict();
export type SourcingCancel = z.infer<typeof sourcingCancelSchema>;
export const sourcingStateSchema = z.enum(['Submitted', 'Reviewing', 'Unavailable', 'Cancelled']);
export const sourcingMutationSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    reference,
    state: sourcingStateSchema,
    version,
    eventId: z
      .string()
      .regex(/^[1-9][0-9]{0,18}$/)
      .refine((value) => BigInt(value) <= 9223372036854775807n),
    at: date,
    replayed: z.boolean(),
    requestOnly: z.literal(true),
    canPay: z.literal(false),
  })
  .strict();
export type SourcingMutation = z.infer<typeof sourcingMutationSchema>;
export const sourcingSummarySchema = z
  .object({
    id,
    reference,
    locale: z.enum(['fa', 'en']),
    state: sourcingStateSchema,
    createdAt: date,
    changedAt: date,
    itemCount: z.number().int().min(1).max(24000000),
    lineCount: z.number().int().min(1).max(24),
    version,
    isDemo: z.boolean(),
  })
  .strict()
  .refine(
    (value) =>
      Date.parse(value.changedAt) >= Date.parse(value.createdAt) &&
      value.itemCount >= value.lineCount,
  );
export const sourcingRequestPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    pageSize: z.literal(20),
    items: z.array(sourcingSummarySchema).max(20),
    nextCursor: nullable(z.string().regex(/^[A-Za-z0-9_-]{1,200}$/)),
  })
  .strict()
  .refine((value) => unique(value.items.map((item) => item.id)));
export type SourcingRequestPage = z.infer<typeof sourcingRequestPageSchema>;
export const sourcingRequestLineSchema = z
  .object({
    listingId: marketIdSchema,
    configuration: phoneConfigurationSnapshotSchema.optional(),
    quantity: z.number().int().min(1).max(1000000),
    model: sourcingModelSchema,
    sourceNameFa: z.string().min(1).max(200),
    sourceNameEn: z.string().min(1).max(200),
    sourceUrl: sourceUrl.nullable(),
    availability: z.enum(['unknown', 'available', 'unavailable', 'stale']),
    observedAt: date.nullable(),
    validUntil: date.nullable(),
    referencePriceRial: rial.nullable(),
    referencePriceCurrent: z.boolean(),
    isDemo: z.boolean(),
  })
  .strict()
  .refine(
    (value) =>
      (value.observedAt === null) === (value.validUntil === null) &&
      (!value.observedAt || Date.parse(value.observedAt) < Date.parse(value.validUntil!)) &&
      (value.referencePriceRial === null || value.observedAt !== null) &&
      (!value.referencePriceCurrent ||
        (value.referencePriceRial !== null &&
          value.validUntil !== null &&
          value.availability !== 'stale')) &&
      (!value.configuration || value.configuration.modelId === value.model.id),
  );
export const sourcingDetailSchema = z
  .object({
    schemaVersion: z.literal(1),
    summary: sourcingSummarySchema,
    note: nullable(z.string().max(500)),
    lines: z.array(sourcingRequestLineSchema).min(1).max(24),
    canCancel: z.boolean(),
    canReview: z.literal(false),
    canMarkUnavailable: z.literal(false),
    requestOnly: z.literal(true),
    canPay: z.literal(false),
  })
  .strict()
  .refine(
    (value) =>
      unique(value.lines.map((line) => line.listingId)) &&
      value.summary.lineCount === value.lines.length &&
      value.summary.itemCount === value.lines.reduce((sum, line) => sum + line.quantity, 0) &&
      value.canCancel === ['Submitted', 'Reviewing'].includes(value.summary.state),
  );
export type SourcingDetail = z.infer<typeof sourcingDetailSchema>;
export const sourcingEventSchema = z
  .object({
    id: z
      .string()
      .regex(/^[1-9][0-9]{0,18}$/)
      .refine((value) => BigInt(value) <= 9223372036854775807n),
    stateBefore: nullable(sourcingStateSchema),
    stateAfter: sourcingStateSchema,
    reasonCode: z.string().regex(/^[a-z_]{1,100}$/),
    publicMessage: nullable(z.string().max(2000)),
    at: date,
    actorKind: z.enum(['customer', 'staff', 'system']),
  })
  .strict()
  .refine((value) =>
    value.stateAfter === 'Submitted'
      ? value.stateBefore === null
      : value.stateAfter === 'Reviewing'
        ? value.stateBefore === 'Submitted'
        : value.stateBefore === 'Submitted' || value.stateBefore === 'Reviewing',
  );
export const sourcingEventsSchema = z
  .object({
    schemaVersion: z.literal(1),
    pageSize: z.literal(20),
    items: z.array(sourcingEventSchema).max(20),
    nextCursor: nullable(z.string().regex(/^[A-Za-z0-9_-]{1,200}$/)),
  })
  .strict()
  .refine((value) => unique(value.items.map((item) => item.id)));
export type SourcingEvents = z.infer<typeof sourcingEventsSchema>;
export const customerDetailSchema = sourcingDetailSchema;
export const sourcingEventPageSchema = sourcingEventsSchema;
export const sourcingPageSchema = sourcingRequestPageSchema;
export function sourcingAttributeText(
  attribute: z.infer<typeof sourcingAttributeSchema>,
  locale: 'fa' | 'en',
) {
  const localized = (fa: string | null, en: string | null) => (locale === 'fa' ? fa : en);
  let value =
    attribute.dataType === 'Text'
      ? localized(attribute.textFa, attribute.textEn)
      : attribute.dataType === 'Number'
        ? attribute.number
        : attribute.dataType === 'Bool'
          ? attribute.bool === null
            ? null
            : attribute.bool
              ? locale === 'fa'
                ? 'بله'
                : 'Yes'
              : locale === 'fa'
                ? 'خیر'
                : 'No'
          : attribute.options.length
            ? attribute.options
                .map((option) => localized(option.labelFa, option.labelEn))
                .join(locale === 'fa' ? '، ' : ', ')
            : null;
  if (value === null || value === '') return locale === 'fa' ? 'ثبت نشده' : 'Not recorded';
  if (attribute.dataType === 'Number' && locale === 'fa')
    value = value.replace(/[0-9]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]).replace('.', '٫');
  const unit = localized(attribute.unitFa, attribute.unitEn) ?? attribute.unit;
  return `${value}${unit ? ' ' + unit : ''}`;
}
