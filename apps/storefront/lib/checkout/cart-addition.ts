import type { CartLine } from '@sayman/web-shared/lib/shared/types.ts';
// The server normalizes variant identifiers before enforcing uniqueness.
// Match that identity when a public product retains a different spelling.
export function addCartSelection(
  lines: CartLine[],
  variantId: string,
  quantity: number,
): CartLine[] {
  const key = variantId.toLowerCase(),
    old = lines.find((line) => line.variantId.toLowerCase() === key);
  const next = (old?.quantity ?? 0) + quantity;
  return old
    ? lines.map((line) =>
        line.variantId.toLowerCase() === key ? { variantId: line.variantId, quantity: next } : line,
      )
    : [...lines, { variantId, quantity }];
}
