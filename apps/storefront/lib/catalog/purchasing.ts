import type {
  CartLine,
  ChequePlan,
  MenuItem,
  Product,
  PurchaseMethod,
  Variant,
} from '@sayman/web-shared/lib/shared/types.ts';
import { findVariant } from '@sayman/web-shared/lib/shared/commerce.ts';
import { isRetiredSourcingHref } from '@sayman/web-shared/lib/market/retired-sourcing.ts';

/** Global visibility never overrides SKU, amount, plan or provider eligibility. */
export function isPurchaseKindEnabled(
  methods: readonly PurchaseMethod[],
  kind: PurchaseMethod['kind'],
) {
  return methods.some((method) => method.enabled && method.kind === kind);
}

export function isPurchaseHrefEnabled(href: string, methods: readonly PurchaseMethod[]) {
  if (isRetiredSourcingHref(href)) return false;
  try {
    const url = new URL(href, 'https://sayman.invalid');
    const path = decodeURIComponent(url.pathname)
      .replace(/^\/(?:fa|en)(?=\/|$)/, '')
      .replace(/\/+$/, '');
    const promotesCheque =
      /^\/installments(?:\/|$)/.test(path) ||
      (path === '/catalog' && url.searchParams.getAll('method').includes('cheque'));
    return !promotesCheque || isPurchaseKindEnabled(methods, 'cheque');
  } catch {
    return false;
  }
}

export function isPurchaseContentEnabled(
  content: { purchaseMethodKind?: PurchaseMethod['kind']; href?: string; kind?: string },
  methods: readonly PurchaseMethod[],
) {
  return (
    (!content.purchaseMethodKind || isPurchaseKindEnabled(methods, content.purchaseMethodKind)) &&
    (content.kind !== 'cheque' || isPurchaseKindEnabled(methods, 'cheque')) &&
    (!content.href || isPurchaseHrefEnabled(content.href, methods))
  );
}

/** Preserve the CMS tree and historical account routes; remove only unavailable promotions. */
export function filterPurchaseMenu(
  items: readonly MenuItem[],
  methods: readonly PurchaseMethod[],
): MenuItem[] {
  return items.flatMap((item) => {
    if (!isPurchaseContentEnabled(item, methods)) return [];
    if (!item.children) return [item];
    const children = filterPurchaseMenu(item.children, methods);
    return item.children.length && !children.length && item.href === '#'
      ? []
      : [{ ...item, children }];
  });
}

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
