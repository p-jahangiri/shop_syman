'use client';
import { useEffect, useState } from 'react';
import Image from './content-image';
import Link from './localized-link';
import { Button } from './ui';
import { useShop } from './shop-context';
import { useI18n } from './locale-provider';
import { groupAcceptedCartLines } from '@/lib/cart-v2-contract';

export function AcceptedCartGroups({ compact = false }: { compact?: boolean }) {
  const { serverCart, cartBusy, loadError, removeAcceptedGroup } = useShop();
  const { locale, digits, toman } = useI18n(),
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const [confirm, setConfirm] = useState<{ agreementId: string; version: string } | null>(null),
    [ack, setAck] = useState(false),
    [now, setNow] = useState(0);
  useEffect(() => {
    setConfirm(null);
    setAck(false);
  }, [serverCart?.version]);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!serverCart?.offerLines.length) return null;
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Tehran',
    }).format(new Date(value));
  return (
    <section
      id={compact ? undefined : 'accepted-offers'}
      className="card-panel accepted-cart-groups"
      aria-labelledby={compact ? undefined : 'accepted-cart-heading'}
    >
      <h2 id={compact ? undefined : 'accepted-cart-heading'}>
        {text('پیشنهادهای پذیرفته‌شده در سبد', 'Accepted offers in your cart')}
      </h2>
      <p className="notice">
        {text(
          'تعداد و قیمت این اقلام از شرایط پذیرفته‌شده آمده‌اند. برای بررسی امکان ثبت سفارش موقت، مبلغ و شرایط جاری را مرور کنید. پرداخت در دسترس نیست.',
          'These quantities and prices come from accepted terms. Review current amounts and conditions to check temporary order eligibility. Payment is unavailable.',
        )}
      </p>
      {groupAcceptedCartLines(serverCart.offerLines).map((group) => {
        const first = group.lines[0],
          review =
            confirm?.agreementId === group.agreementId && confirm.version === serverCart.version;
        return (
          <article className="accepted-cart-group" key={group.agreementId}>
            <div className="sourcing-heading">
              <h3>{text('اقلام یک پیشنهاد پذیرفته‌شده', 'Items from one accepted offer')}</h3>
              <Link className="text-link" href={'/sourcing/' + first.requestId}>
                {text('مشاهدهٔ درخواست و شرایط', 'View request and terms')}
              </Link>
            </div>
            {group.lines.map((line) => (
              <div className="cart-line" key={line.lineId}>
                {!compact && line.imageUrl && (
                  <Image src={line.imageUrl} alt={line.name} width={90} height={90} />
                )}
                <div className="cart-line-info">
                  <strong>{line.name}</strong>
                  <small>{line.label}</small>
                  <small>
                    <bdi>{line.sku}</bdi> · {text('تعداد ثابت', 'Fixed quantity')}:{' '}
                    {digits(line.quantity)}
                  </small>
                  <p>
                    {text('قیمت هر واحد', 'Unit price')}: {toman(line.unitPriceRial)}{' '}
                    {text('تومان', 'toman')}
                  </p>
                  <strong>
                    {text('جمع این ردیف', 'Line total')}: {toman(line.lineTotalRial)}{' '}
                    {text('تومان', 'toman')}
                  </strong>
                  {!compact && line.warranty && (
                    <details>
                      <summary>{text('گارانتی همین پیشنهاد', 'Warranty in this offer')}</summary>
                      <p className="preserve-lines">{line.warranty}</p>
                    </details>
                  )}
                  {line.issue && (
                    <p className="field-error" role="status">
                      {text(
                        'شرایط این ردیف به بررسی تازه نیاز دارد؛ درخواست را پیگیری کنید.',
                        'This entry needs a fresh review. Follow up on its request.',
                      )}
                    </p>
                  )}
                </div>
              </div>
            ))}
            {!compact && (
              <p className="small-note">
                {text('اعتبار قیمت پذیرفته‌شده تا', 'Accepted price valid until')}{' '}
                <time dateTime={first.purchaseUntil}>{date(first.purchaseUntil)}</time> ·{' '}
                {text('مهلت نگه‌داری ثبت‌شده هنگام افزودن', 'Hold deadline recorded when added')}:{' '}
                <time dateTime={first.allocationExpiresAt}>{date(first.allocationExpiresAt)}</time>
                {now > 0 && Date.parse(first.allocationExpiresAt) <= now && (
                  <>
                    {' '}
                    ·{' '}
                    {text(
                      'مهلت ثبت‌شده گذشته است؛ وضعیت جاری را بازخوانی کنید.',
                      'The recorded deadline has passed. Refresh the current state.',
                    )}
                  </>
                )}
              </p>
            )}
            {removeAcceptedGroup &&
              !compact &&
              (review ? (
                <div className="notice">
                  <p>
                    {text(
                      'تمام اقلام همین پیشنهاد از سبد حذف شوند؟ این اقدام تخصیص انبار یا درخواست تأمین را لغو نمی‌کند.',
                      'Remove all items of this offer from the cart? This does not cancel its stock allocation or supply request.',
                    )}
                  </p>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={ack}
                      disabled={cartBusy || loadError}
                      onChange={(event) => setAck(event.target.checked)}
                    />
                    <span>
                      {text(
                        'حذف کامل همین گروه از سبد را تأیید می‌کنم.',
                        'I confirm removing this entire group from the cart.',
                      )}
                    </span>
                  </label>
                  <div className="order-action-row">
                    <Button
                      disabled={!ack || cartBusy || loadError}
                      onClick={() => {
                        if (confirm && ack)
                          void removeAcceptedGroup(group.agreementId, confirm.version);
                      }}
                    >
                      {text('حذف کامل این پیشنهاد از سبد', 'Remove this offer from cart')}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={cartBusy}
                      onClick={() => {
                        setConfirm(null);
                        setAck(false);
                      }}
                    >
                      {text('انصراف', 'Keep items')}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="outline"
                  disabled={cartBusy || loadError || !serverCart.version}
                  onClick={() => {
                    if (serverCart.version) {
                      setConfirm({ agreementId: group.agreementId, version: serverCart.version });
                      setAck(false);
                    }
                  }}
                >
                  {text('حذف گروه پیشنهاد از سبد', 'Remove offer group')}
                </Button>
              ))}
          </article>
        );
      })}
    </section>
  );
}
