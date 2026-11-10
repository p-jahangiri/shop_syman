'use client';

import { Minus, Plus, Shield, ShieldCheck, ShoppingBag, Trash2 } from 'lucide-react';
import { UsedConditionReport } from '@sayman/web-shared/components/catalog/used-condition';
import { discount, findVariant } from '@sayman/web-shared/lib/shared/commerce.ts';
import type { MoneyRial } from '@sayman/web-shared/lib/shared/types.ts';
import { productInsurance } from '@/lib/catalog/insurance';
import { useShop } from '../providers/shop-provider';
import { useI18n, useStorefront } from '../navigation/locale-provider';
import Link from '../navigation/localized-link';
import Image from '../media/content-image';
import { SaveCartLineForLater } from './cart-saved-items';

export function CartLines({
  workspace = false,
  needsAttention = false,
}: {
  workspace?: boolean;
  needsAttention?: boolean;
}) {
  const { t, digits, toman, locale } = useI18n();
  const { products } = useStorefront();
  const { cart, serverCart, cartBusy, loadError, quantity } = useShop();
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const liveLines = new Map(
    serverCart?.ordinaryLines.map((line) => [line.variantId.toLowerCase(), line]),
  );

  return (
    <div className="cart-lines" aria-busy={cartBusy}>
      {cart.map((line) => {
        const live = liveLines.get(line.variantId.toLowerCase());
        if (workspace && Boolean(live?.issue) !== needsAttention) return null;
        const candidate = findVariant(products, line.variantId);
        const found = live && candidate?.product.id !== live.productId ? undefined : candidate;
        const name = live
          ? (live.name ?? text('کالای خارج از فهرست فعلی', 'Item outside the current catalogue'))
          : (found?.product.name ?? text('کالای ناموجود', 'Unavailable item'));
        const label = live ? live.label : found?.variant.label;
        const slug = live ? live.slug : found?.product.slug;
        const href = slug ? `/product/${slug}?variant=${encodeURIComponent(line.variantId)}` : null;
        const unitPrice = live ? live.unitPriceRial : found?.variant.priceRial;
        const compareAt = live ? live.compareAtRial : found?.variant.compareAtRial;
        const total = live
          ? live.lineTotalRial
          : unitPrice != null
            ? BigInt(unitPrice) * BigInt(line.quantity)
            : null;
        const discountPercent =
          workspace && !live?.issue && unitPrice != null && compareAt != null
            ? discount(unitPrice as MoneyRial, compareAt as MoneyRial)
            : 0;
        const previousTotal =
          workspace &&
          !live?.issue &&
          compareAt != null &&
          unitPrice != null &&
          BigInt(compareAt) > BigInt(unitPrice)
            ? BigInt(compareAt) * BigInt(line.quantity)
            : null;
        const available = Math.min(1_000_000, live?.available ?? found?.variant.stock ?? 0);
        const insurance = workspace && found && productInsurance(found.product, found.variant);
        const image = found?.product.image ? (
          <Image src={found.product.image} alt="" width={144} height={144} sizes="144px" />
        ) : (
          <ShoppingBag size={38} aria-hidden="true" />
        );
        const actions = (
          <div className="quantity-row">
            <div className="quantity-control">
              <button
                type="button"
                disabled={cartBusy || loadError || line.quantity >= available}
                onClick={() => quantity(line.variantId, line.quantity + 1)}
                aria-label={t('افزایش تعداد {0}', [name])}
              >
                <Plus size={16} aria-hidden="true" />
              </button>
              <span>{digits(line.quantity)}</span>
              <button
                type="button"
                disabled={cartBusy || loadError || line.quantity <= 1}
                onClick={() => quantity(line.variantId, line.quantity - 1)}
                aria-label={t('کاهش تعداد {0}', [name])}
              >
                <Minus size={16} aria-hidden="true" />
              </button>
            </div>
            <button
              type="button"
              disabled={cartBusy || loadError}
              className="text-button muted cart-line-remove"
              onClick={() => quantity(line.variantId, 0)}
              aria-label={text(`حذف ${name} از سبد`, `Remove ${name} from cart`)}
            >
              <Trash2 size={15} aria-hidden="true" />
              {t('حذف')}
            </button>
            {workspace && <SaveCartLineForLater variantId={line.variantId} />}
          </div>
        );
        const prices = (
          <div className="cart-line-prices">
            {previousTotal !== null && (
              <div className="cart-line-previous">
                {discountPercent > 0 && (
                  <span className="cart-line-discount">
                    <bdi>
                      {digits(discountPercent)}
                      {text('٪', '%')}
                    </bdi>
                  </span>
                )}
                <del>
                  <bdi>{toman(previousTotal)}</bdi>
                </del>
              </div>
            )}
            <strong className="line-price">
              {total !== null ? (
                <>
                  <bdi>{toman(total)}</bdi> <small>{t('تومان')}</small>
                </>
              ) : (
                text('نیاز به بررسی', 'Needs review')
              )}
            </strong>
            {workspace && line.quantity > 1 && unitPrice != null && (
              <small className="cart-line-unit">
                {text('هر عدد', 'Each')} <bdi>{toman(unitPrice)}</bdi> {t('تومان')}
              </small>
            )}
          </div>
        );
        return (
          <article className="cart-line" key={line.variantId}>
            {href ? (
              <Link href={href} aria-label={name}>
                {image}
              </Link>
            ) : (
              <div className="cart-line-placeholder">{image}</div>
            )}
            <div className="cart-line-info">
              {href ? <Link href={href}>{name}</Link> : <strong>{name}</strong>}
              {label && <small>{label}</small>}
              {workspace &&
                found?.variant.colorName &&
                !label?.includes(found.variant.colorName) && (
                  <small>
                    {text('رنگ', 'Colour')} · {found.variant.colorName}
                  </small>
                )}
              {workspace && found?.variant.warranty && (
                <small className="cart-line-coverage">
                  <ShieldCheck size={15} aria-hidden="true" /> {found.variant.warranty}
                </small>
              )}
              {insurance && (
                <small className="cart-line-coverage">
                  <Shield size={15} aria-hidden="true" /> {text('بیمه', 'Insurance')} · {insurance}
                </small>
              )}
              <UsedConditionReport condition={found?.variant.usedCondition} locale={locale} />
              {live?.issue && (
                <p className="field-error" role="status">
                  {live.issue === 'insufficient_stock'
                    ? available === 0
                      ? text(
                          'این تنوع فعلاً ناموجود است.',
                          'This variant is currently out of stock.',
                        )
                      : text(
                          `فقط ${digits(available)} عدد موجود است. تعداد را کم کنید.`,
                          `Only ${digits(available)} available. Reduce the quantity.`,
                        )
                    : live.issue === 'unavailable'
                      ? text('این کالا از فروش خارج شده است.', 'This item is no longer on sale.')
                      : text(
                          'مبلغ این ردیف نیاز به بررسی دارد. تعداد را کم کنید.',
                          'This line amount needs review. Reduce the quantity.',
                        )}
                </p>
              )}
              {!workspace && prices}
              {!workspace && actions}
            </div>
            {workspace && !live?.issue && prices}
            {workspace && actions}
          </article>
        );
      })}
    </div>
  );
}
