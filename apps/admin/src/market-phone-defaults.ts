import type { Catalog } from './types.ts';
import type { MarketDetails, MarketModelInput } from './market-contract.ts';

// Metadata owns these identities. Never select an unrelated first category or
// brand merely to make the creation form look complete.
export function marketPhoneScope(catalog: Catalog) {
  const category = catalog.categories.find((value) => value.isActive && value.slug === 'phones');
  const brand = catalog.brands.find((value) => value.isActive && value.slug === 'samsung');
  return { category, brand, ready: !!category && !!brand };
}
export function newMarketPhoneModel(catalog: Catalog): MarketModelInput {
  const { category, brand } = marketPhoneScope(catalog);
  return {
    categoryId: category?.id ?? '',
    brandId: brand?.id ?? '',
    slug: '',
    translations: [
      { locale: 'fa', name: '', description: '' },
      { locale: 'en', name: '', description: '' },
    ],
    attributes: [],
    imageUrls: [],
    version: null,
  };
}
export function newMarketPhoneDetails(sourceItemKey: string): MarketDetails {
  return {
    status: 'Draft',
    sourceKey: 'manual',
    sourceItemKey,
    sourceNameFa: 'ثبت داخلی مدل',
    sourceNameEn: 'Internal model entry',
    sourceUrl: null,
    availability: 'unknown',
    observedAt: null,
    validUntil: null,
    referencePriceRial: null,
    isDemo: false,
  };
}
