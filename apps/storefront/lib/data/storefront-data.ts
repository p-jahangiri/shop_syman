import 'server-only';
import { cache } from 'react';
import { storefrontSnapshot } from './fixtures';
import { localizeData } from '../navigation/i18n';
import { snapshotSchema } from './snapshot';
import type { Locale, StorefrontSnapshot } from '@sayman/web-shared/lib/shared/types.ts';
export const getStorefront = cache(
  async (locale: Locale, includeProducts = false): Promise<StorefrontSnapshot> => {
    const base = process.env.SHOP_API_URL;
    const mode = process.env.SHOP_DATA_MODE ?? (base ? 'api' : 'preview');
    if (mode === 'preview') {
      if (process.env.NODE_ENV === 'production' && process.env.SHOP_ENABLE_PREVIEW !== 'true')
        throw new Error(
          'Preview fixtures require explicit SHOP_ENABLE_PREVIEW=true in production builds.',
        );
      const data = localizeData(storefrontSnapshot, locale);
      return { ...data, products: includeProducts ? data.products : [], locale };
    }
    if (mode !== 'api' || !base) throw new Error('Configure SHOP_API_URL for API mode.');
    const response = await fetch(
      `${base.replace(/\/$/, '')}/api/storefront/${locale}${includeProducts ? '' : '?metadataOnly=true'}`,
      { cache: 'no-store', signal: AbortSignal.timeout(8000) },
    );
    if (!response.ok) throw new Error(`Storefront API unavailable (${response.status}).`);
    const parsed = snapshotSchema.parse(await response.json());
    if (
      parsed.locale !== locale ||
      parsed.dataSource !== 'api' ||
      (!includeProducts && parsed.products.length > 0)
    )
      throw new Error('Storefront API returned a mismatched snapshot.');
    return parsed as StorefrontSnapshot;
  },
);
