'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Locale } from '@/lib/types';
import type { StorefrontSnapshot, Product } from '@/lib/types';
import { localizeData, localeFormat, translate } from '@/lib/i18n';
import { useRouter } from 'next/navigation';
const LocaleContext = createContext<Locale>('fa');
const DataContext = createContext<StorefrontSnapshot | null>(null);
interface Registry {
  publish: (scope: string, products: Product[]) => void;
  release: (scope: string) => void;
  current: () => Product[];
}
const RegistryContext = createContext<Registry | null>(null);
const mergeProducts = (lists: Product[][]) =>
  Array.from(new Map(lists.flatMap((list) => list.map((p) => [p.id, p] as const))).values());
export function LocaleProvider({
  locale,
  snapshot,
  children,
}: {
  locale: Locale;
  snapshot: StorefrontSnapshot;
  children: ReactNode;
}) {
  const router = useRouter();
  useEffect(() => {
    if (snapshot.dataSource !== 'api') return;
    let lastRefresh = 0;
    const refreshVisible = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      const now = Date.now();
      if (now - lastRefresh < 15000) return;
      lastRefresh = now;
      router.refresh();
    };
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [router, snapshot.dataSource, locale]);
  const data = useMemo(
    () => (snapshot.locale === locale ? snapshot : localizeData(snapshot, locale)),
    [snapshot, locale],
  );
  const groups = useRef(new Map<string, Product[]>());
  const [loaded, setLoaded] = useState<Product[]>([]);
  const current = useCallback(
    () => mergeProducts([data.products, ...groups.current.values()]),
    [data.products],
  );
  const publish = useCallback(
    (scope: string, products: Product[]) => {
      if (scope !== 'saved' && groups.current.has('saved')) {
        const fresh = new Map(products.map((p) => [p.id, p]));
        groups.current.set(
          'saved',
          groups.current.get('saved')!.map((p) => fresh.get(p.id) ?? p),
        );
      }
      groups.current.delete(scope);
      groups.current.set(scope, products);
      setLoaded(current());
    },
    [current],
  );
  const release = useCallback(
    (scope: string) => {
      groups.current.delete(scope);
      setLoaded(current());
    },
    [current],
  );
  const registry = useMemo(() => ({ publish, release, current }), [publish, release, current]);
  const value = useMemo(
    () => ({ ...data, products: mergeProducts([data.products, loaded]) }),
    [data, loaded],
  );
  return (
    <LocaleContext.Provider value={locale}>
      <RegistryContext.Provider value={registry}>
        <DataContext.Provider value={value}>{children}</DataContext.Provider>
      </RegistryContext.Provider>
    </LocaleContext.Provider>
  );
}
export function useProductRegistry() {
  const registry = useContext(RegistryContext);
  if (!registry) throw new Error('Product registry missing');
  return registry;
}
export function ProductsScope({
  products,
  children,
}: {
  products: Product[];
  children: ReactNode;
}) {
  const parent = useStorefront();
  const registry = useProductRegistry();
  const id = useId();
  useEffect(() => {
    registry.publish(id, products);
    return () => registry.release(id);
  }, [id, registry, products]);
  const value = useMemo(
    () => ({ ...parent, products: mergeProducts([parent.products, products]) }),
    [parent, products],
  );
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
export function useI18n() {
  const locale = useContext(LocaleContext);
  return {
    locale,
    t: <T,>(source: T, variables?: unknown[]) => translate(source, locale, variables),
    ...localeFormat(locale),
  };
}
export function useStorefront() {
  const data = useContext(DataContext);
  if (!data) throw new Error('Storefront provider missing');
  return data;
}
