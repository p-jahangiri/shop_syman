import 'server-only';
import { getStorefront } from '../data/storefront-data';
import { offlineCatalog } from './offline-catalog';
import { offlineCatalogSchema } from './offline-contract';
import { fetchOfflineProjection } from './offline-projection';
import { resolveBrandColors } from '@sayman/web-shared/lib/content/brand-colors.ts';
import type { Locale } from '@sayman/web-shared/lib/shared/types.ts';
export async function getOfflineCatalog(locale: Locale, signal?: AbortSignal) {
  const base = process.env.SHOP_API_URL;
  const mode = process.env.SHOP_DATA_MODE ?? (base ? 'api' : 'preview');
  const catalog =
    mode === 'preview'
      ? offlineCatalogSchema.parse(offlineCatalog(await getStorefront(locale, true), locale))
      : mode === 'api' && base
        ? await fetchOfflineProjection(base, locale, fetch, signal)
        : null;
  if (!catalog) throw new Error('Configure SHOP_API_URL for API mode.');
  if (!catalog.site.primary) return catalog;
  // The lightweight page uses one light-theme color for links and white-text buttons.
  return {
    ...catalog,
    site: { ...catalog.site, primary: resolveBrandColors('light', catalog.site.primary).accent },
  };
}
