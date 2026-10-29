import type { HomeBlock, Product } from './types.ts';

/** The start is inclusive and the end exclusive. Invalid dates fail closed. */
export function activeHomeBlocks(blocks: HomeBlock[], now: number): HomeBlock[] {
  return blocks.filter(
    (block) =>
      block.enabled &&
      (!block.startsAt || Date.parse(block.startsAt) <= now) &&
      (!block.endsAt || Date.parse(block.endsAt) > now),
  );
}

/** Missing/unpublished products stay absent. A curated list never falls back to the catalogue. */
export function curatedProducts(block: HomeBlock, records: Product[], limit = 24): Product[] {
  const byId = new Map(records.map((product) => [product.id, product]));
  return [...new Set(block.productIds ?? [])]
    .flatMap((id) => {
      const product = byId.get(id);
      return product && (!block.categoryId || product.category === block.categoryId)
        ? [product]
        : [];
    })
    .slice(0, limit);
}
