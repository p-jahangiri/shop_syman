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
import { useStorefront } from '../navigation/locale-provider';
import { CustomerSessionStore, initialAuthState } from '@/lib/account/customer-session';
import { RmaCommandGuard } from '@sayman/web-shared/components/orders/rma-command-guard';
import { customerRmaJournal } from '@sayman/web-shared/lib/orders/rma-journal.ts';
import { rmaRequest } from '@sayman/web-shared/lib/orders/rma-client.ts';
const Context = createContext<CustomerSessionStore | null>(null);
export function AuthProvider({
  children,
  enabled = true,
}: {
  children: ReactNode;
  enabled?: boolean;
}) {
  const { dataSource, locale } = useStorefront();
  const active = enabled && dataSource === 'api';
  const channel = useRef<BroadcastChannel | null>(null);
  const [store] = useState(
    () =>
      new CustomerSessionStore(undefined, undefined, undefined, undefined, (event) => {
        channel.current?.postMessage({ event });
      }),
  );
  const state = useSyncExternalStore(store.subscribe, store.snapshot, () => initialAuthState);
  useEffect(() => {
    if (!active) return;
    void store.restore().catch(() => {});
    let bus: BroadcastChannel | null = null;
    try {
      bus = new BroadcastChannel('sayman-customer-session');
      channel.current = bus;
      bus.onmessage = (message) => {
        if (message.data?.event === 'signin' || message.data?.event === 'signout')
          store.remote(message.data.event);
      };
    } catch {
      /* Session still works in this tab. */
    }
    return () => {
      bus?.close();
      channel.current = null;
    };
  }, [active, store]);
  useEffect(() => {
    if (!active || state.status !== 'member') return;
    const timer = setTimeout(
      () => {
        void store.restore(true).catch(() => {});
      },
      Math.max(1000, state.expiresAt - Date.now() - 60000),
    );
    return () => clearTimeout(timer);
  }, [active, state, store]);
  return (
    <Context.Provider value={store}>
      <RmaCommandGuard
        journal={customerRmaJournal}
        actor={state.status === 'member' ? state.session!.user.id : null}
        locale={locale}
        unverified={
          active && ['restoring', 'unavailable'].includes(state.status) && !state.logoutPending
        }
        request={
          state.status === 'member'
            ? (path, init) => rmaRequest(store.fetch, path, init)
            : undefined
        }
      />
      {children}
    </Context.Provider>
  );
}
export function useCustomerSession() {
  const store = useContext(Context);
  if (!store) throw new Error('AuthProvider missing');
  return {
    store,
    ...useSyncExternalStore(store.subscribe, store.snapshot, () => initialAuthState),
  };
}
