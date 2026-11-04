import type { Product, Variant, Locale } from '@sayman/web-shared/lib/shared/types.ts';
import type { UsedCondition } from '@sayman/web-shared/lib/catalog/used-condition-contract.ts';

export function inspectionGalleryKey(variant: Pick<Variant, 'id' | 'usedCondition'>) {
  return `${variant.id}:${variant.usedCondition?.inspectionId ?? 'catalog'}`;
}
export function productInspectionImages(
  product: Pick<Product, 'name' | 'image' | 'images'>,
  condition: UsedCondition | undefined,
  locale: Locale,
) {
  if (condition?.photos?.length)
    return condition.photos.map((photo) => ({
      url: photo.url,
      alt: locale === 'fa' ? photo.altFa : photo.altEn,
      source: 'inspection' as const,
    }));
  return (product.images?.length ? product.images : [product.image]).map((url) => ({
    url,
    alt: product.name,
    source: 'catalog' as const,
  }));
}
