'use client';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n, useStorefront, ProductsScope } from './locale-provider';
import Link from './localized-link';
import { ChevronLeft, SlidersHorizontal, X, Search, RotateCcw, Check } from 'lucide-react';
import {
  catalogQueryParams,
  type CatalogQuery,
  type CatalogPage,
  type CatalogFilters,
} from '@/lib/catalog-contract';
import { normalizePersian } from '@/lib/commerce';
import { tomanInput } from '@/lib/money';
import { localeHref } from '@/lib/i18n';
import {
  areCatalogPriceRangesEqual,
  catalogFilterNeedsSearch,
  parseCatalogPriceRange,
  patchCatalogQuery,
  visibleCatalogFacets,
  type CatalogQueryChange,
} from '@/lib/catalog-filter-state';
import { CatalogFacet } from './catalog-facet';
import { CatalogFilterSection } from './catalog-filter-section';
import { CatalogPriceRange } from './catalog-price-range';
import { ProductGrid } from './product-card';
import { Button, Modal } from './ui';

const queryKey = (value: CatalogQuery) => catalogQueryParams(value).toString();
const priceInputs = (value: CatalogQuery) => ({
  min: value.minPriceRial ? tomanInput(value.minPriceRial) : '',
  max: value.maxPriceRial ? tomanInput(value.maxPriceRial) : '',
});
export function Catalog({
  query: serverQuery,
  page,
  facets,
}: {
  query: CatalogQuery;
  page: CatalogPage;
  facets: CatalogFilters;
}) {
  const { t, digits, toman, locale } = useI18n();
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const { categories, isPreview } = useStorefront();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(serverQuery);
  const intended = useRef(serverQuery);
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  }, [query.categoryId]);
  const category = categories.find((c) => c.key === query.categoryId);
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
  const staleFacets = query.categoryId !== serverQuery.categoryId;
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
      <section className="filter-section filter-category-section" aria-label={t('دسته‌بندی')}>
        <div className="filter-static-heading">
          <h3>{t('دسته‌بندی')}</h3>
        </div>
        <div className="filter-section-body">
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
              {t('همهٔ محصولات')}
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
                {c.name}
                <span className="category-selection" aria-hidden="true">
                  {category?.key === c.key && <Check size={12} />}
                </span>
              </button>
            ))}
            {!visibleCategories.length && (
              <p className="filter-note">{text('دسته‌بندی پیدا نشد', 'No matching categories')}</p>
            )}
          </div>
        </div>
      </section>
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
            key={`${query.categoryId}:${def.key}`}
            categoryId={query.categoryId!}
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
        <div className="page-top">
          <div className="breadcrumbs">
            <Link href="/">{t('سایمان')}</Link>
            <ChevronLeft />
            <Link href="/catalog">{t('فروشگاه')}</Link>
            {category && (
              <>
                <ChevronLeft />
                <span>{category.name}</span>
              </>
            )}
          </div>
          <div className="page-title-row">
            <div>
              <span className="eyebrow">{t('به انتخاب بعدی‌ات نزدیک‌تر شو')}</span>
              <h1>
                {query.query
                  ? t('نتایج جست‌وجو برای «{0}»', [query.query])
                  : (category?.name ?? t('همهٔ محصولات'))}
              </h1>
              <p>
                {category?.description ??
                  t('یک مجموعهٔ منتخب، برای کار، زندگی و لحظه‌های بین آن‌ها.')}
              </p>
            </div>
            <span>
              {digits(page.total)} {t('محصول')}
            </span>
          </div>
        </div>
        <div className="catalog-layout">
          <aside className="filter-sidebar">{filters('desktop')}</aside>
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
              <div className="sorting">
                <span>{t('مرتب‌سازی:')}</span>
                <select
                  disabled={pending}
                  aria-label={t('مرتب‌سازی محصولات')}
                  value={query.sort}
                  onChange={(e) => update({ sort: e.target.value as CatalogQuery['sort'] })}
                >
                  <option value="selected">{t('پیشنهاد سایمان')}</option>
                  <option value="price-asc">{t('ارزان‌ترین')}</option>
                  <option value="price-desc">{t('گران‌ترین')}</option>
                  <option value="newest">{t('جدیدترین')}</option>
                </select>
              </div>
              <span className="catalog-total" role="status">
                {pending || priceWaiting
                  ? t('در حال دریافت محصولات…')
                  : t('صفحهٔ {0} از {1}', [
                      digits(page.page),
                      digits(Math.max(1, page.totalPages)),
                    ])}
              </span>
            </div>
            {count > 0 && (
              <div className="active-filters">
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
                  <Search size={43} />
                  <h2>{t('هنوز انتخابی پیدا نکردیم')}</h2>
                  <p>{t('فیلترها را کمتر کن یا عبارت جست‌وجوی دیگری را امتحان کن.')}</p>
                  <Button variant="outline" disabled={pending} onClick={() => reset(true)}>
                    {text('دیدن همهٔ محصولات', 'Browse all products')}
                    <RotateCcw size={16} />
                  </Button>
                </div>
              )}
            </div>
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
            <div className="catalog-end">
              <span>
                {digits(page.total)} {t('محصول')}
              </span>
              {isPreview && <p>{t('قیمت و موجودی این نسخه برای بررسی طراحی است.')}</p>}
            </div>
          </section>
        </div>
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
