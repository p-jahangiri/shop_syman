'use client';
import { useI18n, useStorefront, ProductsScope } from '@/components/navigation/locale-provider';
import Link from '@/components/navigation/localized-link';
import { useEffect, useId, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { searchProducts } from '@/lib/catalog/catalog-client';
import type { Product } from '@sayman/web-shared/lib/shared/types.ts';
import { ProductGrid } from '../catalog/product-card';
import { groupNavigation } from '../shared/ui';
export function HomeCollection({
  eyebrow,
  title,
  description,
  action,
  href,
  categoryId,
  pageSize,
  initialProducts,
  initialVariantIds,
}: {
  eyebrow?: string;
  title?: string;
  description?: string;
  action?: string;
  href?: string;
  categoryId?: string;
  pageSize: number;
  initialProducts: Product[];
  initialVariantIds?: Record<string, string>;
}) {
  const { t, locale } = useI18n();
  const { categories } = useStorefront();
  const id = useId();
  const [tab, setTab] = useState('');
  const [result, setResult] = useState<{
    tab: string;
    attempt: number;
    products: Product[] | null;
    variantIds?: Record<string, string>;
  }>();
  const [attempt, setAttempt] = useState(0);
  const selected = !categoryId && categories.some((c) => c.key === tab) ? tab : '';
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    searchProducts(locale, { categoryId: selected, condition: 'new', pageSize }, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted)
          setResult({
            tab: selected,
            attempt,
            products: page.products,
            variantIds: page.matchingVariantIds,
          });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ tab: selected, attempt, products: null });
      });
    return () => controller.abort();
  }, [selected, locale, pageSize, attempt]);
  const tabs = [['', t('انتخاب سایمان')], ...categories.map((c) => [c.key, c.name])];
  const products = selected
    ? result?.tab === selected && result.attempt === attempt
      ? result.products
      : undefined
    : initialProducts;
  const hasTabs = !categoryId && categories.length > 0;
  const tabId = (key: string) => `${id}-tab-${key}`;
  return (
    <section className="selected-section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">{eyebrow ?? t('با دقت انتخاب شده')}</span>
          <h2>{title ?? t('شاید انتخاب بعدی تو اینجاست')}</h2>
          {description && <p className="home-section-description">{description}</p>}
        </div>
        <Link
          href={
            href ??
            (categoryId ? `/catalog?category=${encodeURIComponent(categoryId)}` : '/catalog')
          }
          className="text-link"
        >
          {action ?? t('همهٔ محصولات')}
          <ArrowLeft size={17} />
        </Link>
      </div>
      {hasTabs && (
        <div
          className="collection-tabs"
          role="tablist"
          tabIndex={-1}
          aria-label={t('محصولات منتخب')}
          onKeyDown={groupNavigation}
        >
          {tabs.map(([key, label]) => (
            <button
              role="tab"
              id={tabId(key)}
              aria-controls={`${id}-panel`}
              tabIndex={selected === key ? 0 : -1}
              aria-selected={selected === key}
              key={key}
              onClick={() => {
                if (selected !== key) {
                  setResult(undefined);
                  setTab(key);
                }
              }}
              className={selected === key ? 'active' : ''}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div
        id={hasTabs ? `${id}-panel` : undefined}
        role={hasTabs ? 'tabpanel' : undefined}
        aria-labelledby={hasTabs ? tabId(selected) : undefined}
        aria-busy={products === undefined}
      >
        {products === null ? (
          <div className="shop-load-error" role="alert">
            {t('دریافت محصولات انجام نشد.')}
            <button onClick={() => setAttempt((v) => v + 1)}>{t('تلاش دوباره')}</button>
          </div>
        ) : products === undefined ? (
          <p className="home-collection-message" role="status">
            {t('در حال دریافت محصولات…')}
          </p>
        ) : (
          <ProductsScope products={products}>
            <ProductGrid
              items={products}
              variantIds={selected ? result?.variantIds : initialVariantIds}
            />
            {!products.length && (
              <p className="home-collection-message">
                {t('در حال حاضر محصولی در این مجموعه موجود نیست.')}
              </p>
            )}
          </ProductsScope>
        )}
      </div>
    </section>
  );
}
