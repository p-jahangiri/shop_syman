import { PersianDateField } from '../../components/forms/persian-date-field';
import { persianCivilDate } from '../../utils/persian-date-contract';
import { AdminCreditReminder } from './credit-reminders';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { api, ApiError } from '../../api/api';
import { adminViewRevision } from '../../auth/admin-view-authority';
import { Busy, ErrorBox } from '../../components/ui';
import { adminChequeLedgerJournal as journal } from '../../state/finance/admin-cheque-ledger-journal';
import {
  chequeAdminBase,
  chequeLedgerPageSchema,
  chequeDetailSchema,
  chequeHistorySchema,
  chequeCommandSchema,
  type ChequeCommand,
  type ChequeAction,
  type ChequeEvent,
} from '@sayman/web-shared/lib/credit/cheque-ledger-contract.ts';
import { creditSchedulePageSchema } from '@sayman/web-shared/lib/credit/credit-schedule-contract.ts';
import {
  ChequeSummaryCopy,
  chequeStateLabels,
} from '@sayman/web-shared/components/credit/cheque-ledger-copy';
const actions: Record<ChequeAction, string> = {
  Deposit: 'ثبت تحویل به بانک',
  ReportCollection: 'ثبت گزارش وصول',
  ReportBounce: 'ثبت گزارش برگشت بانکی',
  Withdraw: 'ثبت برداشت از فرایند بانکی',
  ReturnToCustomer: 'ثبت بازگرداندن چک به مشتری',
  CorrectCollectionReport: 'اصلاح گزارش وصول اشتباه',
};
const time = (value: string) =>
  new Intl.DateTimeFormat('fa-IR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tehran',
  }).format(new Date(value));
const utc = (value: string) =>
  /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(value) ? new Date(value + 'Z').toISOString() : '';
function EventCopy({ value }: { value: ChequeEvent }) {
  return (
    <article className="cheque-event">
      <h4>{value.action === 'Receive' ? 'ثبت دریافت چک' : actions[value.action]}</h4>
      <p>
        {chequeStateLabels[value.state].fa} · رویداد {value.sequence.toLocaleString('fa-IR')}
      </p>
      <p>
        زمان وقوع: {time(value.occurredAt)}؛ زمان ثبت: {time(value.recordedAt)}
      </p>
      {value.note && <p>{value.note}</p>}
      <p>گزارش داخلی؛ تأیید مستقیم بانک نیست.</p>
    </article>
  );
}
export function AdminChequeLedger({
  viewerId,
  ownerId,
  orderId,
  writable,
  unresolved,
}: {
  viewerId: string;
  ownerId: string;
  orderId: string;
  writable: boolean;
  unresolved: boolean;
}) {
  const client = useQueryClient(),
    authority = useRef(adminViewRevision()).current,
    [selected, setSelected] = useState<string | null>(null),
    [invalid, setInvalid] = useState(false);
  const form = useForm({
      defaultValues: {
        sequence: '',
        instrumentReference: '',
        note: '',
        occurredAt: '',
        confirmed: false,
      },
    }),
    base = chequeAdminBase(ownerId, orderId).slice(4),
    key = ['admin', 'cheque-ledger', viewerId, ownerId, orderId];
  const resetForm = form.reset;
  const page = useQuery({
    queryKey: key,
    queryFn: async () => {
      const data = chequeLedgerPageSchema.parse(await api(base));
      if (authority !== adminViewRevision() || data.orderId !== orderId)
        throw Error('دسترسی یا سفارش تغییر کرد.');
      return data;
    },
    refetchOnWindowFocus: false,
  });
  const schedule = useQuery({
    queryKey: ['admin', 'credit-schedule', viewerId, ownerId, orderId],
    queryFn: async () => {
      const data = creditSchedulePageSchema.parse(
        await api('/admin/credit/orders/' + ownerId + '/' + orderId + '/schedule'),
      );
      if (authority !== adminViewRevision() || data.orderId !== orderId)
        throw Error('دسترسی تغییر کرد.');
      return data;
    },
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    setInvalid(false);
    resetForm({
      sequence: '',
      instrumentReference: '',
      note: '',
      occurredAt: '',
      confirmed: false,
    });
  }, [page.data?.orderVersion, page.data?.scheduleVersion, resetForm]);
  useEffect(() => {
    if (!unresolved && !form.formState.isDirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unresolved, form.formState.isDirty]);
  useEffect(() => () => journal.interrupt(), []);
  async function invalidate() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['admin', 'credit-reminder'] }),
      client.invalidateQueries({ queryKey: ['admin', 'credit-clearance'] }),
      client.invalidateQueries({ queryKey: ['admin', 'cheque-approval'] }),
      client.invalidateQueries({ queryKey: ['admin', 'cheque-approval-detail'] }),
      client.invalidateQueries({ queryKey: ['admin', 'cheque-approval-history'] }),
      client.invalidateQueries({ queryKey: ['admin', 'cheque-ledger'] }),
      client.invalidateQueries({ queryKey: ['admin', 'cheque-report'] }),
      client.invalidateQueries({ queryKey: ['admin', 'credit-schedule'] }),
      client.invalidateQueries({ queryKey: ['admin', 'credit-schedule-orders'] }),
    ]);
  }
  async function send(command: ChequeCommand, retry = false) {
    if (!writable) return;
    try {
      if (retry) journal.retry(viewerId);
      else journal.begin(viewerId, command);
    } catch {
      return;
    }
    try {
      const path =
          chequeAdminBase(command.ownerId, command.orderId).slice(4) +
          (command.kind === 'receive' ? '/receive' : '/' + command.before.id) +
          '/commands/' +
          command.id,
        result = await api(path, { method: 'POST', body: JSON.stringify(command.body) });
      if (journal.finish(viewerId, command, result)) await invalidate();
    } catch (error) {
      journal.fail(
        viewerId,
        command,
        error instanceof ApiError ? error.status : 0,
        error instanceof ApiError ? error.code : 'unknown',
      );
    }
  }

  async function receive() {
    if (
      unresolved ||
      !writable ||
      !page.data?.canReceive ||
      !schedule.data?.current ||
      page.isError ||
      page.isFetching ||
      schedule.isError ||
      schedule.isFetching
    )
      return;
    const input = form.getValues(),
      line = schedule.data.current.calculation.lines.find(
        (x) => x.sequence === Number(input.sequence),
      );
    if (!line) {
      setInvalid(true);
      return;
    }
    let occurred = '';
    try {
      occurred = utc(input.occurredAt);
    } catch {
      /* The command schema below rejects the empty timestamp. */
    }
    const command = chequeCommandSchema.safeParse({
      kind: 'receive',
      id: crypto.randomUUID().replaceAll('-', ''),
      ownerId,
      orderId,
      body: {
        orderVersion: page.data.orderVersion,
        scheduleVersion: page.data.scheduleVersion,
        sequence: line.sequence,
        instrumentReference: input.instrumentReference.trim(),
        note: input.note.trim(),
        occurredAt: occurred,
        confirmed: input.confirmed,
      },
      line: {
        scheduleId: schedule.data.current.id,
        sequence: line.sequence,
        dueDate: line.dueDate,
        amountRial: line.amountRial,
      },
    });
    if (!command.success) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    await send(command.data);
    if (authority === adminViewRevision()) resetForm();
  }
  const available =
    schedule.data?.current?.calculation.lines.filter(
      (line) => !page.data?.items.some((x) => x.sequence === line.sequence),
    ) ?? [];
  return (
    <section className="panel cheque-ledger-panel">
      <div className="section-heading">
        <h2>دریافت و گردش چک‌ها</h2>
        <button disabled={unresolved || page.isFetching} onClick={() => void page.refetch()}>
          دریافت وضعیت چک‌ها
        </button>
      </div>
      <p className="notice">
        دریافت سند، تحویل به بانک و گزارش وصول در این دفتر داخلی ثبت می‌شوند. این گزارش‌ها به‌تنهایی
        سفارش را پرداخت‌شده نمی‌کنند و مجوز ارسال نیستند.
      </p>

      <ErrorBox error={page.error} />
      <ErrorBox error={schedule.error} />
      {page.isPending ? (
        <Busy />
      ) : (
        !page.isError &&
        page.data && (
          <>
            {page.data.items.length ? (
              <ul className="cheque-ledger-list">
                {page.data.items.map((c) => (
                  <li key={c.id}>
                    <ChequeSummaryCopy value={c} locale="fa" unit="rial" />
                    <button disabled={unresolved} onClick={() => setSelected(c.id)}>
                      مشاهدهٔ جزئیات و گردش چک {c.sequence.toLocaleString('fa-IR')}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p>هنوز دریافت چکی برای این سفارش ثبت نشده است.</p>
            )}
            {writable && (
              <form onSubmit={form.handleSubmit(() => void receive())} noValidate>
                <fieldset
                  disabled={
                    unresolved ||
                    !page.data.canReceive ||
                    page.isFetching ||
                    schedule.isError ||
                    schedule.isFetching
                  }
                >
                  <legend>ثبت دریافت یک چک از برنامهٔ جاری</legend>
                  {!page.data.canReceive && (
                    <p>
                      دریافت تازه فقط برای خط دریافت‌نشدهٔ یک برنامه در سفارش باز و دارای مهلت ممکن
                      است.
                    </p>
                  )}
                  <label className="ticket-field">
                    <span>خط برنامهٔ سررسید</span>
                    <select {...form.register('sequence')}>
                      <option value="">خط را صریح انتخاب کنید</option>
                      {available.map((line) => (
                        <option key={line.sequence} value={line.sequence}>
                          چک {line.sequence.toLocaleString('fa-IR')} ·{' '}
                          {persianCivilDate(line.dueDate)} ·{' '}
                          {new Intl.NumberFormat('fa-IR').format(BigInt(line.amountRial))} ریال
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="ticket-field">
                    <span>مرجع چک — فقط بخش مالی</span>
                    <input maxLength={128} {...form.register('instrumentReference')} />
                  </label>
                  <label className="ticket-field">
                    <span>توضیح دریافت — یک خط، فقط بخش مالی</span>
                    <input maxLength={500} {...form.register('note')} />
                  </label>
                  <div className="ticket-field">
                    <Controller
                      control={form.control}
                      name="occurredAt"
                      render={({ field }) => (
                        <PersianDateField
                          label="زمان وقوع — شمسی با مبنای UTC"
                          encoding="utc"
                          value={field.value}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          name={field.name}
                          inputRef={field.ref}
                        />
                      )}
                    />
                  </div>
                  <p>
                    مبلغ و سررسید از همان خط برنامه حفظ می‌شوند. پس از دریافت، تغییر تاریخ‌های این
                    برنامه بسته می‌شود.
                  </p>
                  <label className="credit-check">
                    <input type="checkbox" {...form.register('confirmed')} />
                    <span>
                      دریافت همین چک، مرجع و زمان وقوع را بررسی کردم؛ این ثبت به معنی وصول وجه نیست.
                    </span>
                  </label>
                  {invalid && (
                    <p role="alert">خط برنامه، مرجع، زمان صریح و تأیید دریافت را بررسی کنید.</p>
                  )}
                  <button type="submit">ثبت دریافت چک</button>
                </fieldset>
              </form>
            )}
            {selected && (
              <ChequeWorkspace
                key={ownerId + ':' + orderId + ':' + selected}
                viewerId={viewerId}
                ownerId={ownerId}
                orderId={orderId}
                chequeId={selected}
                writable={writable}
                unresolved={unresolved}
                send={send}
              />
            )}
          </>
        )
      )}
    </section>
  );
}
function ChequeWorkspace({
  viewerId,
  ownerId,
  orderId,
  chequeId,
  writable,
  unresolved,
  send,
}: {
  viewerId: string;
  ownerId: string;
  orderId: string;
  chequeId: string;
  writable: boolean;
  unresolved: boolean;
  send: (c: ChequeCommand) => Promise<void>;
}) {
  const authority = useRef(adminViewRevision()).current,
    base = chequeAdminBase(ownerId, orderId).slice(4) + '/' + chequeId,
    key = ['admin', 'cheque-ledger', viewerId, ownerId, orderId, 'details', chequeId],
    form = useForm({
      defaultValues: {
        action: '',
        note: '',
        occurredAt: '',
        confirmed: false,
        acknowledgedClosedOrder: false,
      },
    }),
    [invalid, setInvalid] = useState(false);
  const resetForm = form.reset;
  const detail = useQuery({
    queryKey: key,
    queryFn: async () => {
      const value = chequeDetailSchema.parse(await api(base));
      if (
        authority !== adminViewRevision() ||
        value.cheque.id !== chequeId ||
        value.cheque.orderId !== orderId
      )
        throw Error('دسترسی یا چک تغییر کرده است.');
      return value;
    },
    refetchOnWindowFocus: false,
  });
  const history = useInfiniteQuery({
    queryKey: [...key, 'history'],
    queryFn: async ({ pageParam }) => {
      const value = chequeHistorySchema.parse(
        await api(base + '/history' + (pageParam ? '?beforeSequence=' + pageParam : '')),
      );
      if (authority !== adminViewRevision() || value.chequeId !== chequeId)
        throw Error('دسترسی یا چک تغییر کرده است.');
      return value;
    },
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.nextSequence ?? undefined,
    enabled: !!detail.data,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    setInvalid(false);
    resetForm({
      action: '',
      note: '',
      occurredAt: '',
      confirmed: false,
      acknowledgedClosedOrder: false,
    });
  }, [detail.data?.current.version, resetForm]);
  useEffect(() => {
    if (!form.formState.isDirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [form.formState.isDirty]);
  async function submit() {
    if (unresolved || !writable || !detail.data || detail.isError || detail.isFetching) return;
    const values = form.getValues();
    let occurred = '';
    try {
      occurred = utc(values.occurredAt);
    } catch {
      /* The command schema below rejects the empty timestamp. */
    }
    const command = chequeCommandSchema.safeParse({
      kind: 'move',
      id: crypto.randomUUID().replaceAll('-', ''),
      ownerId,
      orderId,
      before: detail.data.cheque,
      beforeEventSequence: detail.data.current.sequence,
      body: {
        version: detail.data.current.version,
        action: values.action,
        note: values.note.trim(),
        occurredAt: occurred,
        confirmed: values.confirmed,
        acknowledgedClosedOrder: values.acknowledgedClosedOrder,
      },
    });
    if (
      !command.success ||
      (detail.data.closedOrderAcknowledgementRequired && !values.acknowledgedClosedOrder)
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    await send(command.data);
    if (authority === adminViewRevision()) resetForm();
  }
  return (
    <section className="cheque-private-detail">
      <h3>جزئیات خصوصی چک</h3>
      <button disabled={unresolved || detail.isFetching} onClick={() => void detail.refetch()}>
        دریافت جزئیات تازهٔ چک
      </button>
      <ErrorBox error={detail.error} />
      {detail.isPending ? (
        <Busy />
      ) : (
        !detail.isError &&
        detail.data && (
          <>
            <ChequeSummaryCopy value={detail.data.cheque} locale="fa" unit="rial" />
            <p>
              مرجع چک: <bdi>{detail.data.instrumentReference}</bdi>
            </p>
            <p>شرح دریافت: {detail.data.receiptNote || 'ثبت نشده'}</p>
            <EventCopy value={detail.data.current} />
            {detail.data.closedOrderAcknowledgementRequired && (
              <p className="notice">
                سفارش بسته است. گردش سند موجود فقط برای پیگیری ثبت می‌شود؛ سفارش، موجودی و مجوز خرید
                احیا نمی‌شوند.
              </p>
            )}
            {writable && detail.data.allowedActions.length > 0 && (
              <form onSubmit={form.handleSubmit(() => void submit())} noValidate>
                <fieldset disabled={unresolved || detail.isFetching}>
                  <legend>ثبت رویداد تازهٔ چک</legend>
                  <label className="ticket-field">
                    <span>عملیات صریح مالی</span>
                    <select {...form.register('action')}>
                      <option value="">عملیات را انتخاب کنید</option>
                      {detail.data.allowedActions.map((action) => (
                        <option key={action} value={action}>
                          {actions[action]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="ticket-field">
                    <span>دلیل و مرجع پیگیری — یک خط، فقط مالی</span>
                    <input maxLength={500} {...form.register('note')} />
                  </label>
                  <div className="ticket-field">
                    <Controller
                      control={form.control}
                      name="occurredAt"
                      render={({ field }) => (
                        <PersianDateField
                          label="زمان وقوع — شمسی با مبنای UTC"
                          encoding="utc"
                          value={field.value}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          name={field.name}
                          inputRef={field.ref}
                        />
                      )}
                    />
                  </div>
                  <p>
                    اصلاح گزارش وصول فقط خطای ثبت داخلی را اصلاح می‌کند؛ برگشت وجه بانکی نیست.
                    سابقهٔ قبلی حذف نمی‌شود.
                  </p>
                  {detail.data.closedOrderAcknowledgementRequired && (
                    <label className="credit-check">
                      <input type="checkbox" {...form.register('acknowledgedClosedOrder')} />
                      <span>
                        بسته‌بودن سفارش را بررسی کردم و فقط گردش همین سند موجود را ثبت می‌کنم.
                      </span>
                    </label>
                  )}
                  <label className="credit-check">
                    <input type="checkbox" {...form.register('confirmed')} />
                    <span>
                      وضعیت، عملیات، مرجع و زمان همین رویداد را بررسی کردم؛ این گزارش تأیید مستقیم
                      بانک نیست.
                    </span>
                  </label>
                  {invalid && <p role="alert">عملیات، دلیل، زمان و تأییدهای لازم را بررسی کنید.</p>}
                  <button type="submit">ثبت رویداد گردش چک</button>
                </fieldset>
              </form>
            )}
            <details>
              <summary>تاریخچهٔ گردش چک</summary>
              <ErrorBox error={history.error} />
              {history.isPending ? (
                <Busy />
              ) : (
                history.data?.pages
                  .flatMap((x) => x.items)
                  .map((e) => <EventCopy key={e.id} value={e} />)
              )}
              {history.hasNextPage && (
                <button
                  disabled={unresolved || history.isFetchingNextPage}
                  onClick={() => void history.fetchNextPage()}
                >
                  ۲۰ رویداد بعدی
                </button>
              )}
            </details>
            <AdminCreditReminder
              key={viewerId + ':reminder:' + chequeId}
              viewerId={viewerId}
              ownerId={ownerId}
              orderId={orderId}
              chequeId={chequeId}
              writable={writable}
              unresolved={unresolved}
            />
          </>
        )
      )}
    </section>
  );
}

export function AdminChequeLedgerRecovery({
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
    );
  async function refresh() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['admin', 'credit-reminder'] }),
      client.invalidateQueries({ queryKey: ['admin', 'credit-clearance'] }),
      client.invalidateQueries({ queryKey: ['admin', 'cheque-approval'] }),
      client.invalidateQueries({ queryKey: ['admin', 'cheque-approval-detail'] }),
      client.invalidateQueries({ queryKey: ['admin', 'cheque-approval-history'] }),
      client.invalidateQueries({ queryKey: ['admin', 'cheque-ledger'] }),
      client.invalidateQueries({ queryKey: ['admin', 'cheque-report'] }),
      client.invalidateQueries({ queryKey: ['admin', 'credit-schedule'] }),
      client.invalidateQueries({ queryKey: ['admin', 'credit-schedule-orders'] }),
    ]);
  }
  async function send(command: ChequeCommand, retry = false) {
    if (!writable || !retry) return;
    try {
      journal.retry(viewerId);
    } catch {
      return;
    }
    try {
      const target =
          chequeAdminBase(command.ownerId, command.orderId).slice(4) +
          (command.kind === 'receive' ? '/receive' : '/' + command.before.id) +
          '/commands/' +
          command.id,
        r = await api(target, { method: 'POST', body: JSON.stringify(command.body) });
      if (journal.finish(viewerId, command, r)) await refresh();
    } catch (error) {
      journal.fail(
        viewerId,
        command,
        error instanceof ApiError ? error.status : 0,
        error instanceof ApiError ? error.code : 'unknown',
      );
    }
  }
  async function receipt() {
    if (entry?.state !== 'unknown' || !writable) return;
    try {
      const r = await api(
        chequeAdminBase(entry.command.ownerId, entry.command.orderId).slice(4) +
          '/commands/' +
          entry.command.id,
      );
      if (journal.finish(viewerId, entry.command, r)) await refresh();
    } catch (error) {
      journal.fail(
        viewerId,
        entry.command,
        error instanceof ApiError ? error.status : 0,
        error instanceof ApiError ? error.code : 'unknown',
      );
    }
  }
  return (
    <>
      {' '}
      {entry && (
        <section className="panel" role={entry.state === 'rejected' ? 'alert' : 'status'}>
          <h3>
            {entry.state === 'pending'
              ? 'در حال ثبت گردش چک…'
              : entry.state === 'unknown'
                ? 'نتیجهٔ ثبت چک مشخص نیست'
                : entry.state === 'done'
                  ? 'گردش چک ثبت شد'
                  : 'گردش چک ثبت نشد؛ وضعیت را تازه کنید.'}
          </h3>
          <p>
            شناسهٔ پیگیری: <bdi>{entry.command.id}</bdi>
          </p>
          {entry.state === 'unknown' ? (
            <>
              <p>همان شناسه و ورودی برای پیگیری حفظ شده‌اند.</p>
              <button disabled={!writable} onClick={() => void receipt()}>
                بررسی رسید همین گردش چک
              </button>
              <button disabled={!writable} onClick={() => void send(entry.command, true)}>
                تلاش دوبارهٔ همان گردش چک
              </button>
            </>
          ) : (
            entry.state !== 'pending' && (
              <button onClick={() => journal.clear(viewerId)}>بستن نتیجهٔ گردش چک</button>
            )
          )}
          {entry.state === 'done' && entry.result && (
            <>
              <ChequeSummaryCopy value={entry.result.cheque} locale="fa" unit="rial" />
              <EventCopy value={entry.result.event} />
              <p>این رسیدِ همان ثبت است؛ وضعیت جاری را از فهرست تازه دریافت کنید.</p>
            </>
          )}
        </section>
      )}
    </>
  );
}
