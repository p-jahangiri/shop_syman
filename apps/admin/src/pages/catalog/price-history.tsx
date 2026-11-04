import { PersianDateField } from '../../components/forms/persian-date-field';
import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  RefreshCw,
  History,
  ArrowUpRight,
  ArrowDownRight,
  ChartNoAxesCombined,
} from 'lucide-react';
import { api } from '../../api/api';
import { adminViewRevision } from '../../auth/admin-view-authority';
import { AdminTable } from '../../components/tables/admin-table';
import { AdminFilterForm } from '../../components/filters/admin-filters';
import { Busy, ErrorBox, Field } from '../../components/ui';
import {
  emptyPriceHistoryFilters,
  localPriceHistoryTime,
  priceHistoryFiltersSchema,
  priceHistoryMoney,
  priceHistoryPath,
  priceHistoryPlot,
  readPriceHistoryPage,
  type PriceHistoryFilters,
  type PriceHistoryPage,
} from '../../api/contracts/catalog/price-history-contract';
import '../../styles/catalog/price-history.css';

const date = (value: string) =>
  new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
const blankDraft = { variantId: '', direction: 'all', fromLocal: '', toLocal: '' };

export function PriceHistory({
  productId,
  productName,
}: {
  productId: string;
  productName: string;
}) {
  const instance = useId(),
    revision = adminViewRevision();
  const [draft, setDraft] = useState(blankDraft);
  const [filters, setFilters] = useState<PriceHistoryFilters>(emptyPriceHistoryFilters);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [generation, setGeneration] = useState(0);
  const [formError, setFormError] = useState<unknown>();
  const cursor = cursors.at(-1)!;
  const owner = JSON.stringify([productId, revision, generation, filters, cursor]);
  const active = useRef(owner);
  const snapshot = useRef<{ scope: string; asOfAt: string } | null>(null);
  const snapshotScope = JSON.stringify([productId, revision, generation, filters]);
  active.current = owner;
  useEffect(() => {
    active.current = owner;
    return () => {
      if (active.current === owner) active.current = '';
    };
  }, [owner]);
  const query = useQuery({
    queryKey: [
      'admin',
      'price-history',
      instance,
      productId,
      revision,
      generation,
      filters,
      cursor,
    ],
    queryFn: async ({ signal }) => {
      const raw = await api<unknown>(priceHistoryPath(productId, filters, cursor), { signal });
      if (signal.aborted || revision !== adminViewRevision() || active.current !== owner)
        throw new Error('این درخواست به نمای فعلی تعلق ندارد.');
      const page = readPriceHistoryPage(raw, productId, filters);
      if (
        cursor &&
        snapshot.current?.scope === snapshotScope &&
        snapshot.current.asOfAt !== page.asOfAt
      )
        throw new Error('زمان مبنای صفحهٔ تاریخچه تغییر کرده است؛ از ابتدا تازه‌سازی کنید.');
      snapshot.current = { scope: snapshotScope, asOfAt: page.asOfAt };
      return page;
    },
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  function resetPage() {
    setCursors([null]);
    setGeneration((old) => old + 1);
  }
  function apply(event: React.FormEvent) {
    event.preventDefault();
    try {
      const value = priceHistoryFiltersSchema.safeParse({
        variantId: draft.variantId || null,
        direction: draft.direction,
        fromAt: localPriceHistoryTime(draft.fromLocal),
        toAt: localPriceHistoryTime(draft.toLocal),
      });
      if (!value.success)
        throw new Error('بازهٔ زمان را بررسی کنید؛ پایان نباید قبل از شروع باشد.');
      setFilters(value.data);
      setFormError(undefined);
      resetPage();
    } catch (error) {
      setFormError(error);
    }
  }
  const metadata = useRef<{ scope: string; variants: PriceHistoryPage['variants'] }>({
    scope: '',
    variants: [],
  });
  const metadataScope = JSON.stringify([productId, revision]);
  if (metadata.current.scope !== metadataScope)
    metadata.current = { scope: metadataScope, variants: [] };
  if (query.data) metadata.current = { scope: metadataScope, variants: query.data.variants };
  const selected = query.data?.variants.find(
    (v) => v.id.toLowerCase() === filters.variantId?.toLowerCase(),
  );
  return (
    <section className="price-history" aria-label={'تاریخچهٔ قیمت ' + productName}>
      <header className="price-history-heading">
        <span className="price-history-emblem" aria-hidden="true">
          <History size={23} />
        </span>
        <div>
          <h3>{productName}</h3>
          <p>رویدادهای ثبت‌شدهٔ تغییر قیمت فروش تنوع‌ها؛ فقط برای مدیریت فروشگاه.</p>
        </div>
        <button
          type="button"
          onClick={resetPage}
          disabled={query.isFetching}
          className="price-history-refresh"
        >
          <RefreshCw size={16} aria-hidden="true" />
          تازه‌سازی از ابتدا
        </button>
      </header>
      <details className="price-history-guide">
        <summary>راهنمای تاریخچهٔ قیمت</summary>
        <p>
          یک تنوع را انتخاب کنید تا تغییرهای همان SKU را ببینید. تنوع‌های غیرفعال هم در دسترس‌اند.
          SKU و قیمت فعلی، مشخصات امروز هستند؛ مبلغ قدیم و جدید هر ردیف، رویداد واقعی گذشته است.
        </p>
        <p>
          این سابقه، قیمت مقایسه‌ای یا سابقهٔ عمومی مشتری نیست. نبود رویداد به معنی قیمت صفر نیست.
          جدول و نمودار فقط همین صفحه را پوشش می‌دهند؛ دکمهٔ بعدی، ادامهٔ سابقه را دریافت می‌کند.
        </p>
      </details>
      <AdminFilterForm
        label="فیلتر تاریخچهٔ قیمت"
        onSubmit={apply}
        live={false}
        inline
        primary={
          <div className="price-history-filter-grid">
            <Field label="تنوع / SKU">
              <select
                value={draft.variantId}
                onChange={(e) => setDraft({ ...draft, variantId: e.target.value })}
              >
                <option value="">همهٔ تنوع‌ها · نمودار غیرفعال</option>
                {metadata.current.variants.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.sku}
                    {variant.isActive ? '' : ' · غیرفعال'}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="نوع تغییر">
              <select
                value={draft.direction}
                onChange={(e) => setDraft({ ...draft, direction: e.target.value })}
              >
                <option value="all">همهٔ تغییرها</option>
                <option value="increase">افزایش قیمت</option>
                <option value="decrease">کاهش قیمت</option>
              </select>
            </Field>
            <div className="field">
              <PersianDateField
                label="از زمان (شامل)"
                encoding="local"
                precision="minute"
                value={draft.fromLocal}
                onChange={(next) => setDraft({ ...draft, fromLocal: next })}
              />
            </div>
            <div className="field">
              <PersianDateField
                label="تا زمان (پیش از)"
                encoding="local"
                precision="minute"
                value={draft.toLocal}
                onChange={(next) => setDraft({ ...draft, toLocal: next })}
              />
            </div>
          </div>
        }
        actions={
          <>
            <button type="submit" className="primary">
              اعمال فیلتر
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(blankDraft);
                setFilters(emptyPriceHistoryFilters);
                setFormError(undefined);
                resetPage();
              }}
            >
              پاک‌کردن فیلتر
            </button>
          </>
        }
      />
      <p className="price-history-time-note">
        زمان ورودی شمسی و بر اساس منطقهٔ دستگاه ({Intl.DateTimeFormat().resolvedOptions().timeZone})
        است؛ رویدادها در تقویم شمسی نمایش داده می‌شوند.
      </p>
      <ErrorBox error={formError ?? query.error} />
      {query.isPending ? (
        <Busy />
      ) : query.error ? (
        <div className="row-buttons">
          <button type="button" onClick={() => void query.refetch()} disabled={query.isFetching}>
            تلاش دوباره برای تاریخچه
          </button>
          {cursors.length > 1 && (
            <button type="button" onClick={() => setCursors((old) => old.slice(0, -1))}>
              بازگشت به صفحهٔ قبل
            </button>
          )}
        </div>
      ) : (
        query.data && (
          <>
            <div className="price-history-scope" role="status">
              <span>
                {query.data.items.length.toLocaleString('fa-IR')} رویداد در این صفحه · صفحهٔ{' '}
                {cursors.length.toLocaleString('fa-IR')}
              </span>
              <span>
                سابقه تا <time dateTime={query.data.asOfAt}>{date(query.data.asOfAt)}</time> ·
                تازه‌سازی، نمای تازه می‌گیرد
              </span>
            </div>
            {selected && (
              <div className="price-history-current">
                <span>
                  SKU فعلی: <bdi>{selected.sku}</bdi>
                  {!selected.isActive && <span className="badge">غیرفعال</span>}
                </span>
                <span>
                  قیمت فعلی: <strong>{priceHistoryMoney(selected.currentPriceRial)}</strong>
                </span>
              </div>
            )}
            {filters.variantId ? (
              <PriceHistoryChart page={query.data} variantId={filters.variantId} />
            ) : (
              <div className="price-history-chart-hint">
                <ChartNoAxesCombined size={20} aria-hidden="true" />
                <p>
                  برای نمودار، یک تنوع را انتخاب و فیلتر را اعمال کنید. قیمت SKUهای متفاوت با هم
                  ترکیب نمی‌شود.
                </p>
              </div>
            )}
            <div
              className="table-wrap price-history-table"
              role="region"
              aria-label="رویدادهای قیمت این صفحه، قابل پیمایش افقی"
              tabIndex={0}
            >
              <AdminTable searchable={false} aria-label="رویدادهای تغییر قیمت">
                <thead>
                  <tr>
                    <th>رویداد / SKU فعلی</th>
                    <th>قیمت قبلی (ریال)</th>
                    <th>قیمت جدید (ریال)</th>
                    <th>تغییر (ریال)</th>
                    <th>عامل ثبت (شناسه)</th>
                    <th>زمان رویداد</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((row) => {
                    const delta = BigInt(row.newPriceRial) - BigInt(row.oldPriceRial);
                    const variant = query.data.variants.find(
                      (v) => v.id.toLowerCase() === row.variantId.toLowerCase(),
                    );
                    return (
                      <tr key={row.id}>
                        <td>
                          <bdi>{variant?.sku ?? row.variantId}</bdi>
                          <small>
                            رویداد: <bdi>{row.id}</bdi>
                          </small>
                        </td>
                        <td data-sort-value={row.oldPriceRial}>
                          {priceHistoryMoney(row.oldPriceRial)}
                        </td>
                        <td data-sort-value={row.newPriceRial}>
                          {priceHistoryMoney(row.newPriceRial)}
                        </td>
                        <td data-sort-value={delta.toString()}>
                          <span
                            className={
                              'price-history-change ' + (delta > 0n ? 'is-increase' : 'is-decrease')
                            }
                          >
                            {delta > 0n ? (
                              <ArrowUpRight size={15} aria-hidden="true" />
                            ) : (
                              <ArrowDownRight size={15} aria-hidden="true" />
                            )}
                            {delta > 0n ? 'افزایش ' : 'کاهش '}
                            {(delta > 0n ? delta : -delta).toLocaleString('fa-IR')} ریال
                          </span>
                        </td>
                        <td>
                          <bdi>{row.changedBy || 'ثبت‌کننده مشخص نشده'}</bdi>
                        </td>
                        <td data-sort-value={row.changedAt}>
                          <time dateTime={row.changedAt}>{date(row.changedAt)}</time>
                        </td>
                      </tr>
                    );
                  })}
                  {!query.data.items.length && (
                    <tr>
                      <td colSpan={6} className="empty">
                        تغییر قیمتی با این فیلتر ثبت نشده است.
                      </td>
                    </tr>
                  )}
                </tbody>
              </AdminTable>
            </div>
            <div className="pagination price-history-pagination">
              <button
                type="button"
                disabled={cursors.length === 1 || query.isFetching}
                onClick={() => setCursors((old) => old.slice(0, -1))}
              >
                صفحهٔ قبل
              </button>
              <span>
                صفحهٔ {cursors.length.toLocaleString('fa-IR')} · ترتیب دریافت از جدید به قدیم
              </span>
              <button
                type="button"
                disabled={!query.data.nextCursor || query.isFetching}
                onClick={() => {
                  if (query.data?.nextCursor) setCursors((old) => [...old, query.data!.nextCursor]);
                }}
              >
                ۵۰ رویداد بعدی
              </button>
            </div>
          </>
        )
      )}
    </section>
  );
}

export function PriceHistoryChart({
  page,
  variantId,
}: {
  page: PriceHistoryPage;
  variantId: string;
}) {
  const rows = priceHistoryPlot(page.items, variantId);
  if (!rows.length) return null;
  return (
    <figure className="price-history-chart" aria-label="نمودار رویدادهای این صفحه">
      <figcaption>
        <strong>رویدادهای این صفحه</strong>
        <span>دایرهٔ توخالی: قیمت قبلی · دایرهٔ پُر: قیمت جدید · اعداد دقیق در جدول</span>
      </figcaption>
      <p>
        هر سطر یک رویداد مستقل است؛ اتصال زمانی یا قیمت روزهای بدون تغییر نمایش داده نمی‌شود.
        رخدادهای هم‌زمان ترتیب زمانی متمایزی ندارند.
      </p>
      <ol>
        {rows.map((row) => (
          <li key={row.id}>
            <time dateTime={row.changedAt}>{date(row.changedAt)}</time>
            <svg
              viewBox="0 0 1000 28"
              preserveAspectRatio="none"
              aria-hidden="true"
              className={row.increasing ? 'is-increase' : 'is-decrease'}
            >
              <line className="price-history-axis" x1="50" x2="950" y1="14" y2="14" />
              <line
                className="price-history-interval"
                x1={row.oldX}
                x2={row.newX}
                y1="14"
                y2="14"
              />
              <circle className="price-history-old-dot" cx={row.oldX} cy="14" r="5" />
              <circle className="price-history-new-dot" cx={row.newX} cy="14" r="5" />
            </svg>
            <span className="sr-only">
              رویداد {row.id}: از {priceHistoryMoney(row.oldPriceRial)} به{' '}
              {priceHistoryMoney(row.newPriceRial)}
            </span>
          </li>
        ))}
      </ol>
    </figure>
  );
}
