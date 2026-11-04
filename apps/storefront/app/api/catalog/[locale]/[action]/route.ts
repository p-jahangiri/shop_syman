import { ZodError } from '@sayman/web-shared/lib/config/schema-runtime.ts';
import {
  CatalogServiceError,
  getFacetValues,
  getCatalogFilters,
  getCatalogSearch,
  getCatalogProducts,
} from '@/lib/catalog/catalog-server';
import { publicOrigin } from '@/lib/seo/seo';
import { catalogConditionSchema } from '@/lib/catalog/catalog-contract';
const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
};
async function body(request: Request) {
  if (Number(request.headers.get('Content-Length')) > 32768) throw new CatalogServiceError(413);
  const reader = request.body?.getReader();
  if (!reader) return {};
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 32768) {
        await reader.cancel();
        throw new CatalogServiceError(413);
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let index = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, index);
    index += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new CatalogServiceError(400);
  }
}
async function handler(
  request: Request,
  context: { params: Promise<{ locale: string; action: string }> },
) {
  const { locale, action } = await context.params;
  if (
    !['fa', 'en'].includes(locale) ||
    !['search', 'lookup', 'filters', 'facet-values'].includes(action) ||
    request.method !== (action === 'filters' ? 'GET' : 'POST')
  )
    return new Response(null, { status: 404, headers });
  const url = new URL(request.url);
  let expected = publicOrigin();
  if (!expected) {
    try {
      const host = request.headers.get('host');
      expected = host ? new URL(`${url.protocol}//${host}`).origin : url.origin;
    } catch {
      return new Response(null, { status: 403, headers });
    }
  }
  const origin = request.headers.get('Origin');
  if (origin && origin !== expected) return new Response(null, { status: 403, headers });
  try {
    const language = locale as 'fa' | 'en';
    const input = action === 'filters' ? undefined : await body(request);
    const conditions = url.searchParams.getAll('condition');
    const condition =
      action === 'filters' && conditions.length
        ? catalogConditionSchema.parse(conditions.length === 1 ? conditions[0] : conditions)
        : undefined;
    const result =
      action === 'facet-values'
        ? await getFacetValues(language, input, request.signal)
        : action === 'filters'
          ? await getCatalogFilters(
              language,
              url.searchParams.get('categoryId') || undefined,
              request.signal,
              condition,
            )
          : action === 'search'
            ? await getCatalogSearch(language, input, request.signal)
            : {
                version: 1,
                locale: language,
                products: await getCatalogProducts(language, input, request.signal),
              };
    return Response.json(result, { headers });
  } catch (error) {
    const status =
      error instanceof ZodError ? 400 : error instanceof CatalogServiceError ? error.status : 503;
    return Response.json(
      {
        title:
          status === 400
            ? 'invalid_catalog_query'
            : status === 413
              ? 'catalog_query_too_large'
              : 'catalog_unavailable',
      },
      { status, headers },
    );
  }
}
export const GET = handler;
export const POST = handler;
