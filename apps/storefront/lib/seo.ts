import type { Metadata, MetadataRoute } from 'next';
import type { Locale, Product, StorefrontSnapshot } from './types.ts';

export interface SeoEnvironment {
  SHOP_PUBLIC_URL?: string;
  SHOP_ENABLE_INDEXING?: string;
}
const deploymentEnvironment = (): SeoEnvironment => ({
  SHOP_PUBLIC_URL: process.env.SHOP_PUBLIC_URL,
  SHOP_ENABLE_INDEXING: process.env.SHOP_ENABLE_INDEXING,
});
const localHost = (host: string) =>
  host === 'localhost' ||
  host.endsWith('.localhost') ||
  host.endsWith('.local') ||
  host === '[::1]' ||
  /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
  host === '0.0.0.0';
// A deployment setting, never the untrusted request Host or forwarded headers.
export function publicOrigin(env: SeoEnvironment = deploymentEnvironment()): string | undefined {
  if (!env.SHOP_PUBLIC_URL) return undefined;
  try {
    const u = new URL(env.SHOP_PUBLIC_URL);
    if (
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname !== '/' ||
      !(
        u.protocol === 'https:' ||
        (u.protocol === 'http:' &&
          (['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) ||
            u.hostname.endsWith('.localhost')))
      )
    )
      return undefined;
    return u.origin;
  } catch {
    return undefined;
  }
}
export function canIndexEnvironment(env: SeoEnvironment = deploymentEnvironment()): boolean {
  const origin = publicOrigin(env);
  return (
    !!origin &&
    origin.startsWith('https:') &&
    !localHost(new URL(origin).hostname) &&
    env.SHOP_ENABLE_INDEXING === 'true'
  );
}
export function canIndex(
  snapshot: StorefrontSnapshot,
  env: SeoEnvironment = deploymentEnvironment(),
): boolean {
  return (
    canIndexEnvironment(env) &&
    snapshot.dataSource === 'api' &&
    !snapshot.isPreview &&
    snapshot.site.seo?.allowIndexing === true
  );
}
export function publicMedia(
  path: string | undefined,
  origin: string | undefined,
): string | undefined {
  // eslint-disable-next-line no-control-regex -- Reject forbidden control characters at the trust boundary.
  if (!path || !origin || path.includes('\\') || /[\x00-\x20]/.test(path)) return undefined;
  try {
    const u = new URL(path, origin);
    return (path.startsWith('/products/') ||
      path.startsWith('/media/') ||
      path.startsWith('https://')) &&
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash
      ? u.href
      : undefined;
  } catch {
    return undefined;
  }
}
export function localizedUrl(origin: string, locale: Locale, path: string) {
  return `${origin}/${locale}${path === '/' ? '' : path}`;
}
export function languageUrls(
  origin: string,
  path: string,
  availableLocales: readonly Locale[] = ['fa', 'en'],
) {
  const available = [...new Set(availableLocales)];
  return {
    ...Object.fromEntries(available.map((locale) => [locale, localizedUrl(origin, locale, path)])),
    ...(available.includes('fa') ? { 'x-default': localizedUrl(origin, 'fa', path) } : {}),
  };
}
export function pageMetadata(
  snapshot: StorefrontSnapshot,
  locale: Locale,
  path: string,
  title: string,
  description: string,
  options: { noindex?: boolean; image?: string; availableLocales?: readonly Locale[] } = {},
  env: SeoEnvironment = deploymentEnvironment(),
): Metadata {
  const origin = publicOrigin(env);
  const indexed = canIndex(snapshot, env);
  const fullTitle = `${title} | ${snapshot.site.name}`;
  const image = publicMedia(options.image ?? snapshot.site.seo?.shareImage, origin);
  return {
    title: { absolute: fullTitle },
    description: description.slice(0, 400),
    robots: { index: indexed && !options.noindex, follow: indexed },
    ...(origin
      ? {
          alternates: {
            canonical: localizedUrl(origin, locale, path),
            languages: languageUrls(origin, path, options.availableLocales),
          },
          openGraph: {
            title: fullTitle,
            description: description.slice(0, 400),
            siteName: snapshot.site.name,
            type: 'website' as const,
            url: localizedUrl(origin, locale, path),
            locale: locale === 'fa' ? 'fa_IR' : 'en_US',
            alternateLocale: (options.availableLocales ?? ['fa', 'en'])
              .filter((available) => available !== locale)
              .map((available) => (available === 'fa' ? 'fa_IR' : 'en_US')),
            ...(image ? { images: [image] } : {}),
          },
          twitter: {
            card: image ? ('summary_large_image' as const) : ('summary' as const),
            title: fullTitle,
            description: description.slice(0, 400),
            ...(image ? { images: [image] } : {}),
          },
        }
      : {}),
  };
}
export type SearchQuery = Record<string, string | string[] | undefined>;
export function catalogTarget(snapshot: StorefrontSnapshot, query: SearchQuery) {
  const category =
    typeof query.category === 'string'
      ? snapshot.categories.find((c) => c.key === query.category)
      : undefined;
  const path = category ? `/catalog?category=${encodeURIComponent(category.key)}` : '/catalog';
  const noindex = Object.entries(query).some(
    ([key, value]) =>
      value !== undefined && (key !== 'category' || !category || Array.isArray(value)),
  );
  return { category, path, noindex };
}
// Escape HTML/script delimiters even when all content originated in an authorized CMS.
export const jsonLd = (value: unknown) =>
  JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
export function productStructuredData(
  snapshot: StorefrontSnapshot,
  product: Product,
  locale: Locale,
  env: SeoEnvironment = deploymentEnvironment(),
): Record<string, unknown>[] {
  const origin = publicOrigin(env);
  if (!origin || !canIndex(snapshot, env)) return [];
  const path = `/product/${encodeURIComponent(product.slug)}`;
  const url = localizedUrl(origin, locale, path);
  const category = snapshot.categories.find((c) => c.key === product.category);
  const image = publicMedia(product.image, origin);
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Product',
      '@id': `${url}#product`,
      url,
      name: product.name,
      description: product.description,
      brand: { '@type': 'Brand', name: product.brand },
      ...(image ? { image: [image] } : {}),
      ...(category ? { category: category.name } : {}),
      offers: product.variants.map((v) => ({
        '@type': 'Offer',
        sku: v.sku,
        name: v.label,
        priceCurrency: 'IRR',
        price: v.priceRial,
        itemCondition: `https://schema.org/${v.usedCondition ? 'UsedCondition' : 'NewCondition'}`,
        availability: `https://schema.org/${v.stock > 0 ? 'InStock' : 'OutOfStock'}`,
        url: `${url}?variant=${encodeURIComponent(v.id)}`,
        seller: { '@type': 'Organization', name: snapshot.site.name },
      })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { name: snapshot.site.name, item: localizedUrl(origin, locale, '/') },
        ...(category
          ? [
              {
                name: category.name,
                item: localizedUrl(
                  origin,
                  locale,
                  `/catalog?category=${encodeURIComponent(category.key)}`,
                ),
              },
            ]
          : []),
        { name: product.name, item: url },
      ].map((item, i) => ({ '@type': 'ListItem', position: i + 1, ...item })),
    },
  ];
}
export function sitemapEntries(
  snapshots: StorefrontSnapshot[],
  env: SeoEnvironment = deploymentEnvironment(),
): MetadataRoute.Sitemap {
  const origin = publicOrigin(env);
  if (!origin) return [];
  const eligible = snapshots.filter((s) => canIndex(s, env) && s.locale);
  const pathsFor = (s: StorefrontSnapshot) => [
    '/',
    '/catalog',
    ...s.categories.map((c) => `/catalog?category=${encodeURIComponent(c.key)}`),
    ...s.products.map((p) => `/product/${encodeURIComponent(p.slug)}`),
  ];
  return eligible.flatMap((s) =>
    [...new Set(pathsFor(s))].map((path) => ({
      url: localizedUrl(origin, s.locale!, path),
      alternates: {
        languages: Object.fromEntries(
          eligible
            .filter((other) => pathsFor(other).includes(path))
            .map((other) => [other.locale!, localizedUrl(origin, other.locale!, path)]),
        ),
      },
    })),
  );
}
