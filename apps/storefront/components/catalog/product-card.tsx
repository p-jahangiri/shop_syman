'use client';
import { useI18n, useStorefront } from '@/components/navigation/locale-provider';
import Link from '@/components/navigation/localized-link';
import Image from '@/components/media/content-image';
import { ArrowUpRight, CirclePlay, Heart, GitCompareArrows, Plus } from 'lucide-react';
import type { Product } from '@sayman/web-shared/lib/shared/types.ts';
import { discount } from '@sayman/web-shared/lib/shared/commerce.ts';
import { availablePurchaseMethods } from '@/lib/catalog/purchasing';
import { useShop } from '../providers/shop-provider';
import './product-presentation.css';
export function ProductCard({
  product,
  compact = false,
  variantId,
}: {
  product: Product;
  compact?: boolean;
  variantId?: string;
}) {
  const { t, digits, toman, locale } = useI18n();
  const { categories, purchaseMethods } = useStorefront();
  const { wishlist, compare, toggleWish, toggleCompare, add, cartBusy, loadError, ready } =
    useShop();
  const variant =
    product.variants.find((v) => v.id === variantId) ??
    product.variants.find((v) => v.stock > 0) ??
    product.variants[0];
  const off = discount(variant.priceRial, variant.compareAtRial);
  const inspectionPhoto = variant.usedCondition?.photos?.[0];
  const canPurchase = availablePurchaseMethods(product, variant, purchaseMethods).length > 0;
  const href = `/product/${product.slug}${variantId || variant.usedCondition ? `?variant=${encodeURIComponent(variant.id)}` : ''}`;
  const hasVideo = product.videos?.some(
    (video) => !video.variantId || video.variantId === variant.id,
  );
  const colors = [
    ...new Map(
      product.variants
        .filter(
          (item) =>
            item.colorName && Boolean(item.usedCondition) === Boolean(variant.usedCondition),
        )
        .map((item) => [item.color, item.colorName]),
    ).entries(),
  ];
  return (
    <article
      className={`product-card ${compact ? 'compact' : ''}`}
      data-tone={
        Math.max(
          0,
          categories.findIndex((category) => category.key === product.category),
        ) % 4
      }
    >
      <div className="product-card-head">
        <span title={t(product.brand)}>{t(product.brand)}</span>
        <div className="product-card-actions">
          <button
            type="button"
            className={`icon-button ${wishlist.includes(product.id) ? 'is-active' : ''}`}
            onClick={() => toggleWish(product.id, product)}
            aria-label={t('{0} علاقه‌مندی: {1}', [
              wishlist.includes(product.id) ? t('حذف از') : t('افزودن به'),
              product.name,
            ])}
            aria-pressed={wishlist.includes(product.id)}
          >
            <Heart size={17} fill={wishlist.includes(product.id) ? 'currentColor' : 'none'} />
          </button>
          <button
            type="button"
            className={`icon-button ${compare.includes(product.id) ? 'is-active' : ''}`}
            onClick={() => toggleCompare(product.id, product, variant.id)}
            aria-label={t('مقایسه: {0}', [product.name])}
            aria-pressed={compare.includes(product.id)}
          >
            <GitCompareArrows size={17} />
          </button>
        </div>
      </div>
      <div className="product-picture">
        <Link href={href} aria-label={product.name}>
          <Image
            src={inspectionPhoto?.url ?? product.image}
            alt={
              inspectionPhoto
                ? locale === 'fa'
                  ? inspectionPhoto.altFa
                  : inspectionPhoto.altEn
                : product.name
            }
            width={350}
            height={280}
            sizes={
              compact
                ? '(max-width: 600px) 45vw, 240px'
                : '(max-width: 600px) 45vw, (max-width: 1024px) 30vw, 300px'
            }
          />
        </Link>
        {t(product.badge && <span className="product-badge">{t(product.badge)}</span>)}
      </div>
      <div className="product-info">
        <Link className="product-name" href={href} title={t(product.name)}>
          {t(product.name)}
        </Link>
        <div className="product-card-variant">
          <p className="product-subtitle">{t(variant.label)}</p>
          {colors.length > 1 && (
            <div className="color-dots" aria-hidden="true">
              {colors.slice(0, 4).map(([color, name]) => (
                <i key={color} style={{ background: color }} title={name} />
              ))}
              {colors.length > 4 && <bdi>+{digits(colors.length - 4)}</bdi>}
            </div>
          )}
        </div>
        {variant.usedCondition && (
          <span className="product-card-condition">
            {locale === 'fa' ? 'کارکرده · دارای گزارش سلامت' : 'Used · Condition report available'}
          </span>
        )}
        {hasVideo && (
          <Link
            className="product-card-video"
            href={`/product/${product.slug}?variant=${encodeURIComponent(variant.id)}#product-videos`}
          >
            <CirclePlay size={14} aria-hidden="true" />
            {locale === 'fa' ? 'ویدیوی کالا' : 'Product video'}
          </Link>
        )}
        <div className="product-price-row">
          <div className="product-card-cost">
            {t(
              variant.stock === 0 ? (
                <span className="out-of-stock">{t('فعلاً ناموجود')}</span>
              ) : (
                <>
                  <div className="old-price">
                    {t(
                      off > 0 ? (
                        <>
                          <del>{t(toman(variant.compareAtRial!))}</del>
                          <span className="discount">
                            {t(digits(off))}
                            {t('٪')}
                          </span>
                        </>
                      ) : (
                        <span> </span>
                      ),
                    )}
                  </div>
                  <div className="product-card-amount">
                    <bdi className="price">{t(toman(variant.priceRial))}</bdi>
                    <small className="product-card-currency">{t('تومان')}</small>
                  </div>
                </>
              ),
            )}
          </div>
          {variant.stock > 0 && canPurchase ? (
            <button
              className="add-circle"
              onClick={() => add(variant.id, 1, product)}
              disabled={cartBusy || loadError || !ready}
              aria-label={t('افزودن {0} به سبد', [product.name])}
            >
              <Plus size={20} />
            </button>
          ) : (
            <Link
              href={href}
              className="add-circle product-card-details"
              aria-label={`${locale === 'fa' ? 'جزئیات کالا' : 'Product details'} · ${t(product.name)}`}
            >
              <ArrowUpRight size={18} aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
export function ProductGrid({
  items,
  variantIds,
}: {
  items: Product[];
  variantIds?: Record<string, string>;
}) {
  const { t } = useI18n();
  useStorefront();
  return (
    <div className="product-grid">
      {t(items.map((p) => <ProductCard key={p.id} product={p} variantId={variantIds?.[p.id]} />))}
    </div>
  );
}
