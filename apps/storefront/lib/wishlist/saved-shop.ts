import type { CartLine, Product } from '@sayman/web-shared/lib/shared/types.ts';
import { sanitizeCart } from '@sayman/web-shared/lib/shared/commerce.ts';
export interface SavedComparison {
  compare: string[];
  compareVariants?: Record<string, string>;
}
export interface SavedShop extends SavedComparison {
  cart: CartLine[];
  wishlist: string[];
}
const variantReference = (id: unknown): id is string =>
  typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);

function comparisonFor(compare: string[], raw: unknown): SavedComparison {
  const values = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const entries = compare.flatMap((id) =>
    Object.hasOwn(values, id) && variantReference(values[id]) ? [[id, values[id]]] : [],
  );
  return entries.length ? { compare, compareVariants: Object.fromEntries(entries) } : { compare };
}

export function changeSavedComparison(
  current: SavedComparison,
  id: string,
  action: 'add' | 'remove' | 'variant',
  variantId?: string,
): SavedComparison {
  if (action === 'remove')
    return comparisonFor(
      current.compare.filter((item) => item !== id),
      current.compareVariants,
    );
  if (action === 'variant' && (!current.compare.includes(id) || !variantReference(variantId)))
    return current;
  if (action === 'add' && (current.compare.length >= 4 || current.compare.includes(id)))
    return current;
  const compare = action === 'add' ? [...current.compare, id] : current.compare;
  return comparisonFor(compare, {
    ...current.compareVariants,
    ...(variantReference(variantId) ? { [id]: variantId } : {}),
  });
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
    ...comparisonFor(ids(value.compare, 4), value.compareVariants),
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
    ...comparisonFor(
      compare.filter((id) => products.find((p) => p.id === id)?.category === category),
      saved.compareVariants,
    ),
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
