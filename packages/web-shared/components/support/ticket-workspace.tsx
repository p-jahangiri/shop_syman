'use client';
import { advanceRequestGeneration } from '../../lib/data/request-generation';
import { ticketCommandRequest } from '../../lib/support/ticket-command-request';
import {
  selectedTicketFile,
  readTicketAttachments,
  ticketFileCapabilitiesSchema,
  type TicketAttachments,
  type TicketFileCapabilities,
} from '../../lib/support/ticket-file-contract';
import type { TicketDownloadTransport } from '../../lib/support/ticket-file-download';
import { PrivateRealtimeStatus, useRealtimeRefresh } from '../notifications/private-realtime';
import type { PrivateRealtimeClient } from '../../lib/notifications/private-realtime-client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react';
import {
  readTicketPage,
  readTicketDetail,
  readTicketMessages,
  ticketCreateSchema,
  ticketReplySchema,
  ticketCommandPath,
  type TicketCommand,
  type TicketPage,
  type TicketSummary,
  type TicketMessages,
} from '../../lib/support/ticket-contract';
import { TicketJournal } from '../../lib/support/ticket-journal';
import { normalizePersian } from '../../lib/shared/commerce';
export type TicketTransport = (path: string, init?: RequestInit) => Promise<unknown>;
export class TicketRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
const names = {
  Open: ['در انتظار پاسخ فروشگاه', 'Waiting for the store'],
  WaitingCustomer: ['در انتظار پاسخ شما', 'Waiting for your reply'],
  Closed: ['بسته‌شده', 'Closed'],
} as const;
const stateName = (state: keyof typeof names, staff: boolean, locale: 'fa' | 'en') =>
  staff && state === 'WaitingCustomer'
    ? locale === 'fa'
      ? 'در انتظار پاسخ مشتری'
      : 'Waiting for the customer'
    : names[state][locale === 'fa' ? 0 : 1];
const staffStates = ['Open', 'WaitingCustomer', 'Closed', ''] as const;
const queueCopy = {
  Open: ['نیازمند پاسخ', 'Needs reply', 'آخرین اقدام با فروشگاه', 'Store action needed'],
  WaitingCustomer: [
    'منتظر مشتری',
    'Waiting for customer',
    'پاسخ فروشگاه ارسال شده',
    'Store replied',
  ],
  Closed: ['بسته‌شده', 'Closed', 'گفت‌وگوهای خاتمه‌یافته', 'Completed conversations'],
  '': ['همهٔ صف‌ها', 'All queues', 'همهٔ وضعیت‌ها', 'Every state'],
} as const;
const isTicketId = (value: string) => /^[a-f0-9]{32}$/.test(value) && !/^0+$/.test(value);
const isTicketPhoto = (type: string) =>
  type === 'image/jpeg' || type === 'image/png' || type === 'image/webp';
export function TicketWorkspace({
  owner,
  staff = false,
  writable = true,
  locale,
  transport,
  journal,
  initialTicketId,
  onSelect,
  live,
  download,
}: {
  download?: TicketDownloadTransport;
  live?: PrivateRealtimeClient | null;
  owner: string;
  staff?: boolean;
  writable?: boolean;
  locale: 'fa' | 'en';
  transport: TicketTransport;
  journal: TicketJournal;
  initialTicketId?: string;
  onSelect?: (id: string | null) => void;
}) {
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en),
    prefix = staff ? '/api/admin/support' : '/api/support';
  const [selected, setSelected] = useState(initialTicketId ?? null),
    [state, setState] = useState(staff ? 'Open' : ''),
    [search, setSearch] = useState(''),
    [page, setPage] = useState<TicketPage | null>(null),
    [queueSummary, setQueueSummary] = useState<{
      owner: string;
      counts: NonNullable<TicketPage['queueCounts']>;
    } | null>(null),
    [loading, setLoading] = useState(true),
    [failed, setFailed] = useState(false),
    [refresh, setRefresh] = useState(0),
    [subject, setSubject] = useState(''),
    [body, setBody] = useState(''),
    [invalid, setInvalid] = useState(false);
  const generation = useRef(0),
    controller = useRef<AbortController | null>(null);
  const normalizedSearch = normalizePersian(search);
  const compactId = normalizedSearch.replaceAll('-', '');
  const exactId = staff && isTicketId(compactId) ? compactId : undefined;
  const effectiveState = exactId ? '' : state;
  const hasDraft = useRef(false);
  const focusInbox = useRef(false);
  const inboxHeading = useRef<HTMLHeadingElement | null>(null);
  const recordDraft = useCallback((dirty: boolean) => {
    hasDraft.current = dirty;
  }, []);
  const entry = useSyncExternalStore(
      journal.subscribe,
      () => journal.snapshot(owner),
      () => null,
    ),
    unresolved = entry?.state === 'pending' || entry?.state === 'unknown';
  const select = (id: string | null) => {
    if (id === selected) return;
    if (
      staff &&
      hasDraft.current &&
      !window.confirm(text('پاسخ ارسال‌نشده کنار گذاشته شود؟', 'Discard the unsent reply?'))
    )
      return;
    if (staff && !id) focusInbox.current = true;
    if (onSelect) onSelect(id);
    else setSelected(id);
  };
  const load = useCallback(
    async (
      cursor: string | null,
      reset: boolean,
      ticket: number,
      previous: TicketPage['items'] = [],
    ) => {
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      setLoading(true);
      setFailed(false);
      try {
        const query = new URLSearchParams();
        if (effectiveState) query.set('state', effectiveState);
        if (exactId) query.set('ticketId', exactId);
        if (cursor) query.set('cursor', cursor);
        const value = readTicketPage(
          await transport(prefix + '/tickets' + (query.size ? '?' + query : ''), {
            signal: abort.signal,
          }),
          effectiveState || null,
          staff,
          exactId,
        );
        if (ticket !== generation.current || abort.signal.aborted) return;
        const items = reset ? value.items : [...previous, ...value.items];
        if (new Set(items.map((i) => i.id)).size !== items.length) throw Error('Duplicate tickets');
        setPage({ ...value, items });
        if (value.queueCounts) setQueueSummary({ owner, counts: value.queueCounts });
      } catch {
        if (ticket === generation.current && !abort.signal.aborted) setFailed(true);
      } finally {
        if (ticket === generation.current && !abort.signal.aborted) setLoading(false);
      }
    },
    [effectiveState, exactId, owner, prefix, staff, transport],
  );
  useEffect(() => {
    setSelected(initialTicketId ?? null);
  }, [initialTicketId]);
  useEffect(() => {
    if (!selected && focusInbox.current) {
      focusInbox.current = false;
      inboxHeading.current?.focus();
    }
  }, [selected]);
  useEffect(() => () => journal.interrupt(), [journal]);
  useEffect(() => {
    if (entry?.state === 'done') {
      setRefresh((n) => n + 1);
      setBody('');
      setSubject('');
    }
  }, [entry?.state, entry?.command.id]);
  useEffect(() => {
    if (!unresolved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unresolved]);

  useEffect(() => {
    const ticket = ++generation.current;
    setPage(null);
    void load(null, true, ticket);
    return () => {
      advanceRequestGeneration(generation);
      controller.current?.abort();
    };
  }, [owner, refresh, load]);
  async function send(command: TicketCommand, retry = false, attachment?: Blob) {
    if (!writable) return;
    let started = false;
    try {
      if (retry) journal.retry(owner);
      else journal.begin(owner, command, attachment);
      started = true;
      const raw = await transport(
        ticketCommandPath(command),
        ticketCommandRequest(
          command,
          command.kind === 'attachment' ? journal.file(owner, command) : undefined,
        ),
      );
      journal.finish(owner, command, raw);
    } catch (error) {
      const e = error as { status?: number; code?: string };
      if (started) journal.fail(owner, command, e.status ?? 0, e.code ?? 'ticket_unavailable');
    }
  }
  async function receipt() {
    if (!entry || entry.state !== 'unknown' || !writable) return;
    let command: TicketCommand | undefined;
    try {
      command = journal.retry(owner);
      journal.finish(owner, command, await transport(prefix + '/commands/' + command.id));
    } catch (error) {
      if (command) {
        const e = error as { status?: number; code?: string };
        journal.fail(owner, command, e.status ?? 0, e.code ?? 'ticket_unavailable');
      }
    }
  }
  function create(event: FormEvent) {
    event.preventDefault();
    if (unresolved) return;
    const parsed = ticketCreateSchema.safeParse({ subject, body, locale });
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    void send({
      id: crypto.randomUUID().replaceAll('-', ''),
      kind: 'create',
      staff: false,
      body: parsed.data,
    });
  }
  const date = (s: string) =>
    new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Tehran',
    }).format(new Date(s));
  const terms = exactId ? [] : normalizedSearch.split(' ').filter(Boolean);
  const items = page?.items.filter(
    (item) =>
      (!exactId || item.id === exactId) &&
      (!effectiveState || item.state === effectiveState) &&
      terms.every(
        (term) => normalizePersian(item.subject).includes(term) || item.id.includes(term),
      ),
  );
  const counts = queueSummary?.owner === owner ? queueSummary.counts : undefined;
  const queueCounts = counts && {
    Open: counts.open,
    WaitingCustomer: counts.waitingCustomer,
    Closed: counts.closed,
    '': counts.open + counts.waitingCustomer + counts.closed,
  };
  const number = (value: number) => value.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-GB');
  useRealtimeRefresh(live, 'support', () => setRefresh((n) => n + 1), unresolved || loading);
  return (
    <div className="ticket-workspace" data-selected={selected ? 'true' : undefined}>
      <PrivateRealtimeStatus client={live} locale={locale} />
      <section className="ticket-panel ticket-inbox">
        <div className="ticket-heading">
          <h2 ref={inboxHeading} tabIndex={staff ? -1 : undefined}>
            {staff
              ? text('صندوق پشتیبانی', 'Support inbox')
              : text('درخواست‌های پشتیبانی من', 'My support requests')}
          </h2>
          <button type="button" disabled={loading} onClick={() => setRefresh((n) => n + 1)}>
            {text('دریافت وضعیت تازه', 'Refresh')}
          </button>
        </div>
        <p className="ticket-inbox-intro">
          {staff
            ? text(
                'درخواست‌های مشتریان را بررسی و پاسخ دهید. پاسخ شما در همان گفت‌وگوی خصوصی مشتری ثبت می‌شود.',
                'Review and reply to customer requests. Your reply is saved in the customer’s private conversation.',
              )
            : text(
                'پیام‌ها در حساب شما ذخیره می‌شوند و پاسخ‌های ثبت‌شده همین‌جا نمایش داده می‌شوند.',
                'Messages are saved to your account. Recorded replies appear in this conversation.',
              )}
        </p>
        {!staff && (
          <p>
            {text('زمان‌ها به وقت تهران نمایش داده می‌شوند.', 'Times are shown in Tehran time.')}
          </p>
        )}
        {entry &&
          (!writable ? (
            <p className="ticket-command" role="status">
              {text(
                'یک فرمان قبلی محفوظ است؛ برای پیگیری آن مجوز پاسخ‌گویی لازم است.',
                'A previous command is retained. Reply permission is required to recover it.',
              )}
            </p>
          ) : (
            <div className="ticket-command" role={entry.state === 'rejected' ? 'alert' : 'status'}>
              <strong>
                {entry.state === 'done'
                  ? text('درخواست ثبت شد', 'Request recorded')
                  : entry.state === 'rejected'
                    ? text(
                        'این درخواست پذیرفته نشد؛ وضعیت تازه را بررسی کنید.',
                        'This request was not accepted. Check the latest state.',
                      )
                    : text('نتیجهٔ درخواست هنوز مشخص نیست', 'The request outcome is not confirmed')}
              </strong>
              <p>
                {text('شناسهٔ پیگیری', 'Tracking ID')}: <bdi>{entry.command.id}</bdi>
              </p>
              {entry.state === 'unknown' && (
                <>
                  <p>
                    {text(
                      'ابتدا رسید را بررسی کنید یا همان درخواست را با همان شناسه دوباره بفرستید. پیام تازه‌ای ارسال نکنید. متن و پیوست فقط در حافظهٔ این صفحه نگه داشته می‌شوند.',
                      'Check the receipt or retry the same request with its original ID. Do not send a new message. The message and attachment are retained only in this page’s memory.',
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
              )}
              {entry.state === 'pending' && <p>{text('در حال ثبت…', 'Saving…')}</p>}
              {entry.state === 'done' && (
                <button type="button" onClick={() => select(entry.result!.ticket.id)}>
                  {entry.command.kind === 'create'
                    ? text('باز کردن گفت‌وگو و افزودن عکس', 'Open conversation and add a photo')
                    : text('مشاهدهٔ گفت‌وگو', 'View conversation')}
                </button>
              )}
              {['done', 'rejected'].includes(entry.state) && (
                <button
                  type="button"
                  onClick={() => {
                    journal.clear(owner);
                    setRefresh((n) => n + 1);
                  }}
                >
                  {text('بستن نتیجه و ادامه', 'Close result and continue')}
                </button>
              )}
            </div>
          ))}
        <div className="ticket-queue-results">
          {staff ? (
            <>
              <div
                className="ticket-queue-switch"
                role="group"
                aria-label={text('وضعیت درخواست', 'Request state')}
              >
                {staffStates.map((value) => {
                  const [fa, en, faHint, enHint] = queueCopy[value];
                  return (
                    <button
                      key={value}
                      type="button"
                      data-queue={value || 'all'}
                      aria-pressed={effectiveState === value}
                      onClick={() => {
                        if (exactId) setSearch('');
                        setState(value);
                      }}
                    >
                      <span className="ticket-queue-card-top">
                        <strong>{text(fa, en)}</strong>
                        {queueCounts && <bdi>{number(queueCounts[value])}</bdi>}
                      </span>
                      <small>{text(faHint, enHint)}</small>
                    </button>
                  );
                })}
              </div>
              <label className="ticket-field ticket-queue-search">
                <span>{text('پیدا کردن تیکت', 'Find a ticket')}</span>
                <input
                  type="search"
                  value={search}
                  maxLength={120}
                  aria-describedby="ticket-search-scope"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={text('موضوع یا شناسهٔ تیکت…', 'Subject or ticket ID…')}
                />
                <small id="ticket-search-scope">
                  {exactId
                    ? text('جست‌وجوی شناسه در همهٔ صف‌ها', 'Looking up the ID across all queues')
                    : text(
                        'موضوع در فهرست فعلی؛ شناسهٔ کامل در همهٔ صف‌ها',
                        'Subject in the loaded list; full ID across all queues',
                      )}
                </small>
              </label>
            </>
          ) : (
            <label className="ticket-field">
              <span>{text('وضعیت درخواست', 'Request state')}</span>
              <select value={state} onChange={(e) => setState(e.target.value)}>
                <option value="">{text('همهٔ وضعیت‌ها', 'All states')}</option>
                {Object.entries(names).map(([key, value]) => (
                  <option key={key} value={key}>
                    {staff && key === 'WaitingCustomer'
                      ? text('در انتظار مشتری', 'Waiting for customer')
                      : value[locale === 'fa' ? 0 : 1]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {loading && !page && <p role="status">{text('در حال دریافت…', 'Loading…')}</p>}
          {failed && (
            <div className="ticket-result-note" role="alert">
              <p>{text('دریافت تیکت‌ها ممکن نشد.', 'Tickets could not be loaded.')}</p>
              <button type="button" onClick={() => setRefresh((n) => n + 1)}>
                {text('تلاش مجدد', 'Try again')}
              </button>
            </div>
          )}
          {page && page.items.length === 0 && (
            <p className="ticket-result-note" role="status">
              {exactId
                ? text('تیکتی با این شناسه پیدا نشد.', 'No ticket matches this ID.')
                : text('درخواستی در این صف نیست.', 'There are no tickets in this queue.')}
            </p>
          )}
          {items?.length === 0 && !!page?.items.length && (
            <p role="status">
              {text(
                'در درخواست‌های دریافت‌شده نتیجه‌ای پیدا نشد.',
                'No matches in the loaded requests.',
              )}
            </p>
          )}
          {staff && !!items?.length && (
            <p className="ticket-list-count" role="status">
              {text(
                `${number(items.length)} تیکت در فهرست فعلی`,
                `${number(items.length)} tickets in the loaded list`,
              )}
            </p>
          )}
          <ul className="ticket-list">
            {items?.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  aria-current={selected === item.id ? 'page' : undefined}
                  onClick={() => select(item.id)}
                >
                  <strong>{item.subject}</strong>
                  <span className="ticket-list-meta">
                    <span className="ticket-list-state" data-state={item.state}>
                      {stateName(item.state, staff, locale)}
                    </span>
                    <time dateTime={item.changedAt}>{date(item.changedAt)}</time>
                  </span>
                  <small>
                    <bdi title={item.id}>{staff ? item.id.slice(0, 8) : item.id}</bdi>
                  </small>
                </button>
              </li>
            ))}
          </ul>
          {page?.nextCursor && (
            <button
              type="button"
              disabled={loading}
              onClick={() => void load(page.nextCursor, false, generation.current, page.items)}
            >
              {text('۵۰ درخواست بعدی', 'Next 50 requests')}
            </button>
          )}
        </div>
      </section>
      {selected ? (
        <TicketConversation
          key={owner + ':' + selected}
          owner={owner}
          id={selected}
          staff={staff}
          writable={writable && !unresolved}
          locale={locale}
          transport={transport}
          refresh={refresh}
          completedReplyId={
            entry?.state === 'done' &&
            (entry.command.kind === 'reply' || entry.command.kind === 'attachment') &&
            entry.command.ticketId === selected
              ? entry.command.id
              : null
          }
          download={download}
          onDraftChange={staff ? recordDraft : undefined}
          send={(command, blob) => send(command, false, blob)}
          back={() => select(null)}
        />
      ) : staff ? (
        <section className="ticket-panel ticket-selection-empty">
          <h2>{text('یک گفت‌وگو انتخاب کنید', 'Select a conversation')}</h2>
          <p>
            {text(
              'از صف پشتیبانی، تیکت موردنظر را باز کنید تا پیام‌ها و اقدامات آن را ببینید.',
              'Open a ticket from the support inbox to see its messages and actions.',
            )}
          </p>
        </section>
      ) : (
        <section className="ticket-panel">
          <h2>{text('درخواست تازه', 'New request')}</h2>
          <form onSubmit={create}>
            <label className="ticket-field">
              <span>{text('موضوع', 'Subject')}</span>
              <input
                value={subject}
                maxLength={120}
                required
                disabled={unresolved}
                onChange={(e) => setSubject(e.target.value)}
              />
            </label>
            <label className="ticket-field">
              <span>{text('پیام شما', 'Your message')}</span>
              <textarea
                value={body}
                maxLength={4000}
                rows={6}
                required
                disabled={unresolved}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
            {invalid && (
              <p role="alert">
                {text(
                  'موضوع حداکثر۱۲۰ و متن حداکثر۴۰۰۰ نویسه است؛ هر دو را تکمیل کنید.',
                  'Enter a subject of up to 120 characters and a message of up to 4,000 characters.',
                )}
              </p>
            )}
            <button type="submit" disabled={unresolved}>
              {text('ثبت درخواست پشتیبانی', 'Send support request')}
            </button>
            <p className="ticket-upload-hint">
              {text(
                'اگر عکس دارید، پس از ثبت درخواست می‌توانید آن را در گفت‌وگوی خصوصی پیوست کنید.',
                'After sending your request, you can attach a photo in the private conversation.',
              )}
            </p>
          </form>
        </section>
      )}
    </div>
  );
}

function TicketPhoto({ blob, alt }: { blob: Blob; alt: string }) {
  const imageRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const image = imageRef.current;
    if (!image || !isTicketPhoto(blob.type)) return;
    const url = URL.createObjectURL(blob);
    image.src = url;
    return () => {
      image.removeAttribute('src');
      URL.revokeObjectURL(url);
    };
  }, [blob]);
  // A session-bound object URL cannot be served by the Next image optimizer.
  return <img ref={imageRef} className="ticket-photo" alt={alt} decoding="async" />;
}

function TicketConversation({
  owner,
  id,
  staff,
  writable,
  locale,
  transport,
  refresh,
  completedReplyId,
  send,
  back,
  download,
  onDraftChange,
}: {
  download?: TicketDownloadTransport;
  owner: string;
  id: string;
  staff: boolean;
  writable: boolean;
  locale: 'fa' | 'en';
  transport: TicketTransport;
  refresh: number;
  completedReplyId: string | null;
  send: (command: TicketCommand, attachment?: Blob) => Promise<void>;
  back: () => void;
  onDraftChange?: (dirty: boolean) => void;
}) {
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en),
    prefix = staff ? '/api/admin/support' : '/api/support';
  const [ticket, setTicket] = useState<TicketSummary | null>(null),
    [messages, setMessages] = useState<TicketMessages | null>(null),
    [body, setBody] = useState(''),
    [busy, setBusy] = useState(true),
    [failed, setFailed] = useState(false),
    [localRefresh, setLocalRefresh] = useState(0),
    [invalid, setInvalid] = useState(false);
  const generation = useRef(0),
    controller = useRef<AbortController | null>(null);
  const [attachments, setAttachments] = useState<TicketAttachments | null>(null),
    [capabilities, setCapabilities] = useState<TicketFileCapabilities | null>(null),
    [fileReadFailed, setFileReadFailed] = useState(false),
    [file, setFile] = useState<Awaited<ReturnType<typeof selectedTicketFile>> | null>(null),
    [hashing, setHashing] = useState(false),
    [fileError, setFileError] = useState(false),
    [fileAction, setFileAction] = useState<{ id: string; preview: boolean } | null>(null),
    [attachmentError, setAttachmentError] = useState<string | null>(null),
    [preview, setPreview] = useState<{
      id: string;
      blob: Blob;
      authority: TicketDownloadTransport;
    } | null>(null);
  const mounted = useRef(true),
    downloadController = useRef<AbortController | null>(null),
    attachmentController = useRef<AbortController | null>(null),
    fileInput = useRef<HTMLInputElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const fileFull =
    capabilities && attachments !== null && attachments.items.length >= capabilities.maxPerTicket;
  const load = useCallback(
    async (
      cursor: string | null,
      reset: boolean,
      revision: number,
      previous: TicketMessages['items'] = [],
    ) => {
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      setBusy(true);
      setFailed(false);
      const current = () => revision === generation.current && !abort.signal.aborted;
      if (reset) {
        // The private file service is optional for a text conversation. Keep its failures local.
        attachmentController.current?.abort();
        const filesRequest = new AbortController();
        attachmentController.current = filesRequest;
        setFileReadFailed(false);
        void Promise.allSettled([
          transport(`${prefix}/tickets/${id}/attachments`, { signal: filesRequest.signal }).then(
            (raw) => readTicketAttachments(raw, id),
          ),
          transport(`${prefix}/files/capabilities`, { signal: filesRequest.signal }).then((raw) =>
            ticketFileCapabilitiesSchema.parse(raw),
          ),
        ]).then(([files, availability]) => {
          if (revision !== generation.current || filesRequest.signal.aborted) return;
          setAttachments(files.status === 'fulfilled' ? files.value : null);
          setCapabilities(availability.status === 'fulfilled' ? availability.value : null);
          setFileReadFailed(files.status === 'rejected' || availability.status === 'rejected');
        });
      }
      try {
        const [rawHeader, rawMessages] = await Promise.all([
          transport(`${prefix}/tickets/${id}`, { signal: abort.signal }),
          transport(
            `${prefix}/tickets/${id}/messages` +
              (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
            { signal: abort.signal },
          ),
        ]);
        const header = readTicketDetail(rawHeader, id).ticket;
        const page = readTicketMessages(rawMessages, id);
        if (!current()) return;
        const items = reset ? page.items : [...previous, ...page.items];
        if (
          new Set(items.map((i) => i.id)).size !== items.length ||
          items.some((i, n) => n > 0 && BigInt(i.sequence) <= BigInt(items[n - 1].sequence))
        )
          throw Error('Invalid message order');
        setTicket(header);
        setMessages({ ...page, items });
      } catch {
        if (revision === generation.current && !abort.signal.aborted) setFailed(true);
      } finally {
        if (revision === generation.current && !abort.signal.aborted) setBusy(false);
      }
    },
    [prefix, id, transport],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      downloadController.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (staff) heading.current?.focus();
  }, [staff]);
  useEffect(() => {
    onDraftChange?.(Boolean(body.trim() || file));
  }, [body, file, onDraftChange]);
  useEffect(() => () => onDraftChange?.(false), [onDraftChange]);

  useEffect(() => {
    const revision = ++generation.current;
    void load(null, true, revision);
    return () => {
      advanceRequestGeneration(generation);
      controller.current?.abort();
      attachmentController.current?.abort();
    };
  }, [owner, id, refresh, localRefresh, load]);
  useEffect(() => {
    if (completedReplyId) {
      setBody('');
      setFile(null);
      setFileError(false);
    }
  }, [completedReplyId]);
  useEffect(() => {
    setPreview(null);
    setAttachmentError(null);
    return () => downloadController.current?.abort();
  }, [download]);

  async function chooseFile(candidate: File | null) {
    setFile(null);
    setFileError(false);
    if (!candidate || !writable || busy || failed || fileFull || !capabilities?.configured) return;
    setHashing(true);
    try {
      const verified = await selectedTicketFile(candidate);
      if (mounted.current) setFile(verified);
    } catch {
      if (mounted.current) {
        if (fileInput.current) fileInput.current.value = '';
        setFileError(true);
      }
    } finally {
      if (mounted.current) setHashing(false);
    }
  }

  async function reply(event: FormEvent) {
    event.preventDefault();
    if (!ticket || !writable || busy || failed || hashing) return;
    const parsed = ticketReplySchema.safeParse({ version: ticket.version, body, locale });
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setFileError(false);
    if (file) {
      if (!capabilities?.configured || fileFull) return;
      await send(
        {
          id: crypto.randomUUID().replaceAll('-', ''),
          kind: 'attachment',
          staff,
          ticketId: id,
          body: parsed.data,
          file: file.metadata,
        },
        file.blob,
      );
    } else
      await send({
        id: crypto.randomUUID().replaceAll('-', ''),
        kind: 'reply',
        staff,
        ticketId: id,
        body: parsed.data,
      });
  }
  async function downloadFile(item: NonNullable<TicketAttachments>['items'][number], show = false) {
    if (!download || fileAction || (show && !isTicketPhoto(item.file.contentType))) return;
    setFileAction({ id: item.id, preview: show });
    setAttachmentError(null);
    if (show) setPreview(null);
    const abort = new AbortController();
    downloadController.current = abort;
    try {
      const blob = await download(
        `${prefix}/tickets/${id}/attachments/${item.id}`,
        item.id,
        item.file,
        abort.signal,
      );
      if (!mounted.current || abort.signal.aborted) return;
      if (show) {
        if (blob.type !== item.file.contentType) throw Error('Private photo type mismatch');
        setPreview({ id: item.id, blob, authority: download });
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = item.file.filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      if (mounted.current && !abort.signal.aborted) setAttachmentError(item.id);
    } finally {
      if (mounted.current) setFileAction(null);
    }
  }

  const date = (s: string) =>
    new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Tehran',
    }).format(new Date(s));
  return (
    <section className="ticket-panel ticket-conversation">
      <div className="ticket-heading">
        <h2 ref={heading} tabIndex={staff ? -1 : undefined}>
          {ticket?.subject ?? text('گفت‌وگوی پشتیبانی', 'Support conversation')}
        </h2>
        <div className="ticket-actions">
          <button type="button" onClick={back}>
            {staff
              ? text('بازگشت به صف', 'Back to inbox')
              : text('فهرست / درخواست تازه', 'List / new request')}
          </button>
          <button type="button" disabled={busy} onClick={() => setLocalRefresh((n) => n + 1)}>
            {text('تازه‌سازی گفت‌وگو', 'Refresh conversation')}
          </button>
        </div>
      </div>
      <p className="ticket-tracking">
        <bdi>{id}</bdi>
      </p>
      {busy && !ticket && (
        <p role="status">{text('در حال دریافت گفت‌وگو…', 'Loading conversation…')}</p>
      )}
      {failed && (
        <p role="alert">
          {text(
            'گفت‌وگو خوانده نشد؛ دسترسی و وضعیت تازه را بررسی کنید.',
            'Conversation unavailable. Check your access and refresh.',
          )}
        </p>
      )}
      {ticket && (
        <>
          <p>
            <span className="ticket-list-state" data-state={ticket.state}>
              {stateName(ticket.state, staff, locale)}
            </span>
          </p>
          <ol className="ticket-messages">
            {messages?.items.map((message) => (
              <li className={'ticket-message ' + message.author} key={message.id}>
                <div>
                  <strong>
                    {message.author === 'support'
                      ? text('پشتیبان فروشگاه', 'Store support')
                      : staff
                        ? text('مشتری', 'Customer')
                        : text('شما', 'You')}
                  </strong>
                  <time dateTime={message.at}>{date(message.at)}</time>
                </div>
                <p lang={message.locale} dir={message.locale === 'fa' ? 'rtl' : 'ltr'}>
                  {message.body}
                </p>
              </li>
            ))}
          </ol>
          {messages?.nextCursor && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void load(messages.nextCursor, false, generation.current, messages.items)
              }
            >
              {text('۵۰ پیام بعدی', 'Next 50 messages')}
            </button>
          )}
          {attachments && attachments.items.length > 0 && (
            <section className="ticket-attachments">
              <h3>{text('پیوست‌های خصوصی این گفت‌وگو', 'Private conversation attachments')}</h3>
              <ul>
                {attachments.items.map((item) => {
                  const photo = isTicketPhoto(item.file.contentType);
                  const visible = preview?.id === item.id && preview.authority === download;
                  return (
                    <li key={item.id}>
                      <div className="ticket-attachment-name">
                        <bdi>{item.file.filename}</bdi>
                        <small>
                          {date(item.at)} ·{' '}
                          {item.author === 'support'
                            ? text('پشتیبان فروشگاه', 'Store support')
                            : text('مشتری', 'Customer')}
                        </small>
                      </div>
                      <div className="ticket-actions">
                        {photo && (
                          <button
                            type="button"
                            aria-expanded={visible}
                            disabled={!download || fileAction !== null}
                            onClick={() =>
                              visible ? setPreview(null) : void downloadFile(item, true)
                            }
                          >
                            {visible
                              ? text('بستن تصویر', 'Hide image')
                              : fileAction?.id === item.id && fileAction.preview
                                ? text('در حال دریافت تصویر…', 'Loading image…')
                                : text('دیدن تصویر', 'View image')}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={!download || fileAction !== null}
                          onClick={() => void downloadFile(item)}
                        >
                          {fileAction?.id === item.id && !fileAction.preview
                            ? text('در حال دریافت…', 'Downloading…')
                            : text('دریافت فایل', 'Download file')}
                        </button>
                      </div>
                      {visible && (
                        <TicketPhoto
                          blob={preview.blob}
                          alt={text('تصویر پیوست', 'Attached image') + ': ' + item.file.filename}
                        />
                      )}
                      {attachmentError === item.id && (
                        <p role="alert">
                          {text(
                            'دریافت این پیوست ممکن نشد.',
                            'This attachment could not be loaded.',
                          )}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {fileReadFailed && (
            <p role="status">
              {text(
                'بخشی از اطلاعات پیوست دریافت نشد. پیام‌ها همچنان در دسترس‌اند.',
                'Some attachment information could not be loaded. Text messages remain available.',
              )}
            </p>
          )}
          {ticket.state === 'Closed' ? (
            <p>
              {text(
                'این درخواست بسته است؛ برای ادامه، آن را بازگشایی کنید.',
                'This request is closed. Reopen it to continue.',
              )}
            </p>
          ) : (
            <form onSubmit={(event) => void reply(event)}>
              <label className="ticket-field">
                <span>{text('پاسخ تازه', 'New reply')}</span>
                <textarea
                  rows={5}
                  maxLength={4000}
                  required
                  value={body}
                  disabled={!writable || busy || failed || hashing}
                  onChange={(e) => setBody(e.target.value)}
                />
              </label>
              {capabilities?.configured && !fileFull && (
                <label className="ticket-field ticket-file-picker">
                  <span>
                    {text(
                      'افزودن عکس یا فایل به این پیام',
                      'Attach a photo or file to this message',
                    )}
                  </span>
                  <small>
                    {text(
                      'JPG، PNG، WebP یا PDF؛ حداکثر ۸ مگابایت',
                      'JPG, PNG, WebP or PDF; up to 8 MiB',
                    )}
                  </small>
                  <input
                    ref={fileInput}
                    key={completedReplyId ?? 'draft'}
                    type="file"
                    accept={capabilities.contentTypes.join(',')}
                    disabled={!writable || busy || failed || hashing}
                    aria-invalid={fileError}
                    aria-describedby={fileError ? 'ticket-file-error' : undefined}
                    onChange={(e) => void chooseFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              )}
              {fileError && (
                <p id="ticket-file-error" role="alert">
                  {text(
                    'این فایل قابل استفاده نیست. نام، نوع و اندازهٔ فایل را بررسی کنید.',
                    'This file could not be used. Check the filename, type and size.',
                  )}
                </p>
              )}
              {file && (
                <div className="ticket-selected-file">
                  {isTicketPhoto(file.metadata.contentType) && (
                    <TicketPhoto
                      blob={file.blob}
                      alt={text('پیش‌نمایش عکس شما', 'Your photo preview')}
                    />
                  )}
                  <bdi>{file.metadata.filename}</bdi>
                  <button
                    type="button"
                    disabled={!writable || busy || hashing}
                    onClick={() => {
                      setFile(null);
                      if (fileInput.current) fileInput.current.value = '';
                    }}
                  >
                    {text('حذف پیوست انتخاب‌شده', 'Remove selected attachment')}
                  </button>
                </div>
              )}
              {fileFull && (
                <p role="status">
                  {text(
                    'سقف پیوست‌های این گفت‌وگو پر شده است؛ می‌توانید پیام متنی بفرستید.',
                    'This conversation has reached its attachment limit. You can still send text.',
                  )}
                </p>
              )}
              {capabilities && !capabilities.configured && (
                <p>
                  {text(
                    'ارسال فایل پس از پیکربندی ذخیره‌ساز و اسکن امن فعال می‌شود؛ پیام متنی در دسترس است.',
                    'File uploads become available when secure storage and scanning are configured. Text messages remain available.',
                  )}
                </p>
              )}
              {hashing && (
                <p role="status">{text('در حال آماده‌سازی پیوست…', 'Preparing attachment…')}</p>
              )}
              {invalid && (
                <p role="alert">
                  {text(
                    'متن معتبر حداکثر۴۰۰۰ نویسه وارد کنید.',
                    'Enter a valid message of up to 4,000 characters.',
                  )}
                </p>
              )}
              <button
                type="submit"
                disabled={
                  !writable ||
                  busy ||
                  failed ||
                  hashing ||
                  !body.trim() ||
                  (!!file && (!capabilities?.configured || Boolean(fileFull)))
                }
              >
                {text('ارسال پاسخ', 'Send reply')}
              </button>
            </form>
          )}
          <button
            type="button"
            disabled={!writable || busy || failed || hashing}
            onClick={() =>
              void send({
                id: crypto.randomUUID().replaceAll('-', ''),
                kind: 'state',
                staff,
                ticketId: id,
                body: {
                  version: ticket.version,
                  state: ticket.state === 'Closed' ? 'Open' : 'Closed',
                },
              })
            }
          >
            {ticket.state === 'Closed'
              ? text('بازگشایی درخواست', 'Reopen request')
              : text('بستن درخواست', 'Close request')}
          </button>
        </>
      )}
    </section>
  );
}
