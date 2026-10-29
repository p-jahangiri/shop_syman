'use client';
import { advanceRequestGeneration } from '../lib/request-generation';
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import {
  creditReviewBodySchema,
  creditReviewCommandPath,
  readCreditReviewCapabilities,
  readCreditReviewDetail,
  readCreditReviewPage,
  type CreditReviewCapabilities,
  type CreditReviewPage,
  type CreditReviewDetail,
  type CreditReviewCommand,
} from '../lib/credit-review-contract';
import type { CreditReviewJournal } from '../lib/credit-review-journal';
import type { CreditApplicationTransport } from './credit-applications-workspace';
import { parseCreditRequestedToman } from '../lib/credit-application-form';
import { parseCreditReviewExpiryUtc } from '../lib/credit-review-form';
import { formatToman } from '../lib/money';
const noSubscribe = () => () => {};
export function CreditReviewPanel({
  owner,
  applicationId,
  locale,
  transport,
  staff = false,
  journal,
  visibleSubmissionId = null,
  refreshToken = 0,
  blocked = false,
}: {
  owner: string;
  applicationId: string;
  locale: 'fa' | 'en';
  transport: CreditApplicationTransport;
  staff?: boolean;
  journal?: CreditReviewJournal;
  visibleSubmissionId?: string | null;
  refreshToken?: number;
  blocked?: boolean;
}) {
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en),
    prefix = staff ? '/api/admin/credit' : '/api/credit',
    path = prefix + '/applications/' + applicationId;
  const [cap, setCap] = useState<CreditReviewCapabilities | null>(null),
    [page, setPage] = useState<CreditReviewPage | null>(null),
    [detail, setDetail] = useState<CreditReviewDetail | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [failed, setFailed] = useState(false),
    [detailBusy, setDetailBusy] = useState(false),
    [detailFailed, setDetailFailed] = useState(false),
    [refresh, setRefresh] = useState(0),
    [outcome, setOutcome] = useState(''),
    [note, setNote] = useState(''),
    [amount, setAmount] = useState(''),
    [until, setUntil] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [invalid, setInvalid] = useState(false);
  const latestResource = useRef<string | null>(null),
    generation = useRef(0),
    detailGeneration = useRef(0),
    entryAll = useSyncExternalStore(
      journal?.subscribe ?? noSubscribe,
      () => journal?.snapshot(owner) ?? null,
      () => null,
    ),
    entry = entryAll?.command.applicationId === applicationId ? entryAll : null,
    unresolved = entry?.state === 'pending' || entry?.state === 'unknown';
  useEffect(() => {
    const current = ++generation.current,
      abort = new AbortController();
    setLoading(true);
    setFailed(false);
    setPage(null);
    setCap(null);
    setOutcome('');
    setNote('');
    setAmount('');
    setUntil('');
    setConfirmed(false);
    setInvalid(false);
    void Promise.all([
      transport(path + '/reviews', { signal: abort.signal }),
      staff ? transport(path + '/review', { signal: abort.signal }) : Promise.resolve(null),
    ])
      .then(([raw, capability]) => {
        const p = readCreditReviewPage(raw, applicationId),
          c = staff ? readCreditReviewCapabilities(capability, applicationId) : null;
        if (current === generation.current && !abort.signal.aborted) {
          setPage(p);
          setCap(c);
          const resource = owner + ':' + applicationId + ':' + (p.items[0]?.id ?? '');
          const changed = latestResource.current !== resource;
          latestResource.current = resource;
          setSelected((previous) =>
            !changed && p.items.some((i) => i.id === previous)
              ? previous
              : (p.items[0]?.id ?? null),
          );
        }
      })
      .catch(() => {
        if (current === generation.current && !abort.signal.aborted) setFailed(true);
      })
      .finally(() => {
        if (current === generation.current && !abort.signal.aborted) setLoading(false);
      });
    return () => {
      advanceRequestGeneration(generation);
      abort.abort();
    };
  }, [owner, applicationId, staff, transport, refreshToken, refresh, path]);
  useEffect(() => {
    const current = ++detailGeneration.current,
      abort = new AbortController();
    setDetail(null);
    setDetailFailed(false);
    setDetailBusy(!!selected);
    if (selected)
      void transport(path + '/reviews/' + selected, { signal: abort.signal })
        .then((raw) => {
          const d = readCreditReviewDetail(raw, applicationId, selected);
          if (current === detailGeneration.current && !abort.signal.aborted) setDetail(d);
        })
        .catch(() => {
          if (current === detailGeneration.current && !abort.signal.aborted) setDetailFailed(true);
        })
        .finally(() => {
          if (current === detailGeneration.current && !abort.signal.aborted) setDetailBusy(false);
        });
    return () => {
      advanceRequestGeneration(detailGeneration);
      abort.abort();
    };
  }, [owner, applicationId, selected, transport, refreshToken, refresh, path]);
  async function send(c: CreditReviewCommand, retry = false) {
    if (!staff || !journal) return;
    let started = false;
    try {
      if (retry) journal.retry(owner);
      else journal.begin(owner, c);
      started = true;
      journal.finish(
        owner,
        c,
        await transport(creditReviewCommandPath(c), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(c.body),
        }),
      );
    } catch (error) {
      if (started) {
        const e = error as { status?: number; code?: string };
        journal.fail(owner, c, e.status ?? 0, e.code ?? 'credit_application_unavailable');
      }
    }
  }
  async function receipt() {
    if (!staff || !journal || entry?.state !== 'unknown') return;
    let c: CreditReviewCommand | undefined;
    try {
      c = journal.retry(owner);
      journal.finish(owner, c, await transport(creditReviewCommandPath(c)));
    } catch (error) {
      if (c) {
        const e = error as { status?: number; code?: string };
        journal.fail(owner, c, e.status ?? 0, e.code ?? 'credit_application_unavailable');
      }
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    if (
      !staff ||
      !journal ||
      !cap?.canReview ||
      cap.submissionId !== visibleSubmissionId ||
      loading ||
      failed ||
      blocked ||
      unresolved ||
      (outcome === 'Approved' && !cap.canApprove)
    )
      return;
    const rial = outcome === 'Approved' ? parseCreditRequestedToman(amount) : null,
      expiry = outcome === 'Approved' ? parseCreditReviewExpiryUtc(until) : null,
      parsed = creditReviewBodySchema.safeParse({
        applicationVersion: cap.application.version,
        submissionId: cap.submissionId,
        outcome,
        locale,
        note: note.trim(),
        approvedAmountRial: rial?.toString() ?? null,
        expiresAt: expiry ?? null,
        reviewConfirmed: confirmed,
      });
    if (
      !parsed.success ||
      (rial !== null && rial !== undefined && rial > BigInt(cap.application.requestedAmountRial))
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    void send({ id: crypto.randomUUID().replaceAll('-', ''), applicationId, body: parsed.data });
  }
  const label = (value: string) =>
      value === 'Approved'
        ? text('تأیید بررسی', 'Approved review')
        : value === 'Declined'
          ? text('رد درخواست', 'Declined')
          : text('برگشت برای اصلاح', 'Returned for changes'),
    date = (value: string) =>
      new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Tehran',
      }).format(new Date(value));
  const blockers: Record<string, string> = {
    credit_review_write_required: text(
      'حساب شما فقط اجازهٔ خواندن پرونده را دارد.',
      'Your account can only read this application.',
    ),
    credit_application_not_submitted: text(
      'فقط پروندهٔ ارسال‌شده و بررسی‌نشده قابل تصمیم‌گیری است.',
      'Only an unreviewed submitted application can receive a decision.',
    ),
    credit_review_capacity: text(
      'سقف فنی تاریخچهٔ بررسی این پرونده پر شده است.',
      'The review history limit has been reached.',
    ),
    private_file_unavailable: text(
      'دسترسی امن فایل‌ها برای تأیید این پرونده آماده نیست.',
      'Secure document access is unavailable for approving this application.',
    ),
  };
  return (
    <section className="credit-review-panel">
      <div className="ticket-heading">
        <h3>{text('نتیجه و تاریخچهٔ بررسی انسانی', 'Human review and decision history')}</h3>
        <button
          type="button"
          disabled={loading || blocked || unresolved}
          onClick={() => setRefresh((n) => n + 1)}
        >
          {text('دریافت نتیجهٔ تازه', 'Refresh review')}
        </button>
      </div>
      {entry && (
        <div className="ticket-command" role={entry.state === 'rejected' ? 'alert' : 'status'}>
          <strong>
            {entry.state === 'done'
              ? text('تصمیم بررسی ثبت شد', 'Review decision recorded')
              : entry.state === 'rejected'
                ? text(
                    'تصمیم ثبت نشد؛ نسخه و مجوز را بررسی کنید.',
                    'Decision rejected. Check the version and permissions.',
                  )
                : text('نتیجهٔ ثبت تصمیم هنوز مشخص نیست', 'The review outcome is not confirmed')}
          </strong>
          <p>
            {text('شناسهٔ پیگیری', 'Tracking ID')}: <bdi>{entry.command.id}</bdi>
          </p>
          {entry.state === 'pending' ? (
            <p>{text('در حال ثبت…', 'Saving…')}</p>
          ) : entry.state === 'unknown' ? (
            <>
              <p>
                {text(
                  'ابتدا رسید را بررسی کنید. تلاش دوباره، همان تصمیم و شناسه را می‌فرستد.',
                  'Check the receipt first. Retry sends the original decision with the same ID.',
                )}
              </p>
              <div className="ticket-actions">
                <button type="button" onClick={() => void receipt()}>
                  {text('بررسی رسید تصمیم', 'Check decision receipt')}
                </button>
                <button type="button" onClick={() => void send(entry.command, true)}>
                  {text('تلاش دوبارهٔ همان تصمیم', 'Retry the same decision')}
                </button>
              </div>
            </>
          ) : (
            <button type="button" onClick={() => journal?.clear(owner)}>
              {text('بستن نتیجه', 'Close result')}
            </button>
          )}
        </div>
      )}
      {loading && <p role="status">{text('در حال دریافت بررسی…', 'Loading reviews…')}</p>}
      {failed && (
        <p role="alert">
          {text(
            'نتیجهٔ بررسی خوانده نشد؛ دوباره دریافت کنید.',
            'Reviews could not be loaded. Refresh and retry.',
          )}
        </p>
      )}
      {cap && (
        <>
          <ul>
            {[...cap.blockers, ...cap.approvalBlockers].map((code) => (
              <li key={code}>{blockers[code]}</li>
            ))}
          </ul>
          {cap.canReview && visibleSubmissionId !== cap.submissionId && (
            <p role="status">
              {text(
                'برای تصمیم، ابتدا نسخهٔ جاریِ ارسال‌شده را در بخش سابقهٔ ارسال انتخاب و دریافت کنید. نسخهٔ تاریخی برای تصمیمِ تازه قابل استفاده نیست.',
                'To decide, select and load the current submission snapshot above. A historical snapshot cannot be used for a new decision.',
              )}
            </p>
          )}
          {cap.canReview && journal && (
            <form onSubmit={submit}>
              <p>
                {text(
                  'تصمیم فقط به نسخهٔ ارسال‌شدهٔ زیر مربوط است. آن نسخه و مدارک را پیش از ثبت بررسی کنید.',
                  'The decision applies only to the following submission. Review its snapshot and documents before recording a decision.',
                )}
              </p>
              <p>
                <bdi>{cap.submissionId}</bdi>
              </p>
              <label className="ticket-field">
                <span>{text('تصمیم صریح بازبین', 'Reviewer decision')}</span>
                <select
                  required
                  value={outcome}
                  disabled={blocked || unresolved}
                  onChange={(e) => {
                    setOutcome(e.target.value);
                    setAmount('');
                    setUntil('');
                    setConfirmed(false);
                  }}
                >
                  <option value="">{text('تصمیم را انتخاب کنید', 'Choose a decision')}</option>
                  <option value="Returned">{label('Returned')}</option>
                  <option value="Declined">{label('Declined')}</option>
                  <option value="Approved" disabled={!cap.canApprove}>
                    {label('Approved')}
                  </option>
                </select>
              </label>
              <label className="ticket-field">
                <span>
                  {text(
                    'دلیل تصمیم — قابل مشاهدهٔ مشتری',
                    'Decision reason — visible to the customer',
                  )}
                </span>
                <textarea
                  required
                  maxLength={2000}
                  value={note}
                  disabled={blocked || unresolved}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              {outcome === 'Approved' && (
                <>
                  <label className="ticket-field">
                    <span>
                      {text('مبلغ تأیید بررسی — تومان', 'Approved review amount — toman')}
                    </span>
                    <input
                      required
                      inputMode="decimal"
                      maxLength={22}
                      value={amount}
                      disabled={blocked || unresolved}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </label>
                  <label className="ticket-field">
                    <span>{text('انقضای تأیید — زمان UTC', 'Approval expiry — UTC time')}</span>
                    <input
                      required
                      type="datetime-local"
                      value={until}
                      disabled={blocked || unresolved}
                      onChange={(e) => setUntil(e.target.value)}
                    />
                  </label>
                  <p>
                    {text(
                      'مبلغ باید مثبت و حداکثر مبلغ درخواستی باشد. انقضا صریح و آینده است؛ این تصمیم هنوز سفارش یا امکان پرداخت ایجاد نمی‌کند.',
                      'Enter a positive amount no greater than the request and an explicit future expiry. This decision does not create an order or enable payment yet.',
                    )}
                  </p>
                </>
              )}
              <label className="credit-check">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={blocked || unresolved}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                <span>
                  {text(
                    'همین نسخهٔ ارسال‌شده را دستی بررسی کردم و ثبت این تصمیم را تأیید می‌کنم.',
                    'I manually reviewed this submission and confirm recording this decision.',
                  )}
                </span>
              </label>
              {invalid && (
                <p role="alert">
                  {text(
                    'تصمیم، دلیل، تأیید صریح و در صورت تأیید، مبلغ و انقضای معتبر را وارد کنید.',
                    'Enter a decision, reason, explicit confirmation and, for approval, a valid amount and expiry.',
                  )}
                </p>
              )}
              <button
                type="submit"
                disabled={
                  blocked ||
                  unresolved ||
                  cap.submissionId !== visibleSubmissionId ||
                  !confirmed ||
                  !outcome ||
                  (outcome === 'Approved' && !cap.canApprove)
                }
              >
                {text('ثبت تصمیم بررسی', 'Record review decision')}
              </button>
            </form>
          )}
        </>
      )}
      {page?.items.length === 0 && (
        <p>
          {text(
            'هنوز تصمیم انسانی برای این پرونده ثبت نشده است.',
            'No human review decision has been recorded.',
          )}
        </p>
      )}
      {page && page.items.length > 0 && (
        <>
          <label className="ticket-field">
            <span>{text('سابقهٔ تصمیم‌ها', 'Decision history')}</span>
            <select
              value={selected ?? ''}
              disabled={blocked || unresolved}
              onChange={(e) => setSelected(e.target.value)}
            >
              {page.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {label(item.outcome)} · {date(item.at)}
                </option>
              ))}
            </select>
          </label>
          {detailBusy && <p role="status">{text('در حال دریافت تصمیم…', 'Loading decision…')}</p>}
          {detailFailed && (
            <p role="alert">
              {text('جزئیات تصمیم خوانده نشد.', 'Decision details could not be loaded.')}
            </p>
          )}
          {detail && (
            <article className="credit-review-decision">
              <h4>{label(detail.review.outcome)}</h4>
              <p>
                {date(detail.review.at)} · <bdi>{detail.review.id}</bdi>
              </p>
              <p>
                {text('نسخهٔ ارسال‌شده', 'Submission snapshot')}:{' '}
                <bdi>{detail.review.submissionId}</bdi>
              </p>
              <p
                lang={detail.review.locale}
                dir={detail.review.locale === 'fa' ? 'rtl' : 'ltr'}
                className="credit-review-note"
              >
                {detail.note}
              </p>
              {detail.review.approvedAmountRial !== null && (
                <>
                  <p>
                    {text('مبلغ تأیید بررسی', 'Approved review amount')}:{' '}
                    {formatToman(detail.review.approvedAmountRial, locale)} {text('تومان', 'toman')}
                  </p>
                  <p>
                    {text('انقضا', 'Expires')}: {date(detail.review.expiresAt!)}
                  </p>
                  <p>
                    {text(
                      'این تأیید، سفارش یا پرداخت نیست. اعتبار و شرایط هنگام اتصال خرید دوباره بررسی می‌شوند.',
                      'This approval is not an order or payment. Validity and terms must be checked when purchase integration is available.',
                    )}
                  </p>
                </>
              )}
              {detail.review.outcome === 'Returned' && (
                <p>
                  {text(
                    'این تصمیم، درخواست اصلاح برای نسخهٔ مشخص‌شده بوده است. پیش از تغییر یا ارسال دوباره، وضعیت فعلی پرونده را بررسی کنید؛ سابقهٔ قبلی حفظ می‌شود.',
                    'Changes were requested for this submission. Check the current application state before making changes or resubmitting. Earlier history is retained.',
                  )}
                </p>
              )}
            </article>
          )}
        </>
      )}
    </section>
  );
}
