import { AdminFilterForm } from './admin-filters';
import { AdminTable } from './admin-table';
import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { Busy, ErrorBox, Field, Modal } from './ui';
import { nameOf, type Catalog } from './types';
import { MethodForm, PlanForm } from './finance-forms';
import {
  emptyPurchaseFilters,
  purchaseFiltersSchema,
  purchasePagePath,
  readMethodsPage,
  readPlansPage,
  readMethodDetail,
  readPlanDetail,
  type PurchaseFilters,
  type PurchaseScope,
  type MethodRow,
  type PlanRow,
} from './finance-contract';
const names = { online: 'نقدی آنلاین', cheque: 'چکی', installment: 'اقساط ارائه‌دهنده' };
export function FinancePage({ catalog, writable }: { catalog?: Catalog; writable: boolean }) {
  const [scope, setScope] = useState<PurchaseScope>('method');
  return (
    <>
      <section className="panel">
        <h2>شرایط خرید</h2>
        <div className="row-buttons" role="group" aria-label="بخش شرایط خرید">
          <button aria-pressed={scope === 'method'} onClick={() => setScope('method')}>
            روش‌های خرید
          </button>
          <button aria-pressed={scope === 'plan'} onClick={() => setScope('plan')}>
            طرح‌های چکی
          </button>
        </div>
      </section>
      <PurchaseList key={scope} scope={scope} catalog={catalog} writable={writable} />
      <p className="notice">
        فعال‌کردن روش یا طرح، سرویس بیرونی را متصل نمی‌کند. پرداخت و گردش تأیید چک به پیکربندی و
        پذیرش سرویس مربوط وابسته‌اند.
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
    [editing, setEditing] = useState<string | null | undefined>(undefined);
  const cursor = cursors[cursors.length - 1];
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
    setFilter(result.data);
    setCursors([null]);
    setGeneration((v) => v + 1);
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
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>{method ? 'روش‌های خرید' : 'طرح‌های چکی'}</h2>
          <p>
            هر صفحه حداکثر ۵۰ مورد است؛ جزئیات و محدودیت‌های دسته هنگام بازکردن همان مورد دریافت
            می‌شوند.
          </p>
        </div>
        <div className="row-buttons">
          <button disabled={query.isFetching} onClick={refresh}>
            تازه‌سازی فهرست
          </button>
          {writable && (
            <button className="primary" onClick={() => setEditing(null)}>
              {label} جدید
            </button>
          )}
        </div>
      </div>
      <AdminFilterForm
        label="فیلتر شرایط خرید"
        onSubmit={apply}
        search={
          <Field label="جست‌وجوی عنوان یا شناسه">
            <input
              maxLength={120}
              value={draft.query}
              onChange={(e) => setDraft({ ...draft, query: e.target.value })}
            />
          </Field>
        }
        actions={
          <>
            <button className="primary">اعمال جست‌وجو</button>
            <button
              type="button"
              onClick={() => {
                setDraft(emptyPurchaseFilters);
                setFilter(emptyPurchaseFilters);
                refresh();
                setError(undefined);
              }}
            >
              پاک‌کردن فیلترها
            </button>
          </>
        }
      >
        <Field label="فعالیت شرایط">
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
        <Field label="قابل استفاده برای دسته">
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
      <p className="muted">فیلتر دسته، شرایط بدون محدودیت دسته را نیز شامل می‌شود.</p>
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
      ) : (
        query.data && (
          <>
            <p role="status">{query.data.items.length.toLocaleString('fa-IR')} مورد در این صفحه</p>
            <div
              className="table-wrap"
              role="region"
              aria-label="فهرست شرایط خرید، قابل پیمایش افقی"
              tabIndex={0}
            >
              <AdminTable searchable={false}>
                <thead>
                  <tr>
                    <th>عنوان</th>
                    <th>{method ? 'روش' : 'مدت و فاصله'}</th>
                    {!method && <th>نرخ‌ها</th>}
                    <th>فعالیت</th>
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
                          {((row as PlanRow).markupBasisPoints / 100).toLocaleString('fa-IR')}٪
                          افزایش /{' '}
                          {((row as PlanRow).downPaymentBasisPoints / 100).toLocaleString('fa-IR')}٪
                          پیش‌پرداخت
                        </td>
                      )}
                      <td>{row.enabled ? 'فعال' : 'غیرفعال'}</td>
                      <td>
                        {row.categoryCount
                          ? `${row.categoryCount.toLocaleString('fa-IR')} دسته`
                          : 'همهٔ دسته‌ها'}
                      </td>
                      <td>
                        <button className="row-action" onClick={() => setEditing(row.id)}>
                          {writable ? 'ویرایش شرایط' : 'مشاهدهٔ شرایط'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!query.data.items.length && (
                    <tr>
                      <td colSpan={method ? 5 : 6} className="empty">
                        شرایطی با این فیلتر پیدا نشد.
                      </td>
                    </tr>
                  )}
                </tbody>
              </AdminTable>
            </div>
            <div className="pagination">
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
                ۵۰ مورد بعدی
              </button>
            </div>
          </>
        )
      )}
      {editing !== undefined && (
        <Modal
          title={`${editing ? (writable ? 'ویرایش' : 'مشاهده') : 'افزودن'} ${label}`}
          onClose={close}
        >
          {editing ? (
            <PurchaseEditor
              scope={scope}
              id={editing}
              catalog={catalog}
              writable={writable}
              onClose={close}
            />
          ) : method ? (
            <MethodForm catalog={catalog} onClose={close} />
          ) : (
            <PlanForm catalog={catalog} onClose={close} />
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
}: {
  scope: PurchaseScope;
  id: string;
  catalog?: Catalog;
  writable: boolean;
  onClose: () => void;
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
        disabled={query.isFetching}
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
        />
      ) : query.data?.plan ? (
        <PlanForm
          key={revision + ':' + query.data.plan.version}
          item={query.data.plan}
          catalog={catalog}
          readOnly={!writable}
          onClose={onClose}
        />
      ) : null}
    </>
  );
}
