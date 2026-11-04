'use client';
import { advanceRequestGeneration } from '@sayman/web-shared/lib/data/request-generation.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PackageCheck, RefreshCcw } from 'lucide-react';
import { useCustomerSession } from '../auth/auth-provider';
import { useI18n } from '../navigation/locale-provider';
import { useSourcingText } from './sourcing';
import { Button } from '../shared/ui';
import { CartError } from '@/lib/checkout/cart-client';
import { listSourcingSupply, readSourcingSupplyView } from '@/lib/market/supply-client';
import {
  supplyPageSelection,
  supplyReadMayApply,
  supplySelectionChangesView,
  type SupplyReadTicket,
} from '@/lib/market/supply-view';
import type { SupplyDetail, SupplyEvents, SupplyPage } from '@/lib/market/supply-contract';
import { supplyAllocationHeld } from '@sayman/web-shared/lib/market/supply-allocation.ts';
import './customer-supply.css';
import { CartConversion } from '../checkout/cart-conversion';

export function CustomerSourcingSupply({
  requestId,
  refreshToken,
}: {
  requestId: string;
  refreshToken: number;
}) {
  const auth = useCustomerSession();
  if (auth.status !== 'member' || !auth.session) return null;
  return (
    <SupplyView
      key={`${auth.session.user.id}:${requestId}`}
      owner={auth.session.user.id}
      requestId={requestId}
      refreshToken={refreshToken}
    />
  );
}
function SupplyView({
  owner,
  requestId,
  refreshToken,
}: {
  owner: string;
  requestId: string;
  refreshToken: number;
}) {
  const auth = useCustomerSession(),
    { locale, digits } = useI18n(),
    text = useSourcingText();
  const [page, setPage] = useState<SupplyPage | null>(null),
    [detail, setDetail] = useState<SupplyDetail | null>(null),
    [events, setEvents] = useState<SupplyEvents | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [cursor, setCursor] = useState<string | null>(null),
    [history, setHistory] = useState<(string | null)[]>([]),
    [eventCursor, setEventCursor] = useState<string | null>(null),
    [eventHistory, setEventHistory] = useState<(string | null)[]>([]),
    [attempt, setAttempt] = useState(0),
    [loading, setLoading] = useState(false),
    [detailLoading, setDetailLoading] = useState(false),
    [error, setError] = useState(''),
    [detailError, setDetailError] = useState('');
  const mounted = useRef(true),
    pageEpoch = useRef(0),
    detailEpoch = useRef(0),
    view = useRef({ owner, requestId, selected, eventCursor });
  view.current = { owner, requestId, selected, eventCursor };
  const live = useCallback(
    (ticket: SupplyReadTicket, epoch: number) => {
      const current = auth.store.snapshot();
      return supplyReadMayApply(ticket, {
        owner: view.current.owner,
        requestId: view.current.requestId,
        taskId: ticket.taskId === null ? null : view.current.selected,
        epoch,
        mounted: mounted.current,
        status: current.status,
        verifiedOwner: current.session?.user.id ?? null,
      });
    },
    [auth.store],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      advanceRequestGeneration(pageEpoch);
      advanceRequestGeneration(detailEpoch);
    };
  }, []);

  const date = (value: string) =>
    new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Tehran',
    }).format(new Date(value));
  const state = (value: string) =>
    ({
      PendingSupply: text('پیگیری آغاز شده است', 'Supply follow-up started'),
      SupplierRequested: text('استعلام تأمین ثبت شده است', 'Supplier enquiry recorded'),
      SupplierOrderRecorded: text('سفارش دستی تأمین ثبت شده است', 'Manual supplier order recorded'),
      PartiallyReceived: text('بخشی از کالا دریافت شده است', 'Goods partly received'),
      Received: text('همهٔ اقلام دریافت شده‌اند', 'All goods received'),
      Cancelled: text('پیگیری پایان یافته است', 'Supply follow-up cancelled'),
      Failed: text('تأمین انجام نشد', 'Supply follow-up failed'),
    })[value] ?? text('وضعیت نامشخص', 'Unknown state');
  const progress = (value: string) =>
    ({
      None: text('هنوز دریافت ثبت نشده است', 'No receipt recorded'),
      Partial: text('دریافت ناقص', 'Partly received'),
      Complete: text('دریافت کامل', 'Fully received'),
    })[value] ?? text('وضعیت نامشخص', 'Unknown progress');
  const readError = (code: string) =>
    code === 'not_found'
      ? text(
          'این پیگیری در حساب شما پیدا نشد. فهرست را بازخوانی کنید.',
          'This supply follow-up was not found in your account. Refresh the list.',
        )
      : text(
          'وضعیت تازهٔ پیگیری دریافت نشد. دوباره بازخوانی کنید.',
          'Current supply progress could not be loaded. Refresh to try again.',
        );
  useEffect(() => {
    const abort = new AbortController(),
      ticket = { owner, requestId, taskId: null, epoch: ++pageEpoch.current };
    setLoading(true);
    setError('');
    setPage(null);
    void listSourcingSupply(auth.store.fetch, requestId, cursor, abort.signal)
      .then((value) => {
        if (abort.signal.aborted || !live(ticket, pageEpoch.current)) return;
        const selection = supplyPageSelection(view.current.selected, value.items);
        if (selection.resetHistory) {
          advanceRequestGeneration(detailEpoch);
          view.current = { ...view.current, selected: selection.selected, eventCursor: null };
          setDetail(null);
          setEvents(null);
          setDetailError('');
          setDetailLoading(false);
          setEventCursor(null);
          setEventHistory([]);
        }
        setPage(value);
        setSelected(selection.selected);
      })
      .catch((error) => {
        if (!abort.signal.aborted && live(ticket, pageEpoch.current))
          setError(error instanceof CartError ? error.code : 'sourcing_supply_unavailable');
      })
      .finally(() => {
        if (!abort.signal.aborted && live(ticket, pageEpoch.current)) setLoading(false);
      });
    return () => abort.abort();
  }, [owner, requestId, cursor, refreshToken, attempt, auth.store, live]);
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      setEvents(null);
      return;
    }
    const abort = new AbortController(),
      ticket = { owner, requestId, taskId: selected, epoch: ++detailEpoch.current };
    setDetailLoading(true);
    setDetailError('');
    setDetail(null);
    setEvents(null);
    void readSourcingSupplyView(auth.store.fetch, requestId, selected, eventCursor, abort.signal)
      .then((value) => {
        if (!abort.signal.aborted && live(ticket, detailEpoch.current)) {
          setDetail(value.detail);
          setEvents(value.events);
        }
      })
      .catch((error) => {
        if (!abort.signal.aborted && live(ticket, detailEpoch.current))
          setDetailError(error instanceof CartError ? error.code : 'sourcing_supply_unavailable');
      })
      .finally(() => {
        if (!abort.signal.aborted && live(ticket, detailEpoch.current)) setDetailLoading(false);
      });
    return () => abort.abort();
  }, [owner, requestId, selected, eventCursor, refreshToken, attempt, auth.store, live]);
  function select(taskId: string) {
    if (!supplySelectionChangesView(view.current.selected, view.current.eventCursor, taskId))
      return;
    advanceRequestGeneration(detailEpoch);
    view.current = { ...view.current, selected: taskId, eventCursor: null };
    setDetail(null);
    setEvents(null);
    setSelected(taskId);
    setEventCursor(null);
    setEventHistory([]);
  }
  function changePage(next: string | null, previous: boolean) {
    advanceRequestGeneration(detailEpoch);
    view.current = { ...view.current, selected: null, eventCursor: null };
    setDetail(null);
    setEvents(null);
    setDetailLoading(false);
    setSelected(null);
    setEventCursor(null);
    setEventHistory([]);
    setCursor(next);
    if (previous) setHistory((value) => value.slice(0, -1));
    else setHistory((value) => [...value, cursor]);
  }
  return (
    <section
      id="supply-progress"
      className="customer-supply card-panel"
      aria-labelledby="supply-progress-heading"
    >
      <div className="sourcing-heading">
        <div>
          <span className="eyebrow">
            {text('از پذیرش تا دریافت واقعی', 'From consent to actual receipt')}
          </span>
          <h2 id="supply-progress-heading">
            <PackageCheck size={21} />
            {text('پیگیری تأمین کالا', 'Supply progress')}
          </h2>
        </div>
        <Button
          variant="outline"
          disabled={loading || detailLoading}
          onClick={() => setAttempt((value) => value + 1)}
        >
          <RefreshCcw size={15} />
          {text('بازخوانی پیگیری', 'Refresh progress')}
        </Button>
      </div>
      <p className="notice">
        {text(
          'دریافت واقعی کالا و نگه‌داری سهم موجودی برای شما جداگانه ثبت می‌شوند. وضعیت و مهلت نگه‌داری در جزئیات هر پیگیری نمایش داده می‌شود؛ خرید و پرداخت هنوز از این بخش انجام نمی‌شود.',
          'Actual receipt and holding your stock share are recorded separately. Each follow-up shows its current hold and deadline; purchase and payment are not yet available here.',
        )}
      </p>
      {error && (
        <p className="notice" role="alert">
          {readError(error)}
        </p>
      )}
      {loading && (
        <p role="status">{text('در حال دریافت وضعیت پیگیری…', 'Loading supply progress…')}</p>
      )}
      {page && (
        <>
          <div className="supply-task-list" aria-busy={loading}>
            {page.items.length ? (
              page.items.map((item) => (
                <button
                  type="button"
                  className={`supply-task-row${selected === item.id ? ' selected' : ''}`}
                  aria-pressed={selected === item.id}
                  key={item.id}
                  onClick={() => select(item.id)}
                >
                  <span>
                    <strong>{state(item.effectiveState)}</strong>
                    <small>
                      {item.isDemo && <>{text('نمونه', 'Sample')} · </>}
                      <time dateTime={item.changedAt}>{date(item.changedAt)}</time>
                    </small>
                  </span>
                  <span>
                    {text('دریافت‌شده', 'Received')}:{' '}
                    <bdi>
                      {digits(item.receivedQuantity)} / {digits(item.requiredQuantity)}
                    </bdi>
                    {item.allocation && (
                      <small>
                        {text('تخصیص ثبت‌شده تا', 'Allocation recorded until')}:{' '}
                        <time dateTime={item.allocation.expiresAt}>
                          {date(item.allocation.expiresAt)}
                        </time>
                      </small>
                    )}
                    <small>
                      {item.expectedAt ? (
                        <>
                          {text('زمان اعلام‌شدهٔ تأمین', 'Reported ETA')}:{' '}
                          <time dateTime={item.expectedAt}>{date(item.expectedAt)}</time>
                        </>
                      ) : (
                        text('زمان تأمین هنوز مشخص نشده است', 'Supply ETA has not been specified')
                      )}
                    </small>
                  </span>
                </button>
              ))
            ) : (
              <p className="small-note">
                {text(
                  'هنوز پیگیری مستقلی برای این درخواست ثبت نشده است. پذیرش پیشنهاد به‌تنهایی دریافت کالا را ثبت نمی‌کند.',
                  'No separate supply follow-up has been recorded yet. Accepting an offer alone does not record receipt of goods.',
                )}
              </p>
            )}
          </div>
          <nav
            className="catalog-pagination"
            aria-label={text('صفحه‌های پیگیری تأمین', 'Supply follow-up pages')}
          >
            {history.length > 0 && (
              <Button
                variant="outline"
                disabled={loading || detailLoading}
                onClick={() => changePage(history[history.length - 1], true)}
              >
                {text('صفحهٔ قبل', 'Previous page')}
              </Button>
            )}
            {page.nextCursor && (
              <Button
                variant="outline"
                disabled={loading || detailLoading}
                onClick={() => changePage(page.nextCursor, false)}
              >
                {text('پیگیری‌های بعدی', 'Next follow-ups')}
              </Button>
            )}
          </nav>
        </>
      )}
      {detailLoading && (
        <p role="status">
          {text('در حال دریافت جزئیات و تاریخچه…', 'Loading details and history…')}
        </p>
      )}
      {detailError && (
        <p className="notice" role="alert">
          {readError(detailError)}
        </p>
      )}
      {detail && (
        <div className="supply-task-detail">
          <SupplyAllocationNotice value={detail} />
          <CartConversion
            key={requestId + ':' + detail.task.offerId}
            requestId={requestId}
            offerId={detail.task.offerId}
          />
          <div className="supply-task-status">
            <h3>{state(detail.task.effectiveState)}</h3>
            <span>{progress(detail.task.receiptProgress)}</span>
          </div>
          {detail.task.requiresNewOffer && (
            <p className="notice">
              {text(
                'ادامهٔ خرید به پیشنهاد و پذیرش تازه نیاز دارد. سابقهٔ پیگیری و دریافت‌های واقعی محفوظ است.',
                'Continuing toward purchase requires a new offer and consent. Follow-up history and actual receipts are retained.',
              )}
            </p>
          )}
          <dl className="supply-dates">
            <div>
              <dt>{text('زمان اعلام‌شدهٔ تأمین', 'Reported supply ETA')}</dt>
              <dd>
                {detail.task.expectedAt ? (
                  <time dateTime={detail.task.expectedAt}>{date(detail.task.expectedAt)}</time>
                ) : (
                  text('مشخص نشده است', 'Not specified')
                )}
              </dd>
            </div>
            <div>
              <dt>{text('مهلت خرید پیشنهاد پذیرفته‌شده', 'Accepted offer purchase deadline')}</dt>
              <dd>
                <time dateTime={detail.task.purchaseUntil}>{date(detail.task.purchaseUntil)}</time>
              </dd>
            </div>
            <div>
              <dt>{text('آخرین ثبت پیشرفت', 'Last progress update')}</dt>
              <dd>
                <time dateTime={detail.task.changedAt}>{date(detail.task.changedAt)}</time>
              </dd>
            </div>
          </dl>
          <p className="small-note">
            {text(
              'زمان‌ها به وقت تهران نمایش داده می‌شوند.',
              'Times are displayed in Tehran time.',
            )}
          </p>
          {(locale === 'fa' ? detail.publicMessageFa : detail.publicMessageEn) && (
            <p className="preserve-lines supply-public-message">
              {locale === 'fa' ? detail.publicMessageFa : detail.publicMessageEn}
            </p>
          )}
          <h4>{text('تعداد واقعی هر کالا', 'Actual quantities by item')}</h4>
          <div className="supply-item-list">
            {detail.lines.map((line) => (
              <article key={line.offerLineId} className="supply-item">
                <h5>{locale === 'fa' ? line.nameFa : line.nameEn}</h5>
                <p>{locale === 'fa' ? line.labelFa : line.labelEn}</p>
                <small>
                  {text('کد کالا', 'SKU')}: <bdi>{line.sku}</bdi>
                </small>
                <dl className="supply-quantities">
                  <div>
                    <dt>{text('تعداد پذیرفته‌شده', 'Accepted quantity')}</dt>
                    <dd>{digits(line.requiredQuantity)}</dd>
                  </div>
                  <div>
                    <dt>{text('دریافت واقعی', 'Actually received')}</dt>
                    <dd>{digits(line.receivedQuantity)}</dd>
                  </div>
                  <div>
                    <dt>{text('باقی‌مانده', 'Remaining')}</dt>
                    <dd>{digits(line.remainingQuantity)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
          <h4>{text('تاریخچهٔ پیگیری تأمین', 'Supply follow-up history')}</h4>
          {events && (
            <>
              <ol className="sourcing-history">
                {events.items.map((event) => (
                  <li key={event.id}>
                    <strong>{state(event.stateAfter)}</strong>
                    <p>{progress(event.receiptProgress)}</p>
                    {(locale === 'fa' ? event.publicMessageFa : event.publicMessageEn) && (
                      <p className="preserve-lines">
                        {locale === 'fa' ? event.publicMessageFa : event.publicMessageEn}
                      </p>
                    )}
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
                    {event.actionAt && (
                      <small>
                        {text('زمان اقدام اعلام‌شده', 'Reported action time')}:{' '}
                        <time dateTime={event.actionAt}>{date(event.actionAt)}</time>
                      </small>
                    )}
                    {event.expectedAt && (
                      <small>
                        {text('زمان تأمین اعلام‌شده در این ثبت', 'ETA reported in this update')}:{' '}
                        <time dateTime={event.expectedAt}>{date(event.expectedAt)}</time>
                      </small>
                    )}
                  </li>
                ))}
              </ol>
              <nav
                className="catalog-pagination"
                aria-label={text('صفحه‌های تاریخچهٔ تأمین', 'Supply history pages')}
              >
                {eventHistory.length > 0 && (
                  <Button
                    variant="outline"
                    disabled={detailLoading}
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
                    disabled={detailLoading}
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
        </div>
      )}
    </section>
  );
}

function SupplyAllocationNotice({ value }: { value: SupplyDetail }) {
  const text = useSourcingText(),
    { locale, digits } = useI18n(),
    allocation = value.task.allocation,
    hasAllocation = allocation !== null,
    [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (!hasAllocation) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasAllocation, allocation?.id, allocation?.version]);
  if (!allocation)
    return (
      <p className="notice">
        {text(
          'در حال حاضر تخصیص فعال موجودی برای این درخواست ثبت نشده است. دریافت کالا به‌تنهایی سهمی برای شما نگه نمی‌دارد.',
          'No active stock allocation is currently recorded for this request. Receiving goods alone does not hold a share for you.',
        )}
      </p>
    );
  const held = supplyAllocationHeld(value.reservedForRequest, allocation, now),
    date = new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Tehran',
    }).format(new Date(allocation.expiresAt));
  return (
    <div className="notice" role="status">
      <strong>
        {held
          ? text('سهم موجودی برای شما نگه‌داری شده است', 'Your stock share is held')
          : text('مهلت نگه‌داری این تخصیص گذشته است', 'This allocation hold has expired')}
      </strong>
      <p>
        {text('مهلت نگه‌داری', 'Hold deadline')}:{' '}
        <time dateTime={allocation.expiresAt}>{date}</time> · {digits(allocation.quantity)}{' '}
        {text('واحد', 'units')} · {text('وقت تهران', 'Tehran time')}
      </p>
      {!held && (
        <p>
          {text(
            'برای دریافت وضعیت جاری و بررسی اقدام بعدی، پیگیری را بازخوانی کنید.',
            'Refresh progress to check the current status and next action.',
          )}
        </p>
      )}
      <p>
        {text(
          'تخصیص به معنای ثبت سفارش یا پرداخت نیست. پیشنهاد واجد شرایط را به سبد اضافه کنید و امکان ثبت سفارش موقت را در مرور مبلغ و شرایط بررسی کنید.',
          'Allocation does not record an order or payment. Add an eligible offer to your cart, then review amounts and conditions to check temporary order eligibility.',
        )}
      </p>
    </div>
  );
}
