'use client';
import { advanceRequestGeneration } from '../../lib/data/request-generation';
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import {
  creditDocumentForm,
  creditDocumentPath,
  readCreditDocuments,
  type CreditDocumentCommand,
  type CreditDocumentPage,
  type CreditDocumentDownload,
  type CreditDocumentAttachment,
} from '../../lib/credit/credit-document-contract';
import {
  readCreditCaseRequirements,
  type CreditCaseRequirements,
} from '../../lib/credit/credit-requirements-contract';
import { selectedTicketFile } from '../../lib/support/ticket-file-contract';
import type { CreditDocumentJournal } from '../../lib/credit/credit-document-journal';
import type { CreditApplicationTransport } from './credit-applications-workspace';
const noSubscribe = () => () => {};
export function CreditDocumentsPanel({
  owner,
  applicationId,
  locale,
  transport,
  staff = false,
  journal,
  download,
  refreshToken = 0,
  blocked = false,
}: {
  owner: string;
  applicationId: string;
  locale: 'fa' | 'en';
  transport: CreditApplicationTransport;
  staff?: boolean;
  journal?: CreditDocumentJournal;
  download?: CreditDocumentDownload;
  refreshToken?: number;
  blocked?: boolean;
}) {
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en),
    prefix = staff ? '/api/admin/credit' : '/api/credit',
    path = prefix + '/applications/' + applicationId + '/documents';
  const [page, setPage] = useState<CreditDocumentPage | null>(null),
    [terms, setTerms] = useState<CreditCaseRequirements | null>(null),
    [loading, setLoading] = useState(true),
    [failed, setFailed] = useState(false),
    [refresh, setRefresh] = useState(0),
    [key, setKey] = useState(''),
    [selection, setSelection] = useState<Awaited<ReturnType<typeof selectedTicketFile>> | null>(
      null,
    ),
    [selecting, setSelecting] = useState(false),
    [replace, setReplace] = useState(false),
    [fileError, setFileError] = useState(false),
    [downloading, setDownloading] = useState<string | null>(null);
  const generation = useRef(0),
    selectionGeneration = useRef(0),
    downloadAbort = useRef<AbortController | null>(null),
    mounted = useRef(false),
    fileInput = useRef<HTMLInputElement | null>(null);
  const entryAll = useSyncExternalStore(
      journal?.subscribe ?? noSubscribe,
      () => journal?.snapshot(owner) ?? null,
      () => null,
    ),
    entry = entryAll?.command.applicationId === applicationId ? entryAll : null,
    unresolved = entry?.state === 'pending' || entry?.state === 'unknown';
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      advanceRequestGeneration(selectionGeneration);
      downloadAbort.current?.abort();
    };
  }, []);
  useEffect(() => {
    setDownloading(null);
    return () => {
      downloadAbort.current?.abort();
    };
  }, [owner, applicationId, download, path, prefix]);
  useEffect(() => {
    const current = ++generation.current,
      abort = new AbortController();
    advanceRequestGeneration(selectionGeneration);
    setLoading(true);
    setFailed(false);
    setPage(null);
    setTerms(null);
    setSelection(null);
    setSelecting(false);
    setKey('');
    setReplace(false);
    setFileError(false);
    if (fileInput.current) fileInput.current.value = '';
    void Promise.all([
      transport(path, { signal: abort.signal }),
      transport(prefix + '/applications/' + applicationId + '/requirements', {
        signal: abort.signal,
      }),
    ])
      .then(([files, requirements]) => {
        const p = readCreditDocuments(files, applicationId, staff),
          t = readCreditCaseRequirements(requirements, applicationId);
        if (
          p.application.version !== t.application.version ||
          p.currentConsentId !== (t.consent?.id ?? null)
        )
          throw Error('Credit document view changed');
        if (current === generation.current && !abort.signal.aborted) {
          setPage(p);
          setTerms(t);
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
  }, [owner, applicationId, staff, refresh, refreshToken, transport, path, prefix]);
  const definitions = terms?.consent?.requirements.content.documents ?? [],
    definition = definitions.find((d) => d.key === key),
    current = page?.items.find((i) => i.isCurrent && i.attachment.documentKey === key)?.attachment,
    canUpload =
      !!page?.canUpload && !staff && !!journal && !loading && !failed && !blocked && !unresolved;
  async function choose(file: File | undefined) {
    const revision = ++selectionGeneration.current;
    setSelection(null);
    setFileError(false);
    if (!file) return;
    setSelecting(true);
    try {
      if (
        !definition ||
        file.size > definition.maxBytes ||
        !definition.contentTypes.includes(file.type as (typeof definition.contentTypes)[number])
      )
        throw Error('Document definition mismatch');
      const value = await selectedTicketFile(file);
      if (revision === selectionGeneration.current && mounted.current) setSelection(value);
    } catch {
      if (revision === selectionGeneration.current && mounted.current) setFileError(true);
    } finally {
      if (revision === selectionGeneration.current && mounted.current) setSelecting(false);
    }
  }
  async function send(command: CreditDocumentCommand, bytes?: Blob, retry = false) {
    if (!journal || staff) return;
    let started = false;
    try {
      if (retry) journal.retry(owner);
      else {
        if (!bytes) throw Error('Missing selection');
        journal.begin(owner, command, bytes);
      }
      started = true;
      const body = creditDocumentForm(command, journal.file(owner, command));
      journal.finish(
        owner,
        command,
        await transport(creditDocumentPath(command), { method: 'POST', body }),
      );
      setSelection(null);
      if (fileInput.current) fileInput.current.value = '';
    } catch (error) {
      if (started) {
        const e = error as { status?: number; code?: string };
        journal.fail(owner, command, e.status ?? 0, e.code ?? 'private_file_unavailable');
      }
    }
  }
  async function receipt() {
    if (!journal || staff || entry?.state !== 'unknown') return;
    let command: CreditDocumentCommand | undefined;
    try {
      command = journal.retry(owner);
      journal.finish(owner, command, await transport(creditDocumentPath(command)));
    } catch (error) {
      if (command) {
        const e = error as { status?: number; code?: string };
        journal.fail(owner, command, e.status ?? 0, e.code ?? 'private_file_unavailable');
      }
    }
  }
  function upload(e: FormEvent) {
    e.preventDefault();
    if (
      !canUpload ||
      !selection ||
      !definition ||
      !terms?.consent ||
      !page ||
      (current && !replace) ||
      selecting
    )
      return;
    void send(
      {
        id: crypto.randomUUID().replaceAll('-', ''),
        applicationId,
        body: {
          version: page.application.version,
          consentId: terms.consent.id,
          requirementsRevisionId: terms.consent.requirements.id,
          documentKey: definition.key,
          replacesFileId: current?.id ?? null,
        },
        file: selection.metadata,
      },
      selection.blob,
    );
  }
  async function downloadFile(a: CreditDocumentAttachment) {
    if (!download || downloading) return;
    setDownloading(a.id);
    setFileError(false);
    const abort = new AbortController();
    downloadAbort.current = abort;
    try {
      const blob = await download(path + '/files/' + a.id, a.id, a.file, abort.signal);
      if (!mounted.current || abort.signal.aborted || downloadAbort.current !== abort) return;
      const url = URL.createObjectURL(blob),
        anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = a.file.filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      if (mounted.current && !abort.signal.aborted) setFileError(true);
    } finally {
      if (mounted.current && downloadAbort.current === abort) setDownloading(null);
    }
  }
  const date = (at: string) =>
    new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Tehran',
    }).format(new Date(at));
  const blockerText: Record<string, string> = {
    application_approved: text(
      'پرونده تأیید شده است؛ مدارک آن فقط قابل مشاهده‌اند.',
      'The application is approved. Documents are read-only.',
    ),
    application_declined: text(
      'درخواست رد شده است؛ مدارک قبلی در تاریخچه محفوظ‌اند.',
      'The application was declined. Documents remain in history.',
    ),
    application_submitted: text(
      'پرونده ارسال شده است؛ مدارک این نسخه فقط قابل مشاهده‌اند.',
      'This application is submitted. Its documents are read-only.',
    ),
    application_cancelled: text(
      'پرونده لغو شده است؛ مدارک قبلی فقط قابل مشاهده‌اند.',
      'This application is cancelled. Earlier documents remain available to read.',
    ),
    credit_requirements_unavailable: text(
      'شرایط فعال درخواست هنوز منتشر نشده است.',
      'Active application terms have not been published.',
    ),
    credit_current_consent_required: text(
      'برای بارگذاری، ابتدا شرایط جاری را بخوانید و رضایت همان نسخه را ثبت کنید.',
      'Read and accept the current terms before uploading.',
    ),
    private_file_unavailable: text(
      'سرویس نگهداری امن مدارک در این محیط آماده نیست.',
      'Secure document storage is unavailable in this environment.',
    ),
    credit_document_capacity: text(
      'این پرونده به سقف فنی تاریخچهٔ مدارک رسیده است.',
      'This application has reached its document history limit.',
    ),
  };
  return (
    <section className="credit-documents-panel">
      <div className="ticket-heading">
        <h3>{text('مدارک خصوصی پرونده', 'Private application documents')}</h3>
        <button
          type="button"
          disabled={loading || unresolved || blocked}
          onClick={() => setRefresh((n) => n + 1)}
        >
          {text('دریافت مدارک تازه', 'Refresh documents')}
        </button>
      </div>
      {entry && (
        <div className="ticket-command" role={entry.state === 'rejected' ? 'alert' : 'status'}>
          <strong>
            {entry.state === 'done'
              ? text('مدرک به پرونده متصل شد', 'Document attached to the application')
              : entry.state === 'rejected'
                ? text(
                    'مدرک متصل نشد؛ شرایط و وضعیت تازه را بررسی کنید.',
                    'Document rejected. Review the current terms and application.',
                  )
                : text('نتیجهٔ ثبت مدرک هنوز مشخص نیست', 'The document outcome is not confirmed')}
          </strong>
          <p>
            {text('شناسهٔ پیگیری', 'Tracking ID')}: <bdi>{entry.command.id}</bdi>
          </p>
          {entry.state === 'unknown' ? (
            <>
              <p>
                {text(
                  'فایل اصلی فقط تا پایان این نشست در حافظه نگه داشته می‌شود. ابتدا رسید را بررسی کنید.',
                  'The original file stays in memory for this session. Check the receipt first.',
                )}
              </p>
              <div className="ticket-actions">
                <button type="button" onClick={() => void receipt()}>
                  {text('بررسی رسید مدرک', 'Check document receipt')}
                </button>
                <button type="button" onClick={() => void send(entry.command, undefined, true)}>
                  {text('تلاش دوبارهٔ همان مدرک', 'Retry the same document')}
                </button>
              </div>
            </>
          ) : entry.state === 'pending' ? (
            <p>{text('در حال بررسی و ذخیرهٔ فایل…', 'Checking and storing the file…')}</p>
          ) : (
            <button type="button" onClick={() => journal?.clear(owner)}>
              {text('بستن نتیجه', 'Close result')}
            </button>
          )}
        </div>
      )}
      {loading && <p role="status">{text('در حال دریافت مدارک…', 'Loading documents…')}</p>}
      {failed && (
        <p role="alert">
          {text(
            'مدارک خوانده نشدند؛ دوباره دریافت کنید.',
            'Documents could not be loaded. Please refresh.',
          )}
        </p>
      )}
      {fileError && (
        <p role="alert">
          {text(
            'فایل معتبر دریافت نشد. نوع، حجم، اتصال و دسترسی را بررسی کنید.',
            'The file could not be processed. Check its type, size, connection and access.',
          )}
        </p>
      )}
      {page && (
        <>
          {page.blockers.map((b) => (
            <p key={b}>{blockerText[b]}</p>
          ))}
          {page.items.length === 0 && (
            <p>
              {text(
                'هنوز مدرکی به این پرونده متصل نشده است.',
                'No documents have been attached to this application.',
              )}
            </p>
          )}
          {terms?.consent && (
            <>
              <p>
                {text('مدارک مربوط به رضایت', 'Documents for consent')}:{' '}
                <bdi>{terms.consent.id}</bdi>
              </p>
              <ul className="credit-document-checklist">
                {definitions.map((d) => {
                  const file = page.items.find(
                    (i) => i.isCurrent && i.attachment.documentKey === d.key,
                  )?.attachment;
                  return (
                    <li key={d.key}>
                      <strong>{locale === 'fa' ? d.nameFa : d.nameEn}</strong>
                      <span>
                        {d.required ? text('الزامی', 'Required') : text('اختیاری', 'Optional')} ·{' '}
                        {file
                          ? text('متصل به این رضایت', 'Attached to this consent')
                          : text('بارگذاری نشده', 'Not uploaded')}
                      </span>
                      <p>{locale === 'fa' ? d.helpFa : d.helpEn}</p>
                      {file && (
                        <p className="credit-document-filename">
                          {file.file.filename}{' '}
                          <button
                            type="button"
                            disabled={!download || !!downloading}
                            onClick={() => void downloadFile(file)}
                          >
                            {text('دریافت فایل', 'Download file')}
                          </button>
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {!staff && page.canUpload && definitions.length > 0 && (
            <form onSubmit={upload}>
              <label className="ticket-field">
                <span>{text('نوع مدرک این نسخه', 'Document type for this revision')}</span>
                <select
                  value={key}
                  required
                  disabled={!canUpload || selecting}
                  onChange={(e) => {
                    advanceRequestGeneration(selectionGeneration);
                    setKey(e.target.value);
                    setSelection(null);
                    setReplace(false);
                    setFileError(false);
                    if (fileInput.current) fileInput.current.value = '';
                  }}
                >
                  <option value="">{text('مدرک را انتخاب کنید', 'Choose a document')}</option>
                  {definitions.map((d) => (
                    <option key={d.key} value={d.key}>
                      {locale === 'fa' ? d.nameFa : d.nameEn}
                    </option>
                  ))}
                </select>
              </label>
              {definition && (
                <>
                  <p>
                    {text('حداکثر حجم', 'Maximum size')}:{' '}
                    {(definition.maxBytes / 1024).toLocaleString(
                      locale === 'fa' ? 'fa-IR' : 'en-GB',
                      { maximumFractionDigits: 2 },
                    )}{' '}
                    KiB ·{' '}
                    <bdi>
                      {definition.contentTypes
                        .map((t) => (t === 'application/pdf' ? 'PDF' : t.slice(6).toUpperCase()))
                        .join(' / ')}
                    </bdi>
                  </p>
                  <label className="ticket-field">
                    <span>{text('انتخاب فایل خصوصی', 'Choose a private file')}</span>
                    <input
                      ref={fileInput}
                      type="file"
                      accept={definition.contentTypes.join(',')}
                      disabled={!canUpload || selecting}
                      onChange={(e) => void choose(e.target.files?.[0])}
                    />
                  </label>
                  {current && (
                    <label className="credit-check">
                      <input
                        type="checkbox"
                        checked={replace}
                        disabled={!canUpload}
                        onChange={(e) => setReplace(e.target.checked)}
                      />
                      <span>
                        {text(
                          'فایل جاری با حفظ نسخهٔ قبلی در تاریخچه جایگزین شود.',
                          'Replace the current file and retain the earlier version in history.',
                        )}
                      </span>
                    </label>
                  )}
                  {selection && (
                    <p className="credit-document-filename">{selection.metadata.filename}</p>
                  )}
                  <button
                    type="submit"
                    disabled={!canUpload || !selection || selecting || (!!current && !replace)}
                  >
                    {selecting
                      ? text('در حال بررسی فایل…', 'Checking file…')
                      : current
                        ? text('ثبت جایگزین مدرک', 'Attach replacement')
                        : text('ثبت مدرک خصوصی', 'Attach private document')}
                  </button>
                </>
              )}
            </form>
          )}
          {page.items.length > 0 && (
            <details>
              <summary>
                {text('تاریخچهٔ همهٔ فایل‌های پرونده', 'Application file history')} (
                {page.items.length.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-GB')})
              </summary>
              <ul className="credit-document-history">
                {page.items.map(({ attachment: a, isCurrent }) => (
                  <li key={a.id}>
                    <strong className="credit-document-filename">{a.file.filename}</strong>
                    <p>
                      {isCurrent
                        ? text('فایل جاریِ این رضایت', 'Current file for this consent')
                        : text(
                            'نسخهٔ تاریخی؛ به رضایت تازه منتقل نمی‌شود',
                            'Historical file; it does not transfer to new consent',
                          )}{' '}
                      · {date(a.at)}
                    </p>
                    <small>
                      {text('کلید مدرک', 'Document key')}: <bdi>{a.documentKey}</bdi>
                      <br />
                      {text('نسخهٔ شرایط', 'Terms revision')}: <bdi>{a.requirementsRevisionId}</bdi>
                    </small>
                    <button
                      type="button"
                      disabled={!download || !!downloading}
                      onClick={() => void downloadFile(a)}
                    >
                      {downloading === a.id
                        ? text('در حال دریافت…', 'Downloading…')
                        : text('دریافت نسخهٔ خصوصی', 'Download private version')}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="credit-consent-note">
            {text(
              'ثبت مدارک، تأیید اعتبار یا ارسال پرونده برای بررسی نیست.',
              'Attaching documents is not credit approval or submission for review.',
            )}
          </p>
        </>
      )}
    </section>
  );
}
