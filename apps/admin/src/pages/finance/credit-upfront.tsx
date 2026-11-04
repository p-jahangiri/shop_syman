import { PersianDateField } from '../../components/forms/persian-date-field';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/api';
import { adminViewRevision } from '../../auth/admin-view-authority';
import { adminCreditUpfrontJournal as journal } from '../../state/finance/admin-credit-upfront-journal';
import {
  upfrontAdminBase,
  upfrontBodySchema,
  upfrontCommandPath,
  upfrontHistorySchema,
  upfrontPageSchema,
  type UpfrontAction,
  type UpfrontBody,
  type UpfrontCommand,
  type UpfrontEvent,
} from '@sayman/web-shared/lib/credit/credit-upfront-contract.ts';
import { UpfrontSummaryCopy } from '@sayman/web-shared/components/credit/credit-upfront-copy';
import { Check, ErrorBox, Field, Modal } from '../../components/ui';
const labels: Record<UpfrontAction, string> = {
  ConfirmReceipt: 'تأیید دریافت کامل پیش‌پرداخت',
  ConfirmNoUpfrontDue: 'تأیید نبود نیاز به پیش‌پرداخت',
  RevokeConfirmation: 'ابطال گواهی قبلی',
};
const money = (v: string) => new Intl.NumberFormat('fa-IR').format(BigInt(v)) + ' ریال';
const uuid = () => crypto.randomUUID().replaceAll('-', '');
const utc = (v: string) =>
  /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(v) ? new Date(v + 'Z').toISOString() : '';
function EventCopy({ value }: { value: UpfrontEvent }) {
  return (
    <article className="credit-upfront-event">
      <p>
        رویداد {value.summary.sequence.toLocaleString('fa-IR')} · {labels[value.summary.action]}
      </p>
      <UpfrontSummaryCopy value={value.summary} locale="fa" unit="rial" />
      {value.reference && (
        <p>
          مرجع خصوصی مالی: <bdi>{value.reference}</bdi>
        </p>
      )}
      {value.note && <p>توضیح خصوصی: {value.note}</p>}
      {value.acknowledgedCommittedOrder && (
        <p>اصلاح گواهی پس تعهد، پیش از ارسال و با آگاهی صریح مالی ثبت شده است.</p>
      )}
      {value.acknowledgedClosedOrder && <p>اصلاح گواهیِ سفارش بسته با تأیید صریح ثبت شده است.</p>}
    </article>
  );
}
async function invalidate(client: ReturnType<typeof useQueryClient>) {
  await Promise.all(
    [
      'credit-clearance',
      'credit-upfront',
      'credit-upfront-history',
      'credit-schedule',
      'credit-schedule-orders',
    ].map((k) => client.invalidateQueries({ queryKey: ['admin', k] })),
  );
}
export function AdminUpfrontRecovery({
  viewerId,
  writable,
}: {
  viewerId: string;
  writable: boolean;
}) {
  const client = useQueryClient(),
    e = useSyncExternalStore(
      journal.subscribe,
      () => journal.snapshot(viewerId),
      () => null,
    ),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  async function recover(retry = false) {
    if (!e || !writable || busy || e.state !== 'unknown') return;
    setBusy(true);
    setError(undefined);
    try {
      if (retry) journal.retry(viewerId);
      const raw = await api(
        upfrontCommandPath(e.command),
        retry ? { method: 'POST', body: JSON.stringify(e.command.body) } : {},
      );
      if (journal.finish(viewerId, e.command, raw)) await invalidate(client);
    } catch (err) {
      journal.fail(
        viewerId,
        e.command,
        err instanceof ApiError ? err.status : 0,
        err instanceof ApiError ? err.code : 'unknown',
      );
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return e ? (
    <section className="panel credit-upfront-panel" role="status">
      <h2>
        {e.state === 'pending'
          ? 'ثبت گواهی پیش‌پرداخت در حال انجام است'
          : e.state === 'unknown'
            ? 'نتیجهٔ ثبت گواهی پیش‌پرداخت مشخص نیست'
            : e.state === 'done'
              ? 'رسید ثبت گواهی پیش‌پرداخت'
              : 'فرمان پیش‌پرداخت رد شد'}
      </h2>
      <p>
        شناسهٔ پیگیری: <bdi>{e.command.id}</bdi>
      </p>
      <ErrorBox error={error} />
      {e.state === 'unknown' && (
        <>
          <p>
            ابتدا رسید همین شناسه را بخوانید؛ ارسال دوباره، همان نسخه‌ها و همان ورودی را حفظ می‌کند.
          </p>
          <div className="row-buttons">
            <button disabled={!writable || busy} onClick={() => void recover()}>
              بررسی رسید همین پیش‌پرداخت
            </button>
            <button disabled={!writable || busy} onClick={() => void recover(true)}>
              تلاش دوبارهٔ همان پیش‌پرداخت
            </button>
          </div>
        </>
      )}
      {e.state === 'done' && e.result && (
        <>
          <p>این رسید تاریخیِ همان ثبت است؛ وضعیت جاری را از سفارش بازخوانی کنید.</p>
          <EventCopy value={e.result.event} />
        </>
      )}
      {['done', 'rejected'].includes(e.state) && (
        <button onClick={() => journal.clear(viewerId)}>بستن نتیجهٔ پیش‌پرداخت</button>
      )}
      <small>شناسه فقط در حافظهٔ همین نشست است؛ بازخوانی کامل صفحه آن را پاک می‌کند.</small>
    </section>
  ) : null;
}
export function AdminCreditUpfront({
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
    [before, setBefore] = useState<number | null>(null),
    [action, setAction] = useState<UpfrontAction | ''>(''),
    [reference, setReference] = useState(''),
    [note, setNote] = useState(''),
    [occurred, setOccurred] = useState(''),
    [closed, setClosed] = useState(false),
    [committed, setCommitted] = useState(false),
    [review, setReview] = useState<UpfrontBody | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    base = upfrontAdminBase(ownerId, orderId).slice(4);
  const page = useQuery({
    queryKey: ['admin', 'credit-upfront', viewerId, ownerId, orderId],
    queryFn: async ({ signal }) => {
      const d = upfrontPageSchema.parse(await api(base, { signal }));
      if (d.orderId !== orderId || authority !== adminViewRevision())
        throw Error('دسترسی یا سفارش تغییر کرد.');
      return d;
    },
    refetchOnWindowFocus: false,
  });
  const history = useQuery({
    queryKey: ['admin', 'credit-upfront-history', viewerId, ownerId, orderId, before],
    queryFn: async ({ signal }) => {
      const h = upfrontHistorySchema.parse(
        await api(base + '/history' + (before ? '?beforeSequence=' + before : ''), { signal }),
      );
      if (h.orderId !== orderId || authority !== adminViewRevision())
        throw Error('دسترسی یا سفارش تغییر کرد.');
      return h;
    },
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    setAction('');
    setReference('');
    setNote('');
    setOccurred('');
    setClosed(false);
    setCommitted(false);
    setReview(null);
    setConfirmed(false);
  }, [page.data?.orderVersion, page.data?.scheduleVersion, page.data?.current?.version]);
  const dirty = !!(action || reference || note || occurred || closed || committed);
  useEffect(() => {
    if (!dirty && !unresolved) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, unresolved]);
  useEffect(() => () => journal.interrupt(), []);
  function preview(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setConfirmed(false);
    try {
      const p = page.data;
      if (
        !p ||
        page.isError ||
        page.isFetching ||
        !p.scheduleVersion ||
        (p.orderState === 'CreditApproved' && !committed) ||
        authority !== adminViewRevision() ||
        !action ||
        !{
          ConfirmReceipt: p.canConfirmReceipt,
          ConfirmNoUpfrontDue: p.canConfirmNoUpfrontDue,
          RevokeConfirmation: p.canRevoke,
        }[action]
      )
        throw Error();
      setReview(
        upfrontBodySchema.parse({
          action,
          orderVersion: p.orderVersion,
          scheduleVersion: p.scheduleVersion,
          version: p.current?.version ?? null,
          reference: action === 'ConfirmReceipt' ? reference : '',
          note,
          occurredAt: utc(occurred),
          confirmed: true,
          acknowledgedClosedOrder: action === 'RevokeConfirmation' && closed,
          ...(committed ? { acknowledgedCommittedOrder: true } : {}),
        }),
      );
    } catch {
      setError(
        Error(
          'عملیات مجاز، مرجع، زمان وقوع UTC، دلیل اصلاح و تأیید صریح وضعیت بسته یا تعهدی سفارش را بررسی کنید.',
        ),
      );
    }
  }
  async function send() {
    if (
      !review ||
      !confirmed ||
      !writable ||
      busy ||
      page.isError ||
      page.isFetching ||
      unresolved ||
      authority !== adminViewRevision()
    )
      return;
    const command: UpfrontCommand = { id: uuid(), ownerId, orderId, body: review };
    setBusy(true);
    setError(undefined);
    try {
      journal.begin(viewerId, command);
      const raw = await api(upfrontCommandPath(command), {
        method: 'POST',
        body: JSON.stringify(command.body),
      });
      if (journal.finish(viewerId, command, raw)) {
        setReview(null);
        setBefore(null);
        await invalidate(client);
      }
    } catch (err) {
      setReview(null);
      journal.fail(
        viewerId,
        command,
        err instanceof ApiError ? err.status : 0,
        err instanceof ApiError ? err.code : 'unknown',
      );
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  const p = page.isError ? undefined : page.data,
    disabled = !writable || busy || unresolved || page.isError || page.isFetching;
  return (
    <section className="credit-upfront-panel">
      <h2>تأیید دریافت پیش‌پرداخت</h2>
      <p>
        مبلغ از اصل سفارش و جمع چک‌ها خوانده می‌شود و هزینه‌های خارج چک را هم شامل می‌شود. این گواهی
        به‌تنهایی مجوز ارسال ایجاد نمی‌کند.
      </p>
      <ErrorBox error={error ?? page.error ?? history.error} />
      {page.isPending ? (
        <p role="status">دریافت وضعیت پیش‌پرداخت…</p>
      ) : p ? (
        <>
          <p>
            پیش‌پرداخت لازمِ سفارش: <strong>{money(p.requiredAmountRial)}</strong>
          </p>
          {p.current ? (
            <UpfrontSummaryCopy value={p.current} locale="fa" unit="rial" />
          ) : (
            <p>هنوز گواهی پیش‌پرداختی ثبت نشده است.</p>
          )}
          {p.blockers.includes('order_closed') && (
            <p className="notice">
              سفارش بسته یا منقضی شده است؛ دریافت تازه ثبت نمی‌شود. اصلاح گواهی موجود نیازمند تأیید
              صریح است.
            </p>
          )}
          {p.orderState === 'CreditApproved' && (
            <p className="notice">
              اصلاح گواهی سفارش متعهد فقط پیش از ارسال ممکن است. هر اصلاح، مجوز مالی قبلی را نامعتبر
              می‌کند؛ پس از تأیید مجدد دریافت، مجوز نهایی هم باید دوباره بازبینی شود. موجودی و مهلت
              سفارش تغییر نمی‌کنند.
            </p>
          )}
          {p.blockers.includes('shipment_already_dispatched') && (
            <p className="notice">
              ارسال شروع شده است؛ این مسیر دیگر گواهی پیش‌پرداخت را تغییر نمی‌دهد.
            </p>
          )}
          {p.blockers.includes('schedule_required') && (
            <p>ابتدا برنامهٔ سررسید سفارش را ذخیره کنید.</p>
          )}
          {p.blockers.includes('history_capacity') && <p>ظرفیت تاریخچهٔ گواهی پر شده است.</p>}
          <form onSubmit={preview}>
            <p role="status">
              {dirty
                ? 'تغییر ذخیره‌نشده دارید؛ خروج از این بخش آن را نگه نمی‌دارد.'
                : 'فرم خالی است؛ عملیاتی انتخاب نشده است.'}
            </p>
            <fieldset disabled={disabled}>
              <Field label="عملیات پیش‌پرداخت">
                <select
                  value={action}
                  onChange={(e) => {
                    setAction(e.target.value as typeof action);
                    setReference('');
                    setClosed(false);
                    setCommitted(false);
                  }}
                  required
                >
                  <option value="">انتخاب کنید</option>
                  {p.canConfirmReceipt && (
                    <option value="ConfirmReceipt">{labels.ConfirmReceipt}</option>
                  )}
                  {p.canConfirmNoUpfrontDue && (
                    <option value="ConfirmNoUpfrontDue">{labels.ConfirmNoUpfrontDue}</option>
                  )}
                  {p.canRevoke && (
                    <option value="RevokeConfirmation">{labels.RevokeConfirmation}</option>
                  )}
                </select>
              </Field>
              {action === 'ConfirmReceipt' && (
                <Field
                  label="مرجع خصوصی دریافت کامل پیش‌پرداخت"
                  hint="مرجع یا شرح دریافت‌های واقعی مرتبط؛ فقط تیم مالی می‌بیند."
                >
                  <input
                    maxLength={256}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    required
                  />
                </Field>
              )}
              <Field label="توضیح خصوصی مالی">
                <textarea
                  value={note}
                  maxLength={500}
                  onChange={(e) => setNote(e.target.value)}
                  required={action === 'RevokeConfirmation' || p.orderState === 'CreditApproved'}
                />
              </Field>
              <div className="field">
                <PersianDateField
                  label="زمان وقوع پیش‌پرداخت یا اصلاح (شمسی، UTC)"
                  encoding="utc"
                  value={occurred}
                  onChange={(next) => setOccurred(next)}
                  required
                />
              </div>
              <button
                type="button"
                onClick={() => setOccurred(new Date().toISOString().slice(0, 19))}
              >
                انتخاب زمان فعلی UTC
              </button>
              {action === 'RevokeConfirmation' && p.blockers.includes('order_closed') && (
                <Check
                  label="بسته یا منقضی بودن سفارش را بازبینی کردم؛ این اصلاح گواهی است و وجهی بازپرداخت نمی‌کند"
                  checked={closed}
                  onChange={(e) => setClosed(e.target.checked)}
                  required
                />
              )}
              {p.orderState === 'CreditApproved' && (
                <Check
                  label="تعهد سفارش و نامعتبرشدن مجوز مالی قبلی را بازبینی کردم؛ این اصلاح وجهی بازپرداخت نمی‌کند"
                  checked={committed}
                  onChange={(e) => setCommitted(e.target.checked)}
                  required
                />
              )}
              <button
                type="submit"
                disabled={!action || (p.orderState === 'CreditApproved' && !committed)}
              >
                بازبینی گواهی پیش‌پرداخت
              </button>
            </fieldset>
          </form>
          <button disabled={busy || unresolved} onClick={() => void invalidate(client)}>
            بازخوانی وضعیت پیش‌پرداخت
          </button>
          <h3>تاریخچهٔ خصوصی پیش‌پرداخت</h3>
          {history.data?.items.map((e) => (
            <EventCopy key={e.summary.id} value={e} />
          ))}
          <div className="row-buttons">
            {before && <button onClick={() => setBefore(null)}>جدیدترین گواهی‌ها</button>}
            {history.data?.nextBefore && (
              <button onClick={() => setBefore(history.data!.nextBefore)}>
                گواهی‌های قدیمی‌تر
              </button>
            )}
          </div>
        </>
      ) : null}
      {review && p && (
        <Modal
          title={labels[review.action]}
          preventClose={busy || unresolved}
          onClose={() => setReview(null)}
        >
          <p>
            پیش‌پرداخت لازم بر اساس سفارش: <strong>{money(p.requiredAmountRial)}</strong>
          </p>
          <p>
            {review.action === 'ConfirmReceipt'
              ? 'دریافت کاملِ واقعی این مبلغ را تأیید می‌کنید؛ این ثبت تأیید مستقیم بانک نیست.'
              : review.action === 'ConfirmNoUpfrontDue'
                ? 'اصل سفارش پیش‌پرداختی ندارد؛ رسید دریافت وجه صفر ایجاد نمی‌شود.'
                : 'گواهی قبلی باطل می‌شود؛ این عملیات وجهی بازپرداخت نمی‌کند و سفارش را دوباره باز نمی‌کند.'}
          </p>
          {review.acknowledgedCommittedOrder && (
            <p className="notice">
              این اصلاح پس تعهد ثبت می‌شود و مجوز نهایی قبلی را نامعتبر می‌کند. برای ادامهٔ ارسال،
              بازبینی جدید مالی لازم است.
            </p>
          )}
          {review.reference && (
            <p>
              مرجع خصوصی: <bdi>{review.reference}</bdi>
            </p>
          )}
          {review.note && <p>{review.note}</p>}
          <p>
            زمان وقوع به وقت تهران:{' '}
            {new Intl.DateTimeFormat('fa-IR', {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone: 'Asia/Tehran',
            }).format(new Date(review.occurredAt))}
          </p>
          <Check
            label="مبلغ سفارش، زمان، مرجع و اثر این گواهی را بازبینی و تأیید کردم"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <button disabled={disabled || !confirmed} onClick={() => void send()}>
            تأیید ثبت گواهی پیش‌پرداخت
          </button>
        </Modal>
      )}
    </section>
  );
}
