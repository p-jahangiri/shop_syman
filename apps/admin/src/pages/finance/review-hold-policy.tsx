import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/api';
import { adminViewRevision } from '../../auth/admin-view-authority';
import { adminReviewHoldPolicyJournal as journal } from '../../state/finance/admin-review-hold-policy-journal';
import {
  reviewHoldBodySchema,
  reviewHoldCommandPath,
  reviewHoldCurrentSchema,
  reviewHoldHistorySchema,
  type ReviewHoldBody,
  type ReviewHoldCommand,
} from '@sayman/web-shared/lib/credit/cheque-review-hold-contract.ts';
import { Check, ErrorBox, Field, Modal } from '../../components/ui';
const base = '/admin/credit/review-hold-policy',
  digits = (v: string) =>
    v
      .normalize('NFKC')
      .replace(/[۰-۹٠-٩]/g, (c) =>
        String('۰۱۲۳۴۵۶۷۸۹'.includes(c) ? '۰۱۲۳۴۵۶۷۸۹'.indexOf(c) : '٠١٢٣٤٥٦٧٨٩'.indexOf(c)),
      )
      .trim(),
  at = (v: string) =>
    new Intl.DateTimeFormat('fa-IR', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Tehran',
    }).format(new Date(v));
async function invalidate(client: ReturnType<typeof useQueryClient>) {
  await Promise.all(
    ['review-hold-policy', 'review-hold-policy-history'].map((k) =>
      client.invalidateQueries({ queryKey: ['admin', k] }),
    ),
  );
}
export function ReviewHoldPolicyRecovery({
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
        reviewHoldCommandPath(e.command),
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
        {e.state === 'unknown'
          ? 'نتیجهٔ تنظیم مهلت چکی مشخص نیست'
          : e.state === 'pending'
            ? 'ثبت مهلت چکی در حال انجام است'
            : e.state === 'done'
              ? 'رسید تنظیم مهلت چکی'
              : 'تنظیم مهلت چکی رد شد'}
      </h2>
      <p>
        شناسهٔ پیگیری: <bdi>{e.command.id}</bdi>
      </p>
      <ErrorBox error={error} />
      {e.state === 'unknown' && (
        <>
          <p>ابتدا رسید همین شناسه را بخوانید؛ تلاش دوباره همان فرمان و نسخه را حفظ می‌کند.</p>
          <button disabled={busy || !writable} onClick={() => void recover()}>
            بررسی رسید همین مهلت چکی
          </button>
          <button disabled={busy || !writable} onClick={() => void recover(true)}>
            تلاش دوبارهٔ همان مهلت چکی
          </button>
        </>
      )}
      {e.result && (
        <p>
          نسخهٔ {e.result.policy.current!.revision.toLocaleString('fa-IR')}؛{' '}
          {e.result.policy.current!.enabled
            ? 'فعال با حداکثر ' +
              e.result.policy.current!.minutes!.toLocaleString('fa-IR') +
              ' دقیقه'
            : 'غیرفعال'}
          . این رسید تاریخی است؛ وضعیت جاری را بازخوانی کنید.
        </p>
      )}
      {['done', 'rejected'].includes(e.state) && (
        <button onClick={() => journal.clear(viewerId)}>بستن نتیجهٔ مهلت چکی</button>
      )}
      <small>شناسهٔ فرمان فقط در حافظهٔ همین نشست نگه داشته می‌شود.</small>
    </section>
  ) : null;
}
export function ReviewHoldPolicy({
  viewerId,
  writable,
  unresolved,
}: {
  viewerId: string;
  writable: boolean;
  unresolved: boolean;
}) {
  const client = useQueryClient(),
    authority = useRef(adminViewRevision()).current,
    [action, setAction] = useState<'Enable' | 'Disable' | ''>(''),
    [minutes, setMinutes] = useState(''),
    [before, setBefore] = useState<number | null>(null),
    [review, setReview] = useState<ReviewHoldBody | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const page = useQuery({
    queryKey: ['admin', 'review-hold-policy', viewerId],
    queryFn: async ({ signal }) => {
      const p = reviewHoldCurrentSchema.parse(await api(base, { signal }));
      if (authority !== adminViewRevision()) throw Error('دسترسی تغییر کرد.');
      return p;
    },
    refetchOnWindowFocus: false,
  });
  const history = useQuery({
    queryKey: ['admin', 'review-hold-policy-history', viewerId, before],
    queryFn: async ({ signal }) => {
      const h = reviewHoldHistorySchema.parse(
        await api(base + '/history' + (before ? '?beforeRevision=' + before : ''), { signal }),
      );
      if (authority !== adminViewRevision()) throw Error('دسترسی تغییر کرد.');
      return h;
    },
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    setAction('');
    setMinutes('');
    setReview(null);
    setConfirmed(false);
  }, [page.data?.version]);
  useEffect(() => () => journal.interrupt(), []);
  useEffect(() => {
    if (!action && !minutes && !unresolved) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [action, minutes, unresolved]);
  function preview(e: React.FormEvent) {
    e.preventDefault();
    setConfirmed(false);
    setError(undefined);
    try {
      if (!page.data || !action || authority !== adminViewRevision()) throw Error();
      const value = digits(minutes);
      if (action === 'Enable' && !/^[1-9][0-9]?$/.test(value)) throw Error();
      setReview(
        reviewHoldBodySchema.parse({
          action,
          version: page.data.version,
          minutes: action === 'Enable' ? Number(value) : null,
          confirmed: true,
        }),
      );
    } catch {
      setError(Error('عملیات و مدت صریح ۱ تا ۶۰ دقیقه را بررسی کنید.'));
    }
  }
  async function send() {
    if (
      !review ||
      !confirmed ||
      !writable ||
      busy ||
      unresolved ||
      authority !== adminViewRevision()
    )
      return;
    const command: ReviewHoldCommand = {
      id: crypto.randomUUID().replaceAll('-', ''),
      body: review,
    };
    setBusy(true);
    setError(undefined);
    try {
      journal.begin(viewerId, command);
      const raw = await api(reviewHoldCommandPath(command), {
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
  const p = page.data,
    disabled = busy || unresolved || !writable;
  return (
    <section className="panel credit-upfront-panel">
      <h2>مهلت بررسی سفارش چکی جدید</h2>
      <p>
        مدت را صریح انتخاب کنید. این تنظیم مهلت سفارش‌های ثبت‌شده را تغییر نمی‌دهد؛ دریافت وجه یا
        تأیید چک هم نیست. اعتبار مجوز و سهم کالای توافقی ممکن است مهلت نهایی را کوتاه‌تر کند.
      </p>
      <ErrorBox error={error ?? page.error ?? history.error} />
      {p ? (
        <>
          <p>
            {!p.current
              ? 'مهلت بررسی جداگانه تعیین نشده است؛ مهلت کوتاه محاسبه اعمال می‌شود.'
              : p.current.enabled
                ? 'برای سفارش‌های چکی مجازِ جدید: حداکثر ' +
                  p.current.minutes!.toLocaleString('fa-IR') +
                  ' دقیقه.'
                : 'مهلت بررسی جداگانه غیرفعال است؛ مهلت کوتاه محاسبه اعمال می‌شود.'}
          </p>
          <form onSubmit={preview}>
            <fieldset disabled={disabled}>
              <Field label="عملیات مهلت بررسی چکی">
                <select
                  value={action}
                  required
                  onChange={(e) => {
                    setAction(e.target.value as typeof action);
                    setMinutes('');
                  }}
                >
                  <option value="">انتخاب کنید</option>
                  <option value="Enable">فعال‌سازی با مدت صریح</option>
                  <option value="Disable">غیرفعال‌سازی مهلت جداگانه</option>
                </select>
              </Field>
              {action === 'Enable' && (
                <Field label="حداکثر مهلت بررسی — ۱ تا ۶۰ دقیقه">
                  <input
                    inputMode="numeric"
                    maxLength={4}
                    value={minutes}
                    onChange={(e) => setMinutes(e.target.value)}
                    required
                  />
                </Field>
              )}
              <button type="submit" disabled={!action}>
                بازبینی تنظیم مهلت چکی
              </button>
            </fieldset>
          </form>
          <button disabled={busy || unresolved} onClick={() => void invalidate(client)}>
            بازخوانی مهلت چکی
          </button>
          <details>
            <summary>تاریخچهٔ تنظیم مهلت چکی</summary>
            {history.data?.items.map((r) => (
              <article className="credit-upfront-event" key={r.id}>
                <h3>نسخهٔ {r.revision.toLocaleString('fa-IR')}</h3>
                <p>
                  {r.enabled
                    ? 'فعال؛ حداکثر ' + r.minutes!.toLocaleString('fa-IR') + ' دقیقه'
                    : 'غیرفعال'}{' '}
                  · {at(r.createdAt)}
                </p>
              </article>
            ))}
            {before && <button onClick={() => setBefore(null)}>جدیدترین تنظیم‌ها</button>}
            {history.data?.nextBefore && (
              <button onClick={() => setBefore(history.data!.nextBefore)}>
                تنظیم‌های قدیمی‌تر
              </button>
            )}
          </details>
        </>
      ) : (
        <p role="status">دریافت مهلت بررسی…</p>
      )}
      {review && (
        <Modal
          title="بازبینی مهلت سفارش‌های چکی تازه"
          preventClose={busy || unresolved}
          onClose={() => setReview(null)}
        >
          <p>
            {review.action === 'Enable'
              ? 'حداکثر مهلت بررسی سفارش چکی تازه ' +
                review.minutes!.toLocaleString('fa-IR') +
                ' دقیقه خواهد بود.'
              : 'مهلت جداگانه غیرفعال می‌شود و سفارش‌های تازه از مهلت کوتاه محاسبه پیروی می‌کنند.'}
          </p>
          <p>
            سفارش‌های قبلی و مهلت‌های ثبت‌شدهٔ آن‌ها حفظ می‌شوند. قیمت هنگام ثبت باید معتبر باشد و
            مشتری نسخهٔ همین مهلت را می‌پذیرد.
          </p>
          <Check
            label="اثر این تنظیم بر سفارش‌های چکی جدید را بازبینی و تأیید کردم"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <button disabled={disabled || !confirmed} onClick={() => void send()}>
            تأیید ثبت مهلت چکی
          </button>
        </Modal>
      )}
    </section>
  );
}
