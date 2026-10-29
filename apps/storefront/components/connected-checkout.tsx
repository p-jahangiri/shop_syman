'use client';
import { advanceRequestGeneration } from '../lib/request-generation';
import { UsedConditionReport } from './used-condition';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CreditOrderForm } from './credit-order-form';
import { customerCreditOrderJournal } from '../lib/credit-order-journal';
import { CreditCheckoutQuotePanel } from './credit-checkout-quote-panel';
import { customerCreditCheckoutQuoteJournal } from '../lib/credit-checkout-quote-journal';
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  CreditCard,
  Info,
  Package,
  RefreshCw,
  WalletCards,
} from 'lucide-react';
import { useI18n, useStorefront } from './locale-provider';
import { useCustomerSession } from './auth-provider';
import { useShop } from './shop-provider';
import Link from './localized-link';
import { Button } from './ui';
import { requestQuote } from '@/lib/quote-client';
import { quoteExpired, type CheckoutQuote } from '@/lib/quote-contract';
import type { ServerCartV2 as ServerCart } from '@/lib/cart-v2-contract';
import { CartError } from '@/lib/cart-client';
import { TemporaryOrderForm } from './temporary-order-form';
import { AcceptedQuoteReview } from './accepted-quote-review';
import { OrderV2Form } from './order-v2-form';
import { AcceptedOrderPreparation } from './accepted-order-preparation';
import { readOrderV2Attempt } from '@/lib/order-v2-journal';
import { readQuoteV5Attempt } from '@/lib/quote-v5-journal';

export function ConnectedCheckout() {
  const auth = useCustomerSession();
  const { locale } = useI18n();
  const { purchaseMethods } = useStorefront();
  const { serverCart, retry } = useShop();
  const owner = auth.status === 'member' ? auth.session!.user.id : null;
  const orderEntry = useSyncExternalStore(
      customerCreditOrderJournal.subscribe,
      () => customerCreditOrderJournal.snapshot(owner),
      () => null,
    ),
    orderOwner = useRef<string | null>(null),
    recoverOrder = useRef(false);
  if (orderOwner.current !== owner) {
    orderOwner.current = owner;
    recoverOrder.current = !!orderEntry;
  }
  if (!orderEntry) recoverOrder.current = false;
  if (
    orderEntry &&
    (orderEntry.state === 'unknown' ||
      orderEntry.state === 'done' ||
      orderEntry.command.quoteSnapshot.locale !== locale ||
      (orderEntry.command.quoteSnapshot.ordinaryQuote?.cartVersion !== undefined &&
        orderEntry.command.quoteSnapshot.ordinaryQuote.cartVersion !== serverCart?.version) ||
      (orderEntry.command.quoteSnapshot.acceptedQuote?.cartVersion !== undefined &&
        orderEntry.command.quoteSnapshot.acceptedQuote.cartVersion !== serverCart?.version))
  )
    recoverOrder.current = true;
  const creditEntry = useSyncExternalStore(
      customerCreditCheckoutQuoteJournal.subscribe,
      () => customerCreditCheckoutQuoteJournal.snapshot(owner),
      () => null,
    ),
    creditOwner = useRef<string | null>(null),
    recoverCredit = useRef(false);
  if (creditOwner.current !== owner) {
    creditOwner.current = owner;
    recoverCredit.current = !!creditEntry;
  }
  if (!creditEntry) recoverCredit.current = false;
  if (
    creditEntry &&
    (creditEntry.state === 'unknown' ||
      !purchaseMethods.some(
        (method) => method.enabled && method.id === creditEntry.command.body.methodId,
      ) ||
      creditEntry.command.locale !== locale ||
      creditEntry.command.body.cartVersion !== serverCart?.version)
  )
    recoverCredit.current = true;
  if (owner && orderEntry && recoverOrder.current)
    return (
      <div className="container checkout-page">
        <section className="card-panel">
          <CreditOrderForm quote={null} recoveryOnly onCreated={retry} />
        </section>
      </div>
    );
  if (owner && creditEntry && recoverCredit.current)
    return (
      <div className="container checkout-page">
        <CreditCheckoutQuotePanel
          cartVersion={serverCart?.version ?? null}
          methodId={null}
          planId={null}
          disabled
          recoveryOnly
        />
      </div>
    );
  if (owner && readOrderV2Attempt(owner))
    return (
      <div className="container checkout-page">
        <OrderV2Form
          key={`${locale}:${owner}`}
          quote={null}
          onCreated={retry}
          onInvalidated={retry}
        />
      </div>
    );
  if (owner && readQuoteV5Attempt(owner))
    return (
      <div className="container checkout-page">
        <AcceptedOrderPreparation
          key={`${locale}:${owner}`}
          cartVersion={serverCart?.version ?? null}
          methodId={null}
          planId={null}
          disabled
        />
      </div>
    );
  return serverCart?.offerLines.length ? (
    <AcceptedQuoteReview key={`${locale}:${auth.status}:${auth.session?.user.id ?? ''}`} />
  ) : (
    <QuoteReview key={`${locale}:${auth.status}:${auth.session?.user.id ?? ''}`} />
  );
}
function QuoteReview() {
  const { locale, digits, toman, t } = useI18n();
  const { purchaseMethods } = useStorefront();
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const { serverCart, ready, cartIssue, cartBusy, retry } = useShop();
  const auth = useCustomerSession();
  const creditOwner = auth.status === 'member' ? auth.session!.user.id : null,
    creditEntry = useSyncExternalStore(
      customerCreditCheckoutQuoteJournal.subscribe,
      () => customerCreditCheckoutQuoteJournal.snapshot(creditOwner),
      () => null,
    ),
    orderEntry = useSyncExternalStore(
      customerCreditOrderJournal.subscribe,
      () => customerCreditOrderJournal.snapshot(creditOwner),
      () => null,
    ),
    orderUnresolved = orderEntry?.state === 'pending' || orderEntry?.state === 'unknown',
    creditUnresolved =
      orderUnresolved || creditEntry?.state === 'pending' || creditEntry?.state === 'unknown';
  const [attempt, setAttempt] = useState(0);
  const [overview, setOverview] = useState<{
    cart: ServerCart;
    data: CheckoutQuote | null;
    failed: boolean;
  } | null>(null);
  const [methodId, setMethodId] = useState(''),
    [planId, setPlanId] = useState('');
  const [saved, setSaved] = useState<{
      cart: ServerCart;
      choice: string;
      data: CheckoutQuote;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [now, setNow] = useState(0);
  const pending = useRef<{ choice: string; requestId: string } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    const ticket = ++generation.current;
    controller.current?.abort();
    setSaved(null);
    setError(null);
    setBusy(false);
    pending.current = null;
    if (
      !ready ||
      cartIssue ||
      cartBusy ||
      serverCart?.offerLines.length ||
      !serverCart?.ordinaryLines.length
    )
      return;
    const abort = new AbortController();
    setOverview({ cart: serverCart, data: null, failed: false });
    void requestQuote(
      auth.store.fetch,
      locale,
      { cartVersion: serverCart.version!, methodId: null, planId: null, requestId: null },
      abort.signal,
    )
      .then((data) => {
        if (ticket === generation.current && !abort.signal.aborted)
          setOverview({ cart: serverCart, data, failed: false });
      })
      .catch(() => {
        if (ticket === generation.current && !abort.signal.aborted)
          setOverview({ cart: serverCart, data: null, failed: true });
      });
    return () => {
      abort.abort();
      controller.current?.abort();
      advanceRequestGeneration(generation);
    };
  }, [serverCart, ready, cartIssue, cartBusy, locale, auth.store, attempt]);
  useEffect(() => {
    if (!saved) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [saved]);
  const data = overview?.cart === serverCart ? overview.data : null;
  const failed = overview?.cart === serverCart && overview.failed;
  const currentMethods =
    data?.methods.filter((method) =>
      purchaseMethods.some((current) => current.enabled && current.id === method.id),
    ) ?? [];
  const method = currentMethods.find((m) => m.id === methodId) ?? currentMethods[0];
  const plan =
    method?.kind === 'cheque'
      ? (data?.plans.find((p) => p.id === planId) ?? data?.plans[0])
      : undefined;
  const choice = `${serverCart?.version}:${method?.id ?? ''}:${plan?.id ?? ''}`;
  const calculation =
    method && saved?.cart === serverCart && saved.choice === choice ? saved.data : null;
  const expired = calculation ? quoteExpired(calculation, now || Date.now()) : false;
  const display = calculation ?? data;
  const waitingForPlan = method?.kind === 'cheque' && !calculation;
  const pendingTax =
    waitingForPlan &&
    (display?.chargeRules?.taxMode === 'inclusive' ||
      display?.chargeRules?.taxMode === 'exclusive');
  function changeMethod(id: string) {
    setMethodId(id);
    setSaved(null);
    setError(null);
    pending.current = null;
  }
  function changePlan(id: string) {
    setPlanId(id);
    setSaved(null);
    setError(null);
    pending.current = null;
  }
  async function calculate() {
    if (
      !data ||
      !serverCart?.version ||
      serverCart.offerLines.length ||
      !method ||
      creditUnresolved ||
      busy ||
      cartBusy ||
      cartIssue ||
      !ready
    )
      return;
    if (!pending.current || pending.current.choice !== choice || calculation)
      pending.current = { choice, requestId: crypto.randomUUID() };
    const ticket = generation.current;
    const abort = new AbortController();
    controller.current = abort;
    setSaved(null);
    setBusy(true);
    setError(null);
    try {
      const result = await requestQuote(
        auth.store.fetch,
        locale,
        {
          cartVersion: serverCart.version,
          methodId: method.id,
          planId: plan?.id ?? null,
          requestId: pending.current.requestId,
        },
        abort.signal,
      );
      if (ticket === generation.current && !abort.signal.aborted) {
        setSaved({ cart: serverCart, choice, data: result });
        setNow(Date.now());
      }
    } catch (e) {
      if (ticket === generation.current && !abort.signal.aborted) {
        setError(
          e instanceof CartError && e.status === 409
            ? 'conflict'
            : e instanceof CartError && e.code === 'cheque_amount_too_small'
              ? 'small'
              : 'unavailable',
        );
      }
    } finally {
      if (ticket === generation.current && !abort.signal.aborted) setBusy(false);
    }
  }
  const amount = (value: string | null | undefined) =>
    value === null || value === undefined
      ? text('هنوز تعیین نشده', 'Not configured')
      : toman(BigInt(value)) + ' ' + t('تومان');
  return (
    <div className="container checkout-page server-quote">
      <div className="page-top">
        <div className="breadcrumbs">
          <Link href="/">{t('سایمان')}</Link>
          <ChevronLeft />
          <Link href="/cart">{t('سبد خرید')}</Link>
          <ChevronLeft />
          <span>{text('بررسی مبلغ و روش خرید', 'Review amounts and purchase method')}</span>
        </div>
        <div className="checkout-steps">
          <span className="done">
            <Check size={14} />
            {t('سبد خرید')}
          </span>
          <i />
          <span className="active">{text('بررسی خرید', 'Purchase review')}</span>
          <i />
          <span>{text('ثبت سفارش', 'Place order')}</span>
        </div>
        <div className="page-title-row">
          <div>
            <span className="eyebrow">
              {text('شرایط معتبر برای تمام اقلام سبد', 'Conditions for every item in your cart')}
            </span>
            <h1>{text('بررسی خرید', 'Purchase review')}</h1>
          </div>
        </div>
      </div>
      {!ready || cartBusy ? (
        <div
          className="skeleton skeleton-card"
          role="status"
          aria-label={text('در حال بررسی سبد', 'Checking your cart')}
        />
      ) : serverCart?.offerLines.length ? (
        <div className="card-panel empty-state">
          <h2>
            {text(
              'خرید اقلام پیشنهادی هنوز فعال نشده است',
              'Accepted-offer checkout is not available yet',
            )}
          </h2>
          <p>
            {text(
              'اقلام با شرایط پذیرفته‌شده در سبد محفوظ‌اند. این مرحله محاسبه یا سفارش این اقلام را ایجاد نمی‌کند.',
              'Your accepted items remain in the cart. This stage creates no quote or order for them.',
            )}
          </p>
          <Button asChild>
            <Link href="/cart">{t('سبد خرید')}</Link>
          </Button>
        </div>
      ) : cartIssue ? (
        <div className="card-panel empty-state">
          <h2>{text('سبد به بازبینی نیاز دارد', 'Your cart needs review')}</h2>
          <p>
            {text('موجودی و ارتباط سبد را بررسی کنید.', 'Check stock and the cart connection.')}
          </p>
          <Button asChild>
            <Link href="/cart">{t('سبد خرید')}</Link>
          </Button>
        </div>
      ) : !serverCart?.ordinaryLines.length ? (
        <div className="card-panel empty-state">
          <h2>{text('سبد خرید خالی است', 'Your cart is empty')}</h2>
          <Button asChild>
            <Link href="/catalog">{text('انتخاب محصول', 'Browse products')}</Link>
          </Button>
        </div>
      ) : failed ? (
        <div className="card-panel empty-state" role="alert">
          <h2>{text('بررسی شرایط خرید انجام نشد', 'Purchase conditions could not be checked')}</h2>
          <p>
            {text(
              'برای دریافت مبلغ و روش‌های مجاز دوباره تلاش کنید.',
              'Try again to retrieve current amounts and eligible methods.',
            )}
          </p>
          <Button onClick={() => setAttempt((n) => n + 1)}>
            <RefreshCw size={16} />
            {t('تلاش دوباره')}
          </Button>
        </div>
      ) : !data ? (
        <div
          className="skeleton skeleton-card"
          role="status"
          aria-label={text('در حال دریافت شرایط خرید', 'Loading purchase conditions')}
        />
      ) : (
        <>
          <div className="notice checkout-notice">
            <Info size={18} />
            <p>
              {text(
                'قیمت و شرایط از سرور بررسی می‌شوند. ثبت سفارش موقت فقط با فعال‌سازی فروشگاه و شرایط معتبر ممکن است. پرداخت تا اتصال درگاه در دسترس نیست.',
                'Prices and conditions are checked by the server. Temporary orders require store activation and valid conditions. Payment is unavailable until a gateway is connected.',
              )}
            </p>
          </div>
          <div className="checkout-layout">
            <div className="checkout-sections">
              <section className="card-panel">
                <h2>
                  <CreditCard size={20} />
                  {text('روش خرید', 'Purchase method')}
                </h2>
                <div
                  className="payment-options"
                  role="radiogroup"
                  aria-label={text('روش خرید', 'Purchase method')}
                >
                  {currentMethods.map((m) => (
                    <label
                      key={m.id}
                      className={`payment-option${method?.id === m.id ? ' active' : ''}`}
                    >
                      <input
                        type="radio"
                        name="purchase-method"
                        checked={method?.id === m.id}
                        onChange={() => changeMethod(m.id)}
                        disabled={busy || creditUnresolved}
                      />
                      {m.kind === 'cheque' ? <CreditCard size={23} /> : <WalletCards size={23} />}
                      <span>
                        <strong>{m.name}</strong>
                        <small>{m.description}</small>
                      </span>
                    </label>
                  ))}
                  {!currentMethods.length && (
                    <p className="notice">
                      {text(
                        'روش خرید مشترکی برای تمام اقلام موجود نیست؛ سبد را بازبینی کنید.',
                        'No purchase method covers every item. Review your cart.',
                      )}
                    </p>
                  )}
                </div>
                {method?.kind === 'cheque' && (
                  <div className="checkout-cheque">
                    <label htmlFor="server-cheque-plan">
                      {text('طرح بازپرداخت', 'Repayment plan')}
                    </label>
                    <select
                      id="server-cheque-plan"
                      className="control-input"
                      value={plan?.id ?? ''}
                      onChange={(e) => changePlan(e.target.value)}
                      disabled={busy || creditUnresolved}
                    >
                      {data.plans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} · {digits(p.months)} {text('ماه', 'months')}
                        </option>
                      ))}
                    </select>
                    {plan && (
                      <p className="small-note">
                        {text('پیش‌پرداخت', 'Down payment')}{' '}
                        {digits(plan.downPaymentBasisPoints / 100)}
                        {text('٪', '%')} ·{' '}
                        {text('افزودهٔ کل به مانده', 'Total markup on the financed balance')}{' '}
                        {digits(plan.markupBasisPoints / 100)}
                        {text('٪', '%')} · {text('فاصلهٔ چک‌ها', 'Cheque interval')}{' '}
                        {digits(plan.intervalMonths)}{' '}
                        {text('ماه', plan.intervalMonths === 1 ? 'month' : 'months')}
                      </p>
                    )}
                  </div>
                )}
                {method?.kind === 'installment' && (
                  <p className="notice">
                    {text(
                      'سرویس اقساط هنوز پیکربندی نشده است؛ مبلغ بازپرداخت اقساطی پس از دریافت شرایط ارائه‌دهنده مشخص می‌شود.',
                      'The installment service is not configured. Repayment amounts depend on the provider’s terms.',
                    )}
                  </p>
                )}
                {method?.kind !== 'cheque' && (
                  <Button type="button" onClick={() => void calculate()} disabled={busy || !method}>
                    {busy
                      ? text('در حال محاسبه…', 'Calculating…')
                      : calculation && !expired
                        ? text('بررسی دوبارهٔ مبلغ', 'Check amounts again')
                        : text('محاسبهٔ مبلغ و شرایط', 'Calculate amounts and conditions')}
                  </Button>
                )}
                {error && (
                  <div className="notice" role="alert">
                    <p>
                      {error === 'conflict'
                        ? text(
                            'سبد یا شرایط تغییر کرده است. ابتدا اطلاعات تازه را دریافت کنید.',
                            'Your cart or its conditions changed. Load the latest details first.',
                          )
                        : error === 'small'
                          ? text(
                              'مبلغ برای تعداد چک‌های این طرح کافی نیست؛ طرح یا روش دیگری انتخاب کنید.',
                              'This amount is too small for the number of cheques. Select another plan or method.',
                            )
                          : text(
                              'پاسخ محاسبه دریافت نشد. تلاش دوباره با همان درخواست انجام می‌شود.',
                              'The calculation response was not received. Retrying will use the same request.',
                            )}{' '}
                      {error === 'conflict' && (
                        <button
                          type="button"
                          onClick={() => {
                            retry();
                            setAttempt((n) => n + 1);
                          }}
                        >
                          {text('دریافت اطلاعات تازه', 'Load latest details')}
                        </button>
                      )}
                    </p>
                  </div>
                )}
              </section>
              <DeliveryDetails quote={display!} />
              {calculation && (
                <section className="card-panel" aria-live="polite">
                  <h2>{text('نتیجهٔ محاسبهٔ سرور', 'Server calculation')}</h2>
                  <p className="small-note">
                    {text(
                      'این محاسبه رزرو موجودی یا تضمین قیمت نیست. هنگام ثبت سفارش دوباره بررسی می‌شود.',
                      'This calculation does not reserve stock or guarantee a price. It will be checked again when placing an order.',
                    )}
                  </p>
                  {expired ? (
                    <p className="notice" role="status">
                      {text(
                        'مهلت محاسبه تمام شده است؛ برای ادامه دوباره محاسبه کنید.',
                        'This calculation has expired. Calculate again to continue.',
                      )}
                    </p>
                  ) : (
                    <p className="small-note">
                      {text('مهلت این محاسبه تا', 'Calculation expires at')}{' '}
                      {new Date(calculation.expiresAt!).toLocaleTimeString(
                        locale === 'fa' ? 'fa-IR' : 'en-GB',
                        { hour: '2-digit', minute: '2-digit' },
                      )}
                    </p>
                  )}
                  {calculation.selectedMethod?.kind === 'cheque' && (
                    <>
                      <div className="info-row">
                        <span>{text('پیش‌پرداخت', 'Down payment')}</span>
                        <strong>{amount(calculation.downPaymentRial)}</strong>
                      </div>
                      <div className="info-row">
                        <span>{text('افزودهٔ کل', 'Total markup')}</span>
                        <strong>{amount(calculation.markupRial)}</strong>
                      </div>
                      {calculation.installments.map((i) => (
                        <div className="info-row" key={i.sequence}>
                          <span>
                            {text('چک', 'Cheque')} {digits(i.sequence)} · {text('ماه', 'Month')}{' '}
                            {digits(i.monthOffset)}
                          </span>
                          <strong>{amount(i.amountRial)}</strong>
                        </div>
                      ))}
                      <p className="small-note">
                        {text(
                          'چک‌های بالا فقط مبلغ کالا و افزودهٔ طرح را پوشش می‌دهند. نحوهٔ پرداخت هزینه‌های جداگانه در مرحلهٔ سفارش تعیین می‌شود.',
                          'The cheques above cover goods and plan markup. Payment of separate charges will be specified at the order stage.',
                        )}
                      </p>
                      <p className="small-note">
                        {text(
                          'خرید چکی نیازمند بررسی و تأیید است. سررسید دقیق پس از تعیین تاریخ و سیاست فروش مشخص می‌شود.',
                          'Cheque purchases require review and approval. Exact due dates depend on the order date and sales policy.',
                        )}
                      </p>
                    </>
                  )}
                </section>
              )}
              {method?.kind === 'cheque' ? (
                <CreditCheckoutQuotePanel
                  cartVersion={serverCart?.version ?? null}
                  methodId={method.id}
                  planId={plan?.id ?? null}
                  disabled={busy || cartBusy || cartIssue || !ready || orderUnresolved}
                />
              ) : (
                <TemporaryOrderForm quote={calculation} expired={expired} onCreated={retry} />
              )}
            </div>
            {method?.kind !== 'cheque' && (
              <aside className="card-panel order-summary">
                <h2>{t('خلاصهٔ سبد')}</h2>
                {display!.lines.map((l) => (
                  <div className="info-row" key={l.variantId}>
                    <span>
                      {l.name} · {l.label}
                      <small> × {digits(l.quantity)}</small>
                      <UsedConditionReport condition={l.usedCondition} locale={locale} />
                    </span>
                    <strong>{amount(l.lineTotalRial)}</strong>
                  </div>
                ))}
                <div className="rule" />
                <div className="info-row">
                  <span>{t('جمع کالاها')}</span>
                  <strong>{amount(display!.itemsSubtotalRial)}</strong>
                </div>
                {calculation && (
                  <div className="info-row">
                    <span>{text('کالاها با افزودهٔ طرح', 'Goods including plan markup')}</span>
                    <strong>{amount(calculation.goodsTotalRial)}</strong>
                  </div>
                )}
                <div className="info-row">
                  <span>{t('هزینهٔ ارسال')}</span>
                  <span>{amount(display!.shippingRial)}</span>
                </div>
                <div className="info-row">
                  <span>
                    {display!.chargeRules?.taxIncluded
                      ? text('مالیاتِ داخل قیمت', 'Tax included in price')
                      : t('مالیات')}
                  </span>
                  <span>
                    {pendingTax
                      ? text('پس از محاسبهٔ طرح', 'Calculate the selected plan')
                      : amount(display!.taxRial)}
                  </span>
                </div>
                <div className="rule" />
                <div className="info-row">
                  <span>{text('مبلغ نهایی قابل پرداخت', 'Final payable amount')}</span>
                  <strong>
                    {method?.kind === 'installment'
                      ? text('پس از اعلام شرایط ارائه‌دهنده', 'Awaiting provider terms')
                      : waitingForPlan
                        ? text('پس از محاسبهٔ طرح', 'Calculate the selected plan')
                        : amount(display!.payableTotalRial)}
                  </strong>
                </div>
                <p className="small-note">
                  {text(
                    'ثبت سفارش موقت از فرم اطلاعات سفارش انجام می‌شود؛ پرداخت هنوز در دسترس نیست.',
                    'Use the order details form to create a temporary order. Payment is not available yet.',
                  )}
                </p>
                <Link className="text-link cart-continue" href="/cart">
                  {text('بازگشت به سبد', 'Back to cart')}
                  <ArrowLeft size={16} />
                </Link>
              </aside>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function DeliveryDetails({ quote }: { quote: CheckoutQuote }) {
  const { locale, digits } = useI18n();
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const rules = quote.chargeRules;
  const basis =
    rules?.taxBase === 'items'
      ? text('جمع اصل کالاها', 'the items subtotal')
      : rules?.taxBase === 'goods_shipping'
        ? text('کالاها، افزودهٔ طرح و ارسال', 'goods, plan markup and shipping')
        : text('کالاها و افزودهٔ طرح', 'goods and plan markup');
  return (
    <section className="card-panel delivery-panel">
      <h2>
        <Package size={20} />
        {text('تحویل و هزینه‌ها', 'Delivery and charges')}
      </h2>
      <p>
        {!quote.shippingRequired
          ? text(
              'این سبد فقط کالای دیجیتال دارد و ارسال فیزیکی لازم ندارد.',
              'This cart contains only digital goods and needs no physical shipping.',
            )
          : !rules || rules.shippingMode === 'unconfigured'
            ? text(
                'روش، هزینه و زمان ارسال هنوز تعیین نشده‌اند.',
                'Shipping method, cost and delivery time are not configured yet.',
              )
            : rules.shippingName}
      </p>
      {quote.shippingRequired && rules?.shippingMode !== 'unconfigured' && (
        <>
          <p>{rules?.shippingDescription}</p>
          {rules?.shippingReason === 'threshold' && (
            <p>
              {text(
                'این سبد به آستانهٔ ارسال رایگان فروشگاه رسیده است.',
                'This cart qualifies for the store’s free delivery threshold.',
              )}
            </p>
          )}
        </>
      )}
      <p>
        {!rules || rules.taxMode === 'unconfigured'
          ? text(
              'مالیات هنوز تعیین نشده است؛ مبلغ نهایی پس از تعیین هزینه‌ها مشخص می‌شود.',
              'Tax is not configured yet; the final amount depends on the charge settings.',
            )
          : rules.taxMode === 'exempt'
            ? text(
                'طبق تنظیم فعلی فروشگاه، مالیات جداگانه‌ای به این خرید افزوده نمی‌شود.',
                'Under the store’s current settings, no separate tax is added.',
              )
            : text('مالیات با نرخ ', 'Tax at ') +
              digits(rules.taxRateBasisPoints! / 100) +
              (locale === 'fa' ? '٪' : '%') +
              text(' بر اساس ', ' is calculated on ') +
              basis +
              (rules.taxIncluded
                ? text(
                    ' از داخل قیمت استخراج می‌شود و دوباره اضافه نمی‌شود.',
                    '. It is included in the price and is not added again.',
                  )
                : text(' به مبلغ اضافه می‌شود.', ' and added to the amount.'))}
      </p>
    </section>
  );
}
