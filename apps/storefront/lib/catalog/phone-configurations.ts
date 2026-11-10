import { normalizePersian } from '@sayman/web-shared/lib/shared/commerce.ts';
import type { Product, Variant } from '@sayman/web-shared/lib/shared/types.ts';

function phoneColorKey(variant: Variant) {
  return normalizePersian(variant.colorName);
}

export function phoneConfigurations(product: Product) {
  // A unique physical unit must always retain its individual SKU selector.
  if (product.variants.some((variant) => variant.usedCondition) && product.variants.length > 1)
    return null;

  const configurations = new Map<string, { specs: Record<string, string>; variants: Variant[] }>();
  for (const variant of product.variants) {
    const entries = Object.entries({ ...product.attributes, ...variant.attributes }).filter(
      ([key]) => key !== 'color',
    );
    const key = JSON.stringify(
      [...entries].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
    );
    const configuration = configurations.get(key);
    if (configuration) configuration.variants.push(variant);
    else configurations.set(key, { specs: Object.fromEntries(entries), variants: [variant] });
  }

  const groups = [...configurations.values()].map(({ specs, variants }) => {
    const colors = variants.map(phoneColorKey);
    return {
      id: variants[0].id,
      specs,
      variants,
      colorOnly:
        colors.every(Boolean) &&
        new Set(colors).size === variants.length &&
        variants.every(({ color }) => /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color)),
    };
  });
  if (!groups.some((group) => group.colorOnly)) return null;

  const keys = new Set(groups.flatMap((group) => Object.keys(group.specs)));
  const differingKeys = [...keys].filter((key) =>
    groups.some((group) => group.specs[key] !== groups[0].specs[key]),
  );
  const configurationKeys = [
    ...['storage', 'ram'].filter((key) => keys.has(key)),
    ...differingKeys.filter((key) => key !== 'storage' && key !== 'ram'),
  ];
  return { groups, configurationKeys, isPhone: product.category === 'phones' };
}

export function choosePhoneConfiguration(variants: Variant[], previous: Variant) {
  const color = phoneColorKey(previous);
  const sameColor = color ? variants.filter((variant) => phoneColorKey(variant) === color) : [];
  return (
    sameColor.find((v) => v.stock > 0) ??
    variants.find((v) => v.stock > 0) ??
    sameColor[0] ??
    variants[0]
  );
}
