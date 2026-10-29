import { lookupInputSchema, lookupResponseSchema } from './catalog-contract.ts';
import { previewLookup } from './catalog-preview.ts';
export type ProductPresence = 'ready' | 'missing' | 'unavailable';
type Env = {
  SHOP_DATA_MODE?: string;
  SHOP_API_URL?: string;
  NODE_ENV?: string;
  SHOP_ENABLE_PREVIEW?: string;
};
// A pre-streaming read only. The existing bounded lookup remains authoritative for
// public visibility; inventory availability does not turn a visible product into 404.
export async function fetchProductPresence(
  slug: string,
  locale: 'fa' | 'en',
  env: Env,
  fetcher: typeof fetch = fetch,
): Promise<ProductPresence> {
  const refs = lookupInputSchema.safeParse({ slugs: [slug] });
  if (!refs.success) return 'missing';
  try {
    const mode = env.SHOP_DATA_MODE ?? (env.SHOP_API_URL ? 'api' : 'preview');
    if (mode === 'preview') {
      if (env.NODE_ENV === 'production' && env.SHOP_ENABLE_PREVIEW !== 'true')
        throw Error('Preview disabled');
      return previewLookup(locale, refs.data).products.length === 1 ? 'ready' : 'missing';
    }
    if (mode !== 'api' || !env.SHOP_API_URL) throw Error('Catalog unavailable');
    const base = new URL(env.SHOP_API_URL);
    if (
      !['http:', 'https:'].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      base.pathname !== '/'
    )
      throw Error('API origin required');
    const response = await fetcher(base.origin + `/api/catalog/${locale}/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(refs.data),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    const maximum = 1048576;
    if (
      response.status !== 200 ||
      response.headers.has('Set-Cookie') ||
      !/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? '') ||
      Number(response.headers.get('Content-Length')) > maximum
    ) {
      await response.body?.cancel();
      throw Error('Lookup unavailable');
    }
    const reader = response.body?.getReader();
    if (!reader) throw Error('Empty lookup');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        size += item.value.length;
        if (size > maximum) {
          await reader.cancel();
          throw Error('Lookup capacity');
        }
        chunks.push(item.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const result = lookupResponseSchema.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    );
    if (
      result.locale !== locale ||
      result.products.length > 1 ||
      result.products.some((p) => p.slug !== slug)
    )
      throw Error('Unrelated lookup');
    return result.products.length === 1 ? 'ready' : 'missing';
  } catch {
    return 'unavailable';
  }
}
