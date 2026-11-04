'use client';
import { advanceRequestGeneration } from '../../lib/data/request-generation';
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import {
  creditSubmissionBodySchema,
  creditSubmissionCommandPath,
  readCreditSubmissionCapabilities,
  readCreditSubmissionPage,
  readCreditSubmissionDetail,
  type CreditSubmissionCapabilities,
  type CreditSubmissionPage,
  type CreditSubmissionDetail,
  type CreditSubmissionCommand,
} from '../../lib/credit/credit-submission-contract';
import type { CreditSubmissionJournal } from '../../lib/credit/credit-submission-journal';
import type { CreditApplicationTransport } from './credit-applications-workspace';
import { CreditRequirementsText } from './credit-consent-panel';
const noSubscribe = () => () => {};
export function CreditSubmissionPanel({
  owner,
  applicationId,
  locale,
  transport,
  staff = false,
  journal,
  onSnapshotVisible,
  refreshToken = 0,
  blocked = false,
}: {
  owner: string;
  applicationId: string;
  locale: 'fa' | 'en';
  transport: CreditApplicationTransport;
  staff?: boolean;
  journal?: CreditSubmissionJournal;
  onSnapshotVisible?: (id: string | null) => void;
  refreshToken?: number;
  blocked?: boolean;
}) {
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en),
    prefix = staff ? '/api/admin/credit' : '/api/credit',
    path = prefix + '/applications/' + applicationId;
  const [value, setValue] = useState<CreditSubmissionCapabilities | null>(null),
    [history, setHistory] = useState<CreditSubmissionPage | null>(null),
    [detail, setDetail] = useState<CreditSubmissionDetail | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [refresh, setRefresh] = useState(0),
    [loading, setLoading] = useState(true),
    [failed, setFailed] = useState(false),
    [detailBusy, setDetailBusy] = useState(false),
    [detailFailed, setDetailFailed] = useState(false),
    [requested, setRequested] = useState(false),
    [note, setNote] = useState(''),
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
    setValue(null);
    setHistory(null);
    setLoading(true);
    setFailed(false);
    setRequested(false);
    setNote('');
    setInvalid(false);
    void Promise.all([
      transport(path + '/submission', { signal: abort.signal }),
      transport(path + '/submissions', { signal: abort.signal }),
    ])
      .then(([a, b]) => {
        const c = readCreditSubmissionCapabilities(a, applicationId, staff),
          h = readCreditSubmissionPage(b, applicationId);
        if (current === generation.current && !abort.signal.aborted) {
          setValue(c);
          setHistory(h);
          const resource = owner + ':' + applicationId + ':' + (c.latestSubmission?.id ?? '');
          const changed = latestResource.current !== resource;
          latestResource.current = resource;
          setSelected((previous) =>
            !changed && h.items.some((i) => i.id === previous)
              ? previous
              : (c.latestSubmission?.id ?? h.items[0]?.id ?? null),
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
  }, [owner, applicationId, staff, refresh, refreshToken, transport, path]);
  useEffect(() => {
    const current = ++detailGeneration.current,
      abort = new AbortController();
    setDetail(null);
    onSnapshotVisible?.(null);
    setDetailFailed(false);
    setDetailBusy(!!selected);
    if (selected)
      void transport(path + '/submissions/' + selected, { signal: abort.signal })
        .then((raw) => {
          const d = readCreditSubmissionDetail(raw, applicationId, selected);
          if (current === detailGeneration.current && !abort.signal.aborted) {
            setDetail(d);
            onSnapshotVisible?.(d.submission.id);
          }
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
      onSnapshotVisible?.(null);
    };
  }, [owner, applicationId, selected, refreshToken, refresh, transport, onSnapshotVisible, path]);
  async function send(command: CreditSubmissionCommand, retry = false) {
    if (!journal || staff) return;
    let started = false;
    try {
      if (retry) journal.retry(owner);
      else journal.begin(owner, command);
      started = true;
      journal.finish(
        owner,
        command,
        await transport(creditSubmissionCommandPath(command), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(command.body),
        }),
      );
    } catch (error) {
      if (started) {
        const e = error as { status?: number; code?: string };
        journal.fail(owner, command, e.status ?? 0, e.code ?? 'credit_application_unavailable');
      }
    }
  }
  async function receipt() {
    if (!journal || staff || entry?.state !== 'unknown') return;
    let c: CreditSubmissionCommand | undefined;
    try {
      c = journal.retry(owner);
      journal.finish(owner, c, await transport(creditSubmissionCommandPath(c)));
    } catch (error) {
      if (c) {
        const e = error as { status?: number; code?: string };
        journal.fail(owner, c, e.status ?? 0, e.code ?? 'credit_application_unavailable');
      }
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!value?.canSubmit || !journal || staff || loading || failed || blocked || unresolved)
      return;
    const parsed = creditSubmissionBodySchema.safeParse({
      applicationVersion: value.application.version,
      consentId: value.consentId,
      requirementsRevisionId: value.requirementsRevisionId,
      requirementsVersion: value.requirementsVersion,
      locale,
      note: note.trim(),
      reviewRequested: requested,
    });
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    void send({ id: crypto.randomUUID().replaceAll('-', ''), applicationId, body: parsed.data });
  }
  const blockers: Record<string, string> = {
    application_approved: text(
      'بررسی پرونده تأیید شده؛ ارسال دوباره فعال نیست.',
      'The application review is approved. Resubmission is unavailable.',
    ),
    application_declined: text(
      'درخواست رد شده است؛ دلیل در تاریخچهٔ بررسی آمده است.',
      'The application was declined. See the review history for the reason.',
    ),
    application_cancelled: text(
      'پرونده لغو شده است؛ سابقهٔ ارسال محفوظ است.',
      'The application is cancelled. Submission history is retained.',
    ),
    application_submitted: text(
      'درخواست برای بررسی ارسال شده است؛ هنوز تأیید اعتبار یا سفارش نیست.',
      'Submitted for review. This is not credit approval or an order.',
    ),
    credit_requirements_unavailable: text(
      'شرایط فعال درخواست منتشر نشده است.',
      'Active application terms are unavailable.',
    ),
    credit_current_consent_required: text(
      'ابتدا شرایط جاری را بخوانید و رضایت همان نسخه را ثبت کنید.',
      'Read and accept the current terms first.',
    ),
    credit_plan_changed: text(
      'طرح انتخاب‌شده تغییر کرده یا غیرفعال است؛ پیش‌نویس تازه با طرح جاری بسازید.',
      'The selected plan changed or is disabled. Create a new draft with a current plan.',
    ),
    credit_required_documents_missing: text(
      'مدارک الزامی این رضایت را تکمیل کنید.',
      'Complete the required documents for this consent.',
    ),
    private_file_unavailable: text(
      'نگهداری امن مدارک لازم در این محیط آماده نیست.',
      'Secure storage for the required documents is unavailable.',
    ),
    credit_submission_capacity: text(
      'سقف فنی تاریخچهٔ ارسال این پرونده پر شده است.',
      'The submission history limit has been reached.',
    ),
  };
  const date = (at: string) =>
    new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Tehran',
    }).format(new Date(at));
  return (
    <section className="credit-submission-panel">
      <div className="ticket-heading">
        <h3>{text('ارسال و سابقهٔ بررسی', 'Submit and review history')}</h3>
        <button
          type="button"
          disabled={loading || unresolved || blocked}
          onClick={() => setRefresh((n) => n + 1)}
        >
          {text('دریافت وضعیت ارسال', 'Refresh submission')}
        </button>
      </div>
      {entry && (
        <div className="ticket-command" role={entry.state === 'rejected' ? 'alert' : 'status'}>
          <strong>
            {entry.state === 'done'
              ? text('درخواست برای بررسی ارسال شد', 'Application submitted for review')
              : entry.state === 'rejected'
                ? text(
                    'ارسال پذیرفته نشد؛ وضعیت تازه را بررسی کنید.',
                    'Submission rejected. Review the current application.',
                  )
                : text('نتیجهٔ ارسال هنوز مشخص نیست', 'Submission outcome is not confirmed')}
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
                  'رسید را بررسی کنید؛ تلاش دوباره همان ورودی و شناسه را استفاده می‌کند.',
                  'Check the receipt. Retry uses the original input and tracking ID.',
                )}
              </p>
              <div className="ticket-actions">
                <button type="button" onClick={() => void receipt()}>
                  {text('بررسی رسید ارسال', 'Check submission receipt')}
                </button>
                <button type="button" onClick={() => void send(entry.command, true)}>
                  {text('تلاش دوبارهٔ همان ارسال', 'Retry the same submission')}
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
      {loading && (
        <p role="status">{text('در حال بررسی آمادگی ارسال…', 'Checking submission readiness…')}</p>
      )}
      {failed && (
        <p role="alert">
          {text(
            'وضعیت ارسال خوانده نشد؛ دوباره دریافت کنید.',
            'Submission status could not be loaded. Refresh and retry.',
          )}
        </p>
      )}
      {value && (
        <>
          <ul>
            {value.blockers.map((code) => (
              <li key={code}>{blockers[code]}</li>
            ))}
          </ul>
          {value.missingDocumentKeys.length > 0 && (
            <p>
              {text('کلید مدارک ناقص', 'Missing document keys')}:{' '}
              <bdi>{value.missingDocumentKeys.join('، ')}</bdi>
            </p>
          )}
          {!staff && value.canSubmit && (
            <form onSubmit={submit}>
              <p>
                {text(
                  'با ارسال، همین رضایت و نسخهٔ مدارک برای بررسی نگه‌داری می‌شوند. ارسال هیچ خرید، رزرو یا تأیید اعتباری ایجاد نمی‌کند.',
                  'Submission retains this consent and document revision for review. It does not create a purchase, reservation or credit approval.',
                )}
              </p>
              <label className="ticket-field">
                <span>{text('توضیح اختیاری برای بازبین', 'Optional note for the reviewer')}</span>
                <textarea
                  maxLength={2000}
                  value={note}
                  disabled={blocked || unresolved}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <label className="credit-check">
                <input
                  type="checkbox"
                  checked={requested}
                  disabled={blocked || unresolved}
                  onChange={(e) => setRequested(e.target.checked)}
                />
                <span>
                  {text(
                    'می‌خواهم این پرونده با شرایط و مدارک ثبت‌شده برای بررسی ارسال شود.',
                    'I request review of this application with its recorded terms and documents.',
                  )}
                </span>
              </label>
              {invalid && (
                <p role="alert">
                  {text(
                    'درخواست بررسی را تأیید و متن را بررسی کنید.',
                    'Confirm the review request and check the note.',
                  )}
                </p>
              )}
              <button type="submit" disabled={blocked || unresolved || !requested}>
                {text('ارسال پرونده برای بررسی', 'Submit application for review')}
              </button>
            </form>
          )}
        </>
      )}
      {history && history.items.length === 0 && (
        <p>
          {text(
            'هنوز ارسالی در سابقهٔ این پرونده نیست.',
            'No submissions in this application history.',
          )}
        </p>
      )}
      {history && history.items.length > 0 && (
        <>
          <label className="ticket-field">
            <span>{text('نسخهٔ ارسال‌شده', 'Submission snapshot')}</span>
            <select
              value={selected ?? ''}
              disabled={blocked || unresolved}
              onChange={(e) => setSelected(e.target.value)}
            >
              {history.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {date(item.submittedAt)} · {item.id}
                </option>
              ))}
            </select>
          </label>
          {detailBusy && <p role="status">{text('در حال دریافت سابقه…', 'Loading snapshot…')}</p>}
          {detailFailed && (
            <p role="alert">
              {text('نسخهٔ ارسال‌شده خوانده نشد.', 'Submission snapshot could not be loaded.')}
            </p>
          )}
          {detail && (
            <div className="credit-submission-snapshot">
              <h4>{text('نسخهٔ ثابتِ زمان ارسال', 'Snapshot retained at submission')}</h4>
              <p>
                <bdi>{detail.submission.id}</bdi> · {date(detail.submission.submittedAt)}
              </p>
              <p>
                {text('زبان درخواست بررسی', 'Review request language')}:{' '}
                <bdi>{detail.submission.locale.toUpperCase()}</bdi> ·{' '}
                {text('زبان رضایت', 'Consent language')}:{' '}
                <bdi>{detail.consent.locale.toUpperCase()}</bdi>
              </p>
              {detail.note && <p className="ticket-message-text">{detail.note}</p>}
              <details>
                <summary>
                  {text('شرایط پذیرفته‌شدهٔ همان ارسال', 'Accepted terms for this submission')}
                </summary>
                <CreditRequirementsText
                  revision={detail.consent.requirements}
                  locale={detail.consent.locale}
                />
              </details>
              <ul className="credit-document-history">
                {detail.documents.map((d) => (
                  <li key={d.documentKey}>
                    <strong className="credit-document-filename">{d.file.filename}</strong>
                    <p>
                      {locale === 'fa'
                        ? detail.consent.requirements.content.documents.find(
                            (i) => i.key === d.documentKey,
                          )!.nameFa
                        : detail.consent.requirements.content.documents.find(
                            (i) => i.key === d.documentKey,
                          )!.nameEn}
                    </p>
                    <small>
                      <bdi>{d.attachmentId}</bdi>
                    </small>
                  </li>
                ))}
              </ul>
              <p>
                {text(
                  'فایل‌های همین نسخه از تاریخچهٔ مدارک خصوصی قابل دریافت‌اند.',
                  'Files for this snapshot can be downloaded from the private document history.',
                )}
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
