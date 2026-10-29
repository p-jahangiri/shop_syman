import { z } from './schema-runtime.ts';
import { creditApplicationSummarySchema } from './credit-application-contract.ts';
const id = z
  .string()
  .regex(/^[a-f0-9]{32}$/)
  .refine((x) => !/^0+$/.test(x));
const version = z.string().regex(/^[A-Za-z0-9+/]{10}[AEIMQUYcgkosw048]=$/);
const at = z
  .string()
  .datetime({ offset: true })
  .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/);
const money = z
  .string()
  .max(19)
  .refine((x) => /^[1-9][0-9]{0,18}$/.test(x) && BigInt(x) <= 9223372036854775807n);
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
export const creditScopeBasisSchema = z.enum(['PayableTotalRial', 'InstallmentsTotalRial']);
export const creditScopeGrantBodySchema = z
  .object({
    applicationVersion: version,
    reviewId: id,
    limitBasis: creditScopeBasisSchema,
    grantConfirmed: z.literal(true),
  })
  .strict();
export const creditScopeRevokeBodySchema = z
  .object({
    applicationVersion: version,
    scopeVersion: version,
    locale: z.enum(['fa', 'en']),
    note,
    revokeConfirmed: z.literal(true),
  })
  .strict();
export const creditScopeCommandSchema = z.discriminatedUnion('kind', [
  z
    .object({
      id,
      applicationId: id,
      staff: z.literal(true),
      kind: z.literal('Grant'),
      approval: z.object({ approvedAmountRial: money, expiresAt: at, submissionId: id }).strict(),
      body: creditScopeGrantBodySchema,
    })
    .strict(),
  z
    .object({
      id,
      applicationId: id,
      staff: z.boolean(),
      kind: z.literal('Revoke'),
      body: creditScopeRevokeBodySchema,
    })
    .strict()
    .refine((x) => !x.staff || x.body.note.length > 0),
]);
const revocation = z
  .object({ actorKind: z.enum(['Owner', 'Staff']), locale: z.enum(['fa', 'en']), note, at })
  .strict()
  .refine((x) => x.actorKind !== 'Staff' || x.note.length > 0);
export const creditPurchaseScopeDataSchema = z
  .object({
    id,
    version,
    reviewId: id,
    submissionId: id,
    limitBasis: creditScopeBasisSchema,
    limitAmountRial: money,
    expiresAt: at,
    grantedAt: at,
    state: z.enum(['Active', 'Expired', 'Revoked', 'Used']),
    revocation: revocation.nullable(),
    use: z.object({ orderId: id, creditQuoteId: id, at }).strict().optional(),
  })
  .strict()
  .refine(
    (x) =>
      Date.parse(x.expiresAt) > Date.parse(x.grantedAt) &&
      (x.state === 'Used') === (x.use !== undefined) &&
      (!x.use ||
        (x.revocation === null &&
          Date.parse(x.use.at) >= Date.parse(x.grantedAt) &&
          Date.parse(x.use.at) < Date.parse(x.expiresAt))) &&
      (x.state === 'Revoked') === (x.revocation !== null) &&
      (x.revocation === null || Date.parse(x.revocation.at) >= Date.parse(x.grantedAt)),
  );
const grantBlocker = z.enum([
  'credit_scope_grant_write_required',
  'credit_application_not_approved',
  'credit_scope_plan_changed',
  'credit_scope_already_granted',
  'credit_scope_expired',
  'private_file_unavailable',
]);
const quoteBlocker = z.enum([
  'credit_application_not_approved',
  'credit_scope_plan_changed',
  'credit_scope_required',
  'credit_scope_revoked',
  'credit_scope_expired',
  'credit_scope_used',
]);
const within = (x: {
  application: z.infer<typeof creditApplicationSummarySchema>;
  scope: z.infer<typeof creditPurchaseScopeDataSchema> | null;
}) =>
  x.scope === null ||
  (x.application.state === 'Approved' &&
    BigInt(x.scope.limitAmountRial) <= BigInt(x.application.requestedAmountRial) &&
    Date.parse(x.scope.grantedAt) >= Date.parse(x.application.createdAt) &&
    Date.parse(x.scope.grantedAt) <= Date.parse(x.application.changedAt) &&
    (x.scope.revocation === null ||
      Date.parse(x.scope.revocation.at) <= Date.parse(x.application.changedAt)) &&
    (!x.scope?.use || Date.parse(x.scope.use.at) <= Date.parse(x.application.changedAt)));
export const creditPurchaseScopePageSchema = z
  .object({
    schemaVersion: z.literal(1),
    application: creditApplicationSummarySchema,
    reviewId: id.nullable(),
    scope: creditPurchaseScopeDataSchema.nullable(),
    canGrant: z.boolean(),
    canRevoke: z.boolean(),
    eligibleForQuote: z.boolean(),
    grantBlockers: z.array(grantBlocker).max(6),
    quoteBlockers: z.array(quoteBlocker).max(6),
    canPlaceOrder: z.literal(false),
    canPay: z.literal(false),
  })
  .strict()
  .refine(
    (x) =>
      within(x) &&
      (x.application.state !== 'Approved' || x.reviewId !== null) &&
      (x.scope === null || x.scope.reviewId === x.reviewId) &&
      new Set(x.grantBlockers).size === x.grantBlockers.length &&
      new Set(x.quoteBlockers).size === x.quoteBlockers.length &&
      x.canGrant === (x.grantBlockers.length === 0) &&
      x.eligibleForQuote === (x.quoteBlockers.length === 0) &&
      (!x.canGrant || (x.scope === null && x.application.state === 'Approved')) &&
      (!x.canRevoke || x.scope?.state === 'Active') &&
      (!x.eligibleForQuote ||
        (x.scope?.state === 'Active' && x.application.state === 'Approved')) &&
      x.quoteBlockers.includes('credit_scope_required') === (x.scope === null) &&
      x.grantBlockers.includes('credit_scope_already_granted') === (x.scope !== null),
  );
export const creditPurchaseScopeResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    replayed: z.boolean(),
    commandId: id,
    kind: z.enum(['Grant', 'Revoke']),
    application: creditApplicationSummarySchema,
    scope: creditPurchaseScopeDataSchema,
  })
  .strict()
  .refine(
    (x) =>
      within(x) &&
      x.application.state === 'Approved' &&
      x.scope.state === (x.kind === 'Grant' ? 'Active' : 'Revoked') &&
      Date.parse(x.application.changedAt) ===
        Date.parse(x.kind === 'Grant' ? x.scope.grantedAt : (x.scope.revocation?.at ?? '')),
  );
export type CreditScopeCommand = z.infer<typeof creditScopeCommandSchema>;
export type CreditPurchaseScopePage = z.infer<typeof creditPurchaseScopePageSchema>;
export type CreditPurchaseScopeResult = z.infer<typeof creditPurchaseScopeResultSchema>;
export function isCreditPurchaseScopePath(value: string, method = 'GET', staff = false) {
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
      new RegExp('^applications/' + i + '/purchase-scope(?:/commands/' + i + ')?$').test(p)) ||
    (method === 'POST' &&
      new RegExp(
        '^applications/' +
          i +
          '/purchase-scope/(?:' +
          (staff ? 'grant|' : '') +
          'revoke)/' +
          i +
          '$',
      ).test(p))
  );
}
export function creditScopeCommandPath(c: CreditScopeCommand, receipt = false) {
  creditScopeCommandSchema.parse(c);
  return (
    (c.staff ? '/api/admin/credit' : '/api/credit') +
    '/applications/' +
    c.applicationId +
    '/purchase-scope/' +
    (receipt ? 'commands' : c.kind === 'Grant' ? 'grant' : 'revoke') +
    '/' +
    c.id
  );
}
export function readCreditPurchaseScopePage(raw: unknown, applicationId: string, staff = false) {
  const r = creditPurchaseScopePageSchema.parse(raw);
  if (r.application.id !== id.parse(applicationId) || (!staff && r.canGrant))
    throw Error('Wrong purchase scope authority');
  return r;
}
export function readCreditScopeResult(raw: unknown, c: CreditScopeCommand) {
  creditScopeCommandSchema.parse(c);
  const r = creditPurchaseScopeResultSchema.parse(raw);
  if (
    r.application.id !== c.applicationId ||
    r.commandId !== c.id ||
    r.kind !== c.kind ||
    r.application.version === c.body.applicationVersion ||
    (c.kind === 'Grant' &&
      (r.scope.reviewId !== c.body.reviewId ||
        r.scope.limitBasis !== c.body.limitBasis ||
        r.scope.limitAmountRial !== c.approval.approvedAmountRial ||
        Date.parse(r.scope.expiresAt) !== Date.parse(c.approval.expiresAt) ||
        r.scope.submissionId !== c.approval.submissionId)) ||
    (c.kind === 'Revoke' &&
      (r.scope.version !== c.body.scopeVersion ||
        r.scope.revocation?.actorKind !== (c.staff ? 'Staff' : 'Owner') ||
        r.scope.revocation?.locale !== c.body.locale ||
        r.scope.revocation?.note !== c.body.note))
  )
    throw Error('Wrong frozen purchase scope receipt');
  return r;
}
