'use client';
import { advanceRequestGeneration } from '../lib/request-generation';
import { useEffect, useRef, useState } from 'react';
import Link from './localized-link';
import { useRealtimeRefresh } from './private-realtime';
import type { PrivateRealtimeClient } from '../lib/private-realtime-client';
import {
  readCreditInbox,
  readCreditInboxAcknowledgement,
  type CreditInboxPage,
} from '../lib/credit-inbox-contract';
import { notificationCountSchema } from '../lib/notification-contract';
type Transport = (path: string, init?: RequestInit) => Promise<unknown>;
export function CustomerCreditReminders({
  owner,
  locale,
  transport,
  live,
}: {
  owner: string;
  locale: 'fa' | 'en';
  transport: Transport;
  live: PrivateRealtimeClient | null;
}) {
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en),
    [page, setPage] = useState<CreditInboxPage | null>(null),
    [count, setCount] = useState<string | null>(null),
    [unread, setUnread] = useState(false),
    [refresh, setRefresh] = useState(0),
    [busy, setBusy] = useState(true),
    [failed, setFailed] = useState(false),
    [reading, setReading] = useState<string | null>(null),
    [readFailed, setReadFailed] = useState(false);
  const generation = useRef(0),
    controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const ticket = ++generation.current,
      c = new AbortController();
    controller.current = c;
    setPage(null);
    setCount(null);
    setBusy(true);
    setFailed(false);
    void Promise.all([
      transport('/api/notifications/credit-reminders?unreadOnly=' + String(unread), {
        signal: c.signal,
      }),
      transport('/api/notifications/credit-reminders/unread-count', { signal: c.signal }),
    ])
      .then(([raw, total]) => {
        const p = readCreditInbox(raw, unread),
          n = notificationCountSchema.parse(total);
        if (generation.current === ticket && !c.signal.aborted) {
          setPage(p);
          setCount(n.unreadCount);
          setReadFailed(false);
        }
      })
      .catch(() => {
        if (generation.current === ticket && !c.signal.aborted) setFailed(true);
      })
      .finally(() => {
        if (generation.current === ticket && !c.signal.aborted) setBusy(false);
      });
    return () => {
      advanceRequestGeneration(generation);
      c.abort();
      controller.current = null;
    };
  }, [owner, unread, refresh, transport]);
  async function more() {
    if (!page?.nextCursor || busy || reading) return;
    const cursor = page.nextCursor,
      ticket = generation.current;
    setBusy(true);
    setFailed(false);
    try {
      const p = readCreditInbox(
        await transport(
          '/api/notifications/credit-reminders?unreadOnly=' +
            String(unread) +
            '&cursor=' +
            encodeURIComponent(cursor),
          { signal: controller.current?.signal },
        ),
        unread,
        cursor,
      );
      if (ticket === generation.current)
        setPage((old) => (old ? { ...p, items: [...old.items, ...p.items] } : p));
    } catch {
      if (ticket === generation.current) setFailed(true);
    } finally {
      if (ticket === generation.current) setBusy(false);
    }
  }
  async function mark(id: string) {
    if (busy || reading) return;
    const ticket = generation.current;
    setReading(id);
    setReadFailed(false);
    try {
      readCreditInboxAcknowledgement(
        await transport('/api/notifications/credit-reminders/' + id + '/read', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
          signal: controller.current?.signal,
        }),
        id,
      );
      if (ticket === generation.current) setRefresh((n) => n + 1);
    } catch {
      if (ticket === generation.current) setReadFailed(true);
    } finally {
      if (ticket === generation.current) setReading(null);
    }
  }
  useRealtimeRefresh(live, 'notifications', () => setRefresh((n) => n + 1), busy || !!reading);
  const format = (v: string, civil = false) =>
      new Intl.DateTimeFormat(
        locale === 'fa' ? 'fa-IR' : 'en-GB',
        civil
          ? { dateStyle: 'medium', timeZone: 'Asia/Tehran' }
          : { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tehran' },
      ).format(new Date(v + (civil ? 'T12:00:00Z' : ''))),
    money = (v: string) =>
      BigInt(v).toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-GB') + ' ' + text('ریال', 'rial');
  return (
    <section className="ticket-panel credit-reminder-inbox">
      <div className="ticket-heading">
        <h2>{text('یادآوری چک‌های من', 'My cheque reminders')}</h2>
        <button type="button" disabled={busy || !!reading} onClick={() => setRefresh((n) => n + 1)}>
          {text('تازه‌سازی یادآوری‌ها', 'Refresh reminders')}
        </button>
      </div>
      <p>
        {text(
          'اطلاعات ثبت‌شدهٔ چک سفارش شما؛ این اعلان، صورت‌حساب تازه یا تأیید وصول بانکی نیست.',
          'Retained cheque details for your order. This reminder is not a new invoice or bank collection confirmation.',
        )}
      </p>
      <p>
        {text(
          'تاریخ‌ها و زمان‌ها به وقت تهران نمایش داده می‌شوند.',
          'Dates and times are shown in Tehran time.',
        )}
      </p>
      {count !== null && (
        <p role="status">
          {text('یادآوری خوانده‌نشده: ', 'Unread reminders: ')}
          <strong>{BigInt(count).toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-GB')}</strong>
        </p>
      )}
      <label className="notification-filter">
        <input
          type="checkbox"
          checked={unread}
          disabled={busy || !!reading}
          onChange={(e) => setUnread(e.target.checked)}
        />
        {text('فقط یادآوری‌های خوانده‌نشده', 'Unread reminders only')}
      </label>
      {busy && !page && (
        <p role="status">{text('در حال دریافت یادآوری‌ها…', 'Loading reminders…')}</p>
      )}
      {failed && (
        <p role="alert">
          {text(
            'یادآوری‌ها خوانده نشدند؛ دوباره تازه‌سازی کنید.',
            'Reminders could not be loaded. Please refresh.',
          )}
        </p>
      )}
      {readFailed && (
        <p role="alert">
          {text(
            'خوانده‌شدن تأیید نشد؛ وضعیت را تازه یا همان اعلان را دوباره علامت بزنید.',
            'The read acknowledgement could not be confirmed. Refresh or mark the same reminder again.',
          )}
        </p>
      )}
      {page?.items.length === 0 && (
        <p>{text('یادآوری در این فهرست نیست.', 'There are no reminders in this list.')}</p>
      )}
      <ul className="notification-list">
        {page?.items.map((n) => (
          <li key={n.id} className={n.readAt ? 'read' : 'unread'}>
            <div>
              <h3>{text('یادآوری اطلاعات چک', 'Cheque details reminder')}</h3>
              <p>
                {text('سررسید ثبت‌شده: ', 'Recorded due date: ')}
                {format(n.dueDate, true)}
              </p>
              <p>
                {text('مبلغ ثبت‌شده: ', 'Recorded amount: ')}
                {money(n.amountRial)}
              </p>
              <time dateTime={n.at}>{format(n.at)}</time>
              <p>{n.readAt ? text('خوانده‌شده', 'Read') : text('خوانده‌نشده', 'Unread')}</p>
            </div>
            <div className="ticket-actions">
              <Link href={'/orders/' + n.orderId}>
                {text('دیدن سفارش مرتبط', 'View related order')}
              </Link>
              {!n.readAt && (
                <button type="button" disabled={busy || !!reading} onClick={() => void mark(n.id)}>
                  {reading === n.id
                    ? text('در حال ثبت…', 'Saving…')
                    : text('علامت یادآوری به‌عنوان خوانده‌شده', 'Mark reminder as read')}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {page?.nextCursor && (
        <button type="button" disabled={busy || !!reading} onClick={() => void more()}>
          {text('۵۰ یادآوری بعدی', 'Next 50 reminders')}
        </button>
      )}
    </section>
  );
}
