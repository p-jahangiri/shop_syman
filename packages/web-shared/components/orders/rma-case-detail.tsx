import type { RmaDetail } from '../../lib/orders/rma-contract';
export const returnStateNames = {
  submitted: ['ثبت‌شده', 'Submitted'],
  reviewing: ['در حال بررسی', 'Under review'],
  reviewed: ['بررسی‌شده', 'Reviewed'],
  withdrawn: ['منصرف‌شده', 'Withdrawn'],
} as const;
export function ReturnFinancialNotice({ locale = 'fa' }: { locale?: 'fa' | 'en' }) {
  return (
    <p className="notice">
      {locale === 'fa'
        ? 'این بخش فقط ثبت و بررسی درخواست است. ثبت یا بررسی درخواست، تأیید مرجوعی کالا، دریافت انبار، بازپرداخت، ارسال مجدد یا لغو سفارش نیست. بازپرداخت تا اتصال درگاه در دسترس نیست.'
        : 'This service records and reviews requests. A request or review does not approve a physical return, warehouse receipt, refund, reshipment or order cancellation. Refunds remain unavailable until payment-provider integration.'}
    </p>
  );
}
export function ReturnCaseDetail({
  detail,
  locale = 'fa',
  staff = false,
}: {
  detail: RmaDetail;
  locale?: 'fa' | 'en';
  staff?: boolean;
}) {
  const copy = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const date = (at: string) =>
    new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(at));
  return (
    <section aria-label={copy('جزئیات درخواست', 'Request details')}>
      <h3>{detail.case.reference}</h3>
      <p>{returnStateNames[detail.case.state][locale === 'fa' ? 0 : 1]}</p>
      <h4>{copy('دلیل مشتری', 'Customer reason')}</h4>
      <p className="preserve-lines">{detail.reason}</p>
      <ul>
        {detail.lines.map((l) => (
          <li key={l.lineKey}>
            {l.name} · {l.label} · <code dir="ltr">{l.sku}</code> · {copy('تعداد', 'Quantity')}:{' '}
            {l.quantity}
          </li>
        ))}
      </ul>
      <details>
        <summary>
          {copy('شرایط ثبت‌شده هنگام درخواست', 'Policy retained with this request')}
        </summary>
        <p className="preserve-lines">
          {locale === 'fa' ? detail.policy.conditionsFa : detail.policy.conditionsEn}
        </p>
        {detail.policy.windowMode === 'deliveryDays' && (
          <p>
            {detail.policy.windowDays}{' '}
            {copy('روز از تحویل/آماده‌شدن', 'days from delivery/availability')}
          </p>
        )}
      </details>
      <h4>{copy('تاریخچهٔ تغییرات', 'History')}</h4>
      <ol>
        {detail.events.map((e) => (
          <li key={e.sequence}>
            <time dateTime={e.at}>{date(e.at)}</time> ·{' '}
            {returnStateNames[e.state][locale === 'fa' ? 0 : 1]}
            {e.outcome &&
              ` · ${e.outcome === 'followUp' ? copy('نیازمند پیگیری', 'Follow-up needed') : copy('رد درخواست', 'Declined')}`}
            {e.message && <p className="preserve-lines">{e.message}</p>}
            {staff && e.staffNote && (
              <p className="preserve-lines">
                <strong>{copy('یادداشت خصوصی مدیر', 'Private staff note')}: </strong>
                {e.staffNote}
              </p>
            )}
          </li>
        ))}
      </ol>
      <ReturnFinancialNotice locale={locale} />
    </section>
  );
}
