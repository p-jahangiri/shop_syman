import { catalogInputSchema, type CatalogQuery, type CatalogFilters } from './catalog-contract.ts';
import { normalizePersian } from './commerce.ts';
import { parseToman } from './money.ts';

type CatalogPriceRange = Pick<CatalogQuery, 'minPriceRial' | 'maxPriceRial'>;
export type CatalogPriceRangeResult =
  { ok: true; value: CatalogPriceRange } | { ok: false; error: 'minimum' | 'maximum' | 'order' };

function priceInput(value: string): bigint | undefined {
  return parseToman(normalizePersian(value).replace(/[ ,٬]/g, '').replace('٫', '.'));
}

// A blank bound removes it; zero remains an explicit, valid price. Keep every
// conversion in bigint so the final rial survives beyond Number's safe range.
export function parseCatalogPriceRange(
  minToman: string,
  maxToman: string,
): CatalogPriceRangeResult {
  const min = minToman.trim() ? priceInput(minToman) : undefined;
  const max = maxToman.trim() ? priceInput(maxToman) : undefined;
  if (minToman.trim() && min === undefined) return { ok: false, error: 'minimum' };
  if (maxToman.trim() && max === undefined) return { ok: false, error: 'maximum' };
  if (min !== undefined && max !== undefined && min > max) return { ok: false, error: 'order' };
  return { ok: true, value: { minPriceRial: min?.toString(), maxPriceRial: max?.toString() } };
}

// Query contracts permit padded decimal strings. Treat them as the same bound
// without making an absent maximum equivalent to the explicit maximum of zero.
export function areCatalogPriceRangesEqual(
  left: CatalogPriceRange,
  right: CatalogPriceRange,
): boolean {
  const equal = (a: string | undefined, b: string | undefined) =>
    a === undefined || b === undefined ? a === b : BigInt(a) === BigInt(b);
  return (
    equal(left.minPriceRial, right.minPriceRial) && equal(left.maxPriceRial, right.maxPriceRial)
  );
}

export type CatalogQueryChange =
  Partial<CatalogQuery> | ((latest: CatalogQuery) => Partial<CatalogQuery>);

// Category metadata can include specifications that exist only on market-only
// models. Keep an empty facet only when it contains a choice the user must clear.
export function visibleCatalogFacets(
  attributes: CatalogFilters['attributes'],
  selected: CatalogQuery['attributes'],
): CatalogFilters['attributes'] {
  return attributes.filter(
    (facet) =>
      facet.total > 0 ||
      facet.values.length > 0 ||
      selected.some((choice) => choice.key === facet.key && choice.values.length > 0),
  );
}

// Callers retain this returned value as the latest intended query, then compose
// the next change against it even while an earlier navigation is in flight.
export function patchCatalogQuery(latest: CatalogQuery, change: CatalogQueryChange): CatalogQuery {
  const patch = typeof change === 'function' ? change(latest) : change;
  return catalogInputSchema.parse({ ...latest, page: 1, ...patch });
}

type SearchMetadata = {
  dataType?: CatalogFilters['attributes'][number]['dataType'];
  total?: number;
  truncated?: boolean;
  totalPages?: number;
};

export function catalogFilterNeedsSearch(
  optionCount: number,
  metadata: SearchMetadata = {},
): boolean {
  return (
    metadata.dataType !== 'bool' &&
    (optionCount > 8 ||
      (metadata.total ?? optionCount) > 8 ||
      metadata.truncated === true ||
      (metadata.totalPages ?? 1) > 1)
  );
}
