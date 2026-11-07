'use client';

import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { ArrowUpLeft, History } from 'lucide-react';
import { lookupProducts } from '@/lib/catalog/catalog-client';
import { productInspectionImages } from '@/lib/catalog/used-inspection-photos';
import {
  parseRecentViews,
  readRecentViews,
  recordRecentView,
  resolveRecentViews,
  subscribeRecentViews,
  writeRecentViews,
} from '@/lib/catalog/recently-viewed';
import { useI18n, useStorefront } from '../navigation/locale-provider';
import Link from '../navigation/localized-link';
import Image from '../media/content-image';
import './recently-viewed.css';

const serverSnapshot = () => null;

export function RecentlyViewed({
  currentProductId,
  currentVariantId,
}: {
  currentProductId?: string;
  currentVariantId?: string;
}) {
  const { locale, toman } = useI18n();
  const { site, dataSource } = useStorefront();
  const titleId = useId();
  const fa = locale === 'fa';
  const raw = useSyncExternalStore(subscribeRecentViews, readRecentViews, serverSnapshot);
  const views = parseRecentViews(raw).filter((item) => item.productId !== currentProductId);
  const request = JSON.stringify(views.map((item) => item.variantId));
  const [result, setResult] = useState<{
    request: string;
    locale: typeof locale;
    products: Awaited<ReturnType<typeof lookupProducts>>;
    failed?: boolean;
  } | null>(null);
  const [attempt, retry] = useState(0);

  useEffect(() => {
    if (dataSource !== 'api' || !currentProductId || !currentVariantId) return;
    const views = parseRecentViews(readRecentViews());
    if (views[0]?.productId === currentProductId && views[0].variantId === currentVariantId) return;
    writeRecentViews(
      recordRecentView(views, { productId: currentProductId, variantId: currentVariantId }),
    );
  }, [dataSource, currentProductId, currentVariantId]);

  useEffect(() => {
    const variantIds: string[] = JSON.parse(request);
    if (dataSource !== 'api' || !variantIds.length) return;
    const controller = new AbortController();
    void lookupProducts(locale, { variantIds }, controller.signal)
      .then((products) => {
        if (!controller.signal.aborted) setResult({ request, locale, products });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ request, locale, products: [], failed: true });
      });
    return () => controller.abort();
  }, [attempt, dataSource, locale, request]);

  if (dataSource !== 'api' || !views.length) return null;
  const current = result?.request === request && result.locale === locale ? result : null;
  const cards = resolveRecentViews(views, current?.products ?? []).filter(
    ({ variant }) => site.appearance?.showUsedProducts !== false || !variant.usedCondition,
  );

  return (
    <section className="recent-views" aria-labelledby={titleId}>
      <header className="recent-views-heading">
        <div>
          <h2 id={titleId}>
            <History size={19} aria-hidden="true" />
            {fa ? 'اخیراً دیده‌اید' : 'Recently viewed'}
          </h2>
          <p>{fa ? 'ذخیره‌شده در همین مرورگر' : 'Saved in this browser'}</p>
        </div>
        <button type="button" onClick={() => writeRecentViews([])}>
          {fa ? 'پاک‌کردن تاریخچه' : 'Clear history'}
        </button>
      </header>
      {current?.failed ? (
        <p role="status">
          {fa ? 'اطلاعات کالاها دریافت نشد.' : 'Product information could not be loaded.'}{' '}
          <button
            type="button"
            onClick={() => {
              setResult(null);
              retry((count) => count + 1);
            }}
          >
            {fa ? 'تلاش دوباره' : 'Retry'}
          </button>
        </p>
      ) : !current || cards.length === 0 ? (
        <p role="status">
          {!current
            ? fa
              ? 'در حال دریافت اطلاعات کالاها…'
              : 'Loading product details…'
            : fa
              ? 'تنوع‌های قبلی دیگر در کاتالوگ در دسترس نیستند.'
              : 'Those variants are no longer in the catalog.'}
        </p>
      ) : (
        <ul className="recent-views-list">
          {cards.map(({ product, variant }) => (
            <li key={product.id}>
              <Link
                href={`/product/${encodeURIComponent(product.slug)}?${new URLSearchParams({ variant: variant.id })}`}
                className="recent-view"
                prefetch={false}
              >
                <Image
                  alt=""
                  src={productInspectionImages(product, variant.usedCondition, locale)[0].url}
                  width={52}
                  height={52}
                />
                <div>
                  <strong>{product.name}</strong>
                  <span>{variant.label || variant.colorName || variant.sku}</span>
                  <span>
                    {toman(variant.priceRial)} {fa ? 'تومان' : 'toman'}
                    {variant.stock <= 0 && (fa ? ' · ناموجود' : ' · Out of stock')}
                  </span>
                </div>
                <ArrowUpLeft size={16} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
