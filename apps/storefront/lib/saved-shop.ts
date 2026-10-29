import type { CartLine, Product } from './types.ts';
import { sanitizeCart } from './commerce.ts';
export interface SavedShop {
  cart: CartLine[];
  wishlist: string[];
  compare: string[];
}
export function parseSavedShop(input: unknown): SavedShop {
  const value = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const ids = (raw: unknown, max: number) =>
    Array.isArray(raw)
      ? Array.from(
          new Set(
            raw.filter(
              (id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 64,
            ),
          ),
        ).slice(0, max)
      : [];
  const cart: CartLine[] = [];
  if (Array.isArray(value.cart))
    for (const item of value.cart.slice(0, 200)) {
      if (
        item &&
        typeof item === 'object' &&
        typeof item.variantId === 'string' &&
        item.variantId.length > 0 &&
        item.variantId.length <= 64 &&
        Number.isSafeInteger(item.quantity) &&
        item.quantity > 0
      )
        cart.push({ variantId: item.variantId, quantity: Math.min(item.quantity, 1000000) });
    }
  return {
    cart: cart.slice(0, 100),
    wishlist: ids(value.wishlist, 200),
    compare: ids(value.compare, 4),
  };
}
export function savedLookupBatches(saved: SavedShop) {
  const refs = [...new Set(saved.cart.map((l) => l.variantId))]
    .map((id) => ({ kind: 'variantIds' as const, id }))
    .concat();
  const products = Array.from(new Set([...saved.wishlist, ...saved.compare])).map((id) => ({
    kind: 'productIds' as const,
    id,
  }));
  const all: { kind: 'productIds' | 'variantIds'; id: string }[] = [...refs, ...products];
  const batches: { productIds: string[]; variantIds: string[] }[] = [];
  for (let start = 0; start < all.length; start += 64) {
    const batch = { productIds: [] as string[], variantIds: [] as string[] };
    for (const ref of all.slice(start, start + 64)) batch[ref.kind].push(ref.id);
    batches.push(batch);
  }
  return batches;
}
export function hydrateSavedShop(saved: SavedShop, products: Product[]): SavedShop {
  const ids = new Set(products.map((p) => p.id));
  const compare = saved.compare.filter((id) => ids.has(id));
  const category = products.find((p) => p.id === compare[0])?.category;
  return {
    cart: sanitizeCart(saved.cart, products),
    wishlist: saved.wishlist.filter((id) => ids.has(id)),
    compare: compare.filter((id) => products.find((p) => p.id === id)?.category === category),
  };
}
export async function resolveSavedShop(
  saved: SavedShop,
  lookup: (refs: { productIds: string[]; variantIds: string[] }) => Promise<Product[]>,
) {
  const products: Product[] = [];
  for (const batch of savedLookupBatches(saved)) products.push(...(await lookup(batch)));
  const unique = Array.from(new Map(products.map((p) => [p.id, p])).values());
  return { products: unique, saved: hydrateSavedShop(saved, unique) };
}
