import { notFound } from 'next/navigation';
import { cache } from 'react';
import NextLink from 'next/link';
import { serverI18n } from '@/lib/navigation/server-locale';
import { fetchCmsPage } from '@/lib/content/cms-page-fetch';
import { pageMetadata } from '@/lib/seo/seo';
import { localeHref } from '@/lib/navigation/i18n';
import { CmsPageView } from '@sayman/web-shared/components/content/cms-page-view';
import { isPurchaseHrefEnabled } from '@/lib/catalog/purchasing';
import { isUsedCatalogHref } from '@sayman/web-shared/lib/content/appearance.ts';
export const dynamic = 'force-dynamic';
const load = cache((slug: string, locale: 'fa' | 'en') =>
  fetchCmsPage(slug, locale, {
    SHOP_DATA_MODE: process.env.SHOP_DATA_MODE,
    SHOP_API_URL: process.env.SHOP_API_URL,
  }),
);
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const snapshot = await serverI18n(),
    { slug } = await params,
    result = await load(slug, snapshot.locale);
  if (result.status !== 'ready') return { robots: { index: false, follow: false } };
  return pageMetadata(
    snapshot,
    snapshot.locale,
    `/pages/${slug}`,
    result.page.title,
    result.page.description,
    // Only this published translation is verified here. The sitemap adds pairs
    // from its publication projection without another metadata request chain.
    { noindex: result.page.isDemo, availableLocales: [snapshot.locale] },
  );
}
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { locale, purchaseMethods, site } = await serverI18n(),
    { slug } = await params,
    result = await load(slug, locale);
  if (result.status === 'missing') notFound();
  if (result.status !== 'ready') throw Error('Content service temporarily unavailable');
  const p = result.page;
  return (
    <div className="container">
      <CmsPageView
        content={{ title: p.title, description: p.description, blocks: p.blocks }}
        locale={locale}
        isDemo={p.isDemo}
        link={(href, label) => <NextLink href={localeHref(href, locale)}>{label}</NextLink>}
        canLink={(href) =>
          isPurchaseHrefEnabled(href, purchaseMethods) &&
          (site.appearance?.showUsedProducts !== false || !isUsedCatalogHref(href))
        }
      />
    </div>
  );
}
