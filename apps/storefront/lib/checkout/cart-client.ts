import {
  cartInputSchema,
  cartSnapshotSchema,
  type ServerCart,
  type CartInput,
} from './cart-contract.ts';
import type { CartLine, Product, MoneyRial } from '@sayman/web-shared/lib/shared/types.ts';
export class CartError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
export type CartFetch = (path: string, init: RequestInit) => Promise<Response>;
export async function requestCart(
  fetcher: CartFetch,
  locale: 'fa' | 'en',
  method: 'GET' | 'PUT' | 'POST' = 'GET',
  input?: CartInput,
  signal?: AbortSignal,
): Promise<ServerCart> {
  const response = await fetcher(`/api/cart/${locale}${method === 'POST' ? '/merge' : ''}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body:
      method === 'POST' ? '{}' : input ? JSON.stringify(cartInputSchema.parse(input)) : undefined,
    signal,
  });
  if (!response.ok) {
    let code = 'cart_unavailable';
    try {
      const error = await response.json();
      if (typeof error.title === 'string') code = error.title;
    } catch {
      /* No raw response body is displayed. */
    }
    throw new CartError(code, response.status);
  }
  const cart = cartSnapshotSchema.parse(await response.json());
  if (cart.locale !== locale) throw new CartError('cart_unavailable', 503);
  return cart;
}
let cartQueue: Promise<unknown> = Promise.resolve();
export function withCartLock<T>(run: () => Promise<T>): Promise<T> {
  const next = cartQueue.then(() =>
    typeof navigator !== 'undefined' && navigator.locks
      ? navigator.locks.request('sayman-customer-cart', run)
      : run(),
  );
  cartQueue = next.catch(() => {});
  return next;
}
export function serverCartProducts(cart: ServerCart, products: Product[]): Product[] {
  const lines = new Map(cart.lines.map((l) => [l.variantId, l]));
  return products.map((product) => ({
    ...product,
    variants: product.variants.map((variant) => {
      const line = lines.get(variant.id);
      return line && line.unitPriceRial !== null
        ? { ...variant, priceRial: line.unitPriceRial as MoneyRial, stock: line.available }
        : variant;
    }),
  }));
}
// Legacy selections are the same browser's previous cart. Shared variants keep
// the larger quantity, so retrying after a lost response never adds them twice.
export function combineLegacyCart(current: CartLine[], legacy: CartLine[]): CartLine[] {
  const quantities = new Map(current.map((l) => [l.variantId, l.quantity]));
  for (const line of legacy)
    quantities.set(line.variantId, Math.max(quantities.get(line.variantId) ?? 0, line.quantity));
  const parsed = cartInputSchema.safeParse({
    lines: [...quantities].map(([variantId, quantity]) => ({ variantId, quantity })),
    version: null,
  });
  if (!parsed.success) throw new CartError('cart_limit', 400);
  return parsed.data.lines;
}
