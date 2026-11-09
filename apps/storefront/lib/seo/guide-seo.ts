import type { Locale, StorefrontSnapshot } from '@sayman/web-shared/lib/shared/types.ts';
import {
  findBuyingGuide,
  guidePath,
  guidesIntro,
  guidesPath,
  type GuideSlug,
} from '../content/buying-guides.ts';
import { canIndex, localizedUrl, publicOrigin, type SeoEnvironment } from './seo.ts';

export function guideStructuredData(
  snapshot: StorefrontSnapshot,
  locale: Locale,
  slug?: GuideSlug,
  env?: SeoEnvironment,
) {
  const origin = publicOrigin(env);
  if (!origin || !canIndex(snapshot, env)) return [];
  const index = guidesIntro[locale];
  const guide = slug ? findBuyingGuide(slug, locale) : undefined;
  const url = (path: string) => localizedUrl(origin, locale, path);
  const trail = [
    { name: snapshot.site.name, item: url('/') },
    { name: index.title, item: url(guidesPath) },
  ];
  const data: Record<string, unknown>[] = [];
  if (slug && guide) {
    const item = url(guidePath(slug));
    trail.push({ name: guide.title, item });
    const organization = { '@type': 'Organization', name: snapshot.site.name, url: url('/') };
    data.push({
      '@context': 'https://schema.org',
      '@type': 'Article',
      '@id': item + '#article',
      mainEntityOfPage: item,
      headline: guide.title,
      description: guide.description,
      inLanguage: locale === 'fa' ? 'fa-IR' : 'en-US',
      author: organization,
      publisher: organization,
    });
  }
  data.push({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      ...item,
    })),
  });
  return data;
}
