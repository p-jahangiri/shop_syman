'use client';
import { advanceRequestGeneration } from '../lib/request-generation';
import { useEffect, useRef, useState } from 'react';
import { useCustomerSession } from './auth-provider';
import { useI18n } from './locale-provider';
import {
  creditSchedulePageSchema,
  creditScheduleHistorySchema,
  type CreditSchedulePage,
  type CreditScheduleHistory,
  type CreditScheduleRevision,
} from '../lib/credit-schedule-contract';
import { CreditScheduleCopy } from './credit-schedule-copy';
function Revision({ value }: { value: CreditScheduleRevision }) {
  const { locale } = useI18n(),
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  return (
    <article>
      <h3>
        {text('نسخهٔ برنامه', 'Schedule revision')}{' '}
        {value.revision.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-GB')}
      </h3>
      <p lang={value.locale} dir={value.locale === 'fa' ? 'rtl' : 'ltr'}>
        {value.planName}
      </p>
      <CreditScheduleCopy value={value.calculation} locale={locale} />
    </article>
  );
}
export function CustomerCreditSchedule({ orderId }: { orderId: string }) {
  const auth = useCustomerSession(),
    { locale } = useI18n(),
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en),
    owner = auth.status === 'member' ? auth.session!.user.id : null;
  const [page, setPage] = useState<{ owner: string; data: CreditSchedulePage } | null>(null),
    [history, setHistory] = useState<{ owner: string; data: CreditScheduleHistory } | null>(null),
    [failed, setFailed] = useState(false),
    [historyFailed, setHistoryFailed] = useState(false),
    [loading, setLoading] = useState(false),
    [refresh, setRefresh] = useState(0);
  const generation = useRef(0),
    historyAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    const ticket = ++generation.current,
      controller = new AbortController();
    setPage(null);
    setHistory(null);
    setLoading(false);
    setFailed(false);
    setHistoryFailed(false);
    historyAbort.current?.abort();
    if (owner)
      void auth.store
        .fetch('/api/credit/orders/' + orderId + '/schedule', { signal: controller.signal })
        .then(async (r) => {
          if (!r.ok) throw Error('Private schedule unavailable');
          const data = creditSchedulePageSchema.parse(await r.json()),
            current = auth.store.snapshot();
          if (data.orderId !== orderId || data.canAmend) throw Error('Wrong owned schedule');
          if (
            !controller.signal.aborted &&
            ticket === generation.current &&
            current.status === 'member' &&
            current.session?.user.id === owner
          )
            setPage({ owner, data });
        })
        .catch(() => {
          if (!controller.signal.aborted && ticket === generation.current) setFailed(true);
        });
    return () => {
      advanceRequestGeneration(generation);
      controller.abort();
      historyAbort.current?.abort();
    };
  }, [orderId, owner, auth.store, refresh]);
  async function loadHistory() {
    if (!owner || loading) return;
    const ticket = generation.current,
      controller = new AbortController();
    historyAbort.current?.abort();
    historyAbort.current = controller;
    setLoading(true);
    setHistoryFailed(false);
    try {
      const prior = history?.owner === owner ? history.data : null,
        path =
          '/api/credit/orders/' +
          orderId +
          '/schedule/history' +
          (prior?.nextRevision ? '?beforeRevision=' + prior.nextRevision : ''),
        r = await auth.store.fetch(path, { signal: controller.signal });
      if (!r.ok) throw Error('History unavailable');
      const data = creditScheduleHistorySchema.parse(await r.json());
      if (data.orderId !== orderId) throw Error('Wrong history');
      const current = auth.store.snapshot();
      if (
        !controller.signal.aborted &&
        ticket === generation.current &&
        current.status === 'member' &&
        current.session?.user.id === owner
      ) {
        const items = prior ? [...prior.items, ...data.items] : data.items;
        if (new Set(items.map((x) => x.id)).size !== items.length) throw Error('Duplicate history');
        setHistory({ owner, data: { ...data, items } });
      }
    } catch {
      if (!controller.signal.aborted && ticket === generation.current) setHistoryFailed(true);
    } finally {
      if (!controller.signal.aborted && ticket === generation.current) setLoading(false);
    }
  }
  if (!owner) return null;
  const value = page?.owner === owner ? page.data : null,
    previous = history?.owner === owner ? history.data : null;
  return (
    <section className="card-panel credit-schedule-panel">
      <h2>{text('برنامهٔ سررسید چک‌ها', 'Cheque due-date plan')}</h2>
      <button disabled={loading} onClick={() => setRefresh((n) => n + 1)}>
        {text('بررسی برنامهٔ تازه', 'Refresh schedule')}
      </button>
      {failed ? (
        <p role="alert">
          {text(
            'برنامه خوانده نشد؛ دوباره دریافت کنید.',
            'The schedule could not be loaded. Refresh and retry.',
          )}
        </p>
      ) : !value ? (
        <p role="status">{text('در حال دریافت…', 'Loading…')}</p>
      ) : (
        <>
          {value.current ? (
            <Revision value={value.current} />
          ) : (
            <p>
              {text(
                'مدیر مالی هنوز برنامهٔ سررسیدی برای این سفارش ثبت نکرده است.',
                'Finance has not recorded a due-date plan for this order yet.',
              )}
            </p>
          )}
          {value.blockers.includes('credit_schedule_instruments_recorded') && (
            <p>
              {text(
                'دریافت چک برای این برنامه ثبت شده و تاریخ‌های آن ثابت‌اند.',
                'A cheque was received against this plan, so its due dates are fixed.',
              )}
            </p>
          )}
          {value.blockers.includes('credit_schedule_order_closed') && (
            <p>
              {text(
                'سفارش برای تنظیم برنامهٔ تازه باز نیست. نسخه‌های ثبت‌شده برای پیگیری حفظ می‌شوند.',
                'This order is closed to new schedule changes. Recorded versions remain available for reference.',
              )}
            </p>
          )}
          {value.current && (
            <details>
              <summary>{text('تاریخچهٔ نسخه‌های برنامه', 'Schedule revision history')}</summary>
              {historyFailed && (
                <p role="alert">
                  {text('تاریخچه دریافت نشد؛ دوباره تلاش کنید.', 'History unavailable. Retry.')}
                </p>
              )}
              {previous?.items.map((item) => (
                <details key={item.id}>
                  <summary>
                    {text('نسخه', 'Revision')}{' '}
                    {item.revision.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-GB')}
                  </summary>
                  <Revision value={item} />
                </details>
              ))}
              {(!previous || previous.nextRevision !== null) && (
                <button disabled={loading} onClick={() => void loadHistory()}>
                  {loading
                    ? text('در حال دریافت…', 'Loading…')
                    : previous
                      ? text('۲۰ نسخهٔ بعدی', 'Next 20 revisions')
                      : text('دریافت تاریخچه', 'Load history')}
                </button>
              )}
            </details>
          )}
        </>
      )}
    </section>
  );
}
