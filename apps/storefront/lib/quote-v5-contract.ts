import { z } from './schema-runtime.ts';
import { quoteSnapshotSchema, quoteInputSchema, type QuoteInput } from './quote-contract.ts';
import {
  offerIdSchema as id,
  offerVersionSchema as version,
  offerFingerprintSchema as hash,
} from './offer-contract.ts';
const utc = z.iso.datetime({ offset: true }).refine((value) => /(?:Z|\+00:00)$/.test(value));
const fields = quoteSnapshotSchema.shape;
type LegacyQuote = z.infer<typeof quoteSnapshotSchema>;
export const acceptedQuoteV5Schema = z
  .object({
    conversionId: id,
    agreementId: id,
    agreementLineId: id,
    requestId: id,
    taskId: id,
    offerId: id,
    acceptanceId: id,
    allocationId: id,
    offerLineId: id,
    termsHash: hash,
    agreementVersion: version,
    allocationVersion: version,
    purchaseUntil: utc,
    allocationExpiresAt: utc,
    revision: z.number().int().min(1).max(2147483647),
    snapshotHash: hash,
    termsFa: z.string().min(1).max(4000),
    termsEn: z.string().min(1).max(4000),
    materialFingerprint: hash,
    containsDemo: z.boolean(),
  })
  .strict();
export const quoteLineV5Schema = z
  .object({
    ...fields.lines.element.shape,
    lineId: id,
    lineKind: z.enum(['ordinary', 'acceptedOffer']),
    priceVersion: version.nullable(),
    accepted: acceptedQuoteV5Schema.nullable(),
  })
  .strict()
  .refine((value) =>
    value.lineKind === 'ordinary'
      ? (!value.usedCondition || (!value.isDigital && value.quantity === 1)) &&
        value.accepted === null &&
        value.priceVersion !== null
      : value.usedCondition === undefined &&
        value.accepted !== null &&
        value.priceVersion === null &&
        !value.isDigital &&
        value.label.length <= 2000 &&
        value.warranty.length <= 2000 &&
        Date.parse(value.accepted.allocationExpiresAt) <= Date.parse(value.accepted.purchaseUntil),
  );
const unique = (values: string[]) => new Set(values).size === values.length;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export const quoteSnapshotV5Schema = z
  .object({
    ...fields,
    schemaVersion: z.literal(5),
    quoteId: id.nullable(),
    cartVersion: version,
    createdAt: utc,
    expiresAt: utc,
    lines: z.array(quoteLineV5Schema).min(1).max(64),
    chargeRules: fields.chargeRules.pipe(
      z.custom<NonNullable<LegacyQuote['chargeRules']>>((v) => v !== null, { abort: true }),
    ),
    temporaryOrder: fields.temporaryOrder.pipe(
      z.custom<NonNullable<LegacyQuote['temporaryOrder']>>((v) => v !== null, { abort: true }),
    ),
    canPlaceOrder: z.literal(false),
    canPay: z.literal(false),
  })
  .strict()
  .refine((q) => {
    const offered = q.lines.filter((l) => l.lineKind === 'acceptedOffer'),
      ordinary = q.lines.filter((l) => l.lineKind === 'ordinary');
    if (
      !offered.length ||
      !unique(q.lines.map((l) => l.lineId)) ||
      !unique(ordinary.map((l) => l.variantId.toUpperCase())) ||
      !unique(offered.map((l) => l.accepted!.agreementId + ':' + l.accepted!.agreementLineId)) ||
      !unique(offered.map((l) => l.accepted!.agreementId + ':' + l.accepted!.offerLineId))
    )
      return false;
    const groups = new Map<string, typeof acceptedQuoteV5Schema._output>();
    const quantities = new Map<string, number>();
    for (const l of q.lines) {
      const key = l.variantId.toUpperCase(),
        quantity = (quantities.get(key) ?? 0) + l.quantity;
      if (
        quantity > 1000000 ||
        BigInt(l.unitPriceRial) * BigInt(l.quantity) !== BigInt(l.lineTotalRial)
      )
        return false;
      quantities.set(key, quantity);
      if (l.accepted) {
        const old = groups.get(l.accepted.agreementId);
        if (
          old &&
          !same(
            {
              ...old,
              agreementLineId: l.accepted.agreementLineId,
              offerLineId: l.accepted.offerLineId,
              materialFingerprint: l.accepted.materialFingerprint,
            },
            l.accepted,
          )
        )
          return false;
        groups.set(l.accepted.agreementId, l.accepted);
      }
    }
    if (
      !unique([...groups.values()].map((a) => a.conversionId)) ||
      !unique([...groups.values()].map((a) => a.acceptanceId)) ||
      !unique([...groups.values()].map((a) => a.allocationId))
    )
      return false;
    const created = Date.parse(q.createdAt),
      expires = Date.parse(q.expiresAt);
    if (
      expires <= created ||
      expires > created + 300000 ||
      offered.some(
        (l) =>
          expires > Date.parse(l.accepted!.purchaseUntil) ||
          expires > Date.parse(l.accepted!.allocationExpiresAt),
      )
    )
      return false;
    const subtotal = q.lines.reduce((s, l) => s + BigInt(l.lineTotalRial), 0n);
    if (
      subtotal !== BigInt(q.itemsSubtotalRial) ||
      subtotal + BigInt(q.markupRial) !== BigInt(q.goodsTotalRial) ||
      BigInt(q.downPaymentRial) > subtotal ||
      q.shippingRequired !== q.lines.some((l) => !l.isDigital) ||
      (!q.shippingRequired && q.shippingRial !== '0')
    )
      return false;
    if (
      q.blockers.includes('accepted_offer_order_unavailable') ||
      q.temporaryOrder.blockers.includes('accepted_offer_order_unavailable')
    )
      return false;
    if (
      q.temporaryOrder.canCreate &&
      (q.temporaryOrder.blockers.length ||
        q.temporaryOrder.settingsVersion === null ||
        q.quoteId === null ||
        q.selectedMethod?.kind !== 'online' ||
        !q.selectedMethod.enabled ||
        q.selectedMethod.requiresApproval ||
        q.requiresApproval ||
        q.payableTotalRial === null ||
        BigInt(q.payableTotalRial) <= 0n)
    )
      return false;
    if (
      !unique(q.methods.map((m) => m.id)) ||
      !unique(q.plans.map((p) => p.id)) ||
      q.methods.some((m) => !m.enabled) ||
      q.plans.some((p) => !p.enabled) ||
      q.requiresApproval !==
        (q.selectedMethod?.requiresApproval === true || q.selectedMethod?.kind === 'cheque')
    )
      return false;
    if (q.quoteId === null) {
      if (
        q.selectedMethod !== null ||
        q.selectedPlan !== null ||
        q.installments.length ||
        q.markupRial !== '0' ||
        q.downPaymentRial !== '0'
      )
        return false;
    } else if (!q.selectedMethod || !q.methods.some((m) => same(m, q.selectedMethod))) return false;
    if (q.selectedMethod?.kind === 'cheque') {
      if (
        !q.selectedPlan ||
        !q.plans.some((p) => same(p, q.selectedPlan)) ||
        !q.requiresApproval ||
        q.installments.length !==
          (BigInt(q.goodsTotalRial) === BigInt(q.downPaymentRial)
            ? 0
            : q.selectedPlan.months / q.selectedPlan.intervalMonths) ||
        q.installments.some(
          (x, i) =>
            x.sequence !== i + 1 || x.monthOffset !== (i + 1) * q.selectedPlan!.intervalMonths,
        ) ||
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
    const rules = q.chargeRules;
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
      reason === 'digital' || reason === 'free' || reason === 'threshold'
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
    if (rules.taxableBaseRial !== basis || rules.taxIncluded !== (rules.taxMode === 'inclusive'))
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
    const payable =
      shipping === null || tax === null
        ? null
        : (
            BigInt(q.goodsTotalRial) +
            BigInt(shipping) +
            (rules.taxIncluded ? 0n : BigInt(tax))
          ).toString();
    return q.taxRial === tax && q.payableTotalRial === payable;
  });
export type CheckoutQuoteV5 = z.infer<typeof quoteSnapshotV5Schema>;
export function quoteV5MatchesInput(
  value: unknown,
  locale: 'fa' | 'en',
  input: QuoteInput,
): CheckoutQuoteV5 {
  const parsed = quoteInputSchema.parse(input),
    quote = quoteSnapshotV5Schema.parse(value);
  if (
    quote.locale !== locale ||
    quote.cartVersion !== parsed.cartVersion ||
    quote.selectedMethod?.id !== (parsed.methodId ?? undefined) ||
    quote.selectedPlan?.id !== (parsed.planId ?? undefined)
  )
    throw new Error('quote_response_mismatch');
  return quote;
}
