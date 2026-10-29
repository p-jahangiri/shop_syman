import {
  downloadPrivateTicketFile,
  type TicketDownloadTransport,
} from '../../storefront/lib/ticket-file-download';
import { useCallback, useMemo } from 'react';
import { bindRealtimeTransport } from '../../storefront/lib/private-realtime-client';
import { usePrivateRealtime } from '../../storefront/components/private-realtime';
import { isPrivateRealtimePath } from '../../storefront/lib/realtime-contract';
import { api } from './api';
import { adminViewRevision } from './admin-view-authority';
import { TicketWorkspace } from '../../storefront/components/ticket-workspace';
import { adminTicketJournal } from './ticket-journal';
export function TicketsPage({ viewerId, writable }: { viewerId: string; writable: boolean }) {
  const transport = useCallback(async (path: string, init: RequestInit = {}) => {
    if (!path.startsWith('/api/admin/support/')) throw Error('Invalid private support path');
    const revision = adminViewRevision(),
      raw = await api<unknown>(path.slice(4), init);
    if (revision !== adminViewRevision()) throw Error('Support authorization changed.');
    return raw;
  }, []);
  const binding = adminViewRevision();
  const realtimeTransport = useMemo(
    () =>
      bindRealtimeTransport(
        async (path, init) => {
          if (!isPrivateRealtimePath(path, init.method ?? 'GET', true))
            throw Error('Invalid private realtime path');
          return api<Response>(path.slice(4), init, 'response');
        },
        () => binding === adminViewRevision(),
      ),
    [binding],
  );
  const live = usePrivateRealtime(viewerId, '/api/admin/realtime', realtimeTransport);
  const download = useMemo<TicketDownloadTransport>(
    () => (path, id, metadata, signal) =>
      downloadPrivateTicketFile(
        (path, init) => api<Response>(path.slice(4), init, 'response'),
        () => binding === adminViewRevision(),
        path,
        id,
        metadata,
        signal,
        true,
      ),
    [binding],
  );
  return (
    <TicketWorkspace
      live={live}
      owner={viewerId}
      staff
      writable={writable}
      locale="fa"
      transport={transport}
      download={download}
      journal={adminTicketJournal}
    />
  );
}
