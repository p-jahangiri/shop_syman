import { z } from '@sayman/web-shared/lib/config/schema-runtime.ts';
import { canIndexEnvironment } from '../seo/seo.ts';
import { cmsPageSlug } from '@sayman/web-shared/lib/content/cms-page-contract.ts';
import {
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
export const blogSitemapManifestSchema = z.strictObject({
  version: z.literal(1),
  dataSource: z.literal('api'),
  locale: z.enum(['fa', 'en']),
  isPreview: z.boolean(),
  allowIndexing: z.boolean(),
  pageSize: z.literal(1000),
  postCount: count,
});
export const blogSitemapPageSchema = z
  .strictObject({
    version: z.literal(1),
    locale: z.enum(['fa', 'en']),
    kind: z.literal('blog'),
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
export type BlogSitemapManifest = z.infer<typeof blogSitemapManifestSchema>;
export type BlogSitemapPage = z.infer<typeof blogSitemapPageSchema>;
async function read(
  env: SitemapEnvironment,
  path: string,
  max: number,
  fetcher: typeof fetch,
  signal?: AbortSignal,
) {
  if (!env.SHOP_API_URL) throw Error('Blog sitemap unavailable');
  const base = new URL(env.SHOP_API_URL);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== '/'
  )
    throw Error('Blog sitemap origin required');
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
    response.headers.has('Set-Cookie') ||
    !/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? '') ||
    Number(response.headers.get('Content-Length')) > max
  ) {
    await response.body?.cancel();
    throw Error('Blog sitemap response unavailable');
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error('Empty Blog sitemap');
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.length;
      if (size > max) {
        await reader.cancel();
        throw Error('Blog sitemap capacity');
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
export async function blogSitemapManifests(
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
      const m = blogSitemapManifestSchema.parse(
        await read(env, `/api/content/blog-sitemap/${locale}`, 8192, fetcher, signal),
      );
      if (m.locale !== locale) throw Error('Blog sitemap locale mismatch');
      return m;
    }),
  );
  return result.filter((x) => !x.isPreview && x.allowIndexing);
}
export async function blogSitemapPage(
  env: SitemapEnvironment,
  locale: Locale,
  page: number,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  if (!Number.isInteger(page) || page < 1 || page > 50000) throw Error('Invalid Blog sitemap page');
  const value = blogSitemapPageSchema.parse(
    await read(
      env,
      `/api/content/blog-sitemap/${locale}/entries?page=${page}`,
      524288,
      fetcher,
      signal,
    ),
  );
  if (value.locale !== locale || value.page !== page) throw Error('Blog sitemap page mismatch');
  return value;
}
export function blogSitemapLocations(
  origin: string,
  catalog: SitemapManifest[],
  blog: BlogSitemapManifest[],
) {
  const locations: string[] = [],
    locales = new Set(catalog.filter((x) => !x.isPreview && x.allowIndexing).map((x) => x.locale));
  if (new Set(blog.map((x) => x.locale)).size !== blog.length)
    throw Error('Duplicate blog sitemap locale');
  for (const raw of blog) {
    const m = blogSitemapManifestSchema.parse(raw);
    if (m.isPreview || !m.allowIndexing || !locales.has(m.locale))
      throw Error('Ineligible blog sitemap locale');
    const count = Number((BigInt(m.postCount) + 999n) / 1000n);
    if (locations.length + count > 50000) throw Error('Blog sitemap index capacity');
    for (let i = 1; i <= count; i++) locations.push(`${origin}/sitemap-${m.locale}-blog-${i}.xml`);
  }
  return locations;
}
export function blogSitemapPageXml(
  origin: string,
  locale: Locale,
  manifests: BlogSitemapManifest[],
  raw: BlogSitemapPage,
) {
  const page = blogSitemapPageSchema.parse(raw);
  if (
    page.locale !== locale ||
    !manifests.some((m) => m.locale === locale && !m.isPreview && m.allowIndexing)
  )
    throw Error('Ineligible Blog sitemap page');
  const languages = manifests.filter((m) => !m.isPreview && m.allowIndexing).map((m) => m.locale);
  return sitemapUrlSet(
    page.items.map((x) => ({
      url: `${origin}/${locale}/blog/${x.key}`,
      lastModified: x.lastModified,
      alternates: languages
        .filter((l) => x[l])
        .map((l) => ({ locale: l, url: `${origin}/${l}/blog/${x.key}` })),
    })),
  );
}
