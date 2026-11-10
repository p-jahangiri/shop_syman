'use client';

import { ArrowLeft, ChevronLeft, Info, ReceiptText, ShoppingBag, Tag } from 'lucide-react';
import { cartDisplayTotals } from '@/lib/checkout/cart-display';
import { cartV2BuyCount, cartV2HasBuyLines } from '@/lib/checkout/cart-v2-contract';
import { useI18n, useStorefront } from '../navigation/locale-provider';
import Link from '../navigation/localized-link';
import { useShop } from '../providers/shop-provider';
import { Button } from '../shared/ui';
import { AcceptedCartGroups } from './accepted-cart-groups';
import { CartCommandNotice } from './cart-command-notice';
import { CartLines } from './cart-lines';
import { CartSavedItems } from './cart-saved-items';
import { CartCheckoutLink } from './cart-summary';
import './cart-workspace.css';

export function CartPage() {
  const { locale, t, digits, toman } = useI18n();
  const { products } = useStorefront();
  const { cart, ready, serverCart, loadError } = useShop();
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const count = serverCart
    ? cartV2BuyCount(serverCart)
    : cart.reduce((sum, line) => sum + line.quantity, 0);
  const nonempty = serverCart ? cartV2HasBuyLines(serverCart) : cart.length > 0;
  const attentionCount = serverCart?.ordinaryLines.filter((line) => line.issue).length ?? 0;
  const totals = !loadError && cartDisplayTotals(cart, products, serverCart);
  const amount = (value: bigint) => (
    <>
      <bdi>{toman(value)}</bdi> <small>{t('تومان')}</small>
    </>
  );

  return (
    <div className="container cart-workspace">
      <nav className="breadcrumbs" aria-label={text('مسیر صفحه', 'Breadcrumb')}>
        <Link href="/">{t('سایمان')}</Link>
        <ChevronLeft aria-hidden="true" />
        <span aria-current="page">{t('سبد خرید')}</span>
      </nav>
      <header className="cart-workspace-heading">
        <div>
          <span className="cart-workspace-icon">
            <ShoppingBag size={23} aria-hidden="true" />
          </span>
          <h1>{t('سبد خرید')}</h1>
          {ready && (
            <span className="cart-workspace-count">
              {locale === 'fa'
                ? `${digits(count)} کالا`
                : `${digits(count)} ${count === 1 ? 'item' : 'items'}`}
            </span>
          )}
        </div>
        <Link className="text-link" href="/catalog">
          {t('ادامهٔ انتخاب محصولات')} <ArrowLeft size={16} aria-hidden="true" />
        </Link>
      </header>
      <CartCommandNotice />
      {!ready ? (
        !loadError && (
          <div
            className="skeleton skeleton-card"
            role="status"
            aria-label={text('در حال بازیابی سبد', 'Loading your cart')}
          />
        )
      ) : (
        <>
          {nonempty ? (
            <div className="cart-workspace-layout">
              <div className="cart-workspace-sections">
                {cart.length > attentionCount && (
                  <section
                    className="cart-workspace-panel cart-workspace-items"
                    aria-labelledby="cart-items-heading"
                  >
                    <h2 id="cart-items-heading">{text('کالاهای سبد', 'Items in your cart')}</h2>
                    <CartLines workspace />
                  </section>
                )}
                <AcceptedCartGroups />
                {attentionCount > 0 && (
                  <section
                    className="cart-workspace-panel cart-workspace-items cart-workspace-attention"
                    aria-labelledby="cart-attention-heading"
                  >
                    <h2 id="cart-attention-heading">{text('نیاز به بررسی', 'Needs review')}</h2>
                    <p>
                      {text(
                        'برای ادامهٔ خرید، تعداد این کالاها را اصلاح کنید یا آن‌ها را به خرید بعدی منتقل کنید.',
                        'Adjust these quantities or save the items for later to continue.',
                      )}
                    </p>
                    <CartLines workspace needsAttention />
                  </section>
                )}
              </div>
              <aside
                className="cart-workspace-panel cart-workspace-summary"
                aria-labelledby="cart-summary-heading"
              >
                <h2 id="cart-summary-heading">
                  <ReceiptText size={21} aria-hidden="true" />{' '}
                  {text('جزئیات خرید', 'Order summary')}
                </h2>
                <dl className="cart-workspace-amounts">
                  {totals && totals.savings > 0n && (
                    <>
                      <div>
                        <dt>{text('جمع قیمت کالاها', 'Items before discounts')}</dt>
                        <dd>{amount(totals.beforeDiscounts)}</dd>
                      </div>
                      <div className="cart-workspace-savings">
                        <dt>
                          <Tag size={16} aria-hidden="true" />{' '}
                          {text('سود شما از خرید', 'Your savings')}
                        </dt>
                        <dd>{amount(totals.savings)}</dd>
                      </div>
                    </>
                  )}
                  <div className="cart-workspace-total">
                    <dt>{text('مجموع سبد خرید', 'Cart subtotal')}</dt>
                    <dd>{totals ? amount(totals.total) : text('نیاز به بررسی', 'Needs review')}</dd>
                  </div>
                </dl>
                <CartCheckoutLink />
                <p className="cart-workspace-note">
                  <Info size={17} aria-hidden="true" />
                  <span>
                    {text(
                      'مبلغ نهایی در مرحلهٔ بعد محاسبه می‌شود. موجودی هنگام ثبت سفارش دوباره بررسی و رزرو می‌شود.',
                      'The final amount is calculated in the next step. Stock is checked again and reserved when an order is placed.',
                    )}
                  </span>
                </p>
              </aside>
            </div>
          ) : (
            <section className="cart-workspace-panel empty-state">
              <ShoppingBag size={36} aria-hidden="true" />
              <h2>{text('سبد خرید خالی است', 'Your cart is empty')}</h2>
              <Button asChild>
                <Link href="/catalog">
                  {text('مشاهدهٔ کالاها', 'Browse products')}{' '}
                  <ArrowLeft size={16} aria-hidden="true" />
                </Link>
              </Button>
            </section>
          )}
          <CartSavedItems />
        </>
      )}
    </div>
  );
}
