'use client';
import Link from '../navigation/localized-link';
import { useShop } from '../providers/shop-provider';
import { useI18n, useStorefront } from '../navigation/locale-provider';
import { cartTotal } from '@sayman/web-shared/lib/shared/commerce.ts';
import { Button } from '../shared/ui';
import { ArrowLeft } from 'lucide-react';
export function CartAmount() {
  const { cart, serverCart } = useShop();
  const { products } = useStorefront();
  const { t, toman, locale } = useI18n();
  if (serverCart && serverCart.buySubtotalRial === null)
    return <>{locale === 'fa' ? 'نیاز به بررسی' : 'Needs review'}</>;
  return (
    <>
      {toman(serverCart ? serverCart.buySubtotalRial! : cartTotal(cart, products))}{' '}
      <small>{t('تومان')}</small>
    </>
  );
}
export function CartCheckoutLink({ onClick }: { onClick?: () => void }) {
  const { cartIssue, quoteReviewIssue, cartBusy, ready, serverCart } = useShop();
  const { t, locale } = useI18n();
  if (serverCart?.offerLines.length)
    return (
      <>
        <p className="notice">
          {locale === 'fa'
            ? 'مبلغ و شرایط اقلام عادی و توافقی را در مرحلهٔ بعد مرور کنید. امکان ثبت سفارش موقت بر اساس شرایط جاری بررسی می‌شود؛ پرداخت در دسترس نیست.'
            : 'Review ordinary and agreed amounts and conditions in the next step. Temporary order eligibility is checked against current conditions; payment is unavailable.'}
        </p>
        {quoteReviewIssue || cartBusy || !ready ? (
          <Button className="full" disabled>
            {locale === 'fa' ? 'مرور مبلغ و شرایط' : 'Review amounts and conditions'}
          </Button>
        ) : (
          <Button className="full" asChild>
            <Link href="/checkout" onClick={onClick}>
              {locale === 'fa' ? 'مرور مبلغ و شرایط' : 'Review amounts and conditions'}
              <ArrowLeft size={17} />
            </Link>
          </Button>
        )}
      </>
    );
  return cartIssue || cartBusy || !ready || (serverCart && !serverCart.canCheckout) ? (
    <Button className="full" disabled>
      {t('ادامهٔ فرایند خرید')}
      <ArrowLeft size={17} />
    </Button>
  ) : (
    <Button className="full" asChild>
      <Link href="/checkout" onClick={onClick}>
        {t('ادامهٔ فرایند خرید')}
        <ArrowLeft size={17} />
      </Link>
    </Button>
  );
}
