'use client';
import { advanceRequestGeneration } from '../lib/request-generation';
import { useEffect, useRef, useState } from 'react';
import { useCustomerSession } from './auth-provider';
import { useI18n } from './locale-provider';
import { upfrontCustomerSchema } from '../lib/credit-upfront-contract';
import type { z } from '@/lib/schema-runtime';
import { UpfrontSummaryCopy } from './credit-upfront-copy';
export function CustomerCreditUpfront({ orderId }: { orderId: string }) {
  const auth = useCustomerSession(),
    { locale } = useI18n(),
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en),
    owner = auth.status === 'member' ? auth.session!.user.id : null,
    [value, setValue] = useState<{
      owner: string;
      page: z.infer<typeof upfrontCustomerSchema>;
    } | null>(null),
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
        .fetch('/api/credit/orders/' + orderId + '/upfront', { signal: c.signal })
        .then(async (response) => {
          if (!response.ok) throw Error('Upfront unavailable');
          const page = upfrontCustomerSchema.parse(await response.json()),
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
  const page = value?.owner === owner ? value.page : null;
  return (
    <section className="card-panel credit-upfront-panel">
      <h2>{text('وضعیت پیش‌پرداخت سفارش چکی', 'Cheque order upfront status')}</h2>
      <p>
        {text(
          'ثبت دریافت پیش‌پرداخت به‌تنهایی سفارش را آمادهٔ ارسال نمی‌کند.',
          'An upfront receipt record alone does not authorize dispatch.',
        )}
      </p>
      <button onClick={() => setRefresh((n) => n + 1)}>
        {text('بررسی وضعیت پیش‌پرداخت', 'Refresh upfront status')}
      </button>
      {failed ? (
        <p role="alert">
          {text(
            'وضعیت پیش‌پرداخت دریافت نشد؛ دوباره تلاش کنید.',
            'Upfront status could not be loaded. Retry.',
          )}
        </p>
      ) : !page ? (
        <p role="status">{text('در حال دریافت…', 'Loading…')}</p>
      ) : page.current ? (
        <UpfrontSummaryCopy value={page.current} locale={locale} />
      ) : (
        <p>
          {text(
            'هنوز گواهی دریافت کامل یا تأیید نبود نیاز به پیش‌پرداخت ثبت نشده است.',
            'No full receipt or no-upfront-due confirmation has been recorded.',
          )}
        </p>
      )}
    </section>
  );
}
