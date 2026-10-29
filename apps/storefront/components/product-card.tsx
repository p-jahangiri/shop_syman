'use client';
import { useI18n, useStorefront } from '@/components/locale-provider';
import Link from '@/components/localized-link';
import Image from '@/components/content-image';
import { Heart, GitCompareArrows, Plus } from 'lucide-react';
import type { Product } from '@/lib/types';
import { discount } from '@/lib/commerce';
import { useShop } from './shop-provider';
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
  const { categories } = useStorefront();
  const { wishlist, compare, toggleWish, toggleCompare, add, cartBusy, loadError, ready } =
    useShop();
  const variant =
    product.variants.find((v) => v.id === variantId) ??
    product.variants.find((v) => v.stock > 0) ??
    product.variants[0];
  const off = discount(variant.priceRial, variant.compareAtRial);
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
      <div className="product-picture">
        <Link
          href={`/product/${product.slug}${variantId || variant.usedCondition ? `?variant=${variant.id}` : ''}`}
          aria-label={product.name}
        >
          <Image src={product.image} alt={product.name} width={350} height={280} />
        </Link>
        <div className="card-tools">
          <button
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
            className={`icon-button ${compare.includes(product.id) ? 'is-active' : ''}`}
            onClick={() => toggleCompare(product.id, product)}
            aria-label={t('مقایسه: {0}', [product.name])}
            aria-pressed={compare.includes(product.id)}
          >
            <GitCompareArrows size={17} />
          </button>
        </div>
        {t(product.badge && <span className="product-badge">{t(product.badge)}</span>)}
      </div>
      <div className="product-info">
        <div className="product-meta">
          <span>{t(product.brand)}</span>
          <div className="color-dots">
            {t(
              product.variants.map((v) => (
                <i key={v.id} style={{ background: v.color }} title={v.colorName} />
              )),
            )}
          </div>
        </div>
        <Link
          className="product-name"
          href={`/product/${product.slug}${variantId || variant.usedCondition ? `?variant=${variant.id}` : ''}`}
        >
          {t(product.name)}
        </Link>
        <p className="product-subtitle">
          {t(variant.label)}
          {variant.usedCondition && (
            <strong>
              {' '}
              ·{' '}
              {locale === 'fa' ? 'کارکرده · گزارش سلامت دارد' : 'Used · Condition report available'}
            </strong>
          )}
        </p>
        <div className="product-price-row">
          <div>
            {t(
              variant.stock === 0 ? (
                <span className="out-of-stock">{t('فعلاً ناموجود')}</span>
              ) : (
                <>
                  <div className="old-price">
                    {t(
                      off > 0 ? (
                        <>
                          <del>
                            {t(toman(variant.compareAtRial!))}
                            {t('تومان')}
                          </del>
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
                  <div className="price">
                    {t(toman(variant.priceRial))} <small>{t('تومان')}</small>
                  </div>
                </>
              ),
            )}
          </div>
          <button
            className="add-circle"
            onClick={() => add(variant.id, 1, product)}
            disabled={!variant.stock || cartBusy || loadError || !ready}
            aria-label={t('افزودن {0} به سبد', [product.name])}
          >
            <Plus size={20} />
          </button>
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
