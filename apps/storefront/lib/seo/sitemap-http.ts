import {
  blogSitemapManifests,
  blogSitemapLocations,
  blogSitemapPage,
  blogSitemapPageXml,
} from '../content/cms-blog-sitemap.ts';
import {
  cmsSitemapManifests,
  cmsSitemapLocations,
  cmsSitemapPage,
  cmsSitemapPageXml,
} from '../content/cms-page-sitemap.ts';
import { publicOrigin } from './seo.ts';
import {
  sitemapManifests,
  sitemapPage,
  sitemapPageXml,
  sitemapUrlSet,
  sitemapIndexXml,
  type SitemapEnvironment,
} from './sitemap-projection.ts';
const headers = {
  'Content-Type': 'application/xml; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};
export const sitemapEnvironment = (): SitemapEnvironment => ({
  SHOP_API_URL: process.env.SHOP_API_URL,
  SHOP_DATA_MODE: process.env.SHOP_DATA_MODE,
  SHOP_PUBLIC_URL: process.env.SHOP_PUBLIC_URL,
  SHOP_ENABLE_INDEXING: process.env.SHOP_ENABLE_INDEXING,
});
function unavailable() {
  return Response.json(
    { title: 'sitemap_unavailable' },
    { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } },
  );
}
export async function sitemapIndexResponse(
  request: Request,
  env: SitemapEnvironment,
  fetcher: typeof fetch = fetch,
) {
  try {
    const manifests = await sitemapManifests(env, fetcher, request.signal);
    const [cms, blog] = await Promise.all([
      cmsSitemapManifests(env, manifests, fetcher, request.signal),
      blogSitemapManifests(env, manifests, fetcher, request.signal),
    ]);
    const locations = manifests.length
      ? [
          ...cmsSitemapLocations(publicOrigin(env)!, manifests, cms),
          ...blogSitemapLocations(publicOrigin(env)!, manifests, blog),
        ]
      : [];
    if (locations.length > 50000) throw Error('Combined sitemap capacity');
    return new Response(manifests.length ? sitemapIndexXml(locations) : sitemapUrlSet([]), {
      headers,
    });
  } catch {
    return unavailable();
  }
}
export async function sitemapFileResponse(
  request: Request,
  locale: string,
  file: string,
  env: SitemapEnvironment,
  fetcher: typeof fetch = fetch,
) {
  const match = /^(products|categories|pages|blog)-([1-9]\d{0,4})\.xml$/.exec(file);
  if (
    !['fa', 'en'].includes(locale) ||
    (file !== 'site.xml' && (!match || Number(match[2]) > 50000))
  )
    return new Response(null, { status: 404, headers });
  try {
    const manifests = await sitemapManifests(env, fetcher, request.signal);
    const current = manifests.find((m) => m.locale === locale);
    if (!current) return new Response(null, { status: 404, headers });
    if (file === 'site.xml')
      return new Response(sitemapPageXml(publicOrigin(env)!, current.locale, manifests), {
        headers,
      });
    if (match![1] === 'blog') {
      const blog = await blogSitemapManifests(env, manifests, fetcher, request.signal),
        m = blog.find((x) => x.locale === locale),
        page = Number(match![2]);
      if (!m || BigInt((page - 1) * 1000) >= BigInt(m.postCount))
        return new Response(null, { status: 404, headers });
      const data = await blogSitemapPage(env, current.locale, page, fetcher, request.signal);
      if (!data.items.length) return new Response(null, { status: 404, headers });
      return new Response(blogSitemapPageXml(publicOrigin(env)!, current.locale, blog, data), {
        headers,
      });
    }
    if (match![1] === 'pages') {
      const cms = await cmsSitemapManifests(env, manifests, fetcher, request.signal),
        m = cms.find((x) => x.locale === locale),
        page = Number(match![2]);
      if (!m || BigInt((page - 1) * 1000) >= BigInt(m.pageCount))
        return new Response(null, { status: 404, headers });
      const data = await cmsSitemapPage(env, current.locale, page, fetcher, request.signal);
      if (!data.items.length) return new Response(null, { status: 404, headers });
      return new Response(cmsSitemapPageXml(publicOrigin(env)!, current.locale, cms, data), {
        headers,
      });
    }
    const kind = match![1] as 'products' | 'categories',
      page = Number(match![2]);
    const total = BigInt(kind === 'products' ? current.productCount : current.categoryCount);
    if (BigInt((page - 1) * 1000) >= total) return new Response(null, { status: 404, headers });
    const data = await sitemapPage(env, current.locale, kind, page, fetcher, request.signal);
    if (!data.items.length) return new Response(null, { status: 404, headers });
    return new Response(sitemapPageXml(publicOrigin(env)!, current.locale, manifests, data), {
      headers,
    });
  } catch {
    return unavailable();
  }
}
