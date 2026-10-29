import 'server-only';
import { getStorefront } from './storefront-data';
import { offlineCatalog } from './offline-catalog';
import { offlineCatalogSchema } from './offline-contract';
import { fetchOfflineProjection } from './offline-projection';
import type { Locale } from './types';
export async function getOfflineCatalog(locale: Locale, signal?: AbortSignal) {
  const base = process.env.SHOP_API_URL;
  const mode = process.env.SHOP_DATA_MODE ?? (base ? 'api' : 'preview');
  if (mode === 'preview')
    return offlineCatalogSchema.parse(offlineCatalog(await getStorefront(locale, true), locale));
  if (mode !== 'api' || !base) throw new Error('Configure SHOP_API_URL for API mode.');
  return fetchOfflineProjection(base, locale, fetch, signal);
}
