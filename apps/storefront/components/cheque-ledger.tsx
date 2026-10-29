'use client';
import { advanceRequestGeneration } from '../lib/request-generation';
import { useEffect, useRef, useState } from 'react';
import { useCustomerSession } from './auth-provider';
import { useI18n } from './locale-provider';
import { chequeLedgerPageSchema, type ChequeLedgerPage } from '../lib/cheque-ledger-contract';
import { ChequeSummaryCopy } from './cheque-ledger-copy';
export function CustomerChequeLedger({ orderId }: { orderId: string }) {
  const auth = useCustomerSession(),
    { locale } = useI18n(),
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en),
    owner = auth.status === 'member' ? auth.session!.user.id : null,
    [value, setValue] = useState<{ owner: string; page: ChequeLedgerPage } | null>(null),
    [failed, setFailed] = useState(false),
    [refresh, setRefresh] = useState(0),
    generation = useRef(0);
  useEffect(() => {
    const ticket = ++generation.current,
      c = new AbortController();
    setValue(null);
    setFailed(false);
    if (owner)
      void auth.store
        .fetch('/api/credit/orders/' + orderId + '/cheques', { signal: c.signal })
        .then(async (r) => {
          if (!r.ok) throw Error('Private cheque history unavailable');
          const page = chequeLedgerPageSchema.parse(await r.json()),
            now = auth.store.snapshot();
          if (page.orderId !== orderId || page.canReceive) throw Error('Wrong owned cheque page');
          if (
            !c.signal.aborted &&
            ticket === generation.current &&
            now.status === 'member' &&
            now.session?.user.id === owner
          )
            setValue({ owner, page });
        })
        .catch(() => {
          if (!c.signal.aborted && ticket === generation.current) setFailed(true);
        });
    return () => {
      advanceRequestGeneration(generation);
      c.abort();
    };
  }, [owner, orderId, auth.store, refresh]);
  if (!owner) return null;
  const page = value?.owner === owner ? value.page : null;
  return (
    <section className="card-panel cheque-ledger-panel">
      <h2>{text('پیگیری چک‌های ثبت‌شده', 'Recorded cheque tracking')}</h2>
      <p>
        {text(
          'این وضعیت‌ها گزارش ثبت‌شدهٔ مدیر مالی هستند؛ تأیید مستقیم بانک یا پرداخت سفارش محسوب نمی‌شوند.',
          'These statuses are finance staff records. They are not direct bank verification or confirmation that the order is paid.',
        )}
      </p>
      <button onClick={() => setRefresh((n) => n + 1)}>
        {text('بررسی وضعیت چک‌ها', 'Refresh cheques')}
      </button>
      {failed ? (
        <p role="alert">
          {text(
            'اطلاعات چک‌ها دریافت نشد؛ دوباره تلاش کنید.',
            'Cheque records could not be loaded. Retry.',
          )}
        </p>
      ) : !page ? (
        <p role="status">{text('در حال دریافت…', 'Loading…')}</p>
      ) : page.items.length ? (
        page.items.map((item) => <ChequeSummaryCopy key={item.id} value={item} locale={locale} />)
      ) : (
        <p>
          {text(
            'هنوز دریافت چکی برای این سفارش ثبت نشده است.',
            'No cheque receipt has been recorded for this order.',
          )}
        </p>
      )}
    </section>
  );
}
