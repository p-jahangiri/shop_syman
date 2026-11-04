import 'server-only';
import {
  facetInputSchema,
  facetPageSchema,
  type FacetQuery,
  catalogFiltersSchema,
  catalogInputSchema,
  catalogPageSchema,
  catalogPageMatchesCondition,
  lookupInputSchema,
  lookupResponseSchema,
  lookupReferencesProduct,
  catalogConditionSchema,
  type CatalogCondition,
  type CatalogQuery,
  type ProductLookup,
} from './catalog-contract';
import { previewFacetPage, previewFilters, previewLookup, previewPage } from './catalog-preview';
import { verifiedCatalogSuggestion } from './catalog-search-assist';
import type { Locale } from '@sayman/web-shared/lib/shared/types.ts';
export class CatalogServiceError extends Error {
  constructor(public status: number) {
    super('The catalogue service is unavailable.');
  }
}
function configuration() {
  const base = process.env.SHOP_API_URL;
  const mode = process.env.SHOP_DATA_MODE ?? (base ? 'api' : 'preview');
  if (mode === 'preview') {
    if (process.env.NODE_ENV === 'production' && process.env.SHOP_ENABLE_PREVIEW !== 'true')
      throw new CatalogServiceError(503);
    return { mode } as const;
  }
  if (mode !== 'api' || !base) throw new CatalogServiceError(503);
  return { mode, base: base.replace(/\/$/, '') } as const;
}
async function remote(locale: Locale, path: string, body?: unknown, signal?: AbortSignal) {
  const config = configuration();
  if (config.mode === 'preview') throw new CatalogServiceError(503);
  try {
    const response = await fetch(`${config.base}/api/catalog/${locale}/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
        : AbortSignal.timeout(8000),
    });
    if (!response.ok)
      throw new CatalogServiceError(
        [400, 404, 429].includes(response.status) ? response.status : 503,
      );
    return await response.json();
  } catch (error) {
    if (error instanceof CatalogServiceError) throw error;
    throw new CatalogServiceError(503);
  }
}
export async function getCatalogPage(
  locale: Locale,
  input: Partial<CatalogQuery> = {},
  signal?: AbortSignal,
) {
  const query = catalogInputSchema.parse(input);
  const result =
    configuration().mode === 'preview'
      ? previewPage(locale, query)
      : await remote(locale, 'search', query, signal);
  const checked = catalogPageSchema.safeParse(result);
  if (!checked.success) throw new CatalogServiceError(503);
  const page = checked.data;
  if (
    page.locale !== locale ||
    page.page !== query.page ||
    page.pageSize !== query.pageSize ||
    !catalogPageMatchesCondition(page, query.condition)
  )
    throw new CatalogServiceError(503);
  return page;
}
export async function getCatalogSearch(
  locale: Locale,
  input: Partial<CatalogQuery>,
  signal?: AbortSignal,
) {
  const query = catalogInputSchema.parse(input);
  const page = await getCatalogPage(locale, query, signal);
  const suggestion = await verifiedCatalogSuggestion(query, page, (alternate) => {
    const budget = AbortSignal.timeout(1250);
    return getCatalogPage(locale, alternate, signal ? AbortSignal.any([signal, budget]) : budget);
  }).catch((error: unknown) => {
    signal?.throwIfAborted();
    if (!(error instanceof CatalogServiceError)) throw error;
    // An optional probe cannot invalidate the successful primary search.
    return undefined;
  });
  return suggestion ? { ...page, suggestion } : { ...page, suggestion: undefined };
}
export async function getCatalogFilters(
  locale: Locale,
  categoryId?: string,
  signal?: AbortSignal,
  condition?: CatalogCondition,
) {
  catalogInputSchema.parse({ categoryId });
  const params = new URLSearchParams();
  if (categoryId) params.set('categoryId', categoryId);
  if (condition !== undefined) params.set('condition', catalogConditionSchema.parse(condition));
  const result =
    configuration().mode === 'preview'
      ? previewFilters(locale, categoryId, undefined, condition)
      : await remote(locale, `filters${params.size ? `?${params}` : ''}`, undefined, signal);
  const parsed = catalogFiltersSchema.safeParse(result);
  if (!parsed.success) throw new CatalogServiceError(503);
  return parsed.data;
}
export async function getCatalogProducts(
  locale: Locale,
  input: Partial<ProductLookup>,
  signal?: AbortSignal,
) {
  const refs = lookupInputSchema.parse(input);
  const result =
    configuration().mode === 'preview'
      ? previewLookup(locale, refs)
      : await remote(locale, 'lookup', refs, signal);
  const checked = lookupResponseSchema.safeParse(result);
  if (!checked.success) throw new CatalogServiceError(503);
  const parsed = checked.data;
  if (parsed.locale !== locale || parsed.products.some((p) => !lookupReferencesProduct(refs, p)))
    throw new CatalogServiceError(503);
  return parsed.products;
}

export async function getFacetValues(locale: Locale, input: FacetQuery, signal?: AbortSignal) {
  const query = facetInputSchema.parse(input);
  let result;
  try {
    result =
      configuration().mode === 'preview'
        ? previewFacetPage(locale, query)
        : await remote(locale, 'facet-values', query, signal);
  } catch (error) {
    if (error instanceof CatalogServiceError) throw error;
    if (configuration().mode === 'preview') throw new CatalogServiceError(400);
    throw error;
  }
  const checked = facetPageSchema.safeParse(result);
  if (!checked.success) throw new CatalogServiceError(503);
  const page = checked.data;
  if (
    page.locale !== locale ||
    page.key !== query.key ||
    page.page !== query.page ||
    page.pageSize !== query.pageSize
  )
    throw new CatalogServiceError(503);
  return page;
}
