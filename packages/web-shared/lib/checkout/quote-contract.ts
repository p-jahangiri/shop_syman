import { usedConditionSchema } from '../catalog/used-condition-contract.ts';
import { z } from '../config/schema-runtime.ts';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const money = z
  .string()
  .refine((v) => /^(0|[1-9]\d{0,18})$/.test(v) && BigInt(v) <= 9223372036854775807n, {
    abort: true,
  });
const version = z.string().regex(/^[A-Za-z0-9+/]{11}=$/);
const optional = <T extends z.ZodType>(schema: T) => schema.nullish().transform((v) => v ?? null);
export const quoteInputSchema = z
  .object({
    cartVersion: version,
    methodId: optional(id),
    planId: optional(id),
    requestId: optional(z.uuid().refine((v) => v !== '00000000-0000-0000-0000-000000000000')),
  })
  .strict()
  .refine((v) => (!v.planId || !!v.methodId) && (!v.methodId || !!v.requestId));
export type QuoteInput = z.infer<typeof quoteInputSchema>;
const method = z
  .object({
    id,
    kind: z.enum(['online', 'cheque', 'installment']),
    name: z.string().max(200),
    description: z.string().max(2000),
    enabled: z.boolean(),
    requiresApproval: z.boolean(),
    categoryIds: z.array(id).max(1000),
    minAmountRial: optional(money),
    maxAmountRial: optional(money),
  })
  .strict();
const plan = z
  .object({
    id,
    name: z.string().max(200),
    months: z.number().int().min(1).max(60),
    markupBasisPoints: z.number().int().min(0).max(100000),
    downPaymentBasisPoints: z.number().int().min(0).max(10000),
    intervalMonths: z.number().int().min(1).max(60),
    roundingUnitRial: z.union([z.literal(1), z.literal(10)]),
    enabled: z.boolean(),
    categoryIds: z.array(id).max(1000),
    minAmountRial: optional(money),
    maxAmountRial: optional(money),
  })
  .strict()
  .refine((p) => p.months % p.intervalMonths === 0);
const line = z
  .object({
    usedCondition: usedConditionSchema.optional(),
    variantId: id,
    productId: id,
    sellerId: id,
    categoryId: id,
    sku: z.string().max(80),
    name: z.string().max(250),
    label: z.string().max(100000),
    warranty: z.string().max(100000),
    isDigital: z.boolean(),
    quantity: z.number().int().min(1).max(1000000),
    unitPriceRial: money,
    lineTotalRial: money,
    priceVersion: optional(version),
  })
  .strict()
  .refine((v) => !v.usedCondition || (!v.isDigital && v.quantity === 1));
const chargeRules = z
  .object({
    version: optional(version),
    shippingMode: z.enum(['unconfigured', 'free', 'flat', 'postpaid']),
    shippingName: z.string().max(200),
    shippingDescription: z.string().max(2000),
    shippingFeeRial: optional(money),
    shippingFreeFromRial: optional(money),
    shippingReason: z.enum(['unconfigured', 'digital', 'free', 'threshold', 'flat', 'postpaid']),
    taxMode: z.enum(['unconfigured', 'exempt', 'exclusive', 'inclusive', 'included_unitemized']),
    taxRateBasisPoints: optional(z.number().int().min(1).max(10000)),
    taxBase: z.enum(['items', 'goods', 'goods_shipping']),
    taxRounding: z.enum(['down', 'up', 'half_up']),
    taxableBaseRial: optional(money),
    taxIncluded: z.boolean(),
  })
  .strict();
export const quoteSnapshotSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    locale: z.enum(['fa', 'en']),
    quoteId: optional(z.string().regex(/^[a-f0-9]{32}$/)),
    cartVersion: version,
    pricingFingerprint: z.string().regex(/^[A-F0-9]{64}$/),
    createdAt: z.iso.datetime({ offset: true }),
    expiresAt: optional(z.iso.datetime({ offset: true })),
    lines: z.array(line).min(1).max(64),
    itemsSubtotalRial: money,
    markupRial: money,
    downPaymentRial: money,
    goodsTotalRial: money,
    shippingRequired: z.boolean(),
    shippingRial: optional(money),
    taxRial: optional(money),
    payableTotalRial: optional(money),
    methods: z.array(method).max(64),
    plans: z.array(plan).max(64),
    selectedMethod: optional(method),
    selectedPlan: optional(plan),
    installments: z
      .array(
        z
          .object({
            sequence: z.number().int().min(1).max(60),
            monthOffset: z.number().int().min(1).max(60),
            amountRial: money.refine((v) => BigInt(v) > 0n),
          })
          .strict(),
      )
      .max(60),
    requiresApproval: z.boolean(),
    canPlaceOrder: z.boolean(),
    blockers: z.array(z.string().regex(/^[a-z_]{1,80}$/)).max(32),
    chargeRules: optional(chargeRules),
    temporaryOrder: optional(
      z
        .object({
          canCreate: z.boolean(),
          reservationMinutes: z.number().int().min(1).max(60),
          requiresSignIn: z.literal(true),
          blockers: z.array(z.string().regex(/^[a-z_]{1,80}$/)).max(16),
          settingsVersion: optional(version),
        })
        .strict(),
    ),
  })
  .strict()
  .refine((q) => {
    if (
      new Set(q.lines.map((l) => l.variantId.toLowerCase())).size !== q.lines.length ||
      q.lines.some((l) => BigInt(l.unitPriceRial) * BigInt(l.quantity) !== BigInt(l.lineTotalRial))
    )
      return false;
    const subtotal = q.lines.reduce((s, l) => s + BigInt(l.lineTotalRial), 0n);
    if (
      subtotal !== BigInt(q.itemsSubtotalRial) ||
      subtotal + BigInt(q.markupRial) !== BigInt(q.goodsTotalRial) ||
      BigInt(q.downPaymentRial) > subtotal
    )
      return false;
    if (
      q.shippingRequired !== q.lines.some((l) => !l.isDigital) ||
      (!q.shippingRequired && q.shippingRial !== '0') ||
      (q.canPlaceOrder && q.blockers.length)
    )
      return false;
    if (q.quoteId === null) {
      if (
        q.selectedMethod !== null ||
        q.selectedPlan !== null ||
        q.expiresAt !== null ||
        q.installments.length ||
        q.markupRial !== '0' ||
        q.downPaymentRial !== '0'
      )
        return false;
    } else if (
      !q.selectedMethod ||
      !q.methods.some((m) => m.id === q.selectedMethod!.id) ||
      q.expiresAt === null ||
      Date.parse(q.expiresAt) <= Date.parse(q.createdAt)
    )
      return false;
    if (q.selectedMethod?.kind === 'cheque') {
      if (
        !q.selectedPlan ||
        !q.plans.some((p) => p.id === q.selectedPlan!.id) ||
        !q.requiresApproval
      )
        return false;
      if (
        q.installments.length > 0 &&
        (q.installments.length !== q.selectedPlan.months / q.selectedPlan.intervalMonths ||
          q.installments.some(
            (x, i) =>
              x.sequence !== i + 1 || x.monthOffset !== (i + 1) * q.selectedPlan!.intervalMonths,
          ))
      )
        return false;
      if (
        q.installments.reduce((s, x) => s + BigInt(x.amountRial), BigInt(q.downPaymentRial)) !==
        BigInt(q.goodsTotalRial)
      )
        return false;
    } else if (
      q.selectedPlan !== null ||
      q.installments.length ||
      q.markupRial !== '0' ||
      q.downPaymentRial !== '0'
    )
      return false;
    if (q.schemaVersion === 3) {
      if (q.temporaryOrder === null || q.lines.some((l) => l.priceVersion === null)) return false;
      if (
        q.temporaryOrder.canCreate &&
        (q.temporaryOrder.blockers.length ||
          q.temporaryOrder.settingsVersion === null ||
          q.selectedMethod?.kind !== 'online' ||
          !q.selectedMethod.enabled ||
          q.selectedMethod.requiresApproval ||
          q.requiresApproval ||
          q.payableTotalRial === null ||
          BigInt(q.payableTotalRial) <= 0n ||
          q.quoteId === null)
      )
        return false;
    } else if (q.temporaryOrder !== null) return false;
    const rules = q.chargeRules;
    if ((q.schemaVersion === 1 && rules !== null) || (q.schemaVersion >= 2 && rules === null))
      return false;
    if (rules) {
      if (
        rules.version === null &&
        (rules.shippingMode !== 'unconfigured' || rules.taxMode !== 'unconfigured')
      )
        return false;
      if (
        rules.shippingMode === 'flat'
          ? rules.shippingFeeRial === null ||
            BigInt(rules.shippingFeeRial) <= 0n ||
            (rules.shippingFreeFromRial !== null && BigInt(rules.shippingFreeFromRial) <= 0n)
          : rules.shippingFeeRial !== null || rules.shippingFreeFromRial !== null
      )
        return false;
      const reason = !q.shippingRequired
        ? 'digital'
        : rules.shippingMode === 'flat' &&
            rules.shippingFreeFromRial !== null &&
            subtotal >= BigInt(rules.shippingFreeFromRial)
          ? 'threshold'
          : rules.shippingMode;
      const shipping =
        reason === 'digital' || reason === 'free' || reason === 'threshold' || reason === 'postpaid'
          ? '0'
          : reason === 'flat'
            ? rules.shippingFeeRial
            : null;
      if (rules.shippingReason !== reason || q.shippingRial !== shipping) return false;
      const basis =
        rules.taxBase === 'items'
          ? q.itemsSubtotalRial
          : rules.taxBase === 'goods'
            ? q.goodsTotalRial
            : shipping === null
              ? null
              : (BigInt(q.goodsTotalRial) + BigInt(shipping)).toString();
      if (
        rules.taxableBaseRial !== basis ||
        rules.taxIncluded !==
          (rules.taxMode === 'inclusive' || rules.taxMode === 'included_unitemized')
      )
        return false;
      const rated = rules.taxMode === 'exclusive' || rules.taxMode === 'inclusive';
      if (rated !== (rules.taxRateBasisPoints !== null)) return false;
      let tax: string | null = rules.taxMode === 'exempt' ? '0' : null;
      if (rated && basis !== null) {
        const numerator = BigInt(basis) * BigInt(rules.taxRateBasisPoints!);
        const denominator = BigInt(rules.taxIncluded ? 10000 + rules.taxRateBasisPoints! : 10000);
        const remainder = numerator % denominator;
        tax = (
          numerator / denominator +
          (remainder > 0n &&
          (rules.taxRounding === 'up' ||
            (rules.taxRounding === 'half_up' && remainder * 2n >= denominator))
            ? 1n
            : 0n)
        ).toString();
      }
      if (q.taxRial !== tax) return false;
    }
    const expected =
      q.shippingRial === null || (q.taxRial === null && rules?.taxMode !== 'included_unitemized')
        ? null
        : (
            BigInt(q.goodsTotalRial) +
            BigInt(q.shippingRial) +
            (rules?.taxIncluded ? 0n : BigInt(q.taxRial!))
          ).toString();
    return q.payableTotalRial === expected;
  });
export type CheckoutQuote = z.infer<typeof quoteSnapshotSchema>;
export function quoteExpired(quote: CheckoutQuote, now = Date.now()) {
  return quote.expiresAt !== null && Date.parse(quote.expiresAt) <= now;
}
