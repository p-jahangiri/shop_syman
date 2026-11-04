'use client';
import {
  downloadPrivateTicketFile,
  type TicketDownloadTransport,
} from '@sayman/web-shared/lib/support/ticket-file-download.ts';
import { bindRealtimeTransport } from '@sayman/web-shared/lib/notifications/private-realtime-client.ts';
import { usePrivateRealtime } from '@sayman/web-shared/components/notifications/private-realtime';
import { useCallback, useMemo } from 'react';
import { useCustomerSession } from '../auth/auth-provider';
import { useI18n, useStorefront } from '../navigation/locale-provider';
import Link, { useRouter } from '../navigation/localized-link';
import {
  TicketWorkspace,
  TicketRequestError,
} from '@sayman/web-shared/components/support/ticket-workspace';
import { customerTicketJournal } from '@sayman/web-shared/lib/support/ticket-journal.ts';
export function CustomerTickets({ id }: { id?: string }) {
  const auth = useCustomerSession(),
    { locale } = useI18n(),
    { dataSource } = useStorefront(),
    router = useRouter(),
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const transport = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const owner = auth.store.snapshot().session?.user.id;
      const response = await auth.store.fetch(path, init);
      const data = await response.json().catch(() => null);
      if (
        auth.store.snapshot().status !== 'member' ||
        auth.store.snapshot().session?.user.id !== owner
      )
        throw new TicketRequestError(0, 'session_changed');
      if (!response.ok)
        throw new TicketRequestError(
          response.status,
          typeof data?.title === 'string' ? data.title : 'ticket_unavailable',
        );
      return data;
    },
    [auth.store],
  );
  const realtimeOwner =
    dataSource === 'api' && auth.status === 'member' ? auth.session!.user.id : null;
  const realtimeTransport = useMemo(
    () =>
      bindRealtimeTransport(
        (path, init) => auth.store.fetch(path, init),
        () => {
          const current = auth.store.snapshot();
          return (
            !!realtimeOwner &&
            current.status === 'member' &&
            current.session?.user.id === realtimeOwner
          );
        },
      ),
    [auth.store, realtimeOwner],
  );
  const live = usePrivateRealtime(realtimeOwner, '/api/realtime', realtimeTransport);
  const downloadSession = auth.session;
  const download = useMemo<TicketDownloadTransport>(
    () => (path, id, metadata, signal) =>
      downloadPrivateTicketFile(
        (path, init) => auth.store.fetch(path, init),
        () => {
          const current = auth.store.snapshot();
          return (
            !!realtimeOwner &&
            current.status === 'member' &&
            current.session === downloadSession &&
            current.session?.user.id === realtimeOwner
          );
        },
        path,
        id,
        metadata,
        signal,
      ),
    [auth.store, realtimeOwner, downloadSession],
  );
  return (
    <div className="container support-tickets-page">
      <div className="page-top">
        <Link href="/support">{text('راهنما و پشتیبانی', 'Help and support')}</Link>
      </div>
      <h1>{text('پیگیری پشتیبانی', 'Support requests')}</h1>
      {dataSource !== 'api' ? (
        <p>
          {text(
            'تیکت واقعی فقط با اتصال API در دسترس است.',
            'Support requests require an API connection.',
          )}
        </p>
      ) : auth.status === 'member' && auth.session ? (
        <TicketWorkspace
          key={auth.session.user.id}
          owner={auth.session.user.id}
          locale={locale}
          transport={transport}
          live={live}
          download={download}
          journal={customerTicketJournal}
          initialTicketId={id}
          onSelect={(value) => router.push('/support/tickets' + (value ? '/' + value : ''))}
        />
      ) : auth.status === 'restoring' ? (
        <p role="status">{text('در حال بررسی حساب…', 'Checking your account…')}</p>
      ) : (
        <div className="card-panel">
          <p>
            {text(
              'برای دیدن و ثبت پیام خصوصی، وارد حساب خود شوید.',
              'Sign in to read and send private messages.',
            )}
          </p>
          {auth.status === 'unavailable' && (
            <button type="button" onClick={() => void auth.store.restore()}>
              {text('بررسی دوبارهٔ حساب', 'Recheck account')}
            </button>
          )}
          <Link href="/account">{text('ورود به حساب', 'Sign in')}</Link>
        </div>
      )}
    </div>
  );
}
