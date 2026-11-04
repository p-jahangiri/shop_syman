import { z } from '../config/schema-runtime.ts';
import { shipmentTicks } from './order-shipment-contract.ts';

const id = z
  .string()
  .regex(/^[a-f0-9]{32}$/)
  .refine((s) => !/^0+$/.test(s));
const key = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const version = z.string().regex(/^[A-Za-z0-9+/]{10}[AEIMQUYcgkosw048]=$/);
const hash = z.string().regex(/^[A-F0-9]{64}$/);
const utc = z
  .string()
  .datetime({ offset: true })
  .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/);
const quantity = z.number().int().min(1).max(1000000);
const count = z.number().int().min(0).max(1000000);
const plain = (max: number, min = 0) =>
  z
    .string()
    .min(min)
    .max(max)
    // eslint-disable-next-line no-control-regex -- Metadata rejects control characters at the trust boundary.
    .refine((s) => !/[\u0000-\u001f\u007f-\u009f]/.test(s));
const identity = {
  lineKey: key,
  variantId: key,
  productId: key,
  sku: plain(80, 1),
  name: plain(250, 1),
  label: z.string().max(524288),
};
const summaryLine = z.strictObject({ ...identity, quantity });
export const digitalDeliverySummarySchema = z
  .strictObject({
    id,
    availableAt: utc,
    lines: z.array(summaryLine).min(1).max(64),
  })
  .refine(
    (s) =>
      new Set(s.lines.map((l) => l.lineKey)).size === s.lines.length &&
      s.lines.reduce((n, l) => n + l.quantity, 0) <= 100,
  );
const deliveries = z
  .array(digitalDeliverySummarySchema)
  .max(64)
  .refine(
    (a) =>
      new Set(a.map((s) => s.id)).size === a.length &&
      a.every(
        (s, i) => i === 0 || shipmentTicks(a[i - 1].availableAt) <= shipmentTicks(s.availableAt),
      ),
  );
const balance = z
  .strictObject({ ...identity, ordered: quantity, available: count, remaining: count })
  .refine((l) => l.available + l.remaining === l.ordered);
export const adminDigitalDeliveryPageSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    orderId: id,
    ownerId: key,
    orderState: z.enum([
      'AwaitingPayment',
      'Paid',
      'CreditApproved',
      'Expired',
      'Cancelled',
      'Fulfilled',
    ]),
    orderVersion: version,
    inventoryFingerprint: hash.nullable(),
    containsDemo: z.boolean(),
    canDeliver: z.boolean(),
    creditAuthorized: z.boolean(),
    remainingDeliverySlots: z.number().int().min(0).max(64),
    lines: z.array(balance).max(64),
    deliveries,
    blockers: z.array(z.string().regex(/^[a-z_]{1,100}$/)).max(20),
  })
  .refine(
    (p) =>
      new Set(p.lines.map((l) => l.lineKey)).size === p.lines.length &&
      p.deliveries.length + p.remainingDeliverySlots <= 64 &&
      p.lines.every(
        (l) =>
          l.available ===
          p.deliveries.reduce(
            (n, d) =>
              n +
              d.lines.filter((s) => s.lineKey === l.lineKey).reduce((a, s) => a + s.quantity, 0),
            0,
          ),
      ) &&
      p.deliveries.every((d) => d.lines.every((l) => p.lines.some((s) => sameIdentity(s, l)))) &&
      (p.inventoryFingerprint !== null ||
        (!p.canDeliver &&
          !p.creditAuthorized &&
          ['AwaitingPayment', 'Expired', 'Cancelled'].includes(p.orderState) &&
          p.remainingDeliverySlots === 64 &&
          p.deliveries.length === 0 &&
          p.lines.every((l) => l.available === 0 && l.remaining === l.ordered) &&
          p.blockers.includes('payment_not_confirmed') &&
          p.blockers.includes('reservation_not_allocated'))) &&
      (!p.canDeliver ||
        (['Paid', 'CreditApproved'].includes(p.orderState) &&
          p.inventoryFingerprint !== null &&
          p.creditAuthorized &&
          p.blockers.length === 0 &&
          p.remainingDeliverySlots > 0 &&
          p.lines.some((l) => l.remaining > 0))),
  );
export const customerDigitalDeliveriesSchema = z.strictObject({
  schemaVersion: z.literal(1),
  orderId: id,
  deliveries,
});

// TextEncoder replaces unpaired surrogates. Reject them explicitly before counting
// bytes so client validation agrees with the server's strict UTF-8 encoder.
export function digitalContentBytes(value: string) {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return -1;
    } else if (c >= 0xdc00 && c <= 0xdfff) return -1;
  }
  return new TextEncoder().encode(value).byteLength;
}
const content = z
  .string()
  .max(4096)
  .transform((s) => s.replace(/\r\n/g, '\n'))
  .refine(
    (s) =>
      s.trim().length > 0 &&
      digitalContentBytes(s) >= 0 &&
      digitalContentBytes(s) <= 4096 &&
      // eslint-disable-next-line no-control-regex -- Newline and tab are the only permitted control characters in private text.
      !/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(s),
  );
export const digitalDeliveryInputSchema = z
  .strictObject({
    ownerId: key,
    commandId: id,
    orderVersion: version,
    inventoryFingerprint: hash,
    reason: plain(400, 1).refine((s) => s === s.trim()),
    acknowledge: z.literal(true),
    lines: z
      .array(z.strictObject({ lineKey: key, contents: z.array(content).min(1).max(100) }))
      .min(1)
      .max(64),
  })
  .refine(
    (x) =>
      new Set(x.lines.map((l) => l.lineKey.toUpperCase())).size === x.lines.length &&
      x.lines.reduce((n, l) => n + l.contents.length, 0) <= 100 &&
      x.lines.reduce((n, l) => n + l.contents.reduce((a, s) => a + digitalContentBytes(s), 0), 0) <=
        65536,
  )
  .transform((x) => ({
    ...x,
    lines: [...x.lines].sort((a, b) =>
      a.lineKey < b.lineKey ? -1 : a.lineKey > b.lineKey ? 1 : 0,
    ),
  }));

// This is the ONLY shape retained by the command journal. It contains neither
// private texts nor their hashes; a lost response is resolved by receipt GET.
export const digitalDeliveryMetadataSchema = z
  .strictObject({
    orderId: id,
    ownerId: key,
    commandId: id,
    orderVersion: version,
    inventoryFingerprint: hash,
    lines: z.array(summaryLine).min(1).max(64),
  })
  .refine(
    (x) =>
      new Set(x.lines.map((l) => l.lineKey)).size === x.lines.length &&
      x.lines.reduce((n, l) => n + l.quantity, 0) <= 100,
  );
export const digitalDeliveryResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  commandId: id,
  orderId: id,
  orderVersion: version,
  delivery: digitalDeliverySummarySchema,
  replayed: z.boolean(),
});
export const digitalDeliveryContentSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    orderId: id,
    deliveryId: id,
    availableAt: utc,
    items: z
      .array(z.strictObject({ id, lineKey: key, content }))
      .min(1)
      .max(100),
  })
  .refine(
    (x) =>
      new Set(x.items.map((i) => i.id)).size === x.items.length &&
      x.items.reduce((n, i) => n + digitalContentBytes(i.content), 0) <= 65536,
  );
type LineIdentity = Pick<
  z.infer<typeof summaryLine>,
  'lineKey' | 'variantId' | 'productId' | 'sku' | 'name' | 'label'
>;
function sameIdentity(a: LineIdentity, b: LineIdentity) {
  return (
    a.lineKey === b.lineKey &&
    a.variantId === b.variantId &&
    a.productId === b.productId &&
    a.sku === b.sku &&
    a.name === b.name &&
    a.label === b.label
  );
}
export type AdminDigitalDeliveryPage = z.infer<typeof adminDigitalDeliveryPageSchema>;
export type DigitalDeliverySummary = z.infer<typeof digitalDeliverySummarySchema>;
export type CustomerDigitalDeliveries = z.infer<typeof customerDigitalDeliveriesSchema>;
export type DigitalDeliveryContent = z.infer<typeof digitalDeliveryContentSchema>;
export type DigitalDeliveryInput = z.infer<typeof digitalDeliveryInputSchema>;
export type DigitalDeliveryMetadata = z.infer<typeof digitalDeliveryMetadataSchema>;
export type DigitalDeliveryResult = z.infer<typeof digitalDeliveryResultSchema>;
export function readAdminDigitalDeliveries(raw: unknown, owner: string, order: string) {
  const page = adminDigitalDeliveryPageSchema.parse(raw);
  if (
    page.orderId !== id.parse(order) ||
    page.ownerId.toUpperCase() !== key.parse(owner).toUpperCase()
  )
    throw Error('Digital delivery owner mismatch');
  return page;
}
export function readCustomerDigitalDeliveries(raw: unknown, order: string) {
  const page = customerDigitalDeliveriesSchema.parse(raw);
  if (page.orderId !== id.parse(order)) throw Error('Digital order mismatch');
  return page;
}
export function readDigitalDeliveryContent(
  raw: unknown,
  order: string,
  delivery: string,
  summary?: DigitalDeliverySummary,
) {
  const value = digitalDeliveryContentSchema.parse(raw);
  if (value.orderId !== id.parse(order) || value.deliveryId !== id.parse(delivery))
    throw Error('Digital content binding mismatch');
  if (
    summary &&
    (summary.id !== value.deliveryId ||
      summary.availableAt !== value.availableAt ||
      value.items.length !== summary.lines.reduce((n, l) => n + l.quantity, 0) ||
      value.items.some((i) => !summary.lines.some((l) => l.lineKey === i.lineKey)) ||
      summary.lines.some(
        (l) => value.items.filter((i) => i.lineKey === l.lineKey).length !== l.quantity,
      ))
  )
    throw Error('Digital content line mismatch');
  return value;
}
export function digitalDeliveryMetadata(
  page: AdminDigitalDeliveryPage,
  supplied: DigitalDeliveryInput,
) {
  const input = digitalDeliveryInputSchema.parse(supplied);
  if (
    !page.canDeliver ||
    page.inventoryFingerprint === null ||
    input.ownerId !== page.ownerId ||
    input.orderVersion !== page.orderVersion ||
    input.inventoryFingerprint !== page.inventoryFingerprint
  )
    throw Error('Review current digital delivery');
  const remaining =
    page.lines.reduce((n, l) => n + l.remaining, 0) -
    input.lines.reduce((n, l) => n + l.contents.length, 0);
  // Reserve worst-case 4096-byte units within future 65536-byte batches. The
  // server additionally reserves any remaining physical handoff.
  if (Math.ceil(Math.max(0, remaining) / 16) > page.remainingDeliverySlots - 1)
    throw Error('digital_delivery_capacity_conflict');
  return digitalDeliveryMetadataSchema.parse({
    orderId: page.orderId,
    ownerId: page.ownerId,
    commandId: input.commandId,
    orderVersion: input.orderVersion,
    inventoryFingerprint: input.inventoryFingerprint,
    lines: input.lines.map((l) => {
      const source = page.lines.find((s) => s.lineKey === l.lineKey);
      if (!source || l.contents.length > source.remaining)
        throw Error('Digital quantity exceeds remaining rights');
      return {
        lineKey: source.lineKey,
        variantId: source.variantId,
        productId: source.productId,
        sku: source.sku,
        name: source.name,
        label: source.label,
        quantity: l.contents.length,
      };
    }),
  });
}
export function readDigitalDeliveryResult(raw: unknown, supplied: DigitalDeliveryMetadata) {
  const meta = digitalDeliveryMetadataSchema.parse(supplied),
    value = digitalDeliveryResultSchema.parse(raw);
  if (
    value.orderId !== meta.orderId ||
    value.commandId !== meta.commandId ||
    value.orderVersion === meta.orderVersion ||
    value.delivery.lines.length !== meta.lines.length ||
    !value.delivery.lines.every((l) =>
      meta.lines.some((s) => sameIdentity(l, s) && l.quantity === s.quantity),
    )
  )
    throw Error('Digital receipt binding mismatch');
  return value;
}
export function digitalBase(owner: string, order: string) {
  return `/admin/orders/${encodeURIComponent(key.parse(owner))}/${id.parse(order)}/fulfillment/digital`;
}
export function customerDigitalPath(order: string, delivery?: string, v2 = true) {
  return `/api/orders/${v2 ? 'v2/' : ''}${id.parse(order)}/fulfillment/digital${delivery ? `/${id.parse(delivery)}/content` : ''}`;
}
export function isCustomerDigitalPath(path: string, method = 'GET') {
  if (method !== 'GET' || /[\s%\\#]/.test(path)) return false;
  const match = path.match(
    /^\/api\/orders\/(?:v2\/)?([a-f0-9]{32})\/fulfillment\/digital(?:\/([a-f0-9]{32})\/content)?$/,
  );
  return !!match && !/^0+$/.test(match[1]) && (!match[2] || !/^0+$/.test(match[2]));
}
