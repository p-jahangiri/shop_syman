import { notFound } from 'next/navigation';
import { serverI18n } from '@/lib/server-locale';
import { Catalog } from '@/components/catalog';
import Link from '@/components/localized-link';
import { getCatalogPage, getCatalogFilters, CatalogServiceError } from '@/lib/catalog-server';
import { catalogQueryFromParams } from '@/lib/catalog-contract';
import { catalogTarget, pageMetadata, type SearchQuery } from '@/lib/seo';
export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchQuery> }) {
  const snapshot = await serverI18n();
  const { category, path, noindex } = catalogTarget(snapshot, await searchParams);
  return pageMetadata(
    snapshot,
    snapshot.locale,
    path,
    category?.name ?? snapshot.t('کشف محصولات'),
    category?.description ?? snapshot.site.about,
    { noindex },
  );
}
export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<SearchQuery>;
}) {
  const { locale, categories, t } = await serverI18n();
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
    else if (value !== undefined) params.set(key, value);
  }
  let query;
  try {
    query = catalogQueryFromParams(params);
  } catch {
    return (
      <div className="container empty-state">
        <h1>{t('فیلترهای این آدرس معتبر نیستند.')}</h1>
        <Link href="/catalog">{t('پاک کردن فیلتر و جست‌وجو')}</Link>
      </div>
    );
  }
  if (query.categoryId && !categories.some((c) => c.key === query.categoryId)) notFound();
  try {
    const [page, facets] = await Promise.all([
      getCatalogPage(locale, query),
      getCatalogFilters(locale, query.categoryId),
    ]);
    return <Catalog key={locale} query={query} page={page} facets={facets} />;
  } catch (error) {
    if (!(error instanceof CatalogServiceError) || error.status !== 400) throw error;
    return (
      <div className="container empty-state">
        <h1>{t('فیلترهای این آدرس معتبر نیستند.')}</h1>
        <Link href="/catalog">{t('پاک کردن فیلتر و جست‌وجو')}</Link>
      </div>
    );
  }
}
