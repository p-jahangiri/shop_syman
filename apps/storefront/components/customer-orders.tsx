'use client';
import { advanceRequestGeneration } from '../lib/request-generation';
import { CreditOrderInformation } from './credit-order-information';
import { CustomerPaymentHistory } from './order-payments';
import { CustomerFulfillmentCard } from './order-parcels';
import { UsedConditionReport } from './used-condition';
import { useEffect, useRef, useState } from 'react';
import { Package, RefreshCw } from 'lucide-react';
import { useCustomerSession } from './auth-provider';
import { useI18n, useStorefront } from './locale-provider';
import Link from './localized-link';
import { Button } from './ui';
import {
  cancelOrderV2 as cancelOrder,
  listOrdersV2 as listOrders,
  readOrderV2 as readOrder,
} from '@/lib/order-v2-client';
import {
  orderV2Expired as orderExpired,
  type OrderDetailV2 as OrderDetail,
  type OrderPageV2 as OrderPage,
} from '@/lib/order-v2-contract';
import { CartError } from '@/lib/cart-client';

const states = {
  AwaitingPayment: ['در انتظار پرداخت', 'Awaiting payment'],
  Paid: ['پرداخت‌شده', 'Paid'],
  Cancelled: ['لغوشده', 'Cancelled'],
  Expired: ['منقضی‌شده', 'Expired'],
  Fulfilled: ['تحویل‌شده', 'Fulfilled'],
  CreditApproved: ['تأیید مالی چکی', 'Credit financially approved'],
} as const;
export function CustomerOrders({ id }: { id?: string }) {
  const auth = useCustomerSession();
  const { locale } = useI18n();
  const source = useStorefront().dataSource;
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  if (source !== 'api')
    return (
      <div className="container page-empty empty-state">
        <Package />
        <h1>{text('سفارش‌های من', 'My orders')}</h1>
        <p>
          {text(
            'سفارش‌ها فقط در نسخهٔ متصل به حساب و سرویس فروش در دسترس‌اند.',
            'Orders are available in the connected store with a verified account.',
          )}
        </p>
      </div>
    );
  if (auth.status !== 'member')
    return (
      <div className="container page-empty empty-state">
        <Package />
        <h1>{text('سفارش‌های من', 'My orders')}</h1>
        {auth.status === 'restoring' ? (
          <p role="status">{text('در حال بررسی نشست…', 'Checking your session…')}</p>
        ) : auth.status === 'unavailable' ? (
          <>
            <p role="alert">
              {text('ارتباط حساب بررسی نشد.', 'Your account connection could not be checked.')}
            </p>
            <Button onClick={() => void auth.store.restore().catch(() => {})}>
              {text('تلاش دوباره', 'Retry')}
            </Button>
          </>
        ) : (
          <>
            <p>{text('برای مشاهدهٔ سفارش‌های خود وارد شوید.', 'Sign in to view your orders.')}</p>
            <Button asChild>
              <Link href={`/account?returnTo=/orders${id ? `/${id}` : ''}`}>
                {text('ورود و ادامه', 'Sign in and continue')}
              </Link>
            </Button>
          </>
        )}
      </div>
    );
  return <OrdersView key={`${locale}:${auth.session!.user.id}:${id ?? 'list'}`} id={id} />;
}
function OrdersView({ id }: { id?: string }) {
  const auth = useCustomerSession();
  const { locale, toman, t, digits } = useI18n();
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const [page, setPage] = useState<OrderPage | null>(null),
    [order, setOrder] = useState<OrderDetail | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0),
    [confirm, setConfirm] = useState(false),
    [now, setNow] = useState(0);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const status = (value: keyof typeof states) => states[value][locale === 'fa' ? 0 : 1];
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  const amount = (value: string) => toman(BigInt(value)) + ' ' + t('تومان');
  const issue = (e: unknown) =>
    e instanceof CartError && e.status === 404
      ? 'missing'
      : e instanceof CartError && e.status === 409
        ? 'conflict'
        : 'unavailable';
  useEffect(() => {
    const ticket = ++generation.current;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    setConfirm(false);
    const task = id
      ? readOrder(auth.store.fetch, id, abort.signal).then((v) => {
          if (ticket === generation.current) setOrder(v);
        })
      : listOrders(auth.store.fetch, null, abort.signal).then((v) => {
          if (ticket === generation.current) setPage(v);
        });
    void task
      .catch((e) => {
        if (ticket === generation.current && !abort.signal.aborted) setError(issue(e));
      })
      .finally(() => {
        if (ticket === generation.current && !abort.signal.aborted) setBusy(false);
      });
    return () => {
      advanceRequestGeneration(generation);
      abort.abort();
    };
  }, [id, auth.store, attempt]);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  async function more() {
    if (busy || !page?.nextCursor) return;
    const ticket = generation.current;
    setBusy(true);
    setError('');
    try {
      const next = await listOrders(auth.store.fetch, page.nextCursor, controller.current?.signal);
      if (ticket === generation.current)
        setPage((old) =>
          old
            ? {
                ...old,
                items: [
                  ...old.items,
                  ...next.items.filter((n) => !old.items.some((o) => o.id === n.id)),
                ],
                nextCursor: next.nextCursor,
              }
            : next,
        );
    } catch (e) {
      if (ticket === generation.current) setError(issue(e));
    } finally {
      if (ticket === generation.current) setBusy(false);
    }
  }
  async function cancel() {
    if (busy || !order || orderExpired(order, now || Date.now())) return;
    const ticket = generation.current;
    setBusy(true);
    setError('');
    try {
      const updated = await cancelOrder(
        auth.store.fetch,
        order.summary.id,
        order.summary.version,
        controller.current?.signal,
      );
      if (ticket === generation.current) {
        setOrder(updated);
        setConfirm(false);
      }
    } catch (e) {
      if (ticket === generation.current) {
        setConfirm(false);
        setError(issue(e));
      }
    } finally {
      if (ticket === generation.current) setBusy(false);
    }
  }
  const expired = order && orderExpired(order, now || Date.now());
  return (
    <div className="container customer-orders">
      <div className="page-top">
        <div className="breadcrumbs">
          <Link href="/account">{text('حساب کاربری', 'Account')}</Link>
          <span>/</span>
          <Link href="/orders">{text('سفارش‌های من', 'My orders')}</Link>
        </div>
        <div className="page-title-row">
          <h1>
            {id
              ? (order?.summary.reference ?? text('جزئیات سفارش', 'Order details'))
              : text('سفارش‌های من', 'My orders')}
          </h1>
          <Button variant="outline" disabled={busy} onClick={() => setAttempt((n) => n + 1)}>
            <RefreshCw size={16} />
            {text('تازه‌سازی', 'Refresh')}
          </Button>
        </div>
      </div>
      {error && (
        <div className="notice" role="alert">
          <p>
            {error === 'missing'
              ? text(
                  'سفارش پیدا نشد یا متعلق به حساب شما نیست.',
                  'This order was not found in your account.',
                )
              : error === 'conflict'
                ? text(
                    'وضعیت سفارش تغییر کرده است. برای ادامه اطلاعات تازه را دریافت کنید.',
                    'The order changed. Refresh its details before continuing.',
                  )
                : text(
                    'پاسخ سرویس دریافت نشد. برای بررسی آخرین وضعیت دوباره تلاش کنید.',
                    'The service response was not received. Retry to check the latest status.',
                  )}
          </p>
          <Button variant="outline" onClick={() => setAttempt((n) => n + 1)} disabled={busy}>
            {text('دریافت اطلاعات تازه', 'Load current details')}
          </Button>
        </div>
      )}
      {busy && !page && !order && (
        <div
          className="skeleton skeleton-card"
          role="status"
          aria-label={text('دریافت سفارش‌ها', 'Loading orders')}
        />
      )}
      {!id && page && (
        <section className="card-panel">
          <p className="small-note">
            {text(
              'سفارش موقت به معنی پرداخت یا خرید قطعی نیست.',
              'A temporary order does not mean payment or a completed purchase.',
            )}
          </p>
          {page.items.length ? (
            <div className="customer-order-list">
              {page.items.map((o) => (
                <Link href={`/orders/${o.id}`} key={o.id} className="customer-order-row">
                  <strong dir="ltr">{o.reference}</strong>
                  <span>
                    {status(
                      o.state === 'AwaitingPayment' &&
                        Date.parse(o.expiresAt) <= (now || Date.now())
                        ? 'Expired'
                        : o.state,
                    )}
                  </span>
                  <time dateTime={o.createdAt}>{date(o.createdAt)}</time>
                  <span>
                    {digits(o.itemCount)} {text('عدد', 'items')}
                  </span>
                  <strong>{amount(o.payableTotalRial)}</strong>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <Package />
              <h2>{text('هنوز سفارشی ثبت نشده است', 'No orders yet')}</h2>
              <Link href="/catalog" className="text-link">
                {text('مشاهدهٔ کالاها', 'Browse products')}
              </Link>
            </div>
          )}
          {page.nextCursor && (
            <Button variant="outline" onClick={() => void more()} disabled={busy}>
              {busy
                ? text('در حال دریافت…', 'Loading…')
                : text('سفارش‌های بیشتر', 'Load more orders')}
            </Button>
          )}
        </section>
      )}
      {order && (
        <div className="checkout-layout">
          <div className="checkout-sections">
            <section className="card-panel">
              <span className="eyebrow">{status(expired ? 'Expired' : order.summary.state)}</span>
              <h2>{text('وضعیت سفارش', 'Order status')}</h2>
              {order.summary.state === 'AwaitingPayment' || expired ? (
                <div className="notice">
                  <p>
                    {expired
                      ? text(
                          'مهلت سفارش تمام شده است؛ این سفارش قابل پرداخت نیست. آزادسازی رزرو در سرور انجام می‌شود.',
                          'This order has expired and cannot be paid. The server releases its stock reservation.',
                        )
                      : text(
                          'تأیید نهایی پرداخت این سفارش هنوز ثبت نشده است. شروع پرداخت در این نسخه در دسترس نیست.',
                          'This order does not have a final payment confirmation yet. Starting a payment is currently unavailable.',
                        )}
                  </p>
                  <p>
                    {text('پایان رزرو', 'Reservation deadline')}:{' '}
                    <time dateTime={order.summary.expiresAt}>{date(order.summary.expiresAt)}</time>
                  </p>
                </div>
              ) : (
                <p>
                  {text(
                    'آخرین وضعیت ثبت‌شده در سرور در بالا نمایش داده می‌شود.',
                    'The latest recorded server status is shown above.',
                  )}
                </p>
              )}
              <p className="small-note">
                {text('تاریخ ثبت', 'Created')}: {date(order.summary.createdAt)} · {order.methodName}
              </p>
              {order.canCancel &&
                !expired &&
                (!confirm ? (
                  <Button
                    variant="outline"
                    disabled={busy || !!error}
                    onClick={() => setConfirm(true)}
                  >
                    {text('لغو سفارش موقت', 'Cancel temporary order')}
                  </Button>
                ) : (
                  <div className="notice">
                    <p>
                      {text(
                        'با لغو سفارش، رزرو موجودی آزاد می‌شود. لغو را تأیید می‌کنید؟',
                        'Cancelling releases the stock reservation. Confirm cancellation?',
                      )}
                    </p>
                    {order.paymentAvailability === 'credit_settlement_pending' && (
                      <p>
                        {text(
                          'مجوز خرید این سفارش با لغو دوباره قابل استفاده نمی‌شود.',
                          'Cancelling does not make this order’s purchase scope reusable.',
                        )}
                      </p>
                    )}
                    {order.originalSnapshotVersion === 2 && (
                      <p>
                        {text(
                          'پیشنهادهای پذیرفته‌شده پس از لغو دوباره فعال نمی‌شوند؛ خرید دوباره به پیشنهاد تازه نیاز دارد.',
                          'Accepted offers are not reactivated after cancellation. A new purchase requires a new offer.',
                        )}
                      </p>
                    )}
                    <div className="order-action-row">
                      <Button disabled={busy} onClick={() => void cancel()}>
                        {busy
                          ? text('در حال لغو…', 'Cancelling…')
                          : text('بله، لغو شود', 'Yes, cancel order')}
                      </Button>
                      <Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>
                        {text('انصراف', 'Keep order')}
                      </Button>
                    </div>
                  </div>
                ))}
            </section>
            <section className="card-panel">
              <h2>{text('اقلام ثبت‌شده', 'Order items')}</h2>
              {order.lines.map((l) => (
                <div className="customer-order-item" key={l.lineId}>
                  <div>
                    <h3>{l.name}</h3>
                    <p>
                      {l.label} · {text('تعداد', 'Quantity')}: {digits(l.quantity)}
                    </p>
                    <small>{l.warranty}</small>
                    <UsedConditionReport condition={l.usedCondition} locale={locale} historical />
                    <code dir="ltr">{l.sku}</code>
                    {l.accepted && (
                      <details>
                        <summary>
                          {text('شرایط توافقی پذیرفته‌شده', 'Accepted agreed terms')} ·{' '}
                          {text('ویرایش ', 'Revision ')}
                          {digits(l.accepted.revision)}
                        </summary>
                        <p className="preserve-lines">
                          {locale === 'fa' ? l.accepted.termsFa : l.accepted.termsEn}
                        </p>
                        {l.accepted.containsDemo && (
                          <small>{text('دادهٔ نمونهٔ توسعه', 'Development sample data')}</small>
                        )}
                      </details>
                    )}
                  </div>
                  <strong>{amount(l.lineTotalRial)}</strong>
                </div>
              ))}
            </section>
            {['credit_settlement_pending', 'credit_manual_authorization'].includes(
              order.paymentAvailability,
            ) && (
              <CreditOrderInformation
                key={`credit:${order.summary.id}:${order.summary.version}`}
                orderId={order.summary.id}
              />
            )}
            <CustomerPaymentHistory
              key={`payments:${order.summary.id}:${order.summary.version}`}
              orderId={order.summary.id}
            />{' '}
            {order.shippingRequired && (
              <CustomerFulfillmentCard
                key={`${order.summary.id}:${order.summary.version}`}
                orderId={order.summary.id}
              />
            )}
            <section className="card-panel">
              <h2>{text('اطلاعات تماس و تحویل', 'Contact and delivery')}</h2>
              <p>
                {order.contactName} · <bdi>{order.contactPhone}</bdi>
              </p>
              {order.delivery ? (
                <>
                  <p>
                    {order.delivery.province}، {order.delivery.city}
                  </p>
                  <p className="preserve-lines">{order.delivery.address}</p>
                  <p>
                    {text('کد پستی', 'Postal code')}: <bdi>{order.delivery.postalCode}</bdi>
                  </p>
                  <p>{order.shippingName}</p>
                </>
              ) : (
                <p>
                  {text(
                    'فقط کالای دیجیتال؛ ارسال فیزیکی ندارد.',
                    'Digital goods only; no physical delivery.',
                  )}
                </p>
              )}
              {order.note && <p className="preserve-lines">{order.note}</p>}
            </section>
          </div>
          <aside className="card-panel order-summary">
            <h2>{text('مبالغ ثبت‌شده', 'Recorded amounts')}</h2>
            {[
              [text('جمع کالاها', 'Items'), order.itemsSubtotalRial],
              [text('کالاها با افزوده', 'Goods total'), order.goodsTotalRial],
              [text('ارسال', 'Shipping'), order.shippingRial],
              [
                order.taxIncluded
                  ? text('مالیات داخل قیمت', 'Included tax')
                  : text('مالیات', 'Tax'),
                order.taxRial,
              ],
              [text('مبلغ نهایی', 'Total'), order.payableTotalRial],
            ].map(([label, value]) => (
              <div className="info-row" key={label}>
                <span>{label}</span>
                <strong>{amount(value)}</strong>
              </div>
            ))}
            <p className="small-note">
              {text(
                'این مبالغ، snapshot ثبت سفارش‌اند؛ وضعیت پرداخت از وضعیت خود سفارش خوانده می‌شود.',
                'These amounts are the order snapshot; payment status is shown in the order status.',
              )}
            </p>
            <Link className="text-link" href="/orders">
              {text('همهٔ سفارش‌ها', 'All orders')}
            </Link>
          </aside>
        </div>
      )}
    </div>
  );
}
