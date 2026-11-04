import {
  redirectSource,
  redirectResolutionSchema,
  type RedirectResolution,
} from '@sayman/web-shared/lib/content/cms-redirect-contract.ts';
export type RedirectLoad =
  { status: 'ready'; rule: RedirectResolution } | { status: 'skip' | 'unavailable'; rule: null };
export async function fetchCmsRedirect(
  source: string,
  env: { SHOP_DATA_MODE?: string; SHOP_API_URL?: string },
  fetcher: typeof fetch = fetch,
): Promise<RedirectLoad> {
  if (
    !redirectSource.safeParse(source).success ||
    (env.SHOP_DATA_MODE === 'preview' && source.split('/')[2] === 'product')
  )
    return { status: 'skip', rule: null };
  try {
    if (env.SHOP_DATA_MODE === 'preview' || !env.SHOP_API_URL)
      throw Error('Redirect API unavailable');
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
    const response = await fetcher(
      base.origin + '/api/content/redirects/resolve?path=' + encodeURIComponent(source),
      {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      },
    );
    if (
      response.status !== 200 ||
      !/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? '') ||
      Number(response.headers.get('Content-Length')) > 4096
    ) {
      await response.body?.cancel();
      throw Error('Redirect unavailable');
    }
    const reader = response.body?.getReader();
    if (!reader) throw Error('Empty redirect');
    let length = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        length += r.value.length;
        if (length > 4096) {
          await reader.cancel();
          throw Error('Redirect capacity');
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
    const rule = redirectResolutionSchema.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    );
    if (rule.sourcePath !== source) throw Error('Unrelated redirect');
    return { status: 'ready', rule };
  } catch {
    return { status: 'unavailable', rule: null };
  }
}
