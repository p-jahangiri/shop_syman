'use client';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n, useStorefront, ProductsScope } from '@/components/navigation/locale-provider';
import Link from '@/components/navigation/localized-link';
import {
  ChevronLeft,
  ChevronDown,
  SlidersHorizontal,
  X,
  Search,
  RotateCcw,
  Check,
  Boxes,
  PackageCheck,
  Share2,
} from 'lucide-react';
import {
  catalogBrowseCondition,
  catalogQueryParams,
  type CatalogQuery,
  type CatalogPage,
  type CatalogFilters,
  type CatalogSearchSuggestion,
} from '@/lib/catalog/catalog-contract';
import { normalizePersian } from '@sayman/web-shared/lib/shared/commerce.ts';
import { tomanInput } from '@sayman/web-shared/lib/shared/money.ts';
import { localeHref } from '@/lib/navigation/i18n';
import {
  areCatalogPriceRangesEqual,
  catalogFilterNeedsSearch,
  parseCatalogPriceRange,
  patchCatalogQuery,
  visibleCatalogFacets,
  type CatalogQueryChange,
} from '@/lib/catalog/catalog-filter-state';
import { CatalogFacet } from './facet';
import { CatalogFilterSection } from './filter-section';
import { CatalogCategoryIcon } from './category-icon';
import { CatalogPriceRange } from './price-range';
import { ProductGrid } from '@/components/catalog/product-card';
import { Button, Modal } from '@/components/shared/ui';

const queryKey = (value: CatalogQuery) => catalogQueryParams(value).toString();
const priceInputs = (value: CatalogQuery) => ({
  min: value.minPriceRial ? tomanInput(value.minPriceRial) : '',
  max: value.maxPriceRial ? tomanInput(value.maxPriceRial) : '',
});
export function Catalog({
  query: serverQuery,
  page,
  facets,
  suggestion,
}: {
  query: CatalogQuery;
  page: CatalogPage;
  facets: CatalogFilters;
  suggestion?: CatalogSearchSuggestion;
}) {
  const { t, digits, toman, locale } = useI18n();
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const { categories, isPreview, dataSource, site } = useStorefront();
  const showUsedProducts = site.appearance?.showUsedProducts !== false;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(serverQuery);
  const intended = useRef(serverQuery);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const shareTrigger = useRef<HTMLButtonElement>(null);
  const filterTrigger = useRef<HTMLButtonElement>(null);
  const [prices, setPrices] = useState(() => priceInputs(serverQuery));
  const [brandSearch, setBrandSearch] = useState('');
  const [categorySearch, setCategorySearch] = useState('');
  const serverKey = queryKey(serverQuery);
  useEffect(() => {
    if (pending) return;
    const externalNavigation = queryKey(intended.current) !== serverKey;
    intended.current = serverQuery;
    setQuery((old) => (queryKey(old) === serverKey ? old : serverQuery));
    if (externalNavigation) setPrices(priceInputs(serverQuery));
  }, [serverKey, serverQuery, pending]);
  function openShare() {
    const filters = catalogQueryParams({ ...serverQuery, page: 1 });
    const path = localeHref('/catalog', locale);
    const url = new URL(path, window.location.origin);
    url.search = filters.toString();
    setCopied(false);
    setShareUrl(url.href);
  }
  async function copyShareUrl() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  function href(change: Partial<CatalogQuery>, base = intended.current) {
    const qs = queryKey(patchCatalogQuery(base, change));
    return `/catalog${qs ? '?' + qs : ''}`;
  }
  function update(change: CatalogQueryChange, replace = false) {
    const next = patchCatalogQuery(intended.current, change);
    if (queryKey(next) === queryKey(intended.current)) return;
    intended.current = next;
    setQuery(next);
    const url = localeHref(`/catalog${queryKey(next) ? '?' + queryKey(next) : ''}`, locale);
    startTransition(() =>
      replace ? router.replace(url, { scroll: false }) : router.push(url, { scroll: false }),
    );
  }
  const updateRef = useRef(update);
  updateRef.current = update;
  const parsedPrice = parseCatalogPriceRange(prices.min, prices.max);
  const priceError = parsedPrice.ok ? null : parsedPrice.error;
  const priceWaiting = parsedPrice.ok && !areCatalogPriceRangesEqual(parsedPrice.value, query);
  useEffect(() => {
    const parsed = parseCatalogPriceRange(prices.min, prices.max);
    if (!parsed.ok) return;
    const unchanged = () => areCatalogPriceRangesEqual(parsed.value, intended.current);
    if (unchanged()) return;
    const timer = setTimeout(() => {
      if (!unchanged()) updateRef.current(parsed.value, true);
    }, 500);
    return () => clearTimeout(timer);
  }, [prices.min, prices.max]);
  function reset(clearSearch = false) {
    setPrices({ min: '', max: '' });
    setBrandSearch('');
    if (clearSearch) setCategorySearch('');
    update({
      brandIds: [],
      attributes: [],
      minPriceRial: undefined,
      maxPriceRial: undefined,
      availableOnly: false,
      ...(clearSearch ? { query: undefined, categoryId: undefined } : {}),
    });
  }
  function clearPrice(bound: 'min' | 'max') {
    setPrices((old) => ({ ...old, [bound]: '' }));
    update({ [bound === 'min' ? 'minPriceRial' : 'maxPriceRial']: undefined });
  }
  function toggleAttribute(key: string, value: string) {
    update((latest) => {
      const old = latest.attributes.find((a) => a.key === key)?.values ?? [];
      const values = old.includes(value) ? old.filter((v) => v !== value) : [...old, value];
      return {
        attributes: [
          ...latest.attributes.filter((a) => a.key !== key),
          ...(values.length ? [{ key, values }] : []),
        ],
      };
    });
  }
  const [facetLabels, setFacetLabels] = useState<Record<string, Record<string, string>>>({});
  const receiveLabels = useCallback((key: string, labels: Record<string, string>) => {
    setFacetLabels((old) =>
      JSON.stringify(old[key] ?? {}) === JSON.stringify(labels) ? old : { ...old, [key]: labels },
    );
  }, []);
  useEffect(() => {
    setFacetLabels({});
    setBrandSearch('');
  }, [query.categoryId, query.condition]);
  const category = categories.find((c) => c.key === query.categoryId);
  const condition = catalogBrowseCondition(query);
  const usedCatalog = query.condition === 'used';
  const usedTitle = text('کالاهای کارکرده', 'Used products');
  const CatalogIcon = query.query ? Search : usedCatalog ? PackageCheck : Boxes;
  const count =
    query.brandIds.length +
    query.attributes.reduce((n, a) => n + a.values.length, 0) +
    Number(query.availableOnly) +
    Number(!!query.minPriceRial || !!query.maxPriceRial);
  const match = (value: string, search: string) =>
    normalizePersian(value)
      .toLocaleLowerCase()
      .includes(normalizePersian(search.trim()).toLocaleLowerCase());
  const visibleBrands = facets.brands.filter(
    (brand) => query.brandIds.includes(brand.id) || match(brand.name, brandSearch),
  );
  const visibleCategories = categories.filter(
    (c) => c.key === query.categoryId || match(c.name, categorySearch),
  );
  const staleFacets =
    query.categoryId !== serverQuery.categoryId ||
    condition !== catalogBrowseCondition(serverQuery);
  const resultsBusy = pending || priceWaiting;
  function selectCategory(categoryId?: string) {
    // Re-selecting the current category must preserve the user's other choices.
    if (intended.current.categoryId === categoryId) return;
    update({ categoryId, attributes: [], brandIds: [] });
  }
  const filters = (mode: 'desktop' | 'mobile') => (
    <div className="filter-content">
      <div className="filter-heading">
        <div>
          <h2>
            <SlidersHorizontal size={18} />
            {t('فیلترها')}
            {count > 0 && <span>{digits(count)}</span>}
          </h2>
          <p>
            {text('با تغییر فیلترها، نتایج به‌روز می‌شوند', 'Results update as you change filters')}
          </p>
        </div>
        {count > 0 && (
          <button type="button" onClick={() => reset()} className="text-button">
            {t('حذف همه')}
          </button>
        )}
      </div>
      {showUsedProducts && (
        <nav className="facet-pills" aria-label={text('وضعیت کالا', 'Product condition')}>
          <Link
            className="condition-option"
            aria-current={condition === 'new' ? 'page' : undefined}
            href="/catalog"
          >
            <Boxes size={16} aria-hidden="true" />
            {text('کالاهای نو', 'New products')}
          </Link>
          <Link
            className="condition-option"
            aria-current={condition === 'used' ? 'page' : undefined}
            href="/catalog?condition=used"
          >
            <PackageCheck size={16} aria-hidden="true" />
            {text('کالاهای کارکرده', 'Used products')}
          </Link>
        </nav>
      )}
      <CatalogFilterSection
        className="filter-category-section"
        title={t('دسته‌بندی')}
        summary={category?.name}
        icon={<CatalogCategoryIcon categoryKey="all" size={16} />}
        defaultOpen
      >
        {catalogFilterNeedsSearch(categories.length) && (
          <label className="filter-search">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              aria-label={text('جست‌وجو در دسته‌بندی‌ها', 'Search categories')}
              placeholder={text('جست‌وجوی دسته‌بندی', 'Search categories')}
              value={categorySearch}
              onChange={(e) => setCategorySearch(e.target.value)}
              maxLength={100}
            />
          </label>
        )}
        <div className="filter-options">
          <button
            type="button"
            aria-pressed={!category}
            className={!category ? 'category-filter active' : 'category-filter'}
            onClick={() => selectCategory()}
          >
            <span className="category-option-icon">
              <CatalogCategoryIcon categoryKey="all" size={16} />
            </span>
            <span className="category-option-name">{text('همهٔ دسته‌ها', 'All categories')}</span>
            <span className="category-selection" aria-hidden="true">
              {!category && <Check size={12} />}
            </span>
          </button>
          {visibleCategories.map((c) => (
            <button
              type="button"
              key={c.key}
              aria-pressed={category?.key === c.key}
              className={category?.key === c.key ? 'category-filter active' : 'category-filter'}
              onClick={() => selectCategory(c.key)}
            >
              <span className="category-option-icon">
                <CatalogCategoryIcon categoryKey={c.key} size={16} />
              </span>
              <span className="category-option-name">{c.name}</span>
              <span className="category-selection" aria-hidden="true">
                {category?.key === c.key && <Check size={12} />}
              </span>
            </button>
          ))}
          {!visibleCategories.length && (
            <p className="filter-note">{text('دسته‌بندی پیدا نشد', 'No matching categories')}</p>
          )}
        </div>
      </CatalogFilterSection>
      <CatalogFilterSection
        title={t('برند')}
        defaultOpen={query.brandIds.length > 0}
        summary={
          query.brandIds.length
            ? text(
                `${digits(query.brandIds.length)} انتخاب`,
                `${digits(query.brandIds.length)} selected`,
              )
            : undefined
        }
      >
        {catalogFilterNeedsSearch(facets.brands.length) && (
          <label className="filter-search">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              aria-label={text('جست‌وجو در برندها', 'Search brands')}
              placeholder={text('نام برند را بنویسید', 'Search brands')}
              value={brandSearch}
              onChange={(e) => setBrandSearch(e.target.value)}
              maxLength={100}
            />
          </label>
        )}
        <div className="filter-options" aria-busy={staleFacets}>
          {visibleBrands.map((brand) => (
            <label className="check-label" key={brand.id}>
              <input
                type="checkbox"
                disabled={
                  staleFacets || (!query.brandIds.includes(brand.id) && query.brandIds.length >= 20)
                }
                checked={query.brandIds.includes(brand.id)}
                onChange={() =>
                  update((latest) => ({
                    brandIds: latest.brandIds.includes(brand.id)
                      ? latest.brandIds.filter((id) => id !== brand.id)
                      : [...latest.brandIds, brand.id],
                  }))
                }
              />
              <span>{brand.name}</span>
            </label>
          ))}
          {!visibleBrands.length && (
            <p className="filter-note">{text('برندی پیدا نشد', 'No matching brands')}</p>
          )}
        </div>
      </CatalogFilterSection>
      <CatalogFilterSection title={text('محدوده قیمت', 'Price range')} defaultOpen>
        <CatalogPriceRange
          value={prices}
          maximumRial={facets.maxPriceRial}
          locale={locale}
          error={priceError}
          errorId={`price-error-${mode}`}
          busy={priceWaiting || pending}
          disabled={staleFacets}
          onChange={(bound, value) => setPrices((old) => ({ ...old, [bound]: value }))}
        />
      </CatalogFilterSection>
      {query.categoryId &&
        !staleFacets &&
        visibleCatalogFacets(facets.attributes, query.attributes).map((def) => (
          <CatalogFacet
            key={`${query.categoryId}:${condition}:${def.key}`}
            categoryId={query.categoryId!}
            condition={condition}
            facet={def}
            selected={query.attributes.find((a) => a.key === def.key)?.values ?? []}
            disabled={false}
            canAdd={query.attributes.some((a) => a.key === def.key) || query.attributes.length < 8}
            onToggle={toggleAttribute}
            onLabels={receiveLabels}
          />
        ))}
      <section
        className="filter-section filter-availability"
        aria-label={text('موجودی', 'Availability')}
      >
        <label className="switch-label">
          <span>{t('فقط کالاهای موجود')}</span>
          <input
            type="checkbox"
            checked={query.availableOnly}
            onChange={(e) => update({ availableOnly: e.target.checked })}
          />
        </label>
      </section>
    </div>
  );
  return (
    <ProductsScope products={page.products}>
      <div className="container catalog-page">
        <header
          className="page-top catalog-discovery-header"
          data-view={query.query ? 'search' : usedCatalog ? 'used' : category ? 'category' : 'all'}
        >
          <nav className="breadcrumbs" aria-label={text('مسیر صفحه', 'Breadcrumb')}>
            <Link href="/">{t('سایمان')}</Link>
            <ChevronLeft aria-hidden="true" />
            <Link href="/catalog">{t('فروشگاه')}</Link>
            {usedCatalog && (
              <>
                <ChevronLeft aria-hidden="true" />
                {category || query.query ? (
                  <Link href="/catalog?condition=used">{usedTitle}</Link>
                ) : (
                  <span aria-current="page">{usedTitle}</span>
                )}
              </>
            )}
            {category && (
              <>
                <ChevronLeft aria-hidden="true" />
                <span aria-current={query.query ? undefined : 'page'}>{category.name}</span>
              </>
            )}
          </nav>
          <div className="page-title-row">
            <span className="catalog-discovery-icon" aria-hidden="true">
              <CatalogIcon size={23} />
            </span>
            <div className="catalog-discovery-copy">
              <h1>
                {query.query
                  ? t('نتایج جست‌وجو برای «{0}»', [query.query])
                  : usedCatalog
                    ? category
                      ? `${usedTitle} · ${category.name}`
                      : usedTitle
                    : (category?.name ?? t('همهٔ محصولات'))}
              </h1>
              {!query.query && (usedCatalog || category?.description) && (
                <p>
                  {usedCatalog
                    ? text(
                        'قیمت و گزارش سلامت هر دستگاه را جداگانه ببینید.',
                        'See the price and condition report for each device.',
                      )
                    : category?.description}
                </p>
              )}
            </div>
          </div>
        </header>
        <div className="catalog-layout">
          <aside className="filter-sidebar">
            <div className="catalog-filter-scroll">{filters('desktop')}</div>
          </aside>
          <section
            className="catalog-results"
            aria-label={t('فهرست محصولات')}
            aria-busy={resultsBusy}
          >
            <div className="catalog-toolbar">
              <button
                ref={filterTrigger}
                className="filter-mobile-button"
                aria-haspopup="dialog"
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen(true)}
              >
                <SlidersHorizontal size={16} />
                {t('فیلترها')}
                {count > 0 && <span>{digits(count)}</span>}
              </button>
              <label className="sorting">
                <span className="catalog-sort-label">{text('ترتیب نمایش', 'Sort by')}</span>
                <span className="catalog-sort-control">
                  <select
                    disabled={pending}
                    aria-label={t('مرتب‌سازی محصولات')}
                    value={query.sort}
                    onChange={(e) => update({ sort: e.target.value as CatalogQuery['sort'] })}
                  >
                    <option value="selected">{text('پیش‌فرض', 'Default')}</option>
                    <option value="price-asc">{t('ارزان‌ترین')}</option>
                    <option value="price-desc">{t('گران‌ترین')}</option>
                    <option value="newest">{t('جدیدترین')}</option>
                  </select>
                  <ChevronDown size={15} aria-hidden="true" />
                </span>
              </label>
              <button
                type="button"
                ref={shareTrigger}
                className="catalog-share-button"
                aria-label={text('اشتراک نتایج', 'Share results')}
                disabled={pending || priceWaiting}
                onClick={openShare}
              >
                <Share2 size={16} aria-hidden="true" />
                <span>{text('اشتراک نتایج', 'Share results')}</span>
              </button>
              <span className="catalog-total" role="status">
                {pending || priceWaiting
                  ? t('در حال دریافت محصولات…')
                  : `${digits(page.total)} ${t('محصول')}`}
              </span>
            </div>
            {(count > 0 || query.query) && (
              <div className="active-filters">
                {query.query && (
                  <button
                    type="button"
                    aria-label={t('پاک کردن جست‌وجو')}
                    onClick={() => update({ query: undefined })}
                  >
                    <Search size={13} aria-hidden="true" />
                    <bdi>{query.query}</bdi>
                    <X size={12} aria-hidden="true" />
                  </button>
                )}
                {query.brandIds.map((id) => (
                  <button
                    key={id}
                    onClick={() =>
                      update((latest) => ({
                        brandIds: latest.brandIds.filter((b) => b !== id),
                      }))
                    }
                  >
                    {facets.brands.find((b) => b.id === id)?.name ??
                      text('برند انتخاب‌شده', 'Selected brand')}
                    <X size={12} />
                  </button>
                ))}
                {query.attributes.flatMap((a) =>
                  a.values.map((value) => (
                    <button key={`${a.key}:${value}`} onClick={() => toggleAttribute(a.key, value)}>
                      {facetLabels[a.key]?.[value] ??
                        facets.attributes
                          .find((d) => d.key === a.key)
                          ?.values.find((v) => v.value === value)?.label ??
                        facets.attributes.find((d) => d.key === a.key)?.label ??
                        text('ویژگی انتخاب‌شده', 'Selected feature')}
                      <X size={12} />
                    </button>
                  )),
                )}
                {query.minPriceRial && (
                  <button
                    onClick={() => clearPrice('min')}
                    aria-label={text('حذف حداقل قیمت', 'Remove minimum price')}
                  >
                    {text('از', 'From')} {toman(query.minPriceRial)} {text('تومان', 'toman')}
                    <X size={12} />
                  </button>
                )}
                {query.maxPriceRial && (
                  <button
                    onClick={() => clearPrice('max')}
                    aria-label={text('حذف حداکثر قیمت', 'Remove maximum price')}
                  >
                    {text('تا', 'Up to')} {toman(query.maxPriceRial)} {text('تومان', 'toman')}
                    <X size={12} />
                  </button>
                )}
                {query.availableOnly && (
                  <button onClick={() => update({ availableOnly: false })}>
                    {t('فقط کالاهای موجود')}
                    <X size={12} />
                  </button>
                )}
              </div>
            )}
            {priceError && (
              <p className="catalog-range-notice" role="status">
                {text(
                  'برای دیدن نتایج جدید، محدودهٔ قیمت را اصلاح کنید.',
                  'Correct the price range to see updated results.',
                )}
              </p>
            )}
            <div
              className="catalog-product-results"
              inert={resultsBusy || Boolean(priceError)}
              data-updating={resultsBusy || Boolean(priceError) ? '' : undefined}
            >
              {page.products.length ? (
                <ProductGrid items={page.products} variantIds={page.matchingVariantIds} />
              ) : (
                <div className="empty-state card-panel">
                  <Search size={36} aria-hidden="true" />
                  {page.total > 0 ? (
                    <>
                      <h2>
                        {text('این صفحه دیگر در دسترس نیست', 'This page is no longer available')}
                      </h2>
                      <p>
                        {text(
                          'جست‌وجو و فیلترهای فعلی حفظ می‌شوند.',
                          'Your search and filters will be kept.',
                        )}
                      </p>
                      <Button
                        variant="outline"
                        disabled={pending}
                        onClick={() => update({ page: 1 })}
                      >
                        {text('بازگشت به صفحهٔ اول', 'Back to the first page')}
                      </Button>
                    </>
                  ) : (
                    <>
                      <h2>{t('هنوز انتخابی پیدا نکردیم')}</h2>
                      {suggestion && (
                        <div className="catalog-search-suggestion">
                          <p>
                            {text('با این عبارت نتیجه پیدا شد', 'We found results for this search')}
                          </p>
                          <Button
                            variant="primary"
                            disabled={pending}
                            onClick={() => update({ query: suggestion.query })}
                          >
                            <Search size={16} aria-hidden="true" />
                            <bdi>{suggestion.query}</bdi>
                            <span>
                              {digits(suggestion.total)} {t('محصول')}
                            </span>
                          </Button>
                        </div>
                      )}
                      {!suggestion && (
                        <p>{t('فیلترها را کمتر کن یا عبارت جست‌وجوی دیگری را امتحان کن.')}</p>
                      )}
                      <div className="catalog-empty-actions">
                        {count > 0 && (
                          <Button variant="outline" disabled={pending} onClick={() => reset()}>
                            {text('برداشتن فیلترها', 'Clear filters')}
                          </Button>
                        )}
                        <Button variant="outline" disabled={pending} onClick={() => reset(true)}>
                          {text('دیدن همهٔ محصولات', 'Browse all products')}
                          <RotateCcw size={16} aria-hidden="true" />
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            {page.products.length > 0 && (
              <nav className="catalog-pagination" aria-label={t('صفحه‌بندی محصولات')}>
                {!pending && !priceWaiting && !priceError && page.page > 1 && (
                  <Link href={href({ page: page.page - 1 })} prefetch={false}>
                    {t('صفحهٔ قبل')}
                  </Link>
                )}
                <span>
                  {t('صفحهٔ {0} از {1}', [digits(page.page), digits(Math.max(1, page.totalPages))])}
                </span>
                {!pending &&
                  !priceWaiting &&
                  !priceError &&
                  page.page < page.totalPages &&
                  page.page < 10000 && (
                    <Link href={href({ page: page.page + 1 })} prefetch={false}>
                      {t('صفحهٔ بعد')}
                    </Link>
                  )}
              </nav>
            )}
            {isPreview && dataSource !== 'api' && (
              <div className="catalog-end">
                <p>{t('قیمت و موجودی این نسخه برای بررسی طراحی است.')}</p>
              </div>
            )}
          </section>
        </div>
        <Modal
          open={!!shareUrl}
          onOpenChange={(open) => {
            if (!open) setShareUrl('');
          }}
          title={text('اشتراک نتایج جست‌وجو', 'Share catalog results')}
          description={text(
            'لینک با فیلترها و ترتیب فعلی باز می‌شود.',
            'The link opens with the current filters and sort order.',
          )}
          restoreFocusRef={shareTrigger}
        >
          <div className="catalog-share-dialog">
            <input
              type="url"
              aria-label={text('نشانی نتایج', 'Results link')}
              dir="ltr"
              value={shareUrl}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button type="button" onClick={() => void copyShareUrl()}>
              {copied ? text('لینک کپی شد', 'Link copied') : text('کپی لینک', 'Copy link')}
            </Button>
            <span role="status">
              {copied ? text('نشانی آمادهٔ ارسال است.', 'The link is ready to send.') : ''}
            </span>
          </div>
        </Modal>
        <Modal
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          title={t('انتخاب دقیق‌تر')}
          drawer
          className="catalog-filter-dialog"
          restoreFocusRef={filterTrigger}
        >
          <div className="catalog-filter-sheet">
            <div className="catalog-filter-scroll">{filters('mobile')}</div>
            <div className="catalog-filter-footer">
              <Button
                className="full mobile-filter-submit"
                disabled={pending || priceWaiting || Boolean(priceError)}
                onClick={() => setFiltersOpen(false)}
              >
                {pending || priceWaiting
                  ? text('در حال به‌روزرسانی…', 'Updating results…')
                  : `${t('نمایش')} ${digits(page.total)} ${t('محصول')}`}
                <Check size={17} />
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </ProductsScope>
  );
}
