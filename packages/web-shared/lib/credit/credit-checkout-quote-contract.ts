import { z } from '../config/schema-runtime.ts';
import { quoteSnapshotSchema } from '../checkout/quote-contract.ts';
import { quoteSnapshotV5Schema } from '../checkout/quote-v5-contract.ts';
const id = z
  .string()
  .regex(/^[a-f0-9]{32}$/)
  .refine((x) => !/^0+$/.test(x));
const key = z.string().regex(/^[a-z0-9_-]{1,64}$/),
  version = z.string().regex(/^[A-Za-z0-9+/]{10}[AEIMQUYcgkosw048]=$/),
  hash = z.string().regex(/^[A-Fa-f0-9]{64}$/);
const at = z
  .string()
  .datetime({ offset: true })
  .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/);
const money = z
    .string()
    .max(19)
    .refine((x) => /^(?:0|[1-9][0-9]{0,18})$/.test(x) && BigInt(x) <= 9223372036854775807n),
  positive = money.refine((x) => /^[1-9][0-9]{0,18}$/.test(x) && BigInt(x) > 0n),
  basis = z.enum(['PayableTotalRial', 'InstallmentsTotalRial']);
export const creditCheckoutQuoteInputSchema = z
  .object({
    cartVersion: version,
    methodId: key,
    planId: key,
    applicationId: id,
    scopeId: id,
    applicationVersion: version,
    scopeVersion: version,
  })
  .strict();
const scopeSnapshot = z
  .object({
    reviewId: id,
    submissionId: id,
    limitBasis: basis,
    limitAmountRial: positive,
    expiresAt: at,
  })
  .strict();
export const creditCheckoutQuoteCommandSchema = z
  .object({ id, locale: z.enum(['fa', 'en']), body: creditCheckoutQuoteInputSchema, scopeSnapshot })
  .strict();
export const creditQuoteAuthoritySchema = z
  .object({
    applicationId: id,
    applicationVersion: version,
    scopeId: id,
    scopeVersion: version,
    reviewId: id,
    submissionId: id,
    limitBasis: basis,
    limitAmountRial: positive,
    expiresAt: at,
    planId: key,
    planVersion: version,
    planSnapshotHash: hash,
  })
  .strict();
const assessment = z
  .object({
    limitBasis: basis,
    limitAmountRial: positive,
    assessedAmountRial: money.nullable(),
    withinLimit: z.boolean().nullable(),
    blockers: z.array(z.string().regex(/^[a-z_]{1,80}$/)).max(32),
  })
  .strict();
export const creditCheckoutQuoteSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    locale: z.enum(['fa', 'en']),
    createdAt: at,
    expiresAt: at,
    fingerprint: hash,
    authority: creditQuoteAuthoritySchema,
    assessment,
    ordinaryQuote: quoteSnapshotSchema.nullable(),
    acceptedQuote: quoteSnapshotV5Schema.nullable(),
    canPlaceOrder: z.literal(false),
    canPay: z.literal(false),
  })
  .strict()
  .refine((x) => {
    if ((x.ordinaryQuote === null) === (x.acceptedQuote === null)) return false;
    const q = x.ordinaryQuote ?? x.acceptedQuote!;
    if (
      q.schemaVersion !== (x.ordinaryQuote ? 3 : 5) ||
      q.quoteId === null ||
      q.locale !== x.locale ||
      Date.parse(q.createdAt) !== Date.parse(x.createdAt) ||
      q.expiresAt === null ||
      Date.parse(x.expiresAt) !==
        Math.min(Date.parse(q.expiresAt), Date.parse(x.authority.expiresAt)) ||
      Date.parse(x.expiresAt) <= Date.parse(x.createdAt) ||
      q.selectedMethod?.kind !== 'cheque' ||
      !q.selectedMethod.enabled ||
      q.selectedPlan?.id !== x.authority.planId ||
      !q.selectedPlan.enabled ||
      !q.requiresApproval ||
      q.canPlaceOrder ||
      q.temporaryOrder?.canCreate
    )
      return false;
    const a = x.assessment;
    if (
      a.limitBasis !== x.authority.limitBasis ||
      a.limitAmountRial !== x.authority.limitAmountRial
    )
      return false;
    const sum = q.installments.reduce((n, c) => n + BigInt(c.amountRial), 0n);
    if (sum > 9223372036854775807n) return false;
    const amount = a.limitBasis === 'PayableTotalRial' ? q.payableTotalRial : sum.toString(),
      within = amount === null ? null : BigInt(amount) <= BigInt(a.limitAmountRial);
    const blockers = q.blockers.filter((c) => c !== 'credit_approval_required');
    if (amount === null) blockers.push('credit_quote_amount_unavailable');
    else if (within === false) blockers.push('credit_scope_limit_exceeded');
    if (q.payableTotalRial === null) blockers.push('credit_quote_final_charges_unavailable');
    blockers.push('credit_order_not_configured');
    return (
      a.assessedAmountRial === amount &&
      a.withinLimit === within &&
      JSON.stringify(a.blockers) === JSON.stringify([...new Set(blockers)])
    );
  });
export const creditCheckoutQuoteResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    replayed: z.boolean(),
    commandId: id,
    quote: creditCheckoutQuoteSchema,
  })
  .strict();
export type CreditCheckoutQuote = z.infer<typeof creditCheckoutQuoteSchema>;
export type CreditCheckoutQuoteResult = z.infer<typeof creditCheckoutQuoteResultSchema>;
export type CreditCheckoutQuoteCommand = z.infer<typeof creditCheckoutQuoteCommandSchema>;
export type CreditCheckoutQuoteInput = z.infer<typeof creditCheckoutQuoteInputSchema>;
export function isCreditCheckoutQuotePath(path: string, method = 'GET') {
  const i = '[a-f0-9]{32}';
  if (path.includes('?') || path.includes('#') || /(?:^|\/)0{32}(?:\/|$)/.test(path)) return false;
  return (
    (['POST', 'GET'].includes(method) &&
      new RegExp('^/api/cart/(?:fa|en)/v2/credit-quote/commands/' + i + '$').test(path)) ||
    (method === 'GET' && new RegExp('^/api/cart/(?:fa|en)/v2/credit-quotes/' + i + '$').test(path))
  );
}
export function creditCheckoutQuoteCommandPath(c: CreditCheckoutQuoteCommand) {
  creditCheckoutQuoteCommandSchema.parse(c);
  return '/api/cart/' + c.locale + '/v2/credit-quote/commands/' + c.id;
}
export function readCreditCheckoutQuoteResult(raw: unknown, c: CreditCheckoutQuoteCommand) {
  creditCheckoutQuoteCommandSchema.parse(c);
  const r = readCreditCheckoutQuoteInputResult(raw, c.locale, c.id, c.body),
    a = r.quote.authority,
    s = c.scopeSnapshot;
  if (
    a.reviewId !== s.reviewId ||
    a.submissionId !== s.submissionId ||
    a.limitBasis !== s.limitBasis ||
    a.limitAmountRial !== s.limitAmountRial ||
    Date.parse(a.expiresAt) !== Date.parse(s.expiresAt)
  )
    throw Error('Wrong frozen purchase scope snapshot');
  return r;
}
export function readCreditCheckoutQuoteInputResult(
  raw: unknown,
  locale: string,
  commandId: string,
  input: CreditCheckoutQuoteInput,
) {
  creditCheckoutQuoteInputSchema.parse(input);
  const r = creditCheckoutQuoteResultSchema.parse(raw),
    a = r.quote.authority,
    q = r.quote.ordinaryQuote ?? r.quote.acceptedQuote!;
  if (
    r.commandId !== id.parse(commandId) ||
    r.quote.locale !== locale ||
    q.cartVersion !== input.cartVersion ||
    q.selectedMethod?.id !== input.methodId ||
    q.selectedPlan?.id !== input.planId ||
    a.applicationId !== input.applicationId ||
    a.scopeId !== input.scopeId ||
    a.applicationVersion !== input.applicationVersion ||
    a.scopeVersion !== input.scopeVersion
  )
    throw Error('Wrong cheque quote receipt');
  return r;
}
