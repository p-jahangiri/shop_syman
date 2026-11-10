import type { Product, Variant } from '@sayman/web-shared/lib/shared/types.ts';

export const insuranceAttributeKey = 'insurance';

export function productInsurance(
  product: Pick<Product, 'attributes'>,
  variant: Pick<Variant, 'attributes'>,
) {
  return (
    variant.attributes?.[insuranceAttributeKey]?.trim() ||
    product.attributes[insuranceAttributeKey]?.trim()
  );
}
