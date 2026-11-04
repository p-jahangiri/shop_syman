import { z } from '../config/schema-runtime.ts';
const key = z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/),
  id = z
    .string()
    .regex(/^[a-f0-9]{32}$/)
    .refine((x) => !/^0+$/.test(x)),
  version = z.string().regex(/^[A-Za-z0-9+/]{10}[AEIMQUYcgkosw048]=$/);
const validMoney = (value: string) =>
  /^(?:0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n;
const money = z.string().max(19).refine(validMoney),
  positive = money.refine((x) => validMoney(x) && BigInt(x) > 0),
  name = z
    .string()
    .min(1)
    .max(200)
    .refine((x) => x === x.trim()),
  at = z
    .string()
    .datetime({ offset: true })
    .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/),
  cursor = z
    .string()
    .max(180)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/)
    .nullable();
const planFields = {
  id: key,
  version,
  nameFa: name,
  nameEn: name,
  months: z.number().int().min(1).max(60),
  markupBasisPoints: z.number().int().min(0).max(100000),
  downPaymentBasisPoints: z.number().int().min(0).max(10000),
  intervalMonths: z.number().int().min(1).max(60),
  roundingUnitRial: z.enum(['1', '10']),
  minAmountRial: money.nullable(),
  maxAmountRial: money.nullable(),
};
const terms = (x: {
  months: number;
  intervalMonths: number;
  minAmountRial: string | null;
  maxAmountRial: string | null;
}) =>
  (x.minAmountRial === null || validMoney(x.minAmountRial)) &&
  (x.maxAmountRial === null || validMoney(x.maxAmountRial)) &&
  x.intervalMonths <= x.months &&
  x.months % x.intervalMonths === 0 &&
  (x.maxAmountRial === null || BigInt(x.maxAmountRial) >= BigInt(x.minAmountRial ?? '0'));
export const creditApplicationPlanSchema = z
  .object({ ...planFields, categoryIds: z.array(key).max(500) })
  .strict()
  .refine((x) => terms(x) && new Set(x.categoryIds).size === x.categoryIds.length);
export const creditPlanOptionSchema = z
  .object({ ...planFields, categoryCount: z.number().int().min(0).max(2147483647) })
  .strict()
  .refine(terms);
export const creditPlansSchema = z
  .object({
    schemaVersion: z.literal(1),
    items: z.array(creditPlanOptionSchema).max(50),
    nextCursor: key.nullable(),
  })
  .strict()
  .refine(
    (x) =>
      new Set(x.items.map((i) => i.id)).size === x.items.length &&
      (x.nextCursor === null || (x.items.length === 50 && x.items.at(-1)!.id === x.nextCursor)),
  );
export const creditApplicationStateSchema = z.enum([
  'Draft',
  'Submitted',
  'Cancelled',
  'Approved',
  'Declined',
]);
export const creditApplicationSummarySchema = z
  .object({
    id,
    planId: key,
    requestedAmountRial: positive,
    locale: z.enum(['fa', 'en']),
    state: creditApplicationStateSchema,
    version,
    createdAt: at,
    changedAt: at,
  })
  .strict()
  .refine((x) => Date.parse(x.changedAt) >= Date.parse(x.createdAt));
export const creditApplicationPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    state: creditApplicationStateSchema.nullable(),
    items: z.array(creditApplicationSummarySchema).max(50),
    nextCursor: cursor,
  })
  .strict()
  .refine(
    (x) =>
      new Set(x.items.map((i) => i.id)).size === x.items.length &&
      (x.nextCursor === null || x.items.length === 50) &&
      x.items.every((i) => x.state === null || i.state === x.state),
  );
export const creditApplicationDetailSchema = z
  .object({
    schemaVersion: z.literal(1),
    application: creditApplicationSummarySchema,
    plan: creditApplicationPlanSchema,
    canSubmit: z.literal(false),
    blockers: z
      .array(
        z.enum([
          'credit_submission_not_configured',
          'application_cancelled',
          'application_submitted',
          'application_approved',
          'application_declined',
        ]),
      )
      .length(1),
  })
  .strict()
  .refine(
    (x) =>
      x.application.planId === x.plan.id &&
      x.blockers[0] ===
        (x.application.state === 'Cancelled'
          ? 'application_cancelled'
          : x.application.state === 'Submitted'
            ? 'application_submitted'
            : x.application.state === 'Approved'
              ? 'application_approved'
              : x.application.state === 'Declined'
                ? 'application_declined'
                : 'credit_submission_not_configured') &&
      validMoney(x.application.requestedAmountRial) &&
      (x.plan.minAmountRial === null || validMoney(x.plan.minAmountRial)) &&
      (x.plan.maxAmountRial === null || validMoney(x.plan.maxAmountRial)) &&
      BigInt(x.application.requestedAmountRial) >= BigInt(x.plan.minAmountRial ?? '0') &&
      (x.plan.maxAmountRial === null ||
        BigInt(x.application.requestedAmountRial) <= BigInt(x.plan.maxAmountRial)),
  );
export const creditApplicationCreateSchema = z
  .object({
    planId: key,
    planVersion: version,
    requestedAmountRial: positive,
    locale: z.enum(['fa', 'en']),
  })
  .strict();
export const creditApplicationCancelSchema = z.object({ version }).strict();
export const creditApplicationResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    replayed: z.boolean(),
    commandId: id,
    application: creditApplicationSummarySchema,
  })
  .strict();
export type CreditApplicationSummary = z.infer<typeof creditApplicationSummarySchema>;
export type CreditApplicationDetail = z.infer<typeof creditApplicationDetailSchema>;
export type CreditApplicationPage = z.infer<typeof creditApplicationPageSchema>;
export type CreditPlanOptions = z.infer<typeof creditPlansSchema>;
export type CreditApplicationResult = z.infer<typeof creditApplicationResultSchema>;
export type CreditApplicationCommand =
  | { id: string; kind: 'create'; body: z.infer<typeof creditApplicationCreateSchema> }
  | {
      id: string;
      kind: 'cancel';
      applicationId: string;
      body: z.infer<typeof creditApplicationCancelSchema>;
    };
export function creditApplicationCommandPath(c: CreditApplicationCommand) {
  id.parse(c.id);
  return c.kind === 'create'
    ? '/api/credit/applications/commands/' + c.id
    : '/api/credit/applications/' + id.parse(c.applicationId) + '/cancel/' + c.id;
}
export function readCreditApplicationResult(raw: unknown, c: CreditApplicationCommand) {
  const r = creditApplicationResultSchema.parse(raw);
  if (
    r.commandId !== c.id ||
    r.application.state !== (c.kind === 'create' ? 'Draft' : 'Cancelled') ||
    (c.kind === 'cancel' && r.application.id !== c.applicationId) ||
    (c.kind === 'create' &&
      (r.application.planId !== c.body.planId ||
        r.application.requestedAmountRial !== c.body.requestedAmountRial ||
        r.application.locale !== c.body.locale))
  )
    throw Error('Credit receipt does not match the frozen request');
  return r;
}
export function readCreditApplicationDetail(raw: unknown, applicationId: string) {
  const r = creditApplicationDetailSchema.parse(raw);
  if (r.application.id !== id.parse(applicationId)) throw Error('Wrong private credit resource');
  return r;
}
export function readCreditApplicationPage(raw: unknown, state: string | null) {
  const r = creditApplicationPageSchema.parse(raw);
  if (r.state !== state) throw Error('Wrong credit filter');
  return r;
}
