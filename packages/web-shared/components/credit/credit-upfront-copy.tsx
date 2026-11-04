import type { UpfrontSummary } from '../../lib/credit/credit-upfront-contract';
import { formatToman } from '../../lib/shared/money';
export const upfrontStateLabels = {
  ReceiptConfirmed: {
    fa: 'دریافت کامل به تأیید مالی رسیده',
    en: 'Full receipt confirmed by finance',
  },
  NoUpfrontDue: {
    fa: 'نیازی به پیش‌پرداخت نیست؛ تأیید شده',
    en: 'No upfront amount due, confirmed',
  },
  Revoked: { fa: 'گواهی دریافت باطل شده', en: 'Confirmation revoked' },
};
export function UpfrontSummaryCopy({
  value,
  locale,
  unit = 'toman',
}: {
  value: UpfrontSummary;
  locale: 'fa' | 'en';
  unit?: 'toman' | 'rial';
}) {
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en),
    money = (v: string) =>
      unit === 'rial'
        ? new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-GB').format(BigInt(v))
        : formatToman(v, locale),
    date = new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Tehran',
    }).format(new Date(value.occurredAt));
  return (
    <article className="credit-upfront-summary">
      <h3>{upfrontStateLabels[value.state][locale]}</h3>
      <dl>
        <dt>{text('پیش‌پرداخت لازمِ سفارش', 'Required order upfront amount')}</dt>
        <dd>
          {money(value.requiredAmountRial)}{' '}
          {unit === 'rial' ? text('ریال', 'rial') : text('تومان', 'toman')}
        </dd>
        <dt>{text('مبلغ مورد تأیید این گواهی', 'Amount acknowledged by this confirmation')}</dt>
        <dd>
          {money(value.acknowledgedAmountRial)}{' '}
          {unit === 'rial' ? text('ریال', 'rial') : text('تومان', 'toman')}
        </dd>
        <dt>{text('زمان وقوع به وقت تهران', 'Occurrence, Tehran time')}</dt>
        <dd>{date}</dd>
      </dl>
      <p>
        {text(
          'ثبت انسانیِ مدیر مالی؛ تأیید مستقیم بانک یا پرداخت نقدی کامل نیست.',
          'A finance staff attestation, not direct bank verification or full cash payment.',
        )}
      </p>
    </article>
  );
}
