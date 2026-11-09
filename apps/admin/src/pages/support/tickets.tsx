import {
  downloadPrivateTicketFile,
  type TicketDownloadTransport,
} from '@sayman/web-shared/lib/support/ticket-file-download.ts';
import { useCallback, useMemo } from 'react';
import { bindRealtimeTransport } from '@sayman/web-shared/lib/notifications/private-realtime-client.ts';
import { usePrivateRealtime } from '@sayman/web-shared/components/notifications/private-realtime';
import { isPrivateRealtimePath } from '@sayman/web-shared/lib/notifications/realtime-contract.ts';
import { api } from '../../api/api';
import { adminViewRevision } from '../../auth/admin-view-authority';
import { TicketWorkspace } from '@sayman/web-shared/components/support/ticket-workspace';
import { adminTicketJournal } from '../../state/support/ticket-journal';
import { PublicQuestionReply, SuggestedProduct } from './shopping-reply-tools';
import '../../styles/customers/customer-service-workspace.css';
import '../../styles/support/support-inbox.css';
export function TicketsPage({
  viewerId,
  writable,
  canPickProduct,
  canPublishQuestion,
}: {
  viewerId: string;
  writable: boolean;
  canPickProduct: boolean;
  canPublishQuestion: boolean;
}) {
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
    <div className="support-inbox-workspace">
      <TicketWorkspace
        live={live}
        owner={viewerId}
        staff
        writable={writable}
        locale="fa"
        transport={transport}
        download={download}
        journal={adminTicketJournal}
        replyTools={{
          suggestProduct: canPickProduct
            ? (selected, onSelect, disabled) => (
                <SuggestedProduct selected={selected} onSelect={onSelect} disabled={disabled} />
              )
            : undefined,
          publishQuestion: canPublishQuestion
            ? (ticket, first, refresh) => (
                <PublicQuestionReply
                  key={ticket.id}
                  ticket={ticket}
                  first={first}
                  refresh={refresh}
                />
              )
            : undefined,
        }}
      />
    </div>
  );
}
