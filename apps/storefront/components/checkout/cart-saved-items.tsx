'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Bookmark, Heart, ShoppingBag, Trash2 } from 'lucide-react';
import { findVariant } from '@sayman/web-shared/lib/shared/commerce.ts';
import type { Product, Variant } from '@sayman/web-shared/lib/shared/types.ts';
import { lookupProducts } from '@/lib/catalog/catalog-client';
import { productInspectionImages } from '@/lib/catalog/used-inspection-photos';
import Image from '../media/content-image';
import Link from '../navigation/localized-link';
import { useI18n, useStorefront } from '../navigation/locale-provider';
import { useShop } from '../providers/shop-context';
import { Button } from '../shared/ui';
import './cart-saved-items.css';

const pageSize = 6;

export function SaveCartLineForLater({ variantId }: { variantId: string }) {
  const { locale } = useI18n();
  const { savedCart, cartBusy, ready, loadError } = useShop();
  if (!savedCart) return null;
  return (
    <button
      type="button"
      className="cart-save-for-later"
      disabled={!savedCart.ready || cartBusy || !ready || loadError}
      onClick={() => savedCart.save(variantId)}
    >
      <Bookmark size={16} aria-hidden />
      {locale === 'fa' ? 'بعداً می‌خرم' : 'Save for later'}
    </button>
  );
}

function SavedProduct({
  product,
  variant,
  fallback,
  meta,
  children,
}: {
  product?: Product;
  variant?: Variant;
  fallback: string;
  meta?: string;
  children: ReactNode;
}) {
  const { locale, toman } = useI18n();
  const fa = locale === 'fa';
  const href = product
    ? `/product/${product.slug}${variant ? `?variant=${encodeURIComponent(variant.id)}` : ''}`
    : null;
  return (
    <li className="cart-saved-item">
      <div className="cart-saved-item-product">
        {product && (
          <Image
            src={productInspectionImages(product, variant?.usedCondition, locale)[0].url}
            width={58}
            height={58}
            alt=""
          />
        )}
        <div className="cart-saved-item-details">
          {href ? (
            <Link href={href} prefetch={false}>
              {product?.name}
            </Link>
          ) : (
            <strong>{fallback}</strong>
          )}
          {variant && (
            <span>
              {variant.label || variant.colorName || variant.sku}
              {' · '}
              <bdi>
                {toman(variant.priceRial)} {fa ? 'تومان' : 'toman'}
              </bdi>
            </span>
          )}
          {meta && <span>{meta}</span>}
        </div>
      </div>
      <div className="cart-saved-item-actions">{children}</div>
    </li>
  );
}

function FavoriteCartItem({ id, product }: { id: string; product?: Product }) {
  const { locale } = useI18n();
  const { add, cartBusy, ready, loadError, toggleWish, wishlistStatus } = useShop();
  const [selection, setSelection] = useState('');
  const fa = locale === 'fa';
  const available = product?.variants.filter((item) => item.stock > 0) ?? [];
  const selected =
    available.length === 1 ? available[0] : available.find((item) => item.id === selection);
  return (
    <SavedProduct
      product={product}
      variant={selected}
      fallback={fa ? `کالای خارج از فهرست · ${id}` : `Unlisted product · ${id}`}
      meta={
        product && !available.length ? (fa ? 'فعلاً ناموجود' : 'Currently unavailable') : undefined
      }
    >
      {available.length > 1 && (
        <select
          className="cart-saved-variant"
          aria-label={fa ? `تنوع ${product?.name}` : `Variant for ${product?.name}`}
          value={selected?.id ?? ''}
          onChange={(event) => setSelection(event.target.value)}
        >
          <option value="">{fa ? 'انتخاب تنوع' : 'Choose a variant'}</option>
          {available.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label || item.colorName || item.sku}
            </option>
          ))}
        </select>
      )}
      {available.length > 0 && (
        <Button
          variant="outline"
          disabled={!selected || cartBusy || !ready || loadError}
          onClick={() => selected && add(selected.id, 1, product)}
        >
          <ShoppingBag size={16} aria-hidden />
          {fa ? 'افزودن به سبد' : 'Add to cart'}
        </Button>
      )}
      <Button
        variant="ghost"
        disabled={wishlistStatus?.busy}
        onClick={() => toggleWish(id, product)}
        aria-label={
          fa
            ? `حذف ${product?.name ?? id} از علاقه‌مندی‌ها`
            : `Remove ${product?.name ?? id} from favourites`
        }
      >
        <Trash2 size={16} aria-hidden />
        {fa ? 'حذف' : 'Remove'}
      </Button>
    </SavedProduct>
  );
}

export function CartSavedItems() {
  const { locale, digits } = useI18n();
  const { products } = useStorefront();
  const { savedCart, wishlist, wishlistStatus, preferencesReady, cartBusy, ready, loadError } =
    useShop();
  const fa = locale === 'fa';
  const saved = savedCart?.items ?? [];
  const savedKey = saved.map((line) => line.variantId).join(',');
  const [savedLimit, setSavedLimit] = useState(pageSize);
  const [favoriteLimit, setFavoriteLimit] = useState(pageSize);
  const [attempt, setAttempt] = useState(0);
  const [details, setDetails] = useState<{
    key: string;
    locale: typeof locale;
    attempt: number;
    products: Product[] | null;
  } | null>(null);

  useEffect(() => {
    if (!savedKey) return;
    const controller = new AbortController();
    void lookupProducts(locale, { variantIds: savedKey.split(',') }, controller.signal)
      .then((items) => {
        if (!controller.signal.aborted)
          setDetails({ key: savedKey, locale, attempt, products: items });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setDetails({ key: savedKey, locale, attempt, products: null });
      });
    return () => controller.abort();
  }, [attempt, locale, savedKey]);

  const lookup =
    details?.key === savedKey && details.locale === locale && details.attempt === attempt
      ? details
      : null;
  const favoritesReady = wishlistStatus?.ready ?? preferencesReady;
  return (
    <div className="cart-saved-panels">
      {savedCart && (
        <section className="cart-saved-panel" aria-labelledby="cart-saved-heading">
          <div className="cart-saved-heading">
            <Bookmark size={20} aria-hidden />
            <h2 id="cart-saved-heading">{fa ? 'خرید بعدی' : 'Saved for later'}</h2>
            <span>{digits(saved.length)}</span>
          </div>
          {savedCart.failed ? (
            <p role="status">
              {fa
                ? 'فهرست خرید بعدی در این مرورگر در دسترس نیست.'
                : 'Saved-for-later is unavailable in this browser.'}
            </p>
          ) : !savedCart.ready ? (
            <p role="status">{fa ? 'در حال دریافت فهرست…' : 'Loading your saved items…'}</p>
          ) : !saved.length ? (
            <p>
              {fa
                ? 'کنار هر کالا «بعداً می‌خرم» را بزنید تا اینجا برای خرید بعدی بماند.'
                : 'Choose “Save for later” beside a cart item to keep it here.'}
            </p>
          ) : (
            <>
              <p>
                {fa
                  ? 'این فهرست در همین مرورگر می‌ماند. قیمت و موجودی هنگام بازگرداندن بررسی می‌شوند.'
                  : 'This list is kept in this browser. Price and stock are checked when you restore an item.'}
              </p>
              {lookup?.products === null && (
                <div className="cart-saved-feedback" role="status">
                  {fa ? 'دریافت جزئیات کالاها انجام نشد.' : 'Product details could not be loaded.'}
                  <Button variant="ghost" onClick={() => setAttempt((count) => count + 1)}>
                    {fa ? 'تلاش دوباره' : 'Retry'}
                  </Button>
                </div>
              )}
              <ul className="cart-saved-list">
                {saved.slice(0, savedLimit).map((line) => {
                  const found = findVariant(lookup?.products ?? products, line.variantId);
                  const enough = (found?.variant.stock ?? 0) >= line.quantity;
                  const quantity = fa
                    ? `تعداد ${digits(line.quantity)}`
                    : `Qty ${digits(line.quantity)}`;
                  const availability =
                    enough || !lookup?.products
                      ? ''
                      : fa
                        ? ' · موجودی برای این تعداد کافی نیست'
                        : ' · Not enough stock';
                  return (
                    <SavedProduct
                      key={line.variantId}
                      product={found?.product}
                      variant={found?.variant}
                      fallback={fa ? `تنوع ${line.variantId}` : `Variant ${line.variantId}`}
                      meta={quantity + availability}
                    >
                      <Button
                        variant="outline"
                        disabled={!enough || cartBusy || !ready || loadError}
                        onClick={() => savedCart.restore(line.variantId)}
                      >
                        <ShoppingBag size={16} aria-hidden />
                        {fa ? 'بازگشت به سبد' : 'Move to cart'}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={cartBusy}
                        onClick={() => savedCart.remove(line.variantId)}
                        aria-label={
                          fa
                            ? `حذف ${found?.product.name ?? line.variantId} از خرید بعدی`
                            : `Remove ${found?.product.name ?? line.variantId} from saved for later`
                        }
                      >
                        <Trash2 size={16} aria-hidden />
                        {fa ? 'حذف' : 'Remove'}
                      </Button>
                    </SavedProduct>
                  );
                })}
              </ul>
              {saved.length > savedLimit && (
                <Button variant="outline" onClick={() => setSavedLimit((n) => n + pageSize)}>
                  {fa ? 'نمایش کالاهای بیشتر' : 'Show more saved items'}
                </Button>
              )}
            </>
          )}
        </section>
      )}
      <section className="cart-saved-panel" aria-labelledby="cart-favorites-heading">
        <div className="cart-saved-heading">
          <Heart size={20} aria-hidden />
          <h2 id="cart-favorites-heading">{fa ? 'علاقه‌مندی‌ها' : 'Favourites'}</h2>
          <span>{digits(wishlist.length)}</span>
        </div>
        {wishlistStatus?.failed && (
          <div className="cart-saved-feedback" role="status">
            {fa ? 'دریافت علاقه‌مندی‌ها کامل نشد.' : 'Favourites could not be fully loaded.'}
            <Button variant="ghost" disabled={wishlistStatus.busy} onClick={wishlistStatus.retry}>
              {fa ? 'تلاش دوباره' : 'Retry'}
            </Button>
          </div>
        )}
        {!favoritesReady && !wishlistStatus?.failed ? (
          <p role="status">{fa ? 'در حال دریافت علاقه‌مندی‌ها…' : 'Loading favourites…'}</p>
        ) : favoritesReady && !wishlist.length ? (
          <p>
            {fa
              ? 'کالاهایی که نشان قلب می‌زنید اینجا می‌آیند.'
              : 'Items you favourite appear here.'}
          </p>
        ) : favoritesReady ? (
          <>
            <ul className="cart-saved-list">
              {wishlist.slice(0, favoriteLimit).map((id) => (
                <FavoriteCartItem
                  key={id}
                  id={id}
                  product={products.find((item) => item.id === id)}
                />
              ))}
            </ul>
            {wishlist.length > favoriteLimit && (
              <Button variant="outline" onClick={() => setFavoriteLimit((n) => n + pageSize)}>
                {fa ? 'نمایش علاقه‌مندی‌های بیشتر' : 'Show more favourites'}
              </Button>
            )}
          </>
        ) : null}
      </section>
    </div>
  );
}
