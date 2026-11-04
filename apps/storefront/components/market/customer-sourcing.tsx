'use client';
import { useEffect, useRef, useState } from 'react';
import { ClipboardList, RefreshCcw } from 'lucide-react';
import { useCustomerSession } from '../auth/auth-provider';
import { useI18n } from '../navigation/locale-provider';
import { useSourcingCommand } from './sourcing-provider';
import {
  FrozenSourcingNotice,
  SourcingError,
  SourcingModelView,
  SourcingSource,
  useSourcingText,
} from './sourcing';
import Link from '../navigation/localized-link';
import { Button } from '../shared/ui';
import { SourcingRecovery } from './sourcing-recovery';
import { CustomerSourcingOffers } from './customer-offers';
import { CustomerSourcingSupply } from './customer-supply';
import { CustomerSourcingOrderLinks } from './sourcing-order-links';
import { canCancelSourcingWithOffers } from '@/lib/market/offer-interaction';
import type { OfferPage } from '@sayman/web-shared/lib/market/offer-contract.ts';
import { CartError } from '@/lib/checkout/cart-client';
import {
  listSourcing,
  readSourcing,
  sourcingEvents,
  cancelSourcing,
  type SourcingRecoveryResult,
} from '@/lib/market/sourcing-client';
import {
  startSourcingJournal,
  finishSourcingJournal,
  markSourcingUncertain,
  failSourcingJournal,
} from '@/lib/market/sourcing-journal';
import type {
  SourcingDetail,
  SourcingRequestPage,
  SourcingEvents,
} from '@sayman/web-shared/lib/market/sourcing-contract.ts';
export function CustomerSourcing({ id }: { id?: string }) {
  const auth = useCustomerSession(),
    text = useSourcingText();
  if (auth.status === 'restoring')
    return (
      <div className="container empty-state page-empty" role="status">
        {text('در حال بررسی نشست…', 'Checking your session…')}
      </div>
    );
  if (auth.status === 'unavailable')
    return (
      <div className="container empty-state page-empty">
        <h1>{text('ارتباط با حساب برقرار نشد', 'Account connection unavailable')}</h1>
        <Button onClick={() => void auth.store.restore().catch(() => {})}>
          {text('بررسی دوبارهٔ نشست', 'Check session again')}
        </Button>
      </div>
    );
  if (auth.status !== 'member')
    return (
      <div className="container empty-state page-empty">
        <ClipboardList size={40} />
        <h1>{text('درخواست‌های تأمین شما', 'Your supply requests')}</h1>
        <p>
          {text(
            'برای مشاهده و پیگیری درخواست‌های خود وارد حساب شوید.',
            'Sign in to view and follow your own supply requests.',
          )}
        </p>
        <Link
          className="button button-primary"
          href={`/account?returnTo=/sourcing${id ? '/' + id : ''}`}
        >
          {text('ورود به حساب', 'Sign in')}
        </Link>
      </div>
    );
  return <SourcingRequests key={`${auth.session!.user.id}:${id ?? 'list'}`} id={id} />;
}
function SourcingRequests({ id }: { id?: string }) {
  const auth = useCustomerSession(),
    { locale, digits } = useI18n(),
    text = useSourcingText(),
    journal = useSourcingCommand();
  const [page, setPage] = useState<SourcingRequestPage | null>(null),
    [detail, setDetail] = useState<SourcingDetail | null>(null),
    [events, setEvents] = useState<SourcingEvents | null>(null),
    [error, setError] = useState(''),
    [eventError, setEventError] = useState(false),
    [busy, setBusy] = useState(false),
    [cancelBusy, setCancelBusy] = useState(false),
    [cancelConfirm, setCancelConfirm] = useState(false),
    [cancelError, setCancelError] = useState(''),
    [attempt, setAttempt] = useState(0),
    [cursor, setCursor] = useState<string | null>(null),
    [history, setHistory] = useState<(string | null)[]>([]),
    [eventCursor, setEventCursor] = useState<string | null>(null),
    [eventHistory, setEventHistory] = useState<(string | null)[]>([]);
  const [offerPage, setOfferPage] = useState<OfferPage | null>(null);
  const sending = useRef(false),
    mounted = useRef(true),
    detailRead = useRef<AbortController | null>(null),
    eventRead = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const canCancel = canCancelSourcingWithOffers(detail, offerPage);
  const owner = journal.owner,
    command =
      journal.pending?.command.kind === 'cancel' &&
      !journal.pending.result &&
      journal.pending.command.id === id
        ? journal.pending.command
        : null;
  const state = (value: string) =>
    ({
      Submitted: text('ثبت‌شده، در انتظار بررسی', 'Submitted; awaiting review'),
      Reviewing: text('در حال بررسی تأمین', 'Supply enquiry in review'),
      Unavailable: text('امکان تأمین اعلام نشده است', 'Supply unavailable'),
      Cancelled: text('لغوشده', 'Cancelled'),
    })[value] ?? text('وضعیت نامشخص', 'Unknown state');
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Tehran',
    }).format(new Date(value));
  useEffect(() => {
    const abort = new AbortController();
    detailRead.current = abort;
    setBusy(true);
    setError('');
    if (id)
      void readSourcing(auth.store.fetch, id, abort.signal)
        .then((value) => {
          if (!abort.signal.aborted) setDetail(value);
        })
        .catch((error) => {
          if (!abort.signal.aborted)
            setError(error instanceof CartError ? error.code : 'sourcing_unavailable');
        })
        .finally(() => {
          if (!abort.signal.aborted) setBusy(false);
        });
    else
      void listSourcing(auth.store.fetch, cursor, abort.signal)
        .then((value) => {
          if (!abort.signal.aborted) setPage(value);
        })
        .catch((error) => {
          if (!abort.signal.aborted)
            setError(error instanceof CartError ? error.code : 'sourcing_unavailable');
        })
        .finally(() => {
          if (!abort.signal.aborted) setBusy(false);
        });
    return () => abort.abort();
  }, [id, cursor, attempt, auth.store]);
  useEffect(() => {
    if (!id) return;
    const abort = new AbortController();
    eventRead.current = abort;
    setEventError(false);
    void sourcingEvents(auth.store.fetch, id, eventCursor, abort.signal)
      .then((value) => {
        if (!abort.signal.aborted) setEvents(value);
      })
      .catch(() => {
        if (!abort.signal.aborted) setEventError(true);
      });
    return () => abort.abort();
  }, [id, eventCursor, attempt, auth.store]);
  function recovered(value: SourcingRecoveryResult) {
    if (
      !mounted.current ||
      auth.store.snapshot().session?.user.id !== owner ||
      (id && value.receipt.id !== id)
    )
      return;
    setCancelConfirm(false);
    setCancelError('');
    if (!id) {
      setAttempt((value) => value + 1);
      return;
    }
    detailRead.current?.abort();
    eventRead.current?.abort();
    setBusy(false);
    setDetail(value.current?.detail ?? null);
    setEvents(value.current?.events ?? null);
    setEventCursor(null);
    setEventHistory([]);
    setError(value.refreshFailed ? 'sourcing_unavailable' : '');
    setEventError(value.refreshFailed);
    if (value.refreshFailed) setAttempt((value) => value + 1);
  }
  async function cancel() {
    if (!owner || !id || cancelBusy || sending.current) return;
    let frozen = command;
    if (frozen) markSourcingUncertain(owner, frozen.body.requestId);
    if (!frozen) {
      if (!detail || !canCancel || !cancelConfirm || (journal.pending && !journal.pending.result))
        return;
      frozen = {
        kind: 'cancel',
        id,
        body: { requestId: crypto.randomUUID(), version: detail.summary.version },
      };
      try {
        startSourcingJournal(owner, frozen);
      } catch {
        return;
      }
    }
    sending.current = true;
    setCancelBusy(true);
    setCancelError('');
    const original = frozen;
    try {
      const result = await cancelSourcing(auth.store.fetch, id, original.body);
      if (
        !finishSourcingJournal(owner, original.body.requestId, result) ||
        !mounted.current ||
        auth.store.snapshot().session?.user.id !== owner
      )
        return;
      setCancelConfirm(false);
      setAttempt((value) => value + 1);
    } catch (error) {
      const outcome = failSourcingJournal(
        owner,
        original.body.requestId,
        error instanceof CartError ? error.status : 0,
      );
      if (
        outcome === 'ignored' ||
        !mounted.current ||
        auth.store.snapshot().session?.user.id !== owner
      )
        return;
      if (outcome === 'rejected') {
        setCancelError(error instanceof CartError ? error.code : 'invalid_sourcing_input');
        setAttempt((value) => value + 1);
      } else setCancelError('unknown');
    } finally {
      sending.current = false;
      if (mounted.current) setCancelBusy(false);
    }
  }
  return (
    <div className="container sourcing-request-page">
      <div className="page-top">
        <div>
          <span className="eyebrow">
            {text('درخواست؛ بدون پرداخت و رزرو', 'Enquiry; no payment or reservation')}
          </span>
          <h1>
            {id
              ? (detail?.summary.reference ??
                text('جزئیات درخواست تأمین', 'Supply request details'))
              : text('درخواست‌های تأمین من', 'My supply requests')}
          </h1>
        </div>
        <Button
          variant="outline"
          disabled={busy || cancelBusy}
          onClick={() => setAttempt((value) => value + 1)}
        >
          <RefreshCcw size={16} />
          {text('بازخوانی وضعیت', 'Refresh state')}
        </Button>
      </div>
      <p className="notice">
        {text(
          'این درخواست‌ها سفارش فروش نیستند. قیمت، پیکربندی و امکان تأمین باید بررسی شوند؛ هیچ مبلغی قابل پرداخت نیست.',
          'These are not sales orders. Price, configuration and supply still require review; no amount is payable.',
        )}
      </p>
      <FrozenSourcingNotice />
      <SourcingRecovery viewedId={id} onRecovered={recovered} />
      {error && <SourcingError code={error} />}
      <div className="order-action-row">
        <Link href="/cart#sourcing" className="text-link">
          {text('انتخاب‌های تأمین در سبد', 'Supply selections in cart')}
        </Link>
        {id && (
          <Link href="/sourcing" className="text-link">
            {text('همهٔ درخواست‌ها', 'All requests')}
          </Link>
        )}
      </div>
      {busy && !page && !detail && <p role="status">{text('در حال دریافت…', 'Loading…')}</p>}
      {!id && page && (
        <>
          <div className="sourcing-request-list" aria-busy={busy}>
            {page.items.length ? (
              page.items.map((item) => (
                <Link href={`/sourcing/${item.id}`} key={item.id} className="sourcing-request-row">
                  <strong dir="ltr">{item.reference}</strong>
                  <span>
                    {state(item.state)}
                    {item.isDemo && <small> · {text('نمونه', 'Sample')}</small>}
                  </span>
                  <time dateTime={item.createdAt}>{date(item.createdAt)}</time>
                  <span>
                    {digits(item.itemCount)} {text('عدد', 'items')}
                  </span>
                </Link>
              ))
            ) : (
              <div className="empty-state">
                <h2>{text('هنوز درخواست تأمینی ثبت نکرده‌اید', 'No supply requests yet')}</h2>
                <Link href="/market" className="button button-outline">
                  {text('کشف مدل‌های بازار', 'Discover market models')}
                </Link>
              </div>
            )}
          </div>
          <nav
            className="catalog-pagination"
            aria-label={text('صفحه‌های درخواست', 'Request pages')}
          >
            {history.length > 0 && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setCursor(history[history.length - 1]);
                  setHistory((value) => value.slice(0, -1));
                }}
              >
                {text('صفحهٔ قبل', 'Previous page')}
              </Button>
            )}
            {page.nextCursor && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setHistory((value) => [...value, cursor]);
                  setCursor(page.nextCursor);
                }}
              >
                {text('درخواست‌های بعدی', 'Next requests')}
              </Button>
            )}
          </nav>
        </>
      )}
      {detail && (
        <div className="sourcing-detail-grid">
          <section className="card-panel">
            <h2>{text('مدل‌ها و مشخصات هنگام ثبت', 'Models and specifications at submission')}</h2>
            <p className="small-note">
              {text(
                'این مشخصات هنگام ثبت درخواست نگه‌داری شده‌اند؛ تغییر بعدی کاتالوگ آن‌ها را عوض نمی‌کند.',
                'These details were recorded when you submitted the request. Later catalogue edits do not change them.',
              )}
            </p>
            {detail.lines.map((line) => (
              <article className="sourcing-cart-line" key={line.listingId}>
                <SourcingModelView
                  model={line.model}
                  quantity={line.quantity}
                  configuration={line.configuration}
                />
                <SourcingSource source={line} historical />
              </article>
            ))}
            {detail.note && (
              <>
                <h2>{text('یادداشت شما', 'Your note')}</h2>
                <p className="preserve-lines">{detail.note}</p>
              </>
            )}
          </section>
          <section className="card-panel">
            <h2>{state(detail.summary.state)}</h2>
            <p className="small-note">
              {text('ثبت', 'Created')}:{' '}
              <time dateTime={detail.summary.createdAt}>{date(detail.summary.createdAt)}</time>
            </p>
            <p className="small-note">
              {text('آخرین تغییر', 'Last change')}:{' '}
              <time dateTime={detail.summary.changedAt}>{date(detail.summary.changedAt)}</time>
            </p>
            {(detail.canCancel || command) && (
              <div className="sourcing-cancel">
                {!cancelConfirm && !command ? (
                  <Button
                    variant="outline"
                    disabled={
                      cancelBusy ||
                      busy ||
                      !canCancel ||
                      (!!journal.pending && !journal.pending.result)
                    }
                    onClick={() => setCancelConfirm(true)}
                  >
                    {text('لغو درخواست تأمین', 'Cancel supply request')}
                  </Button>
                ) : (
                  <>
                    <p>
                      {text(
                        'لغو درخواست بررسی تأمین را تأیید می‌کنید؟',
                        'Confirm cancellation of this supply enquiry?',
                      )}
                    </p>
                    <div className="order-action-row">
                      <Button
                        disabled={cancelBusy || busy || (!command && !canCancel)}
                        onClick={() => void cancel()}
                      >
                        {cancelBusy
                          ? text('در حال ارسال…', 'Sending…')
                          : command
                            ? text('پیگیری و تلاش دوبارهٔ لغو', 'Check and retry cancellation')
                            : text('بله، لغو شود', 'Yes, cancel it')}
                      </Button>
                      {!command && (
                        <Button
                          variant="outline"
                          disabled={cancelBusy}
                          onClick={() => setCancelConfirm(false)}
                        >
                          {text('انصراف', 'Keep request')}
                        </Button>
                      )}
                    </div>
                  </>
                )}
                {cancelError &&
                  (cancelError === 'unknown' ? (
                    <p className="notice" role="alert">
                      {text(
                        'نتیجهٔ لغو دریافت نشد. با تلاش دوباره، همین درخواست لغو پیگیری می‌شود.',
                        'The cancellation result was not received. Retry follows the same cancellation request.',
                      )}
                    </p>
                  ) : (
                    <SourcingError code={cancelError} />
                  ))}
              </div>
            )}
            {detail.canCancel && !canCancel && !command && (
              <p className="small-note">
                {offerPage && !offerPage.canCancelRequest
                  ? text(
                      'با پذیرش فعال پیشنهاد، لغو سادهٔ درخواست در دسترس نیست؛ برای تغییر پیگیری تأمین با فروشگاه هماهنگ کنید.',
                      'An active accepted offer prevents simple request cancellation. Contact the store to change the supply follow-up.',
                    )
                  : text(
                      'امکان لغو پس از بررسی وضعیت تازهٔ پیشنهادها مشخص می‌شود.',
                      'Cancellation becomes available after current offer capabilities are checked.',
                    )}
              </p>
            )}
            <h2>{text('تاریخچهٔ درخواست', 'Request history')}</h2>
            {eventError ? (
              <p role="alert">
                {text(
                  'دریافت تاریخچه کامل نشد؛ وضعیت را بازخوانی کنید.',
                  'History could not be loaded. Refresh the state.',
                )}
              </p>
            ) : !events ? (
              <p role="status">{text('در حال دریافت تاریخچه…', 'Loading history…')}</p>
            ) : (
              <>
                <ol className="sourcing-history">
                  {events.items.map((event) => (
                    <li key={event.id}>
                      <strong>{state(event.stateAfter)}</strong>
                      <p>{event.publicMessage}</p>
                      <time dateTime={event.at}>{date(event.at)}</time>
                      <small>
                        {' '}
                        ·{' '}
                        {event.actorKind === 'staff'
                          ? text('فروشگاه', 'Store')
                          : event.actorKind === 'customer'
                            ? text('شما', 'You')
                            : text('سامانه', 'System')}
                      </small>
                    </li>
                  ))}
                </ol>
                <nav
                  className="catalog-pagination"
                  aria-label={text('صفحه‌های تاریخچه', 'History pages')}
                >
                  {eventHistory.length > 0 && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEventCursor(eventHistory[eventHistory.length - 1]);
                        setEventHistory((value) => value.slice(0, -1));
                      }}
                    >
                      {text('تاریخچهٔ قبلی', 'Previous history')}
                    </Button>
                  )}
                  {events.nextCursor && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEventHistory((value) => [...value, eventCursor]);
                        setEventCursor(events.nextCursor);
                      }}
                    >
                      {text('تاریخچهٔ بعدی', 'Next history')}
                    </Button>
                  )}
                </nav>
              </>
            )}
          </section>
        </div>
      )}
      {id && detail && (
        <CustomerSourcingOffers
          requestId={id}
          refreshToken={attempt}
          onCapabilities={setOfferPage}
          onChanged={() => {
            setCancelConfirm(false);
            setAttempt((value) => value + 1);
          }}
        />
      )}
      {id && detail && <CustomerSourcingSupply requestId={id} refreshToken={attempt} />}
      {id && detail && <CustomerSourcingOrderLinks requestId={id} refreshToken={attempt} />}
    </div>
  );
}
