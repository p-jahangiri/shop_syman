import { z } from './schema-runtime.ts';
import { creditApplicationSummarySchema } from './credit-application-contract.ts';
const id = z
    .string()
    .regex(/^[a-f0-9]{32}$/)
    .refine((x) => !/^0+$/.test(x)),
  version = z.string().regex(/^[A-Za-z0-9+/]{10}[AEIMQUYcgkosw048]=$/),
  key = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const at = z
  .string()
  .datetime({ offset: true })
  .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/);
const text = (maximum: number, empty = false) =>
  z
    .string()
    .max(maximum)
    .refine(
      (x) =>
        (empty || x.trim().length > 0) &&
        x === x.trim() &&
        // eslint-disable-next-line no-control-regex -- Reject forbidden control characters at the trust boundary.
        !/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(x),
    );
export const creditDocumentContentTypes = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
export const creditDocumentRequirementSchema = z
  .object({
    key,
    nameFa: text(120),
    nameEn: text(120),
    helpFa: text(300, true),
    helpEn: text(300, true),
    required: z.boolean(),
    maxBytes: z.number().int().min(1).max(8388608),
    contentTypes: z
      .array(z.enum(creditDocumentContentTypes))
      .min(1)
      .max(4)
      .refine((x) => new Set(x).size === x.length),
  })
  .strict();
export const creditRequirementsContentSchema = z
  .object({
    titleFa: text(160),
    titleEn: text(160),
    termsFa: text(4000),
    termsEn: text(4000),
    consentLabelFa: text(500),
    consentLabelEn: text(500),
    enabled: z.boolean(),
    documents: z.array(creditDocumentRequirementSchema).max(12),
  })
  .strict()
  .refine((x) => new Set(x.documents.map((d) => d.key)).size === x.documents.length);
export const creditRequirementsRevisionSchema = z
  .object({ id, createdAt: at, content: creditRequirementsContentSchema })
  .strict();
export const creditRequirementsCurrentSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: version.nullable(),
    published: creditRequirementsRevisionSchema.nullable(),
  })
  .strict()
  .refine((x) => (x.version === null) === (x.published === null));
const summary = z
  .object({
    id,
    createdAt: at,
    titleFa: text(160),
    titleEn: text(160),
    enabled: z.boolean(),
    documentCount: z.number().int().min(0).max(12),
  })
  .strict();
export const creditRequirementsHistorySchema = z
  .object({
    schemaVersion: z.literal(1),
    items: z.array(summary).max(50),
    nextCursor: z
      .string()
      .min(1)
      .max(180)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/)
      .nullable(),
  })
  .strict()
  .refine(
    (x) =>
      new Set(x.items.map((i) => i.id)).size === x.items.length &&
      (x.nextCursor === null || x.items.length === 50),
  );
export const publishCreditRequirementsSchema = z
  .object({ version: version.nullable(), content: creditRequirementsContentSchema })
  .strict();
export const acceptCreditRequirementsSchema = z
  .object({
    applicationVersion: version,
    requirementsRevisionId: id,
    requirementsVersion: version,
    locale: z.enum(['fa', 'en']),
    accepted: z.literal(true),
  })
  .strict();
export const creditRequirementsConsentSchema = z
  .object({
    id,
    locale: z.enum(['fa', 'en']),
    acceptedAt: at,
    requirements: creditRequirementsRevisionSchema,
  })
  .strict()
  .refine((x) => Date.parse(x.acceptedAt) >= Date.parse(x.requirements.createdAt));
export const creditCaseRequirementsSchema = z
  .object({
    schemaVersion: z.literal(1),
    application: creditApplicationSummarySchema,
    current: creditRequirementsCurrentSchema,
    consent: creditRequirementsConsentSchema.nullable(),
    canConsent: z.boolean(),
  })
  .strict()
  .refine(
    (x) =>
      x.canConsent ===
        (x.application.state === 'Draft' &&
          x.current.published?.content.enabled === true &&
          x.consent?.requirements.id !== x.current.published.id) &&
      (x.consent === null ||
        (x.current.published !== null &&
          Date.parse(x.consent.acceptedAt) >= Date.parse(x.application.createdAt) &&
          Date.parse(x.consent.acceptedAt) <= Date.parse(x.application.changedAt))),
  );
export const publishCreditRequirementsResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    replayed: z.boolean(),
    commandId: id,
    current: creditRequirementsCurrentSchema,
  })
  .strict()
  .refine((x) => x.current.version !== null && x.current.published !== null);
export const acceptCreditRequirementsResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    replayed: z.boolean(),
    commandId: id,
    application: creditApplicationSummarySchema,
    consent: creditRequirementsConsentSchema,
  })
  .strict()
  .refine(
    (x) =>
      x.application.state === 'Draft' &&
      x.application.changedAt === x.consent.acceptedAt &&
      Date.parse(x.application.createdAt) <= Date.parse(x.consent.acceptedAt),
  );
export type CreditRequirementsContent = z.infer<typeof creditRequirementsContentSchema>;
export type CreditRequirementsCurrent = z.infer<typeof creditRequirementsCurrentSchema>;
export type CreditRequirementsRevision = z.infer<typeof creditRequirementsRevisionSchema>;
export type CreditRequirementsHistory = z.infer<typeof creditRequirementsHistorySchema>;
export type CreditCaseRequirements = z.infer<typeof creditCaseRequirementsSchema>;
export type CreditRequirementsCommand =
  | { kind: 'publish'; id: string; body: z.infer<typeof publishCreditRequirementsSchema> }
  | {
      kind: 'consent';
      id: string;
      applicationId: string;
      body: z.infer<typeof acceptCreditRequirementsSchema>;
    };
export type CreditRequirementsResult =
  | z.infer<typeof publishCreditRequirementsResultSchema>
  | z.infer<typeof acceptCreditRequirementsResultSchema>;
export function canonicalCreditRequirements(
  value: CreditRequirementsContent,
): CreditRequirementsContent {
  const parsed = creditRequirementsContentSchema.parse(value);
  return {
    ...parsed,
    documents: parsed.documents.map((d) => ({
      ...d,
      contentTypes: [...d.contentTypes].sort(
        (a, b) => creditDocumentContentTypes.indexOf(a) - creditDocumentContentTypes.indexOf(b),
      ),
    })),
  };
}
export function creditRequirementsCommandPath(command: CreditRequirementsCommand) {
  id.parse(command.id);
  return command.kind === 'publish'
    ? '/api/admin/credit/requirements/commands/' + command.id
    : '/api/credit/applications/' + id.parse(command.applicationId) + '/consents/' + command.id;
}
export function readCreditRequirementsResult(
  raw: unknown,
  command: CreditRequirementsCommand,
): CreditRequirementsResult {
  if (command.kind === 'publish') {
    const r = publishCreditRequirementsResultSchema.parse(raw);
    if (
      r.commandId !== command.id ||
      !r.current.published ||
      r.current.version === command.body.version ||
      JSON.stringify(r.current.published.content) !==
        JSON.stringify(canonicalCreditRequirements(command.body.content))
    )
      throw Error('Requirements receipt does not match the frozen publication');
    return r;
  }
  const r = acceptCreditRequirementsResultSchema.parse(raw);
  if (
    r.commandId !== command.id ||
    r.application.id !== command.applicationId ||
    r.application.version === command.body.applicationVersion ||
    r.consent.locale !== command.body.locale ||
    r.consent.requirements.id !== command.body.requirementsRevisionId
  )
    throw Error('Consent receipt does not match the frozen application and revision');
  return r;
}
export function readCreditCaseRequirements(raw: unknown, applicationId: string) {
  const r = creditCaseRequirementsSchema.parse(raw);
  if (r.application.id !== id.parse(applicationId)) throw Error('Wrong private credit case');
  return r;
}
