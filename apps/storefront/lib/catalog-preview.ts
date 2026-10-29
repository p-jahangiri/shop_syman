// Explicit fixture adapter. Never used as fallback after a live API failure.
import { createHash } from 'node:crypto';
import { storefrontSnapshot } from './fixtures.ts';
import { localizeData } from './i18n.ts';
import { normalizePersian, matchesSearch } from './commerce.ts';
import type { Locale, Product } from './types.ts';
import type {
  CatalogFilters,
  CatalogQuery,
  CatalogPage,
  ProductLookup,
  FacetQuery,
  FacetPage,
} from './catalog-contract.ts';
const optionId = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 24);
const base = storefrontSnapshot;
const canonical = (p: Product, v: Product['variants'][number], key: string) =>
  v.attributes?.[key] ?? p.attributes[key];
function valueId(p: Product, v: Product['variants'][number], key: string) {
  const raw = canonical(p, v, key);
  const type = base.attributeDefinitions.find((a) => a.key === key)?.dataType;
  return raw && type === 'select' ? optionId(raw) : raw;
}
export function previewLookup(locale: Locale, refs: ProductLookup) {
  const data = localizeData(base, locale);
  return {
    version: 1 as const,
    locale,
    products: data.products.filter(
      (p) =>
        refs.productIds.includes(p.id) ||
        refs.slugs.includes(p.slug) ||
        p.variants.some((v) => refs.variantIds.includes(v.id)),
    ),
  };
}
export function previewPage(locale: Locale, input: CatalogQuery): CatalogPage {
  const localized = localizeData(base, locale);
  const matches = base.products.flatMap((p, index) => {
    if (
      (input.categoryId && input.categoryId !== p.category) ||
      (input.query && !matchesSearch(p, input.query)) ||
      (input.brandIds.length && !input.brandIds.includes(p.brand.toLowerCase()))
    )
      return [];
    const variants = p.variants.filter(
      (v) =>
        (!input.availableOnly || v.stock > 0) &&
        (!input.minPriceRial || BigInt(v.priceRial) >= BigInt(input.minPriceRial)) &&
        (!input.maxPriceRial || BigInt(v.priceRial) <= BigInt(input.maxPriceRial)) &&
        input.attributes.every((a) => a.values.includes(valueId(p, v, a.key))),
    );
    if (!variants.length) return [];
    variants.sort(
      (a, b) =>
        Number(b.stock > 0) - Number(a.stock > 0) ||
        (BigInt(a.priceRial) < BigInt(b.priceRial)
          ? -1
          : BigInt(a.priceRial) > BigInt(b.priceRial)
            ? 1
            : a.id.localeCompare(b.id)),
    );
    return [
      {
        product: localized.products.find((item) => item.id === p.id)!,
        variant: variants[0],
        index,
      },
    ];
  });
  matches.sort((a, b) => {
    if (input.sort.startsWith('price-')) {
      const x = BigInt(a.variant.priceRial),
        y = BigInt(b.variant.priceRial);
      return (
        (x === y ? 0 : x < y ? -1 : 1) * (input.sort === 'price-desc' ? -1 : 1) ||
        a.product.id.localeCompare(b.product.id)
      );
    }
    return input.sort === 'newest'
      ? b.index - a.index
      : Number(!!b.product.featured) - Number(!!a.product.featured) || b.index - a.index;
  });
  const page = matches.slice((input.page - 1) * input.pageSize, input.page * input.pageSize);
  return {
    version: 1,
    locale,
    products: page.map((p) => p.product),
    matchingVariantIds: Object.fromEntries(page.map((p) => [p.product.id, p.variant.id])),
    total: matches.length,
    page: input.page,
    pageSize: input.pageSize,
    totalPages: Math.ceil(matches.length / input.pageSize),
  };
}
export function previewFilters(locale: Locale, categoryId?: string, limit = 20): CatalogFilters {
  const source = base.products.filter((p) => !categoryId || p.category === categoryId);
  const localized = localizeData(base, locale);
  const category = localized.categories.find((c) => c.key === categoryId);
  return {
    brands: [...new Set(source.map((p) => p.brand))].map((name) => ({
      id: name.toLowerCase(),
      name,
    })),
    maxPriceRial: source.length
      ? source
          .flatMap((p) => p.variants)
          .reduce((n, v) => (BigInt(v.priceRial) > n ? BigInt(v.priceRial) : n), 0n)
          .toString()
      : undefined,
    attributes: (category?.filters ?? []).map((f) => {
      const definition = base.attributeDefinitions.find((d) => d.key === f.key);
      const pairs = new Map<string, string>();
      for (const p of source)
        for (const v of p.variants) {
          const raw = canonical(p, v, f.key);
          const translated = localized.products.find((item) => item.id === p.id)!;
          const variant = translated.variants.find((a) => a.id === v.id)!;
          if (raw) pairs.set(valueId(p, v, f.key), canonical(translated, variant, f.key) ?? raw);
        }
      return {
        key: f.key,
        label: f.label,
        dataType: definition?.dataType ?? 'text',
        unit: definition?.unit,
        values: [...pairs].slice(0, limit).map(([value, label]) => ({ value, label })),
        truncated: pairs.size > limit,
        total: pairs.size,
      };
    }),
  };
}

export function pageFacetValues(
  locale: Locale,
  key: string,
  values: { value: string; label: string }[],
  input: FacetQuery,
  searchLabels: Record<string, string> = {},
): FacetPage {
  const tokens = normalizePersian(input.query ?? '')
    .split(' ')
    .filter(Boolean);
  const matching = values.filter((v) =>
    tokens.every((term) =>
      normalizePersian(`${v.value} ${v.label} ${searchLabels[v.value] ?? ''}`).includes(term),
    ),
  );
  return {
    version: 1,
    locale,
    key,
    values: matching.slice((input.page - 1) * input.pageSize, input.page * input.pageSize),
    selectedValues: values.filter((v) => input.selectedValues.includes(v.value)),
    total: matching.length,
    page: input.page,
    pageSize: input.pageSize,
    totalPages: Math.ceil(matching.length / input.pageSize),
  };
}
export function previewFacetPage(locale: Locale, input: FacetQuery): FacetPage {
  const facet = previewFilters(locale, input.categoryId, Number.MAX_SAFE_INTEGER).attributes.find(
    (a) => a.key === input.key,
  );
  if (!facet) throw new Error('unknown_catalog_filter');
  const other = previewFilters(
    locale === 'fa' ? 'en' : 'fa',
    input.categoryId,
    Number.MAX_SAFE_INTEGER,
  ).attributes.find((a) => a.key === input.key)!;
  if (facet.dataType === 'number' && input.query) {
    const prefix = normalizePersian(input.query);
    const values = facet.values.filter((v) => normalizePersian(v.value).startsWith(prefix));
    const page = pageFacetValues(locale, input.key, values, { ...input, query: undefined }, {});
    return {
      ...page,
      selectedValues: facet.values.filter((v) => input.selectedValues.includes(v.value)),
    };
  }
  return pageFacetValues(
    locale,
    input.key,
    facet.values,
    input,
    Object.fromEntries(other.values.map((v) => [v.value, v.label])),
  );
}
