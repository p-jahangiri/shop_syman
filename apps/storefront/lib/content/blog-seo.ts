import {
  canIndex,
  publicOrigin,
  publicMedia,
  localizedUrl,
  type SeoEnvironment,
} from '../seo/seo.ts';
import type { StorefrontSnapshot, Locale } from '@sayman/web-shared/lib/shared/types.ts';
import {
  cmsPublicBlogPostSchema,
  type CmsPublicBlogPost,
} from '@sayman/web-shared/lib/content/cms-blog-post-contract.ts';
export function blogPostStructuredData(
  snapshot: StorefrontSnapshot,
  value: CmsPublicBlogPost,
  locale: Locale,
  env: SeoEnvironment = {
    SHOP_PUBLIC_URL: process.env.SHOP_PUBLIC_URL,
    SHOP_ENABLE_INDEXING: process.env.SHOP_ENABLE_INDEXING,
  },
): Record<string, unknown>[] {
  const p = cmsPublicBlogPostSchema.parse(value),
    origin = publicOrigin(env);
  if (p.locale !== locale || p.isDemo || !origin || !canIndex(snapshot, env)) return [];
  const url = localizedUrl(origin, locale, '/blog/' + p.slug),
    image = publicMedia(p.cover ?? undefined, origin);
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      '@id': url + '#article',
      mainEntityOfPage: url,
      url,
      headline: p.title,
      description: p.description,
      inLanguage: locale === 'fa' ? 'fa-IR' : 'en-US',
      datePublished: p.firstPublishedAt,
      dateModified: p.publishedAt,
      author: { '@type': p.authorKind, name: p.byline },
      publisher: { '@type': 'Organization', name: snapshot.site.name },
      ...(image ? { image: [image] } : {}),
      keywords: p.tags.map((t) => t.name).join(', '),
    },
  ];
}
