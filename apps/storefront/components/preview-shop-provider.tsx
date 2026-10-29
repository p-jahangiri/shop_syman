'use client';
import { useI18n, useProductRegistry } from './locale-provider';
import { useEffect, useState, type ReactNode } from 'react';
import { ShopContext } from './shop-context';
import { findVariant, sanitizeCart } from '@/lib/commerce';
import { lookupProducts } from '@/lib/catalog-client';
import { parseSavedShop, resolveSavedShop } from '@/lib/saved-shop';
import type { CartLine, Product } from '@/lib/types';
export function PreviewShopProvider({ children }: { children: ReactNode }) {
  const { t, locale } = useI18n();
  const registry = useProductRegistry();
  const [cart, setCart] = useState<CartLine[]>([]),
    [wishlist, setWishlist] = useState<string[]>([]),
    [compare, setCompare] = useState<string[]>([]);
  const [ready, setReady] = useState(false),
    [loadError, setLoadError] = useState(false),
    [attempt, setAttempt] = useState(0),
    [cartOpen, setCartOpen] = useState(false),
    [toast, setToast] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setReady(false);
    setLoadError(false);
    async function hydrate() {
      let saved = parseSavedShop({});
      try {
        const raw = localStorage.getItem('sayman:shop:v1');
        saved = parseSavedShop(raw && raw.length <= 100000 ? JSON.parse(raw) : {});
      } catch {
        /* Invalid local data contains no usable product references. */
      }
      try {
        const result = await resolveSavedShop(saved, (batch) =>
          lookupProducts(locale, batch, controller.signal),
        );
        if (cancelled) return;
        registry.publish('saved', result.products);
        setCart(result.saved.cart);
        setWishlist(result.saved.wishlist);
        setCompare(result.saved.compare);
        setReady(true);
      } catch {
        if (!cancelled)
          setLoadError(true); /* Keep the saved IDs intact while the API is unavailable. */
      }
    }
    void hydrate();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [locale, attempt, registry]);
  useEffect(() => {
    if (!ready) return;
    const products = registry.current();
    const ids = new Set([...wishlist, ...compare]);
    for (const line of cart) {
      const p = findVariant(products, line.variantId)?.product;
      if (p) ids.add(p.id);
    }
    registry.publish(
      'saved',
      products.filter((p) => ids.has(p.id)),
    );
    try {
      localStorage.setItem('sayman:shop:v1', JSON.stringify({ cart, wishlist, compare }));
    } catch {
      /* Browsing still works when persistent storage is blocked. */
    }
  }, [cart, wishlist, compare, ready, registry]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  function canEdit() {
    if (ready) return true;
    setToast(t('انتخاب‌های ذخیره‌شده در حال بازیابی‌اند؛ کمی بعد دوباره تلاش کنید.'));
    return false;
  }
  function seed(product?: Product) {
    if (product) {
      const current = registry.current();
      const ids = new Set([...wishlist, ...compare]);
      for (const line of cart) {
        const p = findVariant(current, line.variantId)?.product;
        if (p) ids.add(p.id);
      }
      const saved = current.filter((p) => ids.has(p.id) && p.id !== product.id);
      registry.publish('saved', [...saved, product]);
    }
    return registry.current();
  }
  function add(id: string, n = 1, product?: Product) {
    if (!canEdit()) return;
    const products = seed(product);
    const found = findVariant(products, id);
    if (!found || found.variant.stock === 0) {
      setToast(t('این تنوع فعلاً موجود نیست'));
      return;
    }
    if (cart.length >= 100 && !cart.some((l) => l.variantId === id)) {
      setToast(t('برای افزودن کالای تازه، تعداد اقلام سبد را کمتر کنید.'));
      return;
    }
    setCart((old) => sanitizeCart([...old, { variantId: id, quantity: n }], products));
    setToast(t('به سبد خرید اضافه شد'));
  }
  function toggleWish(id: string, product?: Product) {
    if (!canEdit()) return;
    const products = seed(product);
    if (!products.some((p) => p.id === id)) return;
    if (wishlist.length >= 200 && !wishlist.includes(id)) {
      setToast(t('فهرست علاقه‌مندی پر شده است.'));
      return;
    }
    setWishlist((old) => (old.includes(id) ? old.filter((x) => x !== id) : [...old, id]));
  }
  function toggleCompare(id: string, product?: Product) {
    if (!canEdit()) return;
    const products = seed(product);
    if (compare.includes(id)) {
      setCompare((old) => old.filter((x) => x !== id));
      return;
    }
    if (compare.length >= 4) {
      setToast(t('حداکثر ۴ محصول را می‌توانید مقایسه کنید'));
      return;
    }
    const current = products.find((p) => p.id === compare[0]),
      next = products.find((p) => p.id === id);
    if (!next) return;
    if (current && current.category !== next.category) {
      setToast(t('برای مقایسه، محصولات یک دسته را انتخاب کنید'));
      return;
    }
    setCompare((old) => [...old, id]);
  }
  return (
    <ShopContext.Provider
      value={{
        cart,
        wishlist,
        compare,
        ready,
        preferencesReady: ready,
        serverCart: null,
        cartBusy: false,
        cartIssue: false,
        quoteReviewIssue: true,
        loadError,
        retry: () => setAttempt((n) => n + 1),
        cartOpen,
        setCartOpen,
        add,
        quantity: (id, n) => {
          if (canEdit())
            setCart((old) =>
              sanitizeCart(
                old.map((l) => (l.variantId === id ? { ...l, quantity: n } : l)),
                registry.current(),
              ),
            );
        },
        clearCart: () => {
          if (canEdit()) setCart([]);
        },
        toggleWish,
        toggleCompare,
        notify: setToast,
      }}
    >
      {loadError && (
        <div className="shop-load-error" role="alert">
          <span>{t('بازیابی سبد و علاقه‌مندی انجام نشد؛ اطلاعات ذخیره‌شده حفظ شده‌اند.')}</span>
          <button onClick={() => setAttempt((n) => n + 1)}>{t('تلاش دوباره')}</button>
        </div>
      )}
      {children}
      <div className={toast ? 'toast show' : 'toast'} role="status" aria-live="polite">
        {toast}
      </div>
    </ShopContext.Provider>
  );
}
