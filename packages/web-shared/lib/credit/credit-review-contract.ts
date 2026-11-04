import { z } from '../config/schema-runtime.ts';
import { creditApplicationSummarySchema } from './credit-application-contract.ts';
const id = z
    .string()
    .regex(/^[a-f0-9]{32}$/)
    .refine((x) => !/^0+$/.test(x)),
  version = z.string().regex(/^[A-Za-z0-9+/]{10}[AEIMQUYcgkosw048]=$/),
  at = z
    .string()
    .datetime({ offset: true })
    .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/),
  money = z
    .string()
    .max(19)
    .refine((x) => /^[1-9][0-9]{0,18}$/.test(x) && BigInt(x) <= 9223372036854775807n),
  outcome = z.enum(['Returned', 'Declined', 'Approved']),
  locale = z.enum(['fa', 'en']),
  note = z
    .string()
    .min(1)
    .max(2000)
    .refine(
      (x) =>
        x === x.trim() &&
        // eslint-disable-next-line no-control-regex -- Reject forbidden control characters at the trust boundary.
        !/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(x) &&
        !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(x),
    );
const approval = (x: {
  outcome: string;
  approvedAmountRial: string | null;
  expiresAt: string | null;
}) =>
  x.outcome === 'Approved'
    ? x.approvedAmountRial !== null && x.expiresAt !== null
    : x.approvedAmountRial === null && x.expiresAt === null;
export const creditReviewBodySchema = z
  .object({
    applicationVersion: version,
    submissionId: id,
    outcome,
    locale,
    note,
    approvedAmountRial: money.nullable(),
    expiresAt: at.nullable(),
    reviewConfirmed: z.literal(true),
  })
  .strict()
  .refine(approval);
export const creditReviewCommandSchema = z
  .object({ id, applicationId: id, body: creditReviewBodySchema })
  .strict();
export const creditReviewDataSchema = z
  .object({
    id,
    submissionId: id,
    outcome,
    locale,
    approvedAmountRial: money.nullable(),
    expiresAt: at.nullable(),
    at,
  })
  .strict()
  .refine(
    (x) => approval(x) && (x.expiresAt === null || Date.parse(x.expiresAt) > Date.parse(x.at)),
  );
export const creditReviewCapabilitiesSchema = z
  .object({
    schemaVersion: z.literal(1),
    application: creditApplicationSummarySchema,
    submissionId: id.nullable(),
    canReview: z.boolean(),
    canApprove: z.boolean(),
    blockers: z
      .array(
        z.enum([
          'credit_review_write_required',
          'credit_application_not_submitted',
          'credit_review_capacity',
        ]),
      )
      .max(3),
    approvalBlockers: z.array(z.literal('private_file_unavailable')).max(1),
  })
  .strict()
  .refine(
    (x) =>
      new Set(x.blockers).size === x.blockers.length &&
      x.canReview === (x.blockers.length === 0) &&
      x.canApprove === (x.canReview && x.approvalBlockers.length === 0) &&
      x.blockers.includes('credit_application_not_submitted') ===
        (x.application.state !== 'Submitted') &&
      (x.application.state !== 'Submitted' || x.submissionId !== null),
  );
export const creditReviewPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    applicationId: id,
    items: z.array(creditReviewDataSchema).max(20),
    nextCursor: z.null(),
  })
  .strict()
  .refine(
    (x) =>
      new Set(x.items.map((i) => i.id)).size === x.items.length &&
      new Set(x.items.map((i) => i.submissionId)).size === x.items.length,
  );
const within = (x: {
  application: z.infer<typeof creditApplicationSummarySchema>;
  review: z.infer<typeof creditReviewDataSchema>;
}) =>
  Date.parse(x.review.at) >= Date.parse(x.application.createdAt) &&
  Date.parse(x.review.at) <= Date.parse(x.application.changedAt) &&
  (x.review.approvedAmountRial === null ||
    BigInt(x.review.approvedAmountRial) <= BigInt(x.application.requestedAmountRial));
export const creditReviewDetailSchema = z
  .object({
    schemaVersion: z.literal(1),
    application: creditApplicationSummarySchema,
    review: creditReviewDataSchema,
    note,
  })
  .strict()
  .refine(within);
export const creditReviewResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    replayed: z.boolean(),
    commandId: id,
    application: creditApplicationSummarySchema,
    review: creditReviewDataSchema,
    note,
  })
  .strict()
  .refine(
    (x) =>
      within(x) &&
      x.application.changedAt === x.review.at &&
      x.application.state === (x.review.outcome === 'Returned' ? 'Draft' : x.review.outcome),
  );
export type CreditReviewCommand = z.infer<typeof creditReviewCommandSchema>;
export type CreditReviewResult = z.infer<typeof creditReviewResultSchema>;
export type CreditReviewCapabilities = z.infer<typeof creditReviewCapabilitiesSchema>;
export type CreditReviewPage = z.infer<typeof creditReviewPageSchema>;
export type CreditReviewDetail = z.infer<typeof creditReviewDetailSchema>;
export function isCreditReviewPath(value: string, method = 'GET', staff = false) {
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
          '/(?:' +
          (staff ? 'review|' : '') +
          'reviews(?:/' +
          i +
          (staff ? '|/commands/' + i : '') +
          ')?)$',
      ).test(p)) ||
    (staff &&
      method === 'POST' &&
      new RegExp('^applications/' + i + '/reviews/commands/' + i + '$').test(p))
  );
}
export function creditReviewCommandPath(c: CreditReviewCommand) {
  creditReviewCommandSchema.parse(c);
  return '/api/admin/credit/applications/' + c.applicationId + '/reviews/commands/' + c.id;
}
export function readCreditReviewResult(raw: unknown, c: CreditReviewCommand) {
  creditReviewCommandSchema.parse(c);
  const r = creditReviewResultSchema.parse(raw);
  if (
    r.commandId !== c.id ||
    r.application.id !== c.applicationId ||
    r.application.version === c.body.applicationVersion ||
    r.review.submissionId !== c.body.submissionId ||
    r.review.outcome !== c.body.outcome ||
    r.review.locale !== c.body.locale ||
    r.note !== c.body.note ||
    r.review.approvedAmountRial !== c.body.approvedAmountRial ||
    (r.review.expiresAt === null
      ? c.body.expiresAt !== null
      : c.body.expiresAt === null ||
        Date.parse(r.review.expiresAt) !== Date.parse(c.body.expiresAt))
  )
    throw Error('Wrong frozen human review receipt');
  return r;
}
export function readCreditReviewCapabilities(raw: unknown, applicationId: string) {
  const r = creditReviewCapabilitiesSchema.parse(raw);
  if (r.application.id !== id.parse(applicationId)) throw Error('Wrong review authority');
  return r;
}
export function readCreditReviewPage(raw: unknown, applicationId: string) {
  const r = creditReviewPageSchema.parse(raw);
  if (r.applicationId !== id.parse(applicationId)) throw Error('Wrong private review history');
  return r;
}
export function readCreditReviewDetail(raw: unknown, applicationId: string, reviewId: string) {
  const r = creditReviewDetailSchema.parse(raw);
  if (r.application.id !== id.parse(applicationId) || r.review.id !== id.parse(reviewId))
    throw Error('Wrong private review resource');
  return r;
}
