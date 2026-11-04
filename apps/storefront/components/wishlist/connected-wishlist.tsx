'use client';
import { useMemo, useEffect, useState, useSyncExternalStore } from 'react';
import { useCustomerSession } from '../auth/auth-provider';
import { useI18n, useProductRegistry } from '../navigation/locale-provider';
import { WishlistController } from '@/lib/wishlist/wishlist-client';
import { mergeWishlist } from '@/lib/wishlist/wishlist-contract';
import { lookupProducts } from '@/lib/catalog/catalog-client';
import { parseSavedShop } from '@/lib/wishlist/saved-shop';
import type { Product } from '@sayman/web-shared/lib/shared/types.ts';
const guestKey = 'sayman:wishlist:guest:v1';
function readGuest(): string[] | null {
  let raw: string | null, old: string | null;
  try {
    raw = localStorage.getItem(guestKey);
    old =
      raw === null
        ? (localStorage.getItem('sayman:preferences:v1') ?? localStorage.getItem('sayman:shop:v1'))
        : null;
  } catch {
    return [];
  }
  try {
    return parseSavedShop(
      raw === null ? JSON.parse(old ?? '{}') : { wishlist: JSON.parse(raw) },
    ).wishlist.filter((id) => /^[a-z0-9_-]{1,64}$/.test(id));
  } catch {
    return null;
  }
}
function saveGuest(ids: string[]) {
  try {
    localStorage.setItem(guestKey, JSON.stringify(ids));
  } catch {
    /* Guest browsing continues in RAM. */
  }
}
export function useConnectedWishlist(notify: (value: string) => void) {
  const auth = useCustomerSession(),
    { locale } = useI18n(),
    registry = useProductRegistry();
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const [controller] = useState(() => new WishlistController(auth.store.fetch)),
    state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  const owner = auth.status === 'member' ? auth.session!.user.id.toUpperCase() : null;
  const [guest, setGuest] = useState<string[]>([]),
    [guestReady, setGuestReady] = useState(false),
    [guestError, setGuestError] = useState(false),
    [hydrated, setHydrated] = useState<string | null>(null),
    [error, setError] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const ids = readGuest();
    setGuestError(ids === null);
    if (ids !== null) {
      setGuest(ids);
      saveGuest(ids);
      setGuestReady(true);
    }
  }, [attempt]);
  useEffect(() => {
    controller.bind(owner);
    if (owner) void controller.load();
    return () => {
      controller.bind(null);
    };
  }, [owner, controller]);
  useEffect(() => {
    const reload = () => {
      if (owner) void controller.load();
      else setAttempt((n) => n + 1);
    };
    const storage = (e: StorageEvent) => {
      if (e.key === guestKey) setAttempt((n) => n + 1);
    };
    window.addEventListener('focus', reload);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener('focus', reload);
      window.removeEventListener('storage', storage);
    };
  }, [owner, controller]);
  const data = owner && state.owner === owner ? state.data : null;
  const ids = useMemo(
    () => (owner ? (data?.productIds ?? []) : auth.status === 'guest' ? guest : []),
    [owner, data, auth.status, guest],
  );
  const binding = owner
    ? data
      ? owner + ':' + data.version + ':' + locale + ':' + guest.join(',')
      : null
    : auth.status === 'guest' && guestReady
      ? 'guest:' + guest.join(',') + ':' + locale
      : null;
  useEffect(() => {
    if (!binding) {
      registry.release('wishlist');
      setHydrated(null);
      return;
    }
    const abort = new AbortController();
    let cancelled = false;
    setError(false);
    async function load() {
      try {
        const products: Product[] = [],
          lookupIds = [...new Set([...ids, ...(owner ? guest : [])])];
        for (let n = 0; n < lookupIds.length; n += 64)
          products.push(
            ...(await lookupProducts(
              locale,
              { productIds: lookupIds.slice(n, n + 64) },
              abort.signal,
            )),
          );
        if (!cancelled) {
          registry.publish('wishlist', products);
          setHydrated(binding);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
      abort.abort();
      registry.release('wishlist');
    };
  }, [binding, attempt, registry, locale, ids, owner, guest]);
  const ready =
      binding !== null &&
      binding === hydrated &&
      !state.failed &&
      !error &&
      (!guestError || !!owner),
    memberBusy = !!owner && (state.owner !== owner || state.busy),
    blocked = auth.status !== 'guest' && !owner;
  const retry = () => {
    if (owner) void controller.load();
    setAttempt((n) => n + 1);
  };
  async function replace(next: string[]) {
    if (owner) {
      const ok = await controller.replace(next);
      if (!ok && auth.store.snapshot().session?.user.id.toUpperCase() === owner)
        notify(
          text(
            'ذخیره قطعی نشد؛ وضعیت جاری بازخوانی شد. انتخاب را بررسی کنید.',
            'Save was not confirmed; the current list was reloaded. Review your selection.',
          ),
        );
      return ok;
    }
    if (auth.status !== 'guest') return false;
    setGuest(next);
    saveGuest(next);
    return true;
  }
  function toggle(id: string, product?: Product) {
    if (!ready || memberBusy || blocked) return;
    if (product) registry.publish('wishlist-selection', [product]);
    if (!ids.includes(id) && ids.length >= 200) {
      notify(text('فهرست علاقه‌مندی پر شده است.', 'Your favourites list is full.'));
      return;
    }
    void replace(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  }
  async function importGuest(selected?: string[]) {
    if (!owner || !ready || memberBusy || guestError || !guest.length) return false;
    try {
      const incoming = selected ?? guest.slice();
      if (!incoming.length || incoming.some((id) => !guest.includes(id))) return false;
      const combined = mergeWishlist(ids, incoming);
      if (!(await replace(combined))) return false;
      if (auth.store.snapshot().session?.user.id.toUpperCase() !== owner) return false;
      const previous = readGuest();
      if (previous === null) {
        setGuestError(true);
        return false;
      }
      const remaining = previous.filter((id) => !incoming.includes(id));
      setGuest(remaining);
      saveGuest(remaining);
      return true;
    } catch {
      notify(
        text(
          'همهٔ انتخاب‌ها قابل انتقال نیستند؛ ظرفیت یا وضعیت انتشار کالاها را بررسی کنید.',
          'These selections could not all be imported. Check capacity and product availability.',
        ),
      );
      return false;
    }
  }
  return {
    wishlist: ids,
    ready,
    busy: memberBusy,
    failed: state.failed || error || guestError,
    retry,
    toggle,
    guestWishlist: owner && !guestError ? guest : [],
    importGuest,
    account: !!owner,
    issue: owner ? state.issue : null,
  };
}
