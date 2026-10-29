'use client';
import { advanceRequestGeneration } from '../lib/request-generation';
import { ticketCommandRequest } from '../lib/ticket-command-request';
import {
  selectedTicketFile,
  readTicketAttachments,
  ticketFileCapabilitiesSchema,
  type TicketAttachments,
  type TicketFileCapabilities,
} from '../lib/ticket-file-contract';
import type { TicketDownloadTransport } from '../lib/ticket-file-download';
import { PrivateRealtimeStatus, useRealtimeRefresh } from './private-realtime';
import type { PrivateRealtimeClient } from '../lib/private-realtime-client';
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
} from '../lib/ticket-contract';
import { TicketJournal } from '../lib/ticket-journal';
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
    [state, setState] = useState(''),
    [page, setPage] = useState<TicketPage | null>(null),
    [loading, setLoading] = useState(true),
    [failed, setFailed] = useState(false),
    [refresh, setRefresh] = useState(0),
    [subject, setSubject] = useState(''),
    [body, setBody] = useState(''),
    [invalid, setInvalid] = useState(false);
  const generation = useRef(0),
    controller = useRef<AbortController | null>(null);
  const entry = useSyncExternalStore(
      journal.subscribe,
      () => journal.snapshot(owner),
      () => null,
    ),
    unresolved = entry?.state === 'pending' || entry?.state === 'unknown';
  const select = (id: string | null) => {
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
        if (state) query.set('state', state);
        if (cursor) query.set('cursor', cursor);
        const value = readTicketPage(
          await transport(prefix + '/tickets' + (query.size ? '?' + query : ''), {
            signal: abort.signal,
          }),
          state || null,
        );
        if (ticket !== generation.current || abort.signal.aborted) return;
        const items = reset ? value.items : [...previous, ...value.items];
        if (new Set(items.map((i) => i.id)).size !== items.length) throw Error('Duplicate tickets');
        setPage({ ...value, items });
      } catch {
        if (ticket === generation.current && !abort.signal.aborted) setFailed(true);
      } finally {
        if (ticket === generation.current && !abort.signal.aborted) setLoading(false);
      }
    },
    [state, prefix, transport],
  );
  useEffect(() => {
    setSelected(initialTicketId ?? null);
  }, [initialTicketId]);
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
  useRealtimeRefresh(live, 'support', () => setRefresh((n) => n + 1), unresolved || loading);
  return (
    <div className="ticket-workspace">
      <PrivateRealtimeStatus client={live} locale={locale} />
      <section className="ticket-panel">
        <div className="ticket-heading">
          <h2>
            {staff
              ? text('درخواست‌های خصوصی مشتریان', 'Private customer requests')
              : text('درخواست‌های پشتیبانی من', 'My support requests')}
          </h2>
          <button type="button" disabled={loading} onClick={() => setRefresh((n) => n + 1)}>
            {text('دریافت وضعیت تازه', 'Refresh')}
          </button>
        </div>
        <p>
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
        <p>{text('زمان‌ها به وقت تهران نمایش داده می‌شوند.', 'Times are shown in Tehran time.')}</p>
        {entry &&
          (!writable ? (
            <p role="status">
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
                  {text('مشاهدهٔ گفت‌وگو', 'View conversation')}
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
        {loading && !page && <p role="status">{text('در حال دریافت…', 'Loading…')}</p>}
        {failed && (
          <p role="alert">
            {text(
              'خواندن درخواست‌ها ممکن نشد؛ دوباره دریافت کنید.',
              'Requests could not be loaded. Please refresh.',
            )}
          </p>
        )}
        {page && page.items.length === 0 && (
          <p>{text('درخواستی در این فهرست نیست.', 'No requests in this list.')}</p>
        )}
        <ul className="ticket-list">
          {page?.items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                aria-current={selected === item.id ? 'page' : undefined}
                onClick={() => select(item.id)}
              >
                <strong>{item.subject}</strong>
                <span>
                  {stateName(item.state, staff, locale)} · {date(item.changedAt)}
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
            disabled={loading}
            onClick={() => void load(page.nextCursor, false, generation.current, page.items)}
          >
            {text('۵۰ درخواست بعدی', 'Next 50 requests')}
          </button>
        )}
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
          send={(command, blob) => send(command, false, blob)}
          back={() => select(null)}
        />
      ) : (
        !staff && (
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
            </form>
          </section>
        )
      )}
    </div>
  );
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
    [file, setFile] = useState<File | null>(null),
    [hashing, setHashing] = useState(false),
    [fileError, setFileError] = useState(false),
    [downloading, setDownloading] = useState<string | null>(null);
  const mounted = useRef(true),
    downloadController = useRef<AbortController | null>(null),
    fileInput = useRef<HTMLInputElement | null>(null);
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
      try {
        const header = readTicketDetail(
          await transport(`${prefix}/tickets/${id}`, { signal: abort.signal }),
          id,
        ).ticket;
        const page = readTicketMessages(
          await transport(
            `${prefix}/tickets/${id}/messages` +
              (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
            { signal: abort.signal },
          ),
          id,
        );
        const filePage = readTicketAttachments(
            await transport(`${prefix}/tickets/${id}/attachments`, { signal: abort.signal }),
            id,
          ),
          fileCapabilities = ticketFileCapabilitiesSchema.parse(
            await transport(`${prefix}/files/capabilities`, { signal: abort.signal }),
          );
        if (revision !== generation.current || abort.signal.aborted) return;
        setAttachments(filePage);
        setCapabilities(fileCapabilities);
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
    const revision = ++generation.current;
    void load(null, true, revision);
    return () => {
      advanceRequestGeneration(generation);
      controller.current?.abort();
    };
  }, [owner, id, refresh, localRefresh, load]);
  useEffect(() => {
    if (completedReplyId) {
      setBody('');
      setFile(null);
      setFileError(false);
    }
  }, [completedReplyId]);
  async function reply(event: FormEvent) {
    event.preventDefault();
    if (!ticket || !writable || busy || hashing) return;
    const parsed = ticketReplySchema.safeParse({ version: ticket.version, body, locale });
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setFileError(false);
    const revision = generation.current;
    try {
      if (file) {
        if (!capabilities?.configured) throw Error();
        setHashing(true);
        const selected = await selectedTicketFile(file);
        if (!mounted.current || revision !== generation.current) return;
        await send(
          {
            id: crypto.randomUUID().replaceAll('-', ''),
            kind: 'attachment',
            staff,
            ticketId: id,
            body: parsed.data,
            file: selected.metadata,
          },
          selected.blob,
        );
      } else
        await send({
          id: crypto.randomUUID().replaceAll('-', ''),
          kind: 'reply',
          staff,
          ticketId: id,
          body: parsed.data,
        });
    } catch {
      if (mounted.current) setFileError(true);
    } finally {
      if (mounted.current) setHashing(false);
    }
  }
  async function downloadFile(item: NonNullable<TicketAttachments>['items'][number]) {
    if (!download || downloading) return;
    setDownloading(item.id);
    setFileError(false);
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
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = item.file.filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      if (mounted.current && !abort.signal.aborted) setFileError(true);
    } finally {
      if (mounted.current) setDownloading(null);
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
        <h2>{ticket?.subject ?? text('گفت‌وگوی پشتیبانی', 'Support conversation')}</h2>
        <div className="ticket-actions">
          <button type="button" onClick={back}>
            {text('فهرست / درخواست تازه', 'List / new request')}
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
          <p>{stateName(ticket.state, staff, locale)}</p>
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
                {attachments.items.map((item) => (
                  <li key={item.id}>
                    <span>
                      <bdi>{item.file.filename}</bdi>
                    </span>
                    <small>
                      {date(item.at)} ·{' '}
                      {item.author === 'support'
                        ? text('پشتیبان فروشگاه', 'Store support')
                        : text('مشتری', 'Customer')}
                    </small>
                    <button
                      type="button"
                      disabled={!download || downloading !== null}
                      onClick={() => void downloadFile(item)}
                    >
                      {downloading === item.id
                        ? text('در حال دریافت…', 'Downloading…')
                        : text('دریافت فایل', 'Download file')}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {fileError && (
            <p role="alert">
              {text(
                'فایل قابل دریافت یا ارسال نبود. نوع و اندازهٔ فایل، دسترسی و اتصال را بررسی کنید.',
                'The file could not be uploaded or downloaded. Check its type, size, access and connection.',
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
              {capabilities?.configured && (
                <label className="ticket-field">
                  <span>
                    {text(
                      'پیوست اختیاری؛ عکس یا PDF، حداکثر ۸ مگابایت',
                      'Optional attachment: image or PDF, up to 8 MiB',
                    )}
                  </span>
                  <input
                    ref={fileInput}
                    key={completedReplyId ?? 'draft'}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    disabled={!writable || busy || failed || hashing}
                    onChange={(e) => {
                      setFile(e.target.files?.[0] ?? null);
                      setFileError(false);
                    }}
                  />
                  {file && (
                    <span>
                      <bdi>{file.name}</bdi>
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
                    </span>
                  )}
                </label>
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
              <button type="submit" disabled={!writable || busy || failed || hashing}>
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
