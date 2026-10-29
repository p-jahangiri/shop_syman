'use client';
import { advanceRequestGeneration } from '../lib/request-generation';
import { useEffect, useRef, useState } from 'react';
import Link from './localized-link';
import { useRealtimeRefresh } from './private-realtime';
import type { PrivateRealtimeClient } from '@/lib/private-realtime-client';
import {
  readPhoneInbox,
  readPhoneInboxAcknowledgement,
  type PhoneInboxPage,
} from '@/lib/phone-inbox-contract';
export function CustomerPhoneInbox({
  owner,
  locale,
  transport,
  live,
}: {
  owner: string;
  locale: 'fa' | 'en';
  transport: (path: string, init?: RequestInit) => Promise<unknown>;
  live: PrivateRealtimeClient | null;
}) {
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en),
    [page, setPage] = useState<PhoneInboxPage | null>(null),
    [unread, setUnread] = useState(false),
    [busy, setBusy] = useState(false),
    [reading, setReading] = useState(false),
    [failed, setFailed] = useState(false),
    [refresh, setRefresh] = useState(0),
    generation = useRef(0),
    controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const ticket = ++generation.current,
      abort = new AbortController();
    controller.current = abort;
    setPage(null);
    setBusy(true);
    setFailed(false);
    void transport('/api/notifications/phones?unreadOnly=' + unread, { signal: abort.signal })
      .then((v) => {
        const p = readPhoneInbox(v, unread);
        if (ticket === generation.current && !abort.signal.aborted) setPage(p);
      })
      .catch(() => {
        if (!abort.signal.aborted) setFailed(true);
      })
      .finally(() => {
        if (!abort.signal.aborted) setBusy(false);
      });
    return () => {
      advanceRequestGeneration(generation);
      abort.abort();
    };
  }, [owner, unread, refresh, transport]);
  useRealtimeRefresh(live, 'notifications', () => setRefresh((n) => n + 1), busy || reading);
  async function more() {
    if (!page?.nextCursor || busy || reading) return;
    const cursor = page.nextCursor,
      ticket = generation.current;
    setBusy(true);
    try {
      const next = readPhoneInbox(
        await transport(
          '/api/notifications/phones?unreadOnly=' +
            unread +
            '&cursor=' +
            encodeURIComponent(cursor),
          { signal: controller.current?.signal },
        ),
        unread,
        cursor,
      );
      if (ticket === generation.current)
        setPage((p) => (p ? { ...next, items: [...p.items, ...next.items] } : next));
    } catch {
      if (ticket === generation.current) setFailed(true);
    } finally {
      if (ticket === generation.current) setBusy(false);
    }
  }
  async function mark(id: string) {
    if (busy || reading) return;
    const ticket = generation.current;
    setReading(true);
    try {
      readPhoneInboxAcknowledgement(
        await transport('/api/notifications/phones/' + id + '/read', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
          signal: controller.current?.signal,
        }),
        id,
      );
      if (ticket === generation.current) setRefresh((n) => n + 1);
    } catch {
      if (ticket === generation.current) setFailed(true);
    } finally {
      if (ticket === generation.current) setReading(false);
    }
  }
  return (
    <section className="ticket-panel">
      <div className="ticket-heading">
        <h2>{text('موجودی گوشی و پیشنهادهای تأمین', 'Phone availability and sourcing quotes')}</h2>
        <button disabled={busy || reading} onClick={() => setRefresh((n) => n + 1)}>
          {text('تازه‌سازی', 'Refresh')}
        </button>
      </div>
      <p>
        {text(
          'قیمت نهایی و شرایط را در صفحه درخواست بررسی و تأیید کنید.',
          'Review and accept the final price and terms on your request page.',
        )}
      </p>
      <label className="notification-filter">
        <input
          type="checkbox"
          checked={unread}
          disabled={busy || reading}
          onChange={(e) => setUnread(e.target.checked)}
        />
        {text('فقط خوانده‌نشده‌ها', 'Unread only')}
      </label>
      {failed && (
        <p role="alert">
          {text(
            'وضعیت اعلان‌ها مشخص نشد؛ تازه‌سازی کنید.',
            'Could not confirm notification state. Refresh to retry.',
          )}
        </p>
      )}
      {busy && !page && <p role="status">{text('در حال دریافت…', 'Loading…')}</p>}
      {page?.items.length === 0 && (
        <p>{text('اعلانی در این بخش نیست.', 'There are no notifications here.')}</p>
      )}
      <ul className="notification-list">
        {page?.items.map((i) => (
          <li key={i.id} className={i.readAt ? 'read' : 'unread'}>
            <div>
              <h3>
                {i.kind === 'phone_available'
                  ? text('ترکیب انتخابی شما موجود شد', 'Your selected configuration is available')
                  : text('پیشنهاد قیمت فروشگاه آماده است', 'Your store quote is ready')}
              </h3>
              <time dateTime={i.at}>
                {new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone: 'Asia/Tehran',
                }).format(new Date(i.at))}
              </time>
            </div>
            <div className="ticket-actions">
              <Link
                href={
                  i.requestId
                    ? '/sourcing/' + i.requestId
                    : i.storeSlug
                      ? '/product/' + i.storeSlug
                      : '/market/' + i.listingId + '?configuration=' + i.configurationId
                }
              >
                {i.requestId
                  ? text('بررسی قیمت و شرایط', 'Review quote and terms')
                  : text('بررسی موجودی فروشگاه', 'Review store offer')}
              </Link>
              {!i.readAt && (
                <button disabled={busy || reading} onClick={() => void mark(i.id)}>
                  {text('خوانده‌شده', 'Mark as read')}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {page?.nextCursor && (
        <button disabled={busy || reading} onClick={() => void more()}>
          {text('نمایش بیشتر', 'Load more')}
        </button>
      )}
    </section>
  );
}
