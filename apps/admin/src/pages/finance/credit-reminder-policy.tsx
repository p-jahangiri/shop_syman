import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/api';
import { adminViewRevision } from '../../auth/admin-view-authority';
import { adminCreditReminderPolicyJournal as journal } from '../../state/finance/admin-credit-reminder-policy-journal';
import {
  creditReminderPolicyBodySchema,
  creditReminderPolicyCommandSchema,
  creditReminderPolicyCommandPath,
  creditReminderPolicyCurrentSchema,
  creditReminderPolicyHistorySchema,
  parseCreditReminderOffsets,
  type CreditReminderPolicyCommand,
} from '@sayman/web-shared/lib/credit/credit-reminder-policy-contract.ts';
import { Check, ErrorBox, Field, Modal } from '../../components/ui';
const base = '/admin/credit/reminder-policy',
  at = (v: string) =>
    new Intl.DateTimeFormat('fa-IR', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Tehran',
    }).format(new Date(v));
const schedule = (p: { enabled: boolean; dayOffsets: number[]; sendAt: string | null }) =>
  p.enabled
    ? 'روزهای ' +
      p.dayOffsets
        .map((d) =>
          d === 0
            ? 'سررسید'
            : Math.abs(d).toLocaleString('fa-IR') +
              ' روز ' +
              (d < 0 ? 'پیش از سررسید' : 'پس از سررسید'),
        )
        .join('، ') +
      '؛ از ساعت ' +
      p.sendAt +
      ' تهران'
    : 'زمان‌بندی غیرفعال';
async function invalidate(c: ReturnType<typeof useQueryClient>) {
  await Promise.all(
    ['credit-reminder-policy', 'credit-reminder-policy-history'].map((k) =>
      c.invalidateQueries({ queryKey: ['admin', k] }),
    ),
  );
}
export function CreditReminderPolicyRecovery({
  viewerId,
  writable,
}: {
  viewerId: string;
  writable: boolean;
}) {
  const c = useQueryClient(),
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
        creditReminderPolicyCommandPath(e.command),
        retry ? { method: 'POST', body: JSON.stringify(e.command.body) } : {},
      );
      if (journal.finish(viewerId, e.command, raw)) await invalidate(c);
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
    <section className="panel" role="status">
      <h2>
        {e.state === 'unknown'
          ? 'نتیجهٔ تنظیم یادآوری مشخص نیست'
          : e.state === 'pending'
            ? 'در حال ثبت زمان‌بندی یادآوری…'
            : e.state === 'done'
              ? 'رسید تنظیم زمان‌بندی یادآوری'
              : 'تنظیم یادآوری رد شد'}
      </h2>
      <p>
        شناسهٔ پیگیری: <bdi>{e.command.id}</bdi>
      </p>
      <ErrorBox error={error} />
      {e.state === 'unknown' && (
        <>
          <button disabled={busy || !writable} onClick={() => void recover()}>
            بررسی رسید همین تنظیم یادآوری
          </button>
          <button disabled={busy || !writable} onClick={() => void recover(true)}>
            تلاش دوبارهٔ همین تنظیم یادآوری
          </button>
        </>
      )}
      {e.result && (
        <p>
          {schedule(e.result.policy.current!)}. این رسید تاریخی است؛ وضعیت جاری را بازخوانی کنید.
        </p>
      )}
      {['done', 'rejected'].includes(e.state) && (
        <button onClick={() => journal.clear(viewerId)}>بستن نتیجهٔ تنظیم یادآوری</button>
      )}
    </section>
  ) : null;
}
export function CreditReminderPolicy({
  viewerId,
  writable,
  unresolved,
}: {
  viewerId: string;
  writable: boolean;
  unresolved: boolean;
}) {
  const c = useQueryClient(),
    authority = useRef(adminViewRevision()).current,
    [action, setAction] = useState(''),
    [days, setDays] = useState(''),
    [time, setTime] = useState(''),
    [note, setNote] = useState(''),
    [before, setBefore] = useState<number | null>(null),
    [review, setReview] = useState<CreditReminderPolicyCommand | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const page = useQuery({
    queryKey: ['admin', 'credit-reminder-policy', viewerId],
    queryFn: async ({ signal }) => {
      const p = creditReminderPolicyCurrentSchema.parse(await api(base, { signal }));
      if (authority !== adminViewRevision()) throw Error('دسترسی تغییر کرد.');
      return p;
    },
    refetchOnWindowFocus: false,
  });
  const history = useQuery({
    queryKey: ['admin', 'credit-reminder-policy-history', viewerId, before],
    queryFn: async ({ signal }) => {
      const h = creditReminderPolicyHistorySchema.parse(
        await api(base + '/history' + (before ? '?beforeRevision=' + before : ''), { signal }),
      );
      if (authority !== adminViewRevision()) throw Error('دسترسی تغییر کرد.');
      return h;
    },
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    setAction('');
    setDays('');
    setTime('');
    setNote('');
    setReview(null);
    setConfirmed(false);
  }, [page.data?.current?.version]);
  useEffect(() => () => journal.interrupt(), []);
  useEffect(() => {
    if (!action && !days && !time && !note && !unresolved) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [action, days, time, note, unresolved]);
  function preview(e: React.FormEvent) {
    e.preventDefault();
    setConfirmed(false);
    setError(undefined);
    try {
      if (
        !page.data ||
        !['Enable', 'Disable'].includes(action) ||
        authority !== adminViewRevision()
      )
        throw Error();
      const body = creditReminderPolicyBodySchema.parse({
        version: page.data.current?.version ?? null,
        enabled: action === 'Enable',
        dayOffsets: action === 'Enable' ? parseCreditReminderOffsets(days) : [],
        sendAt: action === 'Enable' ? time : null,
        note: note.trim(),
        confirmed: true,
      });
      setReview(
        creditReminderPolicyCommandSchema.parse({
          id: crypto.randomUUID().replaceAll('-', ''),
          body,
          previous: page.data,
        }),
      );
    } catch {
      setError(
        Error(
          'روزهای متمایز، ساعت تهران و توضیح خصوصی را بررسی کنید؛ حداکثر ۳۱ روز در محدودهٔ منفی تا مثبت ۳۶۵.',
        ),
      );
    }
  }
  async function send() {
    if (
      !review ||
      !confirmed ||
      busy ||
      unresolved ||
      !writable ||
      authority !== adminViewRevision()
    )
      return;
    setBusy(true);
    setError(undefined);
    try {
      journal.begin(viewerId, review);
      const raw = await api(creditReminderPolicyCommandPath(review), {
        method: 'POST',
        body: JSON.stringify(review.body),
      });
      if (journal.finish(viewerId, review, raw)) {
        setReview(null);
        setBefore(null);
        await invalidate(c);
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
    <section className="panel credit-upfront-panel">
      <h2>زمان‌بندی یادآوری خصوصی چک‌ها</h2>
      <p>
        اعلان فقط در حساب مشتری ثبت می‌شود. روز منفی پیش از سررسید، صفر روز سررسید و روز مثبت پس از
        آن است. از ساعت انتخابی همان روز ارسال می‌شود؛ ارسال دقیق در آن دقیقه تضمین نمی‌شود و روزهای
        گذشته جبران نمی‌شوند. پیامک و ایمیل فعال نیستند.
      </p>
      <ErrorBox error={error ?? page.error ?? history.error} />
      {p && (
        <>
          {!p.workerEnabled && (
            <p className="notice">
              ارسال خودکار در تنظیمات میزبان خاموش است؛ ذخیرهٔ این برنامه فعلاً اعلانی ارسال
              نمی‌کند.
            </p>
          )}
          <p>
            {p.current
              ? schedule(p.current)
              : 'زمان‌بندی تعیین نشده است؛ یادآوری خودکار ارسال نمی‌شود.'}
          </p>
          {writable && (
            <form onSubmit={preview}>
              <fieldset disabled={disabled}>
                <Field label="عملیات زمان‌بندی یادآوری">
                  <select
                    value={action}
                    required
                    onChange={(e) => {
                      setAction(e.target.value);
                      setDays('');
                      setTime('');
                    }}
                  >
                    <option value="">انتخاب کنید</option>
                    <option value="Enable">فعال‌سازی با روز و ساعت صریح</option>
                    <option value="Disable">غیرفعال‌سازی زمان‌بندی</option>
                  </select>
                </Field>
                {action === 'Enable' && (
                  <>
                    <Field label="روزها نسبت به سررسید — با ویرگول جدا کنید">
                      <input
                        value={days}
                        required
                        maxLength={200}
                        dir="ltr"
                        placeholder="-7, 0, 3"
                        onChange={(e) => setDays(e.target.value)}
                      />
                    </Field>
                    <Field label="از ساعت — منطقهٔ تهران">
                      <input
                        type="time"
                        required
                        step="60"
                        value={time}
                        onInput={(e) => setTime(e.currentTarget.value)}
                      />
                    </Field>
                  </>
                )}
                <Field label="توضیح خصوصی تغییر زمان‌بندی">
                  <textarea
                    value={note}
                    required
                    maxLength={500}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </Field>
                <button type="submit">بازبینی تنظیم زمان‌بندی</button>
              </fieldset>
            </form>
          )}
          <button disabled={busy || unresolved} onClick={() => void invalidate(c)}>
            بازخوانی زمان‌بندی
          </button>
          <details>
            <summary>تاریخچهٔ زمان‌بندی یادآوری</summary>
            {history.data?.items.map((r) => (
              <article key={r.id}>
                <p>
                  نسخهٔ {r.revision.toLocaleString('fa-IR')} · {at(r.at)}
                </p>
                <p>{schedule(r)}</p>
                <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.note}</p>
              </article>
            ))}
            {history.data?.nextBefore && (
              <button
                disabled={busy || unresolved}
                onClick={() => setBefore(history.data!.nextBefore)}
              >
                ۲۰ تنظیم قدیمی‌تر
              </button>
            )}
            {before && (
              <button disabled={busy || unresolved} onClick={() => setBefore(null)}>
                جدیدترین تنظیم‌ها
              </button>
            )}
          </details>
        </>
      )}
      {review && (
        <Modal
          title="بازبینی زمان‌بندی یادآوری چک"
          preventClose={busy || unresolved}
          onClose={() => setReview(null)}
        >
          <p>{schedule(review.body)}</p>
          {!review.previous.workerEnabled && <p>میزبان فعلاً ارسال خودکار را خاموش کرده است.</p>}
          <p>
            هر چک در هر روز تهران حداکثر یک اعلان، شامل ارسال دستی و خودکار، می‌گیرد. این تنظیم وجه
            یا تأیید بانکی ثبت نمی‌کند و اعلان قبلی را تغییر نمی‌دهد.
          </p>
          <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{review.body.note}</p>
          <Check
            label="روزها و ساعت تهران و اثر این تغییر را بازبینی و تأیید کردم"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <button disabled={disabled || !confirmed} onClick={() => void send()}>
            تأیید ثبت زمان‌بندی یادآوری
          </button>
        </Modal>
      )}
    </section>
  );
}
