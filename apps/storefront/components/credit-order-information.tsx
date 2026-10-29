'use client';
import { CustomerCreditClearance } from './credit-clearance';
import { CustomerChequeApprovals } from './cheque-approvals';
import { useEffect, useState } from 'react';
import { CustomerCreditUpfront } from './credit-upfront';
import { CustomerChequeLedger } from './cheque-ledger';
import { CustomerCreditSchedule } from './credit-schedule';
import { useCustomerSession } from './auth-provider';
import { useI18n } from './locale-provider';
import { creditOrderDetailSchema, type CreditOrderDetail } from '../lib/credit-order-contract';
import { CreditCheckoutQuoteSnapshot } from './credit-checkout-quote-panel';
import { formatToman } from '../lib/money';
export function CreditOrderInformation({ orderId }: { orderId: string }) {
  const auth = useCustomerSession(),
    { locale } = useI18n(),
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en),
    owner = auth.status === 'member' ? auth.session!.user.id : null;
  const [value, setValue] = useState<{ owner: string; data: CreditOrderDetail } | null>(null),
    [failed, setFailed] = useState(false),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    setValue(null);
    setFailed(false);
    const controller = new AbortController();
    if (owner)
      void auth.store
        .fetch('/api/credit-orders/' + orderId, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw Error('Credit order unavailable');
          const data = creditOrderDetailSchema.parse(await response.json()),
            current = auth.store.snapshot();
          if (data.order.summary.id !== orderId) throw Error('Wrong order');
          if (
            !controller.signal.aborted &&
            current.status === 'member' &&
            current.session?.user.id === owner
          )
            setValue({ owner, data });
        })
        .catch(() => {
          if (!controller.signal.aborted) setFailed(true);
        });
    return () => controller.abort();
  }, [orderId, owner, auth.store, refresh]);
  if (!owner) return null;
  const data = value?.owner === owner ? value.data : null;
  return (
    <>
      <section className="card-panel credit-order-information">
        <h2>{text('تأییدیه و شرایط سفارش چکی', 'Cheque order scope and conditions')}</h2>
        {failed ? (
          <>
            <p role="alert">
              {text('اطلاعات چکی خوانده نشد.', 'Cheque order details could not be loaded.')}
            </p>
            <button onClick={() => setRefresh((n) => n + 1)}>{text('تلاش دوباره', 'Retry')}</button>
          </>
        ) : !data ? (
          <p role="status">{text('در حال دریافت…', 'Loading…')}</p>
        ) : (
          <>
            <p>
              {text(
                'مجوز این سفارش استفاده شده و با لغو یا انقضای سفارش دوباره قابل استفاده نمی‌شود. ثبت سفارش، وصول چک یا دریافت پیش‌پرداخت را تأیید نمی‌کند.',
                'This order used its purchase scope; cancellation or expiry does not make it reusable. Creating the order does not verify cheque collection or down payment.',
              )}
            </p>
            <dl>
              <dt>{text('مبنای سقف', 'Limit basis')}</dt>
              <dd>
                {data.credit.limitBasis === 'PayableTotalRial'
                  ? text('کل تعهد خرید', 'Total purchase obligation')
                  : text('جمع چک‌ها بدون پیش‌پرداخت', 'Total cheques, excluding down payment')}
              </dd>
              <dt>{text('سقف تأییدشده', 'Approved limit')}</dt>
              <dd>
                {formatToman(data.credit.limitAmountRial, locale)} {text('تومان', 'toman')}
              </dd>
              <dt>{text('مبلغ مبنای مصرف', 'Amount assessed against the scope')}</dt>
              <dd>
                {formatToman(data.credit.assessedAmountRial, locale)} {text('تومان', 'toman')}
              </dd>
            </dl>
            <details>
              <summary>
                {text(
                  'نسخهٔ محاسبه و اقساط زمان ثبت سفارش',
                  'Calculation and cheques retained at order creation',
                )}
              </summary>
              <CreditCheckoutQuoteSnapshot quote={data.calculation} now={Date.now()} />
            </details>
          </>
        )}
      </section>
      <CustomerCreditClearance orderId={orderId} />
      <CustomerCreditSchedule orderId={orderId} />
      <CustomerCreditUpfront orderId={orderId} />
      <CustomerChequeApprovals orderId={orderId} />
      <CustomerChequeLedger orderId={orderId} />
    </>
  );
}
