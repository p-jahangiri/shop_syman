'use client';
import { useEffect, useId, useState } from 'react';
import Link from './localized-link';
import { useI18n } from './locale-provider';
import { marketCopy } from '@/lib/market-copy';
import {
  marketHref,
  marketInputSchema,
  marketQueryParams,
  type MarketFilters,
  type MarketQuery,
  type MarketValues,
} from '@/lib/market-contract';
import { readMarketValues } from '@/lib/market-http';
type Definition = MarketFilters['filters'][number];
function MarketAttributeValues({
  definition,
  query,
  selected,
  onToggle,
  canAdd,
  onLabels,
  initial,
}: {
  definition: Definition;
  initial?: MarketValues;
  query: MarketQuery;
  selected: string[];
  onToggle: (key: string, value: string) => void;
  canAdd: boolean;
  onLabels: (labels: Record<string, string>) => void;
}) {
  const { locale, digits } = useI18n(),
    copy = marketCopy(locale),
    id = useId();
  const [open, setOpen] = useState(false),
    [input, setInput] = useState(''),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [attempt, setAttempt] = useState(0),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false),
    [result, setResult] = useState<{ signature: string; data: MarketValues }>();
  const signature = JSON.stringify({ locale, query, key: definition.key, selected, search, page }),
    selectedKey = JSON.stringify(selected);
  useEffect(() => {
    if (!open && (!selected.length || initial)) return;
    const controller = new AbortController();
    setBusy(true);
    setFailed(false);
    readMarketValues(
      locale,
      {
        search: query,
        key: definition.key,
        query: search || undefined,
        page,
        pageSize: 20,
        selectedValues: JSON.parse(selectedKey),
      },
      { SHOP_API_URL: window.location.origin, SHOP_DATA_MODE: 'api' },
      fetch,
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted) setResult({ signature, data });
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [
    open,
    signature,
    attempt,
    locale,
    query,
    definition.key,
    search,
    page,
    selectedKey,
    selected.length,
    initial,
  ]);
  const current =
    result?.signature === signature
      ? result.data
      : !search &&
          page === 1 &&
          initial &&
          JSON.stringify(initial.selectedValues.map((value) => value.value)) === selectedKey
        ? initial
        : undefined;
  useEffect(() => {
    if (current)
      onLabels(
        Object.fromEntries(
          [...current.values, ...current.selectedValues].map((item) => [
            definition.key + '\0' + item.value,
            item.label,
          ]),
        ),
      );
  }, [current, definition.key, onLabels]);
  const labels = new Map((current?.selectedValues ?? []).map((item) => [item.value, item]));
  const pinned = selected.filter((value) => !current?.values.some((item) => item.value === value));
  function value(value: string, label: string, count?: number) {
    return (
      <label className="market-attribute-value" key={value}>
        <input
          type="checkbox"
          checked={selected.includes(value)}
          disabled={!selected.includes(value) && (!canAdd || selected.length >= 20)}
          onChange={() => onToggle(definition.key, value)}
        />
        <span>{label}</span>
        {count !== undefined && (
          <small>
            <bdi>{digits(count)}</bdi>
          </small>
        )}
      </label>
    );
  }
  function applySearch() {
    setSearch(input.trim());
    setPage(1);
    setAttempt((n) => n + 1);
  }
  return (
    <details
      className="market-attribute-panel"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {definition.label}
        {selected.length > 0 && <span>{digits(selected.length)}</span>}
        {definition.unit && <small>{definition.unit}</small>}
      </summary>
      {open && (
        <div className="market-attribute-body">
          {definition.dataType !== 'bool' && (
            <div className="market-value-search">
              <label className="sr-only" htmlFor={id}>
                {copy.valueSearch} {definition.label}
              </label>
              <input
                id={id}
                type="search"
                maxLength={100}
                value={input}
                placeholder={
                  definition.dataType === 'number' ? copy.numberPrefix : copy.valueSearch
                }
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    applySearch();
                  }
                }}
              />
              <button type="button" onClick={applySearch}>
                {copy.searchAction}
              </button>
            </div>
          )}
          <div className="market-attribute-values" aria-busy={busy}>
            {pinned.map((v) => value(v, labels.get(v)?.label ?? v, labels.get(v)?.count))}
            {busy ? (
              <p role="status">{copy.valuesLoading}</p>
            ) : failed ? (
              <div role="alert">
                <p>{copy.valuesFailed}</p>
                <button type="button" onClick={() => setAttempt((n) => n + 1)}>
                  {copy.retry}
                </button>
              </div>
            ) : current?.values.length ? (
              current.values.map((item) => value(item.value, item.label, item.count))
            ) : (
              <p>{copy.noValues}</p>
            )}
          </div>
          {current && current.totalPages > 1 && (
            <nav
              className="market-value-pagination"
              aria-label={`${copy.valuePages} ${definition.label}`}
            >
              <button
                type="button"
                disabled={busy || page <= 1}
                onClick={() => setPage((n) => n - 1)}
              >
                {copy.previous}
              </button>
              <span>
                {digits(page)} / {digits(current.totalPages)}
              </span>
              <button
                type="button"
                disabled={busy || page >= current.totalPages || page >= 10000}
                onClick={() => setPage((n) => n + 1)}
              >
                {copy.next}
              </button>
            </nav>
          )}
        </div>
      )}
    </details>
  );
}
export function MarketAttributeFilters({
  query,
  filters,
  initialValues = [],
}: {
  query: MarketQuery;
  filters?: MarketFilters;
  initialValues?: MarketValues[];
}) {
  const { locale, digits } = useI18n(),
    copy = marketCopy(locale);
  const [selected, setSelected] = useState<NonNullable<MarketQuery['attributes']>>(
      query.attributes ?? [],
    ),
    [labels, setLabels] = useState<Record<string, string>>(() =>
      Object.fromEntries(
        initialValues.flatMap((page) =>
          [...page.values, ...page.selectedValues].map((value) => [
            page.key + '\0' + value.value,
            value.label,
          ]),
        ),
      ),
    );
  const [rememberLabels] = useState(
    () => (incoming: Record<string, string>) =>
      setLabels((previous) => {
        const keys = Object.keys(incoming);
        return keys.every((key) => previous[key] === incoming[key])
          ? previous
          : { ...previous, ...incoming };
      }),
  );
  const draft = { ...query, page: 1, attributes: selected.length ? selected : undefined };
  let href: string | undefined;
  try {
    const valid = marketInputSchema.parse(draft);
    if (marketQueryParams(valid).toString().length <= 6500) href = marketHref(valid);
  } catch {
    /* Invalid filter drafts must not create a navigation URL. */
  }
  function toggle(key: string, value: string) {
    setSelected((previous) => {
      const values = previous.find((item) => item.key === key)?.values ?? [];
      const next = values.includes(value)
        ? values.filter((item) => item !== value)
        : [...values, value];
      const rest = previous.filter((item) => item.key !== key);
      return next.length ? [...rest, { key, values: next }] : rest;
    });
  }
  return (
    <section className="market-typed-filters" aria-labelledby="market-attributes-title">
      <div className="market-attributes-heading">
        <div>
          <h2 id="market-attributes-title">{copy.attributesTitle}</h2>
          <p>{query.categoryId ? copy.attributesHelp : copy.chooseCategory}</p>
        </div>
        {query.attributes?.length ? (
          <Link
            className="text-link"
            href={marketHref({ ...query, attributes: undefined, page: 1 })}
          >
            {copy.clearAttributes}
          </Link>
        ) : null}
      </div>
      {query.categoryId && filters && (
        <>
          <div className="market-attributes-grid">
            {filters.filters.map((definition) => (
              <MarketAttributeValues
                key={definition.key}
                definition={definition}
                query={query}
                initial={initialValues.find((page) => page.key === definition.key)}
                selected={selected.find((item) => item.key === definition.key)?.values ?? []}
                onToggle={toggle}
                canAdd={selected.some((item) => item.key === definition.key) || selected.length < 8}
                onLabels={rememberLabels}
              />
            ))}
          </div>
          {!filters.filters.length && <p className="muted">{copy.noAttributes}</p>}
          {filters.moreFilters && <p className="muted">{copy.attributesLimit}</p>}
          {selected.length > 0 && (
            <div className="market-attribute-chips">
              {selected.flatMap((item) =>
                item.values.map((value) => (
                  <button
                    type="button"
                    key={item.key + '\0' + value}
                    onClick={() => toggle(item.key, value)}
                    aria-label={`${copy.removeAttribute} ${filters.filters.find((d) => d.key === item.key)?.label ?? item.key}: ${labels[item.key + '\0' + value] ?? value}`}
                  >
                    <span>
                      {filters.filters.find((d) => d.key === item.key)?.label ?? item.key}:{' '}
                      {labels[item.key + '\0' + value] ?? value}
                    </span>
                    <span aria-hidden="true">×</span>
                  </button>
                )),
              )}
            </div>
          )}
          <div className="market-attribute-actions">
            {href ? (
              <Link className="button button-primary" href={href}>
                {copy.applyAttributes}
              </Link>
            ) : (
              <p role="alert">{copy.attributesTooLarge}</p>
            )}
            <small>
              {copy.attributeLimits.replace('{0}', digits(8)).replace('{1}', digits(20))}
            </small>
          </div>
        </>
      )}
    </section>
  );
}
