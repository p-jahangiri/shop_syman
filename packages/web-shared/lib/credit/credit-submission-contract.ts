import { z } from '../config/schema-runtime.ts';
import {
  creditApplicationSummarySchema,
  creditApplicationPlanSchema,
} from './credit-application-contract.ts';
import { creditRequirementsConsentSchema } from './credit-requirements-contract.ts';
import { privateFileMetadataSchema } from '../support/ticket-file-contract.ts';
const id = z
    .string()
    .regex(/^[a-f0-9]{32}$/)
    .refine((x) => !/^0+$/.test(x)),
  version = z.string().regex(/^[A-Za-z0-9+/]{10}[AEIMQUYcgkosw048]=$/),
  key = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  at = z
    .string()
    .datetime({ offset: true })
    .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/);
const note = z
  .string()
  .max(2000)
  .refine(
    (x) =>
      x === x.trim() &&
      // eslint-disable-next-line no-control-regex -- Reject forbidden control characters at the trust boundary.
      !/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(x) &&
      !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(x),
  );
export const creditSubmissionBodySchema = z
  .object({
    applicationVersion: version,
    consentId: id,
    requirementsRevisionId: id,
    requirementsVersion: version,
    locale: z.enum(['fa', 'en']),
    note,
    reviewRequested: z.literal(true),
  })
  .strict();
export const creditSubmissionCommandSchema = z
  .object({ id, applicationId: id, body: creditSubmissionBodySchema })
  .strict();
export const creditSubmissionSummarySchema = z
  .object({
    id,
    consentId: id,
    requirementsRevisionId: id,
    locale: z.enum(['fa', 'en']),
    documentCount: z.number().int().min(0).max(12),
    submittedAt: at,
  })
  .strict();
const blocker = z.enum([
  'application_cancelled',
  'application_submitted',
  'application_approved',
  'application_declined',
  'credit_requirements_unavailable',
  'credit_current_consent_required',
  'credit_plan_changed',
  'credit_required_documents_missing',
  'private_file_unavailable',
  'credit_submission_capacity',
]);
export const creditSubmissionCapabilitiesSchema = z
  .object({
    schemaVersion: z.literal(1),
    application: creditApplicationSummarySchema,
    consentId: id.nullable(),
    requirementsRevisionId: id.nullable(),
    requirementsVersion: version.nullable(),
    canSubmit: z.boolean(),
    canWithdraw: z.boolean(),
    requiredDocumentCount: z.number().int().min(0).max(12),
    selectedDocumentCount: z.number().int().min(0).max(12),
    missingDocumentKeys: z.array(key).max(12),
    blockers: z.array(blocker).max(10),
    latestSubmission: creditSubmissionSummarySchema.nullable(),
  })
  .strict()
  .refine(
    (x) =>
      new Set(x.blockers).size === x.blockers.length &&
      new Set(x.missingDocumentKeys).size === x.missingDocumentKeys.length &&
      x.missingDocumentKeys.length <= x.requiredDocumentCount &&
      x.blockers.includes('credit_required_documents_missing') ===
        x.missingDocumentKeys.length > 0 &&
      x.blockers.includes('application_submitted') === (x.application.state === 'Submitted') &&
      x.blockers.includes('application_cancelled') === (x.application.state === 'Cancelled') &&
      x.blockers.includes('application_approved') === (x.application.state === 'Approved') &&
      x.blockers.includes('application_declined') === (x.application.state === 'Declined') &&
      (x.requirementsRevisionId === null) === (x.requirementsVersion === null) &&
      (!x.canSubmit || x.blockers.length === 0) &&
      (!x.canWithdraw || x.application.state === 'Submitted') &&
      (x.application.state !== 'Submitted' || x.latestSubmission !== null) &&
      (!x.latestSubmission ||
        (Date.parse(x.latestSubmission.submittedAt) >= Date.parse(x.application.createdAt) &&
          Date.parse(x.latestSubmission.submittedAt) <= Date.parse(x.application.changedAt))),
  );
export const creditSubmissionPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    applicationId: id,
    items: z.array(creditSubmissionSummarySchema).max(20),
    nextCursor: z.null(),
  })
  .strict()
  .refine((x) => new Set(x.items.map((i) => i.id)).size === x.items.length);
export const creditSubmissionDetailSchema = z
  .object({
    schemaVersion: z.literal(1),
    application: creditApplicationSummarySchema,
    submission: creditSubmissionSummarySchema,
    plan: creditApplicationPlanSchema,
    consent: creditRequirementsConsentSchema,
    note,
    documents: z
      .array(
        z
          .object({
            documentKey: key,
            attachmentId: id,
            required: z.boolean(),
            file: privateFileMetadataSchema,
          })
          .strict(),
      )
      .max(12),
  })
  .strict()
  .refine(
    (x) =>
      x.application.planId === x.plan.id &&
      x.submission.consentId === x.consent.id &&
      x.submission.requirementsRevisionId === x.consent.requirements.id &&
      Date.parse(x.submission.submittedAt) >= Date.parse(x.consent.acceptedAt) &&
      Date.parse(x.submission.submittedAt) <= Date.parse(x.application.changedAt) &&
      x.documents.length === x.submission.documentCount &&
      new Set(x.documents.map((d) => d.documentKey)).size === x.documents.length &&
      new Set(x.documents.map((d) => d.attachmentId)).size === x.documents.length &&
      x.documents.every((d) => {
        const def = x.consent.requirements.content.documents.find((i) => i.key === d.documentKey);
        return (
          !!def &&
          def.required === d.required &&
          def.maxBytes >= d.file.bytes &&
          def.contentTypes.includes(d.file.contentType)
        );
      }) &&
      x.consent.requirements.content.documents.every(
        (d) => !d.required || x.documents.some((i) => i.documentKey === d.key),
      ),
  );
export const creditSubmissionResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    replayed: z.boolean(),
    commandId: id,
    application: creditApplicationSummarySchema,
    submission: creditSubmissionSummarySchema,
    note,
  })
  .strict()
  .refine(
    (x) =>
      x.application.state === 'Submitted' && x.application.changedAt === x.submission.submittedAt,
  );
export type CreditSubmissionCommand = z.infer<typeof creditSubmissionCommandSchema>;
export type CreditSubmissionResult = z.infer<typeof creditSubmissionResultSchema>;
export type CreditSubmissionCapabilities = z.infer<typeof creditSubmissionCapabilitiesSchema>;
export type CreditSubmissionDetail = z.infer<typeof creditSubmissionDetailSchema>;
export type CreditSubmissionPage = z.infer<typeof creditSubmissionPageSchema>;
export function isCreditSubmissionPath(value: string, method = 'GET', staff = false) {
  const base = staff ? '/api/admin/credit/' : '/api/credit/',
    i = '[a-f0-9]{32}';
  if (
    !value.startsWith(base) ||
    value.includes('?') ||
    value.includes('#') ||
    /(?:^|\/)0{32}(?:\/|$)/.test(value)
  )
    return false;
  const p = value.slice(base.length);
  return (
    (method === 'GET' &&
      new RegExp(
        '^applications/' +
          i +
          '/(?:submission|submissions(?:/' +
          i +
          (!staff ? '|/commands/' + i : '') +
          ')?)$',
      ).test(p)) ||
    (!staff &&
      method === 'POST' &&
      new RegExp('^applications/' + i + '/submissions/commands/' + i + '$').test(p))
  );
}
export function creditSubmissionCommandPath(c: CreditSubmissionCommand) {
  creditSubmissionCommandSchema.parse(c);
  return '/api/credit/applications/' + c.applicationId + '/submissions/commands/' + c.id;
}
export function readCreditSubmissionResult(raw: unknown, c: CreditSubmissionCommand) {
  creditSubmissionCommandSchema.parse(c);
  const r = creditSubmissionResultSchema.parse(raw);
  if (
    r.commandId !== c.id ||
    r.application.id !== c.applicationId ||
    r.application.version === c.body.applicationVersion ||
    r.submission.consentId !== c.body.consentId ||
    r.submission.requirementsRevisionId !== c.body.requirementsRevisionId ||
    r.submission.locale !== c.body.locale ||
    r.note !== c.body.note
  )
    throw Error('Wrong frozen submission receipt');
  return r;
}
export function readCreditSubmissionCapabilities(
  raw: unknown,
  applicationId: string,
  staff = false,
) {
  const r = creditSubmissionCapabilitiesSchema.parse(raw);
  if (
    r.application.id !== id.parse(applicationId) ||
    (staff && (r.canSubmit || r.canWithdraw)) ||
    (!staff &&
      (r.canSubmit !== (r.blockers.length === 0) ||
        r.canWithdraw !== (r.application.state === 'Submitted')))
  )
    throw Error('Wrong submission authority');
  return r;
}
export function readCreditSubmissionDetail(
  raw: unknown,
  applicationId: string,
  submissionId: string,
) {
  const r = creditSubmissionDetailSchema.parse(raw);
  if (r.application.id !== id.parse(applicationId) || r.submission.id !== id.parse(submissionId))
    throw Error('Wrong submission resource');
  return r;
}
export function readCreditSubmissionPage(raw: unknown, applicationId: string) {
  const r = creditSubmissionPageSchema.parse(raw);
  if (r.applicationId !== id.parse(applicationId)) throw Error('Wrong submission history');
  return r;
}
