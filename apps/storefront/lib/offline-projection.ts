import { offlineCatalogSchema, type OfflineCatalog } from './offline-contract.ts';
import type { Locale } from './types.ts';
export async function fetchOfflineProjection(
  base: string,
  locale: Locale,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<OfflineCatalog> {
  const response = await fetcher(
    `${base.replace(/\/$/, '')}/api/catalog/${locale}/offline?limit=200`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
        : AbortSignal.timeout(8000),
    },
  );
  if (
    !response.ok ||
    !/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? '')
  ) {
    await response.body?.cancel();
    throw new Error('Offline projection unavailable');
  }
  // .NET's escaped Unicode is larger than the decoded public JSON. Both the
  // upstream stream and the final payload have independent bounds.
  if (Number(response.headers.get('Content-Length')) > 6 * 1024 * 1024) {
    await response.body?.cancel();
    throw new Error('Offline projection too large');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Offline projection unavailable');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 6 * 1024 * 1024) {
        await reader.cancel();
        throw new Error('Offline projection too large');
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  const value = offlineCatalogSchema.parse(JSON.parse(new TextDecoder().decode(buffer)));
  if (
    value.locale !== locale ||
    value.products.length > 200 ||
    JSON.stringify(value).length > 1000000
  )
    throw new Error('Offline projection contract mismatch');
  return value;
}
