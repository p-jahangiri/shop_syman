import { AdminFilterForm } from '../../components/filters/admin-filters';
import { AdminTable } from '../../components/tables/admin-table';
import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/api';
import { CreditCard, FileCheck2, RefreshCw, SearchX } from 'lucide-react';
import { displayPercent } from '../../utils/finance-inputs';
import { Busy, ErrorBox, Field, Modal } from '../../components/ui';
import { nameOf, type Catalog } from '../../types/types';
import { MethodForm, PlanForm } from '../../features/finance/finance-forms';
import {
  emptyPurchaseFilters,
  purchaseFiltersSchema,
  purchaseSummarySchema,
  purchasePagePath,
  readMethodsPage,
  readPlansPage,
  readMethodDetail,
  readPlanDetail,
  type PurchaseFilters,
  type PurchaseScope,
  type MethodRow,
  type PlanRow,
} from '../../api/contracts/finance/finance-contract';
import '../../styles/finance/finance-workspace.css';
const names = { online: 'نقدی آنلاین', cheque: 'چکی', installment: 'اقساط ارائه‌دهنده' };
export function FinancePage({ catalog, writable }: { catalog?: Catalog; writable: boolean }) {
  const [scope, setScope] = useState<PurchaseScope>('method');
  const summary = useQuery({
    queryKey: ['admin', 'purchase-summary'],
    queryFn: async ({ signal }) =>
      purchaseSummarySchema.parse(await api('/admin/purchase-summary', { signal })),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const counts = summary.data;
  return (
    <>
      <section className="panel finance-workspace">
        <div className="finance-section-head">
          <div>
            <h2>قواعد خرید فروشگاه</h2>
            <p>روشِ پرداخت مشتری را جدا از مدت، نرخ و پیش‌پرداخت طرح چکی مدیریت کنید.</p>
          </div>
        </div>
        <div className="finance-tabs" role="group" aria-label="بخش شرایط خرید">
          <button
            type="button"
            aria-pressed={scope === 'method'}
            onClick={() => setScope('method')}
          >
            <CreditCard size={17} aria-hidden="true" /> روش‌های خرید
          </button>
          <button type="button" aria-pressed={scope === 'plan'} onClick={() => setScope('plan')}>
            <FileCheck2 size={17} aria-hidden="true" /> طرح‌های چکی
          </button>
        </div>
        {counts && (
          <div className="finance-readings" aria-label="خلاصهٔ سراسری تنظیمات">
            <span>
              روش‌های خرید:{' '}
              <strong>{BigInt(counts.enabledMethods).toLocaleString('fa-IR')} فعال</strong> از{' '}
              {BigInt(counts.methods).toLocaleString('fa-IR')}
            </span>
            <span>
              طرح‌های چکی:{' '}
              <strong>{BigInt(counts.enabledPlans).toLocaleString('fa-IR')} فعال</strong> از{' '}
              {BigInt(counts.plans).toLocaleString('fa-IR')}
            </span>
          </div>
        )}
        {summary.error && (
          <p className="small">شمارندهٔ کل در دسترس نیست؛ فهرست را می‌توانید جداگانه بررسی کنید.</p>
        )}
        <details className="notice">
          <summary>راهنمای فعال‌کردن یا توقف یک نوع خرید</summary>
          <ol>
            <li>
              در روش‌های خرید، نوع موردنظر را فیلتر و هر روش را با «وضعیت و شرایط» باز کنید. کلید
              اجازهٔ خرید جدید را تغییر دهید و ذخیره کنید.
            </li>
            <li>
              برای توقف کامل معرفی و تبلیغ یک نوع، همهٔ روش‌های همان نوع باید غیرفعال باشند؛ وجود
              حتی یک روش فعال هم‌نوع، معرفی آن نوع خرید را نگه می‌دارد.
            </li>
            <li>
              فعال‌بودن روش، مجوز خرید همهٔ کالاها نیست؛ شرایط کالا و تنوع، دسته، مبلغ و سرویس مربوط
              نیز بررسی می‌شوند.
            </li>
            <li>
              غیرفعال‌کردن طرح چکی فقط همان طرح را از انتخاب‌های جدید خارج می‌کند. سفارش‌ها، برنامهٔ
              اقساط و سوابق قبلی حذف یا بازنویسی نمی‌شوند.
            </li>
          </ol>
          <p>
            برای اطمینان از توقف کامل یک نوع، فیلتر «فعال» و همان نوع را اعمال کنید و صفحه‌های بعدی
            را هم بررسی کنید؛ تعداد این صفحه، تعداد کل روش‌های فروشگاه نیست.
          </p>
        </details>
      </section>
      <PurchaseList key={scope} scope={scope} catalog={catalog} writable={writable} />
      <p className="notice">
        درگاه نقدی و سرویس اقساط ارائه‌دهنده جداگانه متصل می‌شوند. بررسی پرونده و تأیید دستی چک از
        صف‌های امور مالی انجام می‌شود.
      </p>
    </>
  );
}
function PurchaseList({
  scope,
  catalog,
  writable,
}: {
  scope: PurchaseScope;
  catalog?: Catalog;
  writable: boolean;
}) {
  const method = scope === 'method';
  const label = method ? 'روش خرید' : 'طرح چکی';
  const [draft, setDraft] = useState<PurchaseFilters>(emptyPurchaseFilters),
    [filter, setFilter] = useState<PurchaseFilters>(emptyPurchaseFilters),
    [cursors, setCursors] = useState<(string | null)[]>([null]),
    [generation, setGeneration] = useState(0),
    [error, setError] = useState<unknown>(),
    [editing, setEditing] = useState<string | null | undefined>(undefined),
    [pending, setPending] = useState(false);
  const cursor = cursors[cursors.length - 1];
  const activeCategory = catalog?.categories.find((c) => c.id === filter.categoryId);
  const hasFilter = (value: PurchaseFilters) =>
    !!(value.query || value.enabled !== 'all' || value.kind !== 'all' || value.categoryId);
  const canReset = hasFilter(draft) || hasFilter(filter);
  const query = useQuery({
    queryKey: ['admin', 'purchase-page', scope, filter, cursor, generation],
    queryFn: async ({ signal }) => {
      const raw = await api<unknown>(purchasePagePath(scope, filter, cursor), { signal });
      return method ? readMethodsPage(raw, filter) : readPlansPage(raw, filter);
    },
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  function apply(e: FormEvent) {
    e.preventDefault();
    const result = purchaseFiltersSchema.safeParse(draft);
    if (!result.success) {
      setError(new Error('حداکثر ۱۲۰ نویسه و ۸ واژه با فیلتر معتبر وارد کنید.'));
      return;
    }
    setError(undefined);
    const next = result.data;
    if (
      next.query === filter.query &&
      next.enabled === filter.enabled &&
      next.kind === filter.kind &&
      next.categoryId === filter.categoryId
    )
      return;
    setFilter(next);
    setCursors([null]);
  }
  function clearFilters() {
    setDraft(emptyPurchaseFilters);
    setFilter(emptyPurchaseFilters);
    setCursors([null]);
    setError(undefined);
  }
  function refresh() {
    setCursors([null]);
    setGeneration((v) => v + 1);
  }
  const close = () => {
    setEditing(undefined);
    refresh();
  };
  return (
    <section className="panel finance-workspace finance-purchase-list">
      <div className="finance-section-head">
        <div>
          <h2>{method ? 'روش‌های خرید' : 'طرح‌های چکی'}</h2>
          <p>
            {method
              ? 'وضعیت و محدودیت هر روش را برای خریدهای تازه مدیریت کنید.'
              : 'مدت، نرخ و پیش‌پرداخت طرح‌های خرید چکی را تنظیم کنید.'}
          </p>
        </div>
        <div className="row-buttons">
          <button disabled={query.isFetching} onClick={refresh}>
            <RefreshCw size={16} aria-hidden="true" /> تازه‌سازی فهرست
          </button>
          {writable && (
            <button type="button" className="primary" onClick={() => setEditing(null)}>
              {label} جدید
            </button>
          )}
        </div>
      </div>
      <AdminFilterForm
        label="فیلتر شرایط خرید"
        onSubmit={apply}
        search={
          <input
            type="search"
            aria-label="جست‌وجوی عنوان یا شناسه"
            placeholder={method ? 'جست‌وجوی عنوان یا شناسهٔ روش…' : 'جست‌وجوی عنوان یا شناسهٔ طرح…'}
            maxLength={120}
            value={draft.query}
            onChange={(e) => setDraft({ ...draft, query: e.target.value })}
          />
        }
        applied={[
          ...(filter.query ? ['جست‌وجو: ' + filter.query] : []),
          ...(filter.enabled !== 'all'
            ? [filter.enabled === 'true' ? 'فعال در تنظیمات' : 'غیرفعال']
            : []),
          ...(filter.kind !== 'all' ? [names[filter.kind]] : []),
          ...(filter.categoryId
            ? ['دسته: ' + (activeCategory ? nameOf(activeCategory) : filter.categoryId)]
            : []),
        ]}
        actions={
          <>
            <button type="submit" className="primary">
              اعمال جست‌وجو
            </button>
            <button type="button" disabled={!canReset} onClick={clearFilters}>
              بازنشانی
            </button>
          </>
        }
      >
        <Field label="وضعیت">
          <select
            value={draft.enabled}
            onChange={(e) =>
              setDraft({ ...draft, enabled: e.target.value as PurchaseFilters['enabled'] })
            }
          >
            <option value="all">همه</option>
            <option value="true">فعال</option>
            <option value="false">غیرفعال</option>
          </select>
        </Field>
        {method && (
          <Field label="نوع روش">
            <select
              value={draft.kind}
              onChange={(e) =>
                setDraft({ ...draft, kind: e.target.value as PurchaseFilters['kind'] })
              }
            >
              <option value="all">همهٔ روش‌ها</option>
              {Object.entries(names).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="دسته" hint="شرایط بدون محدودیت دسته هم نمایش داده می‌شوند.">
          <select
            value={draft.categoryId ?? ''}
            disabled={!catalog}
            onChange={(e) => setDraft({ ...draft, categoryId: e.target.value || null })}
          >
            <option value="">همهٔ دسته‌ها</option>
            {catalog?.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {nameOf(c)}
              </option>
            ))}
          </select>
        </Field>
      </AdminFilterForm>
      <ErrorBox error={error ?? query.error} />
      {query.isPending ? (
        <Busy />
      ) : query.error ? (
        <div className="row-buttons">
          <button onClick={() => void query.refetch()}>دریافت دوبارهٔ فهرست</button>
          {cursors.length > 1 && (
            <button onClick={() => setCursors((c) => c.slice(0, -1))}>بازگشت به صفحهٔ قبل</button>
          )}
        </div>
      ) : query.data && !query.data.items.length ? (
        <div className="finance-list-empty" role="status">
          <SearchX size={22} aria-hidden="true" />
          <div>
            <strong>
              {hasFilter(filter)
                ? 'نتیجه‌ای مطابق فیلترها نیست'
                : method
                  ? 'هیچ روش خریدی در این صفحه نیست'
                  : 'هیچ طرح چکی در این صفحه نیست'}
            </strong>
            <p>
              {hasFilter(filter)
                ? 'عنوان یا فیلترها را تغییر دهید و دوباره بررسی کنید.'
                : 'با ثبت مورد تازه، در این فهرست نمایش داده می‌شود.'}
            </p>
          </div>
          {canReset && (
            <button type="button" onClick={clearFilters}>
              بازنشانی جست‌وجو و فیلترها
            </button>
          )}
          {cursors.length > 1 && (
            <button type="button" onClick={() => setCursors((c) => c.slice(0, -1))}>
              صفحهٔ قبل
            </button>
          )}
        </div>
      ) : (
        query.data && (
          <>
            <p className="finance-mobile-count" role="status">
              {query.data.items.length.toLocaleString('fa-IR')} مورد در این صفحه
            </p>
            <div className="finance-table">
              <AdminTable searchable={false} aria-label={method ? 'روش‌های خرید' : 'طرح‌های چکی'}>
                <thead>
                  <tr>
                    <th>عنوان</th>
                    <th>{method ? 'روش' : 'مدت و فاصله'}</th>
                    {!method && <th>نرخ‌ها</th>}
                    <th>وضعیت تنظیمات</th>
                    <th>محدودیت دسته</th>
                    <th>جزئیات</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.nameFa || row.nameEn || row.id}</strong>
                        <small>{row.nameEn}</small>
                        <code>{row.id}</code>
                      </td>
                      <td>
                        {method
                          ? names[(row as MethodRow).kind]
                          : `${(row as PlanRow).months.toLocaleString('fa-IR')} ماه / ${(row as PlanRow).intervalMonths.toLocaleString('fa-IR')} ماه`}
                      </td>
                      {!method && (
                        <td>
                          {displayPercent((row as PlanRow).markupBasisPoints)} افزایش /{' '}
                          {displayPercent((row as PlanRow).downPaymentBasisPoints)} پیش‌پرداخت
                        </td>
                      )}
                      <td>
                        <span
                          className="finance-status"
                          data-tone={row.enabled ? 'good' : undefined}
                        >
                          {row.enabled ? 'فعال در تنظیمات' : 'غیرفعال برای خرید جدید'}
                        </span>
                        <small>{row.enabled ? 'با رعایت شروط خرید' : 'سوابق قبلی محفوظ است'}</small>
                      </td>
                      <td>
                        {row.categoryCount
                          ? `${row.categoryCount.toLocaleString('fa-IR')} دسته`
                          : 'همهٔ دسته‌ها'}
                      </td>
                      <td>
                        <button
                          className="row-action"
                          aria-label={`${writable ? 'تغییر وضعیت و شرایط' : 'مشاهدهٔ وضعیت و شرایط'} ${row.nameFa || row.nameEn || row.id}`}
                          onClick={() => setEditing(row.id)}
                        >
                          {writable ? 'وضعیت و شرایط' : 'مشاهدهٔ وضعیت و شرایط'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </AdminTable>
            </div>
            <ul
              className="finance-mobile-list"
              aria-label={method ? 'روش‌های خرید' : 'طرح‌های چکی'}
            >
              {query.data.items.map((row) => (
                <li key={row.id} className="finance-card">
                  <h3 dir="auto">{row.nameFa || row.nameEn || row.id}</h3>
                  <span className="finance-status" data-tone={row.enabled ? 'good' : undefined}>
                    {row.enabled ? 'فعال در تنظیمات' : 'غیرفعال برای خرید جدید'}
                  </span>
                  <dl className="finance-facts">
                    <dt>{method ? 'نوع روش' : 'مدت و فاصله'}</dt>
                    <dd>
                      {method
                        ? names[(row as MethodRow).kind]
                        : `${(row as PlanRow).months.toLocaleString('fa-IR')} ماه · هر ${(row as PlanRow).intervalMonths.toLocaleString('fa-IR')} ماه`}
                    </dd>
                    {!method && (
                      <>
                        <dt>افزایش و پیش‌پرداخت</dt>
                        <dd>
                          {displayPercent((row as PlanRow).markupBasisPoints)} ·{' '}
                          {displayPercent((row as PlanRow).downPaymentBasisPoints)}
                        </dd>
                      </>
                    )}
                    <dt>دسته</dt>
                    <dd>
                      {row.categoryCount
                        ? row.categoryCount.toLocaleString('fa-IR') + ' دسته'
                        : 'همهٔ دسته‌ها'}
                    </dd>
                  </dl>
                  <div className="row-buttons">
                    <button type="button" onClick={() => setEditing(row.id)}>
                      وضعیت و شرایط
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {(cursors.length > 1 || query.data.nextCursor) && (
              <div className="pagination finance-pager">
                <button
                  disabled={cursors.length === 1 || query.isFetching}
                  onClick={() => setCursors((c) => c.slice(0, -1))}
                >
                  صفحهٔ قبل
                </button>
                <span>صفحهٔ {cursors.length.toLocaleString('fa-IR')}</span>
                <button
                  disabled={!query.data.nextCursor || query.isFetching}
                  onClick={() => {
                    if (query.data?.nextCursor) setCursors((c) => [...c, query.data!.nextCursor]);
                  }}
                >
                  صفحهٔ بعد
                </button>
              </div>
            )}
          </>
        )
      )}
      {editing !== undefined && (
        <Modal
          title={`${editing ? (writable ? 'ویرایش' : 'مشاهده') : 'افزودن'} ${label}`}
          onClose={close}
          preventClose={pending}
        >
          {editing ? (
            <PurchaseEditor
              scope={scope}
              id={editing}
              catalog={catalog}
              writable={writable}
              onClose={close}
              pending={pending}
              onBusy={setPending}
            />
          ) : method ? (
            <MethodForm catalog={catalog} onClose={close} onBusy={setPending} />
          ) : (
            <PlanForm catalog={catalog} onClose={close} onBusy={setPending} />
          )}
        </Modal>
      )}
    </section>
  );
}
function PurchaseEditor({
  scope,
  id,
  catalog,
  writable,
  onClose,
  onBusy,
  pending,
}: {
  scope: PurchaseScope;
  id: string;
  catalog?: Catalog;
  writable: boolean;
  onClose: () => void;
  onBusy: (value: boolean) => void;
  pending: boolean;
}) {
  const [revision, setRevision] = useState(0);
  const method = scope === 'method';
  const query = useQuery({
    queryKey: ['admin', 'purchase-detail', scope, id],
    queryFn: async ({ signal }) => {
      const raw = await api<unknown>(
        `/admin/${method ? 'purchase-methods' : 'cheque-plans'}/${encodeURIComponent(id)}`,
        { signal },
      );
      return method ? { method: readMethodDetail(raw, id) } : { plan: readPlanDetail(raw, id) };
    },
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  return (
    <>
      <p className="muted">دریافت جزئیات تازه، فرم فعلی را از ابتدا باز می‌کند.</p>
      <button
        disabled={query.isFetching || pending}
        onClick={() => {
          setRevision((v) => v + 1);
          void query.refetch();
        }}
      >
        دریافت جزئیات تازه
      </button>
      {query.isFetching ? (
        <Busy />
      ) : query.error ? (
        <ErrorBox error={query.error} />
      ) : query.data?.method ? (
        <MethodForm
          key={revision + ':' + query.data.method.version}
          item={query.data.method}
          catalog={catalog}
          readOnly={!writable}
          onClose={onClose}
          onBusy={onBusy}
        />
      ) : query.data?.plan ? (
        <PlanForm
          key={revision + ':' + query.data.plan.version}
          item={query.data.plan}
          catalog={catalog}
          readOnly={!writable}
          onClose={onClose}
          onBusy={onBusy}
        />
      ) : null}
    </>
  );
}
