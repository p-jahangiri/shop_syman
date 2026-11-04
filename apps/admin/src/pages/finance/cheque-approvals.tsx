import { PersianDateField } from '../../components/forms/persian-date-field';
import { persianCivilDate } from '../../utils/persian-date-contract';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/api';
import { adminViewRevision } from '../../auth/admin-view-authority';
import { adminChequeApprovalJournal as journal } from '../../state/finance/admin-cheque-approval-journal';
import {
  approvalAdminBase,
  approvalBodySchema,
  approvalCommandPath,
  approvalDetailSchema,
  approvalHistorySchema,
  approvalPageSchema,
  type ApprovalAction,
  type ApprovalBody,
  type ApprovalCommand,
  type ApprovalEvent,
} from '@sayman/web-shared/lib/credit/cheque-approval-contract.ts';
import { ChequeApprovalItems } from '@sayman/web-shared/components/credit/cheque-approval-copy';
import { Check, ErrorBox, Field, Modal } from '../../components/ui';
const labels = { Approve: 'تأیید دستی همین چک', Revoke: 'ابطال گواهی تأیید چک' };
const money = (v: string) => new Intl.NumberFormat('fa-IR').format(BigInt(v)) + ' ریال';
const at = (v: string) =>
  new Intl.DateTimeFormat('fa-IR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tehran',
  }).format(new Date(v));
const utc = (v: string) =>
  /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(v) ? new Date(v + 'Z').toISOString() : '';
function EventCopy({ value }: { value: ApprovalEvent }) {
  return (
    <article className="credit-upfront-event">
      <h3>
        {labels[value.summary.action]} · نسخهٔ {value.summary.sequence.toLocaleString('fa-IR')}
      </h3>
      <p>توضیح خصوصی مالی: {value.note}</p>
      <p>زمان وقوع به وقت تهران: {at(value.summary.occurredAt)}</p>
      {value.acknowledgedClosedOrder && <p>اصلاح گواهی سفارش بسته با تأیید صریح ثبت شده است.</p>}
      <p>این رسید تاریخی است؛ اعتبار تأیید برای وضعیت جاری سند را بازخوانی کنید.</p>
    </article>
  );
}
async function invalidate(client: ReturnType<typeof useQueryClient>) {
  await Promise.all(
    [
      'credit-clearance',
      'cheque-approval',
      'cheque-approval-detail',
      'cheque-approval-history',
      'cheque-ledger',
      'credit-schedule-orders',
    ].map((k) => client.invalidateQueries({ queryKey: ['admin', k] })),
  );
}
export function AdminChequeApprovalRecovery({
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
        approvalCommandPath(e.command),
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
          ? 'ثبت تأیید چک در حال انجام است'
          : e.state === 'unknown'
            ? 'نتیجهٔ ثبت تأیید چک مشخص نیست'
            : e.state === 'done'
              ? 'رسید تأیید دستی چک'
              : 'فرمان تأیید چک رد شد'}
      </h2>
      <p>
        شناسهٔ پیگیری: <bdi>{e.command.id}</bdi>
      </p>
      <ErrorBox error={error} />
      {e.state === 'unknown' && (
        <>
          <p>ابتدا رسید همین شناسه را بخوانید؛ تلاش دوباره دقیقاً همان فرمان را می‌فرستد.</p>
          <button disabled={!writable || busy} onClick={() => void recover()}>
            بررسی رسید همین تأیید چک
          </button>
          <button disabled={!writable || busy} onClick={() => void recover(true)}>
            تلاش دوبارهٔ همان تأیید چک
          </button>
        </>
      )}
      {e.state === 'done' && e.result && <EventCopy value={e.result.event} />}{' '}
      {['done', 'rejected'].includes(e.state) && (
        <button onClick={() => journal.clear(viewerId)}>بستن نتیجهٔ تأیید چک</button>
      )}
      <small>
        شناسه و توضیح فقط در حافظهٔ همین نشست‌اند؛ بازخوانی کامل صفحه آن‌ها را پاک می‌کند.
      </small>
    </section>
  ) : null;
}
export function AdminChequeApprovals({
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
    [cheque, setCheque] = useState(''),
    base = approvalAdminBase(ownerId, orderId).slice(4),
    page = useQuery({
      queryKey: ['admin', 'cheque-approval', viewerId, ownerId, orderId],
      queryFn: async ({ signal }) => {
        const p = approvalPageSchema.parse(await api(base, { signal }));
        if (p.orderId !== orderId || authority !== adminViewRevision())
          throw Error('دسترسی یا سفارش تغییر کرد.');
        return p;
      },
      refetchOnWindowFocus: false,
    });
  return (
    <section className="credit-upfront-panel">
      <h2>تأیید دستی چک‌های سفارش</h2>
      <p>
        هر چک باید جداگانه بازبینی شود؛ تغییر گردش سند، اعتبار تأیید قبلی برای وضعیت تازه را از بین
        می‌برد.
      </p>
      <ErrorBox error={page.error} />
      {page.data && !page.isError ? (
        <>
          <ChequeApprovalItems page={page.data} locale="fa" unit="rial" />
          <Field label="انتخاب چک برای بازبینی مالی">
            <select
              value={cheque}
              disabled={unresolved}
              onChange={(e) => setCheque(e.target.value)}
            >
              <option value="">چک را صریح انتخاب کنید</option>
              {page.data.items.map((x) => (
                <option key={x.sequence} value={x.cheque?.id ?? ''} disabled={!x.cheque}>
                  چک {x.sequence.toLocaleString('fa-IR')} · {money(x.amountRial)} ·{' '}
                  {x.cheque ? 'دریافت شده' : 'دریافت نشده'}
                </option>
              ))}
            </select>
          </Field>
          {cheque && (
            <ApprovalForm
              key={viewerId + ':' + orderId + ':' + cheque}
              {...{ viewerId, ownerId, orderId, writable, unresolved, cheque, base }}
            />
          )}
        </>
      ) : (
        page.isPending && <p role="status">دریافت تأییدهای چک…</p>
      )}
      <button disabled={unresolved} onClick={() => void invalidate(client)}>
        بازخوانی تأییدهای چک
      </button>
    </section>
  );
}
function ApprovalForm({
  viewerId,
  ownerId,
  orderId,
  writable,
  unresolved,
  cheque,
  base,
}: {
  viewerId: string;
  ownerId: string;
  orderId: string;
  writable: boolean;
  unresolved: boolean;
  cheque: string;
  base: string;
}) {
  const client = useQueryClient(),
    authority = useRef(adminViewRevision()).current,
    [action, setAction] = useState<ApprovalAction | ''>(''),
    [note, setNote] = useState(''),
    [occurred, setOccurred] = useState(''),
    [closed, setClosed] = useState(false),
    [before, setBefore] = useState<number | null>(null),
    [review, setReview] = useState<ApprovalBody | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const page = useQuery({
    queryKey: ['admin', 'cheque-approval', viewerId, ownerId, orderId],
    queryFn: async ({ signal }) => {
      const p = approvalPageSchema.parse(await api(base, { signal }));
      if (p.orderId !== orderId || authority !== adminViewRevision())
        throw Error('دسترسی تغییر کرد.');
      return p;
    },
    refetchOnWindowFocus: false,
  });
  const detail = useQuery({
    queryKey: ['admin', 'cheque-approval-detail', viewerId, ownerId, orderId, cheque],
    queryFn: async ({ signal }) => {
      const d = approvalDetailSchema.parse(await api(base + '/' + cheque, { signal }));
      if (
        d.item.cheque?.id !== cheque ||
        d.item.cheque.orderId !== orderId ||
        authority !== adminViewRevision()
      )
        throw Error('سند یا دسترسی تغییر کرد.');
      return d;
    },
    refetchOnWindowFocus: false,
  });
  const history = useQuery({
    queryKey: ['admin', 'cheque-approval-history', viewerId, ownerId, orderId, cheque, before],
    queryFn: async ({ signal }) => {
      const h = approvalHistorySchema.parse(
        await api(base + '/' + cheque + '/history' + (before ? '?beforeSequence=' + before : ''), {
          signal,
        }),
      );
      if (h.orderId !== orderId || h.chequeId !== cheque || authority !== adminViewRevision())
        throw Error('سند یا دسترسی تغییر کرد.');
      return h;
    },
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    setAction('');
    setNote('');
    setOccurred('');
    setClosed(false);
    setReview(null);
    setConfirmed(false);
  }, [
    page.data?.orderVersion,
    page.data?.scheduleVersion,
    detail.data?.item.cheque?.version,
    detail.data?.current?.summary.version,
  ]);
  useEffect(() => {
    if (!action && !note && !occurred && !closed && !unresolved) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [action, note, occurred, closed, unresolved]);
  useEffect(() => () => journal.interrupt(), []);
  function preview(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setConfirmed(false);
    try {
      const p = page.data,
        d = detail.data;
      if (
        !p?.scheduleVersion ||
        !d?.item.cheque ||
        page.isError ||
        page.isFetching ||
        detail.isError ||
        detail.isFetching ||
        !action ||
        authority !== adminViewRevision() ||
        !(action === 'Approve' ? d.canApprove : d.canRevoke) ||
        (action === 'Revoke' && d.closedOrderAcknowledgementRequired && !closed)
      )
        throw Error();
      setReview(
        approvalBodySchema.parse({
          action,
          orderVersion: p.orderVersion,
          scheduleVersion: p.scheduleVersion,
          ledgerVersion: d.item.cheque.version,
          version: d.current?.summary.version ?? null,
          note,
          occurredAt: utc(occurred),
          confirmed: true,
          acknowledgedClosedOrder: action === 'Revoke' && closed,
        }),
      );
    } catch {
      setError(Error('عملیات مجاز، دلیل، زمان UTC و تأیید سفارش بسته را بررسی کنید.'));
    }
  }
  async function send() {
    if (
      !review ||
      !confirmed ||
      busy ||
      page.isError ||
      page.isFetching ||
      detail.isError ||
      detail.isFetching ||
      unresolved ||
      !writable ||
      authority !== adminViewRevision()
    )
      return;
    const command: ApprovalCommand = {
      id: crypto.randomUUID().replaceAll('-', ''),
      ownerId,
      orderId,
      chequeId: cheque,
      body: review,
    };
    setBusy(true);
    setError(undefined);
    try {
      journal.begin(viewerId, command);
      const raw = await api(approvalCommandPath(command), {
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
  const d = detail.isError || page.isError ? undefined : detail.data,
    disabled =
      !writable ||
      busy ||
      unresolved ||
      page.isError ||
      page.isFetching ||
      detail.isError ||
      detail.isFetching;
  return (
    <>
      <ErrorBox error={error ?? detail.error ?? history.error} />
      {d && (
        <>
          <p>
            مرجع خصوصی سند: <bdi>{d.instrumentReference}</bdi>
          </p>
          <p>
            مبلغ: <strong>{money(d.item.amountRial)}</strong> · سررسید:{' '}
            <bdi>{persianCivilDate(d.item.dueDate)}</bdi>
          </p>
          <form onSubmit={preview}>
            <fieldset disabled={disabled}>
              <Field label="عملیات تأیید چک">
                <select
                  value={action}
                  onChange={(e) => {
                    setAction(e.target.value as typeof action);
                    setClosed(false);
                  }}
                  required
                >
                  <option value="">انتخاب کنید</option>
                  {d.canApprove && <option value="Approve">{labels.Approve}</option>}
                  {d.canRevoke && <option value="Revoke">{labels.Revoke}</option>}
                </select>
              </Field>
              <Field label="دلیل و توضیح خصوصی تأیید چک — یک خط">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={500}
                  required
                />
              </Field>
              <div className="field">
                <PersianDateField
                  label="زمان وقوع تأیید چک یا اصلاح — شمسی — UTC"
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
                انتخاب زمان فعلی UTC برای تأیید چک
              </button>
              {action === 'Revoke' && d.closedOrderAcknowledgementRequired && (
                <Check
                  label="بسته یا منقضی بودن سفارش را بررسی کردم؛ فقط گواهی تأیید چک اصلاح می‌شود"
                  checked={closed}
                  onChange={(e) => setClosed(e.target.checked)}
                  required
                />
              )}
              <button type="submit" disabled={!action}>
                بازبینی تأیید دستی چک
              </button>
            </fieldset>
          </form>
          <h3>تاریخچهٔ خصوصی تأیید همین چک</h3>
          {history.data?.items.map((e) => (
            <EventCopy key={e.summary.id} value={e} />
          ))}
          {before && <button onClick={() => setBefore(null)}>جدیدترین تأییدهای چک</button>}
          {history.data?.nextBefore && (
            <button onClick={() => setBefore(history.data!.nextBefore)}>
              تأییدهای قدیمی‌تر چک
            </button>
          )}
        </>
      )}
      {review && d && (
        <Modal
          title={labels[review.action]}
          preventClose={busy || unresolved}
          onClose={() => setReview(null)}
        >
          <p>
            چک {d.item.sequence.toLocaleString('fa-IR')} · {money(d.item.amountRial)} ·{' '}
            <bdi>{persianCivilDate(d.item.dueDate)}</bdi>
          </p>
          <p>
            مرجع خصوصی: <bdi>{d.instrumentReference}</bdi>
          </p>
          <p>{review.note}</p>
          <p>زمان وقوع به وقت تهران: {at(review.occurredAt)}</p>
          <p>
            {review.action === 'Approve'
              ? 'همین نسخهٔ سند و وضعیت جاری آن را به‌صورت دستی تأیید می‌کنید. این ثبت، تأیید بانک یا وصول وجه نیست.'
              : 'گواهی قبلی باطل می‌شود؛ گردش چک، وجه و مهلت سفارش تغییر نمی‌کند.'}
          </p>
          <Check
            label="همین سند، مبلغ، سررسید، وضعیت جاری و اثر گواهی را بازبینی کردم"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <button disabled={disabled || !confirmed} onClick={() => void send()}>
            تأیید ثبت گواهی چک
          </button>
        </Modal>
      )}
    </>
  );
}
