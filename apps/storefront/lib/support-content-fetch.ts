import { readSupportContent, type SupportContentPage } from './support-content-contract.ts';
export type SupportContentLoad =
  { status: 'ready'; page: SupportContentPage } | { status: 'preview' | 'unavailable'; page: null };
async function bounded(stream: ReadableStream<Uint8Array> | null) {
  if (!stream) throw Error('Empty support content');
  const reader = stream.getReader(),
    parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > 131072) {
        await reader.cancel();
        throw Error('Support content capacity');
      }
      parts.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
export async function fetchSupportContent(
  locale: 'fa' | 'en',
  environment: { SHOP_DATA_MODE?: string; SHOP_API_URL?: string },
  fetcher: typeof fetch = fetch,
): Promise<SupportContentLoad> {
  const mode = environment.SHOP_DATA_MODE ?? (environment.SHOP_API_URL ? 'api' : 'preview');
  if (mode === 'preview') return { status: 'preview', page: null };
  try {
    if (mode !== 'api' || !environment.SHOP_API_URL) throw Error('Support content unavailable');
    const base = new URL(environment.SHOP_API_URL);
    if (
      !['http:', 'https:'].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      !['', '/'].includes(base.pathname)
    )
      throw Error('API origin required');
    const response = await fetcher(base.origin + '/api/content/support/' + locale, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    if (
      !response.ok ||
      response.status !== 200 ||
      !/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? '') ||
      Number(response.headers.get('Content-Length')) > 131072
    ) {
      await response.body?.cancel();
      throw Error('Support content response unavailable');
    }
    return {
      status: 'ready',
      page: readSupportContent(JSON.parse(await bounded(response.body)), locale),
    };
  } catch {
    return { status: 'unavailable', page: null };
  }
}
