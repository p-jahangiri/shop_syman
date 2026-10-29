'use client';
import { createContext, useContext } from 'react';
import type { CartLine, Product } from '@/lib/types';
import type { ServerCartV2 as ServerCart } from '@/lib/cart-v2-contract';
import type { CartCommand } from '@/lib/cart-conversion-contract';
import type { CartCommandMode, pendingCartCommand } from '@/lib/cart-command-runner';
export type ShopContextType = {
  cart: CartLine[];
  wishlist: string[];
  compare: string[];
  ready: boolean;
  preferencesReady: boolean;
  wishlistStatus?: {
    ready: boolean;
    busy: boolean;
    failed: boolean;
    retry: () => void;
    guestWishlist: string[];
    importGuest: (ids?: string[]) => Promise<boolean>;
    account: boolean;
    issue: string | null;
  };
  loadError: boolean;
  retry: () => void;
  cartOpen: boolean;
  setCartOpen: (v: boolean) => void;
  add: (variantId: string, quantity?: number, product?: Product) => void;
  quantity: (id: string, n: number) => void;
  clearCart: () => void;
  toggleWish: (id: string, product?: Product) => void;
  toggleCompare: (id: string, product?: Product) => void;
  notify: (message: string) => void;
  serverCart: ServerCart | null;
  cartBusy: boolean;
  cartIssue: boolean;
  quoteReviewIssue: boolean;
  removeAcceptedGroup?: (agreementId: string, version: string) => Promise<boolean>;
  sendCartCommand?: (command: CartCommand, mode?: CartCommandMode) => Promise<boolean>;
  cartCommand?: ReturnType<typeof pendingCartCommand>;
};
export const ShopContext = createContext<ShopContextType | null>(null);
export function useShop() {
  const value = useContext(ShopContext);
  if (!value) throw new Error('ShopProvider missing');
  return value;
}
