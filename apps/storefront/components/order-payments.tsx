'use client';
import { advanceRequestGeneration } from '../lib/request-generation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CreditCard } from 'lucide-react';
import { useCustomerSession } from './auth-provider';
import { useI18n } from './locale-provider';
import { Button } from './ui';
import { readCustomerPaymentPage, type PaymentPage } from '@/lib/payment-contract';
const states = {
  created: ['درخواست پرداخت ثبت شده', 'Payment request recorded'],
  initiating: ['نتیجهٔ آغاز پرداخت در حال بررسی است', 'Payment initiation is being checked'],
  pending: ['در انتظار تأیید نتیجهٔ درگاه', 'Awaiting gateway verification'],
  verified: ['پرداخت تأییدشده', 'Verified payment'],
  review: ['نیازمند بررسی فروشگاه', 'Store review required'],
  failed: ['پرداخت ناموفق ثبت شده', 'Payment recorded as unsuccessful'],
  cancelled: ['پرداخت لغوشده', 'Cancelled payment'],
} as const;
export function CustomerPaymentHistory({ orderId }: { orderId: string }) {
  const auth = useCustomerSession(),
    { locale, toman, t } = useI18n(),
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en),
    owner = auth.session?.user.id;
  const [data, setData] = useState<PaymentPage | null>(null),
    [busy, setBusy] = useState(true),
    [failed, setFailed] = useState(false),
    [refresh, setRefresh] = useState(0);
  const generation = useRef(0),
    controller = useRef<AbortController | null>(null);
  const load = useCallback(
    async (
      cursor: string | null,
      reset: boolean,
      ticket: number,
      previous: PaymentPage['items'] = [],
    ) => {
      controller.current?.abort();
      const signal = new AbortController();
      controller.current = signal;
      setBusy(true);
      setFailed(false);
      try {
        const response = await auth.store.fetch(
          '/api/payments/orders/' +
            orderId +
            (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
          { signal: signal.signal },
        );
        if (!response.ok) throw Error('Payment history unavailable');
        const page = readCustomerPaymentPage(await response.json(), orderId);
        if (
          ticket !== generation.current ||
          signal.signal.aborted ||
          auth.store.snapshot().session?.user.id !== owner
        )
          return;
        const items = reset ? page.items : [...previous, ...page.items];
        if (new Set(items.map((i) => i.id)).size !== items.length)
          throw Error('Duplicate payment history');
        setData({ ...page, items });
      } catch {
        if (ticket === generation.current && !signal.signal.aborted) setFailed(true);
      } finally {
        if (ticket === generation.current && !signal.signal.aborted) setBusy(false);
      }
    },
    [auth.store, orderId, owner],
  );
  useEffect(() => {
    const ticket = ++generation.current;
    setData(null);
    if (owner && /^[a-f0-9]{32}$/.test(orderId)) void load(null, true, ticket);
    else {
      setBusy(false);
      setFailed(true);
    }
    return () => {
      advanceRequestGeneration(generation);
      controller.current?.abort();
    };
  }, [owner, orderId, refresh, load]);
  const date = (x: string) =>
    new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Tehran',
    }).format(new Date(x));
  const amount = (x: string) => toman(BigInt(x)) + ' ' + t('تومان');
  return (
    <section className="card-panel">
      <div className="order-action-row">
        <h2>
          <CreditCard size={20} /> {text('سوابق پرداخت سفارش', 'Order payment history')}
        </h2>
        <Button variant="outline" disabled={busy} onClick={() => setRefresh((n) => n + 1)}>
          {text('بررسی پرداخت‌ها', 'Refresh payments')}
        </Button>
      </div>
      <p className="small-note">
        {text(
          'ثبت درخواست یا بازگشت از درگاه، تأیید دریافت وجه نیست. نتیجهٔ تأییدشدهٔ سرور در این بخش نمایش داده می‌شود.',
          'A request or return from the gateway does not confirm receipt of funds. This history shows the server-verified outcome.',
        )}
      </p>
      {busy && !data ? (
        <p role="status">{text('در حال بررسی پرداخت‌ها…', 'Checking payments…')}</p>
      ) : null}
      {failed && (
        <p role="alert">
          {text(
            'سوابق پرداخت فعلاً خوانده نشد؛ دوباره بررسی کنید.',
            'Payment history could not be loaded. Please retry.',
          )}
        </p>
      )}
      {data && data.items.length === 0 && (
        <p>
          {text(
            'هنوز تلاشی برای پرداخت این سفارش ثبت نشده است.',
            'No payment attempt has been recorded for this order.',
          )}
        </p>
      )}
      {data?.items.map((item) => (
        <article className="customer-order-item" key={item.id}>
          <div>
            <h3>{states[item.state][locale === 'fa' ? 0 : 1]}</h3>
            <p>
              {amount(item.amountRial)} · {date(item.createdAt)}
            </p>
            <p className="small-note">
              {text('شناسهٔ پیگیری فروشگاه', 'Store tracking ID')}: <bdi>{item.id}</bdi>
            </p>
            {item.containsDemo && (
              <p className="small-note">
                {text(
                  'دادهٔ نمونهٔ توسعه؛ تراکنش واقعی نیست.',
                  'Development sample data; not a real transaction.',
                )}
              </p>
            )}
            {item.verifiedAt && (
              <p>
                {text('تأیید سرور (تهران)', 'Server verification (Tehran time)')}:{' '}
                {date(item.verifiedAt)}
              </p>
            )}
            {item.state === 'review' && (
              <p>
                {text(
                  'این نتیجه برای تطبیق نیازمند بررسی فروشگاه است؛ پیش از تعیین تکلیف، پرداخت دوباره انجام ندهید.',
                  'The store needs to reconcile this result. Please wait for resolution before paying again.',
                )}
              </p>
            )}
            {item.verifiedAmountRial !== null && item.verifiedAmountRial !== item.amountRial && (
              <p>
                {text('مبلغ گزارش تأیید درگاه', 'Amount in gateway verification')}:{' '}
                {amount(item.verifiedAmountRial)}
              </p>
            )}
          </div>
        </article>
      ))}
      {data?.nextCursor && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void load(data.nextCursor, false, generation.current, data.items)}
        >
          {busy ? text('در حال دریافت…', 'Loading…') : text('۵۰ مورد بعدی', 'Next 50 attempts')}
        </Button>
      )}
    </section>
  );
}
