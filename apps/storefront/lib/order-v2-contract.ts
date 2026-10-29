import { z } from './schema-runtime.ts';
import { orderDetailSchema, orderInputSchema, cancelOrderSchema } from './order-contract.ts';
import { acceptedQuoteV5Schema } from './quote-v5-contract.ts';
import { offerIdSchema as id, offerVersionSchema as version } from './offer-contract.ts';
export { orderInputSchema, cancelOrderSchema };
const fields = orderDetailSchema.shape;
const snapshotVersion = z.union([z.literal(1), z.literal(2)]);
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const summary = fields.summary.safeExtend({ originalSnapshotVersion: snapshotVersion });
const line = z
  .object({
    ...fields.lines.element.shape,
    lineId: id,
    lineKind: z.enum(['ordinary', 'acceptedOffer']),
    categoryId: identifier.nullish().transform((v) => v ?? null),
    priceVersion: version.nullable(),
    accepted: acceptedQuoteV5Schema.nullable(),
  })
  .strict()
  .refine((v) =>
    v.lineKind === 'ordinary'
      ? (!v.usedCondition || (!v.isDigital && v.quantity === 1)) && v.accepted === null
      : v.usedCondition === undefined &&
        v.accepted !== null &&
        v.priceVersion === null &&
        !v.isDigital &&
        v.label.length <= 2000 &&
        v.warranty.length <= 2000 &&
        Date.parse(v.accepted.allocationExpiresAt) <= Date.parse(v.accepted.purchaseUntil),
  );
// Preserve the legacy event grammar; only the actual new creation reason has
// a numeric contract suffix. This is not permission for arbitrary digit codes.
const event = fields.events.element.safeExtend({
  reason: z.union([fields.events.element.shape.reason, z.literal('temporary_order_v2_created')]),
});
const unique = (values: string[]) => new Set(values).size === values.length;
export const orderDetailV2Schema = z
  .object({
    ...fields,
    schemaVersion: z.literal(2),
    originalSnapshotVersion: snapshotVersion,
    summary,
    lines: z.array(line).min(1).max(64),
    events: z.array(event).min(1).max(1000),
    canPay: z.literal(false),
  })
  .strict()
  .refine((v) => {
    if (
      v.originalSnapshotVersion !== v.summary.originalSnapshotVersion ||
      v.canCancel !== (v.summary.state === 'AwaitingPayment') ||
      v.summary.payableTotalRial !== v.payableTotalRial ||
      v.shippingRequired !== v.lines.some((l) => !l.isDigital) ||
      v.shippingRequired !== (v.delivery !== null) ||
      (!v.shippingRequired && v.shippingRial !== '0')
    )
      return false;
    if (
      !unique(v.lines.map((l) => l.lineId)) ||
      v.lines.some((l) => BigInt(l.unitPriceRial) * BigInt(l.quantity) !== BigInt(l.lineTotalRial))
    )
      return false;
    const ordinary = v.lines.filter((l) => l.lineKind === 'ordinary'),
      offered = v.lines.filter((l) => l.lineKind === 'acceptedOffer');
    if (
      !unique(ordinary.map((l) => l.variantId.toUpperCase())) ||
      !unique(offered.map((l) => l.accepted!.agreementId + ':' + l.accepted!.agreementLineId)) ||
      !unique(offered.map((l) => l.accepted!.agreementId + ':' + l.accepted!.offerLineId))
    )
      return false;
    if (
      v.originalSnapshotVersion === 1
        ? offered.length > 0 || v.lines.some((l) => l.categoryId !== null)
        : offered.length === 0 ||
          v.lines.some(
            (l) => l.categoryId === null || (l.lineKind === 'ordinary' && l.priceVersion === null),
          )
    )
      return false;
    if (
      v.originalSnapshotVersion === 1 &&
      v.events.some((e) => e.reason === 'temporary_order_v2_created')
    )
      return false;
    const groups = new Map<string, z.infer<typeof acceptedQuoteV5Schema>>(),
      quantities = new Map<string, number>();
    for (const l of v.lines) {
      const key = l.variantId.toUpperCase(),
        quantity = (quantities.get(key) ?? 0) + l.quantity;
      if (quantity > 1000000) return false;
      quantities.set(key, quantity);
      if (l.accepted) {
        const a = l.accepted,
          old = groups.get(a.agreementId);
        if (
          old &&
          JSON.stringify({
            ...old,
            agreementLineId: a.agreementLineId,
            offerLineId: a.offerLineId,
            materialFingerprint: a.materialFingerprint,
          }) !== JSON.stringify(a)
        )
          return false;
        groups.set(a.agreementId, a);
        if (
          Date.parse(v.summary.expiresAt) > Date.parse(a.purchaseUntil) ||
          Date.parse(v.summary.expiresAt) > Date.parse(a.allocationExpiresAt)
        )
          return false;
      }
    }
    if (
      !unique([...groups.values()].map((a) => a.acceptanceId)) ||
      !unique([...groups.values()].map((a) => a.allocationId)) ||
      !unique([...groups.values()].map((a) => a.conversionId))
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
      BigInt(v.goodsTotalRial) + BigInt(v.shippingRial) + (v.taxIncluded ? 0n : BigInt(v.taxRial))
    );
  });
export const createOrderResultV2Schema = z
  .object({ order: orderDetailV2Schema, replayed: z.boolean() })
  .strict();
export const orderPageV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    items: z.array(summary).max(20),
    nextCursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,200}$/)
      .nullish()
      .transform((v) => v ?? null),
  })
  .strict()
  .refine((v) => unique(v.items.map((x) => x.id)));
export type OrderDetailV2 = z.infer<typeof orderDetailV2Schema>;
export type OrderPageV2 = z.infer<typeof orderPageV2Schema>;
export function orderV2Expired(order: OrderDetailV2, now = Date.now()) {
  return (
    order.summary.state === 'Expired' ||
    (order.summary.state === 'AwaitingPayment' && Date.parse(order.summary.expiresAt) <= now)
  );
}
