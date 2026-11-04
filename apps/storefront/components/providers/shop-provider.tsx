'use client';
import type { ReactNode } from 'react';
import { useStorefront } from '../navigation/locale-provider';
import { PreviewShopProvider } from './preview-shop-provider';
import { ConnectedShopProvider } from './connected-shop-provider';
export { useShop } from './shop-context';
export function ShopProvider({ children }: { children: ReactNode }) {
  return useStorefront().dataSource === 'api' ? (
    <ConnectedShopProvider>{children}</ConnectedShopProvider>
  ) : (
    <PreviewShopProvider>{children}</PreviewShopProvider>
  );
}
