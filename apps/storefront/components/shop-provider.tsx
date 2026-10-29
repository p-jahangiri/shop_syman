'use client';
import type { ReactNode } from 'react';
import { useStorefront } from './locale-provider';
import { PreviewShopProvider } from './preview-shop-provider';
import { ConnectedShopProvider } from './connected-shop-provider';
import { SourcingProvider } from './sourcing-provider';
export { useShop } from './shop-context';
export function ShopProvider({ children }: { children: ReactNode }) {
  return useStorefront().dataSource === 'api' ? (
    <ConnectedShopProvider>
      <SourcingProvider>{children}</SourcingProvider>
    </ConnectedShopProvider>
  ) : (
    <PreviewShopProvider>{children}</PreviewShopProvider>
  );
}
