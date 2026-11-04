import type { CreditScheduleCalculation } from '../../lib/credit/credit-schedule-contract';
import { formatToman } from '../../lib/shared/money';
// Due dates are civil Tehran days, not midnight-UTC instants. Formatting their
// noon UTC representation with UTC preserves exactly the stored Gregorian day.
export function CreditScheduleCopy({
  value,
  locale,
  unit = 'toman',
}: {
  value: CreditScheduleCalculation;
  locale: 'fa' | 'en';
  unit?: 'rial' | 'toman';
}) {
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en),
    date = (day: string) =>
      new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', {
        dateStyle: 'medium',
        timeZone: 'UTC',
      }).format(new Date(day + 'T12:00:00Z')),
    money = (amount: string) =>
      unit === 'rial'
        ? new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-GB').format(BigInt(amount)) +
          ' ' +
          text('ریال', 'rial')
        : formatToman(amount, locale) + ' ' + text('تومان', 'toman');
  return (
    <div className="credit-schedule-copy">
      <p>
        {text('ماه‌شماری', 'Month calendar')}:{' '}
        {value.calendarKind === 'Persian' ? text('شمسی', 'Persian') : text('میلادی', 'Gregorian')} ·{' '}
        {text('تاریخ مبنا', 'Anchor date')}: {date(value.anchorDate)}
      </p>
      <dl>
        <dt>{text('پیش‌پرداخت طرح', 'Plan down payment')}</dt>
        <dd>{money(value.planDownPaymentRial)}</dd>
        <dt>{text('هزینه‌های خارج از چک', 'Charges outside the cheques')}</dt>
        <dd>{money(value.chargesOutsideChequesRial)}</dd>
        <dt>{text('کل پرداخت اولیه', 'Total upfront amount')}</dt>
        <dd>{money(value.upfrontTotalRial)}</dd>
        <dt>{text('جمع چک‌ها', 'Total cheques')}</dt>
        <dd>{money(value.installmentsTotalRial)}</dd>
        <dt>{text('مبلغ نهایی سفارش', 'Final order total')}</dt>
        <dd>{money(value.payableTotalRial)}</dd>
      </dl>
      {value.lines.length ? (
        <ol>
          {value.lines.map((line) => (
            <li key={line.sequence}>
              <strong>
                {text('چک', 'Cheque')}{' '}
                {line.sequence.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-GB')}
              </strong>
              <span>{date(line.dueDate)}</span>
              <span>{money(line.amountRial)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p>
          {text(
            'این محاسبه چک قسطی ندارد؛ کل مبلغ در پرداخت اولیه قرار دارد.',
            'This calculation has no installment cheques; the whole amount is upfront.',
          )}
        </p>
      )}
      <p>
        {text(
          'سررسیدها روز مدنی تهران هستند. این برنامه، تأیید دریافت پیش‌پرداخت یا وصول چک نیست.',
          'Due dates are civil days in Tehran. This plan does not confirm down-payment receipt or cheque collection.',
        )}
      </p>
    </div>
  );
}
