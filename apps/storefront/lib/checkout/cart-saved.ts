import { z } from '@sayman/web-shared/lib/config/schema-runtime.ts';
import type { CartLine } from '@sayman/web-shared/lib/shared/types.ts';
import { cartInputSchema } from './cart-contract.ts';

const lines = cartInputSchema.shape.lines;
const savedCartSchema = z
  .object({
    items: lines.refine(
      (items) =>
        new Set(items.map(({ variantId }) => variantId.toLowerCase())).size === items.length,
    ),
    pending: z
      .object({ kind: z.enum(['save', 'restore']), line: lines.element })
      .strict()
      .optional(),
  })
  .strict();

export type SavedCart = z.infer<typeof savedCartSchema>;
export const savedCartKey = (owner: string) => `sayman:cart-saved:v1:${owner}`;

export class SavedCartError extends Error {
  readonly reason: 'storage' | 'limit' | 'changed';
  constructor(reason: SavedCartError['reason']) {
    super(reason);
    this.reason = reason;
  }
}

export function readSavedCart(storage: Pick<Storage, 'getItem'>, key: string): SavedCart {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return { items: [] };
    if (raw.length > 12000) throw new Error('Saved cart size exceeded');
    return savedCartSchema.parse(JSON.parse(raw));
  } catch {
    throw new SavedCartError('storage');
  }
}

export function writeSavedCart(storage: Pick<Storage, 'setItem'>, key: string, value: SavedCart) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    throw new SavedCartError('storage');
  }
}

export function sameSavedVariant(first: string, second: string) {
  return first.toLowerCase() === second.toLowerCase();
}

function getLine(lines: CartLine[], variantId: string) {
  return lines.find((line) => sameSavedVariant(line.variantId, variantId));
}

export function withoutSavedVariant(lines: CartLine[], variantId: string) {
  return lines.filter((line) => !sameSavedVariant(line.variantId, variantId));
}

// The same SKU keeps the larger quantity so a retry cannot add it twice.
function keepLargerQuantity(lines: CartLine[], line: CartLine) {
  const existing = getLine(lines, line.variantId);
  if (!existing) return [...lines, line];
  if (existing.quantity >= line.quantity) return lines;
  return lines.map((old) => (old === existing ? { ...old, quantity: line.quantity } : old));
}

// After a lost PUT response the current server cart can confirm the move.
export function settleSavedCart(state: SavedCart, cart: CartLine[]): SavedCart {
  const { items, pending } = state;
  if (!pending) return state;
  const { line, kind } = pending;
  const inCart = getLine(cart, line.variantId);
  if (kind === 'save' && !inCart) return { items: keepLargerQuantity(items, line) };
  if (kind === 'restore' && inCart && inCart.quantity >= line.quantity)
    return { items: withoutSavedVariant(items, line.variantId) };
  return { items };
}

export function prepareSavedCartMove(
  state: SavedCart,
  cart: CartLine[],
  kind: 'save' | 'restore',
  variantId: string,
) {
  const line = getLine(kind === 'save' ? cart : state.items, variantId);
  if (!line) throw new SavedCartError('changed');
  if (kind === 'save' && state.items.length >= 64 && !getLine(state.items, variantId))
    throw new SavedCartError('limit');
  return {
    journal: { items: state.items, pending: { kind, line } },
    lines: kind === 'save' ? withoutSavedVariant(cart, variantId) : keepLargerQuantity(cart, line),
  };
}
