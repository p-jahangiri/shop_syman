'use client';
import { advanceRequestGeneration } from '@sayman/web-shared/lib/data/request-generation.ts';
import { useEffect, useRef, useState } from 'react';
import { useCustomerSession } from '../auth/auth-provider';
import { useI18n } from '../navigation/locale-provider';
import {
  clearanceCustomerSchema,
  type ClearanceCustomer,
} from '@sayman/web-shared/lib/credit/credit-clearance-contract.ts';
export function CustomerCreditClearance({ orderId }: { orderId: string }) {
  const auth = useCustomerSession(),
    { locale } = useI18n(),
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en),
    owner = auth.status === 'member' ? auth.session!.user.id : null,
    [value, setValue] = useState<{ owner: string; page: ClearanceCustomer } | null>(null),
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
        .fetch('/api/credit/orders/' + orderId + '/clearance', { signal: c.signal })
        .then(async (response) => {
          if (!response.ok) throw Error('Credit authorization unavailable');
          const page = clearanceCustomerSchema.parse(await response.json()),
            now = auth.store.snapshot();
          if (page.orderId !== orderId) throw Error('Unrelated order');
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
  const p = value?.owner === owner ? value.page : null;
  return (
    <section className="card-panel credit-upfront-panel">
      <h2>{text('مجوز مالی و آماده‌سازی چکی', 'Credit authorization and preparation')}</h2>
      <p>
        {text(
          'دریافت پیش‌پرداخت و تأیید همهٔ چک‌ها پیش‌نیاز مجوز نهایی است. فروشگاه اعتبار شواهد را پیش از آماده‌سازی و ارسال دوباره بررسی می‌کند.',
          'The final authorization requires the upfront receipt and approval of every cheque. The store checks the current evidence again before packing and dispatch.',
        )}
      </p>
      <button onClick={() => setRefresh((n) => n + 1)}>
        {text('بررسی مجوز مالی', 'Refresh credit authorization')}
      </button>
      {failed ? (
        <p role="alert">
          {text(
            'مجوز مالی خوانده نشد؛ دوباره تلاش کنید.',
            'The credit authorization could not be loaded. Retry.',
          )}
        </p>
      ) : !p ? (
        <p role="status">{text('در حال دریافت…', 'Loading…')}</p>
      ) : (
        <>
          <p role="status">
            {p.orderState === 'Fulfilled'
              ? text('تحویل سفارش ثبت شده است.', 'Order delivery has been recorded.')
              : p.effective
                ? text(
                    'مجوز مالی معتبر ثبت شده؛ آماده‌سازی و ارسال در انبار پیگیری می‌شود.',
                    'A current credit authorization is recorded. Warehouse preparation and dispatch are tracked separately.',
                  )
                : p.current
                  ? text(
                      'مجوز پیشین باطل شده یا شواهد آن تغییر کرده است؛ ارسال به بررسی مجدد نیاز دارد.',
                      'The previous authorization was revoked or its evidence changed. Dispatch requires renewed review.',
                    )
                  : text(
                      'در انتظار ثبت مجوز نهایی مالی فروشگاه.',
                      'Awaiting the store’s final credit authorization.',
                    )}
          </p>
          {p.current && (
            <p>
              {text('آخرین ثبت مجوز: ', 'Last authorization record: ')}
              {new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: 'Asia/Tehran',
              }).format(new Date(p.current.recordedAt))}
            </p>
          )}
          <small>
            {text(
              'این وضعیت تأیید بانکی یا وصول همهٔ چک‌ها نیست.',
              'This status does not confirm bank settlement or collection of every cheque.',
            )}
          </small>
        </>
      )}
    </section>
  );
}
