import { z } from '@sayman/web-shared/lib/config/schema-runtime.ts';
import { canIndexEnvironment } from '../seo/seo.ts';
import { cmsPageSlug } from '@sayman/web-shared/lib/content/cms-page-contract.ts';
import {
  sitemapIndexLocations,
  sitemapIndexXml,
  sitemapUrlSet,
  type SitemapEnvironment,
  type SitemapManifest,
} from '../seo/sitemap-projection.ts';
import type { Locale } from '@sayman/web-shared/lib/shared/types.ts';
const count = z
    .string()
    .regex(/^(0|[1-9]\d{0,7})$/)
    .refine((v) => BigInt(v) <= 50000000n),
  at = z
    .string()
    .datetime({ offset: true })
    .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/);
export const cmsSitemapManifestSchema = z.strictObject({
  version: z.literal(1),
  dataSource: z.literal('api'),
  locale: z.enum(['fa', 'en']),
  isPreview: z.boolean(),
  allowIndexing: z.boolean(),
  pageSize: z.literal(1000),
  pageCount: count,
});
export const cmsSitemapPageSchema = z
  .strictObject({
    version: z.literal(1),
    locale: z.enum(['fa', 'en']),
    kind: z.literal('pages'),
    page: z.number().int().min(1).max(50000),
    pageSize: z.literal(1000),
    items: z
      .array(
        z.strictObject({
          key: cmsPageSlug,
          fa: z.literal(true),
          en: z.literal(true),
          lastModified: at,
        }),
      )
      .max(1000),
  })
  .refine((v) => new Set(v.items.map((x) => x.key)).size === v.items.length);
export type CmsSitemapManifest = z.infer<typeof cmsSitemapManifestSchema>;
export type CmsSitemapPage = z.infer<typeof cmsSitemapPageSchema>;
async function read(
  env: SitemapEnvironment,
  path: string,
  max: number,
  fetcher: typeof fetch,
  signal?: AbortSignal,
) {
  if (!env.SHOP_API_URL) throw Error('CMS sitemap unavailable');
  const base = new URL(env.SHOP_API_URL);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== '/'
  )
    throw Error('CMS sitemap origin required');
  const response = await fetcher(base.origin + path, {
    headers: { Accept: 'application/json' },
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
      : AbortSignal.timeout(8000),
  });
  if (
    response.status !== 200 ||
    !/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? '') ||
    Number(response.headers.get('Content-Length')) > max
  ) {
    await response.body?.cancel();
    throw Error('CMS sitemap response unavailable');
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error('Empty CMS sitemap');
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.length;
      if (size > max) {
        await reader.cancel();
        throw Error('CMS sitemap capacity');
      }
      chunks.push(r.value);
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
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
}
export async function cmsSitemapManifests(
  env: SitemapEnvironment,
  catalog: SitemapManifest[],
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  if (
    !canIndexEnvironment(env) ||
    (env.SHOP_DATA_MODE ?? (env.SHOP_API_URL ? 'api' : 'preview')) !== 'api'
  )
    return [];
  const locales = catalog.filter((x) => !x.isPreview && x.allowIndexing).map((x) => x.locale);
  if (new Set(locales).size !== locales.length) throw Error('Duplicate sitemap locale');
  const result = await Promise.all(
    locales.map(async (locale) => {
      const m = cmsSitemapManifestSchema.parse(
        await read(env, `/api/content/page-sitemap/${locale}`, 8192, fetcher, signal),
      );
      if (m.locale !== locale) throw Error('CMS sitemap locale mismatch');
      return m;
    }),
  );
  return result.filter((x) => !x.isPreview && x.allowIndexing);
}
export async function cmsSitemapPage(
  env: SitemapEnvironment,
  locale: Locale,
  page: number,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  if (!Number.isInteger(page) || page < 1 || page > 50000) throw Error('Invalid CMS sitemap page');
  const value = cmsSitemapPageSchema.parse(
    await read(
      env,
      `/api/content/page-sitemap/${locale}/entries?page=${page}`,
      524288,
      fetcher,
      signal,
    ),
  );
  if (value.locale !== locale || value.page !== page) throw Error('CMS sitemap page mismatch');
  return value;
}
export function cmsSitemapLocations(
  origin: string,
  catalog: SitemapManifest[],
  cms: CmsSitemapManifest[],
) {
  const locations = sitemapIndexLocations(origin, catalog),
    locales = new Set(catalog.filter((x) => !x.isPreview && x.allowIndexing).map((x) => x.locale));
  if (new Set(cms.map((x) => x.locale)).size !== cms.length)
    throw Error('Duplicate CMS sitemap locale');
  for (const raw of cms) {
    const m = cmsSitemapManifestSchema.parse(raw);
    if (m.isPreview || !m.allowIndexing || !locales.has(m.locale))
      throw Error('Ineligible CMS sitemap locale');
    const count = Number((BigInt(m.pageCount) + 999n) / 1000n);
    if (locations.length + count > 50000) throw Error('Combined sitemap index capacity');
    for (let i = 1; i <= count; i++) locations.push(`${origin}/sitemap-${m.locale}-pages-${i}.xml`);
  }
  return locations;
}
export function cmsSitemapIndex(
  origin: string,
  catalog: SitemapManifest[],
  cms: CmsSitemapManifest[],
) {
  return sitemapIndexXml(cmsSitemapLocations(origin, catalog, cms));
}
export function cmsSitemapPageXml(
  origin: string,
  locale: Locale,
  manifests: CmsSitemapManifest[],
  raw: CmsSitemapPage,
) {
  const page = cmsSitemapPageSchema.parse(raw);
  if (
    page.locale !== locale ||
    !manifests.some((m) => m.locale === locale && !m.isPreview && m.allowIndexing)
  )
    throw Error('Ineligible CMS sitemap page');
  const languages = manifests.filter((m) => !m.isPreview && m.allowIndexing).map((m) => m.locale);
  return sitemapUrlSet(
    page.items.map((x) => ({
      url: `${origin}/${locale}/pages/${x.key}`,
      lastModified: x.lastModified,
      alternates: languages
        .filter((l) => x[l])
        .map((l) => ({ locale: l, url: `${origin}/${l}/pages/${x.key}` })),
    })),
  );
}
