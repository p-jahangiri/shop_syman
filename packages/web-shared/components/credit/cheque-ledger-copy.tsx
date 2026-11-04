import type { ChequeState, ChequeSummary } from '../../lib/credit/cheque-ledger-contract';
import { formatToman } from '../../lib/shared/money';
export const chequeStateLabels: Record<ChequeState, { fa: string; en: string }> = {
  Received: { fa: 'دریافت‌شده', en: 'Received' },
  Deposited: { fa: 'تحویل به بانک گزارش شده', en: 'Deposit reported' },
  CollectedReported: { fa: 'وصول گزارش‌شده', en: 'Collection reported' },
  BouncedReported: { fa: 'برگشت بانکی گزارش‌شده', en: 'Bounce reported' },
  Withdrawn: { fa: 'برداشت از فرایند بانکی', en: 'Withdrawn from deposit' },
  ReturnedToCustomer: { fa: 'بازگردانده به مشتری', en: 'Returned to customer' },
};
export function ChequeSummaryCopy({
  value,
  locale,
  unit = 'toman',
}: {
  value: ChequeSummary;
  locale: 'fa' | 'en';
  unit?: 'toman' | 'rial';
}) {
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en),
    money =
      unit === 'rial'
        ? new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-GB').format(
            BigInt(value.amountRial),
          )
        : formatToman(value.amountRial, locale),
    date = new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', {
      dateStyle: 'medium',
      timeZone: 'UTC',
    }).format(new Date(value.dueDate + 'T12:00:00Z'));
  return (
    <article className="cheque-ledger-item">
      <h3>
        {text('چک', 'Cheque')} {value.sequence.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-GB')}{' '}
        · {chequeStateLabels[value.state][locale]}
      </h3>
      <p className="cheque-internal-id" dir="ltr">
        {value.internalReference}
      </p>
      <dl>
        <dt>{text('مبلغ', 'Amount')}</dt>
        <dd>
          {money} {unit === 'rial' ? text('ریال', 'rial') : text('تومان', 'toman')}
        </dd>
        <dt>{text('سررسید', 'Due date')}</dt>
        <dd>{date}</dd>
      </dl>
    </article>
  );
}
