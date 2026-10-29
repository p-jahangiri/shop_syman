'use client';
import { useCallback, useEffect, useRef, useState, useMemo, type FormEvent } from 'react';
import { RefreshCcw, FileCheck2 } from 'lucide-react';
import { useCustomerSession } from './auth-provider';
import { useI18n } from './locale-provider';
import { useSourcingCommand } from './sourcing-provider';
import { useSourcingText } from './sourcing';
import { Button } from './ui';
import Image from './content-image';
import { CartError } from '@/lib/cart-client';
import {
  decideSourcingOffer,
  listSourcingOffers,
  readSourcingOffer,
  readSourcingOfferView,
  recoverSourcingOfferView,
  sourcingOfferEvents,
  type OfferRecoveryResult,
} from '@/lib/offer-client';
import {
  offerCommandIdSchema,
  offerIdSchema,
  sourcingAttributeText,
  type OfferDetail,
  type OfferEvents,
  type OfferPage,
} from '@/lib/offer-contract';
import {
  offerCommandMatchesJournal,
  offerRecoveryMayApply,
  offerReviewIsCurrent,
  reviewSourcingOffer,
  sameOfferView,
  type OfferReview,
} from '@/lib/offer-interaction';
import {
  failSourcingJournal,
  finishSourcingJournal,
  isSourcingOfferCommand,
  markSourcingUncertain,
  readSourcingJournal,
  startSourcingJournal,
  type SourcingOfferCommand,
} from '@/lib/sourcing-journal';
import { bindRealtimeTransport } from '@/lib/private-realtime-client';
import { usePrivateRealtime, useRealtimeRefresh, PrivateRealtimeStatus } from './private-realtime';
import './customer-offers.css';

function useOfferFormatting() {
  const { locale, digits } = useI18n(),
    text = useSourcingText();
  return {
    locale,
    digits,
    text,
    date: (value: string) =>
      new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Tehran',
      }).format(new Date(value)),
    rial: (value: string) =>
      new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US').format(BigInt(value)) +
      ' ' +
      text('ریال', 'rial'),
    state: (value: string) =>
      ({
        Draft: text('پیش‌نویس', 'Draft'),
        Published: text('منتظر پاسخ شما', 'Awaiting your response'),
        Accepted: text('پذیرفته‌شده برای پیگیری تأمین', 'Accepted for supply follow-up'),
        Declined: text('ردشده توسط شما', 'Declined by you'),
        Withdrawn: text('برداشته‌شده توسط فروشگاه', 'Withdrawn by the store'),
        Superseded: text('جایگزین‌شده با پیشنهاد دیگر', 'Superseded'),
        Expired: text('مهلت پایان‌یافته', 'Expired'),
      })[value] ?? text('وضعیت نامشخص', 'Unknown state'),
  };
}
function OfferError({ code }: { code: string }) {
  const text = useSourcingText();
  const message =
    code === 'unknown'
      ? text(
          'نتیجهٔ قطعی دریافت نشد. شناسه و متن همان فرمان حفظ شده‌اند؛ نتیجه را پیگیری کنید یا همان فرمان را دوباره بفرستید.',
          'No final result was received. The same command and tracking ID are preserved. Look up its result or retry that exact command.',
        )
      : code.includes('expired')
        ? text(
            'مهلت این پیشنهاد پایان یافته است؛ پیشنهاد تازه را از فروشگاه پیگیری کنید.',
            'This offer has expired. Follow up with the store for a new offer.',
          )
        : code.includes('catalog') || code.includes('terms')
          ? text(
              'مشخصات یا شرایط تغییر کرده‌اند؛ وضعیت تازه را بخوانید. پذیرش نسخهٔ قدیمی انجام نشد.',
              'The specifications or terms changed. Read the refreshed state; the previous version was not accepted.',
            )
          : code.includes('conflict') || code === 'version_conflict'
            ? text(
                'پیشنهاد یا درخواست تغییر کرده است؛ وضعیت تازه را بررسی و شرایط را دوباره بخوانید.',
                'The offer or request changed. Check the refreshed state and review its terms again.',
              )
            : text(
                'دریافت یا ثبت پیشنهاد تکمیل نشد. ورود به حساب و وضعیت تازه را بررسی کنید.',
                'The offer could not be read or updated. Check your sign-in and refresh its state.',
              );
  return (
    <p className="notice" role="alert">
      {message}
    </p>
  );
}

export function CustomerSourcingOffers({
  requestId,
  refreshToken,
  onCapabilities,
  onChanged,
}: {
  requestId: string;
  refreshToken: number;
  onCapabilities: (page: OfferPage | null) => void;
  onChanged: () => void;
}) {
  const auth = useCustomerSession(),
    journal = useSourcingCommand(),
    { locale, text, date, rial, state, digits } = useOfferFormatting(),
    owner = journal.owner;
  const liveTransport = useMemo(
    () =>
      bindRealtimeTransport(
        (path, init) => auth.store.fetch(path, init),
        () =>
          !!owner &&
          auth.store.snapshot().status === 'member' &&
          auth.store.snapshot().session?.user.id === owner,
      ),
    [auth.store, owner],
  );
  const liveUpdates = usePrivateRealtime(owner, '/api/realtime', liveTransport);
  const ownCommand =
    journal.pending &&
    isSourcingOfferCommand(journal.pending.command) &&
    journal.pending.command.id === requestId
      ? journal.pending.command
      : null;
  const [page, setPage] = useState<OfferPage | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [cursor, setCursor] = useState<string | null>(null),
    [history, setHistory] = useState<(string | null)[]>([]),
    [selected, setSelected] = useState<string | null>(ownCommand?.offerId ?? null),
    [attempt, setAttempt] = useState(0),
    [recovered, setRecovered] = useState<OfferRecoveryResult | null>(null);
  const mounted = useRef(true),
    epoch = useRef(0),
    callbacks = useRef({ onCapabilities, onChanged });
  callbacks.current = { onCapabilities, onChanged };
  const live = useCallback(
    () => mounted.current && !!owner && auth.store.snapshot().session?.user.id === owner,
    [auth.store, owner],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      callbacks.current.onCapabilities(null);
    };
  }, []);
  useEffect(() => {
    if (ownCommand) setSelected(ownCommand.offerId);
  }, [ownCommand]);
  useEffect(() => {
    const abort = new AbortController(),
      ticket = ++epoch.current;
    setLoading(true);
    setError('');
    callbacks.current.onCapabilities(null);
    void listSourcingOffers(auth.store.fetch, requestId, cursor, abort.signal)
      .then((value) => {
        if (!abort.signal.aborted && live() && ticket === epoch.current) {
          setPage(value);
          callbacks.current.onCapabilities(value);
        }
      })
      .catch((error) => {
        if (!abort.signal.aborted && live() && ticket === epoch.current) {
          setError(error instanceof CartError ? error.code : 'sourcing_offer_unavailable');
          callbacks.current.onCapabilities(null);
        }
      })
      .finally(() => {
        if (!abort.signal.aborted && live() && ticket === epoch.current) setLoading(false);
      });
    return () => abort.abort();
  }, [requestId, cursor, attempt, refreshToken, auth.store, live, owner]);
  useRealtimeRefresh(
    liveUpdates,
    'notifications',
    () => {
      setRecovered(null);
      setAttempt((value) => value + 1);
    },
    loading || (!!journal.pending && !journal.pending.result),
  );
  function refresh() {
    setRecovered(null);
    setAttempt((value) => value + 1);
  }
  function changed(current?: Awaited<ReturnType<typeof readSourcingOfferView>>) {
    if (!live()) return;
    if (current) {
      setPage(current.page);
      callbacks.current.onCapabilities(current.page);
    } else callbacks.current.onCapabilities(null);
    setCursor(null);
    setHistory([]);
    setAttempt((value) => value + 1);
    callbacks.current.onChanged();
  }
  function found(value: OfferRecoveryResult) {
    if (!live() || value.receipt.requestId !== requestId) return;
    setSelected(value.receipt.offerId);
    setRecovered(value);
    changed(value.current ?? undefined);
  }
  return (
    <section
      id="offers"
      className="customer-offers card-panel"
      aria-labelledby="sourcing-offers-heading"
    >
      <div className="sourcing-heading">
        <div>
          <span className="eyebrow">{text('پیشنهاد اختصاصی فروشگاه', 'Your store offers')}</span>
          <h2 id="sourcing-offers-heading">
            <FileCheck2 size={21} />
            {text('بررسی قیمت و شرایط تأمین', 'Review supply prices and terms')}
          </h2>
        </div>
        <Button variant="outline" disabled={loading} onClick={refresh}>
          <RefreshCcw size={15} />
          {text('بازخوانی پیشنهادها', 'Refresh offers')}
        </Button>
      </div>
      <p className="notice">
        {text(
          'پذیرش این پیشنهاد فقط رضایت برای پیگیری تأمین است. هیچ سفارش فروش، پرداخت یا رزرو کالا ایجاد نمی‌شود. مبلغ‌ها جمع اقلام پیشنهادند و صورتحساب قابل پرداخت نیستند.',
          'Accepting an offer only records your consent to supply follow-up. It creates no sales order, payment or stock reservation. Amounts cover the proposed items and are not a payable invoice.',
        )}
      </p>
      <PrivateRealtimeStatus client={liveUpdates} locale={locale} />
      <OfferReceiptRecovery requestId={requestId} selectedOfferId={selected} onRecovered={found} />
      {error && <OfferError code={error} />}{' '}
      {loading && !page && (
        <p role="status">{text('در حال دریافت پیشنهادها…', 'Loading offers…')}</p>
      )}
      {page && (
        <>
          <div className="customer-offer-list" aria-busy={loading}>
            {page.items.length ? (
              page.items.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={
                    selected === item.id ? 'customer-offer-row selected' : 'customer-offer-row'
                  }
                  onClick={() => {
                    setRecovered(null);
                    setSelected(item.id);
                  }}
                  aria-pressed={selected === item.id}
                >
                  <span>
                    <strong>
                      {text('پیشنهاد', 'Offer')} {digits(item.revision)}
                    </strong>
                    <small>
                      {state(item.effectiveState)}
                      {item.isDemo && ' · ' + text('نمونهٔ توسعه', 'Development sample')}
                    </small>
                  </span>
                  <bdi>{rial(item.totalRial)}</bdi>
                  <span>
                    <small>{text('مهلت پاسخ', 'Respond by')}</small>
                    <time dateTime={item.acceptUntil}>{date(item.acceptUntil)}</time>
                  </span>
                </button>
              ))
            ) : (
              <p className="small-note">
                {text(
                  'هنوز پیشنهاد منتشرشده‌ای برای این درخواست وجود ندارد. پس از بررسی فروشگاه، قیمت و شرایط دقیق اینجا نمایش داده می‌شود.',
                  'No offer has been published for this request yet. The store’s reviewed price and exact terms will appear here.',
                )}
              </p>
            )}
          </div>
          <nav className="catalog-pagination" aria-label={text('صفحه‌های پیشنهاد', 'Offer pages')}>
            {history.length > 0 && (
              <Button
                variant="outline"
                disabled={loading}
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
                disabled={loading}
                onClick={() => {
                  setHistory((value) => [...value, cursor]);
                  setCursor(page.nextCursor);
                }}
              >
                {text('پیشنهادهای بعدی', 'Next offers')}
              </Button>
            )}
          </nav>
        </>
      )}
      {selected && (
        <CustomerOfferView
          key={`${owner}:${requestId}:${selected}`}
          requestId={requestId}
          offerId={selected}
          capabilityVersion={!loading && !error ? (page?.requestVersion ?? null) : null}
          refreshToken={refreshToken + attempt}
          recovered={recovered?.receipt.offerId === selected ? recovered : null}
          onChanged={changed}
        />
      )}
    </section>
  );
}

function OfferReceiptRecovery({
  requestId,
  selectedOfferId,
  onRecovered,
}: {
  requestId: string;
  selectedOfferId: string | null;
  onRecovered: (value: OfferRecoveryResult) => void;
}) {
  const auth = useCustomerSession(),
    journal = useSourcingCommand(),
    text = useSourcingText(),
    owner = journal.owner;
  const pending =
    journal.pending &&
    isSourcingOfferCommand(journal.pending.command) &&
    journal.pending.command.id === requestId &&
    !journal.pending.result
      ? journal.pending.command
      : null;
  const [operation, setOperation] = useState<'accept' | 'decline'>(pending?.kind ?? 'accept'),
    [offerId, setOfferId] = useState(pending?.offerId ?? selectedOfferId ?? ''),
    [commandId, setCommandId] = useState(pending?.body.requestId ?? ''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [result, setResult] = useState(false);
  const flight = useRef<AbortController | null>(null),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      flight.current?.abort();
    };
  }, []);
  useEffect(() => {
    flight.current?.abort();
    flight.current = null;
    setBusy(false);
    if (pending) {
      setOperation(pending.kind);
      setOfferId(pending.offerId);
      setCommandId(pending.body.requestId);
    } else if (selectedOfferId) setOfferId(selectedOfferId);
    setError('');
    setResult(false);
  }, [pending, selectedOfferId]);
  const valid =
    offerIdSchema.safeParse(offerId).success && offerCommandIdSchema.safeParse(commandId).success;
  async function lookup(event: FormEvent) {
    event.preventDefault();
    if (!owner || flight.current || !valid) return;
    if (
      !offerRecoveryMayApply(readSourcingJournal(owner), requestId, offerId, operation, commandId)
    ) {
      setError('mismatch');
      return;
    }
    const abort = new AbortController();
    flight.current = abort;
    setBusy(true);
    setError('');
    setResult(false);
    const target = offerId,
      kind = operation,
      id = commandId;
    try {
      const value = await recoverSourcingOfferView(
        auth.store.fetch,
        requestId,
        target,
        kind,
        id,
        abort.signal,
      );
      if (
        abort.signal.aborted ||
        !mounted.current ||
        auth.store.snapshot().session?.user.id !== owner
      )
        return;
      const current = readSourcingJournal(owner);
      if (!offerRecoveryMayApply(current, requestId, target, kind, id)) {
        setError('mismatch');
        return;
      }
      if (
        current &&
        !current.result &&
        offerCommandMatchesJournal(current, requestId, target, kind, id)
      )
        finishSourcingJournal(owner, current.command.body.requestId, value.receipt);
      setResult(true);
      onRecovered(value);
    } catch (error) {
      if (
        !abort.signal.aborted &&
        mounted.current &&
        auth.store.snapshot().session?.user.id === owner
      )
        setError(error instanceof CartError && error.status === 404 ? 'missing' : 'unavailable');
    } finally {
      if (flight.current === abort) {
        flight.current = null;
        if (!abort.signal.aborted && mounted.current) setBusy(false);
      }
    }
  }
  return (
    <details className="sourcing-recovery offer-recovery">
      <summary>
        {text('پیگیری نتیجهٔ پذیرش یا رد پیشنهاد', 'Track an acceptance or decline')}
      </summary>
      <p className="small-note">
        {text(
          'اگر پاسخ فرمان قطع شده یا صفحه را دوباره باز کرده‌اید، شناسهٔ همان پیشنهاد و فرمان را وارد کنید. این جست‌وجو فقط رسید حساب خودتان را می‌خواند.',
          'If a response was interrupted or you reopened the page, enter the same offer and command IDs. This lookup only reads your own command receipt.',
        )}
      </p>
      <form onSubmit={lookup}>
        <div className="field">
          <label htmlFor={`offer-recovery-kind-${requestId}`}>{text('نوع فرمان', 'Command')}</label>
          <select
            id={`offer-recovery-kind-${requestId}`}
            value={operation}
            disabled={busy}
            onChange={(event) => {
              setOperation(event.target.value as 'accept' | 'decline');
              setResult(false);
            }}
          >
            <option value="accept">{text('پذیرش پیشنهاد', 'Accept offer')}</option>
            <option value="decline">{text('رد پیشنهاد', 'Decline offer')}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor={`offer-recovery-offer-${requestId}`}>
            {text('شناسهٔ پیشنهاد', 'Offer ID')}
          </label>
          <input
            id={`offer-recovery-offer-${requestId}`}
            dir="ltr"
            maxLength={32}
            value={offerId}
            disabled={busy}
            onChange={(event) => {
              setOfferId(event.target.value.trim().toLowerCase());
              setResult(false);
            }}
            required
          />
        </div>
        <div className="field">
          <label htmlFor={`offer-recovery-command-${requestId}`}>
            {text('شناسهٔ پیگیری فرمان', 'Command tracking ID')}
          </label>
          <input
            id={`offer-recovery-command-${requestId}`}
            dir="ltr"
            maxLength={36}
            value={commandId}
            disabled={busy}
            onChange={(event) => {
              setCommandId(event.target.value.trim().toLowerCase());
              setResult(false);
            }}
            required
          />
        </div>
        <Button variant="outline" type="submit" disabled={busy || !valid}>
          {busy ? text('در حال پیگیری…', 'Looking up…') : text('بررسی رسید', 'Check receipt')}
        </Button>
      </form>
      {error && (
        <p className="notice" role="alert">
          {error === 'mismatch'
            ? text(
                'فرمان دیگری هنوز نتیجهٔ قطعی ندارد. شناسه‌های همان فرمان در انتظار را پیگیری کنید؛ نتیجهٔ فرمان دیگر جایگزین این صفحه نمی‌شود.',
                'Another command is unresolved. Follow that pending command’s IDs; a different receipt cannot replace this view.',
              )
            : error === 'missing'
              ? text(
                  'رسید هنوز پیدا نشد؛ ممکن است فرمان قبلی همچنان در حال اجرا باشد. با همان شناسه دوباره پیگیری کنید.',
                  'No receipt was found yet; the earlier command may still be processing. Check again with the same tracking ID.',
                )
              : text(
                  'خواندن رسید تکمیل نشد؛ ورود به حساب و شناسه‌ها را بررسی کنید.',
                  'The receipt could not be read. Check your sign-in and both IDs.',
                )}
        </p>
      )}
      {result && (
        <p role="status">
          {text(
            'رسید پیدا شد. وضعیت فعلی پیشنهاد جداگانه از سرور خوانده شد؛ اگر دریافت آن کامل نشد، وضعیت را بازخوانی کنید.',
            'Receipt found. The current offer was read separately from the server. Refresh its state if that read could not finish.',
          )}
        </p>
      )}
    </details>
  );
}

function CustomerOfferView({
  requestId,
  offerId,
  capabilityVersion,
  refreshToken,
  recovered,
  onChanged,
}: {
  requestId: string;
  offerId: string;
  capabilityVersion: string | null;
  refreshToken: number;
  recovered: OfferRecoveryResult | null;
  onChanged: (current?: Awaited<ReturnType<typeof readSourcingOfferView>>) => void;
}) {
  const auth = useCustomerSession(),
    journal = useSourcingCommand(),
    { locale, text, date, rial, digits, state } = useOfferFormatting(),
    owner = journal.owner;
  const pending =
    journal.pending &&
    !journal.pending.result &&
    isSourcingOfferCommand(journal.pending.command) &&
    journal.pending.command.id === requestId &&
    journal.pending.command.offerId === offerId
      ? journal.pending.command
      : null;
  const [detail, setDetail] = useState<OfferDetail | null>(null),
    [events, setEvents] = useState<OfferEvents | null>(null),
    [error, setError] = useState(''),
    [eventError, setEventError] = useState(false),
    [eventLoading, setEventLoading] = useState(false),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [commandError, setCommandError] = useState(''),
    [review, setReview] = useState<OfferReview | null>(null),
    [ack, setAck] = useState(false),
    [cursor, setCursor] = useState<string | null>(null),
    [history, setHistory] = useState<(string | null)[]>([]),
    [attempt, setAttempt] = useState(0),
    [now, setNow] = useState(Date.now);
  const mounted = useRef(true),
    mutex = useRef(false),
    read = useRef<AbortController | null>(null),
    eventRead = useRef<AbortController | null>(null),
    readEpoch = useRef(0),
    eventEpoch = useRef(0),
    change = useRef(onChanged);
  change.current = onChanged;
  const live = useCallback(
    () => mounted.current && !!owner && auth.store.snapshot().session?.user.id === owner,
    [auth.store, owner],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      read.current?.abort();
      eventRead.current?.abort();
    };
  }, []);
  useEffect(() => {
    const tick = () => setNow(Date.now()),
      timer = setInterval(tick, 15000);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  useEffect(() => {
    const abort = new AbortController(),
      ticket = ++readEpoch.current;
    read.current = abort;
    setLoading(true);
    setError('');
    setReview(null);
    setAck(false);
    void readSourcingOffer(auth.store.fetch, requestId, offerId, abort.signal)
      .then((value) => {
        if (
          !abort.signal.aborted &&
          live() &&
          ticket === readEpoch.current &&
          sameOfferView(owner, auth.store.snapshot().session?.user.id, requestId, offerId, value)
        )
          setDetail(value);
      })
      .catch((error) => {
        if (!abort.signal.aborted && live() && ticket === readEpoch.current) {
          setDetail(null);
          setError(error instanceof CartError ? error.code : 'sourcing_offer_unavailable');
        }
      })
      .finally(() => {
        if (!abort.signal.aborted && live() && ticket === readEpoch.current) setLoading(false);
      });
    return () => abort.abort();
  }, [requestId, offerId, attempt, refreshToken, auth.store, live, owner]);
  useEffect(() => {
    const abort = new AbortController(),
      ticket = ++eventEpoch.current;
    eventRead.current = abort;
    setEventError(false);
    setEventLoading(true);
    void sourcingOfferEvents(auth.store.fetch, requestId, offerId, cursor, abort.signal)
      .then((value) => {
        if (!abort.signal.aborted && live() && ticket === eventEpoch.current) setEvents(value);
      })
      .catch(() => {
        if (!abort.signal.aborted && live() && ticket === eventEpoch.current) setEventError(true);
      })
      .finally(() => {
        if (!abort.signal.aborted && live() && ticket === eventEpoch.current)
          setEventLoading(false);
      });
    return () => abort.abort();
  }, [requestId, offerId, cursor, attempt, refreshToken, auth.store, live, owner]);
  useEffect(() => {
    if (
      !recovered ||
      recovered.receipt.requestId !== requestId ||
      recovered.receipt.offerId !== offerId ||
      !live()
    )
      return;
    read.current?.abort();
    eventRead.current?.abort();
    readEpoch.current++;
    eventEpoch.current++;
    setReview(null);
    setAck(false);
    setCommandError('');
    setLoading(false);
    setEventLoading(false);
    setCursor(null);
    setHistory([]);
    setDetail(recovered.current?.detail ?? null);
    setEvents(recovered.current?.events ?? null);
    setError(recovered.refreshFailed ? 'sourcing_offer_unavailable' : '');
    setEventError(recovered.refreshFailed);
  }, [recovered, live, requestId, offerId]);
  async function send(kind: 'accept' | 'decline') {
    if (!owner || mutex.current) return;
    let command: SourcingOfferCommand;
    if (pending) {
      if (pending.kind !== kind) return;
      command = pending;
      markSourcingUncertain(owner, command.body.requestId);
    } else {
      if (
        !detail ||
        capabilityVersion !== detail.requestVersion ||
        !ack ||
        review?.operation !== kind ||
        !offerReviewIsCurrent(review, detail, Date.now()) ||
        (journal.pending && !journal.pending.result)
      )
        return;
      command = {
        kind,
        id: requestId,
        offerId,
        reference: detail.requestReference,
        body: {
          requestId: crypto.randomUUID(),
          requestVersion: review.requestVersion,
          version: review.version,
          termsHash: review.termsHash,
        },
      };
      try {
        startSourcingJournal(owner, command);
      } catch {
        return;
      }
    }
    mutex.current = true;
    setBusy(true);
    setCommandError('');
    let mutationReadEpoch: number | null = null;
    try {
      const result = await decideSourcingOffer(
        auth.store.fetch,
        requestId,
        offerId,
        kind,
        command.body,
      );
      if (
        !live() ||
        !offerCommandMatchesJournal(
          readSourcingJournal(owner),
          requestId,
          offerId,
          kind,
          command.body.requestId,
        )
      )
        return;
      setReview(null);
      setAck(false);
      read.current?.abort();
      eventRead.current?.abort();
      readEpoch.current++;
      eventEpoch.current++;
      setDetail(null);
      setEvents(null);
      setLoading(true);
      const refreshTicket = readEpoch.current;
      mutationReadEpoch = refreshTicket;
      try {
        const current = await readSourcingOfferView(auth.store.fetch, requestId, offerId);
        if (
          !live() ||
          !offerCommandMatchesJournal(
            readSourcingJournal(owner),
            requestId,
            offerId,
            kind,
            command.body.requestId,
          )
        )
          return;
        if (refreshTicket !== readEpoch.current) {
          finishSourcingJournal(owner, command.body.requestId, result);
          return;
        }
        setDetail(current.detail);
        setEvents(current.events);
        setCursor(null);
        setHistory([]);
        setError('');
        setEventError(false);
        setEventLoading(false);
        change.current(current);
      } catch {
        if (
          live() &&
          offerCommandMatchesJournal(
            readSourcingJournal(owner),
            requestId,
            offerId,
            kind,
            command.body.requestId,
          ) &&
          refreshTicket === readEpoch.current
        ) {
          setError('sourcing_offer_unavailable');
          setEventError(true);
          setEventLoading(false);
          change.current();
        }
      }
      if (
        live() &&
        offerCommandMatchesJournal(
          readSourcingJournal(owner),
          requestId,
          offerId,
          kind,
          command.body.requestId,
        )
      )
        finishSourcingJournal(owner, command.body.requestId, result);
    } catch (error) {
      if (!live()) return;
      const outcome = failSourcingJournal(
        owner,
        command.body.requestId,
        error instanceof CartError ? error.status : 0,
      );
      if (outcome === 'ignored') return;
      setCommandError(
        outcome === 'unknown'
          ? 'unknown'
          : error instanceof CartError
            ? error.code
            : 'invalid_sourcing_offer',
      );
      if (outcome === 'rejected') {
        setReview(null);
        setAck(false);
        setAttempt((value) => value + 1);
        change.current();
      }
    } finally {
      mutex.current = false;
      if (live()) {
        setBusy(false);
        if (mutationReadEpoch !== null && mutationReadEpoch === readEpoch.current)
          setLoading(false);
      }
    }
  }
  const blocked =
      busy ||
      loading ||
      !detail ||
      capabilityVersion !== detail.requestVersion ||
      (!!journal.pending && !journal.pending.result),
    expired =
      detail?.offer.summary.effectiveState === 'Expired' ||
      (!!detail &&
        detail.offer.summary.state === 'Published' &&
        Date.parse(detail.offer.summary.acceptUntil) <= now);
  return (
    <article id={`offer-${offerId}`} className="customer-offer-detail" aria-busy={loading || busy}>
      <div className="sourcing-heading">
        <h3>{text('جزئیات پیشنهاد انتخاب‌شده', 'Selected offer details')}</h3>
        <button
          className="text-link"
          type="button"
          disabled={busy || loading}
          onClick={() => {
            setCommandError('');
            setAttempt((value) => value + 1);
            change.current();
          }}
        >
          {text('دریافت وضعیت تازه', 'Get current state')}
        </button>
      </div>
      <p className="small-note">
        {text('شناسهٔ پیشنهاد', 'Offer ID')}: <code dir="ltr">{offerId}</code>
      </p>
      {error && <OfferError code={error} />}{' '}
      {loading && !detail && (
        <p role="status">{text('در حال دریافت جزئیات…', 'Loading details…')}</p>
      )}
      {detail && (
        <>
          <div className="offer-status">
            <strong>{state(expired ? 'Expired' : detail.offer.summary.effectiveState)}</strong>
            <small>
              {text('نسخهٔ پیشنهاد', 'Offer revision')}: {digits(detail.offer.summary.revision)}
              {detail.offer.summary.isDemo &&
                ' · ' + text('دادهٔ نمونهٔ توسعه', 'Development sample data')}
            </small>
          </div>
          <dl className="offer-deadlines">
            <div>
              <dt>{text('مهلت پاسخ شما', 'Respond by')}</dt>
              <dd>
                <time dateTime={detail.offer.summary.acceptUntil}>
                  {date(detail.offer.summary.acceptUntil)}
                </time>
              </dd>
            </div>
            <div>
              <dt>
                {text('اعتبار قیمت و شرایط پذیرفته‌شده تا', 'Accepted price and terms valid until')}
              </dt>
              <dd>
                <time dateTime={detail.offer.summary.purchaseUntil}>
                  {date(detail.offer.summary.purchaseUntil)}
                </time>
              </dd>
            </div>
            <div>
              <dt>{text('زمان احتمالی تأمین اعلام‌شده', 'Estimated supply date')}</dt>
              <dd>
                {detail.offer.summary.expectedAt ? (
                  <time dateTime={detail.offer.summary.expectedAt}>
                    {date(detail.offer.summary.expectedAt)}
                  </time>
                ) : (
                  text('اعلام نشده', 'Not provided')
                )}
              </dd>
            </div>
          </dl>
          {detail.offer.lines.map((line) => (
            <OfferLine key={line.lineId} line={line} />
          ))}
          <div className="offer-total">
            <span>{text('جمع مبلغ اقلام پیشنهاد', 'Proposed item total')}</span>
            <strong dir="auto">{rial(detail.offer.summary.totalRial)}</strong>
          </div>
          <p className="small-note">
            {text(
              'این مبلغ قابل پرداخت نیست. هزینهٔ ارسال و مالیات در این مرحله محاسبه نشده‌اند؛ پذیرش، موجودی یا دریافت کالا را تضمین نمی‌کند.',
              'This amount is not payable. Shipping and tax are not calculated at this stage. Acceptance does not guarantee stock or receipt of goods.',
            )}
          </p>
          <section className="offer-terms">
            <h4>{text('شرایط همین نسخهٔ پیشنهاد', 'Terms for this offer version')}</h4>
            <p className="preserve-lines">
              {locale === 'fa' ? detail.offer.termsFa : detail.offer.termsEn}
            </p>
          </section>
          {detail.offer.summary.acceptedAt && (
            <p role="status" className="notice">
              {text(
                'پذیرش شما برای پیگیری تأمین ثبت شده است. هنوز سفارش فروش، رزرو و پرداختی ایجاد نشده است.',
                'Your consent to supply follow-up was recorded. No sales order, reservation or payment has been created.',
              )}{' '}
              <time dateTime={detail.offer.summary.acceptedAt}>
                {date(detail.offer.summary.acceptedAt)}
              </time>
            </p>
          )}
          {detail.blockers.length > 0 && (
            <div className="offer-blockers">
              {detail.blockers.map((code) => (
                <OfferError key={code} code={code} />
              ))}
            </div>
          )}
          {!pending && (detail.canAccept || detail.canDecline) && !review && (
            <div className="order-action-row">
              <Button
                disabled={blocked || expired || !detail.canAccept}
                onClick={() => {
                  setReview(reviewSourcingOffer(detail, 'accept'));
                  setAck(false);
                  setCommandError('');
                }}
              >
                {text('بررسی و پذیرش شرایط', 'Review and accept terms')}
              </Button>
              <Button
                variant="outline"
                disabled={blocked || expired || !detail.canDecline}
                onClick={() => {
                  setReview(reviewSourcingOffer(detail, 'decline'));
                  setAck(false);
                  setCommandError('');
                }}
              >
                {text('رد این پیشنهاد', 'Decline this offer')}
              </Button>
            </div>
          )}
          {review && !pending && (
            <form
              className="offer-consent"
              onSubmit={(event) => {
                event.preventDefault();
                void send(review.operation);
              }}
            >
              <h4>
                {review.operation === 'accept'
                  ? text('تأیید پذیرش همین نسخه', 'Confirm acceptance of this version')
                  : text('تأیید رد همین پیشنهاد', 'Confirm declining this offer')}
              </h4>
              <p>
                {review.operation === 'accept'
                  ? text(
                      'مشخصات SKU، گارانتی، قیمت اقلام، شرایط و مهلت‌های بالا را بررسی کنید. پذیرش فقط اجازهٔ پیگیری تأمین است و خرید قطعی نیست.',
                      'Review the SKU specifications, warranty, item prices, terms and deadlines above. Acceptance only permits supply follow-up and is not a confirmed purchase.',
                    )
                  : text(
                      'با رد این پیشنهاد، پذیرش آن ثبت نمی‌شود. درخواست اصلی شما برای پیگیری باقی می‌ماند و می‌توانید دربارهٔ پیشنهاد تازه با فروشگاه هماهنگ کنید.',
                      'Declining does not record acceptance. Your original request remains available for follow-up and you can discuss a new offer with the store.',
                    )}
              </p>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={ack}
                  disabled={blocked}
                  onChange={(event) => setAck(event.target.checked)}
                />
                <span>
                  {review.operation === 'accept'
                    ? text(
                        'شرایط همین نسخه را خواندم و برای پیگیری تأمین می‌پذیرم؛ می‌دانم پرداخت، خرید یا رزرو ایجاد نمی‌شود.',
                        'I reviewed this version and accept its terms for supply follow-up. I understand that no payment, purchase or reservation is created.',
                      )
                    : text('رد همین پیشنهاد را تأیید می‌کنم.', 'I confirm declining this offer.')}
                </span>
              </label>
              <div className="order-action-row">
                <Button
                  type="submit"
                  disabled={blocked || !ack || !offerReviewIsCurrent(review, detail, now)}
                >
                  {review.operation === 'accept'
                    ? text('ثبت رضایت برای پیگیری تأمین', 'Record consent to supply follow-up')
                    : text('بله، پیشنهاد رد شود', 'Yes, decline this offer')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setReview(null);
                    setAck(false);
                  }}
                >
                  {text('بازگشت به بررسی', 'Back to review')}
                </Button>
              </div>
            </form>
          )}
        </>
      )}
      {pending && (
        <div className="notice offer-pending" role="status">
          <strong>
            {text('فرمان قبلی هنوز نتیجهٔ قطعی ندارد', 'The previous command is unresolved')}
          </strong>
          <p>
            {pending.kind === 'accept'
              ? text(
                  'پذیرش همین نسخه در انتظار نتیجه است.',
                  'Acceptance of this version is awaiting its result.',
                )
              : text(
                  'رد همین پیشنهاد در انتظار نتیجه است.',
                  'Declining this offer is awaiting its result.',
                )}
          </p>
          <p>
            {text('شناسهٔ فرمان', 'Command tracking ID')}:{' '}
            <code dir="ltr">{pending.body.requestId}</code>
          </p>
          <p>
            {text(
              'تا روشن‌شدن نتیجه، فرمان تازه یا لغو درخواست ثبت نمی‌شود. تلاش دوباره همان شناسه و شرایط اولیه را می‌فرستد.',
              'Until its result is known, no new command or request cancellation can be submitted. Retry sends the original tracking ID and exact terms.',
            )}
          </p>
          <Button disabled={busy} onClick={() => void send(pending.kind)}>
            {busy
              ? text('در حال پیگیری…', 'Following up…')
              : text('تلاش دوبارهٔ همان فرمان', 'Retry the same command')}
          </Button>
        </div>
      )}
      {commandError && <OfferError code={commandError} />}
      <h4>{text('تاریخچهٔ همین پیشنهاد', 'This offer’s history')}</h4>
      {eventError ? (
        <p role="alert">
          {text(
            'تاریخچه دریافت نشد؛ وضعیت تازه را بررسی کنید.',
            'History could not be read. Get the current state.',
          )}
        </p>
      ) : !events ? (
        <p role="status">{text('در حال دریافت تاریخچه…', 'Loading history…')}</p>
      ) : (
        <>
          <ol className="sourcing-history" aria-busy={eventLoading}>
            {events.items.map((event) => (
              <li key={event.id}>
                <strong>{state(event.stateAfter)}</strong>
                <p>{event.publicMessage}</p>
                <time dateTime={event.at}>{date(event.at)}</time>
                <small>
                  {' '}
                  ·{' '}
                  {event.actorKind === 'customer'
                    ? text('شما', 'You')
                    : event.actorKind === 'staff'
                      ? text('فروشگاه', 'Store')
                      : text('سامانه', 'System')}
                </small>
              </li>
            ))}
          </ol>
          <nav
            className="catalog-pagination"
            aria-label={text('صفحه‌های تاریخچهٔ پیشنهاد', 'Offer history pages')}
          >
            {history.length > 0 && (
              <Button
                variant="outline"
                disabled={eventLoading}
                onClick={() => {
                  setCursor(history[history.length - 1]);
                  setHistory((value) => value.slice(0, -1));
                }}
              >
                {text('رویدادهای قبل', 'Previous events')}
              </Button>
            )}
            {events.nextCursor && (
              <Button
                variant="outline"
                disabled={eventLoading}
                onClick={() => {
                  setHistory((value) => [...value, cursor]);
                  setCursor(events.nextCursor);
                }}
              >
                {text('رویدادهای بعدی', 'Next events')}
              </Button>
            )}
          </nav>
        </>
      )}
    </article>
  );
}
function OfferLine({ line }: { line: OfferDetail['offer']['lines'][number] }) {
  const { locale, text, digits, rial } = useOfferFormatting(),
    sku = line.sku,
    name = locale === 'fa' ? sku.model.nameFa : sku.model.nameEn,
    label = locale === 'fa' ? sku.labelFa : sku.labelEn,
    warranty = locale === 'fa' ? sku.warrantyFa : sku.warrantyEn;
  return (
    <section className="offer-item">
      <div className="offer-item-heading">
        <Image src={sku.model.images[0]} alt={name} width={90} height={90} />
        <div>
          <h4>{name}</h4>
          <p>{label}</p>
          <p>
            {text('کد SKU', 'SKU')}: <bdi>{sku.sku}</bdi> ·{' '}
            {locale === 'fa' ? sku.colorNameFa : sku.colorNameEn}
          </p>
          <small>
            {text('تعداد', 'Quantity')}: {digits(line.quantity)}
          </small>
        </div>
      </div>
      <dl className="offer-price-lines">
        <div>
          <dt>{text('قیمت هر عدد', 'Unit price')}</dt>
          <dd>
            <bdi>{rial(line.unitPriceRial)}</bdi>
          </dd>
        </div>
        <div>
          <dt>{text('جمع این ردیف', 'Line total')}</dt>
          <dd>
            <bdi>{rial(line.lineTotalRial)}</bdi>
          </dd>
        </div>
      </dl>
      <section>
        <h5>{text('گارانتی ثبت‌شده برای همین SKU', 'Recorded warranty for this SKU')}</h5>
        <p className="preserve-lines">
          {warranty ||
            text(
              'متنی ثبت نشده است؛ برای روشن‌شدن شرایط از فروشگاه پیگیری کنید.',
              'No warranty text was recorded. Follow up with the store to clarify the terms.',
            )}
        </p>
      </section>
      <details>
        <summary>
          {text(
            'مشخصات کامل مدل و تنوع در این پیشنهاد',
            'Full model and variant specifications in this offer',
          )}
        </summary>
        <p className="preserve-lines">
          {locale === 'fa' ? sku.model.descriptionFa : sku.model.descriptionEn}
        </p>
        {[
          { title: text('ویژگی‌های مدل', 'Model attributes'), attributes: sku.model.attributes },
          { title: text('ویژگی‌های همین تنوع', 'Variant attributes'), attributes: sku.attributes },
        ].map((group) => (
          <section key={group.title}>
            <h5>{group.title}</h5>
            <dl className="sourcing-specs">
              {group.attributes.map((attribute) => (
                <div key={attribute.attributeId}>
                  <dt>{locale === 'fa' ? attribute.labelFa : attribute.labelEn}</dt>
                  <dd>{sourcingAttributeText(attribute, locale)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </details>
    </section>
  );
}
