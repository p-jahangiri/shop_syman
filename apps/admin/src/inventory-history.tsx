import { AdminFilterForm } from './admin-filters';
import { AdminTable } from './admin-table';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { Busy, ErrorBox, Field } from './ui';
import {
  emptyMovementFilters,
  localMovementTime,
  movementFiltersSchema,
  movementPath,
  readMovementPage,
  type MovementFilters,
} from './inventory-history-contract';

const date = (at: string) =>
  new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(at));
export function InventoryHistory({
  initialVariantId = null,
}: {
  initialVariantId?: string | null;
}) {
  const [generation, setGeneration] = useState(0);
  const [draft, setDraft] = useState({
    variantId: initialVariantId ?? '',
    direction: 'all',
    fromLocal: '',
    toLocal: '',
  });
  const [filters, setFilters] = useState<MovementFilters>({
    ...emptyMovementFilters,
    variantId: initialVariantId,
  });
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors.at(-1)!;
  const [formError, setFormError] = useState<unknown>();
  const query = useQuery({
    queryKey: ['admin', 'stock-movements', generation, filters, cursor],
    queryFn: async ({ signal }) =>
      readMovementPage(await api<unknown>(movementPath(filters, cursor), { signal }), filters),
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
  function apply(event: React.FormEvent) {
    event.preventDefault();
    setFormError(undefined);
    try {
      const parsed = movementFiltersSchema.safeParse({
        variantId: draft.variantId.trim() || null,
        direction: draft.direction,
        fromAt: localMovementTime(draft.fromLocal),
        toAt: localMovementTime(draft.toLocal),
      });
      if (!parsed.success)
        throw new Error(
          'شناسهٔ تنوع و بازهٔ زمان را بررسی کنید؛ زمان پایان باید بعد از شروع باشد.',
        );
      setFilters(parsed.data);
      setCursors([null]);
      setGeneration((old) => old + 1);
    } catch (error) {
      setFormError(error);
    }
  }
  function refresh() {
    setCursors([null]);
    setGeneration((old) => old + 1);
  }
  return (
    <section id="inventory-movements" className="panel inventory-history">
      <div className="section-heading">
        <div>
          <h2>تاریخچهٔ گردش فیزیکی انبار</h2>
          <p>
            ورود و خروج فیزیکی با شناسهٔ رویداد؛ رزرو و آزادسازی، موجودی فیزیکی را تغییر نمی‌دهند.
          </p>
        </div>
        <button onClick={refresh} disabled={query.isFetching}>
          تازه‌سازی از ابتدا
        </button>
      </div>
      <AdminFilterForm
        label="فیلتر گردش انبار"
        onSubmit={apply}
        primary={
          <>
            <div className="form-grid">
              <Field label="شناسهٔ تنوع (اختیاری)">
                <input
                  dir="ltr"
                  value={draft.variantId}
                  maxLength={64}
                  onChange={(e) => setDraft({ ...draft, variantId: e.target.value })}
                  placeholder="همهٔ تنوع‌ها"
                />
              </Field>
              <Field label="جهت گردش">
                <select
                  value={draft.direction}
                  onChange={(e) => setDraft({ ...draft, direction: e.target.value })}
                >
                  <option value="all">همه</option>
                  <option value="in">ورود فیزیکی</option>
                  <option value="out">خروج فیزیکی</option>
                </select>
              </Field>
              <Field label="از زمان (شامل)">
                <input
                  type="datetime-local"
                  value={draft.fromLocal}
                  onChange={(e) => setDraft({ ...draft, fromLocal: e.target.value })}
                />
              </Field>
              <Field label="تا زمان (پیش از)">
                <input
                  type="datetime-local"
                  value={draft.toLocal}
                  onChange={(e) => setDraft({ ...draft, toLocal: e.target.value })}
                />
              </Field>
            </div>
            <small className="muted">
              ورودی زمان میلادی و بر اساس منطقهٔ دستگاه (
              {Intl.DateTimeFormat().resolvedOptions().timeZone}) است؛ زمان رویدادها در جدول شمسی
              نمایش داده می‌شود.
            </small>
          </>
        }
        actions={
          <>
            <div className="row-buttons">
              <button className="primary" type="submit">
                اعمال فیلتر
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft({ variantId: '', direction: 'all', fromLocal: '', toLocal: '' });
                  setFilters(emptyMovementFilters);
                  setCursors([null]);
                  setGeneration((old) => old + 1);
                  setFormError(undefined);
                }}
              >
                پاک‌کردن فیلتر
              </button>
            </div>
          </>
        }
      />
      <ErrorBox error={formError ?? query.error} />
      {query.isPending ? (
        <Busy />
      ) : query.error ? (
        <div className="row-buttons">
          <button onClick={() => void query.refetch()} disabled={query.isFetching}>
            تلاش دوباره
          </button>
          {cursors.length > 1 && (
            <button onClick={() => setCursors((old) => old.slice(0, -1))}>
              بازگشت به صفحهٔ قبل
            </button>
          )}
        </div>
      ) : (
        query.data && (
          <>
            <p className="muted" role="status">
              {query.data.items.length.toLocaleString('fa-IR')} رویداد در این صفحه · ترتیب شناسه از
              جدید به قدیم
            </p>
            <div className="table-wrap">
              <AdminTable>
                <thead>
                  <tr>
                    <th>رویداد / تنوع</th>
                    <th>تغییر / ماندهٔ فیزیکی</th>
                    <th>دلیل</th>
                    <th>عامل / درخواست</th>
                    <th>زمان</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <bdi>{row.id}</bdi>
                        <small>
                          <bdi>{row.variantId}</bdi>
                        </small>
                      </td>
                      <td>
                        <span className={`badge ${row.delta > 0 ? 'good' : ''}`}>
                          {row.delta > 0 ? '+' : ''}
                          {row.delta.toLocaleString('fa-IR')}
                        </span>
                        <small>{row.balance.toLocaleString('fa-IR')}</small>
                      </td>
                      <td className="movement-reason">{row.reason}</td>
                      <td>
                        <bdi>{row.actorId}</bdi>
                        <small>
                          <bdi>{row.requestId}</bdi>
                        </small>
                      </td>
                      <td data-sort-value={row.at}>
                        <time dateTime={row.at}>{date(row.at)}</time>
                      </td>
                    </tr>
                  ))}
                  {!query.data.items.length && (
                    <tr>
                      <td colSpan={5} className="empty">
                        گردشی با این فیلتر ثبت نشده است.
                      </td>
                    </tr>
                  )}
                </tbody>
              </AdminTable>
            </div>
            <div className="pagination">
              <button
                disabled={cursors.length === 1 || query.isFetching}
                onClick={() => setCursors((old) => old.slice(0, -1))}
              >
                قبلی
              </button>
              <span>صفحهٔ {cursors.length.toLocaleString('fa-IR')}</span>
              <button
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
