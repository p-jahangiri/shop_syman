import type { Locale } from '@sayman/web-shared/lib/shared/types.ts';

export interface CatalogWarmupEnvironment {
  loaded: () => boolean;
  afterLoad: (task: () => void) => () => void;
  idle: (task: () => void) => () => void;
  eligible: () => boolean;
  fetcher: (path: string, init: RequestInit) => Promise<unknown>;
}

// Offline catalog refresh is optional background work, never a prerequisite for browsing.
export function createCatalogWarmup(locale: Locale, environment: CatalogWarmupEnvironment) {
  let disposed = false;
  let complete = false;
  let scheduled = false;
  let cancelPending: (() => void) | undefined;
  let controller: AbortController | undefined;
  const run = () => {
    cancelPending = undefined;
    scheduled = false;
    if (disposed || complete || controller || !environment.eligible()) return;
    const current = new AbortController();
    controller = current;
    void environment
      .fetcher(`/pwa/catalog/${locale}.json`, {
        credentials: 'omit',
        cache: 'no-cache',
        signal: current.signal,
      })
      .then(() => {
        if (!disposed && !current.signal.aborted) complete = true;
      })
      .catch(() => {
        // An online event can retry a failed optional refresh.
      })
      .finally(() => {
        if (controller === current) controller = undefined;
      });
  };
  const queueIdle = () => {
    if (!disposed) cancelPending = environment.idle(run);
  };
  return {
    request(refresh = false) {
      if (refresh) complete = false;
      if (disposed || complete || scheduled || controller || !environment.eligible()) return;
      scheduled = true;
      if (environment.loaded()) queueIdle();
      else cancelPending = environment.afterLoad(queueIdle);
    },
    dispose() {
      disposed = true;
      cancelPending?.();
      controller?.abort();
    },
  };
}
