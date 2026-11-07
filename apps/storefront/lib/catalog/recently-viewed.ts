import type { Product } from '@sayman/web-shared/lib/shared/types.ts';

export const recentViewsKey = 'sayman:recently-viewed:v1';
const recentViewsChanged = 'sayman:recently-viewed-changed';
const limit = 6;
export interface RecentView {
  productId: string;
  variantId: string;
}

function isId(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= 64 && value === value.trim()
  );
}

export function parseRecentViews(raw: string | null): RecentView[] {
  if (!raw || raw.length > 2048) return [];
  try {
    const entries: unknown = JSON.parse(raw);
    if (!Array.isArray(entries)) return [];
    const seen = new Set<string>();
    const result: RecentView[] = [];
    for (const entry of entries) {
      if (!entry || !isId(entry.productId) || !isId(entry.variantId) || seen.has(entry.productId))
        continue;
      seen.add(entry.productId);
      result.push({ productId: entry.productId, variantId: entry.variantId });
      if (result.length === limit) break;
    }
    return result;
  } catch {
    return [];
  }
}

export function recordRecentView(views: RecentView[], view: RecentView) {
  return [view, ...views.filter((entry) => entry.productId !== view.productId)].slice(0, limit);
}

export function resolveRecentViews(views: RecentView[], products: Product[]) {
  return views.flatMap(({ productId, variantId }) => {
    const product = products.find((entry) => entry.id === productId);
    const variant = product?.variants.find((entry) => entry.id === variantId);
    return product && variant ? [{ product, variant }] : [];
  });
}

export function readRecentViews() {
  try {
    return window.localStorage.getItem(recentViewsKey);
  } catch {
    return null;
  }
}

export function writeRecentViews(views: RecentView[]) {
  try {
    if (views.length) window.localStorage.setItem(recentViewsKey, JSON.stringify(views));
    else window.localStorage.removeItem(recentViewsKey);
  } catch {
    return;
  }
  window.dispatchEvent(new Event(recentViewsChanged));
}

export function subscribeRecentViews(onChange: () => void) {
  function onStorage(event: StorageEvent) {
    if (event.key === recentViewsKey || event.key === null) onChange();
  }
  window.addEventListener(recentViewsChanged, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(recentViewsChanged, onChange);
    window.removeEventListener('storage', onStorage);
  };
}
