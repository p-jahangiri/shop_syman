import {
  facetInputSchema,
  facetPageSchema,
  type FacetQuery,
  lookupInputSchema,
  lookupResponseSchema,
  catalogInputSchema,
  catalogPageMatchesCondition,
  catalogSearchPageSchema,
  catalogFiltersSchema,
  type ProductLookup,
  type CatalogQuery,
} from './catalog-contract';
import type { Locale } from '@sayman/web-shared/lib/shared/types.ts';
async function read(locale: Locale, path: string, body?: unknown, signal?: AbortSignal) {
  const response = await fetch(`/api/catalog/${locale}/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
    credentials: 'omit',
    signal,
  });
  if (!response.ok) throw new Error('catalog_unavailable');
  return response.json();
}
export async function lookupProducts(
  locale: Locale,
  input: Partial<ProductLookup>,
  signal?: AbortSignal,
) {
  const refs = lookupInputSchema.parse(input);
  const result = lookupResponseSchema.parse(await read(locale, 'lookup', refs, signal));
  if (result.locale !== locale) throw new Error('catalog_locale_mismatch');
  return result.products;
}
export async function searchProducts(
  locale: Locale,
  input: Partial<CatalogQuery>,
  signal?: AbortSignal,
) {
  const query = catalogInputSchema.parse(input);
  const result = catalogSearchPageSchema.parse(await read(locale, 'search', query, signal));
  if (
    result.locale !== locale ||
    result.page !== query.page ||
    result.pageSize !== query.pageSize ||
    !catalogPageMatchesCondition(result, query.condition)
  )
    throw new Error('catalog_page_mismatch');
  return result;
}
export async function readCatalogFilters(
  locale: Locale,
  categoryId?: string,
  signal?: AbortSignal,
) {
  return catalogFiltersSchema.parse(
    await read(
      locale,
      `filters${categoryId ? `?categoryId=${encodeURIComponent(categoryId)}` : ''}`,
      undefined,
      signal,
    ),
  );
}

export async function readFacetValues(
  locale: Locale,
  input: Partial<FacetQuery>,
  signal?: AbortSignal,
) {
  const query = facetInputSchema.parse(input);
  const page = facetPageSchema.parse(await read(locale, 'facet-values', query, signal));
  if (
    page.locale !== locale ||
    page.key !== query.key ||
    page.page !== query.page ||
    page.pageSize !== query.pageSize
  )
    throw new Error('facet_page_mismatch');
  return page;
}
