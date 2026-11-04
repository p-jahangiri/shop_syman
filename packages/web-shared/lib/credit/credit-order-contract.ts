import {
  reviewHoldVersionSchema,
  reviewHoldOptionSchema,
  reviewHoldDataSchema,
} from './cheque-review-hold-contract.ts';
import { z } from '../config/schema-runtime.ts';
import { orderDetailV2Schema } from '../orders/order-v2-contract.ts';
import {
  creditCheckoutQuoteSchema,
  type CreditCheckoutQuote,
} from './credit-checkout-quote-contract.ts';
const id = z
    .string()
    .regex(/^[a-f0-9]{32}$/)
    .refine((x) => !/^0+$/.test(x)),
  hash = z.string().regex(/^[A-Fa-f0-9]{64}$/),
  at = z
    .string()
    .datetime({ offset: true })
    .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/),
  money = z
    .string()
    .max(19)
    .refine((x) => /^(?:0|[1-9][0-9]{0,18})$/.test(x) && BigInt(x) <= 9223372036854775807n),
  positive = money.refine((x) => BigInt(x) > 0n),
  basis = z.enum(['PayableTotalRial', 'InstallmentsTotalRial']);
const normalize = (x: string) =>
    x.replaceAll('\r\n', '\n').replaceAll('\r', '\n').normalize('NFKC').trim(),
  digits = (x: string) =>
    normalize(x)
      .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 1776))
      .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632)),
  phone = (x: string) => {
    const n = digits(x).replaceAll(' ', '').replaceAll('-', '');
    return n.startsWith('0098') ? '0' + n.slice(4) : n.startsWith('+98') ? '0' + n.slice(3) : n;
  };
const text = (min: number, max: number, multi = false) =>
  z
    .string()
    .transform(normalize)
    .pipe(
      z
        .string()
        .min(min)
        .max(max)
        .refine(
          (x) =>
            !Array.from(x).some(
              (c) =>
                (c.charCodeAt(0) < 32 || (c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159)) &&
                !(multi && c === '\n'),
            ),
        ),
    );
const address = z
  .object({
    countryCode: z.literal('IR'),
    province: text(2, 100),
    city: text(2, 100),
    address: text(10, 2000, true),
    postalCode: z
      .string()
      .max(64)
      .transform((x) => digits(x).replaceAll(' ', ''))
      .pipe(z.string().regex(/^[0-9]{10}$/)),
  })
  .strict();
export const creditOrderInputSchema = z
  .object({
    creditQuoteId: id,
    fingerprint: hash,
    contactName: text(2, 100),
    contactPhone: z
      .string()
      .max(64)
      .transform(phone)
      .pipe(z.string().regex(/^09[0-9]{9}$/)),
    delivery: address.nullable(),
    note: text(0, 500, true),
    quoteAccepted: z.literal(true),
    acknowledgeTemporary: z.literal(true),
    reviewHoldPolicyVersion: reviewHoldVersionSchema.optional(),
  })
  .strict();
export const creditOrderCommandSchema = z
  .object({ id, body: creditOrderInputSchema, quoteSnapshot: creditCheckoutQuoteSchema })
  .strict()
  .refine(
    (c) =>
      c.quoteSnapshot.id === c.body.creditQuoteId &&
      c.quoteSnapshot.fingerprint === c.body.fingerprint &&
      c.quoteSnapshot.assessment.withinLimit === true &&
      c.quoteSnapshot.assessment.blockers.length === 1 &&
      c.quoteSnapshot.assessment.blockers[0] === 'credit_order_not_configured',
  );
export const creditOrderLinkSchema = z
  .object({
    orderId: id,
    creditQuoteId: id,
    applicationId: id,
    scopeId: id,
    quoteFingerprint: hash,
    limitBasis: basis,
    limitAmountRial: positive,
    assessedAmountRial: money,
    acceptedAt: at,
    settlementState: z.literal('Pending'),
    canPay: z.literal(false),
  })
  .strict()
  .refine((x) => BigInt(x.assessedAmountRial) <= BigInt(x.limitAmountRial));
const bound = (x: {
  credit: z.infer<typeof creditOrderLinkSchema>;
  order: z.infer<typeof orderDetailV2Schema>;
  reviewHold?: z.infer<typeof reviewHoldDataSchema>;
}) =>
  x.credit.orderId === x.order.summary.id &&
  x.order.paymentAvailability ===
    (['CreditApproved', 'Fulfilled'].includes(x.order.summary.state)
      ? 'credit_manual_authorization'
      : 'credit_settlement_pending') &&
  !x.order.canPay &&
  Date.parse(x.credit.acceptedAt) >= Date.parse(x.order.summary.createdAt) &&
  Date.parse(x.credit.acceptedAt) < Date.parse(x.order.summary.expiresAt) &&
  x.order.events.some((e) => e.reason === 'credit_temporary_order_created') &&
  (!x.reviewHold ||
    (x.reviewHold.expiresAt === x.order.summary.expiresAt &&
      Date.parse(x.reviewHold.quoteExpiresAt) > Date.parse(x.credit.acceptedAt) &&
      Date.parse(x.reviewHold.expiresAt) <=
        Date.parse(x.order.summary.createdAt) + x.reviewHold.minutes * 60000));
export const creditOrderResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    replayed: z.boolean(),
    commandId: id,
    credit: creditOrderLinkSchema,
    order: orderDetailV2Schema,
    reviewHold: reviewHoldDataSchema.optional(),
  })
  .strict()
  .refine((x) => bound(x) && x.order.summary.state === 'AwaitingPayment');
export const creditOrderDetailSchema = z
  .object({
    schemaVersion: z.literal(1),
    credit: creditOrderLinkSchema,
    order: orderDetailV2Schema,
    calculation: creditCheckoutQuoteSchema,
    reviewHold: reviewHoldDataSchema.optional(),
  })
  .strict()
  .refine((x) => {
    if (!bound(x)) return false;
    try {
      bindCreditOrderQuote(x, x.calculation);
      return true;
    } catch {
      return false;
    }
  });
export const creditOrderReadinessSchema = z
  .object({
    schemaVersion: z.literal(1),
    creditQuoteId: id,
    fingerprint: hash,
    expiresAt: at,
    canCreate: z.boolean(),
    blockers: z.array(z.string().regex(/^[a-z_]{1,100}$/)).max(16),
    canPay: z.literal(false),
    reviewHold: reviewHoldOptionSchema.optional(),
  })
  .strict()
  .refine(
    (x) =>
      x.canCreate === (x.blockers.length === 0) && new Set(x.blockers).size === x.blockers.length,
  );
const summary = z
  .object({
    id,
    locale: z.enum(['fa', 'en']),
    createdAt: at,
    expiresAt: at,
    fingerprint: hash,
    planName: z.string().min(1).max(200),
    payableTotalRial: money.nullable(),
    limitBasis: basis,
    limitAmountRial: positive,
    assessedAmountRial: money.nullable(),
    withinLimit: z.boolean().nullable(),
    orderId: id.nullable(),
  })
  .strict()
  .refine(
    (x) =>
      Date.parse(x.expiresAt) > Date.parse(x.createdAt) &&
      (x.assessedAmountRial === null
        ? x.withinLimit === null
        : x.withinLimit === BigInt(x.assessedAmountRial) <= BigInt(x.limitAmountRial)),
  );
export const creditQuoteHistorySchema = z
  .object({
    schemaVersion: z.literal(1),
    items: z.array(summary).max(20),
    nextCursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,200}$/)
      .nullable(),
  })
  .strict()
  .refine((x) => new Set(x.items.map((i) => i.id)).size === x.items.length);
export type CreditOrderInput = z.infer<typeof creditOrderInputSchema>;
export type CreditOrderCommand = z.infer<typeof creditOrderCommandSchema>;
export type CreditOrderResult = z.infer<typeof creditOrderResultSchema>;
export type CreditOrderDetail = z.infer<typeof creditOrderDetailSchema>;
export type CreditOrderReadiness = z.infer<typeof creditOrderReadinessSchema>;
export type CreditQuoteHistory = z.infer<typeof creditQuoteHistorySchema>;
export function isCreditOrderPath(path: string, method = 'GET') {
  if (path.includes('#') || /(?:^|\/)0{32}(?:\/|$)/.test(path)) return false;
  const i = '[a-f0-9]{32}';
  return (
    (method === 'GET' &&
      /^\/api\/credit-orders\/quotes(?:\?cursor=[A-Za-z0-9_-]{1,200})?$/.test(path)) ||
    (['GET', 'POST'].includes(method) &&
      new RegExp('^/api/credit-orders/commands/' + i + '$').test(path)) ||
    (method === 'GET' &&
      new RegExp('^/api/credit-orders/(?:' + i + '|quotes/' + i + '/readiness)$').test(path))
  );
}
export const creditOrderCommandPath = (c: CreditOrderCommand) =>
  '/api/credit-orders/commands/' + creditOrderCommandSchema.parse(c).id;
export function readCreditOrderInputResult(
  raw: unknown,
  commandId: string,
  input: CreditOrderInput,
) {
  const body = creditOrderInputSchema.parse(input),
    r = creditOrderResultSchema.parse(raw);
  if (
    r.reviewHold?.policyVersion !== body.reviewHoldPolicyVersion ||
    r.commandId !== id.parse(commandId) ||
    r.credit.creditQuoteId !== body.creditQuoteId ||
    r.credit.quoteFingerprint !== body.fingerprint ||
    r.order.contactName !== body.contactName ||
    r.order.contactPhone !== body.contactPhone ||
    r.order.note !== body.note ||
    JSON.stringify(r.order.delivery) !== JSON.stringify(body.delivery)
  )
    throw Error('Wrong frozen cheque order input receipt');
  return r;
}
export function readCreditOrderResult(raw: unknown, command: CreditOrderCommand) {
  const c = creditOrderCommandSchema.parse(command),
    r = readCreditOrderInputResult(raw, c.id, c.body);
  bindCreditOrderQuote(r, c.quoteSnapshot);
  return r;
}
export function bindCreditOrderQuote(
  r: {
    credit: z.infer<typeof creditOrderLinkSchema>;
    order: z.infer<typeof orderDetailV2Schema>;
    reviewHold?: z.infer<typeof reviewHoldDataSchema>;
  },
  q: CreditCheckoutQuote,
) {
  const core = q.ordinaryQuote ?? q.acceptedQuote!,
    a = q.authority,
    c = r.credit,
    o = r.order;
  if (
    c.creditQuoteId !== q.id ||
    c.quoteFingerprint !== q.fingerprint ||
    c.applicationId !== a.applicationId ||
    c.scopeId !== a.scopeId ||
    c.limitBasis !== a.limitBasis ||
    c.limitAmountRial !== a.limitAmountRial ||
    c.assessedAmountRial !== q.assessment.assessedAmountRial ||
    o.quoteId !== core.quoteId ||
    o.summary.locale !== q.locale ||
    Date.parse(o.summary.expiresAt) > Date.parse(a.expiresAt) ||
    (!r.reviewHold && Date.parse(o.summary.expiresAt) > Date.parse(q.expiresAt)) ||
    (!!r.reviewHold && instantKey(r.reviewHold.quoteExpiresAt) !== instantKey(q.expiresAt)) ||
    o.itemsSubtotalRial !== core.itemsSubtotalRial ||
    o.goodsTotalRial !== core.goodsTotalRial ||
    o.shippingRial !== core.shippingRial ||
    o.taxRial !== core.taxRial ||
    o.payableTotalRial !== core.payableTotalRial ||
    o.taxIncluded !== core.chargeRules?.taxIncluded ||
    o.lines.length !== core.lines.length ||
    o.originalSnapshotVersion !== (q.ordinaryQuote ? 1 : 2)
  )
    throw Error('Wrong cheque order quote binding');
  for (const line of core.lines) {
    if (
      'accepted' in line &&
      line.accepted &&
      (Date.parse(o.summary.expiresAt) > Date.parse(line.accepted.purchaseUntil) ||
        Date.parse(o.summary.expiresAt) > Date.parse(line.accepted.allocationExpiresAt))
    )
      throw Error('Cheque review hold exceeds agreed stock rights');
    const actual = o.lines.find((l) =>
      'lineId' in line ? l.lineId === line.lineId : l.variantId === line.variantId,
    );
    if (
      !actual ||
      actual.quantity !== line.quantity ||
      actual.unitPriceRial !== line.unitPriceRial ||
      actual.lineTotalRial !== line.lineTotalRial ||
      actual.productId !== line.productId ||
      actual.sellerId !== line.sellerId ||
      actual.sku !== line.sku ||
      actual.name !== line.name ||
      actual.label !== line.label ||
      actual.warranty !== line.warranty ||
      actual.isDigital !== line.isDigital ||
      actual.priceVersion !== line.priceVersion ||
      JSON.stringify(actual.usedCondition) !== JSON.stringify(line.usedCondition) ||
      ('accepted' in line && JSON.stringify(actual.accepted) !== JSON.stringify(line.accepted))
    )
      throw Error('Wrong retained cheque order line');
  }
}

const instantKey = (v: string) => {
  const [date, fraction = ''] = v.replace(/(?:Z|\+00:00)$/, '').split('.');
  return date + '.' + fraction.padEnd(7, '0');
};
