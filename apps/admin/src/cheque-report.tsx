import { AdminTable } from './admin-table';
import { AdminFilters } from './admin-filters';
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { adminViewRevision } from './admin-view-authority';
import { Busy, ErrorBox } from './ui';
import {
  chequeReportFilterSchema,
  chequeReportPath,
  readChequeReport,
  type ChequeReportFilter,
  type ChequeReportPage,
} from '../../storefront/lib/cheque-report-contract';
import { chequeStateSchema } from '../../storefront/lib/cheque-ledger-contract';
export const chequeReportStateCopy = {
  Received: 'دریافت‌شده',
  Deposited: 'سپرده‌شده به بانک',
  CollectedReported: 'گزارش داخلی وصول',
  BouncedReported: 'گزارش برگشت',
  Withdrawn: 'پس‌گرفته‌شده از بانک',
  ReturnedToCustomer: 'بازگردانده‌شده به مشتری',
};
const money = (v: string) => new Intl.NumberFormat('fa-IR').format(BigInt(v)) + ' ریال',
  civil = (v: string) =>
    new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeZone: 'Asia/Tehran' }).format(
      new Date(v + 'T12:00:00Z'),
    );
type Order = ChequeReportPage['items'][number]['currentOrder'];
export function AdminChequeReport({
  viewerId,
  unresolved,
  onOpenOrder,
}: {
  viewerId: string;
  unresolved: boolean;
  onOpenOrder: (order: Order) => void;
}) {
  const authority = useRef(adminViewRevision()).current,
    [from, setFrom] = useState(''),
    [through, setThrough] = useState(''),
    [state, setState] = useState('All'),
    [invalid, setInvalid] = useState(false),
    [request, setRequest] = useState<{
      filter: ChequeReportFilter;
      tokens: (string | null)[];
      page: number;
      generation: number;
    } | null>(null);
  const filter = request?.filter,
    token = request?.tokens[request.page] ?? null;
  const result = useQuery({
    queryKey: ['admin', 'cheque-report', viewerId, request?.generation, filter, token],
    enabled: !!request,
    queryFn: async ({ signal }) => {
      if (!filter) throw Error('فیلتر لازم است.');
      const p = readChequeReport(await api(chequeReportPath(filter, token), { signal }), filter);
      if (authority !== adminViewRevision()) throw Error('دسترسی تغییر کرده است.');
      return p;
    },
    refetchOnWindowFocus: false,
    retry: false,
  });
  function submit() {
    const parsed = chequeReportFilterSchema.safeParse({ from, through, state });
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setRequest((old) => ({
      filter: parsed.data,
      tokens: [null],
      page: 0,
      generation: (old?.generation ?? 0) + 1,
    }));
  }
  function edit(change: () => void) {
    change();
    setInvalid(false);
    setRequest(null);
  }
  const p = request ? result.data : undefined;
  return (
    <section className="panel cheque-report">
      <h2>گزارش سررسید و وضعیت چک‌ها</h2>
      <p className="notice">
        وضعیت جاری دفتر داخلی است؛ گزارش وصول، تأیید بانکی نیست. جمع‌ها فقط مربوط به همین صفحه‌اند.
        ثبت چک‌های تازه پس از آغاز گزارش در صفحه‌های بعد وارد نمی‌شود؛ وضعیت چک‌ها هنگام خواندن هر
        صفحه بررسی می‌شود.
      </p>
      <form
        className="admin-filter-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        noValidate
      >
        <fieldset disabled={unresolved}>
          <AdminFilters
            label="فیلتر گزارش چک‌ها"
            primary={
              <>
                <div className="admin-filter-primary-grid">
                  <label>
                    از تاریخ میلادی · روز تهران
                    <input
                      type="date"
                      value={from}
                      min="2000-01-01"
                      onInput={(e) => {
                        const value = e.currentTarget.value;
                        edit(() => setFrom(value));
                      }}
                    />
                  </label>
                  <label>
                    تا تاریخ میلادی · روز تهران
                    <input
                      type="date"
                      value={through}
                      min="2000-01-01"
                      onInput={(e) => {
                        const value = e.currentTarget.value;
                        edit(() => setThrough(value));
                      }}
                    />
                  </label>
                  <label>
                    وضعیت چک
                    <select value={state} onChange={(e) => edit(() => setState(e.target.value))}>
                      <option value="All">همهٔ وضعیت‌ها</option>
                      {chequeStateSchema.options.map((s) => (
                        <option key={s} value={s}>
                          {chequeReportStateCopy[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {invalid && <p role="alert">دو تاریخ معتبر و بازهٔ حداکثر ۳۶۶ روز انتخاب کنید.</p>}
              </>
            }
            actions={
              <button className="primary" type="submit" disabled={result.isFetching}>
                شروع گزارش تازه
              </button>
            }
            applied={
              filter
                ? [
                    'از ' + civil(filter.from),
                    'تا ' + civil(filter.through),
                    filter.state === 'All' ? 'همهٔ وضعیت‌ها' : chequeReportStateCopy[filter.state],
                  ]
                : []
            }
          />
        </fieldset>
      </form>
      {request && (
        <>
          <ErrorBox error={result.error} />
          {result.isFetching ? (
            <Busy />
          ) : (
            p && (
              <>
                <p>
                  صفحهٔ {(request.page + 1).toLocaleString('fa-IR')} · امروز گزارش: {civil(p.today)}{' '}
                  · جمع همین صفحه: {money(p.pageTotals.amountRial)} (
                  {p.pageTotals.count.toLocaleString('fa-IR')} چک)
                </p>
                <dl className="cheque-report-totals">
                  <div>
                    <dt>نگهداری‌شدهٔ گذشته از سررسید</dt>
                    <dd>
                      {money(p.pageTotals.overdueHeldRial)} ·{' '}
                      {p.pageTotals.overdueHeldCount.toLocaleString('fa-IR')} چک
                    </dd>
                  </div>
                  <div>
                    <dt>نگهداری‌شدهٔ سررسید امروز</dt>
                    <dd>
                      {money(p.pageTotals.dueTodayHeldRial)} ·{' '}
                      {p.pageTotals.dueTodayHeldCount.toLocaleString('fa-IR')} چک
                    </dd>
                  </div>
                  <div>
                    <dt>نگهداری‌شدهٔ سررسید آینده</dt>
                    <dd>
                      {money(p.pageTotals.futureHeldRial)} ·{' '}
                      {p.pageTotals.futureHeldCount.toLocaleString('fa-IR')} چک
                    </dd>
                  </div>
                  {p.pageTotals.states
                    .filter((s) => s.count > 0)
                    .map((s) => (
                      <div key={s.state}>
                        <dt>{chequeReportStateCopy[s.state]}</dt>
                        <dd>
                          {money(s.amountRial)} · {s.count.toLocaleString('fa-IR')} چک
                        </dd>
                      </div>
                    ))}
                </dl>
                {!p.items.length ? (
                  <p>چکی با این فیلتر پیدا نشد.</p>
                ) : (
                  <AdminTable aria-label="جدول سررسید چک‌ها">
                    <thead>
                      <tr>
                        <th>سررسید</th>
                        <th>مبلغ</th>
                        <th>وضعیت چک</th>
                        <th>شماره</th>
                        <th>مرجع داخلی</th>
                        <th>عملیات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.items.map((r) => (
                        <tr key={r.cheque.id}>
                          <td data-sort-value={r.cheque.dueDate}>{civil(r.cheque.dueDate)}</td>
                          <td data-sort-value={r.cheque.amountRial}>
                            {money(r.cheque.amountRial)}
                          </td>
                          <td>{chequeReportStateCopy[r.cheque.state]}</td>
                          <td>{r.cheque.sequence.toLocaleString('fa-IR')}</td>
                          <td>
                            <bdi>{r.cheque.internalReference}</bdi>
                          </td>
                          <td>
                            <button
                              disabled={unresolved}
                              onClick={() => onOpenOrder(r.currentOrder)}
                            >
                              بازکردن سفارش <bdi>{r.currentOrder.reference}</bdi>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </AdminTable>
                )}
                <div className="actions">
                  <button
                    disabled={unresolved || request.page === 0}
                    onClick={() => setRequest((r) => (r ? { ...r, page: r.page - 1 } : r))}
                  >
                    صفحهٔ قبل چک‌ها
                  </button>
                  <button
                    disabled={unresolved || p.nextCursor === null}
                    onClick={() =>
                      setRequest((r) =>
                        r && p.nextCursor
                          ? {
                              ...r,
                              tokens: [...r.tokens.slice(0, r.page + 1), p.nextCursor],
                              page: r.page + 1,
                            }
                          : r,
                      )
                    }
                  >
                    صفحهٔ بعد چک‌ها
                  </button>
                </div>
              </>
            )
          )}
        </>
      )}
    </section>
  );
}
