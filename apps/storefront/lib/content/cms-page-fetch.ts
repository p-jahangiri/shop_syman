import {
  cmsPageSlug,
  cmsPublicPageSchema,
  type CmsPublicPage,
} from '@sayman/web-shared/lib/content/cms-page-contract.ts';
export type CmsPageLoad =
  { status: 'ready'; page: CmsPublicPage } | { status: 'missing' | 'unavailable'; page: null };
export async function fetchCmsPage(
  slug: string,
  locale: 'fa' | 'en',
  env: { SHOP_DATA_MODE?: string; SHOP_API_URL?: string },
  fetcher: typeof fetch = fetch,
): Promise<CmsPageLoad> {
  if (!cmsPageSlug.safeParse(slug).success) return { status: 'missing', page: null };
  try {
    if (env.SHOP_DATA_MODE === 'preview' || !env.SHOP_API_URL) throw Error('Page API unavailable');
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
    const response = await fetcher(base.origin + `/api/content/pages/${locale}/${slug}`, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 404) {
      await response.body?.cancel();
      return { status: 'missing', page: null };
    }
    if (
      response.status !== 200 ||
      !/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? '') ||
      Number(response.headers.get('Content-Length')) > 131072
    ) {
      await response.body?.cancel();
      throw Error('Page unavailable');
    }
    const reader = response.body?.getReader();
    if (!reader) throw Error('Empty page');
    let length = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        length += r.value.length;
        if (length > 131072) {
          await reader.cancel();
          throw Error('Page capacity');
        }
        chunks.push(r.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.length;
    }
    const page = cmsPublicPageSchema.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    );
    if (page.slug !== slug || page.locale !== locale) throw Error('Unrelated public page');
    return { status: 'ready', page };
  } catch {
    return { status: 'unavailable', page: null };
  }
}
