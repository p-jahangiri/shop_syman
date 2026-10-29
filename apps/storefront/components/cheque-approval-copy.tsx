import { formatToman } from '../lib/money';
import type { ApprovalItem, ApprovalPage } from '../lib/cheque-approval-contract';
export function ChequeApprovalItems({
  page,
  locale,
  unit = 'toman',
}: {
  page: ApprovalPage;
  locale: 'fa' | 'en';
  unit?: 'rial' | 'toman';
}) {
  const t = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const money = (v: string) =>
    (unit === 'rial'
      ? new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-GB').format(BigInt(v))
      : formatToman(v, locale)) +
    ' ' +
    (unit === 'rial' ? t('ریال', 'rial') : t('تومان', 'toman'));
  const state = (x: ApprovalItem) =>
    x.cheque === null
      ? t('هنوز دریافت نشده', 'Not yet received')
      : x.approvedForCurrentCheque
        ? t('نسخهٔ جاری چک به‌صورت دستی تأیید شده', 'Current cheque version manually approved')
        : x.current?.state === 'Revoked'
          ? t('گواهی تأیید باطل شده', 'Manual approval revoked')
          : x.current?.state === 'Approved'
            ? t(
                'وضعیت چک تغییر کرده؛ بازبینی دوباره لازم است',
                'Cheque status changed; review required',
              )
            : t('منتظر تأیید دستی', 'Awaiting manual approval');
  return (
    <>
      <p>
        {page.allChequesApproved
          ? t(
              'همهٔ چک‌های برنامهٔ جاری تأیید دستی معتبر دارند.',
              'All cheques in the current schedule have valid manual approvals.',
            )
          : t(
              'تأیید معتبر همهٔ چک‌ها هنوز کامل نشده است.',
              'Valid approval of all cheques is still incomplete.',
            )}
      </p>
      <ol className="credit-approval-items">
        {page.items.map((x) => (
          <li key={x.sequence}>
            <strong>
              {t('چک', 'Cheque')}{' '}
              {new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en').format(x.sequence)} ·{' '}
              {money(x.amountRial)}
            </strong>
            <p>
              {new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', {
                dateStyle: 'medium',
                timeZone: 'Asia/Tehran',
              }).format(new Date(x.dueDate + 'T12:00:00Z'))}
            </p>
            <p>{state(x)}</p>
          </li>
        ))}
      </ol>
      {!page.items.length && (
        <p>{t('ابتدا برنامهٔ سررسید باید ثبت شود.', 'A dated schedule must first be recorded.')}</p>
      )}
      <p>
        {t(
          'تأیید انسانی چک، تأیید بانک یا وصول وجه نیست؛ مجوز نهایی ارسال جداگانه بررسی می‌شود.',
          'Manual cheque approval is not bank verification or collection. Final dispatch authorization is reviewed separately.',
        )}
      </p>
    </>
  );
}
