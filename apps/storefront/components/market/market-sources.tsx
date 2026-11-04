'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '../navigation/locale-provider';
import { MarketObservation } from './market-observation';
import {
  marketHistorySchema,
  type MarketSources,
  type MarketHistory,
  type MarketSource,
} from '@sayman/web-shared/lib/market/market-sources-contract.ts';

export function MarketSourcePanel({ data, now }: { data: MarketSources; now: number }) {
  const { locale } = useI18n(),
    fa = locale === 'fa';
  return (
    <section className="market-source-panel" aria-labelledby="market-source-panel-title">
      <h2 id="market-source-panel-title">
        {fa ? 'منابع ثبت‌شدهٔ این مدل' : 'Recorded sources for this model'}
      </h2>
      <p>
        {fa
          ? 'هر گزارش زمان و اعتبار خودش را دارد. این اطلاعات، موجودی سایمان یا تضمین قیمت و تأمین نیست.'
          : 'Every report has its own observation and validity dates. These reports do not confirm Sayman stock, a payable price or guaranteed supply.'}
      </p>
      <div className="market-source-grid">
        {data.sources.map((source) => (
          <article className="market-source-card" key={source.id}>
            <h3>{source.sourceName}</h3>
            <p className="muted">
              {source.isPrimary
                ? fa
                  ? 'منبع اصلی ثبت مدل'
                  : 'Original model source'
                : fa
                  ? 'منبع تکمیلی'
                  : 'Additional source'}
              {source.isDemo ? (fa ? ' · نمونهٔ توسعه' : ' · Development sample') : ''}
            </p>
            <MarketObservation item={source} now={now} detail />
            <SourceHistory
              key={locale + source.id}
              listingId={data.listingId}
              source={source}
              now={now}
            />
          </article>
        ))}
      </div>
    </section>
  );
}
function SourceHistory({
  listingId,
  source,
  now,
}: {
  listingId: string;
  source: MarketSource;
  now: number;
}) {
  const { locale } = useI18n(),
    fa = locale === 'fa';
  const [open, setOpen] = useState(false),
    [page, setPage] = useState<MarketHistory | null>(null),
    [pages, setPages] = useState<(string | null)[]>([null]),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const before = pages.at(-1)!;
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setBusy(true);
    setFailed(false);
    setPage(null);
    void (async () => {
      try {
        const suffix = before ? '?before=' + before : '';
        const response = await fetch(
          `/api/market/${locale}/${encodeURIComponent(listingId)}/sources/${encodeURIComponent(source.id)}/history${suffix}`,
          { cache: 'no-store', credentials: 'omit', signal: controller.signal },
        );
        if (!response.ok) throw Error('history');
        const value = marketHistorySchema.parse(await response.json());
        if (
          value.locale !== locale ||
          value.listingId !== listingId ||
          value.sourceId !== source.id ||
          (before && value.items.some((x) => BigInt(x.sequence) >= BigInt(before)))
        )
          throw Error('history scope');
        if (!controller.signal.aborted) setPage(value);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    })();
    return () => controller.abort();
  }, [open, locale, listingId, source.id, before]);
  const date = (value: string) =>
    new Intl.DateTimeFormat(fa ? 'fa-IR' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Tehran',
    }).format(new Date(value));
  return (
    <div className="market-history">
      <button
        type="button"
        className="text-link"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open
          ? fa
            ? 'بستن تاریخچه'
            : 'Close history'
          : fa
            ? 'مشاهدهٔ تاریخچهٔ گزارش'
            : 'View report history'}
      </button>
      {open && (
        <div aria-live="polite">
          {busy && <p role="status">{fa ? 'در حال دریافت تاریخچه…' : 'Loading history…'}</p>}
          {failed && (
            <p role="alert">
              {fa
                ? 'تاریخچه دریافت نشد. گزارش را ببندید و دوباره باز کنید.'
                : 'History could not be loaded. Close it and open it again.'}
            </p>
          )}
          {page && (
            <>
              {page.items.length ? (
                <ol>
                  {page.items.map((item) => (
                    <li key={item.sequence}>
                      <p>
                        {fa ? 'زمان ثبت در سامانه: ' : 'Recorded in Sayman: '}
                        <time dateTime={item.recordedAt}>{date(item.recordedAt)}</time>
                      </p>
                      {item.origin === 'migrationBaseline' && (
                        <p className="market-history-baseline">
                          {fa
                            ? 'نقطهٔ شروع تاریخچه هنگام ارتقای سامانه؛ سوابق پیش از این زمان در دسترس نیست.'
                            : 'History starts with this system upgrade baseline. Earlier reports are not available.'}
                        </p>
                      )}
                      <MarketObservation item={item.source} now={now} />
                    </li>
                  ))}
                </ol>
              ) : (
                <p>
                  {fa
                    ? 'هنوز گزارشی در تاریخچه ثبت نشده است.'
                    : 'No historical report has been recorded yet.'}
                </p>
              )}
              <nav aria-label={fa ? 'صفحه‌های تاریخچه' : 'History pages'}>
                <button
                  disabled={pages.length === 1 || busy}
                  onClick={() => setPages((v) => v.slice(0, -1))}
                >
                  {fa ? 'گزارش‌های جدیدتر' : 'Newer reports'}
                </button>
                <button
                  disabled={!page.nextBefore || busy}
                  onClick={() => setPages((v) => [...v, page.nextBefore])}
                >
                  {fa ? 'گزارش‌های قدیمی‌تر' : 'Older reports'}
                </button>
              </nav>
            </>
          )}
        </div>
      )}
    </div>
  );
}
