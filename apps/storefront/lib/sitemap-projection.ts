import { z } from './schema-runtime.ts';
import { canIndexEnvironment, publicOrigin, type SeoEnvironment } from './seo.ts';
import type { Locale } from './types.ts';
export interface SitemapEnvironment extends SeoEnvironment {
  SHOP_DATA_MODE?: string;
  SHOP_API_URL?: string;
}
const count = z
  .string()
  .regex(/^(0|[1-9]\d{0,7})$/)
  .refine((v) => BigInt(v) <= 50000000n);
export const sitemapManifestSchema = z
  .object({
    version: z.literal(1),
    dataSource: z.literal('api'),
    locale: z.enum(['fa', 'en']),
    isPreview: z.boolean(),
    allowIndexing: z.boolean(),
    pageSize: z.literal(1000),
    productCount: count,
    categoryCount: count,
  })
  .strict();
export type SitemapManifest = z.infer<typeof sitemapManifestSchema>;
const row = z
  .object({ key: z.string().min(1).max(150), fa: z.boolean(), en: z.boolean() })
  .strict();
export const sitemapPageSchema = z
  .object({
    version: z.literal(1),
    locale: z.enum(['fa', 'en']),
    kind: z.enum(['products', 'categories']),
    page: z.number().int().min(1).max(50000),
    pageSize: z.literal(1000),
    items: z.array(row).max(1000),
  })
  .strict()
  .refine(
    (p) =>
      new Set(p.items.map((r) => r.key)).size === p.items.length &&
      p.items.every(
        (r) =>
          r[p.locale] &&
          (p.kind === 'products'
            ? /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(r.key)
            : /^[A-Za-z0-9_-]{1,64}$/.test(r.key)),
      ),
  );
export type SitemapPage = z.infer<typeof sitemapPageSchema>;
const pages = (value: string) => Number((BigInt(value) + 999n) / 1000n);
export function sitemapFileCount(manifests: SitemapManifest[]) {
  return manifests.reduce((n, m) => n + 1 + pages(m.productCount) + pages(m.categoryCount), 0);
}
async function read(
  base: string,
  path: string,
  maximum: number,
  fetcher: typeof fetch,
  signal?: AbortSignal,
) {
  const response = await fetcher(base.replace(/\/$/, '') + path, {
    headers: { Accept: 'application/json' },
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
      : AbortSignal.timeout(8000),
  });
  if (
    !response.ok ||
    !/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? '') ||
    Number(response.headers.get('Content-Length')) > maximum
  ) {
    await response.body?.cancel();
    throw new Error('Sitemap source unavailable');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Sitemap source unavailable');
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        throw new Error('Sitemap source too large');
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of chunks) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}
export async function sitemapManifests(
  env: SitemapEnvironment,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  const mode = env.SHOP_DATA_MODE ?? (env.SHOP_API_URL ? 'api' : 'preview');
  if (!canIndexEnvironment(env) || mode === 'preview') return [];
  if (mode !== 'api' || !env.SHOP_API_URL || publicOrigin(env)!.length > 512)
    throw new Error('Sitemap configuration unavailable');
  const result = await Promise.all(
    (['fa', 'en'] as const).map(async (locale) => {
      const value = sitemapManifestSchema.parse(
        await read(env.SHOP_API_URL!, `/api/catalog/${locale}/sitemap`, 8192, fetcher, signal),
      );
      if (value.locale !== locale) throw new Error('Sitemap locale mismatch');
      return value;
    }),
  );
  const eligible = result.filter((m) => !m.isPreview && m.allowIndexing);
  if (sitemapFileCount(eligible) > 50000) throw new Error('Sitemap index capacity exceeded');
  return eligible;
}
export async function sitemapPage(
  env: SitemapEnvironment,
  locale: Locale,
  kind: 'products' | 'categories',
  page: number,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  if (!env.SHOP_API_URL || !Number.isInteger(page) || page < 1 || page > 50000)
    throw new Error('Invalid sitemap page');
  const value = sitemapPageSchema.parse(
    await read(
      env.SHOP_API_URL,
      `/api/catalog/${locale}/sitemap/${kind}?page=${page}`,
      524288,
      fetcher,
      signal,
    ),
  );
  if (value.locale !== locale || value.kind !== kind || value.page !== page)
    throw new Error('Sitemap page mismatch');
  return value;
}
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
const prefix = '<?xml version="1.0" encoding="UTF-8"?>';
export function sitemapUrlSet(
  entries: { url: string; alternates: { locale: Locale; url: string }[]; lastModified?: string }[],
) {
  return (
    prefix +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">' +
    entries
      .map(
        (e) =>
          `<url><loc>${escape(e.url)}</loc>${e.lastModified ? `<lastmod>${escape(e.lastModified)}</lastmod>` : ''}${e.alternates.map((a) => `<xhtml:link rel="alternate" hreflang="${a.locale}" href="${escape(a.url)}"/>`).join('')}</url>`,
      )
      .join('') +
    '</urlset>'
  );
}
export function sitemapIndexLocations(origin: string, manifests: SitemapManifest[]) {
  if (sitemapFileCount(manifests) > 50000) throw new Error('Sitemap index capacity exceeded');
  return manifests.flatMap((m) =>
    [
      `site.xml`,
      ...Array.from({ length: pages(m.productCount) }, (_, i) => `products-${i + 1}.xml`),
      ...Array.from({ length: pages(m.categoryCount) }, (_, i) => `categories-${i + 1}.xml`),
    ].map((file) => `${origin}/sitemap-${m.locale}-${file}`),
  );
}
export function sitemapIndexXml(files: string[]) {
  if (files.length > 50000) throw Error('Sitemap index capacity exceeded');
  return (
    prefix +
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    files.map((url) => `<sitemap><loc>${escape(url)}</loc></sitemap>`).join('') +
    '</sitemapindex>'
  );
}
export function sitemapIndex(origin: string, manifests: SitemapManifest[]) {
  return sitemapIndexXml(sitemapIndexLocations(origin, manifests));
}
export function sitemapPageXml(
  origin: string,
  locale: Locale,
  manifests: SitemapManifest[],
  page?: SitemapPage,
) {
  const enabled = manifests.map((m) => m.locale);
  const rows = page
    ? page.items.map((row) => ({
        path:
          page.kind === 'products'
            ? `/product/${encodeURIComponent(row.key)}`
            : `/catalog?category=${encodeURIComponent(row.key)}`,
        languages: enabled.filter((l) => row[l]),
      }))
    : [
        { path: '', languages: enabled },
        { path: '/catalog', languages: enabled },
      ];
  return sitemapUrlSet(
    rows.map((r) => ({
      url: `${origin}/${locale}${r.path}`,
      alternates: r.languages.map((l) => ({ locale: l, url: `${origin}/${l}${r.path}` })),
    })),
  );
}
