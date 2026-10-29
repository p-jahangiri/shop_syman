import { notFound } from 'next/navigation';
import NextLink from 'next/link';
import { serverI18n } from '@/lib/server-locale';
import { fetchCmsPage } from '@/lib/cms-page-fetch';
import { pageMetadata } from '@/lib/seo';
import { localeHref } from '@/lib/i18n';
import { CmsPageView } from '@/components/cms-page-view';
export const dynamic = 'force-dynamic';
const load = (slug: string, locale: 'fa' | 'en') =>
  fetchCmsPage(slug, locale, {
    SHOP_DATA_MODE: process.env.SHOP_DATA_MODE,
    SHOP_API_URL: process.env.SHOP_API_URL,
  });
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
    { noindex: result.page.isDemo },
  );
}
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { locale } = await serverI18n(),
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
      />
    </div>
  );
}
