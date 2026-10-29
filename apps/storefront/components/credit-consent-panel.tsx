'use client';
import { advanceRequestGeneration } from '../lib/request-generation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  readCreditCaseRequirements,
  creditRequirementsCommandPath,
  type CreditCaseRequirements,
  type CreditRequirementsCommand,
  type CreditRequirementsRevision,
  type CreditRequirementsContent,
} from '../lib/credit-requirements-contract';
import type { CreditRequirementsJournal } from '../lib/credit-requirements-journal';
import type { CreditApplicationTransport } from './credit-applications-workspace';
const noSubscribe = () => () => {};
export function CreditConsentPanel({
  owner,
  applicationId,
  locale,
  transport,
  staff = false,
  journal,
  refreshToken = 0,
  blocked = false,
}: {
  owner: string;
  applicationId: string;
  locale: 'fa' | 'en';
  transport: CreditApplicationTransport;
  staff?: boolean;
  journal?: CreditRequirementsJournal;
  refreshToken?: number;
  blocked?: boolean;
}) {
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en),
    prefix = staff ? '/api/admin/credit' : '/api/credit';
  const [value, setValue] = useState<CreditCaseRequirements | null>(null),
    [loading, setLoading] = useState(true),
    [failed, setFailed] = useState(false),
    [refresh, setRefresh] = useState(0),
    [accepted, setAccepted] = useState(false);
  const generation = useRef(0),
    entryAll = useSyncExternalStore(
      journal?.subscribe ?? noSubscribe,
      () => journal?.snapshot(owner) ?? null,
      () => null,
    ),
    entry =
      entryAll?.command.kind === 'consent' && entryAll.command.applicationId === applicationId
        ? entryAll
        : null,
    unresolved = entry?.state === 'pending' || entry?.state === 'unknown';
  useEffect(() => {
    if (entry?.state === 'done') setRefresh((n) => n + 1);
  }, [entry?.state, entry?.command.id]);
  useEffect(() => {
    const current = ++generation.current,
      abort = new AbortController();
    setLoading(true);
    setFailed(false);
    setAccepted(false);
    setValue(null);
    void transport(prefix + '/applications/' + applicationId + '/requirements', {
      signal: abort.signal,
    })
      .then((raw) => {
        const result = readCreditCaseRequirements(raw, applicationId);
        if (current === generation.current && !abort.signal.aborted) setValue(result);
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
  }, [owner, applicationId, staff, refresh, refreshToken, transport, prefix]);
  async function send(command: CreditRequirementsCommand, retry = false) {
    if (!journal || staff || command.kind !== 'consent') return;
    let started = false;
    try {
      if (retry) journal.retry(owner);
      else journal.begin(owner, command);
      started = true;
      const raw = await transport(creditRequirementsCommandPath(command), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command.body),
      });
      journal.finish(owner, command, raw);
    } catch (error) {
      if (started) {
        const e = error as { status?: number; code?: string };
        journal.fail(owner, command, e.status ?? 0, e.code ?? 'credit_application_unavailable');
      }
    }
  }
  async function receipt() {
    if (!journal || staff || entry?.state !== 'unknown') return;
    let command: CreditRequirementsCommand | undefined;
    try {
      command = journal.retry(owner);
      journal.finish(owner, command, await transport(creditRequirementsCommandPath(command)));
    } catch (error) {
      if (command) {
        const e = error as { status?: number; code?: string };
        journal.fail(owner, command, e.status ?? 0, e.code ?? 'credit_application_unavailable');
      }
    }
  }
  function consent() {
    if (
      staff ||
      !journal ||
      !accepted ||
      loading ||
      failed ||
      unresolved ||
      blocked ||
      !value?.canConsent ||
      !value.current.version ||
      !value.current.published
    )
      return;
    void send({
      kind: 'consent',
      id: crypto.randomUUID().replaceAll('-', ''),
      applicationId,
      body: {
        applicationVersion: value.application.version,
        requirementsRevisionId: value.current.published.id,
        requirementsVersion: value.current.version,
        locale,
        accepted: true,
      },
    });
  }
  const current = value?.current.published,
    prior = value?.consent;
  return (
    <section className="credit-consent-panel">
      <div className="ticket-heading">
        <h3>{text('شرایط و رضایت درخواست', 'Application terms and consent')}</h3>
        <button
          type="button"
          disabled={loading || unresolved || blocked}
          onClick={() => setRefresh((n) => n + 1)}
        >
          {text('دریافت شرایط تازه', 'Refresh terms')}
        </button>
      </div>
      {entry && (
        <div className="ticket-command" role={entry.state === 'rejected' ? 'alert' : 'status'}>
          <strong>
            {entry.state === 'done'
              ? text(
                  'رضایت به نسخهٔ انتخاب‌شده ثبت شد',
                  'Consent to the selected revision was recorded',
                )
              : entry.state === 'rejected'
                ? text(
                    'رضایت ثبت نشد؛ نسخهٔ تازهٔ پرونده و شرایط را بررسی کنید.',
                    'Consent was rejected. Review the current application and terms.',
                  )
                : text('نتیجهٔ ثبت رضایت هنوز مشخص نیست', 'The consent outcome is not confirmed')}
          </strong>
          <p>
            {text('شناسهٔ پیگیری', 'Tracking ID')}: <bdi>{entry.command.id}</bdi>
          </p>
          {entry.state === 'unknown' ? (
            <div className="ticket-actions">
              <button type="button" onClick={() => void receipt()}>
                {text('بررسی رسید رضایت', 'Check consent receipt')}
              </button>
              <button type="button" onClick={() => void send(entry.command, true)}>
                {text('تلاش دوبارهٔ همان رضایت', 'Retry the same consent')}
              </button>
            </div>
          ) : entry.state === 'pending' ? (
            <p>{text('در حال ثبت…', 'Saving…')}</p>
          ) : (
            <button type="button" onClick={() => journal?.clear(owner)}>
              {text('بستن نتیجه', 'Close result')}
            </button>
          )}
        </div>
      )}
      {loading && <p role="status">{text('در حال دریافت شرایط…', 'Loading terms…')}</p>}
      {failed && (
        <p role="alert">
          {text(
            'شرایط خوانده نشد؛ دسترسی و اتصال را بررسی و دوباره تلاش کنید.',
            'Terms could not be loaded. Check access and connection, then retry.',
          )}
        </p>
      )}
      {value && !current && (
        <p>
          {text(
            'هنوز شرایط درخواست و مدارک لازم منتشر نشده است.',
            'Application terms and document requirements have not been published.',
          )}
        </p>
      )}
      {current && (
        <>
          <CreditRequirementsText revision={current} locale={locale} />
          {!current.content.enabled && (
            <p>
              {text(
                'پذیرش شرایط این درخواست فعلاً فعال نیست.',
                'Consent is currently unavailable for these application terms.',
              )}
            </p>
          )}
        </>
      )}
      {prior && (
        <div className="credit-consent-history">
          <p>
            {text('رضایت ثبت‌شده', 'Recorded consent')}:{' '}
            <time dateTime={prior.acceptedAt}>
              {new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: 'Asia/Tehran',
              }).format(new Date(prior.acceptedAt))}
            </time>{' '}
            ·{' '}
            {prior.locale === 'fa'
              ? text('متن فارسی', 'Persian text')
              : text('متن انگلیسی', 'English text')}
          </p>
          <p>
            {text('نسخهٔ تأییدشده', 'Accepted revision')}: <bdi>{prior.requirements.id}</bdi>
          </p>
          {prior.requirements.id !== current?.id ? (
            <p>
              {text(
                'شرایط جاری با نسخهٔ تأییدشده فرق دارد؛ برای ادامه، نسخهٔ تازه را بررسی کنید.',
                'Current terms differ from the accepted revision. Review the new terms before continuing.',
              )}
            </p>
          ) : (
            <p>
              {text(
                'رضایت شما مربوط به همین نسخهٔ شرایط است.',
                'Your consent belongs to this revision of the terms.',
              )}
            </p>
          )}
          <details>
            <summary>
              {text('مشاهدهٔ متن دقیق رضایت ثبت‌شده', 'View the exact recorded consent text')}
            </summary>
            <CreditRequirementsText revision={prior.requirements} locale={prior.locale} />
          </details>
        </div>
      )}
      {!staff && value?.canConsent && current && (
        <>
          <label className="credit-check">
            <input
              type="checkbox"
              checked={accepted}
              disabled={loading || failed || unresolved || blocked}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            <span>
              {locale === 'fa' ? current.content.consentLabelFa : current.content.consentLabelEn}
            </span>
          </label>
          <button
            type="button"
            disabled={!accepted || loading || failed || unresolved || blocked}
            onClick={consent}
          >
            {text('ثبت رضایت به این نسخه', 'Record consent to this revision')}
          </button>
        </>
      )}
      {value && (
        <p className="credit-consent-note">
          {text(
            'ثبت رضایت، تأیید اعتبار، ارسال برای بررسی یا ثبت سفارش نیست.',
            'Recording consent is not credit approval, submission for review or an order.',
          )}
        </p>
      )}
    </section>
  );
}
export function CreditRequirementsText({
  revision,
  locale,
}: {
  revision: CreditRequirementsRevision;
  locale: 'fa' | 'en';
}) {
  return (
    <>
      <p>
        {locale === 'fa' ? 'شناسهٔ نسخه' : 'Revision ID'}: <bdi>{revision.id}</bdi>
      </p>
      <CreditRequirementsCopy content={revision.content} locale={locale} />
    </>
  );
}
export function CreditRequirementsCopy({
  content: c,
  locale,
}: {
  content: CreditRequirementsContent;
  locale: 'fa' | 'en';
}) {
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  return (
    <div lang={locale} dir={locale === 'fa' ? 'rtl' : 'ltr'} className="credit-requirements-text">
      <h4>{locale === 'fa' ? c.titleFa : c.titleEn}</h4>
      <p className="credit-terms-copy">{locale === 'fa' ? c.termsFa : c.termsEn}</p>
      <h4>{text('مدارک این نسخه', 'Documents for this revision')}</h4>
      {c.documents.length === 0 ? (
        <p>
          {text('مدرکی در این نسخه تعریف نشده است.', 'No documents are defined in this revision.')}
        </p>
      ) : (
        <ul>
          {c.documents.map((d) => (
            <li key={d.key}>
              <strong>{locale === 'fa' ? d.nameFa : d.nameEn}</strong> ·{' '}
              {d.required ? text('الزامی', 'Required') : text('اختیاری', 'Optional')}
              <p>{locale === 'fa' ? d.helpFa : d.helpEn}</p>
              <small>
                {text('حداکثر حجم', 'Maximum size')}:{' '}
                {(d.maxBytes / 1024).toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-GB', {
                  maximumFractionDigits: 2,
                })}{' '}
                {text('کیلوبایت', 'KiB')} ·{' '}
                <bdi>
                  {d.contentTypes
                    .map((t) => (t === 'application/pdf' ? 'PDF' : t.slice(6).toUpperCase()))
                    .join(' / ')}
                </bdi>
              </small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
