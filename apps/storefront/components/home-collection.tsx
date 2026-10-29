'use client';
import { useI18n, useStorefront, ProductsScope } from '@/components/locale-provider';
import Link from '@/components/localized-link';
import { useEffect, useId, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { searchProducts } from '@/lib/catalog-client';
import type { Product } from '@/lib/types';
import { ProductGrid } from './product-card';
import { groupNavigation } from './ui';
export function HomeCollection({
  eyebrow,
  title,
  action,
  initialProducts,
}: {
  eyebrow?: string;
  title?: string;
  action?: string;
  initialProducts: Product[];
}) {
  const { t, locale } = useI18n();
  const { categories } = useStorefront();
  const id = useId();
  const [tab, setTab] = useState('__featured');
  const [result, setResult] = useState<{ tab: string; products: Product[] }>({
    tab: '__featured',
    products: initialProducts,
  });
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (tab === '__featured') {
      setResult({ tab, products: initialProducts });
      setError(false);
      return;
    }
    const controller = new AbortController();
    setError(false);
    searchProducts(locale, { categoryId: tab, pageSize: 4 }, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) setResult({ tab, products: page.products });
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [tab, locale, initialProducts, attempt]);
  const tabs = [['__featured', t('انتخاب سایمان')], ...categories.map((c) => [c.key, c.name])];
  const pending = result.tab !== tab;
  const items = pending ? [] : result.products;
  return (
    <section className="selected-section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">{eyebrow ?? t('با دقت انتخاب شده')}</span>
          <h2>{title ?? t('شاید انتخاب بعدی تو اینجاست')}</h2>
        </div>
        <Link href="/catalog" className="text-link">
          {action ?? t('همهٔ محصولات')}
          <ArrowLeft size={17} />
        </Link>
      </div>
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
            id={`${id}-${key}`}
            aria-controls={`${id}-panel`}
            tabIndex={tab === key ? 0 : -1}
            aria-selected={tab === key}
            key={key}
            onClick={() => setTab(key)}
            className={tab === key ? 'active' : ''}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-${tab}`}
        aria-busy={pending && !error}
      >
        {error ? (
          <div className="shop-load-error" role="alert">
            {t('دریافت محصولات انجام نشد.')}
            <button onClick={() => setAttempt((v) => v + 1)}>{t('تلاش دوباره')}</button>
          </div>
        ) : pending ? (
          <p role="status">{t('در حال دریافت محصولات…')}</p>
        ) : (
          <ProductsScope products={items}>
            <ProductGrid items={items} />
            {!items.length && <p>{t('محصولی پیدا نشد. نام یا برند دیگری را امتحان کن.')}</p>}
          </ProductsScope>
        )}
      </div>
    </section>
  );
}
