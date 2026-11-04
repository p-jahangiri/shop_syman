import { AdminTable } from '../../components/tables/admin-table';
import { persianCivilDate } from '../../utils/persian-date-contract';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/api';
import { adminViewRevision } from '../../auth/admin-view-authority';
import { adminCreditClearanceJournal as journal } from '../../state/finance/admin-credit-clearance-journal';
import { Check, ErrorBox, Field, Modal } from '../../components/ui';
import {
  clearanceBase,
  clearanceBodySchema,
  clearanceCommandSchema,
  clearancePageSchema,
  clearanceHistorySchema,
  type ClearanceCommand,
  type ClearancePage,
} from '@sayman/web-shared/lib/credit/credit-clearance-contract.ts';
const at = (v: string) =>
    new Intl.DateTimeFormat('fa-IR', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Tehran',
    }).format(new Date(v)),
  money = (s: string) => new Intl.NumberFormat('fa-IR').format(BigInt(s)) + ' ریال';
const reasons: Record<string, string> = {
  order_closed: 'سفارش برای تأیید نخست باز نیست.',
  reservation_not_ready: 'وضعیت رزرو برای این مرحله مناسب نیست.',
  shipment_already_dispatched: 'بسته ارسال شده است؛ مجوز پیش از ارسال در این مسیر تغییر نمی‌کند.',
  upfront_confirmation_required: 'گواهی فعال کل پیش‌پرداخت یا نبود پیش‌پرداخت لازم است.',
  all_current_cheques_required:
    'همهٔ چک‌های برنامه باید تأیید معتبر همان نسخهٔ گردش را داشته باشند.',
  schedule_required: 'برنامهٔ سررسید ثبت نشده است.',
  clearance_history_required: 'تاریخچهٔ مجوز مالی موجود نیست.',
  history_capacity: 'ظرفیت فنی تاریخچه تکمیل شده است.',
};
async function invalidate(client: ReturnType<typeof useQueryClient>) {
  await Promise.all(
    [
      'credit-reminder',
      'credit-clearance',
      'credit-schedule',
      'credit-schedule-orders',
      'cheque-report',
      'cheque-approval',
      'credit-upfront',
      'orders',
      'order-shipment',
      'order-parcels',
    ].map((k) => client.invalidateQueries({ queryKey: ['admin', k] })),
  );
}
export function CreditClearanceRecovery({
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
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  async function recover(retry = false) {
    if (!e || e.state !== 'unknown' || !writable || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      if (retry) journal.retry(viewerId);
      const raw = await api(
        clearanceBase(e.command.ownerId, e.command.orderId) + '/commands/' + e.command.id,
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
          ? 'در حال ثبت مجوز مالی چکی…'
          : e.state === 'unknown'
            ? 'نتیجهٔ مجوز مالی چکی مشخص نیست'
            : e.state === 'done'
              ? 'رسید مجوز مالی چکی'
              : 'مجوز مالی ثبت نشد'}
      </h2>
      <p>
        شناسهٔ پیگیری: <bdi>{e.command.id}</bdi>
      </p>
      <ErrorBox error={error} />
      {e.state === 'unknown' && (
        <>
          <p>
            ابتدا رسید همین شناسه را بررسی کنید؛ تلاش دوباره همان نسخه و بازبینی را نگه می‌دارد.
          </p>
          <button disabled={busy || !writable} onClick={() => void recover()}>
            بررسی رسید همین مجوز مالی
          </button>
          <button disabled={busy || !writable} onClick={() => void recover(true)}>
            تلاش دوبارهٔ همان مجوز مالی
          </button>
        </>
      )}
      {e.result && (
        <p>
          {e.result.event.summary.state === 'Approved' ? 'تأیید' : 'ابطال'} مالی، رویداد{' '}
          {e.result.event.summary.sequence.toLocaleString('fa-IR')} ·{' '}
          {at(e.result.event.summary.recordedAt)}.{' '}
          {e.result.initialCommit
            ? 'تعهد اولیهٔ موجودی انجام شد.'
            : 'تعهد موجودی دوباره انجام نشد.'}{' '}
          این رسید تاریخی است؛ اعتبار جاری را بازخوانی کنید.
        </p>
      )}
      {['done', 'rejected'].includes(e.state) && (
        <button onClick={() => journal.clear(viewerId)}>بستن نتیجهٔ مجوز مالی</button>
      )}
      <small>فرمان فقط در حافظهٔ همین نشست است؛ گزارش دستی، تأیید بانکی نیست.</small>
    </section>
  ) : null;
}
export function AdminCreditClearance({
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
    [action, setAction] = useState<'Approve' | 'Revoke' | ''>(''),
    [note, setNote] = useState(''),
    [partialAck, setPartialAck] = useState(false),
    [before, setBefore] = useState<number | null>(null),
    [review, setReview] = useState<ClearanceCommand | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const base = clearanceBase(ownerId, orderId),
    page = useQuery({
      queryKey: ['admin', 'credit-clearance', viewerId, ownerId, orderId],
      queryFn: async ({ signal }) => {
        const p = clearancePageSchema.parse(await api(base, { signal }));
        if (authority !== adminViewRevision() || p.orderId !== orderId)
          throw Error('دسترسی یا سفارش تغییر کرد.');
        return p;
      },
      refetchOnWindowFocus: false,
    });
  const history = useQuery({
    queryKey: ['admin', 'credit-clearance', viewerId, ownerId, orderId, 'history', before],
    queryFn: async ({ signal }) => {
      const h = clearanceHistorySchema.parse(
        await api(base + '/history' + (before ? '?beforeSequence=' + before : ''), { signal }),
      );
      if (authority !== adminViewRevision() || h.orderId !== orderId)
        throw Error('دسترسی یا سفارش تغییر کرد.');
      return h;
    },
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    setAction('');
    setNote('');
    setPartialAck(false);
    setReview(null);
    setConfirmed(false);
  }, [page.data?.orderVersion, page.data?.evidenceFingerprint, page.data?.current?.version]);
  useEffect(() => () => journal.interrupt(), []);
  useEffect(() => {
    if (!action && !note && !unresolved) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [action, note, unresolved]);
  function preview(e: React.FormEvent) {
    e.preventDefault();
    setConfirmed(false);
    setError(undefined);
    try {
      if (
        !page.data ||
        page.isError ||
        page.isFetching ||
        !action ||
        authority !== adminViewRevision()
      )
        throw Error();
      setReview(
        clearanceCommandSchema.parse({
          id: crypto.randomUUID().replaceAll('-', ''),
          ownerId,
          orderId,
          body: clearanceBodySchema.parse({
            action,
            orderVersion: page.data.orderVersion,
            version: page.data.current?.version ?? null,
            previewFingerprint: page.data.previewFingerprint,
            note: note.trim(),
            confirmed: true,
            ...(partialAck ? { acknowledgedPartialDispatch: true } : {}),
          }),
          previewSnapshot: page.data,
        }),
      );
    } catch {
      setError(Error('عملیات مجاز، توضیح و آخرین بازبینی مالی همین سفارش را بررسی کنید.'));
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
    setBusy(true);
    setError(undefined);
    try {
      journal.begin(viewerId, review);
      const raw = await api(base + '/commands/' + review.id, {
        method: 'POST',
        body: JSON.stringify(review.body),
      });
      if (journal.finish(viewerId, review, raw)) {
        setReview(null);
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
  const p = page.isError ? undefined : page.data,
    disabled = busy || unresolved || !writable || page.isError || page.isFetching;
  return (
    <section className="credit-upfront-panel">
      <div className="section-heading">
        <h2>مجوز نهایی مالی چکی</h2>
        <button
          disabled={busy || unresolved || page.isFetching}
          onClick={() => void invalidate(client)}
        >
          بازخوانی مجوز مالی
        </button>
      </div>
      <p>
        ارسال به دریافت پیش‌پرداخت و تأیید دستی همهٔ چک‌ها وابسته است. تأیید نهایی اول، موجودی همان
        سفارش را متعهد می‌کند؛ ثبت خروج بسته در انبار مرحلهٔ جداست. تأیید یا ابطال این مجوز، تراکنش
        بانکی یا بازپرداخت نیست.
      </p>
      <ErrorBox error={error ?? page.error ?? history.error} />
      {p && (
        <>
          <p className="notice" role="status">
            {page.isFetching
              ? 'در حال بازخوانی اعتبار مجوز مالی…'
              : p.effective
                ? 'مجوز مالی معتبر برای شواهد جاری ثبت شده است.'
                : p.current
                  ? 'مجوز مالی باطل شده یا شواهد آن تغییر کرده است؛ آماده‌سازی و ارسال نیازمند بازبینی معتبر است.'
                  : 'هنوز مجوز نهایی مالی ثبت نشده است.'}
          </p>
          <Evidence value={p} />
          {p.shipmentState === 'dispatched' && p.reservationState === 'Allocated' && (
            <p className="notice">
              بخشی از سفارش از انبار خارج شده است. این بررسی فقط مجوز ارسال مانده را تغییر می‌دهد؛
              کالاهای ارسال‌شده، پیش‌پرداخت و تعهد موجودی برنمی‌گردند.
            </p>
          )}
          {p.blockers.length > 0 && (
            <ul>
              {p.blockers.map((b) => (
                <li key={b}>{reasons[b]}</li>
              ))}
            </ul>
          )}
          {writable && (
            <form onSubmit={preview}>
              <fieldset disabled={disabled}>
                <Field label="عملیات مجوز مالی چکی">
                  <select
                    value={action}
                    required
                    onChange={(e) => setAction(e.target.value as typeof action)}
                  >
                    <option value="">انتخاب کنید</option>
                    <option value="Approve" disabled={!p.canApprove}>
                      {p.current ? 'تأیید دوبارهٔ شواهد جاری' : 'تأیید اولیه و تعهد موجودی'}
                    </option>
                    <option value="Revoke" disabled={!p.canRevoke}>
                      {p.shipmentState === 'dispatched'
                        ? 'ابطال مجوز ارسال مانده'
                        : 'ابطال مجوز پیش از ارسال'}
                    </option>
                  </select>
                </Field>
                <Field label="توضیح خصوصی بررسی مالی">
                  <textarea
                    maxLength={500}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    required
                  />
                </Field>
                {p.shipmentState === 'dispatched' && p.reservationState === 'Allocated' && (
                  <Check
                    label="خروج بخشی از سفارش را بررسی کردم؛ این فرمان فقط مجوز ارسال مانده را تغییر می‌دهد"
                    checked={partialAck}
                    onChange={(e) => setPartialAck(e.target.checked)}
                  />
                )}
                <button type="submit" disabled={!action}>
                  بازبینی مجوز مالی چکی
                </button>
              </fieldset>
            </form>
          )}
          <details>
            <summary>تاریخچهٔ مجوزهای مالی</summary>
            {history.data?.items.map((e) => (
              <article key={e.summary.id}>
                {e.acknowledgedPartialDispatch && (
                  <p>بازبینی صریح مجوز مانده پس از خروج بخشی از سفارش</p>
                )}
                <p>
                  {e.summary.state === 'Approved' ? 'تأیید' : 'ابطال'} ·{' '}
                  {e.summary.sequence.toLocaleString('fa-IR')} · {at(e.summary.recordedAt)}
                </p>
                <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{e.note}</p>
              </article>
            ))}
            {history.data?.nextBefore && (
              <button
                disabled={busy || unresolved}
                onClick={() => setBefore(history.data!.nextBefore)}
              >
                ۲۰ رویداد بعدی مالی
              </button>
            )}
            {before && (
              <button disabled={busy || unresolved} onClick={() => setBefore(null)}>
                تازه‌ترین رویدادهای مالی
              </button>
            )}
          </details>
        </>
      )}
      {review && (
        <Modal
          title="بازبینی مجوز نهایی مالی چکی"
          onClose={() => {
            if (!busy) setReview(null);
          }}
        >
          <Evidence value={review.previewSnapshot} />
          <p>
            {review.body.action === 'Revoke'
              ? 'مجوز ارسال باطل می‌شود؛ وجه یا موجودی به‌تنهایی برنمی‌گردد.'
              : review.previewSnapshot.current
                ? 'نسخهٔ تازهٔ شواهد مالی تأیید می‌شود؛ موجودی دوباره متعهد نمی‌شود.'
                : 'پس تأیید، موجودی رزروشده متعهد و وضعیت سفارش تأیید مالی چکی می‌شود.'}
          </p>
          <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{review.body.note}</p>
          <Check
            label="پیش‌پرداخت و همهٔ چک‌های این نسخه و اثر عملیات را بازبینی و تأیید کردم"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <button disabled={disabled || !confirmed} onClick={() => void send()}>
            تأیید ثبت مجوز مالی چکی
          </button>
        </Modal>
      )}
    </section>
  );
}
function Evidence({ value: p }: { value: ClearancePage }) {
  return (
    <>
      <dl className="charge-details">
        <dt>پیش‌پرداخت لازم</dt>
        <dd>{money(p.evidence.requiredUpfrontRial)}</dd>
        <dt>گواهی پیش‌پرداخت</dt>
        <dd>
          {p.evidence.upfrontConfirmed ? 'ثبت فعال و مطابق مبلغ سفارش' : 'تأیید فعال لازم است'}
        </dd>
        <dt>چک‌های برنامه</dt>
        <dd>
          {p.evidence.cheques.length.toLocaleString('fa-IR')} سند ·{' '}
          {p.evidence.allChequesApproved ? 'همه تأیید جاری دارند' : 'تأیید همه کامل نیست'}
        </dd>
        <dt>تعهد موجودی</dt>
        <dd>
          {p.reservationState === 'Allocated'
            ? 'متعهدشده'
            : p.reservationState === 'Active'
              ? 'رزرو موقت'
              : p.reservationState}
        </dd>
      </dl>
      <div className="table-wrap">
        <AdminTable>
          <thead>
            <tr>
              <th>چک</th>
              <th>سررسید</th>
              <th>مبلغ</th>
              <th>تأیید نسخهٔ جاری</th>
            </tr>
          </thead>
          <tbody>
            {p.evidence.cheques.map((c) => (
              <tr key={c.sequence}>
                <td>{c.sequence.toLocaleString('fa-IR')}</td>
                <td data-sort-value={c.dueDate}>
                  <bdi>{persianCivilDate(c.dueDate)}</bdi>
                </td>
                <td data-sort-value={c.amountRial}>{money(c.amountRial)}</td>
                <td>{c.approved ? 'معتبر' : 'کامل نیست'}</td>
              </tr>
            ))}
          </tbody>
        </AdminTable>
      </div>
    </>
  );
}
