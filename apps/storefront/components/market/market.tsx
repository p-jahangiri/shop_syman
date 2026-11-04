'use client';
import { useEffect, useState } from 'react';
import { ArrowUpLeft, ChevronLeft, Info, Search, RefreshCcw } from 'lucide-react';
import Link from '../navigation/localized-link';
import Image from '../media/content-image';
import { useI18n, useStorefront } from '../navigation/locale-provider';
import {
  marketHref,
  marketInputSchema,
  type MarketItem,
  type MarketPage,
  type MarketQuery,
  type MarketFacets,
  type MarketFilters,
  type MarketValues,
} from '@sayman/web-shared/lib/market/market-contract.ts';
import { marketCopy } from '@/lib/market/market-copy';
import { publicImageVariant } from '@sayman/web-shared/lib/media/media-paths.ts';
import './market.css';
import { MarketSelection } from './sourcing';
import { MarketAttributeFilters } from './market-attributes';
import { MarketObservation } from './market-observation';
import { MarketSourcePanel } from './market-sources';
import type { MarketSources } from '@sayman/web-shared/lib/market/market-sources-contract.ts';

function useMarketClock(readAt: number) {
  const [now, setNow] = useState(readAt);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, [readAt]);
  return now;
}

function MarketCard({ item, query, now }: { item: MarketItem; query: MarketQuery; now: number }) {
  const { locale } = useI18n(),
    copy = marketCopy(locale),
    href = `/market/${encodeURIComponent(item.id)}`;
  return (
    <article className="market-card">
      <Link href={href} className="market-picture" tabIndex={-1} aria-hidden="true">
        <Image src={publicImageVariant(item.model.image, 'card')} alt="" width={360} height={260} />
      </Link>
      <div className="market-card-body">
        <div className="market-card-meta">
          <Link href={marketHref({ ...query, brandId: item.model.brandId, page: 1 })}>
            {item.model.brand}
          </Link>
          {item.isDemo && <span className="market-demo-label">{copy.demo}</span>}
        </div>
        <h2>
          <Link href={href}>{item.model.name}</Link>
        </h2>
        <MarketObservation item={item} now={now} />
        <Link className="market-card-action" href={href}>
          {copy.details}
          <ArrowUpLeft size={17} aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}
function MarketGeneralFilters({ query, facets }: { query: MarketQuery; facets: MarketFacets }) {
  const { locale, digits } = useI18n(),
    copy = marketCopy(locale),
    { categories } = useStorefront(),
    [categoryDraft, setCategoryDraft] = useState(query.categoryId ?? '');
  const sizes = Array.from(new Set([6, 12, 24, query.pageSize])).sort((a, b) => a - b);
  return (
    <form className="market-filters" action={`/${locale}/market`} method="get">
      <div className="market-search-field">
        <label htmlFor="market-query">{copy.search}</label>
        <div>
          <Search size={18} aria-hidden="true" />
          <input
            id="market-query"
            name="q"
            maxLength={120}
            defaultValue={query.query ?? ''}
            type="search"
          />
        </div>
      </div>
      <div>
        <label htmlFor="market-category">{copy.category}</label>
        <select
          id="market-category"
          name="category"
          value={categoryDraft}
          onChange={(event) => setCategoryDraft(event.target.value)}
        >
          <option value="">{copy.allCategories}</option>
          {query.categoryId && !facets.categories.some((item) => item.id === query.categoryId) && (
            <option value={query.categoryId}>
              {categories.find((item) => item.key === query.categoryId)?.name ?? query.categoryId} —{' '}
              {digits(0)}
            </option>
          )}
          {query.attributes?.length
            ? categories
                .filter(
                  (category) =>
                    category.key !== query.categoryId &&
                    !facets.categories.some((item) => item.id === category.key),
                )
                .map((category) => (
                  <option key={category.key} value={category.key}>
                    {category.name}
                  </option>
                ))
            : null}
          {facets.categories.map((item) => (
            <option key={item.id} value={item.id}>
              {categories.find((category) => category.key === item.id)?.name ?? item.id} —{' '}
              {digits(item.count)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="market-brand">{copy.brand}</label>
        <select id="market-brand" name="brand" defaultValue={query.brandId ?? ''}>
          <option value="">{copy.allBrands}</option>
          {query.brandId && !facets.brands.some((item) => item.id === query.brandId) && (
            <option value={query.brandId}>
              {query.brandId} — {digits(0)}
            </option>
          )}
          {facets.brands.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} — {digits(item.count)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="market-size">{copy.pageSize}</label>
        <select id="market-size" name="size" defaultValue={query.pageSize}>
          {sizes.map((size) => (
            <option key={size} value={size}>
              {digits(size)}
            </option>
          ))}
        </select>
      </div>
      {categoryDraft === (query.categoryId ?? '') &&
        (query.attributes ?? []).flatMap((item) =>
          item.values.map((value) => (
            <input
              key={item.key + '\0' + value}
              type="hidden"
              name={'attr.' + item.key}
              value={value}
            />
          )),
        )}
      <button className="button button-primary" type="submit">
        {copy.searchAction}
        <Search size={17} aria-hidden="true" />
      </button>
    </form>
  );
}
export function MarketBrowse({
  query,
  page,
  facets,
  filters,
  selectedValues,
  readAt,
}: {
  query: MarketQuery;
  page: MarketPage;
  facets: MarketFacets;
  filters?: MarketFilters;
  selectedValues?: MarketValues[];
  readAt: number;
}) {
  const { locale, digits } = useI18n(),
    copy = marketCopy(locale),
    now = useMarketClock(readAt);
  const activeBrand = facets.brands.find((item) => item.id === query.brandId)?.name;
  return (
    <div className="container market-page">
      <header className="market-heading">
        <span className="eyebrow">{copy.eyebrow}</span>
        <h1>{copy.title}</h1>
        <p>{copy.description}</p>
      </header>
      <p className="market-boundary">
        <Info size={19} aria-hidden="true" />
        {copy.boundary}
      </p>
      <MarketGeneralFilters key={JSON.stringify(query)} query={query} facets={facets} />
      <p className="market-facet-note">
        {copy.facetHelp}
        {(facets.moreCategories || facets.moreBrands) && <> {copy.facetLimit}</>}
      </p>
      <MarketAttributeFilters
        key={locale + JSON.stringify(query) + (filters?.version ?? '')}
        query={query}
        filters={filters}
        initialValues={selectedValues}
      />
      <div className="market-results-heading">
        <p>
          <strong>{digits(page.total)}</strong> {copy.results}
        </p>
        <Link href="/market" className="text-link">
          {copy.clear}
        </Link>
      </div>
      {query.brandId ? (
        <div className="market-brand-chip">
          <span>
            {copy.brandFilter}
            {activeBrand ? `: ${activeBrand}` : ''}
          </span>
          <Link href={marketHref({ ...query, brandId: undefined, page: 1 })}>
            {copy.clearBrand}
          </Link>
        </div>
      ) : (
        <p className="market-brand-hint">{copy.brandHint}</p>
      )}
      {page.items.length ? (
        <div className="market-grid">
          {page.items.map((item) => (
            <MarketCard key={item.id} item={item} query={query} now={now} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <Search size={34} aria-hidden="true" />
          <h2>{copy.empty}</h2>
          <p>{copy.emptyBody}</p>
          <Link href="/market" className="button button-outline">
            {copy.clear}
          </Link>
        </div>
      )}
      {(page.totalPages > 1 || page.page > 1) && (
        <nav className="catalog-pagination market-pagination" aria-label={copy.page}>
          {page.page > 1 && (
            <Link href={marketHref(marketInputSchema.parse({ ...query, page: query.page - 1 }))}>
              {copy.previous}
            </Link>
          )}
          <span>
            {copy.page} {digits(page.page)}
            {page.page <= page.totalPages && (
              <>
                {' '}
                {copy.of} {digits(page.totalPages)}
              </>
            )}
          </span>
          {page.page < page.totalPages && page.page < 10000 && (
            <Link href={marketHref({ ...query, page: query.page + 1 })}>{copy.next}</Link>
          )}
          {page.page === 10000 && page.totalPages > 10000 && <p>{copy.pageLimit}</p>}
        </nav>
      )}
    </div>
  );
}
export function MarketDetail({
  item,
  sources,
  readAt,
}: {
  item: MarketItem;
  sources: MarketSources;
  readAt: number;
}) {
  const { locale, digits } = useI18n(),
    copy = marketCopy(locale),
    { categories, attributeLabels, attributeDefinitions } = useStorefront(),
    now = useMarketClock(readAt),
    [image, setImage] = useState(0),
    model = item.model;
  const category = categories.find((value) => value.key === model.categoryId),
    selected = model.images[image] ?? model.image;
  const specs = Object.entries(model.attributes).filter(
    ([key]) =>
      category?.attributeRules?.find((rule) => rule.key === key)?.showInSpecs ??
      attributeDefinitions.find((definition) => definition.key === key)?.showInSpecs !== false,
  );
  return (
    <div className="container market-page market-detail">
      <nav className="market-breadcrumbs" aria-label={copy.eyebrow}>
        <Link href="/market">{copy.back}</Link>
        <ChevronLeft size={15} aria-hidden="true" />
        {category && (
          <>
            <Link href={marketHref(marketInputSchema.parse({ categoryId: model.categoryId }))}>
              {category.name}
            </Link>
            <ChevronLeft size={15} aria-hidden="true" />
          </>
        )}
        <span>{model.name}</span>
      </nav>
      <p className="market-boundary">
        <Info size={19} aria-hidden="true" />
        {copy.boundary}
      </p>
      <section className="market-detail-grid">
        <div className="market-gallery">
          <div className="market-gallery-main">
            <Image
              src={publicImageVariant(selected, 'zoom')}
              alt={model.name}
              width={700}
              height={560}
              priority
            />
          </div>
          {model.images.length > 1 && (
            <div className="market-thumbnails" aria-label={copy.image}>
              {model.images.map((url, index) => (
                <button
                  key={url}
                  type="button"
                  aria-label={`${copy.image} ${digits(index + 1)}`}
                  aria-pressed={image === index}
                  onClick={() => setImage(index)}
                >
                  <Image src={publicImageVariant(url, 'thumb')} alt="" width={80} height={65} />
                </button>
              ))}
            </div>
          )}
          {selected.startsWith('/products/') && (
            <small className="muted">{copy.conceptualImage}</small>
          )}
        </div>
        <div className="market-model-info">
          <Link
            className="text-link"
            href={marketHref(marketInputSchema.parse({ brandId: model.brandId }))}
          >
            {model.brand}
          </Link>
          <h1>{model.name}</h1>
          {locale === 'fa' && model.englishName !== model.name && (
            <p className="market-english-name" dir="ltr">
              {model.englishName}
            </p>
          )}
          {item.isDemo && (
            <p className="market-demo-note">
              <strong>{copy.demo}</strong>
              {copy.demoNote}
            </p>
          )}
          <div className="market-detail-observation">
            <MarketObservation item={item} now={now} detail />
          </div>
          <section className="market-sourcing" aria-labelledby="market-sourcing-title">
            <h2 id="market-sourcing-title">{copy.sourcingTitle}</h2>
            <MarketSelection item={item} />
            <Link href="/catalog" className="text-link">
              {copy.storeCatalog}
              <ArrowUpLeft size={16} aria-hidden="true" />
            </Link>
          </section>
        </div>
      </section>
      <MarketSourcePanel data={sources} now={now} />
      <div className="market-model-sections">
        <section aria-labelledby="market-specs-title">
          <h2 id="market-specs-title">{copy.specs}</h2>
          {specs.length ? (
            <dl className="market-specs">
              {specs.map(([key, value]) => (
                <div key={key}>
                  <dt>{attributeLabels[key] ?? key}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p>{copy.noSpecs}</p>
          )}
        </section>
        <section aria-labelledby="market-about-title">
          <h2 id="market-about-title">{copy.about}</h2>
          <p className="preserve-lines">{model.description}</p>
        </section>
      </div>
    </div>
  );
}
export function MarketFailure({ reset }: { reset: () => void }) {
  const { locale } = useI18n(),
    copy = marketCopy(locale);
  return (
    <div className="container empty-state market-page">
      <RefreshCcw size={38} aria-hidden="true" />
      <h1>{copy.unavailableTitle}</h1>
      <p>{copy.unavailableBody}</p>
      <button className="button button-primary" onClick={reset}>
        {copy.retry}
      </button>
      <Link href="/market">{copy.back}</Link>
    </div>
  );
}
