import { PersianDateField } from '../../components/forms/persian-date-field';
import { AdminTable } from '../../components/tables/admin-table';
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { api, ApiError } from '../../api/api';
import { adminViewRevision } from '../../auth/admin-view-authority';
import { Busy, ErrorBox } from '../../components/ui';
import {
  chequeReportFilterSchema,
  chequeReportHeld,
  chequeReportPath,
  chequeReportToday,
  readChequeReport,
  type ChequeReportFilter,
  type ChequeReportPage,
} from '@sayman/web-shared/lib/credit/cheque-report-contract.ts';
import { chequeStateSchema } from '@sayman/web-shared/lib/credit/cheque-ledger-contract.ts';
export const chequeReportStateCopy = {
  Received: 'دریافت‌شده',
  Deposited: 'سپرده‌شده به بانک',
  CollectedReported: 'گزارش داخلی وصول',
  BouncedReported: 'گزارش برگشت',
  Withdrawn: 'پس‌گرفته‌شده از بانک',
  ReturnedToCustomer: 'بازگردانده‌شده به مشتری',
};
const digits = new Intl.NumberFormat('fa-IR'),
  civilDate = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    dateStyle: 'medium',
    timeZone: 'Asia/Tehran',
  }),
  instant = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tehran',
  }),
  civil = (v: string) => civilDate.format(new Date(v + 'T12:00:00Z'));
const presets = [
  { label: 'امروز', days: [0, 0] },
  { label: '۳۰ روز آینده', days: [0, 29] },
  { label: '۳۰ روز گذشته', days: [-30, -1] },
] as const;
function dateRange([start, end]: readonly [number, number]) {
  const today = chequeReportToday(new Date().toISOString());
  const offset = (days: number) =>
    new Date(Date.parse(today) + days * 86400000).toISOString().slice(0, 10);
  return { from: offset(start), through: offset(end) };
}
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
    generation = useRef(0),
    [dates, setDates] = useState(() => dateRange(presets[1].days)),
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
    gcTime: 0,
  });
  function submit() {
    const parsed = chequeReportFilterSchema.safeParse({ ...dates, state });
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setRequest({
      filter: parsed.data,
      tokens: [null],
      page: 0,
      generation: ++generation.current,
    });
  }
  function edit(change: () => void) {
    change();
    setInvalid(false);
    setRequest(null);
  }
  const p = request && !result.isError ? result.data : undefined;
  const recoverableConflict =
    result.error instanceof ApiError &&
    ['cheque_report_expired_conflict', 'cheque_report_changed_conflict'].includes(
      result.error.code,
    );
  return (
    <section className="panel cheque-report">
      <div className="cheque-section-title">
        <div className="cheque-section-icon">
          <CalendarDays aria-hidden="true" size={19} />
        </div>
        <div>
          <h2>گزارش سررسید و وضعیت چک‌ها</h2>
          <p>بر اساس تاریخ سررسید به وقت تهران و وضعیت جاری دفتر داخلی.</p>
        </div>
      </div>
      <form
        className="cheque-report-filter"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        noValidate
      >
        <div className="cheque-report-presets" role="group" aria-label="بازه‌های آماده">
          {presets.map((preset) => {
            const range = dateRange(preset.days);
            return (
              <button
                key={preset.label}
                type="button"
                aria-pressed={dates.from === range.from && dates.through === range.through}
                onClick={() => edit(() => setDates(range))}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
        <div className="cheque-report-fields">
          <div className="cheque-date-input">
            <PersianDateField
              label="از تاریخ سررسید"
              encoding="date"
              value={dates.from}
              error={invalid ? 'تاریخ شروع و پایان گزارش را بررسی کنید.' : undefined}
              onChange={(value) => edit(() => setDates((current) => ({ ...current, from: value })))}
            />
          </div>
          <div className="cheque-date-input">
            <PersianDateField
              label="تا تاریخ سررسید"
              encoding="date"
              value={dates.through}
              onChange={(value) =>
                edit(() => setDates((current) => ({ ...current, through: value })))
              }
            />
          </div>
          <label className="cheque-control">
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
          <div className="cheque-report-action">
            <button className="primary" type="submit" disabled={result.isFetching}>
              {filter ? 'شروع گزارش تازه' : 'دریافت گزارش سررسید'}
            </button>
          </div>
        </div>
        {invalid && <p role="alert">بازه باید معتبر، مرتب و حداکثر ۳۶۶ روز باشد.</p>}
      </form>
      <details className="cheque-report-guide">
        <summary>مبنای وضعیت و جمع مبالغ</summary>
        <p>
          گزارش وصول، ثبت داخلی دفتر است. تأیید بانک، تأیید هر چک و مجوز مالی ارسال، مراحل جداگانه
          دارند. جمع‌ها مربوط به ردیف‌های صفحهٔ فعلی هستند.
        </p>
        <p>
          فهرست هر گزارش تا زمان شروع آن را پوشش می‌دهد. وضعیت جاری ردیف‌ها هنگام دریافت هر صفحه
          دوباره بررسی می‌شود.
        </p>
      </details>
      {request && (
        <>
          {recoverableConflict ? (
            <div className="notice" role="alert">
              <p>اطلاعات چک یا مهلت گزارش تغییر کرده است. گزارش تازه از صفحهٔ اول شروع می‌شود.</p>
              <button type="button" onClick={submit}>
                <RefreshCw size={15} aria-hidden="true" /> شروع گزارش تازه
              </button>
            </div>
          ) : (
            result.isError && (
              <div>
                <ErrorBox error={result.error} />
                <button type="button" onClick={() => void result.refetch()}>
                  تلاش دوبارهٔ همین صفحه
                </button>
              </div>
            )
          )}
          {result.isFetching ? (
            <Busy />
          ) : (
            p && (
              <>
                <p className="cheque-report-caption" role="status">
                  صفحهٔ {digits.format(request.page + 1)} · از {civil(p.filter.from)} تا{' '}
                  {civil(p.filter.through)} · به‌روز در {instant.format(new Date(p.observedAt))}
                </p>
                {!!p.items.length && (
                  <dl className="cheque-report-summary" aria-label="جمع مبالغ همین صفحه">
                    <ReportTotal
                      label="جمع همین صفحه"
                      amount={p.pageTotals.amountRial}
                      count={p.pageTotals.count}
                    />
                    <ReportTotal
                      label="در اختیار، گذشته از سررسید"
                      amount={p.pageTotals.overdueHeldRial}
                      count={p.pageTotals.overdueHeldCount}
                      tone="danger"
                    />
                    <ReportTotal
                      label="در اختیار، سررسید امروز"
                      amount={p.pageTotals.dueTodayHeldRial}
                      count={p.pageTotals.dueTodayHeldCount}
                      tone="attention"
                    />
                    <ReportTotal
                      label="در اختیار، سررسید آینده"
                      amount={p.pageTotals.futureHeldRial}
                      count={p.pageTotals.futureHeldCount}
                      tone="info"
                    />
                  </dl>
                )}
                {!!p.items.length && (
                  <details className="cheque-report-guide">
                    <summary>تفکیک همین صفحه بر اساس وضعیت</summary>
                    <dl className="cheque-report-summary">
                      {p.pageTotals.states
                        .filter((s) => s.count > 0)
                        .map((s) => (
                          <ReportTotal
                            key={s.state}
                            label={chequeReportStateCopy[s.state]}
                            amount={s.amountRial}
                            count={s.count}
                          />
                        ))}
                    </dl>
                  </details>
                )}
                {!p.items.length ? (
                  <div className="admin-empty-state cheque-schedules-empty">
                    <CalendarDays size={24} aria-hidden="true" />
                    <strong>چکی با این فیلتر پیدا نشد</strong>
                    <p>بازهٔ سررسید یا وضعیت را تغییر دهید و دوباره گزارش بگیرید.</p>
                  </div>
                ) : (
                  <AdminTable aria-label="جدول سررسید چک‌ها">
                    <thead>
                      <tr>
                        <th>سررسید</th>
                        <th>مبلغ چک (ریال)</th>
                        <th>وضعیت چک</th>
                        <th>شماره</th>
                        <th>مرجع داخلی</th>
                        <th>عملیات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.items.map((r) => (
                        <tr key={r.cheque.id}>
                          <td data-sort-value={r.cheque.dueDate}>
                            {civil(r.cheque.dueDate)}
                            {chequeReportHeld(r.cheque.state) && r.cheque.dueDate <= p.today && (
                              <span
                                className="cheque-status"
                                data-tone={r.cheque.dueDate === p.today ? 'attention' : 'danger'}
                              >
                                {r.cheque.dueDate === p.today ? 'سررسید امروز' : 'گذشته از سررسید'}
                              </span>
                            )}
                          </td>
                          <td className="cheque-money" data-sort-value={r.cheque.amountRial}>
                            <bdi>{digits.format(BigInt(r.cheque.amountRial))}</bdi>
                          </td>
                          <td>
                            <span
                              className="cheque-status"
                              data-tone={
                                r.cheque.state === 'BouncedReported' ? 'danger' : 'neutral'
                              }
                            >
                              {chequeReportStateCopy[r.cheque.state]}
                            </span>
                          </td>
                          <td>{digits.format(r.cheque.sequence)}</td>
                          <td>
                            <bdi className="cheque-reference">{r.cheque.internalReference}</bdi>
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
                {(request.page > 0 || p.nextCursor !== null) && (
                  <div className="cheque-pagination" aria-label="صفحه‌بندی گزارش">
                    <button
                      disabled={request.page === 0}
                      onClick={() => setRequest((r) => (r ? { ...r, page: r.page - 1 } : r))}
                    >
                      <ChevronRight size={16} aria-hidden="true" /> صفحهٔ قبل چک‌ها
                    </button>
                    <button
                      disabled={p.nextCursor === null}
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
                      صفحهٔ بعد چک‌ها <ChevronLeft size={16} aria-hidden="true" />
                    </button>
                  </div>
                )}
              </>
            )
          )}
        </>
      )}
    </section>
  );
}

function ReportTotal({
  label,
  amount,
  count,
  tone,
}: {
  label: string;
  amount: string;
  count: number;
  tone?: string;
}) {
  return (
    <div data-tone={tone}>
      <dt>{label}</dt>
      <dd>
        <strong>
          <bdi>{digits.format(BigInt(amount))}</bdi> ریال
        </strong>
        <small>{digits.format(count)} چک</small>
      </dd>
    </div>
  );
}
