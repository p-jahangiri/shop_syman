import type { CartLine, ChequePlan, Product, PurchaseMethod, Variant } from './types.ts';
import { findVariant } from './commerce.ts';

export interface ProductPurchaseRules {
  purchaseMethodIds: string[];
  chequePlanIds?: string[];
}
export interface ChequeEligibility {
  categoryIds?: string[];
  minAmountRial?: string;
  maxAmountRial?: string;
  enabled?: boolean;
}
const inRange = (amount: bigint, min?: string, max?: string) =>
  (min === undefined || amount >= BigInt(min)) && (max === undefined || amount <= BigInt(max));
export function availablePurchaseMethods(
  product: Product,
  variant: Variant,
  methods: PurchaseMethod[],
  amount: bigint = BigInt(variant.priceRial),
) {
  return methods.filter(
    (m) =>
      m.enabled &&
      product.purchaseMethodIds.includes(m.id) &&
      (!variant.purchaseMethodIds || variant.purchaseMethodIds.includes(m.id)) &&
      (!m.categoryIds?.length || m.categoryIds.includes(product.category)) &&
      inRange(amount, m.minAmountRial, m.maxAmountRial),
  );
}
export function availableCartMethods(
  lines: CartLine[],
  products: Product[],
  methods: PurchaseMethod[],
) {
  if (!lines.length) return [];
  const found = lines.map((l) => ({ line: l, found: findVariant(products, l.variantId) }));
  if (
    found.some(
      (x) =>
        !x.found ||
        x.line.quantity <= 0 ||
        !Number.isSafeInteger(x.line.quantity) ||
        x.found.variant.stock < x.line.quantity,
    )
  )
    return [];
  const total = found.reduce(
    (s, x) => s + BigInt(x.found!.variant.priceRial) * BigInt(x.line.quantity),
    0n,
  );
  return methods.filter(
    (m) =>
      m.enabled &&
      inRange(total, m.minAmountRial, m.maxAmountRial) &&
      found.every(
        (x) =>
          availablePurchaseMethods(x.found!.product, x.found!.variant, [
            { ...m, minAmountRial: undefined, maxAmountRial: undefined },
          ]).length > 0,
      ),
  );
}
export function eligibleChequePlans(plans: ChequePlan[], amount: bigint, products: Product[] = []) {
  return plans.filter(
    (p) =>
      p.enabled !== false &&
      inRange(amount, p.minAmountRial, p.maxAmountRial) &&
      products.every(
        (product) =>
          (!p.categoryIds?.length || p.categoryIds.includes(product.category)) &&
          (!product.chequePlanIds?.length || product.chequePlanIds.includes(p.id)),
      ),
  );
}
