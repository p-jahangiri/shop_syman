'use client';
import {
  downloadPrivateTicketFile,
  type TicketDownloadTransport,
} from '@sayman/web-shared/lib/support/ticket-file-download.ts';
import { bindRealtimeTransport } from '@sayman/web-shared/lib/notifications/private-realtime-client.ts';
import { usePrivateRealtime } from '@sayman/web-shared/components/notifications/private-realtime';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Headphones, Plus, ShoppingBag } from 'lucide-react';
import './customer-tickets.css';
import { useCustomerSession } from '../auth/auth-provider';
import { useI18n, useStorefront } from '../navigation/locale-provider';
import { Modal } from '../shared/ui';
import Link, { useRouter } from '../navigation/localized-link';
import {
  TicketWorkspace,
  TicketRequestError,
} from '@sayman/web-shared/components/support/ticket-workspace';
import { customerTicketJournal } from '@sayman/web-shared/lib/support/ticket-journal.ts';
import type { ShoppingRequest } from '@sayman/web-shared/components/support/shopping-request-fields';
export function CustomerTickets({
  id,
  shoppingRequest,
}: {
  id?: string;
  shoppingRequest?: ShoppingRequest;
}) {
  const auth = useCustomerSession(),
    { locale } = useI18n(),
    { dataSource } = useStorefront(),
    router = useRouter(),
    base = shoppingRequest ? '/purchase-requests' : '/support/tickets',
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const [compose, setCompose] = useState(Boolean(shoppingRequest?.product));
  const composeButton = useRef<HTMLButtonElement>(null);
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
    <div
      className="container support-tickets-page"
      data-purchase={Boolean(shoppingRequest) || undefined}
    >
      <header
        className="customer-ticket-header"
        data-kind={shoppingRequest ? 'shopping' : 'support'}
      >
        <nav aria-label={text('مسیر صفحه', 'Breadcrumb')}>
          <Link href="/account">{text('حساب کاربری', 'Your account')}</Link>
          <span aria-hidden="true">/</span>
          <Link href="/support">{text('راهنما و پشتیبانی', 'Help and support')}</Link>
        </nav>
        <div className="customer-ticket-title">
          <span className="customer-ticket-icon" aria-hidden="true">
            {shoppingRequest ? <ShoppingBag size={23} /> : <Headphones size={23} />}
          </span>
          <div>
            <h1>
              {shoppingRequest
                ? text('درخواست‌های خرید', 'Purchase requests')
                : text('پیگیری پشتیبانی', 'Support requests')}
            </h1>
            <p>
              {shoppingRequest
                ? text(
                    'وضعیت درخواست‌ها، پاسخ سایمان و پیشنهادهای خرید را اینجا ببینید.',
                    'Track requests, replies and purchase suggestions here.',
                  )
                : text(
                    'درخواست‌ها و گفت‌وگوهای خصوصی شما با سایمان، یک‌جا.',
                    'Your requests and private conversations with Sayman, in one place.',
                  )}
            </p>
          </div>
          {dataSource === 'api' &&
            auth.status === 'member' &&
            (shoppingRequest ? (
              <button
                ref={composeButton}
                type="button"
                className="button button-outline"
                onClick={() => setCompose(true)}
              >
                <Plus size={17} aria-hidden="true" />
                {text('درخواست خرید تازه', 'New purchase request')}
              </button>
            ) : id ? (
              <Link href={base + '#customer-ticket-compose'} className="button button-outline">
                <Plus size={17} aria-hidden="true" />
                {text('درخواست تازه', 'New request')}
              </Link>
            ) : (
              <a href="#customer-ticket-compose" className="button button-outline">
                <Plus size={17} aria-hidden="true" />
                {text('درخواست تازه', 'New request')}
              </a>
            ))}
        </div>
      </header>
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
          shoppingRequest={shoppingRequest}
          listKind={shoppingRequest ? 'purchase' : 'support'}
          renderPurchaseComposer={
            shoppingRequest
              ? (form) => (
                  <Modal
                    open={compose}
                    onOpenChange={setCompose}
                    restoreFocusRef={composeButton}
                    className="purchase-request-modal"
                    title={text('درخواست تهیهٔ کالا', 'Request a product')}
                  >
                    {form}
                  </Modal>
                )
              : undefined
          }
          onPurchaseSaved={
            shoppingRequest
              ? (value) => {
                  setCompose(false);
                  router.replace(base + '/' + value);
                }
              : undefined
          }
          onSelect={(value) => router.push(base + (value ? '/' + value : ''))}
        />
      ) : auth.status === 'restoring' ? (
        <p role="status">{text('در حال بررسی حساب…', 'Checking your account…')}</p>
      ) : (
        <div className="card-panel">
          <p>
            {text(
              shoppingRequest
                ? 'برای ثبت یا پیگیری درخواست خرید، وارد حساب خود شوید.'
                : 'برای دیدن و ثبت پیام خصوصی، وارد حساب خود شوید.',
              shoppingRequest
                ? 'Sign in to submit or track a purchase request.'
                : 'Sign in to read and send private messages.',
            )}
          </p>
          {auth.status === 'unavailable' && (
            <button type="button" onClick={() => void auth.store.restore()}>
              {text('بررسی دوبارهٔ حساب', 'Recheck account')}
            </button>
          )}
          <Link
            href={
              shoppingRequest
                ? '/account?returnTo=' +
                  encodeURIComponent(
                    base +
                      (id
                        ? '/' + id
                        : shoppingRequest.slug
                          ? '?' +
                            new URLSearchParams({
                              product: shoppingRequest.slug,
                              ...(shoppingRequest.variantId && {
                                variant: shoppingRequest.variantId,
                              }),
                            })
                          : ''),
                  )
                : '/account?returnTo=' + encodeURIComponent(base + (id ? '/' + id : ''))
            }
          >
            {text('ورود به حساب', 'Sign in')}
          </Link>
        </div>
      )}
    </div>
  );
}
