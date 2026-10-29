'use client';
import { advanceRequestGeneration } from '../lib/request-generation';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useCustomerSession } from './auth-provider';
import { useI18n, useStorefront } from './locale-provider';
import Link from './localized-link';
import { creditQuoteHistorySchema, type CreditQuoteHistory } from '../lib/credit-order-contract';
import {
  creditCheckoutQuoteSchema,
  type CreditCheckoutQuote,
} from '../lib/credit-checkout-quote-contract';
import { customerCreditOrderJournal } from '../lib/credit-order-journal';
import { CreditCheckoutQuoteSnapshot } from './credit-checkout-quote-panel';
import { CreditOrderForm } from './credit-order-form';
import { formatToman } from '../lib/money';
import { useShop } from './shop-context';
export function CustomerCreditPurchases() {
  const auth = useCustomerSession(),
    { locale } = useI18n(),
    { dataSource } = useStorefront(),
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  return (
    <div className="container support-tickets-page">
      <p>
        <Link href="/account">{text('حساب کاربری', 'My account')}</Link> ·{' '}
        <Link href="/credit">{text('پرونده‌های خرید چکی', 'Cheque applications')}</Link>
      </p>
      <h1>{text('محاسبات و سفارش‌های چکی من', 'My cheque calculations and orders')}</h1>
      <p>
        {text(
          'محاسبات ثبت‌شده از حساب شما خوانده می‌شوند. تاریخچه، موجودی یا اعتبارِ قابل استفادهٔ فعلی را تضمین نمی‌کند؛ شرایط سفارش دوباره بررسی می‌شوند.',
          'Recorded calculations are loaded from your account. History does not guarantee current stock or an unused scope; order conditions are checked again.',
        )}
      </p>
      {dataSource !== 'api' ? (
        <p>
          {text(
            'تاریخچهٔ خصوصی در پیش‌نمایش در دسترس نیست.',
            'Private history is unavailable in preview.',
          )}
        </p>
      ) : auth.status === 'member' && auth.session ? (
        <CreditPurchaseHistory key={auth.session.user.id} owner={auth.session.user.id} />
      ) : auth.status === 'restoring' ? (
        <p role="status">{text('در حال بررسی حساب…', 'Checking your account…')}</p>
      ) : (
        <section className="card-panel">
          <p>
            {text('برای مشاهدهٔ تاریخچهٔ خصوصی وارد شوید.', 'Sign in to view private history.')}
          </p>
          <Link href="/account?returnTo=/credit/purchases">{text('ورود به حساب', 'Sign in')}</Link>
          {auth.status === 'unavailable' && (
            <button onClick={() => void auth.store.restore()}>
              {text('بررسی دوبارهٔ حساب', 'Recheck account')}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
function CreditPurchaseHistory({ owner }: { owner: string }) {
  const auth = useCustomerSession(),
    shop = useShop(),
    { locale } = useI18n(),
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const entry = useSyncExternalStore(
      customerCreditOrderJournal.subscribe,
      () => customerCreditOrderJournal.snapshot(owner),
      () => null,
    ),
    unresolved = entry?.state === 'pending' || entry?.state === 'unknown';
  const [page, setPage] = useState<CreditQuoteHistory | null>(null),
    [selected, setSelected] = useState<CreditQuoteHistory['items'][number] | null>(null),
    [quote, setQuote] = useState<CreditCheckoutQuote | null>(null),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false),
    [quoteBusy, setQuoteBusy] = useState(false),
    [quoteFailed, setQuoteFailed] = useState(false),
    [refresh, setRefresh] = useState(0),
    [now, setNow] = useState(0);
  const generation = useRef(0),
    detailGeneration = useRef(0),
    abort = useRef<AbortController | null>(null);
  const recovery = useRef(false);
  if (!entry) recovery.current = false;
  if (
    entry &&
    (entry.state === 'unknown' ||
      entry.state === 'done' ||
      entry.command.body.creditQuoteId !== selected?.id)
  )
    recovery.current = true;
  const transport = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const response = await auth.store.fetch(path, init),
        raw = await response.json().catch(() => null),
        current = auth.store.snapshot();
      if (current.status !== 'member' || current.session?.user.id !== owner)
        throw Error('Account changed');
      if (!response.ok) throw Error('Private history unavailable');
      return raw;
    },
    [auth.store, owner],
  );
  const load = useCallback(
    async (
      cursor: string | null,
      replace: boolean,
      ticket: number,
      previous: CreditQuoteHistory['items'] = [],
    ) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setBusy(true);
      setFailed(false);
      try {
        const value = creditQuoteHistorySchema.parse(
          await transport('/api/credit-orders/quotes' + (cursor ? '?cursor=' + cursor : ''), {
            signal: controller.signal,
          }),
        );
        if (ticket !== generation.current || controller.signal.aborted) return;
        const items = replace ? value.items : [...previous, ...value.items];
        if (new Set(items.map((x) => x.id)).size !== items.length)
          throw Error('Duplicate calculation');
        setPage({ ...value, items });
      } catch {
        if (ticket === generation.current && !controller.signal.aborted) setFailed(true);
      } finally {
        if (ticket === generation.current && !controller.signal.aborted) setBusy(false);
      }
    },
    [transport],
  );
  useEffect(() => {
    const ticket = ++generation.current;
    setPage(null);
    void load(null, true, ticket);
    return () => {
      advanceRequestGeneration(generation);
      abort.current?.abort();
    };
  }, [owner, refresh, load]);
  useEffect(() => {
    const ticket = ++detailGeneration.current,
      controller = new AbortController();
    setQuote(null);
    setQuoteFailed(false);
    setQuoteBusy(!!selected);
    if (selected)
      void transport('/api/cart/' + selected.locale + '/v2/credit-quotes/' + selected.id, {
        signal: controller.signal,
      })
        .then((raw) => {
          const value = creditCheckoutQuoteSchema.parse(raw);
          if (
            value.id !== selected.id ||
            value.locale !== selected.locale ||
            value.fingerprint !== selected.fingerprint
          )
            throw Error('Wrong calculation');
          if (ticket === detailGeneration.current && !controller.signal.aborted) setQuote(value);
        })
        .catch(() => {
          if (ticket === detailGeneration.current && !controller.signal.aborted)
            setQuoteFailed(true);
        })
        .finally(() => {
          if (ticket === detailGeneration.current && !controller.signal.aborted)
            setQuoteBusy(false);
        });
    return () => {
      advanceRequestGeneration(detailGeneration);
      controller.abort();
    };
  }, [owner, selected, transport]);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Tehran',
    }).format(new Date(value));
  return (
    <>
      {entry && recovery.current && (
        <section className="card-panel">
          <CreditOrderForm quote={null} recoveryOnly onCreated={shop.retry} />
        </section>
      )}
      <div className="credit-quote-history-grid">
        <section className="card-panel">
          <div className="credit-quote-actions">
            <h2>{text('تاریخچهٔ محاسبات', 'Calculation history')}</h2>
            <button disabled={busy || unresolved} onClick={() => setRefresh((n) => n + 1)}>
              {text('دریافت تاریخچهٔ تازه', 'Refresh history')}
            </button>
          </div>
          {busy && !page && <p role="status">{text('در حال دریافت…', 'Loading…')}</p>}
          {failed && (
            <p role="alert">
              {text(
                'تاریخچه خوانده نشد؛ دوباره دریافت کنید.',
                'History could not be loaded. Refresh and retry.',
              )}
            </p>
          )}
          {page?.items.length === 0 && (
            <p>
              {text('محاسبهٔ چکی ثبت‌شده‌ای ندارید.', 'You have no recorded cheque calculations.')}
            </p>
          )}
          <ul className="credit-quote-history-list">
            {page?.items.map((item) => (
              <li key={item.id}>
                <button
                  disabled={unresolved}
                  aria-current={selected?.id === item.id ? 'page' : undefined}
                  onClick={() => setSelected({ ...item })}
                >
                  <strong lang={item.locale} dir={item.locale === 'fa' ? 'rtl' : 'ltr'}>
                    {item.planName}
                  </strong>
                  <span>
                    {date(item.createdAt)} ·{' '}
                    {item.payableTotalRial === null
                      ? text('مبلغ نهایی تعیین نشده', 'Final total unavailable')
                      : formatToman(item.payableTotalRial, locale) + ' ' + text('تومان', 'toman')}
                  </span>
                  <small>
                    {item.orderId
                      ? text('به سفارش متصل شده', 'Linked to an order')
                      : text(
                          'محاسبهٔ تاریخی؛ وضعیت جاری جدا بررسی می‌شود',
                          'Historical calculation; current eligibility is checked separately',
                        )}
                  </small>
                </button>
                {item.orderId && (
                  <Link href={'/orders/' + item.orderId}>
                    {text('مشاهدهٔ سفارش مربوط', 'Open related order')}
                  </Link>
                )}
              </li>
            ))}
          </ul>
          {page?.nextCursor && (
            <button
              disabled={busy || unresolved}
              onClick={() => void load(page.nextCursor, false, generation.current, page.items)}
            >
              {text('۲۰ محاسبهٔ بعدی', 'Next 20 calculations')}
            </button>
          )}
        </section>
        <section className="card-panel">
          {quoteBusy ? (
            <p role="status">
              {text('در حال دریافت نسخهٔ ثبت‌شده…', 'Loading retained calculation…')}
            </p>
          ) : quoteFailed ? (
            <p role="alert">
              {text(
                'نسخه خوانده نشد؛ دوباره از فهرست انتخاب کنید.',
                'Calculation unavailable. Select it again.',
              )}
            </p>
          ) : quote ? (
            <>
              <CreditCheckoutQuoteSnapshot quote={quote} now={now || Date.now()} />
              {selected?.orderId ? (
                <Link href={'/orders/' + selected.orderId}>
                  {text('مشاهدهٔ وضعیت سفارش مرتبط', 'View the related order status')}
                </Link>
              ) : (
                (!entry || !recovery.current) && (
                  <CreditOrderForm quote={quote} disabled={false} onCreated={shop.retry} />
                )
              )}
            </>
          ) : (
            <p>
              {text(
                'یک محاسبه را برای مشاهدهٔ نسخهٔ دقیق آن انتخاب کنید.',
                'Choose a calculation to view its exact retained version.',
              )}
            </p>
          )}
        </section>
      </div>
    </>
  );
}
