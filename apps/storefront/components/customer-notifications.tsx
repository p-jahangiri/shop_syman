'use client';
import { advanceRequestGeneration } from '../lib/request-generation';
import { CustomerPhoneInbox } from './customer-phone-inbox';
import { CustomerCreditReminders } from './customer-credit-reminders';
import { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { bindRealtimeTransport } from '../lib/private-realtime-client';
import { PrivateRealtimeStatus, usePrivateRealtime, useRealtimeRefresh } from './private-realtime';
import type { PrivateRealtimeClient } from '../lib/private-realtime-client';
import { useCustomerSession } from './auth-provider';
import { useI18n, useStorefront } from './locale-provider';
import Link from './localized-link';
import {
  readNotifications,
  readNotificationResult,
  notificationCountSchema,
  type NotificationPage,
} from '../lib/notification-contract';
type Transport = (path: string, init?: RequestInit) => Promise<unknown>;
export function CustomerNotifications() {
  const auth = useCustomerSession(),
    { locale } = useI18n(),
    { dataSource } = useStorefront(),
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const transport = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const owner = auth.store.snapshot().session?.user.id;
      const response = await auth.store.fetch(path, init);
      const raw = await response.json().catch(() => null);
      if (
        auth.store.snapshot().status !== 'member' ||
        auth.store.snapshot().session?.user.id !== owner
      )
        throw Error('session_changed');
      if (!response.ok) throw Error('notification_unavailable');
      return raw;
    },
    [auth.store],
  );
  const realtimeOwner =
    dataSource === 'api' && auth.status === 'member' ? auth.session!.user.id : null;
  const realtimeTransport = useMemo(
    () =>
      bindRealtimeTransport(
        (path, init) => auth.store.fetch(path, init),
        () => {
          const current = auth.store.snapshot();
          return (
            !!realtimeOwner &&
            current.status === 'member' &&
            current.session?.user.id === realtimeOwner
          );
        },
      ),
    [auth.store, realtimeOwner],
  );
  const live = usePrivateRealtime(realtimeOwner, '/api/realtime', realtimeTransport);
  return (
    <div className="container support-tickets-page">
      <div className="page-top">
        <Link href="/account">{text('حساب کاربری', 'My account')}</Link>
      </div>
      <h1>{text('اعلان‌های من', 'My notifications')}</h1>
      {dataSource !== 'api' ? (
        <p>
          {text(
            'اعلان‌های خصوصی با اتصال API در دسترس‌اند.',
            'Private notifications require an API connection.',
          )}
        </p>
      ) : auth.status === 'member' && auth.session ? (
        <>
          <CustomerPhoneInbox
            key={auth.session.user.id + ':phone'}
            owner={auth.session.user.id}
            locale={locale}
            transport={transport}
            live={live}
          />
          <Inbox
            key={auth.session.user.id}
            owner={auth.session.user.id}
            locale={locale}
            transport={transport}
            live={live}
          />
          <CustomerCreditReminders
            key={auth.session.user.id + ':credit'}
            owner={auth.session.user.id}
            locale={locale}
            transport={transport}
            live={live}
          />
        </>
      ) : auth.status === 'restoring' ? (
        <p role="status">{text('در حال بررسی حساب…', 'Checking your account…')}</p>
      ) : (
        <div className="card-panel">
          <p>
            {text(
              'برای دیدن اعلان‌های خصوصی، وارد حساب خود شوید.',
              'Sign in to view your private notifications.',
            )}
          </p>
          {auth.status === 'unavailable' && (
            <button type="button" onClick={() => void auth.store.restore()}>
              {text('بررسی دوبارهٔ حساب', 'Recheck account')}
            </button>
          )}
          <Link href="/account">{text('ورود به حساب', 'Sign in')}</Link>
        </div>
      )}
    </div>
  );
}
function Inbox({
  owner,
  locale,
  transport,
  live,
}: {
  live: PrivateRealtimeClient | null;
  owner: string;
  locale: 'fa' | 'en';
  transport: Transport;
}) {
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const [page, setPage] = useState<NotificationPage | null>(null),
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
    const token = ++generation.current;
    const abort = new AbortController();
    controller.current = abort;
    setPage(null);
    setCount(null);
    setBusy(true);
    setFailed(false);
    void Promise.all([
      transport('/api/notifications?unreadOnly=' + String(unread), { signal: abort.signal }),
      transport('/api/notifications/unread-count', { signal: abort.signal }),
    ])
      .then(([raw, rawCount]) => {
        const result = readNotifications(raw, unread),
          total = notificationCountSchema.parse(rawCount);
        if (generation.current === token && !abort.signal.aborted) {
          setPage(result);
          setCount(total.unreadCount);
          setReadFailed(false);
        }
      })
      .catch(() => {
        if (generation.current === token && !abort.signal.aborted) setFailed(true);
      })
      .finally(() => {
        if (generation.current === token && !abort.signal.aborted) setBusy(false);
      });
    return () => {
      advanceRequestGeneration(generation);
      abort.abort();
      controller.current = null;
    };
  }, [owner, unread, refresh, transport]);
  async function more() {
    if (!page?.nextCursor || busy || reading) return;
    const cursor = page.nextCursor,
      token = generation.current;
    setBusy(true);
    setFailed(false);
    try {
      const next = readNotifications(
        await transport(
          '/api/notifications?unreadOnly=' +
            String(unread) +
            '&cursor=' +
            encodeURIComponent(cursor),
          { signal: controller.current?.signal },
        ),
        unread,
        cursor,
      );
      if (token === generation.current)
        setPage((previous) =>
          previous ? { ...next, items: [...previous.items, ...next.items] } : next,
        );
    } catch {
      if (token === generation.current) setFailed(true);
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  async function mark(id: string) {
    if (busy || reading) return;
    const token = generation.current;
    setReading(id);
    setReadFailed(false);
    try {
      readNotificationResult(
        await transport('/api/notifications/' + id + '/read', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
          signal: controller.current?.signal,
        }),
        id,
      );
      if (token === generation.current) setRefresh((n) => n + 1);
    } catch {
      if (token === generation.current) setReadFailed(true);
    } finally {
      if (token === generation.current) setReading(null);
    }
  }
  useRealtimeRefresh(live, 'notifications', () => setRefresh((n) => n + 1), !!reading || busy);
  const format = (value: string) =>
    new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Tehran',
    }).format(new Date(value));
  const names = {
    support_reply: text('پاسخ تازهٔ پشتیبانی', 'New support reply'),
    support_closed: text('درخواست شما بسته شد', 'Your support request was closed'),
    support_reopened: text('درخواست شما بازگشایی شد', 'Your support request was reopened'),
  };
  return (
    <section className="ticket-panel">
      <PrivateRealtimeStatus client={live} locale={locale} />
      <div className="ticket-heading">
        <h2>{text('اعلان‌های پشتیبانی', 'Support notifications')}</h2>
        <button type="button" disabled={busy || !!reading} onClick={() => setRefresh((n) => n + 1)}>
          {text('تازه‌سازی اعلان‌ها', 'Refresh notifications')}
        </button>
      </div>
      <p>
        {text(
          'اعلان‌های ثبت‌شدهٔ حساب شما؛ برای دریافت وضعیت تازه، این صفحه را تازه‌سازی کنید.',
          'Saved notifications for your account. Refresh this page to check for updates.',
        )}
      </p>
      <p>{text('زمان‌ها به وقت تهران نمایش داده می‌شوند.', 'Times are shown in Tehran time.')}</p>
      {count !== null && (
        <p role="status">
          {text('خوانده‌نشده: ', 'Unread: ')}
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
        {text('فقط خوانده‌نشده‌ها', 'Unread only')}
      </label>
      {busy && !page && (
        <p role="status">{text('در حال دریافت اعلان‌ها…', 'Loading notifications…')}</p>
      )}
      {failed && (
        <p role="alert">
          {text(
            'اعلان‌ها خوانده نشدند؛ دوباره تازه‌سازی کنید.',
            'Notifications could not be loaded. Please refresh.',
          )}
        </p>
      )}
      {readFailed && (
        <p role="alert">
          {text(
            'نتیجهٔ خوانده‌شدن مشخص نشد؛ تازه‌سازی کنید یا همان اعلان را دوباره خوانده‌شده علامت بزنید.',
            'The read acknowledgement could not be confirmed. Refresh or mark the same notification as read again.',
          )}
        </p>
      )}
      {page?.items.length === 0 && (
        <p>{text('اعلانی در این فهرست نیست.', 'There are no notifications in this list.')}</p>
      )}
      <ul className="notification-list">
        {page?.items.map((item) => (
          <li key={item.id} className={item.readAt ? 'read' : 'unread'}>
            <div>
              <h3>{names[item.kind]}</h3>
              <time dateTime={item.at}>{format(item.at)}</time>
              <p>{item.readAt ? text('خوانده‌شده', 'Read') : text('خوانده‌نشده', 'Unread')}</p>
            </div>
            <div className="ticket-actions">
              <Link href={'/support/tickets/' + item.ticketId}>
                {text('دیدن گفت‌وگوی مربوط', 'View conversation')}
              </Link>
              {!item.readAt && (
                <button
                  type="button"
                  disabled={busy || !!reading}
                  onClick={() => void mark(item.id)}
                >
                  {reading === item.id
                    ? text('در حال ثبت…', 'Saving…')
                    : text('علامت به‌عنوان خوانده‌شده', 'Mark as read')}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {page?.nextCursor && (
        <button type="button" disabled={busy || !!reading} onClick={() => void more()}>
          {text('۵۰ اعلان بعدی', 'Next 50 notifications')}
        </button>
      )}
    </section>
  );
}
