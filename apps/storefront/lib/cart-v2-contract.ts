import { z } from './schema-runtime.ts';
import { sourcingCartSchema } from './sourcing-contract.ts';
import { cartInputSchema } from './cart-contract.ts';
import type { Product, MoneyRial } from './types.ts';
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const id = z
  .string()
  .regex(/^[a-f0-9]{32}$/)
  .refine((value) => value !== '0'.repeat(32));
const version = z.string().regex(/^[A-Za-z0-9+/]{10}[AEIMQUYcgkosw048]=$/);
const money = z
  .string()
  .regex(/^(?:0|[1-9][0-9]{0,18})$/)
  .refine((value) => BigInt(value) <= 9223372036854775807n);
const date = z.iso.datetime({ offset: true }).refine((value) => /(?:Z|\+00:00)$/.test(value));
const issue = z.string().regex(/^[a-z_]{1,100}$/);
const nullable = <T extends z.ZodType>(schema: T) => schema.nullable();
const quantity = z.number().int().min(1).max(1000000);
const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(150);
const unique = (values: string[]) => new Set(values).size === values.length;
const image = z
  .string()
  .max(2048)
  .refine(
    (value) =>
      /^\/products\/[A-Za-z0-9/_-]+\.svg$/.test(value) ||
      /^\/media\/catalog\/[a-f0-9]{32}\/(?:thumb|card|zoom)\.webp$/.test(value) ||
      (() => {
        try {
          const url = new URL(value);
          return (
            url.protocol === 'https:' &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash &&
            !/[\\\s]/.test(value)
          );
        } catch {
          return false;
        }
      })(),
  );
export const cartInputV2Schema = cartInputSchema.safeExtend({ version: version.nullable() });
export const ordinaryCartLineV2Schema = z
  .object({
    lineId: id,
    lineKind: z.literal('ordinary'),
    variantId: identifier,
    quantity,
    productId: nullable(identifier),
    slug: nullable(slug),
    name: nullable(z.string().max(1000)),
    label: nullable(z.string().max(8000)),
    unitPriceRial: nullable(money),
    available: z.number().int().min(0).max(2147483647),
    lineTotalRial: nullable(money),
    issue: nullable(z.enum(['unavailable', 'insufficient_stock', 'amount_limit'])),
  })
  .strict();
export const acceptedCartLineSchema = z
  .object({
    lineId: id,
    lineKind: z.literal('acceptedOffer'),
    conversionId: id,
    agreementId: id,
    agreementLineId: id,
    requestId: id,
    taskId: id,
    offerId: id,
    acceptanceId: id,
    allocationId: id,
    offerLineId: id,
    variantId: identifier,
    quantity,
    productId: identifier,
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(180),
    sku: z.string().max(80),
    name: z.string().max(4000),
    label: z.string().max(2000),
    warranty: z.string().max(2000),
    imageUrl: image.nullable(),
    unitPriceRial: money,
    lineTotalRial: money,
    purchaseUntil: date,
    allocationExpiresAt: date,
    issue: issue.nullable(),
  })
  .strict()
  .refine(
    (line) =>
      BigInt(line.unitPriceRial) * BigInt(line.quantity) === BigInt(line.lineTotalRial) &&
      Date.parse(line.allocationExpiresAt) <= Date.parse(line.purchaseUntil),
  );
export const cartSnapshotV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    locale: z.enum(['fa', 'en']),
    version: nullable(version),
    ordinaryLines: z.array(ordinaryCartLineV2Schema).max(64),
    offerLines: z.array(acceptedCartLineSchema).max(64),
    inquiry: sourcingCartSchema,
    ordinarySubtotalRial: nullable(money),
    offerSubtotalRial: money,
    buySubtotalRial: nullable(money),
    hasIssues: z.boolean(),
    canCheckout: z.boolean(),
    canPay: z.literal(false),
    blockers: z.array(issue).max(32),
  })
  .strict()
  .refine((cart) => {
    if (
      cart.ordinaryLines.length + cart.offerLines.length > 64 ||
      cart.inquiry.locale !== cart.locale ||
      cart.inquiry.version !== cart.version ||
      !unique(cart.ordinaryLines.map((line) => line.variantId.toUpperCase())) ||
      !unique([...cart.ordinaryLines, ...cart.offerLines].map((line) => line.lineId)) ||
      !unique(cart.offerLines.map((line) => line.agreementId + ':' + line.agreementLineId))
    )
      return false;
    const quantities = new Map<string, number>();
    for (const line of [...cart.ordinaryLines, ...cart.offerLines]) {
      const key = line.variantId.toUpperCase(),
        sum = (quantities.get(key) ?? 0) + line.quantity;
      if (sum > 1000000) return false;
      quantities.set(key, sum);
    }
    for (const line of cart.ordinaryLines) {
      if (line.issue === 'unavailable') {
        if (line.unitPriceRial !== null || line.lineTotalRial !== null || line.productId !== null)
          return false;
        continue;
      }
      if (
        line.unitPriceRial === null ||
        line.productId === null ||
        (line.lineTotalRial !== null &&
          BigInt(line.unitPriceRial) * BigInt(line.quantity) !== BigInt(line.lineTotalRial)) ||
        (line.issue === null && line.available < line.quantity)
      )
        return false;
    }
    const ordinarySum = cart.ordinaryLines.reduce(
        (sum, line) => sum + BigInt(line.lineTotalRial ?? '0'),
        0n,
      ),
      ordinary =
        cart.ordinaryLines.some((line) => line.lineTotalRial === null) ||
        ordinarySum > 9223372036854775807n
          ? null
          : ordinarySum;
    const offered = cart.offerLines.reduce((sum, line) => sum + BigInt(line.lineTotalRial), 0n);
    if (
      cart.ordinarySubtotalRial !== (ordinary === null ? null : ordinary.toString()) ||
      cart.offerSubtotalRial !== offered.toString() ||
      cart.buySubtotalRial !==
        (ordinary === null || ordinary + offered > 9223372036854775807n
          ? null
          : (ordinary + offered).toString())
    )
      return false;
    const ordinaryIssues = cart.ordinaryLines.some((line) => line.issue !== null),
      amountIssue = ordinary !== null && ordinary + offered > 9223372036854775807n;
    if (
      cart.hasIssues !==
        (ordinaryIssues ||
          cart.offerLines.some((line) => line.issue !== null) ||
          cart.inquiry.hasIssues ||
          amountIssue) ||
      cart.canCheckout !==
        (cart.offerLines.length === 0 &&
          cart.ordinaryLines.length > 0 &&
          !ordinaryIssues &&
          !amountIssue)
    )
      return false;
    for (const group of groupAcceptedCartLines(cart.offerLines)) {
      const first = group.lines[0];
      if (
        group.lines.some(
          (line) =>
            line.conversionId !== first.conversionId ||
            line.requestId !== first.requestId ||
            line.taskId !== first.taskId ||
            line.offerId !== first.offerId ||
            line.acceptanceId !== first.acceptanceId ||
            line.allocationId !== first.allocationId ||
            line.purchaseUntil !== first.purchaseUntil ||
            line.allocationExpiresAt !== first.allocationExpiresAt,
        )
      )
        return false;
    }
    return true;
  });
export type ServerCartV2 = z.infer<typeof cartSnapshotV2Schema>;
export type AcceptedCartLine = z.infer<typeof acceptedCartLineSchema>;
export function groupAcceptedCartLines(lines: AcceptedCartLine[]) {
  const groups = new Map<string, { agreementId: string; lines: AcceptedCartLine[] }>();
  for (const line of lines) {
    let group = groups.get(line.agreementId);
    if (!group) {
      group = { agreementId: line.agreementId, lines: [] };
      groups.set(line.agreementId, group);
    }
    group.lines.push(line);
  }
  return [...groups.values()];
}
export function cartV2BuyCount(cart: ServerCartV2) {
  return [...cart.ordinaryLines, ...cart.offerLines].reduce(
    (count, line) => count + line.quantity,
    0,
  );
}
export function cartV2HasBuyLines(cart: ServerCartV2) {
  return cart.ordinaryLines.length > 0 || cart.offerLines.length > 0;
}
export function cartV2AllowsLegacyCheckout(cart: ServerCartV2) {
  return cart.offerLines.length === 0 && cart.ordinaryLines.length > 0 && cart.canCheckout;
}
// Agreed prices are private snapshots of cart entries, never variant-wide
// catalogue prices. Only the ordinary lane may hydrate the public registry.
export function ordinaryCartProducts(cart: ServerCartV2, products: Product[]): Product[] {
  const lines = new Map(cart.ordinaryLines.map((line) => [line.variantId.toLowerCase(), line]));
  return products.map((product) => ({
    ...product,
    variants: product.variants.map((variant) => {
      const line = lines.get(variant.id.toLowerCase());
      return line && line.unitPriceRial !== null
        ? { ...variant, priceRial: line.unitPriceRial as MoneyRial, stock: line.available }
        : variant;
    }),
  }));
}
