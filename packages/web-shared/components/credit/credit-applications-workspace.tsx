'use client';
import { advanceRequestGeneration } from '../../lib/data/request-generation';
import { customerCreditOrderJournal } from '../../lib/credit/credit-order-journal';
import { CreditPurchaseScopePanel } from './credit-purchase-scope-panel';
import type { CreditScopeJournal } from '../../lib/credit/credit-purchase-scope-journal';
import { CreditReviewPanel } from './credit-review-panel';
import type { CreditReviewExpiryField } from './credit-review-panel';
import type { CreditReviewJournal } from '../../lib/credit/credit-review-journal';
import { CreditSubmissionPanel } from './credit-submission-panel';
import type { CreditSubmissionJournal } from '../../lib/credit/credit-submission-journal';
import { CreditDocumentsPanel } from './credit-documents-panel';
import type { CreditDocumentJournal } from '../../lib/credit/credit-document-journal';
import type { CreditDocumentDownload } from '../../lib/credit/credit-document-contract';
import { CreditConsentPanel } from './credit-consent-panel';
import type { CreditRequirementsJournal } from '../../lib/credit/credit-requirements-journal';
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  creditPlansSchema,
  creditApplicationCreateSchema,
  readCreditApplicationPage,
  readCreditApplicationDetail,
  creditApplicationCommandPath,
  type CreditApplicationCommand,
  type CreditApplicationPage,
  type CreditApplicationDetail,
  type CreditPlanOptions,
} from '../../lib/credit/credit-application-contract';
import type { CreditApplicationJournal } from '../../lib/credit/credit-application-journal';
import { formatToman } from '../../lib/shared/money';
import { normalizeOrderDigits } from '../../lib/orders/order-form';
import { parseCreditRequestedToman } from '../../lib/credit/credit-application-form';
export type CreditApplicationTransport = (path: string, init?: RequestInit) => Promise<unknown>;
const noSubscribe = () => () => {};
export function CreditApplicationsWorkspace({
  owner,
  locale,
  transport,
  staff = false,
  journal,
  consentJournal,
  documentJournal,
  submissionJournal,
  reviewJournal,
  scopeJournal,
  download,
  recoveryLink,
  reviewExpiryField,
  canCreate = true,
}: {
  owner: string;
  locale: 'fa' | 'en';
  transport: CreditApplicationTransport;
  staff?: boolean;
  journal?: CreditApplicationJournal;
  consentJournal?: CreditRequirementsJournal;
  documentJournal?: CreditDocumentJournal;
  submissionJournal?: CreditSubmissionJournal;
  reviewJournal?: CreditReviewJournal;
  scopeJournal?: CreditScopeJournal;
  download?: CreditDocumentDownload;
  recoveryLink?: import('react').ReactNode;
  reviewExpiryField?: CreditReviewExpiryField;
  canCreate?: boolean;
}) {
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en),
    prefix = staff ? '/api/admin/credit' : '/api/credit';
  const [page, setPage] = useState<CreditApplicationPage | null>(null),
    [state, setState] = useState(staff ? 'Submitted' : ''),
    [lookup, setLookup] = useState(''),
    [lookupError, setLookupError] = useState(false),
    [refresh, setRefresh] = useState(0),
    [busy, setBusy] = useState(true),
    [failed, setFailed] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [detail, setDetail] = useState<CreditApplicationDetail | null>(null),
    [visibleSubmission, setVisibleSubmission] = useState<{
      applicationId: string;
      id: string;
    } | null>(null),
    [detailBusy, setDetailBusy] = useState(false),
    [detailFailed, setDetailFailed] = useState(false);
  const showSubmission = useCallback(
    (id: string | null) => {
      if (selected) setVisibleSubmission(id ? { applicationId: selected, id } : null);
    },
    [selected],
  );
  const activeSubmission =
    visibleSubmission?.applicationId === selected ? visibleSubmission.id : null;
  const queueHeading = useRef<HTMLHeadingElement | null>(null),
    detailHeading = useRef<HTMLHeadingElement | null>(null),
    hadSelection = useRef(false);
  useEffect(() => {
    if (!staff) return;
    if (selected) detailHeading.current?.focus();
    else if (hadSelection.current) queueHeading.current?.focus();
    hadSelection.current = selected !== null;
  }, [selected, staff]);
  const [plans, setPlans] = useState<CreditPlanOptions | null>(null),
    [plansBusy, setPlansBusy] = useState(false),
    [plansFailed, setPlansFailed] = useState(false),
    [plansRefresh, setPlansRefresh] = useState(0),
    [planId, setPlanId] = useState(''),
    [amount, setAmount] = useState(''),
    [invalid, setInvalid] = useState(false);
  const listGeneration = useRef(0),
    planGeneration = useRef(0),
    detailGeneration = useRef(0),
    listAbort = useRef<AbortController | null>(null),
    planAbort = useRef<AbortController | null>(null),
    detailAbort = useRef<AbortController | null>(null);
  const purchaseEntry = useSyncExternalStore(
      customerCreditOrderJournal.subscribe,
      () => (staff ? null : customerCreditOrderJournal.snapshot(owner)),
      () => null,
    ),
    purchaseUnresolved = purchaseEntry?.state === 'pending' || purchaseEntry?.state === 'unknown';
  const entry = useSyncExternalStore(
      journal?.subscribe ?? noSubscribe,
      () => journal?.snapshot(owner) ?? null,
      () => null,
    ),
    consentEntry = useSyncExternalStore(
      consentJournal?.subscribe ?? noSubscribe,
      () => consentJournal?.snapshot(owner) ?? null,
      () => null,
    ),
    documentEntry = useSyncExternalStore(
      documentJournal?.subscribe ?? noSubscribe,
      () => documentJournal?.snapshot(owner) ?? null,
      () => null,
    ),
    submissionEntry = useSyncExternalStore(
      submissionJournal?.subscribe ?? noSubscribe,
      () => submissionJournal?.snapshot(owner) ?? null,
      () => null,
    ),
    submissionUnresolved =
      submissionEntry?.state === 'pending' || submissionEntry?.state === 'unknown',
    reviewEntry = useSyncExternalStore(
      reviewJournal?.subscribe ?? noSubscribe,
      () => reviewJournal?.snapshot(owner) ?? null,
      () => null,
    ),
    reviewUnresolved = reviewEntry?.state === 'pending' || reviewEntry?.state === 'unknown',
    scopeEntry = useSyncExternalStore(
      scopeJournal?.subscribe ?? noSubscribe,
      () => scopeJournal?.snapshot(owner) ?? null,
      () => null,
    ),
    scopeUnresolved = scopeEntry?.state === 'pending' || scopeEntry?.state === 'unknown',
    unresolved =
      purchaseUnresolved ||
      scopeUnresolved ||
      reviewUnresolved ||
      submissionUnresolved ||
      documentEntry?.state === 'pending' ||
      documentEntry?.state === 'unknown' ||
      entry?.state === 'pending' ||
      entry?.state === 'unknown' ||
      consentEntry?.state === 'pending' ||
      consentEntry?.state === 'unknown';
  const loadPage = useCallback(
    async (
      cursor: string | null,
      replace: boolean,
      generation: number,
      previous: CreditApplicationPage['items'] = [],
    ) => {
      listAbort.current?.abort();
      const abort = new AbortController();
      listAbort.current = abort;
      setBusy(true);
      setFailed(false);
      try {
        const query = new URLSearchParams();
        if (state) query.set('state', state);
        if (cursor) query.set('cursor', cursor);
        const value = readCreditApplicationPage(
          await transport(prefix + '/applications' + (query.size ? '?' + query : ''), {
            signal: abort.signal,
          }),
          state || null,
        );
        if (generation !== listGeneration.current || abort.signal.aborted) return;
        const items = replace ? value.items : [...previous, ...value.items];
        if (new Set(items.map((i) => i.id)).size !== items.length)
          throw Error('Duplicate private application');
        setPage({ ...value, items });
      } catch {
        if (generation === listGeneration.current && !abort.signal.aborted) setFailed(true);
      } finally {
        if (generation === listGeneration.current && !abort.signal.aborted) setBusy(false);
      }
    },
    [state, prefix, transport],
  );
  const loadPlans = useCallback(
    async (
      after: string | null,
      replace: boolean,
      generation: number,
      previous: CreditPlanOptions['items'] = [],
    ) => {
      planAbort.current?.abort();
      const abort = new AbortController();
      planAbort.current = abort;
      setPlansBusy(true);
      setPlansFailed(false);
      try {
        const result = creditPlansSchema.parse(
          await transport(
            '/api/credit/plans' + (after ? '?after=' + encodeURIComponent(after) : ''),
            { signal: abort.signal },
          ),
        );
        if (generation !== planGeneration.current || abort.signal.aborted) return;
        const items = replace ? result.items : [...previous, ...result.items];
        if (new Set(items.map((i) => i.id)).size !== items.length) throw Error('Duplicate plan');
        setPlans({ ...result, items });
      } catch {
        if (generation === planGeneration.current && !abort.signal.aborted) setPlansFailed(true);
      } finally {
        if (generation === planGeneration.current && !abort.signal.aborted) setPlansBusy(false);
      }
    },
    [transport],
  );
  useEffect(() => () => scopeJournal?.interrupt(), [scopeJournal]);
  useEffect(() => {
    if (scopeEntry) {
      setSelected(scopeEntry.command.applicationId);
      if (scopeEntry.state === 'done') setRefresh((n) => n + 1);
    }
  }, [scopeEntry]);
  useEffect(() => () => reviewJournal?.interrupt(), [reviewJournal]);
  useEffect(() => {
    if (reviewEntry) {
      setSelected(reviewEntry.command.applicationId);
      if (reviewEntry.state === 'done') setRefresh((n) => n + 1);
    }
  }, [reviewEntry]);
  useEffect(() => () => submissionJournal?.interrupt(), [submissionJournal]);
  useEffect(() => {
    if (submissionEntry) {
      setSelected(submissionEntry.command.applicationId);
      if (submissionEntry.state === 'done') setRefresh((n) => n + 1);
    }
  }, [submissionEntry]);
  useEffect(() => () => journal?.interrupt(), [journal]);
  useEffect(() => () => documentJournal?.interrupt(), [documentJournal]);
  useEffect(() => {
    if (documentEntry) {
      setSelected(documentEntry.command.applicationId);
      if (documentEntry.state === 'done') setRefresh((n) => n + 1);
    }
  }, [documentEntry]);
  useEffect(() => () => consentJournal?.interrupt(), [consentJournal]);
  useEffect(() => {
    if (consentEntry?.command.kind === 'consent') {
      setSelected(consentEntry.command.applicationId);
      if (consentEntry.state === 'done') setRefresh((n) => n + 1);
    }
  }, [consentEntry]);
  useEffect(() => {
    if (entry?.state === 'done') {
      setSelected(entry.result!.application.id);
      setRefresh((n) => n + 1);
    }
  }, [entry]);
  useEffect(() => {
    if (!unresolved) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unresolved]);

  useEffect(() => {
    const generation = ++listGeneration.current;
    setPage(null);
    void loadPage(null, true, generation);
    return () => {
      advanceRequestGeneration(listGeneration);
      listAbort.current?.abort();
    };
  }, [owner, refresh, loadPage]);

  useEffect(() => {
    if (staff || !canCreate) return;
    const generation = ++planGeneration.current;
    setPlans(null);
    void loadPlans(null, true, generation);
    return () => {
      advanceRequestGeneration(planGeneration);
      planAbort.current?.abort();
    };
  }, [owner, staff, canCreate, plansRefresh, loadPlans]);
  useEffect(() => {
    const generation = ++detailGeneration.current;
    detailAbort.current?.abort();
    setDetail(null);
    setDetailFailed(false);
    if (!selected) {
      setDetailBusy(false);
      return;
    }
    const abort = new AbortController();
    detailAbort.current = abort;
    setDetailBusy(true);
    void transport(prefix + '/applications/' + selected, { signal: abort.signal })
      .then((raw) => {
        const value = readCreditApplicationDetail(raw, selected);
        if (generation === detailGeneration.current && !abort.signal.aborted) setDetail(value);
      })
      .catch(() => {
        if (generation === detailGeneration.current && !abort.signal.aborted) setDetailFailed(true);
      })
      .finally(() => {
        if (generation === detailGeneration.current && !abort.signal.aborted) setDetailBusy(false);
      });
    return () => {
      advanceRequestGeneration(detailGeneration);
      abort.abort();
    };
  }, [owner, prefix, selected, refresh, transport]);
  async function send(command: CreditApplicationCommand, retry = false) {
    if (!journal || staff) return;
    let started = false;
    try {
      if (retry) journal.retry(owner);
      else journal.begin(owner, command);
      started = true;
      const raw = await transport(creditApplicationCommandPath(command), {
        method: command.kind === 'create' ? 'POST' : 'PUT',
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
    if (!journal || entry?.state !== 'unknown' || staff) return;
    let command: CreditApplicationCommand | undefined;
    try {
      command = journal.retry(owner);
      journal.finish(owner, command, await transport(prefix + '/commands/' + command.id));
    } catch (error) {
      if (command) {
        const e = error as { status?: number; code?: string };
        journal.fail(owner, command, e.status ?? 0, e.code ?? 'credit_application_unavailable');
      }
    }
  }
  function create(e: FormEvent) {
    e.preventDefault();
    if (!canCreate || unresolved || staff || plansBusy || plansFailed) return;
    const plan = plans?.items.find((p) => p.id === planId),
      rial = parseCreditRequestedToman(amount),
      parsed = creditApplicationCreateSchema.safeParse({
        planId: plan?.id,
        planVersion: plan?.version,
        requestedAmountRial: rial?.toString(),
        locale,
      });
    if (
      !parsed.success ||
      !plan ||
      rial === undefined ||
      BigInt(plan.minAmountRial ?? '0') > rial ||
      (plan.maxAmountRial !== null && rial > BigInt(plan.maxAmountRial))
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    void send({ kind: 'create', id: crypto.randomUUID().replaceAll('-', ''), body: parsed.data });
  }
  function findApplication(event: FormEvent) {
    event.preventDefault();
    if (!staff || unresolved) return;
    const id = normalizeOrderDigits(lookup).toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(id) || /^0+$/.test(id)) {
      setLookupError(true);
      return;
    }
    setLookupError(false);
    setLookup(id);
    if (selected === id) setRefresh((n) => n + 1);
    else setSelected(id);
  }
  const format = (value: string) =>
      staff
        ? BigInt(value).toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-GB') +
          ' ' +
          text('ریال', 'rial')
        : formatToman(value, locale) + ' ' + text('تومان', 'toman'),
    date = (value: string) =>
      new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR-u-ca-persian' : 'en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Tehran',
      }).format(new Date(value)),
    stateName = (value: string) =>
      value === 'Draft'
        ? text('پیش‌نویس', 'Draft')
        : value === 'Submitted'
          ? text('در انتظار بررسی', 'Submitted for review')
          : value === 'Approved'
            ? text('تأیید بررسی', 'Approved review')
            : value === 'Declined'
              ? text('ردشده', 'Declined')
              : text('لغوشده', 'Cancelled'),
    digits = (value: number) => value.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-GB'),
    percent = (value: number) => {
      const bp = BigInt(value),
        parts = [
          (bp / 100n).toString(),
          (bp % 100n).toString().padStart(2, '0').replace(/0+$/, ''),
        ];
      const rendered = parts[1] ? parts.join('.') : parts[0];
      return locale === 'fa'
        ? rendered.replace(/[0-9]/g, (c) => '۰۱۲۳۴۵۶۷۸۹'[Number(c)]) + '٪'
        : rendered + '%';
    },
    chosen = plans?.items.find((p) => p.id === planId),
    currentDetail = detail?.application.id === selected ? detail : null;
  return (
    <div className={staff ? 'ticket-workspace cheque-application-workspace' : 'ticket-workspace'}>
      {!staff && (
        <p className="credit-workspace-notice">
          {text(
            'پیش‌نویس درخواست چک، تأیید اعتبار یا سفارش نیست و موجودی را رزرو نمی‌کند. ارسال برای بررسی پس از تکمیل شرایط و مدارک فعال می‌شود.',
            'A cheque application draft is not credit approval or an order and does not reserve stock. Submission opens when terms and documents are ready.',
          )}
        </p>
      )}
      {purchaseUnresolved && (
        <p role="status">
          {text(
            'ابتدا نتیجهٔ سفارش چکی در حال ثبت را بررسی کنید.',
            'Resolve the pending cheque order first.',
          )}{' '}
          {recoveryLink}
        </p>
      )}
      <section className="ticket-panel cheque-case-list" hidden={staff && selected !== null}>
        <div className={staff ? 'ticket-heading cheque-case-heading' : 'ticket-heading'}>
          {staff ? (
            <div>
              <h2 ref={queueHeading} tabIndex={-1}>
                {text('صف بررسی پرونده‌ها', 'Application review queue')}
              </h2>
              <p>
                {text(
                  'مدارک و تصمیم را در جزئیات پرونده ببینید. مجوز خرید و مجوز مالی ارسال جداگانه ثبت می‌شوند.',
                  'Review evidence and decisions in the application details. Purchase scope and financial clearance are recorded separately.',
                )}
              </p>
            </div>
          ) : (
            <h2>{text('درخواست‌های چکی من', 'My cheque applications')}</h2>
          )}
          <button
            type="button"
            disabled={busy || unresolved}
            onClick={() => setRefresh((n) => n + 1)}
          >
            {text('دریافت وضعیت تازه', 'Refresh')}
          </button>
        </div>
        {entry && (
          <div className="ticket-command" role={entry.state === 'rejected' ? 'alert' : 'status'}>
            <strong>
              {entry.state === 'done'
                ? text('وضعیت پرونده ثبت شد', 'Application updated')
                : entry.state === 'rejected'
                  ? text(
                      'درخواست پذیرفته نشد؛ طرح و وضعیت تازه را بررسی کنید.',
                      'Request rejected. Check the current plan and status.',
                    )
                  : text('نتیجهٔ درخواست هنوز مشخص نیست', 'The request outcome is not confirmed')}
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
                    'ابتدا رسید را بررسی کنید. تلاش دوباره، همان درخواست و شناسهٔ قبلی را می‌فرستد.',
                    'Check the receipt first. Retry sends the original request with the same ID.',
                  )}
                </p>
                <div className="ticket-actions">
                  <button type="button" onClick={() => void receipt()}>
                    {text('بررسی رسید درخواست', 'Check request receipt')}
                  </button>
                  <button type="button" onClick={() => void send(entry.command, true)}>
                    {text('تلاش دوبارهٔ همان درخواست', 'Retry the same request')}
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
        {staff ? (
          <div className="cheque-case-controls">
            <div
              className="cheque-view-switch cheque-case-queues"
              role="group"
              aria-label={text('صف پرونده‌ها', 'Application queues')}
            >
              {['Submitted', 'Approved', 'Draft', 'Declined', 'Cancelled', ''].map((key) => (
                <button
                  key={key}
                  type="button"
                  disabled={unresolved}
                  aria-pressed={state === key}
                  onClick={() => setState(key)}
                >
                  {key ? stateName(key) : text('همهٔ پرونده‌ها', 'All applications')}
                </button>
              ))}
            </div>
            <form
              className="cheque-case-lookup"
              role="search"
              aria-label={text('یافتن پرونده با شناسه', 'Find an application by ID')}
              onSubmit={findApplication}
              noValidate
            >
              <div className="cheque-case-lookup-line">
                <label className="ticket-field">
                  <span>{text('شناسهٔ دقیق پرونده', 'Exact application ID')}</span>
                  <input
                    type="search"
                    dir="ltr"
                    maxLength={64}
                    value={lookup}
                    disabled={unresolved}
                    aria-invalid={lookupError || undefined}
                    aria-describedby={lookupError ? 'cheque-case-lookup-error' : undefined}
                    onChange={(e) => {
                      setLookup(e.target.value);
                      setLookupError(false);
                    }}
                  />
                </label>
                <button type="submit" disabled={unresolved || !lookup.trim()}>
                  {text('بازکردن پرونده', 'Open application')}
                </button>
              </div>
              {lookupError && (
                <small id="cheque-case-lookup-error" role="alert">
                  {text(
                    'شناسهٔ کامل ۳۲ کاراکتری را وارد کنید.',
                    'Enter the complete 32-character ID.',
                  )}
                </small>
              )}
            </form>
          </div>
        ) : (
          <label className="ticket-field">
            <span>{text('وضعیت درخواست', 'Application state')}</span>
            <select value={state} disabled={unresolved} onChange={(e) => setState(e.target.value)}>
              <option value="">{text('همهٔ وضعیت‌ها', 'All states')}</option>
              <option value="Draft">{text('پیش‌نویس', 'Draft')}</option>
              <option value="Submitted">{text('در انتظار بررسی', 'Submitted for review')}</option>
              <option value="Approved">{text('تأیید بررسی', 'Approved review')}</option>
              <option value="Declined">{text('ردشده', 'Declined')}</option>
              <option value="Cancelled">{text('لغوشده', 'Cancelled')}</option>
            </select>
          </label>
        )}
        {busy && !page && <p role="status">{text('در حال دریافت…', 'Loading…')}</p>}
        {failed && (
          <div role="alert" className="ticket-command">
            <p>
              {text(
                'پرونده‌ها خوانده نشدند؛ دوباره تلاش کنید.',
                'Applications could not be loaded. Please retry.',
              )}
            </p>
            <button
              type="button"
              disabled={busy || unresolved}
              onClick={() => setRefresh((n) => n + 1)}
            >
              {text('تلاش دوباره', 'Try again')}
            </button>
          </div>
        )}
        {page?.items.length === 0 && (!staff || (!busy && !failed)) && (
          <div className={staff ? 'cheque-case-empty' : undefined}>
            {staff ? (
              <div role="status">
                <strong>
                  {state
                    ? text('پرونده‌ای در این صف نیست', 'No applications in this queue')
                    : text('هنوز پرونده‌ای ثبت نشده است', 'No applications have been recorded')}
                </strong>
                {state && (
                  <p>
                    {text(
                      'صف دیگری را انتخاب کنید یا پرونده را با شناسهٔ کامل باز کنید.',
                      'Choose another queue or open an application using its complete ID.',
                    )}
                  </p>
                )}
              </div>
            ) : (
              <p>{text('درخواستی در این فهرست نیست.', 'No applications in this list.')}</p>
            )}
            {staff && state && (
              <button type="button" disabled={unresolved} onClick={() => setState('')}>
                {text('نمایش همهٔ پرونده‌ها', 'Show all applications')}
              </button>
            )}
          </div>
        )}
        <ul className={staff ? 'ticket-list cheque-case-results' : 'ticket-list'}>
          {page?.items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                disabled={unresolved}
                aria-current={selected === item.id ? 'page' : undefined}
                onClick={() => setSelected(item.id)}
              >
                <strong>
                  <bdi>{format(item.requestedAmountRial)}</bdi>
                </strong>
                <span>
                  {staff ? (
                    <>
                      <span
                        className="cheque-status"
                        data-tone={item.state === 'Submitted' ? 'attention' : 'neutral'}
                      >
                        {stateName(item.state)}
                      </span>{' '}
                      <time dateTime={item.createdAt}>{date(item.createdAt)}</time>
                    </>
                  ) : (
                    stateName(item.state) + ' · ' + date(item.createdAt)
                  )}
                </span>
                <small>
                  <bdi>{item.id}</bdi>
                </small>
              </button>
            </li>
          ))}
        </ul>
        {page?.nextCursor && (
          <button
            type="button"
            disabled={busy || unresolved}
            onClick={() =>
              void loadPage(page.nextCursor, false, listGeneration.current, page.items)
            }
          >
            {text('۵۰ درخواست بعدی', 'Next 50 applications')}
          </button>
        )}
        {!staff && canCreate && (
          <button
            type="button"
            disabled={unresolved}
            onClick={() => {
              setSelected(null);
              setPlanId('');
              setAmount('');
              setInvalid(false);
            }}
          >
            {text('پیش‌نویس تازه', 'New draft')}
          </button>
        )}
      </section>
      <section className="ticket-panel cheque-case-detail" hidden={staff && selected === null}>
        {selected ? (
          <Fragment key={selected}>
            <div className={staff ? 'ticket-heading cheque-case-heading' : 'ticket-heading'}>
              <h2 ref={staff ? detailHeading : undefined} tabIndex={staff ? -1 : undefined}>
                {text('جزئیات پرونده', 'Application details')}
              </h2>
              <div className="ticket-actions">
                {staff && (
                  <button type="button" disabled={unresolved} onClick={() => setSelected(null)}>
                    {text('بازگشت به پرونده‌ها', 'Back to applications')}
                  </button>
                )}
                <button
                  type="button"
                  disabled={detailBusy || unresolved}
                  onClick={() => setRefresh((n) => n + 1)}
                >
                  {text('تازه‌سازی پرونده', 'Refresh details')}
                </button>
              </div>
            </div>
            <p className="ticket-tracking">
              <bdi>{selected}</bdi>
            </p>
            {detailBusy && (
              <p role="status">{text('در حال دریافت پرونده…', 'Loading application…')}</p>
            )}
            {detailFailed && (
              <p role="alert">
                {text(
                  'پرونده خوانده نشد؛ دسترسی و اتصال را بررسی کنید.',
                  'Application unavailable. Check access and connection.',
                )}
              </p>
            )}
            {currentDetail && (
              <>
                <p>{stateName(currentDetail.application.state)}</p>
                <h3>{locale === 'fa' ? currentDetail.plan.nameFa : currentDetail.plan.nameEn}</h3>
                <dl className="credit-terms">
                  <dt>{text('مبلغ درخواستی', 'Requested amount')}</dt>
                  <dd>{format(currentDetail.application.requestedAmountRial)}</dd>
                  <dt>{text('مدت طرح', 'Plan duration')}</dt>
                  <dd>
                    {digits(currentDetail.plan.months)} {text('ماه', 'months')}
                  </dd>
                  <dt>{text('افزایش مبلغ بخش تأمین‌شده', 'Financed amount markup')}</dt>
                  <dd>
                    <bdi>{percent(currentDetail.plan.markupBasisPoints)}</bdi>
                  </dd>
                  <dt>{text('پیش‌پرداخت طرح', 'Plan down payment')}</dt>
                  <dd>
                    <bdi>{percent(currentDetail.plan.downPaymentBasisPoints)}</bdi>
                  </dd>
                  <dt>{text('فاصلهٔ چک‌ها', 'Cheque interval')}</dt>
                  <dd>
                    {digits(currentDetail.plan.intervalMonths)}{' '}
                    {text('ماه', currentDetail.plan.intervalMonths === 1 ? 'month' : 'months')}
                  </dd>
                </dl>
                <p>
                  {text(
                    'این شرایط از نسخهٔ طرح در زمان ایجاد پیش‌نویس نگه داشته شده‌اند. قیمت کالا، هزینه‌های نهایی و تأیید اعتبار جدا بررسی می‌شوند.',
                    'These terms preserve the plan version selected when the draft was created. Product prices, final charges and credit approval require separate review.',
                  )}
                </p>
                <p>
                  {currentDetail.application.state === 'Approved'
                    ? text(
                        'بررسی پرونده تأیید شده است؛ وضعیت مجوز، سفارش و پرداخت جداگانه پیگیری می‌شود.',
                        'The application review was approved. Purchase scope, order and payment status are tracked separately.',
                      )
                    : currentDetail.application.state === 'Declined'
                      ? text(
                          'درخواست رد شده است؛ دلیل و سابقهٔ تصمیم در ادامه قابل مشاهده است.',
                          'The request was declined. The reason and decision history are shown below.',
                        )
                      : currentDetail.application.state === 'Submitted'
                        ? text(
                            'پرونده برای بررسی ارسال شده؛ هنوز تأیید اعتبار نیست.',
                            'Submitted for review; credit approval is still pending.',
                          )
                        : currentDetail.application.state === 'Cancelled'
                          ? text(
                              'این پرونده لغو شده و سابقهٔ آن محفوظ است.',
                              'This application is cancelled and its history is retained.',
                            )
                          : text(
                              'این پیش‌نویس اکنون در صف بررسی نیست. شرایط و مدارک را برای تکمیل یا ارسال دوباره بررسی کنید.',
                              'This draft is currently outside the review queue. Check its terms and documents before completing or resubmitting it.',
                            )}
                </p>
                {!staff &&
                  (currentDetail.application.state === 'Draft' ||
                    currentDetail.application.state === 'Submitted') && (
                    <button
                      type="button"
                      disabled={unresolved || detailBusy || detailFailed}
                      onClick={() =>
                        void send({
                          kind: 'cancel',
                          id: crypto.randomUUID().replaceAll('-', ''),
                          applicationId: currentDetail.application.id,
                          body: { version: currentDetail.application.version },
                        })
                      }
                    >
                      {currentDetail.application.state === 'Submitted'
                        ? text('انصراف از درخواست بررسی', 'Withdraw review request')
                        : text('لغو پیش‌نویس', 'Cancel draft')}
                    </button>
                  )}
              </>
            )}
            <ApplicationStage
              staff={staff}
              label={text('۱. شرایط و مدارک', '1. Terms and documents')}
            >
              <CreditConsentPanel
                blocked={
                  purchaseUnresolved ||
                  scopeUnresolved ||
                  reviewUnresolved ||
                  submissionUnresolved ||
                  entry?.state === 'pending' ||
                  entry?.state === 'unknown' ||
                  documentEntry?.state === 'pending' ||
                  documentEntry?.state === 'unknown'
                }
                owner={owner}
                applicationId={selected}
                locale={locale}
                transport={transport}
                staff={staff}
                journal={consentJournal}
                refreshToken={refresh}
              />
              <CreditDocumentsPanel
                owner={owner}
                applicationId={selected}
                locale={locale}
                transport={transport}
                staff={staff}
                journal={documentJournal}
                download={download}
                refreshToken={refresh}
                blocked={
                  purchaseUnresolved ||
                  scopeUnresolved ||
                  reviewUnresolved ||
                  submissionUnresolved ||
                  entry?.state === 'pending' ||
                  entry?.state === 'unknown' ||
                  consentEntry?.state === 'pending' ||
                  consentEntry?.state === 'unknown'
                }
              />
            </ApplicationStage>
            <ApplicationStage
              staff={staff}
              label={text('۲. نسخهٔ ارسال‌شده برای بررسی', '2. Submitted evidence')}
              active={currentDetail?.application.state === 'Submitted'}
            >
              <CreditSubmissionPanel
                owner={owner}
                applicationId={selected}
                locale={locale}
                transport={transport}
                staff={staff}
                onSnapshotVisible={staff ? showSubmission : undefined}
                journal={submissionJournal}
                refreshToken={refresh}
                blocked={
                  purchaseUnresolved ||
                  scopeUnresolved ||
                  reviewUnresolved ||
                  entry?.state === 'pending' ||
                  entry?.state === 'unknown' ||
                  consentEntry?.state === 'pending' ||
                  consentEntry?.state === 'unknown' ||
                  documentEntry?.state === 'pending' ||
                  documentEntry?.state === 'unknown'
                }
              />
            </ApplicationStage>
            <ApplicationStage
              staff={staff}
              label={text('۳. تصمیم و تاریخچهٔ بررسی', '3. Decision and review history')}
              active={reviewEntry?.command.applicationId === selected}
            >
              <CreditReviewPanel
                owner={owner}
                applicationId={selected}
                locale={locale}
                transport={transport}
                staff={staff}
                visibleSubmissionId={activeSubmission}
                expiryField={reviewExpiryField}
                journal={reviewJournal}
                refreshToken={refresh}
                blocked={
                  purchaseUnresolved ||
                  scopeUnresolved ||
                  entry?.state === 'pending' ||
                  entry?.state === 'unknown' ||
                  consentEntry?.state === 'pending' ||
                  consentEntry?.state === 'unknown' ||
                  documentEntry?.state === 'pending' ||
                  documentEntry?.state === 'unknown' ||
                  submissionUnresolved
                }
              />
            </ApplicationStage>
            <ApplicationStage
              staff={staff}
              label={text('۴. مجوز خرید', '4. Purchase scope')}
              active={scopeEntry?.command.applicationId === selected}
            >
              <CreditPurchaseScopePanel
                owner={owner}
                applicationId={selected}
                locale={locale}
                transport={transport}
                staff={staff}
                journal={scopeJournal}
                refreshToken={refresh}
                blocked={
                  purchaseUnresolved ||
                  reviewUnresolved ||
                  submissionUnresolved ||
                  entry?.state === 'pending' ||
                  entry?.state === 'unknown' ||
                  consentEntry?.state === 'pending' ||
                  consentEntry?.state === 'unknown' ||
                  documentEntry?.state === 'pending' ||
                  documentEntry?.state === 'unknown'
                }
              />
            </ApplicationStage>
          </Fragment>
        ) : staff ? null : !canCreate ? (
          <p role="status">
            {text(
              'درخواست خرید جدید فعلاً فعال نیست؛ سوابق و پیگیری درخواست‌های قبلی در دسترس‌اند.',
              'New purchases are currently unavailable. Previous applications and tracking remain accessible.',
            )}
          </p>
        ) : (
          <>
            <h2>{text('پیش‌نویس درخواست خرید چکی', 'Cheque application draft')}</h2>
            <p>
              {text(
                'مبلغ موردنیاز و یک طرح فعال را انتخاب کنید. این مبلغ، درخواست شماست و قیمت نهایی سفارش محسوب نمی‌شود.',
                'Choose the amount you need and an active plan. This is your requested amount, not a final order price.',
              )}
            </p>
            <button
              type="button"
              disabled={plansBusy || unresolved}
              onClick={() => setPlansRefresh((n) => n + 1)}
            >
              {text('دریافت طرح‌های تازه', 'Refresh plans')}
            </button>
            {plansBusy && !plans && (
              <p role="status">{text('در حال دریافت طرح‌ها…', 'Loading plans…')}</p>
            )}
            {plansFailed && (
              <p role="alert">
                {text(
                  'طرح‌ها خوانده نشدند؛ دوباره دریافت کنید.',
                  'Plans could not be loaded. Please refresh.',
                )}
              </p>
            )}
            {plans?.items.length === 0 && (
              <p>
                {text(
                  'فعلاً طرح فعالی برای درخواست وجود ندارد.',
                  'No active application plan is available.',
                )}
              </p>
            )}
            <form onSubmit={create}>
              <label className="ticket-field">
                <span>{text('طرح خرید چکی', 'Cheque plan')}</span>
                <select
                  required
                  value={planId}
                  disabled={plansBusy || plansFailed || unresolved}
                  onChange={(e) => {
                    setPlanId(e.target.value);
                    setInvalid(false);
                  }}
                >
                  <option value="">{text('طرح را انتخاب کنید', 'Choose a plan')}</option>
                  {plans?.items.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {locale === 'fa' ? plan.nameFa : plan.nameEn}
                    </option>
                  ))}
                </select>
              </label>
              {plans?.nextCursor && (
                <button
                  type="button"
                  disabled={plansBusy || unresolved}
                  onClick={() =>
                    void loadPlans(plans.nextCursor, false, planGeneration.current, plans.items)
                  }
                >
                  {text('طرح‌های بیشتر', 'More plans')}
                </button>
              )}
              {chosen && (
                <p>
                  {digits(chosen.months)} {text('ماه؛ پیش‌پرداخت', 'months; down payment')}{' '}
                  <bdi>{percent(chosen.downPaymentBasisPoints)}</bdi>؛{' '}
                  {text('افزایش بخش تأمین‌شده', 'financed markup')}{' '}
                  <bdi>{percent(chosen.markupBasisPoints)}</bdi>
                  {chosen.minAmountRial !== null && (
                    <>
                      {' '}
                      · {text('حداقل', 'minimum')} {format(chosen.minAmountRial)}
                    </>
                  )}
                  {chosen.maxAmountRial !== null && (
                    <>
                      {' '}
                      · {text('حداکثر', 'maximum')} {format(chosen.maxAmountRial)}
                    </>
                  )}
                </p>
              )}
              <label className="ticket-field">
                <span>{text('مبلغ درخواستی — تومان', 'Requested amount — toman')}</span>
                <input
                  inputMode="decimal"
                  maxLength={22}
                  required
                  value={amount}
                  disabled={unresolved}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setInvalid(false);
                  }}
                />
              </label>
              {invalid && (
                <p role="alert">
                  {text(
                    'یک طرح تازه و مبلغ مثبت در محدودهٔ همان طرح وارد کنید.',
                    'Choose a current plan and a positive amount within its limits.',
                  )}
                </p>
              )}
              <button
                type="submit"
                disabled={unresolved || plansBusy || plansFailed || !plans?.items.length}
              >
                {text('ذخیرهٔ پیش‌نویس', 'Save draft')}
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}

function ApplicationStage({
  staff,
  label,
  active,
  children,
}: {
  staff: boolean;
  label: string;
  active?: boolean;
  children: ReactNode;
}) {
  return staff ? (
    <details className="cheque-detail-step" open={active || undefined}>
      <summary>{label}</summary>
      {children}
    </details>
  ) : (
    children
  );
}
