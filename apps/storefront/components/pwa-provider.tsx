'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useI18n } from './locale-provider';
import { createCatalogWarmup } from '@/lib/pwa-catalog-warm';
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};
type Phase = 'checking' | 'ready' | 'unsupported' | 'unavailable' | 'disabled';
interface PwaContextValue {
  phase: Phase;
  installed: boolean;
  ios: boolean;
  canInstall: boolean;
  updateAvailable: boolean;
  updateBlocked: boolean;
  install: () => Promise<void>;
  update: () => void;
  clearCatalog: () => Promise<void>;
}
const PwaContext = createContext<PwaContextValue | null>(null);
const owns = (worker: ServiceWorker | null | undefined) =>
  worker?.scriptURL === new URL('/sw.js', window.location.origin).href;
const sensitive = () =>
  /^\/(?:fa\/|en\/)?(?:account|cart|checkout|payment|payments|orders|addresses|sourcing|credit|admin)(?:\/|$)/.test(
    window.location.pathname,
  );
export function PwaProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const { locale } = useI18n();
  const [phase, setPhase] = useState<Phase>('checking');
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [updateBlocked, setUpdateBlocked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let updateRequested = false;
    let updateWorker: ServiceWorker | null = null;
    let updateChannel: MessageChannel | null = null;
    let updateTimer: ReturnType<typeof setTimeout> | undefined;
    const media = window.matchMedia('(display-mode: standalone)');
    const installation = () =>
      setInstalled(
        media.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
      );
    installation();
    setIos(
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    );
    const before = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallEvent);
    };
    const installedEvent = () => {
      setInstalled(true);
      setPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', before);
    window.addEventListener('appinstalled', installedEvent);
    media.addEventListener('change', installation);
    const warmer = createCatalogWarmup(locale, {
      loaded: () => document.readyState === 'complete',
      afterLoad(task) {
        window.addEventListener('load', task, { once: true });
        return () => window.removeEventListener('load', task);
      },
      idle(task) {
        if ('requestIdleCallback' in window) {
          const id = window.requestIdleCallback(task, { timeout: 5000 });
          return () => window.cancelIdleCallback(id);
        }
        const id = setTimeout(task, 1500);
        return () => clearTimeout(id);
      },
      eligible() {
        const connection = (
          navigator as Navigator & {
            connection?: { saveData?: boolean; effectiveType?: string };
          }
        ).connection;
        return (
          enabled &&
          !cancelled &&
          !sensitive() &&
          document.visibilityState !== 'hidden' &&
          !connection?.saveData &&
          !['slow-2g', '2g'].includes(connection?.effectiveType ?? '') &&
          owns(navigator.serviceWorker?.controller)
        );
      },
      async fetcher(path, init) {
        const response = await fetch(path, init);
        if (!response.ok) throw Error('Offline catalog refresh unavailable');
      },
    });
    const warm = () => warmer.request();
    const online = () => warmer.request(true);
    const controller = () => {
      if (cancelled) return;
      if (owns(navigator.serviceWorker.controller)) {
        setPhase('ready');
        warm();
      }
    };
    const reload = () => {
      if (!updateRequested) return;
      updateRequested = false;
      clearTimeout(updateTimer);
      setWaiting(null);
      if (!sensitive()) window.location.reload();
    };
    const activated = () => {
      if (updateWorker?.state === 'activated') reload();
    };
    const activate = (event: Event) => {
      if (sensitive()) return;
      const worker = (event as CustomEvent<ServiceWorker>).detail;
      if (!worker) return;
      clearTimeout(updateTimer);
      updateChannel?.port1.close();
      updateWorker?.removeEventListener('statechange', activated);
      updateWorker = worker;
      worker.addEventListener('statechange', activated);
      const channel = new MessageChannel();
      updateChannel = channel;
      setUpdateBlocked(false);
      updateRequested = true;
      updateTimer = setTimeout(() => {
        if (!updateRequested) return;
        updateRequested = false;
        channel.port1.close();
        worker.removeEventListener('statechange', activated);
        if (!cancelled) setUpdateBlocked(true);
      }, 10000);
      channel.port1.onmessage = (message) => {
        channel.port1.close();
        if (!message.data?.activated) {
          clearTimeout(updateTimer);
          updateRequested = false;
          worker.removeEventListener('statechange', activated);
          if (!cancelled) setUpdateBlocked(true);
        } else activated();
      };
      worker.postMessage({ type: 'ACTIVATE_UPDATE' }, [channel.port2]);
    };
    const ready = async () => {
      if (!('serviceWorker' in navigator) || !window.isSecureContext) {
        setPhase('unsupported');
        return;
      }
      if (!enabled) {
        try {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (const registration of registrations)
            if (
              owns(registration.active) ||
              owns(registration.waiting) ||
              owns(registration.installing)
            ) {
              registration.active?.postMessage({ type: 'DISABLE_PWA' });
              await registration.unregister();
            }
        } catch {
          if (!cancelled) setPhase('unavailable');
          return;
        }
        if (!cancelled) setPhase('disabled');
        return;
      }
      navigator.serviceWorker.addEventListener('controllerchange', controller);
      navigator.serviceWorker.addEventListener('controllerchange', reload);
      window.addEventListener('sayman-activate-update', activate);
      window.addEventListener('online', online);
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'none',
        });
        if (cancelled) return;
        const showWaiting = () => {
          if (!cancelled && owns(registration.waiting)) setWaiting(registration.waiting);
        };
        showWaiting();
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          installing?.addEventListener('statechange', () => {
            if (installing.state === 'installed') showWaiting();
          });
        });
        await navigator.serviceWorker.ready;
        if (cancelled) return;
        setPhase('ready');
        warm();
        void registration.update().catch(() => {});
      } catch {
        if (!cancelled) setPhase('unavailable');
      }
    };
    void ready();
    return () => {
      cancelled = true;
      warmer.dispose();
      updateWorker?.removeEventListener('statechange', activated);
      clearTimeout(updateTimer);
      updateChannel?.port1.close();
      window.removeEventListener('beforeinstallprompt', before);
      window.removeEventListener('appinstalled', installedEvent);
      media.removeEventListener('change', installation);
      window.removeEventListener('online', online);
      window.removeEventListener('sayman-activate-update', activate);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('controllerchange', controller);
        navigator.serviceWorker.removeEventListener('controllerchange', reload);
      }
    };
  }, [enabled, locale]);
  const install = async () => {
    if (!prompt) return;
    await prompt.prompt();
    const result = await prompt.userChoice;
    if (result.outcome === 'accepted') setInstalled(true);
    setPrompt(null);
  };
  const update = () => {
    if (waiting && !sensitive())
      window.dispatchEvent(new CustomEvent('sayman-activate-update', { detail: waiting }));
  };
  const clearCatalog = async () => {
    const worker = navigator.serviceWorker?.controller;
    if (!worker || !owns(worker)) return;
    await new Promise<void>((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => {
        channel.port1.close();
        reject(new Error('Offline storage is unavailable.'));
      }, 5000);
      channel.port1.onmessage = () => {
        clearTimeout(timer);
        channel.port1.close();
        resolve();
      };
      worker.postMessage({ type: 'CLEAR_OFFLINE_CATALOG' }, [channel.port2]);
    });
  };
  return (
    <PwaContext.Provider
      value={{
        phase,
        installed,
        ios,
        canInstall: !!prompt,
        updateAvailable: !!waiting,
        updateBlocked,
        install,
        update,
        clearCatalog,
      }}
    >
      {children}
    </PwaContext.Provider>
  );
}
export function usePwa() {
  const value = useContext(PwaContext);
  if (!value) throw new Error('PWA provider missing.');
  return value;
}
