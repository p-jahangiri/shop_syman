import { notFound } from 'next/navigation';
import { serverI18n } from '@/lib/navigation/server-locale';
import { Catalog } from '@/components/catalog/catalog';
import Link from '@/components/navigation/localized-link';
import {
  getCatalogSearch,
  getCatalogFilters,
  CatalogServiceError,
} from '@/lib/catalog/catalog-server';
import { catalogBrowseCondition, catalogQueryFromParams } from '@/lib/catalog/catalog-contract';
import { catalogTarget, pageMetadata, type SearchQuery } from '@/lib/seo/seo';
export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchQuery> }) {
  const snapshot = await serverI18n();
  const { category, path, noindex, used } = catalogTarget(snapshot, await searchParams);
  if (used && snapshot.site.appearance?.showUsedProducts === false) notFound();
  const usedTitle = snapshot.locale === 'fa' ? 'کالاهای کارکرده' : 'Used products';
  return pageMetadata(
    snapshot,
    snapshot.locale,
    path,
    used
      ? category
        ? `${category.name} · ${usedTitle}`
        : usedTitle
      : (category?.name ?? snapshot.t('کشف محصولات')),
    category?.description ?? snapshot.site.about,
    { noindex },
  );
}
export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<SearchQuery>;
}) {
  const { locale, categories, site, t } = await serverI18n();
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
  const showUsedProducts = site.appearance?.showUsedProducts !== false;
  if (!showUsedProducts && query.condition === 'used') notFound();
  try {
    const condition = showUsedProducts ? catalogBrowseCondition(query) : 'new';
    const [page, facets] = await Promise.all([
      getCatalogSearch(locale, { ...query, condition }),
      getCatalogFilters(locale, query.categoryId, undefined, condition),
    ]);
    return (
      <Catalog
        key={locale}
        query={query}
        page={page}
        facets={facets}
        suggestion={page.suggestion}
      />
    );
  } catch (error) {
    if (error instanceof CatalogServiceError && error.status === 404) notFound();
    if (!(error instanceof CatalogServiceError) || error.status !== 400) throw error;
    return (
      <div className="container empty-state">
        <h1>{t('فیلترهای این آدرس معتبر نیستند.')}</h1>
        <Link href="/catalog">{t('پاک کردن فیلتر و جست‌وجو')}</Link>
      </div>
    );
  }
}
