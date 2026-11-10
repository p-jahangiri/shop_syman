import type { CartLine, Product } from '@sayman/web-shared/lib/shared/types.ts';
import { findVariant } from '@sayman/web-shared/lib/shared/commerce.ts';
import type { ServerCartV2 } from './cart-v2-contract.ts';

export function cartDisplayTotals(
  cart: CartLine[],
  products: Product[],
  serverCart?: ServerCartV2 | null,
) {
  let total: bigint;
  let savings = 0n;
  if (serverCart) {
    if (
      serverCart.buySubtotalRial === null ||
      serverCart.ordinaryLines.some((line) => line.issue) ||
      serverCart.offerLines.some((line) => line.issue)
    )
      return null;

    total = BigInt(serverCart.buySubtotalRial);
    for (const line of serverCart.ordinaryLines) {
      if (line.compareAtRial === undefined || line.unitPriceRial === null) continue;
      savings += (BigInt(line.compareAtRial) - BigInt(line.unitPriceRial)) * BigInt(line.quantity);
    }
  } else {
    total = 0n;
    for (const line of cart) {
      const variant = findVariant(products, line.variantId)?.variant;
      if (!variant || variant.stock < line.quantity) return null;
      const price = BigInt(variant.priceRial);
      const previous = BigInt(variant.compareAtRial ?? variant.priceRial);
      const quantity = BigInt(line.quantity);
      total += price * quantity;
      if (previous > price) savings += (previous - price) * quantity;
    }
  }

  return { beforeDiscounts: total + savings, savings, total };
}
