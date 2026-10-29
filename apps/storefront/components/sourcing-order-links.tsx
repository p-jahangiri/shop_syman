'use client';
import { useEffect, useState } from 'react';
import { useCustomerSession } from './auth-provider';
import { useI18n } from './locale-provider';
import Link from './localized-link';
import { Button } from './ui';
import { readSourcingOrderLinks, type SourcingOrderLinks } from '@/lib/sourcing-order-links';

export function CustomerSourcingOrderLinks({
  requestId,
  refreshToken,
}: {
  requestId: string;
  refreshToken: number;
}) {
  const auth = useCustomerSession(),
    { locale } = useI18n();
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const [page, setPage] = useState<SourcingOrderLinks | null>(null),
    [cursor, setCursor] = useState<string | null>(null),
    [history, setHistory] = useState<(string | null)[]>([]),
    [attempt, setAttempt] = useState(0),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setBusy(true);
    setFailed(false);
    void readSourcingOrderLinks(auth.store.fetch, requestId, cursor, abort.signal)
      .then((value) => {
        if (!abort.signal.aborted) setPage(value);
      })
      .catch(() => {
        if (!abort.signal.aborted) setFailed(true);
      })
      .finally(() => {
        if (!abort.signal.aborted) setBusy(false);
      });
    return () => abort.abort();
  }, [requestId, cursor, refreshToken, attempt, auth.store]);
  const date = (value: string) =>
    new Date(value).toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-GB', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  if (auth.status !== 'member') return null;
  return (
    <section className="card-panel sourcing-order-links">
      <h2>{text('سفارش‌های مرتبط با این درخواست', 'Orders linked to this request')}</h2>
      <p className="small-note">
        {text(
          'این فهرست فقط پیوند تاریخی است و ممکن است با کمی تأخیر به‌روز شود. مبلغ و وضعیت معتبر را در جزئیات خود سفارش ببینید.',
          'These are historical links and may appear after a short delay. Open the order itself for its recorded amounts and current state.',
        )}
      </p>
      {busy && !page && (
        <p role="status">{text('در حال دریافت پیوندها…', 'Loading order links…')}</p>
      )}
      {failed ? (
        <div className="notice" role="alert">
          <p>{text('دریافت پیوند سفارش‌ها کامل نشد.', 'Order links could not be loaded.')}</p>
          <Button variant="outline" disabled={busy} onClick={() => setAttempt((n) => n + 1)}>
            {text('تلاش دوباره', 'Retry')}
          </Button>
        </div>
      ) : (
        page && (
          <>
            {page.items.length ? (
              <ul>
                {page.items.map((item) => (
                  <li key={item.orderId + ':' + item.acceptanceId}>
                    <Link className="text-link" href={`/orders/${item.orderId}`}>
                      {text('مشاهدهٔ سفارش ثبت‌شده', 'View recorded order')}
                    </Link>{' '}
                    · <time dateTime={item.createdAt}>{date(item.createdAt)}</time>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                {text(
                  'هنوز پیوند سفارشی در این فهرست ثبت نشده است.',
                  'No order links have been recorded in this list yet.',
                )}
              </p>
            )}
            <nav
              className="catalog-pagination"
              aria-label={text('صفحه‌های سفارش مرتبط', 'Linked order pages')}
            >
              {history.length > 0 && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setCursor(history[history.length - 1]);
                    setHistory((value) => value.slice(0, -1));
                  }}
                >
                  {text('صفحهٔ قبل', 'Previous page')}
                </Button>
              )}
              {page.nextCursor && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setHistory((value) => [...value, cursor]);
                    setCursor(page.nextCursor);
                  }}
                >
                  {text('پیوندهای بعدی', 'Next links')}
                </Button>
              )}
            </nav>
          </>
        )
      )}
      <div className="order-action-row">
        <Button variant="outline" disabled={busy} onClick={() => setAttempt((n) => n + 1)}>
          {text('بازخوانی پیوندها', 'Refresh links')}
        </Button>
        <Link className="text-link" href="/orders">
          {text('همهٔ سفارش‌های من', 'All my orders')}
        </Link>
      </div>
    </section>
  );
}
