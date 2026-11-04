'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n, useProductRegistry } from '../navigation/locale-provider';
import { useCustomerSession } from '../auth/auth-provider';
import { ShopContext } from './shop-context';
import { useConnectedWishlist } from '../wishlist/connected-wishlist';
import { LegacyCartReview } from '../checkout/legacy-cart-review';
import { CartError, combineLegacyCart, withCartLock } from '@/lib/checkout/cart-client';
import { requestCartV2 as requestCart } from '@/lib/checkout/cart-v2-client';
import {
  ordinaryCartProducts as serverCartProducts,
  type ServerCartV2 as ServerCart,
} from '@/lib/checkout/cart-v2-contract';
import type { AuthState } from '@/lib/account/customer-session';
import { lookupProducts } from '@/lib/catalog/catalog-client';
import {
  changeSavedComparison,
  parseSavedShop,
  resolveSavedShop,
  type SavedComparison,
} from '@/lib/wishlist/saved-shop';
import { findVariant } from '@sayman/web-shared/lib/shared/commerce.ts';
import { addCartSelection } from '@/lib/checkout/cart-addition';
import type { CartLine, Product } from '@sayman/web-shared/lib/shared/types.ts';
import {
  createCartCommandRunner,
  pendingCartCommand,
  type CartCommandMode,
} from '@/lib/checkout/cart-command-runner';
import {
  cartOfferRemovalInputSchema,
  type CartCommand,
} from '@/lib/checkout/cart-conversion-contract';
import { cartReviewCapabilities } from '@/lib/checkout/cart-review-capabilities';
const preferencesKey = 'sayman:preferences:v1',
  legacyKey = 'sayman:legacy-cart:v1';
const scope = (auth: AuthState) =>
  auth.status === 'member'
    ? `member:${auth.session!.user.id}`
    : auth.status === 'guest'
      ? 'guest'
      : 'unavailable';
function saved(key: string) {
  try {
    const value = localStorage.getItem(key);
    return value && value.length <= 100000 ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}
export function ConnectedShopProvider({ children }: { children: ReactNode }) {
  const { locale, t } = useI18n();
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const registry = useProductRegistry();
  const auth = useCustomerSession();
  const key = scope(auth);
  const ownerId = auth.status === 'member' ? auth.session!.user.id : null;
  const [data, setData] = useState<{ scope: string; cart: ServerCart } | null>(null),
    [comparison, setComparison] = useState<SavedComparison>({ compare: [] }),
    [preferencesReady, setPreferencesReady] = useState(false),
    [preferencesError, setPreferencesError] = useState(false),
    [preferencesAttempt, setPreferencesAttempt] = useState(0);
  const [loadError, setLoadError] = useState(false),
    [mergePending, setMergePending] = useState(false),
    [busy, setBusy] = useState(false),
    [attempt, setAttempt] = useState(0),
    [cartOpen, setCartOpen] = useState(false),
    [toast, setToast] = useState('');
  const wishes = useConnectedWishlist(setToast);
  const { compare, compareVariants } = comparison;
  const wishlist = wishes.wishlist;
  const [legacy, setLegacy] = useState<CartLine[]>([]),
    [legacyOpen, setLegacyOpen] = useState(false),
    [legacyHidden, setLegacyHidden] = useState(false);
  const epoch = useRef(0),
    reloadAfterWrite = useRef(false),
    operation = useRef(false),
    mounted = useRef(true),
    channel = useRef<BroadcastChannel | null>(null),
    mergeConflict = useRef<{ scope: string; retry: boolean } | null>(null);
  const snapshot = useRef(data);
  snapshot.current = data;
  const visible = data?.scope === key && key !== 'unavailable' ? data.cart : null;
  const ready = visible !== null;
  const cart =
    visible?.ordinaryLines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })) ?? [];
  const retry = () => {
    if (operation.current) reloadAfterWrite.current = true;
    else setAttempt((n) => n + 1);
  };
  const retryMerge = () => {
    if (scope(auth.store.snapshot()) !== key) return;
    if (mergeConflict.current?.scope === key) mergeConflict.current.retry = true;
    retry();
  };
  const accept = useCallback(
    async (value: ServerCart, owner: string, ticket: number, signal?: AbortSignal) => {
      if (!mounted.current || scope(auth.store.snapshot()) !== owner || ticket !== epoch.current)
        return;
      setData({ scope: owner, cart: value });
      snapshot.current = { scope: owner, cart: value };
      const ids = value.ordinaryLines.filter((l) => l.productId !== null).map((l) => l.variantId);
      let products: Product[] = [];
      try {
        if (ids.length) products = await lookupProducts(locale, { variantIds: ids }, signal);
        if (ids.some((id) => !findVariant(products, id)))
          throw new CartError('cart_changed_conflict', 409);
        if (!mounted.current || scope(auth.store.snapshot()) !== owner || ticket !== epoch.current)
          return;
        registry.publish('server-cart', serverCartProducts(value, products));
        setLoadError(false);
      } catch (error) {
        if (signal?.aborted) return;
        if (mounted.current && scope(auth.store.snapshot()) === owner && ticket === epoch.current)
          setLoadError(true);
        throw error;
      }
    },
    [auth.store, locale, registry],
  );
  useEffect(() => {
    mounted.current = true;
    let bus: BroadcastChannel | null = null;
    try {
      bus = new BroadcastChannel('sayman-cart');
      channel.current = bus;
      bus.onmessage = () => retry();
    } catch {
      /* SQL version checks still protect writes without cross-tab hints. */
    }
    let lastFocus = 0;
    const focus = () => {
      if (Date.now() - lastFocus > 3000) {
        lastFocus = Date.now();
        retry();
      }
    };
    window.addEventListener('focus', focus);
    return () => {
      mounted.current = false;
      bus?.close();
      channel.current = null;
      window.removeEventListener('focus', focus);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setPreferencesReady(false);
    setPreferencesError(false);
    const old = parseSavedShop(saved('sayman:shop:v1') ?? {});
    const preferences = parseSavedShop(saved(preferencesKey) ?? old);
    const pending = saved(legacyKey);
    setLegacy(parseSavedShop({ cart: pending === null ? old.cart : pending }).cart);
    void resolveSavedShop({ ...preferences, cart: [], wishlist: [] }, (refs) =>
      lookupProducts(locale, refs, controller.signal),
    )
      .then((result) => {
        if (cancelled) return;
        registry.publish('preferences', result.products);
        setComparison({
          compare: result.saved.compare,
          compareVariants: result.saved.compareVariants,
        });
        setPreferencesReady(true);
      })
      .catch(() => {
        if (!cancelled) setPreferencesError(true);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [locale, registry, preferencesAttempt]);
  useEffect(() => {
    if (!preferencesReady) return;
    try {
      const raw = localStorage.getItem(preferencesKey);
      const previous = saved(preferencesKey);
      if (raw !== null && previous === null) return;
      localStorage.setItem(
        preferencesKey,
        JSON.stringify({ ...previous, compare, compareVariants }),
      );
    } catch {
      /* Server cart data and credentials are never written here. */
    }
  }, [preferencesReady, compare, compareVariants]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const ticket = ++epoch.current;
    setLoadError(false);
    if (mergeConflict.current?.scope !== key) mergeConflict.current = null;
    setMergePending(mergeConflict.current?.scope === key);
    if (key === 'unavailable') {
      setData(null);
      snapshot.current = null;
      registry.release('server-cart');
      return;
    }
    if (snapshot.current?.scope !== key) {
      setData(null);
      snapshot.current = null;
      registry.release('server-cart');
    }
    async function load() {
      try {
        let value: ServerCart;
        if (auth.status === 'member')
          value = await withCartLock(async () => {
            if (scope(auth.store.snapshot()) !== key) throw new Error('Session changed');
            if (mergeConflict.current?.scope === key && !mergeConflict.current.retry)
              return requestCart(auth.store.fetch, locale, 'GET', undefined, controller.signal);
            if (mergeConflict.current?.scope === key) mergeConflict.current.retry = false;
            try {
              const merged = await requestCart(
                auth.store.fetch,
                locale,
                'POST',
                undefined,
                controller.signal,
              );
              if (!cancelled && ticket === epoch.current && scope(auth.store.snapshot()) === key) {
                mergeConflict.current = null;
                setMergePending(false);
              }
              return merged;
            } catch (error) {
              if (
                error instanceof CartError &&
                [
                  'cart_session_expired',
                  'cart_limit',
                  'cart_amount_limit',
                  'cart_phone_configuration_conflict',
                  'phone_configuration_required',
                ].includes(error.code)
              ) {
                if (
                  !cancelled &&
                  ticket === epoch.current &&
                  scope(auth.store.snapshot()) === key
                ) {
                  if (
                    ['cart_phone_configuration_conflict', 'phone_configuration_required'].includes(
                      error.code,
                    )
                  )
                    mergeConflict.current = { scope: key, retry: false };
                  if (error.code !== 'cart_session_expired') setMergePending(true);
                }
                return requestCart(auth.store.fetch, locale, 'GET', undefined, controller.signal);
              }
              throw error;
            }
          });
        else {
          try {
            value = await requestCart(
              auth.store.fetch,
              locale,
              'GET',
              undefined,
              controller.signal,
            );
          } catch (error) {
            if (error instanceof CartError && error.code === 'cart_session_expired')
              value = await requestCart(
                auth.store.fetch,
                locale,
                'GET',
                undefined,
                controller.signal,
              );
            else throw error;
          }
        }
        if (!cancelled) await accept(value, key, ticket, controller.signal);
      } catch {
        if (!cancelled && ticket === epoch.current) setLoadError(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
    // A refreshed access token for the same member does not change cart ownership.
  }, [key, locale, auth.store, auth.status, registry, attempt, accept]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  function message(error: unknown) {
    if (error instanceof CartError) {
      if (error.status === 409)
        return text(
          'سبد در جای دیگری تغییر کرده است؛ اطلاعات تازه را بررسی و دوباره انتخاب کنید.',
          'Your cart changed elsewhere. Review the refreshed cart and try again.',
        );
      if (error.code === 'insufficient_stock')
        return text(
          'تعداد درخواستی از موجودی فعلی بیشتر است.',
          'The requested quantity exceeds current stock.',
        );
      if (error.code === 'cart_variant_unavailable')
        return text('این تنوع دیگر قابل خرید نیست.', 'This variant is no longer available.');
      if (error.code.includes('limit'))
        return text(
          'تعداد اقلام یا مبلغ از حد مجاز بیشتر است؛ انتخاب‌های قبلی حفظ شده‌اند.',
          'The cart exceeds its line, quantity or amount limit. Previous selections are preserved.',
        );
    }
    return text(
      'ذخیره یا بازیابی سبد انجام نشد؛ دوباره تلاش کنید.',
      'The cart could not be saved or loaded. Please retry.',
    );
  }
  async function mutate(
    change: (lines: CartLine[]) => CartLine[],
    success: string,
    onSuccess?: () => void,
  ) {
    const current = snapshot.current;
    const owner = scope(auth.store.snapshot());
    if (
      operation.current ||
      !current ||
      current.scope !== owner ||
      loadError ||
      owner === 'unavailable'
    ) {
      setToast(
        text(
          'سبد در حال بررسی است؛ کمی بعد دوباره تلاش کنید.',
          'Your cart is being checked. Please try again shortly.',
        ),
      );
      return;
    }
    operation.current = true;
    const ticket = ++epoch.current;
    setBusy(true);
    try {
      await withCartLock(async () => {
        if (scope(auth.store.snapshot()) !== owner) throw new Error('Session changed');
        const result = await requestCart(auth.store.fetch, locale, 'PUT', {
          lines: change(
            current.cart.ordinaryLines.map((l) => ({
              variantId: l.variantId,
              quantity: l.quantity,
            })),
          ),
          version: current.cart.version,
        });
        if (scope(auth.store.snapshot()) !== owner || ticket !== epoch.current) return;
        onSuccess?.();
        await accept(result, owner, ticket);
        channel.current?.postMessage({ changed: true });
        setToast(success);
      });
    } catch (error) {
      if (mounted.current && scope(auth.store.snapshot()) === owner && ticket === epoch.current) {
        setToast(message(error));
        try {
          const fresh = await requestCart(auth.store.fetch, locale);
          await accept(fresh, owner, ticket);
        } catch {
          if (mounted.current && scope(auth.store.snapshot()) === owner && ticket === epoch.current)
            setLoadError(true);
        }
      }
    } finally {
      operation.current = false;
      if (mounted.current) {
        setBusy(false);
        if (reloadAfterWrite.current) {
          reloadAfterWrite.current = false;
          retry();
        }
      }
    }
  }
  async function sendCartCommand(command: CartCommand, mode: CartCommandMode = 'send') {
    const session = auth.store.snapshot(),
      owner = session.status === 'member' ? session.session!.user.id : null;
    if (!owner || operation.current) return false;
    const current = snapshot.current;
    if (
      mode === 'send' &&
      (loadError ||
        !current ||
        current.scope !== `member:${owner}` ||
        (command.kind === 'cart-convert' ? command.body.cartVersion : command.body.version) !==
          current.cart.version)
    ) {
      setToast(
        text(
          'سبد عوض شده است؛ شرایط تازه را بازخوانی کنید.',
          'The cart changed. Reload its current conditions.',
        ),
      );
      return false;
    }
    operation.current = true;
    const ticket = ++epoch.current;
    setBusy(true);
    const runner = createCartCommandRunner({
      owner,
      locale,
      fetch: auth.store.fetch,
      active: () =>
        mounted.current &&
        scope(auth.store.snapshot()) === `member:${owner}` &&
        ticket === epoch.current,
      onFresh: async (value) => {
        await accept(value, `member:${owner}`, ticket);
        channel.current?.postMessage({ changed: true });
      },
      onError: (code) =>
        setToast(
          code === 'cart_refresh_required'
            ? text(
                'ثبت فرمان تأیید شد؛ فقط وضعیت تازهٔ سبد را دریافت کنید.',
                'The command is confirmed. Load the current cart without sending it again.',
              )
            : code === 'cart_receipt_missing'
              ? text(
                  'رسید هنوز پیدا نشد؛ همان شناسه را پیگیری کنید.',
                  'The receipt was not found yet. Follow the same command ID.',
                )
              : code === 'cart_command_unknown'
                ? text(
                    'نتیجه قطعی دریافت نشد؛ همان فرمان و شناسه در این نشست حفظ شده است.',
                    'The outcome is uncertain. The original command and ID remain in this session.',
                  )
                : text(
                    'عملیات سبد کامل نشد؛ وضعیت تازه و همان شناسه را بررسی کنید.',
                    'The cart operation did not complete. Check the current state and the same command ID.',
                  ),
        ),
    });
    try {
      return await runner(command, mode);
    } finally {
      operation.current = false;
      if (mounted.current) {
        setBusy(false);
        if (reloadAfterWrite.current) {
          reloadAfterWrite.current = false;
          retry();
        }
      }
    }
  }
  async function removeAcceptedGroup(agreementId: string, version: string) {
    const current = snapshot.current;
    if (
      !current ||
      current.cart.version !== version ||
      !current.cart.offerLines.some((line) => line.agreementId === agreementId)
    )
      return false;
    return sendCartCommand({
      kind: 'cart-remove',
      id: agreementId,
      locale,
      body: cartOfferRemovalInputSchema.parse({ requestId: crypto.randomUUID(), version }),
    });
  }
  function seed(product?: Product) {
    if (product) {
      const compared = registry
        .current()
        .filter((item) => item.id !== product.id && compare.includes(item.id));
      registry.publish('selected-product', [...compared, product]);
    }
    return registry.current();
  }
  function add(id: string, n = 1, product?: Product) {
    seed(product);
    if (!Number.isSafeInteger(n) || n < 1) return;
    void mutate((lines) => addCartSelection(lines, id, n), t('به سبد خرید اضافه شد'));
  }
  function quantity(id: string, n: number) {
    if (!Number.isSafeInteger(n) || n < 0) return;
    void mutate(
      (lines) =>
        n === 0
          ? lines.filter((l) => l.variantId !== id)
          : lines.map((l) => (l.variantId === id ? { ...l, quantity: n } : l)),
      text('سبد به‌روز شد.', 'Cart updated.'),
    );
  }
  const toggleWish = wishes.toggle;
  function toggleCompare(id: string, product?: Product, variantId?: string) {
    if (!preferencesReady) return;
    const products = seed(product);
    if (compare.includes(id)) {
      setComparison((old) => changeSavedComparison(old, id, 'remove'));
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
    const chosen = next.variants.find((variant) => variant.id === variantId)?.id;
    setComparison((old) => changeSavedComparison(old, id, 'add', chosen));
  }
  function importLegacy(ids: string[]) {
    const selected = legacy.filter((l) => ids.includes(l.variantId));
    if (!selected.length) return;
    void mutate(
      (lines) => combineLegacyCart(lines, selected),
      text('انتخاب‌های قبلی منتقل شدند.', 'Previous selections transferred.'),
      () => {
        const remaining = legacy.filter((l) => !ids.includes(l.variantId));
        try {
          localStorage.setItem(legacyKey, JSON.stringify(remaining));
        } catch {
          /* The maximum-quantity merge is safe to repeat after storage failure. */
        }
        setLegacy(remaining);
        setLegacyOpen(false);
      },
    );
  }
  const failed = loadError || auth.status === 'unavailable';
  const capabilities = cartReviewCapabilities(visible, {
    authenticated: auth.status === 'member',
    failed,
    mergePending,
  });
  return (
    <ShopContext.Provider
      value={{
        cart,
        wishlist,
        compare,
        compareVariants,
        ready,
        preferencesReady: preferencesReady && wishes.ready,
        wishlistStatus: wishes,
        loadError: failed,
        retry: () => {
          if (auth.status === 'unavailable') void auth.store.restore().catch(() => {});
          else retry();
        },
        cartOpen,
        setCartOpen,
        add,
        quantity,
        clearCart: () => {
          void mutate(() => [], text('سبد خالی شد.', 'Cart cleared.'));
        },
        toggleWish,
        toggleCompare,
        setCompareVariant: (id, variantId) =>
          setComparison((old) => changeSavedComparison(old, id, 'variant', variantId)),
        notify: setToast,
        serverCart: visible,
        cartBusy: busy,
        removeAcceptedGroup,
        sendCartCommand,
        cartCommand: ownerId ? pendingCartCommand(ownerId) : null,
        ...capabilities,
      }}
    >
      {preferencesError && (
        <div className="shop-load-error" role="alert">
          <span>
            {text(
              'بازیابی علاقه‌مندی و مقایسه انجام نشد؛ اطلاعات قبلی حفظ شده‌اند.',
              'Saved favourites and comparison could not be loaded. Previous selections are preserved.',
            )}
          </span>
          <button onClick={() => setPreferencesAttempt((n) => n + 1)}>{t('تلاش دوباره')}</button>
        </div>
      )}
      {failed && (
        <div className="shop-load-error" role="alert">
          <span>
            {text(
              'ارتباط با سبد کامل نشد؛ پیش از ادامه، وضعیت را دوباره بررسی کنید.',
              'The cart connection failed. Check its current state before continuing.',
            )}
          </span>
          <button
            onClick={() => {
              if (auth.status === 'unavailable') void auth.store.restore().catch(() => {});
              else retry();
            }}
          >
            {t('تلاش دوباره')}
          </button>
        </div>
      )}
      {mergePending && (
        <div className="shop-load-error" role="alert">
          <span>
            {text(
              'سبد پیش از ورود هنوز منتقل نشده است. می‌توانید سبد حساب را ویرایش کنید یا برای ویرایش سبد قبلی از حساب خارج شوید.',
              'Your earlier cart has not been merged yet. Edit the account cart, or sign out to edit your earlier cart.',
            )}
          </span>
          <button onClick={retryMerge}>{text('تلاش برای ادغام', 'Retry merge')}</button>
        </div>
      )}
      {!!legacy.length && !legacyHidden && (
        <div className="shop-load-error legacy-cart-notice">
          <span>
            {text(
              'انتخاب‌های قبلی این مرورگر هنوز محفوظ‌اند.',
              'Your earlier selections in this browser are preserved.',
            )}
          </span>
          <button disabled={!ready || busy} onClick={() => setLegacyOpen(true)}>
            {text('بررسی و انتقال', 'Review and transfer')}
          </button>
          <button onClick={() => setLegacyHidden(true)}>{text('بعداً', 'Later')}</button>
        </div>
      )}
      {children}
      <LegacyCartReview
        open={legacyOpen}
        onOpenChange={setLegacyOpen}
        lines={legacy}
        busy={busy}
        onImport={importLegacy}
      />
      <div className={toast ? 'toast show' : 'toast'} role="status" aria-live="polite">
        {toast}
      </div>
    </ShopContext.Provider>
  );
}
