import { PersianDateField } from '../../components/forms/persian-date-field';
import { AdminTable } from '../../components/tables/admin-table';
import { CreditReminderPolicy, CreditReminderPolicyRecovery } from './credit-reminder-policy';
import { adminCreditReminderPolicyJournal } from '../../state/finance/admin-credit-reminder-policy-journal';
import { CreditReminderRecovery } from './credit-reminders';
import { adminCreditReminderJournal } from '../../state/finance/admin-credit-reminder-journal';
import { AdminChequeReport } from './cheque-report';
import { AdminCreditClearance, CreditClearanceRecovery } from './credit-clearance';
import { adminCreditClearanceJournal } from '../../state/finance/admin-credit-clearance-journal';
import { ReviewHoldPolicy, ReviewHoldPolicyRecovery } from './review-hold-policy';
import { adminReviewHoldPolicyJournal } from '../../state/finance/admin-review-hold-policy-journal';
import { AdminChequeApprovals, AdminChequeApprovalRecovery } from './cheque-approvals';
import { adminChequeApprovalJournal } from '../../state/finance/admin-cheque-approval-journal';
import { AdminCreditUpfront, AdminUpfrontRecovery } from './credit-upfront';
import { adminCreditUpfrontJournal } from '../../state/finance/admin-credit-upfront-journal';
import { AdminChequeLedger, AdminChequeLedgerRecovery } from './cheque-ledger';
import { adminChequeLedgerJournal } from '../../state/finance/admin-cheque-ledger-journal';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { CalendarDays, FileStack, RefreshCw, Settings2, X } from 'lucide-react';
import { api, ApiError } from '../../api/api';
import { adminViewRevision } from '../../auth/admin-view-authority';
import { adminCreditScheduleJournal as journal } from '../../state/finance/admin-credit-schedule-journal';
import { CreditScheduleCopy } from '@sayman/web-shared/components/credit/credit-schedule-copy';
import {
  creditScheduleAdminBase,
  creditScheduleOrderQueueSchema,
  creditSchedulePageSchema,
  creditScheduleHistorySchema,
  creditSchedulePreviewInputSchema,
  creditScheduleSaveInputSchema,
  creditScheduleCommandSchema,
  readCreditSchedulePreview,
  type CreditScheduleCommand,
  type CreditSchedulePreview,
  type CreditScheduleRevision,
  type CreditScheduleOrderQueue,
} from '@sayman/web-shared/lib/credit/credit-schedule-contract.ts';
import { Busy, ErrorBox } from '../../components/ui';
import '../../styles/finance/cheque-finance.css';
import '../../styles/finance/cheque-schedules-layout.css';
const base = (owner: string, order: string) => creditScheduleAdminBase(owner, order).slice(4),
  date = (v: string) =>
    new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Tehran',
    }).format(new Date(v)),
  money = (v: string) => new Intl.NumberFormat('fa-IR').format(BigInt(v)) + ' ریال';
type Row = CreditScheduleOrderQueue['items'][number];
const views = [
  ['report', 'گزارش سررسید', CalendarDays],
  ['orders', 'رسیدگی به سفارش', FileStack],
  ['policies', 'تنظیمات و یادآوری', Settings2],
] as const;
const orderStates: Record<Row['state'], string> = {
  AwaitingPayment: 'در انتظار بررسی مالی',
  Paid: 'پرداخت‌شده',
  Cancelled: 'لغوشده',
  Expired: 'منقضی‌شده',
  Fulfilled: 'تحویل‌شده',
  CreditApproved: 'تأیید مالی ثبت‌شده',
};
function Revision({ value }: { value: CreditScheduleRevision }) {
  return (
    <article>
      <h3>برنامهٔ سررسید · نسخهٔ {value.revision.toLocaleString('fa-IR')}</h3>
      <p lang={value.locale} dir={value.locale === 'fa' ? 'rtl' : 'ltr'}>
        {value.planName}
      </p>
      <p>ثبت: {date(value.createdAt)}</p>
      <CreditScheduleCopy value={value.calculation} locale="fa" unit="rial" />
    </article>
  );
}
export function CreditSchedulesPage({
  viewerId,
  writable,
}: {
  viewerId: string;
  writable: boolean;
}) {
  const client = useQueryClient(),
    entry = useSyncExternalStore(
      journal.subscribe,
      () => journal.snapshot(viewerId),
      () => null,
    ),
    chequeEntry = useSyncExternalStore(
      adminChequeLedgerJournal.subscribe,
      () => adminChequeLedgerJournal.snapshot(viewerId),
      () => null,
    ),
    upfrontEntry = useSyncExternalStore(
      adminCreditUpfrontJournal.subscribe,
      () => adminCreditUpfrontJournal.snapshot(viewerId),
      () => null,
    ),
    approvalEntry = useSyncExternalStore(
      adminChequeApprovalJournal.subscribe,
      () => adminChequeApprovalJournal.snapshot(viewerId),
      () => null,
    ),
    clearanceEntry = useSyncExternalStore(
      adminCreditClearanceJournal.subscribe,
      () => adminCreditClearanceJournal.snapshot(viewerId),
      () => null,
    ),
    holdEntry = useSyncExternalStore(
      adminReviewHoldPolicyJournal.subscribe,
      () => adminReviewHoldPolicyJournal.snapshot(viewerId),
      () => null,
    ),
    reminderEntry = useSyncExternalStore(
      adminCreditReminderJournal.subscribe,
      () => adminCreditReminderJournal.snapshot(viewerId),
      () => null,
    ),
    policyEntry = useSyncExternalStore(
      adminCreditReminderPolicyJournal.subscribe,
      () => adminCreditReminderPolicyJournal.snapshot(viewerId),
      () => null,
    ),
    unresolved =
      policyEntry?.state === 'pending' ||
      policyEntry?.state === 'unknown' ||
      reminderEntry?.state === 'pending' ||
      reminderEntry?.state === 'unknown' ||
      clearanceEntry?.state === 'pending' ||
      clearanceEntry?.state === 'unknown' ||
      holdEntry?.state === 'pending' ||
      holdEntry?.state === 'unknown' ||
      approvalEntry?.state === 'pending' ||
      approvalEntry?.state === 'unknown' ||
      upfrontEntry?.state === 'pending' ||
      upfrontEntry?.state === 'unknown' ||
      entry?.state === 'pending' ||
      entry?.state === 'unknown' ||
      chequeEntry?.state === 'pending' ||
      chequeEntry?.state === 'unknown';
  const [selected, setSelected] = useState<Row | null>(null),
    [view, setView] = useState<(typeof views)[number][0]>('report'),
    [search, setSearch] = useState(''),
    [stateFilter, setStateFilter] = useState<Row['state'] | 'all'>('all'),
    [now, setNow] = useState(Date.now());
  const detailHeading = useRef<HTMLHeadingElement | null>(null);
  const queueHeading = useRef<HTMLHeadingElement | null>(null);
  const orders = useInfiniteQuery({
    queryKey: ['admin', 'credit-schedule-orders', viewerId],
    enabled: view === 'orders',
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async ({ pageParam, signal }) => {
      const boundary = adminViewRevision(),
        page = creditScheduleOrderQueueSchema.parse(
          await api(
            '/admin/credit/orders' + (pageParam ? '?cursor=' + encodeURIComponent(pageParam) : ''),
            { signal },
          ),
        );
      if (boundary !== adminViewRevision()) throw Error('دسترسی تغییر کرده است.');
      return page;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  useEffect(() => {
    if (view !== 'orders') return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [view]);
  useEffect(() => {
    if (view === 'orders' && selected) detailHeading.current?.focus();
  }, [selected, view]);
  useEffect(() => {
    return () => {
      journal.interrupt();
      adminCreditUpfrontJournal.interrupt();
      adminChequeLedgerJournal.interrupt();
    };
  }, []);
  useEffect(() => {
    if (!unresolved) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unresolved]);
  async function send(command: CreditScheduleCommand, retry = false) {
    if (!writable) return;
    try {
      if (retry) journal.retry(viewerId);
      else journal.begin(viewerId, command);
    } catch {
      return;
    }
    try {
      const result = await api(base(command.ownerId, command.orderId) + '/commands/' + command.id, {
        method: 'POST',
        body: JSON.stringify(command.body),
      });
      if (journal.finish(viewerId, command, result))
        await Promise.all([
          client.invalidateQueries({ queryKey: ['admin', 'credit-schedule'] }),
          client.invalidateQueries({ queryKey: ['admin', 'cheque-ledger'] }),
          client.invalidateQueries({ queryKey: ['admin', 'credit-schedule-orders'] }),
        ]);
    } catch (e) {
      journal.fail(
        viewerId,
        command,
        e instanceof ApiError ? e.status : 0,
        e instanceof ApiError ? e.code : 'unknown',
      );
    }
  }
  async function receipt() {
    const e = journal.snapshot(viewerId);
    if (e?.state !== 'unknown' || !writable) return;
    try {
      const r = await api(base(e.command.ownerId, e.command.orderId) + '/commands/' + e.command.id);
      if (journal.finish(viewerId, e.command, r))
        await Promise.all([
          client.invalidateQueries({ queryKey: ['admin', 'credit-schedule'] }),
          client.invalidateQueries({ queryKey: ['admin', 'cheque-ledger'] }),
          client.invalidateQueries({ queryKey: ['admin', 'credit-schedule-orders'] }),
        ]);
    } catch (error) {
      journal.fail(
        viewerId,
        e.command,
        error instanceof ApiError ? error.status : 0,
        error instanceof ApiError ? error.code : 'unknown',
      );
    }
  }
  const rows = Array.from(
    new Map((orders.data?.pages.flatMap((x) => x.items) ?? []).map((x) => [x.orderId, x])).values(),
  );
  const searchKey = search.trim().toLowerCase();
  const visibleRows = rows.filter(
    (row) =>
      (stateFilter === 'all' || row.state === stateFilter) &&
      (!searchKey ||
        row.reference.toLowerCase().includes(searchKey) ||
        row.orderId.includes(searchKey)),
  );
  function openOrder(row: Row) {
    if (unresolved) return;
    setSelected(row);
    setView('orders');
  }
  return (
    <div className="cheque-workspace cheque-schedules">
      <section className="panel cheque-navigation">
        <div className="cheque-section-title">
          <div className="cheque-section-icon">
            <FileStack size={19} aria-hidden="true" />
          </div>
          <div>
            <h2>میز کار چک‌ها</h2>
            <p>سررسیدها را پیگیری کنید و شواهد مالی هر سفارش را جداگانه بررسی کنید.</p>
          </div>
        </div>
        {!writable && (
          <span className="cheque-status" data-tone="info">
            دسترسی مشاهده
          </span>
        )}
        <div className="cheque-view-switch" role="group" aria-label="نماهای میز کار چک‌ها">
          {views.map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              aria-pressed={view === key}
              aria-controls={'cheque-view-' + key}
              onClick={() => setView(key)}
            >
              <Icon size={17} aria-hidden="true" /> {label}
            </button>
          ))}
        </div>
      </section>
      {entry && (
        <section
          className="panel credit-schedule-result"
          role={entry.state === 'rejected' ? 'alert' : 'status'}
        >
          <h2>
            {entry.state === 'pending'
              ? 'در حال ثبت نسخهٔ برنامه…'
              : entry.state === 'unknown'
                ? 'نتیجهٔ ثبت برنامه مشخص نیست'
                : entry.state === 'done'
                  ? 'نسخهٔ برنامه ثبت شد'
                  : 'برنامه ثبت نشد؛ شرایط را دوباره دریافت کنید.'}
          </h2>
          <p>
            شناسهٔ پیگیری: <bdi>{entry.command.id}</bdi>
          </p>
          {entry.state === 'unknown' ? (
            <>
              <p>
                ابتدا رسید همین شناسه را بخوانید. تلاش دوباره، همان پیش‌نمایش و نسخه‌های قبلی را
                می‌فرستد.
              </p>
              <button disabled={!writable} onClick={() => void receipt()}>
                بررسی رسید همین برنامه
              </button>
              <button disabled={!writable} onClick={() => void send(entry.command, true)}>
                تلاش دوبارهٔ همان برنامه
              </button>
            </>
          ) : (
            entry.state !== 'pending' && (
              <button onClick={() => journal.clear(viewerId)}>بستن نتیجهٔ برنامه</button>
            )
          )}
          {entry.state === 'done' && entry.result && (
            <>
              <p>این رسیدِ ثبت است؛ وضعیت جاری سفارش و برنامه را جداگانه تازه کنید.</p>
              <Revision value={entry.result.revision} />
            </>
          )}
        </section>
      )}
      <CreditReminderRecovery viewerId={viewerId} writable={writable} />
      <CreditClearanceRecovery viewerId={viewerId} writable={writable} />
      <CreditReminderPolicyRecovery viewerId={viewerId} writable={writable} />
      <ReviewHoldPolicyRecovery viewerId={viewerId} writable={writable} />
      <AdminChequeApprovalRecovery viewerId={viewerId} writable={writable} />
      <AdminUpfrontRecovery viewerId={viewerId} writable={writable} />
      <AdminChequeLedgerRecovery viewerId={viewerId} writable={writable} />
      <div id="cheque-view-report" hidden={view !== 'report'}>
        <AdminChequeReport
          key={viewerId}
          viewerId={viewerId}
          unresolved={unresolved}
          onOpenOrder={openOrder}
        />
      </div>
      <div id="cheque-view-policies" className="cheque-policy-grid" hidden={view !== 'policies'}>
        <ReviewHoldPolicy viewerId={viewerId} writable={writable} unresolved={unresolved} />
        <CreditReminderPolicy viewerId={viewerId} writable={writable} unresolved={unresolved} />
      </div>
      <div
        id="cheque-view-orders"
        className="credit-schedules-layout cheque-order-layout"
        data-selected={selected ? '' : undefined}
        hidden={view !== 'orders'}
      >
        <section className="panel cheque-order-queue">
          <div className="section-heading cheque-order-heading">
            <div>
              <h2 ref={queueHeading} tabIndex={-1}>
                سفارش‌های چکی
              </h2>
              <p>وضعیت جاری مجوز ارسال را از پروندهٔ مالی هر سفارش بررسی کنید.</p>
            </div>
            <button
              type="button"
              disabled={orders.isFetching || unresolved}
              onClick={() => void orders.refetch()}
            >
              <RefreshCw size={15} aria-hidden="true" /> تازه‌سازی
            </button>
          </div>
          <div className="cheque-queue-filters">
            <label className="cheque-control">
              جست‌وجو در سفارش‌های دریافت‌شده
              <input
                type="search"
                maxLength={64}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="شماره یا شناسهٔ سفارش"
              />
            </label>
            <label className="cheque-control">
              وضعیت سفارش
              <select
                value={stateFilter}
                onChange={(e) => setStateFilter(e.target.value as Row['state'] | 'all')}
              >
                <option value="all">همهٔ وضعیت‌ها</option>
                {Object.entries(orderStates).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ErrorBox error={orders.error} />
          {orders.isPending
            ? orders.fetchStatus === 'fetching' && <Busy />
            : visibleRows.length > 0 && (
                <AdminTable aria-label="جدول سفارش‌های چکی" searchable={false}>
                  <thead>
                    <tr>
                      <th>سفارش</th>
                      <th>مبلغ نهایی (ریال)</th>
                      <th>زمان ثبت</th>
                      <th>وضعیت</th>
                      <th>عملیات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => (
                      <tr key={row.orderId}>
                        <td>
                          <bdi>{row.reference}</bdi>
                        </td>
                        <td className="cheque-money" data-sort-value={row.payableTotalRial}>
                          <bdi>{BigInt(row.payableTotalRial).toLocaleString('fa-IR')}</bdi>
                        </td>
                        <td data-sort-value={row.createdAt}>{date(row.createdAt)}</td>
                        <td>
                          <span
                            className="cheque-status"
                            data-tone={row.state === 'AwaitingPayment' ? 'attention' : 'neutral'}
                          >
                            {row.state === 'AwaitingPayment' && Date.parse(row.expiresAt) <= now
                              ? 'مهلت سفارش تمام شده'
                              : orderStates[row.state]}
                          </span>
                        </td>
                        <td>
                          <button
                            disabled={unresolved}
                            aria-current={selected?.orderId === row.orderId ? 'page' : undefined}
                            onClick={() => openOrder(row)}
                          >
                            بازکردن پرونده
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </AdminTable>
              )}
          {!orders.isPending && !orders.isError && !visibleRows.length && (
            <div className="admin-empty-state cheque-schedules-empty">
              <FileStack size={24} aria-hidden="true" />
              <strong>
                {rows.length
                  ? 'نتیجه‌ای در سفارش‌های دریافت‌شده نیست'
                  : 'سفارش چکی ثبت‌شده‌ای وجود ندارد'}
              </strong>
              {(search || stateFilter !== 'all') && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setStateFilter('all');
                  }}
                >
                  پاک‌کردن فیلترها
                </button>
              )}
            </div>
          )}
          {orders.hasNextPage && (
            <button
              disabled={orders.isFetchingNextPage || unresolved}
              onClick={() => void orders.fetchNextPage()}
            >
              دریافت سفارش‌های بیشتر
            </button>
          )}
        </section>
        {selected && (
          <section className="panel cheque-order-detail" key={selected.orderId}>
            <div className="cheque-order-heading cheque-order-detail-heading">
              <div className="cheque-section-title">
                <div className="cheque-section-icon">
                  <FileStack size={18} aria-hidden="true" />
                </div>
                <div>
                  <h2 ref={detailHeading} tabIndex={-1}>
                    پروندهٔ مالی <bdi>{selected.reference}</bdi>
                  </h2>
                  <p>
                    مبلغ ثبت‌شدهٔ سفارش <bdi>{money(selected.payableTotalRial)}</bdi>
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={unresolved}
                onClick={() => {
                  setSelected(null);
                  queueHeading.current?.focus();
                }}
              >
                <X size={16} aria-hidden="true" /> بستن پرونده
              </button>
            </div>
            <details className="cheque-detail-step" open>
              <summary>۱. برنامهٔ سررسید</summary>
              <ScheduleWorkspace
                key={viewerId + ':' + selected.orderId}
                viewerId={viewerId}
                row={selected}
                now={now}
                writable={writable}
                unresolved={unresolved}
                send={send}
              />
            </details>
            <details className="cheque-detail-step">
              <summary>۲. دریافت و گردش چک‌ها</summary>
              <AdminChequeLedger
                key={viewerId + ':ledger:' + selected.orderId}
                viewerId={viewerId}
                ownerId={selected.ownerId}
                orderId={selected.orderId}
                writable={writable}
                unresolved={unresolved}
              />
            </details>
            <details className="cheque-detail-step">
              <summary>۳. پیش‌پرداخت</summary>
              <AdminCreditUpfront
                key={viewerId + ':upfront:' + selected.orderId}
                viewerId={viewerId}
                ownerId={selected.ownerId}
                orderId={selected.orderId}
                writable={writable}
                unresolved={unresolved}
              />
            </details>
            <details className="cheque-detail-step">
              <summary>۴. تأیید دستی چک‌ها</summary>
              <AdminChequeApprovals
                key={viewerId + ':approval:' + selected.orderId}
                viewerId={viewerId}
                ownerId={selected.ownerId}
                orderId={selected.orderId}
                writable={writable}
                unresolved={unresolved}
              />
            </details>
            <details className="cheque-detail-step">
              <summary>۵. مجوز مالی ارسال</summary>
              <AdminCreditClearance
                key={viewerId + ':clearance:' + selected.orderId}
                viewerId={viewerId}
                ownerId={selected.ownerId}
                orderId={selected.orderId}
                writable={writable}
                unresolved={unresolved}
              />
            </details>
          </section>
        )}
      </div>
    </div>
  );
}
function ScheduleWorkspace({
  viewerId,
  row,
  now,
  writable,
  unresolved,
  send,
}: {
  viewerId: string;
  row: Row;
  now: number;
  writable: boolean;
  unresolved: boolean;
  send: (c: CreditScheduleCommand) => Promise<void>;
}) {
  const client = useQueryClient(),
    authority = useRef(adminViewRevision()).current,
    [preview, setPreview] = useState<CreditSchedulePreview | null>(null),
    [previewBusy, setPreviewBusy] = useState(false),
    [failed, setFailed] = useState(false),
    [invalid, setInvalid] = useState(false);
  const boundary = () => authority === adminViewRevision();
  const form = useForm({ defaultValues: { calendarKind: '', anchorDate: '', confirmed: false } }),
    calendar = form.watch('calendarKind'),
    anchor = form.watch('anchorDate'),
    confirmed = form.watch('confirmed');
  const setFormValue = form.setValue;
  const controller = useRef<AbortController | null>(null),
    generation = useRef(0);
  const page = useQuery({
    queryKey: ['admin', 'credit-schedule', viewerId, row.ownerId, row.orderId],
    queryFn: async ({ signal }) => {
      const data = creditSchedulePageSchema.parse(
        await api(base(row.ownerId, row.orderId), { signal }),
      );
      if (!boundary() || data.orderId !== row.orderId)
        throw Error('دسترسی یا سفارش تغییر کرده است.');
      return data;
    },
    refetchOnWindowFocus: false,
  });
  const history = useInfiniteQuery({
    queryKey: ['admin', 'credit-schedule', viewerId, row.ownerId, row.orderId, 'history'],
    queryFn: async ({ pageParam }) => {
      const data = creditScheduleHistorySchema.parse(
        await api(
          base(row.ownerId, row.orderId) +
            '/history' +
            (pageParam ? '?beforeRevision=' + pageParam : ''),
        ),
      );
      if (!boundary() || data.orderId !== row.orderId)
        throw Error('دسترسی یا سفارش تغییر کرده است.');
      return data;
    },
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.nextRevision ?? undefined,
    enabled: !!page.data?.current,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    generation.current++;
    controller.current?.abort();
    setPreview(null);
    setPreviewBusy(false);
    setInvalid(false);
    setFailed(false);
    setFormValue('confirmed', false);
  }, [calendar, anchor, page.data?.orderVersion, page.data?.current?.version, setFormValue]);
  useEffect(
    () => () => {
      generation.current++;
      controller.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (!form.formState.isDirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [form.formState.isDirty]);
  const editable =
    !!page.data?.canAmend &&
    !page.isError &&
    !page.isFetching &&
    writable &&
    !unresolved &&
    Date.parse(row.expiresAt) > now;
  async function calculate() {
    if (!editable || !page.data || previewBusy) return;
    const input = creditSchedulePreviewInputSchema.safeParse({
      orderVersion: page.data.orderVersion,
      scheduleVersion: page.data.current?.version ?? null,
      calendarKind: calendar,
      anchorDate: anchor,
    });
    if (!input.success) {
      setInvalid(true);
      return;
    }
    const ticket = ++generation.current,
      c = new AbortController();
    controller.current?.abort();
    controller.current = c;
    setPreview(null);
    setPreviewBusy(true);
    setFailed(false);
    setInvalid(false);
    try {
      const raw = await api(base(row.ownerId, row.orderId) + '/preview', {
          method: 'POST',
          body: JSON.stringify(input.data),
          signal: c.signal,
        }),
        data = readCreditSchedulePreview(raw, row.orderId, input.data);
      if (data.calculation.payableTotalRial !== row.payableTotalRial)
        throw Error('مبلغ با سفارش انتخاب‌شده یکسان نیست.');
      if (boundary() && ticket === generation.current && !c.signal.aborted) setPreview(data);
    } catch {
      if (boundary() && ticket === generation.current && !c.signal.aborted) setFailed(true);
    } finally {
      if (boundary() && ticket === generation.current && !c.signal.aborted) setPreviewBusy(false);
    }
  }
  async function submit() {
    if (!editable || !preview || previewBusy || !page.data) return;
    const input = creditScheduleSaveInputSchema.safeParse({
      orderVersion: page.data.orderVersion,
      scheduleVersion: page.data.current?.version ?? null,
      calendarKind: calendar,
      anchorDate: anchor,
      previewFingerprint: preview.fingerprint,
      confirmed: form.getValues('confirmed'),
    });
    if (!input.success) {
      setInvalid(true);
      return;
    }
    const command = creditScheduleCommandSchema.safeParse({
      id: crypto.randomUUID().replaceAll('-', ''),
      ownerId: row.ownerId,
      orderId: row.orderId,
      body: input.data,
      previewSnapshot: preview,
    });
    if (!command.success) {
      setInvalid(true);
      return;
    }
    await send(command.data);
    if (boundary()) {
      setPreview(null);
      form.reset({ calendarKind: '', anchorDate: '', confirmed: false });
      await client.invalidateQueries({
        queryKey: ['admin', 'credit-schedule', viewerId, row.ownerId, row.orderId],
      });
    }
  }
  return (
    <>
      <div className="section-heading">
        <h2>
          برنامهٔ <bdi>{row.reference}</bdi>
        </h2>
        <button
          disabled={page.isFetching || unresolved || previewBusy}
          onClick={() => void page.refetch()}
        >
          دریافت وضعیت برنامه
        </button>
      </div>
      <ErrorBox error={page.error} />
      {page.isPending ? (
        <Busy />
      ) : (
        !page.isError &&
        page.data && (
          <>
            {page.data.current ? (
              <Revision value={page.data.current} />
            ) : (
              <p>هنوز برنامه‌ای ثبت نشده است.</p>
            )}
            {!page.data.canAmend && (
              <p className="notice">
                {page.data.blockers.includes('credit_schedule_instruments_recorded')
                  ? 'برای این برنامه چک دریافت شده و تاریخ‌های ثبت‌شده ثابت‌اند.'
                  : 'این سفارش برای تنظیم برنامهٔ تازه باز نیست. نسخه‌های قبلی برای پیگیری حفظ می‌شوند.'}
              </p>
            )}
            {writable && (
              <form onSubmit={form.handleSubmit(() => void submit())} noValidate>
                <fieldset disabled={!editable || previewBusy}>
                  <legend>نسخهٔ تازهٔ برنامه</legend>
                  <div className="form-grid cheque-schedule-dates">
                    <label className="ticket-field">
                      <span>تقویم ماه‌شماری</span>
                      <select {...form.register('calendarKind')}>
                        <option value="">تقویم را صریح انتخاب کنید</option>
                        <option value="Persian">شمسی</option>
                        <option value="Gregorian">میلادی</option>
                      </select>
                    </label>
                    <div className="cheque-date-input">
                      <Controller
                        control={form.control}
                        name="anchorDate"
                        render={({ field }) => (
                          <PersianDateField
                            label="تاریخ مبنا — شمسی"
                            encoding="date"
                            value={field.value}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            name={field.name}
                            inputRef={field.ref}
                          />
                        )}
                      />
                    </div>
                  </div>
                  <p>
                    فاصلهٔ ماه‌ها و مبالغ از محاسبهٔ پذیرفته‌شده نگه داشته می‌شوند. سررسیدهای دقیق
                    را در پیش‌نمایش بازبینی کنید.
                  </p>
                  <button type="button" onClick={() => void calculate()}>
                    {previewBusy ? 'در حال محاسبه…' : 'دریافت پیش‌نمایش سررسید'}
                  </button>
                  {failed && (
                    <p role="alert">پیش‌نمایش خوانده نشد؛ نسخه‌ها و وضعیت را تازه کنید.</p>
                  )}
                  {preview && (
                    <section className="credit-schedule-preview">
                      <h3>پیش‌نمایش ثبت‌نشده</h3>
                      <p lang={preview.locale} dir={preview.locale === 'fa' ? 'rtl' : 'ltr'}>
                        {preview.planName}
                      </p>
                      <CreditScheduleCopy value={preview.calculation} locale="fa" unit="rial" />
                      <label className="credit-check">
                        <input type="checkbox" {...form.register('confirmed')} />
                        <span>
                          تقویم، تاریخ‌های دقیق و مبالغ همین پیش‌نمایش را بررسی کردم؛ ثبت برنامه به
                          معنی وصول وجه نیست.
                        </span>
                      </label>
                      <button type="submit" className="primary" disabled={!confirmed}>
                        ثبت نسخهٔ برنامهٔ سررسید
                      </button>
                    </section>
                  )}
                  {invalid && (
                    <p role="alert">
                      تقویم و تاریخ مبنا را صریح انتخاب و همان پیش‌نمایش را تأیید کنید.
                    </p>
                  )}
                </fieldset>
              </form>
            )}
            {page.data.current && (
              <details>
                <summary>تاریخچهٔ برنامه‌ها</summary>
                <ErrorBox error={history.error} />
                {history.isPending ? (
                  <Busy />
                ) : (
                  history.data?.pages
                    .flatMap((x) => x.items)
                    .map((item) => (
                      <details key={item.id}>
                        <summary>
                          نسخهٔ {item.revision.toLocaleString('fa-IR')} · {date(item.createdAt)}
                        </summary>
                        <Revision value={item} />
                      </details>
                    ))
                )}
                {history.hasNextPage && (
                  <button
                    disabled={history.isFetchingNextPage || unresolved}
                    onClick={() => void history.fetchNextPage()}
                  >
                    ۲۰ نسخهٔ بعدی
                  </button>
                )}
              </details>
            )}
          </>
        )
      )}
    </>
  );
}
