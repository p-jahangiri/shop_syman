import { usedConditionSchema } from '../catalog/used-condition-contract.ts';
import { z } from '../config/schema-runtime.ts';
const id = z.string().regex(/^[a-f0-9]{32}$/);
const money = z
  .string()
  .refine((v) => /^(0|[1-9]\d{0,18})$/.test(v) && BigInt(v) <= 9223372036854775807n, {
    abort: true,
  });
const version = z.string().regex(/^[A-Za-z0-9+/]{11}=$/);
const nullable = <T extends z.ZodType>(schema: T) => schema.nullish().transform((v) => v ?? null);
export const orderStateSchema = z.enum([
  'AwaitingPayment',
  'Paid',
  'Cancelled',
  'Expired',
  'Fulfilled',
  'CreditApproved',
]);
export const deliverySchema = z
  .object({
    countryCode: z.literal('IR'),
    province: z.string().trim().min(2).max(100),
    city: z.string().trim().min(2).max(100),
    address: z.string().trim().min(10).max(2000),
    postalCode: z.string().max(64),
  })
  .strict();
export const orderInputSchema = z
  .object({
    quoteId: id,
    requestId: z.uuid().refine((v) => v !== '00000000-0000-0000-0000-000000000000'),
    contactName: z.string().trim().min(2).max(100),
    contactPhone: z.string().min(1).max(64),
    delivery: nullable(deliverySchema),
    note: nullable(z.string().max(500)),
    acknowledgeTemporary: z.literal(true),
  })
  .strict();
export type OrderInput = z.infer<typeof orderInputSchema>;
export const cancelOrderSchema = z.object({ version }).strict();
const summary = z
  .object({
    id,
    reference: z.string().regex(/^SM-[1-9]\d{0,18}$/),
    locale: z.enum(['fa', 'en']),
    state: orderStateSchema,
    createdAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    payableTotalRial: money.refine((v) => BigInt(v) > 0n),
    itemCount: z.number().int().min(1).max(64000000),
    version,
  })
  .strict()
  .refine((v) => Date.parse(v.expiresAt) > Date.parse(v.createdAt));
const line = z
  .object({
    usedCondition: usedConditionSchema.optional(),
    variantId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    productId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    sellerId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    sku: z.string().max(80),
    name: z.string().max(250),
    label: z.string().max(100000),
    warranty: z.string().max(100000),
    isDigital: z.boolean(),
    quantity: z.number().int().min(1).max(1000000),
    unitPriceRial: money,
    lineTotalRial: money,
  })
  .strict()
  .refine((v) => !v.usedCondition || (!v.isDigital && v.quantity === 1));
export const orderDetailSchema = z
  .object({
    schemaVersion: z.literal(1),
    summary,
    quoteId: id,
    contactName: z.string().min(2).max(100),
    contactPhone: z.string().regex(/^09\d{9}$/),
    delivery: nullable(deliverySchema.extend({ postalCode: z.string().regex(/^\d{10}$/) })),
    note: z.string().max(500),
    shippingRequired: z.boolean(),
    shippingMode: z.literal('postpaid').optional(),
    methodName: z.string().max(200),
    shippingName: z.string().max(200),
    itemsSubtotalRial: money,
    goodsTotalRial: money,
    shippingRial: money,
    taxRial: money.nullable(),
    taxBreakdownKnown: z.literal(false).optional(),
    payableTotalRial: money,
    taxIncluded: z.boolean(),
    lines: z.array(line).min(1).max(64),
    events: z
      .array(
        z
          .object({
            state: orderStateSchema,
            at: z.iso.datetime({ offset: true }),
            reason: z.string().regex(/^[a-z_]{1,100}$/),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
    canCancel: z.boolean(),
    canPay: z.boolean(),
    paymentAvailability: z.enum([
      'gateway_unconfigured',
      'credit_settlement_pending',
      'credit_manual_authorization',
    ]),
  })
  .strict()
  .refine((v) => {
    if (v.taxBreakdownKnown === false ? !v.taxIncluded || v.taxRial !== null : v.taxRial === null)
      return false;
    if (
      v.canPay ||
      v.canCancel !== (v.summary.state === 'AwaitingPayment') ||
      v.summary.payableTotalRial !== v.payableTotalRial ||
      v.shippingRequired !== v.lines.some((l) => !l.isDigital) ||
      v.shippingRequired !== (v.delivery !== null) ||
      (!v.shippingRequired && v.shippingRial !== '0') ||
      (v.shippingMode === 'postpaid' && (!v.shippingRequired || v.shippingRial !== '0'))
    )
      return false;
    if (
      new Set(v.lines.map((l) => l.variantId.toLowerCase())).size !== v.lines.length ||
      v.lines.some((l) => BigInt(l.unitPriceRial) * BigInt(l.quantity) !== BigInt(l.lineTotalRial))
    )
      return false;
    if (
      v.summary.itemCount !== v.lines.reduce((n, l) => n + l.quantity, 0) ||
      BigInt(v.itemsSubtotalRial) !== v.lines.reduce((n, l) => n + BigInt(l.lineTotalRial), 0n) ||
      BigInt(v.goodsTotalRial) < BigInt(v.itemsSubtotalRial)
    )
      return false;
    return (
      BigInt(v.payableTotalRial) ===
      BigInt(v.goodsTotalRial) + BigInt(v.shippingRial) + (v.taxIncluded ? 0n : BigInt(v.taxRial!))
    );
  });
export type OrderDetail = z.infer<typeof orderDetailSchema>;
export const createOrderResultSchema = z
  .object({ order: orderDetailSchema, replayed: z.boolean() })
  .strict();
export const orderPageSchema = z
  .object({
    items: z.array(summary).max(20),
    nextCursor: nullable(z.string().regex(/^[A-Za-z0-9_-]{1,200}$/)),
  })
  .strict()
  .refine((v) => new Set(v.items.map((x) => x.id)).size === v.items.length);
export type OrderPage = z.infer<typeof orderPageSchema>;
export function orderExpired(order: OrderDetail, now = Date.now()) {
  return (
    order.summary.state === 'Expired' ||
    (order.summary.state === 'AwaitingPayment' && Date.parse(order.summary.expiresAt) <= now)
  );
}
