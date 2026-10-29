import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';
import { adminViewRevision } from './admin-view-authority';
import { Check, ErrorBox, Field, Modal } from './ui';
import { adminCreditReminderJournal as journal } from './admin-credit-reminder-journal';
import {
  creditReminderAdminBase,
  creditReminderPageSchema,
  creditReminderHistorySchema,
  creditReminderCommandSchema,
  type CreditReminderCommand,
} from '../../storefront/lib/credit-reminder-contract';
const base = (owner: string, order: string, cheque: string) =>
    creditReminderAdminBase(owner, order, cheque).slice(4),
  at = (v: string) =>
    new Intl.DateTimeFormat('fa-IR', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Tehran',
    }).format(new Date(v)),
  day = (v: string) =>
    new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeZone: 'Asia/Tehran' }).format(
      new Date(v + 'T12:00:00Z'),
    ),
  money = (v: string) => BigInt(v).toLocaleString('fa-IR') + ' ریال';
async function invalidate(client: ReturnType<typeof useQueryClient>) {
  await client.invalidateQueries({ queryKey: ['admin', 'credit-reminder'] });
}
export function CreditReminderRecovery({
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
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  async function recover(retry = false) {
    const e = journal.snapshot(viewerId);
    if (!writable || busy || e?.state !== 'unknown') return;
    setBusy(true);
    setError(undefined);
    try {
      if (retry) journal.retry(viewerId);
      const raw = await api(
        base(e.command.ownerId, e.command.orderId, e.command.chequeId) +
          '/commands/' +
          e.command.id,
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
  return entry ? (
    <section className="panel" role="status">
      <h2>
        {entry.state === 'pending'
          ? 'در حال ثبت یادآوری داخلی…'
          : entry.state === 'unknown'
            ? 'نتیجهٔ یادآوری مشخص نیست'
            : entry.state === 'done'
              ? 'یادآوری در حساب مشتری ثبت شد'
              : 'یادآوری ثبت نشد'}
      </h2>
      <p>
        شناسهٔ پیگیری: <bdi>{entry.command.id}</bdi>
      </p>
      <ErrorBox error={error} />
      {entry.state === 'unknown' && (
        <>
          <p>ابتدا رسید همین شناسه را بخوانید؛ تلاش دوباره همان بازبینی را نگه می‌دارد.</p>
          <button disabled={busy || !writable} onClick={() => void recover()}>
            بررسی رسید همین یادآوری
          </button>
          <button disabled={busy || !writable} onClick={() => void recover(true)}>
            تلاش دوبارهٔ همان یادآوری
          </button>
        </>
      )}
      {entry.result && (
        <p>
          چک سررسید {day(entry.result.event.summary.dueDate)}،{' '}
          {money(entry.result.event.summary.amountRial)} · ثبت {at(entry.result.event.summary.at)}.
          اعلان خصوصی است؛ وصول بانکی یا ارسال پیامک ثبت نشده است.
        </p>
      )}
      {['done', 'rejected'].includes(entry.state) && (
        <button onClick={() => journal.clear(viewerId)}>بستن نتیجهٔ یادآوری</button>
      )}
    </section>
  ) : null;
}
export function AdminCreditReminder({
  viewerId,
  ownerId,
  orderId,
  chequeId,
  writable,
  unresolved,
}: {
  viewerId: string;
  ownerId: string;
  orderId: string;
  chequeId: string;
  writable: boolean;
  unresolved: boolean;
}) {
  const client = useQueryClient(),
    authority = useRef(adminViewRevision()).current,
    [note, setNote] = useState(''),
    [review, setReview] = useState<CreditReminderCommand | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [before, setBefore] = useState<number | null>(null),
    path = base(ownerId, orderId, chequeId);
  const page = useQuery({
    queryKey: ['admin', 'credit-reminder', viewerId, ownerId, orderId, chequeId],
    queryFn: async ({ signal }) => {
      const p = creditReminderPageSchema.parse(await api(path, { signal }));
      if (authority !== adminViewRevision() || p.orderId !== orderId || p.cheque.id !== chequeId)
        throw Error('دسترسی یا چک تغییر کرده است.');
      return p;
    },
    refetchOnWindowFocus: false,
  });
  const history = useQuery({
    queryKey: ['admin', 'credit-reminder', viewerId, ownerId, orderId, chequeId, 'history', before],
    queryFn: async ({ signal }) => {
      const h = creditReminderHistorySchema.parse(
        await api(path + '/history' + (before ? '?beforeSequence=' + before : ''), { signal }),
      );
      if (authority !== adminViewRevision() || h.orderId !== orderId || h.chequeId !== chequeId)
        throw Error('دسترسی یا چک تغییر کرده است.');
      return h;
    },
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    setNote('');
    setReview(null);
    setConfirmed(false);
  }, [page.data?.previewFingerprint, page.data?.sentToday?.id]);
  useEffect(() => () => journal.interrupt(), []);
  useEffect(() => {
    if (!note && !review && !unresolved) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [note, review, unresolved]);
  function preview(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setConfirmed(false);
    try {
      const p = page.data;
      if (!p || !p.canSend || authority !== adminViewRevision()) throw Error();
      setReview(
        creditReminderCommandSchema.parse({
          id: crypto.randomUUID().replaceAll('-', ''),
          ownerId,
          orderId,
          chequeId,
          body: {
            orderVersion: p.orderVersion,
            ledgerVersion: p.cheque.version,
            previewFingerprint: p.previewFingerprint,
            note: note.trim(),
            confirmed: true,
          },
          previewSnapshot: p,
        }),
      );
    } catch {
      setError(Error('یادداشت خصوصی و آخرین وضعیت همین چک را بررسی کنید.'));
    }
  }
  async function send() {
    if (
      !review ||
      !confirmed ||
      !writable ||
      unresolved ||
      busy ||
      authority !== adminViewRevision()
    )
      return;
    setBusy(true);
    setError(undefined);
    try {
      journal.begin(viewerId, review);
      const raw = await api(path + '/commands/' + review.id, {
        method: 'POST',
        body: JSON.stringify(review.body),
      });
      if (journal.finish(viewerId, review, raw)) {
        setReview(null);
        setNote('');
        setBefore(null);
        await invalidate(client);
      }
    } catch (err) {
      setReview(null);
      journal.fail(
        viewerId,
        review,
        err instanceof ApiError ? err.status : 0,
        err instanceof ApiError ? err.code : 'unknown',
      );
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  const p = page.data,
    disabled = busy || unresolved || !writable;
  return (
    <section className="credit-upfront-panel">
      <h3>یادآوری خصوصی همین چک</h3>
      <p>
        فقط در حساب مشتری نمایش داده می‌شود. مبلغ و سررسید ثبت‌شده و لینک سفارش در اعلان می‌آیند؛
        مرجع خصوصی چک و یادداشت مالی نمایش داده نمی‌شوند. هر چک در هر روز تهران حداکثر یک یادآوری
        دارد.
      </p>
      <ErrorBox error={error ?? page.error ?? history.error} />
      {p && (
        <>
          <p>
            سررسید: {day(p.cheque.dueDate)} · مبلغ: {money(p.cheque.amountRial)}
          </p>
          {p.sentToday ? (
            <p className="notice">یادآوری امروز در {at(p.sentToday.at)} ثبت شده است.</p>
          ) : (
            !p.canSend && (
              <p className="notice">
                یادآوری تازه برای این وضعیت مجاز نیست؛ سفارش باید تعهد مالی چکی داشته باشد و چک هنوز
                در فرایند نگهداری باشد.
              </p>
            )
          )}
          {writable && (
            <form onSubmit={preview}>
              <fieldset disabled={disabled || !p.canSend}>
                <Field label="یادداشت خصوصی بازبینی یادآوری">
                  <textarea
                    value={note}
                    maxLength={500}
                    required
                    onChange={(e) => setNote(e.target.value)}
                  />
                </Field>
                <button type="submit">بازبینی یادآوری داخلی</button>
              </fieldset>
            </form>
          )}
          <button
            disabled={busy || unresolved || page.isFetching}
            onClick={() => void invalidate(client)}
          >
            بازخوانی وضعیت یادآوری
          </button>
          <details>
            <summary>تاریخچهٔ خصوصی یادآوری همین چک</summary>
            {history.data?.items.map((e) => (
              <article key={e.summary.id}>
                <p>
                  {at(e.summary.at)} · {day(e.summary.dueDate)} · {money(e.summary.amountRial)}
                </p>
                <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{e.note}</p>
              </article>
            ))}
            {history.data?.nextBefore && (
              <button
                disabled={busy || unresolved}
                onClick={() => setBefore(history.data!.nextBefore)}
              >
                ۲۰ یادآوری قدیمی‌تر
              </button>
            )}
            {before && (
              <button disabled={busy || unresolved} onClick={() => setBefore(null)}>
                تازه‌ترین یادآوری‌ها
              </button>
            )}
          </details>
        </>
      )}
      {review && (
        <Modal
          title="بازبینی اعلان خصوصی چک"
          onClose={() => {
            if (!busy) setReview(null);
          }}
        >
          <p>
            مشتری تاریخ {day(review.previewSnapshot.cheque.dueDate)}، مبلغ{' '}
            {money(review.previewSnapshot.cheque.amountRial)} و لینک همین سفارش را در حساب خود
            می‌بیند. یادداشت زیر فقط برای بخش مالی است.
          </p>
          <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{review.body.note}</p>
          <Check
            label="گیرندهٔ همین سفارش و اطلاعات همین چک را برای اعلان خصوصی بازبینی کردم"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <button disabled={disabled || !confirmed} onClick={() => void send()}>
            ثبت یادآوری در حساب مشتری
          </button>
        </Modal>
      )}
    </section>
  );
}
