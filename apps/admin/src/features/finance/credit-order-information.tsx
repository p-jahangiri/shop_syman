import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/api';
import { adminViewRevision } from '../../auth/admin-view-authority';
import { Busy, ErrorBox } from '../../components/ui';
import { creditOrderDetailSchema } from '@sayman/web-shared/lib/credit/credit-order-contract.ts';
const amount = (v: string) => new Intl.NumberFormat('fa-IR').format(BigInt(v)) + ' ریال',
  date = (v: string) =>
    new Intl.DateTimeFormat('fa-IR', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Tehran',
    }).format(new Date(v));
export function AdminCreditOrderInformation({
  viewerId,
  ownerId,
  orderId,
  version,
}: {
  viewerId: string;
  ownerId: string;
  orderId: string;
  version: string;
}) {
  const query = useQuery({
    queryKey: ['admin', 'credit-order', viewerId, ownerId, orderId, version],
    queryFn: async () => {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(ownerId) || !/^[a-f0-9]{32}$/.test(orderId))
        throw Error('شناسهٔ سفارش معتبر نیست.');
      const authority = adminViewRevision(),
        data = creditOrderDetailSchema.parse(
          await api('/admin/credit-orders/' + ownerId + '/' + orderId),
        );
      if (authority !== adminViewRevision() || data.order.summary.id !== orderId)
        throw Error('دسترسی یا نسخهٔ سفارش تغییر کرده است.');
      return data;
    },
    refetchOnWindowFocus: false,
  });
  if (query.isPending) return <Busy />;
  const data = query.data,
    q = data?.calculation.ordinaryQuote ?? data?.calculation.acceptedQuote;
  return (
    <section className="credit-order-admin">
      <h3>مجوز خرید و اقساط ثبت‌شده</h3>
      <ErrorBox error={query.error} />
      {data && q && (
        <>
          <p className="notice">
            مجوز این سفارش استفاده شده و پس از لغو یا انقضا هم دوباره قابل استفاده نمی‌شود. ثبت
            سفارش، وصول چک یا دریافت پیش‌پرداخت را تأیید نمی‌کند.
          </p>
          <dl className="charge-details">
            <dt>طرح زمان محاسبه</dt>
            <dd
              lang={data.calculation.locale}
              dir={data.calculation.locale === 'fa' ? 'rtl' : 'ltr'}
            >
              {q.selectedPlan?.name}
            </dd>
            <dt>مبنای سقف</dt>
            <dd>
              {data.credit.limitBasis === 'PayableTotalRial'
                ? 'کل تعهد خرید'
                : 'جمع چک‌ها بدون پیش‌پرداخت'}
            </dd>
            <dt>سقف تأییدشده</dt>
            <dd>{amount(data.credit.limitAmountRial)}</dd>
            <dt>مبلغ مبنای مصرف</dt>
            <dd>{amount(data.credit.assessedAmountRial)}</dd>
            <dt>پیش‌پرداخت محاسبه</dt>
            <dd>{amount(q.downPaymentRial)}</dd>
            <dt>زمان اتصال مجوز به سفارش</dt>
            <dd>{date(data.credit.acceptedAt)}</dd>
          </dl>
          <ol>
            {q.installments.map((x) => (
              <li key={x.sequence}>
                چک {x.sequence.toLocaleString('fa-IR')} · ماه{' '}
                {x.monthOffset.toLocaleString('fa-IR')} — {amount(x.amountRial)}
              </li>
            ))}
          </ol>
          <p>
            فاصلهٔ ماه‌ها از محاسبهٔ تأییدشده نگه‌داری شده است؛ تاریخ قطعی سررسید و وصول در گردش
            مالی جدا ثبت می‌شوند.
          </p>
          <details>
            <summary>شناسه‌های پیگیری</summary>
            <p>
              پرونده: <bdi>{data.credit.applicationId}</bdi>
            </p>
            <p>
              مجوز: <bdi>{data.credit.scopeId}</bdi>
            </p>
            <p>
              محاسبه: <bdi>{data.credit.creditQuoteId}</bdi>
            </p>
          </details>
        </>
      )}
    </section>
  );
}
