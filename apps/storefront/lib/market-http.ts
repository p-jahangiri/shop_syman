import {
  marketIdSchema,
  marketInputSchema,
  marketItemSchema,
  marketPageSchema,
  marketFacetsSchema,
  marketFiltersInputSchema,
  marketFiltersSchema,
  marketValuesInputSchema,
  marketValuesSchema,
  sameMarketAttributes,
  type MarketQuery,
  type MarketValuesQuery,
} from './market-contract.ts';
import { publicOrigin } from './seo.ts';
import type { Locale } from './types.ts';
import {
  marketSourcesSchema,
  marketHistorySchema,
  marketSequenceSchema,
} from './market-sources-contract.ts';

export interface MarketEnvironment {
  SHOP_API_URL?: string;
  SHOP_DATA_MODE?: string;
  SHOP_PUBLIC_URL?: string;
}
export class MarketReadError extends Error {
  status: number;
  constructor(status: number) {
    super('Market data is unavailable.');
    this.status = status;
  }
}
const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
};
async function boundedText(stream: ReadableStream<Uint8Array> | null, max: number, status: number) {
  if (!stream) return '';
  const reader = stream.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > max) {
        await reader.cancel();
        throw new MarketReadError(status);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const data = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    throw new MarketReadError(status);
  }
}
function apiBase(environment: MarketEnvironment) {
  const base = environment.SHOP_API_URL,
    mode = environment.SHOP_DATA_MODE ?? (base ? 'api' : 'preview');
  if (!base || mode !== 'api') throw new MarketReadError(503);
  return base.replace(/\/$/, '');
}
async function remote(
  locale: Locale,
  path: string,
  environment: MarketEnvironment,
  body: object | undefined,
  fetcher: typeof fetch,
  signal?: AbortSignal,
) {
  const base = apiBase(environment);
  try {
    const response = await fetcher(`${base}/api/market/${locale}/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
        : AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new MarketReadError([400, 404, 429].includes(response.status) ? response.status : 503);
    }
    if (
      !/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? '') ||
      Number(response.headers.get('Content-Length')) > 2097152
    ) {
      await response.body?.cancel();
      throw new MarketReadError(503);
    }
    return JSON.parse(await boundedText(response.body, 2097152, 503));
  } catch (error) {
    if (error instanceof MarketReadError) throw error;
    throw new MarketReadError(503);
  }
}
export async function readMarketPage(
  locale: Locale,
  input: Partial<MarketQuery>,
  environment: MarketEnvironment,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  const query = marketInputSchema.parse(input);
  const result = marketPageSchema.safeParse(
    await remote(locale, 'search', environment, query, fetcher, signal),
  );
  if (
    !result.success ||
    !sameMarketAttributes(result.data.appliedAttributes, query.attributes) ||
    result.data.locale !== locale ||
    result.data.page !== query.page ||
    result.data.pageSize !== query.pageSize ||
    result.data.items.some(
      (item) =>
        (query.categoryId && item.model.categoryId !== query.categoryId) ||
        (query.brandId && item.model.brandId !== query.brandId),
    )
  )
    throw new MarketReadError(503);
  return result.data;
}
export async function readMarketItem(
  locale: Locale,
  id: string,
  environment: MarketEnvironment,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  marketIdSchema.parse(id);
  const result = marketItemSchema.safeParse(
    await remote(locale, encodeURIComponent(id), environment, undefined, fetcher, signal),
  );
  if (!result.success || result.data.id !== id) throw new MarketReadError(503);
  return result.data;
}
export async function readMarketSources(
  locale: Locale,
  id: string,
  environment: MarketEnvironment,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  marketIdSchema.parse(id);
  const result = marketSourcesSchema.safeParse(
    await remote(
      locale,
      encodeURIComponent(id) + '/sources',
      environment,
      undefined,
      fetcher,
      signal,
    ),
  );
  if (!result.success || result.data.listingId !== id || result.data.locale !== locale)
    throw new MarketReadError(503);
  return result.data;
}
export async function readMarketHistory(
  locale: Locale,
  id: string,
  sourceId: string,
  before: string | null,
  environment: MarketEnvironment,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  marketIdSchema.parse(id);
  marketIdSchema.parse(sourceId);
  if (before !== null) marketSequenceSchema.parse(before);
  const path =
    encodeURIComponent(id) +
    '/sources/' +
    encodeURIComponent(sourceId) +
    '/history' +
    (before === null ? '' : '?before=' + before);
  const result = marketHistorySchema.safeParse(
    await remote(locale, path, environment, undefined, fetcher, signal),
  );
  if (
    !result.success ||
    result.data.listingId !== id ||
    result.data.sourceId !== sourceId ||
    result.data.locale !== locale ||
    (before !== null && result.data.items.some((x) => BigInt(x.sequence) >= BigInt(before)))
  )
    throw new MarketReadError(503);
  return result.data;
}
export async function readMarketFacets(
  locale: Locale,
  input: Partial<MarketQuery>,
  environment: MarketEnvironment,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  const query = marketInputSchema.parse(input),
    result = marketFacetsSchema.safeParse(
      await remote(locale, 'facets', environment, query, fetcher, signal),
    );
  if (
    !result.success ||
    result.data.locale !== locale ||
    result.data.scope.query !== (query.query ?? '') ||
    result.data.scope.categoryId !== (query.categoryId ?? null) ||
    result.data.scope.brandId !== (query.brandId ?? null) ||
    !sameMarketAttributes(result.data.scope.attributes, query.attributes)
  )
    throw new MarketReadError(503);
  return result.data;
}
export async function readMarketFilters(
  locale: Locale,
  input: { categoryId: string },
  environment: MarketEnvironment,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  const query = marketFiltersInputSchema.parse(input),
    result = marketFiltersSchema.safeParse(
      await remote(locale, 'filters', environment, query, fetcher, signal),
    );
  if (
    !result.success ||
    result.data.locale !== locale ||
    result.data.categoryId !== query.categoryId
  )
    throw new MarketReadError(503);
  return result.data;
}
export async function readMarketValues(
  locale: Locale,
  input: MarketValuesQuery,
  environment: MarketEnvironment,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  const query = marketValuesInputSchema.parse(input),
    result = marketValuesSchema.safeParse(
      await remote(locale, 'facet-values', environment, query, fetcher, signal),
    );
  if (
    !result.success ||
    result.data.locale !== locale ||
    result.data.key !== query.key ||
    result.data.valueQuery !== (query.query ?? '') ||
    result.data.page !== query.page ||
    result.data.pageSize !== query.pageSize ||
    result.data.scope.query !== (query.search.query ?? '') ||
    result.data.scope.categoryId !== query.search.categoryId ||
    result.data.scope.brandId !== (query.search.brandId ?? null) ||
    !sameMarketAttributes(result.data.scope.attributes, query.search.attributes) ||
    JSON.stringify(result.data.selectedValues.map((value) => value.value)) !==
      JSON.stringify(query.selectedValues ?? [])
  )
    throw new MarketReadError(503);
  return result.data;
}
export async function proxyMarket(
  request: Request,
  locale: string,
  path: string[],
  environment: MarketEnvironment,
  fetcher: typeof fetch = fetch,
) {
  const mode =
    path.length === 1 && ['search', 'facets', 'filters', 'facet-values'].includes(path[0])
      ? path[0]
      : undefined;
  const detail = path.length === 1 && !mode && marketIdSchema.safeParse(path[0]).success;
  const sources =
    path.length === 2 && path[1] === 'sources' && marketIdSchema.safeParse(path[0]).success;
  const history =
    path.length === 4 &&
    path[1] === 'sources' &&
    path[3] === 'history' &&
    marketIdSchema.safeParse(path[0]).success &&
    marketIdSchema.safeParse(path[2]).success;
  if (
    !['fa', 'en'].includes(locale) ||
    !(
      (mode && request.method === 'POST') ||
      ((detail || sources || history) && request.method === 'GET')
    )
  )
    return new Response(null, { status: 404, headers });
  const url = new URL(request.url),
    expected = publicOrigin(environment) ?? url.origin,
    supplied = request.headers.get('Origin');
  if (supplied && supplied !== expected) return new Response(null, { status: 403, headers });
  try {
    let before: string | null = null;
    if (history) {
      if (
        url.searchParams.size > 1 ||
        [...url.searchParams.keys()].some((k) => k !== 'before') ||
        url.searchParams.getAll('before').length > 1
      )
        throw new MarketReadError(400);
      before = url.searchParams.get('before');
      if (before !== null && !marketSequenceSchema.safeParse(before).success)
        throw new MarketReadError(400);
    } else if (url.search) throw new MarketReadError(400);
    let raw: unknown;
    if (mode) {
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? ''))
        throw new MarketReadError(400);
      const limit = mode === 'filters' ? 4096 : 65536;
      if (Number(request.headers.get('Content-Length')) > limit) throw new MarketReadError(413);
      const text = await boundedText(request.body, limit, 413);
      try {
        raw = JSON.parse(text);
      } catch {
        throw new MarketReadError(400);
      }
      if (
        (mode === 'search' || mode === 'facets') &&
        new TextEncoder().encode(text).byteLength > 4096 &&
        !(
          raw &&
          typeof raw === 'object' &&
          'attributes' in raw &&
          Array.isArray(raw.attributes) &&
          raw.attributes.length
        )
      )
        throw new MarketReadError(413);
    }
    let result;
    if (mode === 'filters') {
      const parsed = marketFiltersInputSchema.safeParse(raw);
      if (!parsed.success) throw new MarketReadError(400);
      result = await readMarketFilters(
        locale as Locale,
        parsed.data,
        environment,
        fetcher,
        request.signal,
      );
    } else if (mode === 'facet-values') {
      const parsed = marketValuesInputSchema.safeParse(raw);
      if (!parsed.success) throw new MarketReadError(400);
      result = await readMarketValues(
        locale as Locale,
        parsed.data,
        environment,
        fetcher,
        request.signal,
      );
    } else if (mode) {
      const parsed = marketInputSchema.safeParse(raw);
      if (!parsed.success) throw new MarketReadError(400);
      result = await (mode === 'facets' ? readMarketFacets : readMarketPage)(
        locale as Locale,
        parsed.data,
        environment,
        fetcher,
        request.signal,
      );
    } else if (sources)
      result = await readMarketSources(
        locale as Locale,
        path[0],
        environment,
        fetcher,
        request.signal,
      );
    else if (history)
      result = await readMarketHistory(
        locale as Locale,
        path[0],
        path[2],
        before,
        environment,
        fetcher,
        request.signal,
      );
    else
      result = await readMarketItem(
        locale as Locale,
        path[0],
        environment,
        fetcher,
        request.signal,
      );
    return Response.json(result, { headers });
  } catch (error) {
    const status = error instanceof MarketReadError ? error.status : 503;
    return Response.json(
      {
        title:
          status === 400
            ? 'invalid_market_query'
            : status === 413
              ? 'market_query_too_large'
              : 'market_unavailable',
      },
      { status, headers },
    );
  }
}
