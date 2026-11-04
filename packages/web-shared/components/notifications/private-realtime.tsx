'use client';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { RealtimeRefreshGate } from '../../lib/notifications/realtime-refresh';
import {
  PrivateRealtimeClient,
  type PrivateRealtimeTransport,
} from '../../lib/notifications/private-realtime-client';
import type { RealtimeScope } from '../../lib/notifications/realtime-contract';
export function usePrivateRealtime(
  owner: string | null,
  base: '/api/realtime' | '/api/admin/realtime',
  transport: PrivateRealtimeTransport,
) {
  const client = useMemo(
    () => (owner ? new PrivateRealtimeClient(base, transport) : null),
    [owner, base, transport],
  );
  useEffect(() => {
    if (client) void client.start();
    return () => {
      if (client) void client.stop();
    };
  }, [client]);
  return client;
}
export function useRealtimeRefresh(
  client: PrivateRealtimeClient | null | undefined,
  scope: RealtimeScope,
  refresh: () => void,
  busy: boolean,
) {
  const current = useRef({ refresh, busy });
  current.current = { refresh, busy };
  const gate = useRef<RealtimeRefreshGate | null>(null);
  useEffect(() => {
    const active = new RealtimeRefreshGate(
      () => current.current.refresh(),
      () => current.current.busy,
    );
    gate.current = active;
    const unsubscribe = client?.listen((value) => {
      if (value === scope) active.changed();
    });
    return () => {
      unsubscribe?.();
      active.dispose();
      if (gate.current === active) gate.current = null;
    };
  }, [client, scope]);
  useEffect(() => {
    if (!busy) gate.current?.resume();
  }, [busy, client, scope]);
}
const emptySubscribe = () => () => {},
  emptySnapshot = () => 'stopped' as const;
export function PrivateRealtimeStatus({
  client,
  locale,
}: {
  client: PrivateRealtimeClient | null | undefined;
  locale: 'fa' | 'en';
}) {
  const status = useSyncExternalStore(
      client?.subscribe ?? emptySubscribe,
      client?.snapshot ?? emptySnapshot,
      emptySnapshot,
    ),
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  if (!client) return null;
  return (
    <div className="private-realtime-status" role="status">
      <span className={status === 'connected' ? 'connected' : 'disconnected'} aria-hidden="true" />
      {status === 'connected'
        ? text('به‌روزرسانی زنده متصل است', 'Live updates connected')
        : status === 'connecting' || status === 'reconnecting'
          ? text('در حال اتصال به به‌روزرسانی زنده…', 'Connecting live updates…')
          : text(
              'به‌روزرسانی زنده قطع است؛ تازه‌سازی دستی در دسترس است.',
              'Live updates are offline. You can refresh manually.',
            )}
      {status === 'offline' && (
        <button type="button" onClick={() => void client.retry()}>
          {text('تلاش برای اتصال', 'Reconnect')}
        </button>
      )}
    </div>
  );
}
