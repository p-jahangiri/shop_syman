'use client';
import { useEffect, useState } from 'react';
import { useI18n } from './locale-provider';
import { readFacetValues } from '@/lib/catalog-client';
import type { CatalogFilters, FacetPage } from '@/lib/catalog-contract';
import { catalogFilterNeedsSearch } from '@/lib/catalog-filter-state';
import { CatalogFilterSection } from './catalog-filter-section';
import { Search } from 'lucide-react';
type Facet = CatalogFilters['attributes'][number];
export function CatalogFacet({
  categoryId,
  facet,
  selected,
  disabled,
  canAdd,
  onToggle,
  onLabels,
}: {
  categoryId: string;
  facet: Facet;
  selected: string[];
  disabled: boolean;
  canAdd: boolean;
  onToggle: (key: string, value: string) => void;
  onLabels: (key: string, labels: Record<string, string>) => void;
}) {
  const { locale, t, digits } = useI18n();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [result, setResult] = useState<{ query: string; page: FacetPage }>(() => ({
    query: '',
    page: {
      version: 1,
      locale,
      key: facet.key,
      values: facet.values,
      selectedValues: facet.values.filter((v) => selected.includes(v.value)),
      total: facet.total,
      page: 1,
      pageSize: 20,
      totalPages: Math.ceil(facet.total / 20),
    },
  }));
  const selectedKey = JSON.stringify(selected);
  useEffect(() => {
    if (input.trim() === query) return;
    const timer = setTimeout(() => {
      setQuery(input.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [input, query]);
  useEffect(() => {
    const controller = new AbortController();
    const chosen: string[] = JSON.parse(selectedKey);
    setError(false);
    if (
      !query &&
      page === 1 &&
      chosen.every((value) => facet.values.some((v) => v.value === value)) &&
      attempt === 0
    ) {
      setBusy(false);
      setResult({
        query: '',
        page: {
          version: 1,
          locale,
          key: facet.key,
          values: facet.values,
          selectedValues: facet.values.filter((v) => chosen.includes(v.value)),
          total: facet.total,
          page: 1,
          pageSize: 20,
          totalPages: Math.ceil(facet.total / 20),
        },
      });
      return () => controller.abort();
    }
    setBusy(true);
    readFacetValues(
      locale,
      {
        categoryId,
        key: facet.key,
        query: query || undefined,
        page,
        pageSize: 20,
        selectedValues: chosen,
      },
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted) {
          setResult({ query, page: data });
          if (page > Math.max(1, data.totalPages)) setPage(Math.max(1, data.totalPages));
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [categoryId, facet, locale, query, page, selectedKey, attempt]);
  useEffect(() => {
    const chosen: string[] = JSON.parse(selectedKey);
    onLabels(
      facet.key,
      Object.fromEntries(
        [...facet.values, ...result.page.values, ...result.page.selectedValues]
          .filter((v) => chosen.includes(v.value))
          .map((v) => [v.value, v.label]),
      ),
    );
  }, [facet.key, facet.values, result, selectedKey, onLabels]);
  const waiting = busy || input.trim() !== query;
  const stale = result.query !== query || result.page.page !== page;
  const values = stale ? [] : result.page.values;
  const labels = new Map(
    [...facet.values, ...result.page.values, ...result.page.selectedValues].map((v) => [
      v.value,
      v.label,
    ]),
  );
  const pinned = selected.filter((value) => !values.some((v) => v.value === value));
  function checkbox(value: string, label: string, pinned = false) {
    return (
      <label className={`check-label${pinned ? ' facet-pinned' : ''}`} key={value}>
        <input
          type="checkbox"
          disabled={disabled || (!selected.includes(value) && (selected.length >= 20 || !canAdd))}
          checked={selected.includes(value)}
          onChange={() => onToggle(facet.key, value)}
        />
        <span>{label}</span>
      </label>
    );
  }
  return (
    <CatalogFilterSection
      title={facet.label}
      defaultOpen={selected.length > 0}
      summary={
        selected.length
          ? `${digits(selected.length)} ${locale === 'fa' ? 'انتخاب' : 'selected'}`
          : facet.unit
      }
    >
      {catalogFilterNeedsSearch(facet.values.length, facet) && (
        <label className="filter-search">
          <Search size={15} aria-hidden="true" />
          <input
            className="facet-search"
            type="search"
            maxLength={100}
            aria-label={t('جست‌وجو در {0}', [facet.label])}
            placeholder={t(facet.dataType === 'number' ? 'ابتدای مقدار عددی' : 'جست‌وجوی مقدار…')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </label>
      )}
      <div className="facet-values" aria-busy={waiting}>
        {pinned.map((value) => checkbox(value, labels.get(value) ?? value, true))}
        {error ? (
          <div role="alert" className="facet-error">
            <p>{t('دریافت گزینه‌های فیلتر انجام نشد.')}</p>
            <button onClick={() => setAttempt((n) => n + 1)}>{t('تلاش دوباره')}</button>
          </div>
        ) : (
          <>
            {values.map((v) => checkbox(v.value, v.label))}
            {waiting && (
              <p role="status" className="small-note">
                {t('در حال دریافت گزینه‌ها…')}
              </p>
            )}
            {!waiting && !values.length && (
              <p className="small-note">{t('گزینه‌ای برای این جست‌وجو پیدا نشد.')}</p>
            )}
          </>
        )}
      </div>
      {!error && result.page.totalPages > 1 && (
        <div className="facet-pagination">
          <button disabled={disabled || waiting || page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t('قبلی')}
          </button>
          <span>{t('صفحهٔ {0} از {1}', [digits(page), digits(result.page.totalPages)])}</span>
          <button
            disabled={disabled || waiting || page >= result.page.totalPages || page >= 10000}
            onClick={() => setPage((p) => p + 1)}
          >
            {t('بعدی')}
          </button>
        </div>
      )}
    </CatalogFilterSection>
  );
}
