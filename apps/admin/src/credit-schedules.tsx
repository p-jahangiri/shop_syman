import { AdminTable } from './admin-table';
import { CreditReminderPolicy, CreditReminderPolicyRecovery } from './credit-reminder-policy';
import { adminCreditReminderPolicyJournal } from './admin-credit-reminder-policy-journal';
import { CreditReminderRecovery } from './credit-reminders';
import { adminCreditReminderJournal } from './admin-credit-reminder-journal';
import { AdminChequeReport } from './cheque-report';
import { AdminCreditClearance, CreditClearanceRecovery } from './credit-clearance';
import { adminCreditClearanceJournal } from './admin-credit-clearance-journal';
import { ReviewHoldPolicy, ReviewHoldPolicyRecovery } from './review-hold-policy';
import { adminReviewHoldPolicyJournal } from './admin-review-hold-policy-journal';
import { AdminChequeApprovals, AdminChequeApprovalRecovery } from './cheque-approvals';
import { adminChequeApprovalJournal } from './admin-cheque-approval-journal';
import { AdminCreditUpfront, AdminUpfrontRecovery } from './credit-upfront';
import { adminCreditUpfrontJournal } from './admin-credit-upfront-journal';
import { AdminChequeLedger, AdminChequeLedgerRecovery } from './cheque-ledger';
import { adminChequeLedgerJournal } from './admin-cheque-ledger-journal';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { api, ApiError } from './api';
import { adminViewRevision } from './admin-view-authority';
import { adminCreditScheduleJournal as journal } from './admin-credit-schedule-journal';
import { CreditScheduleCopy } from '../../storefront/components/credit-schedule-copy';
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
} from '../../storefront/lib/credit-schedule-contract';
import { Busy, ErrorBox } from './ui';
const base = (owner: string, order: string) => creditScheduleAdminBase(owner, order).slice(4),
  date = (v: string) =>
    new Intl.DateTimeFormat('fa-IR', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Tehran',
    }).format(new Date(v)),
  money = (v: string) => new Intl.NumberFormat('fa-IR').format(BigInt(v)) + ' ریال';
type Row = CreditScheduleOrderQueue['items'][number];
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
    [now, setNow] = useState(Date.now());
  const orders = useInfiniteQuery({
    queryKey: ['admin', 'credit-schedule-orders', viewerId],
    queryFn: async ({ pageParam }) => {
      const boundary = adminViewRevision(),
        page = creditScheduleOrderQueueSchema.parse(
          await api(
            '/admin/credit/orders' + (pageParam ? '?cursor=' + encodeURIComponent(pageParam) : ''),
          ),
        );
      if (boundary !== adminViewRevision()) throw Error('دسترسی تغییر کرده است.');
      return page;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
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
  return (
    <>
      <p className="notice">
        مبالغ از نسخهٔ ثبت‌شدهٔ سفارش خوانده می‌شوند. برنامهٔ سررسید، دریافت چک، وصول وجه یا اجازهٔ
        ارسال نیست.
      </p>
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
      <AdminChequeReport
        key={viewerId}
        viewerId={viewerId}
        unresolved={unresolved}
        onOpenOrder={(row) => setSelected({ ...row })}
      />
      <CreditReminderRecovery viewerId={viewerId} writable={writable} />
      <CreditClearanceRecovery viewerId={viewerId} writable={writable} />
      <CreditReminderPolicyRecovery viewerId={viewerId} writable={writable} />
      <CreditReminderPolicy viewerId={viewerId} writable={writable} unresolved={unresolved} />
      <ReviewHoldPolicyRecovery viewerId={viewerId} writable={writable} />
      <ReviewHoldPolicy viewerId={viewerId} writable={writable} unresolved={unresolved} />
      <AdminChequeApprovalRecovery viewerId={viewerId} writable={writable} />
      <AdminUpfrontRecovery viewerId={viewerId} writable={writable} />
      <AdminChequeLedgerRecovery viewerId={viewerId} writable={writable} />
      <div className="credit-schedules-layout">
        <section className="panel">
          <div className="section-heading">
            <h2>سفارش‌های چکی</h2>
            <button
              disabled={orders.isFetching || unresolved}
              onClick={() => void orders.refetch()}
            >
              دریافت سفارش‌های تازه
            </button>
          </div>
          <ErrorBox error={orders.error} />
          {orders.isPending ? (
            <Busy />
          ) : (
            <AdminTable aria-label="جدول سفارش‌های چکی">
              <thead>
                <tr>
                  <th>سفارش</th>
                  <th>مبلغ نهایی</th>
                  <th>زمان ثبت</th>
                  <th>وضعیت</th>
                  <th>عملیات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.orderId}>
                    <td>
                      <bdi>{row.reference}</bdi>
                    </td>
                    <td data-sort-value={row.payableTotalRial}>{money(row.payableTotalRial)}</td>
                    <td data-sort-value={row.createdAt}>{date(row.createdAt)}</td>
                    <td>
                      {row.state === 'AwaitingPayment' && Date.parse(row.expiresAt) <= now
                        ? 'مهلت سفارش تمام شده'
                        : {
                            AwaitingPayment: 'در انتظار پرداخت',
                            Paid: 'پرداخت‌شده',
                            Cancelled: 'لغوشده',
                            Expired: 'منقضی‌شده',
                            Fulfilled: 'تحویل‌شده',
                            CreditApproved: 'تأیید مالی چکی',
                          }[row.state]}
                    </td>
                    <td>
                      <button
                        disabled={unresolved}
                        aria-current={selected?.orderId === row.orderId ? 'page' : undefined}
                        onClick={() => setSelected({ ...row })}
                      >
                        بازکردن پرونده
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </AdminTable>
          )}
          {!orders.isPending && !rows.length && <p>سفارش چکی ثبت‌شده‌ای وجود ندارد.</p>}
          {orders.hasNextPage && (
            <button
              disabled={orders.isFetchingNextPage || unresolved}
              onClick={() => void orders.fetchNextPage()}
            >
              ۲۰ سفارش بعدی
            </button>
          )}
        </section>
        <section className="panel">
          {selected ? (
            <>
              <ScheduleWorkspace
                key={viewerId + ':' + selected.orderId}
                viewerId={viewerId}
                row={selected}
                now={now}
                writable={writable}
                unresolved={unresolved}
                send={send}
              />
              <AdminCreditClearance
                key={viewerId + ':clearance:' + selected.orderId}
                viewerId={viewerId}
                ownerId={selected.ownerId}
                orderId={selected.orderId}
                writable={writable}
                unresolved={unresolved}
              />
              <AdminCreditUpfront
                key={viewerId + ':upfront:' + selected.orderId}
                viewerId={viewerId}
                ownerId={selected.ownerId}
                orderId={selected.orderId}
                writable={writable}
                unresolved={unresolved}
              />
              <AdminChequeApprovals
                key={viewerId + ':approval:' + selected.orderId}
                viewerId={viewerId}
                ownerId={selected.ownerId}
                orderId={selected.orderId}
                writable={writable}
                unresolved={unresolved}
              />
              <AdminChequeLedger
                key={viewerId + ':ledger:' + selected.orderId}
                viewerId={viewerId}
                ownerId={selected.ownerId}
                orderId={selected.orderId}
                writable={writable}
                unresolved={unresolved}
              />
            </>
          ) : (
            <p>یک سفارش را برای مشاهدهٔ برنامه و تعیین سررسید انتخاب کنید.</p>
          )}
        </section>
      </div>
    </>
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
    anchor = form.watch('anchorDate');
  const setFormValue = form.setValue;
  const controller = useRef<AbortController | null>(null),
    generation = useRef(0);
  const page = useQuery({
    queryKey: ['admin', 'credit-schedule', viewerId, row.ownerId, row.orderId],
    queryFn: async () => {
      const data = creditSchedulePageSchema.parse(await api(base(row.ownerId, row.orderId)));
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
    !!page.data?.canAmend && writable && !unresolved && Date.parse(row.expiresAt) > now;
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
                  <div className="form-grid">
                    <label className="ticket-field">
                      <span>تقویم ماه‌شماری</span>
                      <select {...form.register('calendarKind')}>
                        <option value="">تقویم را صریح انتخاب کنید</option>
                        <option value="Persian">شمسی</option>
                        <option value="Gregorian">میلادی</option>
                      </select>
                    </label>
                    <label className="ticket-field">
                      <span>تاریخ مبنا — میلادی</span>
                      <input type="date" {...form.register('anchorDate')} />
                    </label>
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
                      <button type="submit">ثبت نسخهٔ برنامهٔ سررسید</button>
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
