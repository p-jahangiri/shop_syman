'use client';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useCustomerSession } from '../auth/auth-provider';
import { useI18n } from '../navigation/locale-provider';
import { useShop } from '../providers/shop-context';
import { CartError, withCartLock } from '@/lib/checkout/cart-client';
import { readSourcingCart, replaceSourcingCart } from '@/lib/market/sourcing-client';
import type { SourcingCart } from '@sayman/web-shared/lib/market/sourcing-contract.ts';
import {
  readSourcingJournal,
  subscribeSourcingJournal,
  sourcingJournalRevision,
  sourcingJournalBlocksNewIntent,
} from '@/lib/market/sourcing-journal';
const scope = (value: ReturnType<typeof useCustomerSession>['store']) => {
  const state = value.snapshot();
  return state.status === 'member'
    ? `member:${state.session!.user.id}`
    : state.status === 'guest'
      ? 'guest'
      : null;
};
interface SourcingContextValue {
  cart: SourcingCart | null;
  ready: boolean;
  busy: boolean;
  error: string;
  unknown: boolean;
  locked: boolean;
  refresh: () => void;
  add: (id: string, quantity: number, configurationId?: string) => Promise<boolean>;
  quantity: (id: string, quantity: number) => Promise<boolean>;
}
const Context = createContext<SourcingContextValue | null>(null);
export function useSourcing() {
  return useContext(Context);
}
export function useSourcingCommand() {
  const auth = useCustomerSession();
  useSyncExternalStore(subscribeSourcingJournal, sourcingJournalRevision, () => 0);
  const owner = auth.status === 'member' ? auth.session!.user.id : null;
  return { owner, pending: owner ? readSourcingJournal(owner) : null };
}
export function SourcingProvider({ children }: { children: ReactNode }) {
  const { locale } = useI18n(),
    auth = useCustomerSession(),
    shop = useShop(),
    key = scope(auth.store),
    journal = useSourcingCommand();
  const [value, setValue] = useState<{ key: string; cart: SourcingCart } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [unknown, setUnknown] = useState(false),
    [attempt, setAttempt] = useState(0);
  const epoch = useRef(0),
    operation = useRef(false),
    mounted = useRef(true),
    channel = useRef<BroadcastChannel | null>(null);
  const current = useRef(value);
  current.current = value;
  const cart = value?.key === key ? value.cart : null,
    locked = !!journal.pending && !journal.pending.result;
  useEffect(() => {
    if (!locked) return;
    const leave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [locked]);
  const refresh = () => {
    if (auth.store.snapshot().status === 'unavailable') void auth.store.restore().catch(() => {});
    else setAttempt((count) => count + 1);
  };
  useEffect(() => {
    mounted.current = true;
    let bus: BroadcastChannel | null = null;
    try {
      bus = new BroadcastChannel('sayman-cart');
      channel.current = bus;
      bus.onmessage = () => setAttempt((count) => count + 1);
    } catch {
      /* Cross-tab transport is optional; owned request validation remains authoritative. */
    }
    return () => {
      mounted.current = false;
      bus?.close();
      channel.current = null;
    };
  }, []);
  useEffect(() => {
    if (operation.current) return;
    const controller = new AbortController(),
      ticket = ++epoch.current;
    if (current.current?.key !== key) {
      setValue(null);
      current.current = null;
      setError('');
      setUnknown(false);
    }
    if (!key || !shop.ready) return;
    void readSourcingCart(auth.store.fetch, locale, controller.signal)
      .then((result) => {
        if (
          mounted.current &&
          !controller.signal.aborted &&
          scope(auth.store) === key &&
          ticket === epoch.current
        ) {
          setValue({ key, cart: result });
          setError('');
          setUnknown(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && ticket === epoch.current)
          setError('sourcing_unavailable');
      });
    return () => controller.abort();
  }, [key, locale, shop.ready, shop.serverCart?.version, attempt, auth.store]);
  async function change(id: string, quantity: number, adding: boolean, configurationId?: string) {
    const owner = scope(auth.store);
    if (
      !owner ||
      operation.current ||
      locked ||
      unknown ||
      !Number.isSafeInteger(quantity) ||
      quantity < 0 ||
      quantity > 1000000
    )
      return false;
    operation.current = true;
    setBusy(true);
    setError('');
    let sent = false;
    const ticket = ++epoch.current;
    try {
      return await withCartLock(async () => {
        if (scope(auth.store) !== owner) throw new Error('Owner changed');
        if (sourcingJournalBlocksNewIntent(auth.store.snapshot().session?.user.id ?? null))
          return false;
        const fresh = await readSourcingCart(auth.store.fetch, locale);
        if (scope(auth.store) !== owner) throw new Error('Owner changed');
        if (sourcingJournalBlocksNewIntent(auth.store.snapshot().session?.user.id ?? null))
          return false;
        const old = fresh.lines.find((line) => line.listingId === id),
          chosen = configurationId ?? old?.configurationId,
          count =
            adding && old?.configurationId === chosen ? (old?.quantity ?? 0) + quantity : quantity;
        if (count > 1000000) throw new CartError('sourcing_limit', 400);
        const lines = fresh.lines
          .filter((line) => line.listingId !== id)
          .map((line) => ({
            listingId: line.listingId,
            quantity: line.quantity,
            ...(line.configurationId ? { configurationId: line.configurationId } : {}),
          }));
        if (count)
          lines.push({
            listingId: id,
            quantity: count,
            ...(chosen ? { configurationId: chosen } : {}),
          });
        sent = true;
        const result = await replaceSourcingCart(auth.store.fetch, locale, {
          version: fresh.version,
          lines,
        });
        if (!mounted.current || scope(auth.store) !== owner || ticket !== epoch.current)
          return false;
        setValue({ key: owner, cart: result });
        setUnknown(false);
        channel.current?.postMessage({ changed: true });
        shop.retry();
        return true;
      });
    } catch (caught) {
      if (mounted.current && scope(auth.store) === owner && ticket === epoch.current) {
        const status = caught instanceof CartError ? caught.status : 0;
        setError(caught instanceof CartError ? caught.code : 'sourcing_unavailable');
        if (sent && (status === 0 || status >= 500)) setUnknown(true);
        else if (status === 409) setAttempt((count) => count + 1);
      }
      return false;
    } finally {
      operation.current = false;
      if (mounted.current) {
        setBusy(false);
        if (scope(auth.store) !== owner) setAttempt((count) => count + 1);
      }
    }
  }
  return (
    <Context.Provider
      value={{
        cart,
        ready: cart !== null,
        busy,
        error,
        unknown,
        locked,
        refresh,
        add: (id, quantity, configurationId) => change(id, quantity, true, configurationId),
        quantity: (id, quantity) => change(id, quantity, false),
      }}
    >
      {children}
    </Context.Provider>
  );
}
