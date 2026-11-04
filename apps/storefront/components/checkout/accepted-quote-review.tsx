'use client';
import { advanceRequestGeneration } from '@sayman/web-shared/lib/data/request-generation.ts';
import {
  hasPostpaidShipping,
  postpaidShippingAmountLabel,
  postpaidShippingNotice,
  hasUnitemizedTax,
  unitemizedTaxLabel,
  unitemizedTaxNotice,
} from '@sayman/web-shared/lib/checkout/checkout-shipping.ts';
import { customerCreditOrderJournal } from '@sayman/web-shared/lib/credit/credit-order-journal.ts';
import { CreditCheckoutQuotePanel } from '../credit/credit-checkout-quote-panel';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { customerCreditCheckoutQuoteJournal } from '../../lib/credit/credit-checkout-quote-journal';
import { ArrowLeft, ChevronLeft, CreditCard, Info, RefreshCw, WalletCards } from 'lucide-react';
import { useI18n, useStorefront } from '../navigation/locale-provider';
import { useCustomerSession } from '../auth/auth-provider';
import { useShop } from '../providers/shop-provider';
import Link from '../navigation/localized-link';
import { Button } from '../shared/ui';
import { AcceptedOrderPreparation } from './accepted-order-preparation';
import { CartError } from '@/lib/checkout/cart-client';
import {
  digitalOrderCapacityMessage,
  isDigitalOrderCapacityError,
  isDigitalMetadataCapacityError,
} from '@/lib/orders/order-capacity-message';
import { requestQuoteV4 } from '@/lib/checkout/quote-v4-client';
import {
  readQuoteV4Attempt,
  startQuoteV4Attempt,
  finishQuoteV4Attempt,
  failQuoteV4Attempt,
  type QuoteV4Attempt,
} from '@/lib/checkout/quote-v4-journal';
import type { CheckoutQuoteV4 } from '@/lib/checkout/quote-v4-contract';
import type { ServerCartV2 } from '@/lib/checkout/cart-v2-contract';

export function AcceptedQuoteReview() {
  const { purchaseMethods } = useStorefront();
  const { locale, digits, toman, t } = useI18n(),
    auth = useCustomerSession(),
    shop = useShop();
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const owner = auth.status === 'member' ? auth.session!.user.id : null,
    cart = shop.serverCart;
  const creditEntry = useSyncExternalStore(
      customerCreditCheckoutQuoteJournal.subscribe,
      () => customerCreditCheckoutQuoteJournal.snapshot(owner),
      () => null,
    ),
    orderEntry = useSyncExternalStore(
      customerCreditOrderJournal.subscribe,
      () => customerCreditOrderJournal.snapshot(owner),
      () => null,
    ),
    orderUnresolved = orderEntry?.state === 'pending' || orderEntry?.state === 'unknown',
    creditUnresolved =
      orderUnresolved || creditEntry?.state === 'pending' || creditEntry?.state === 'unknown';
  const [attempt, setAttempt] = useState(0),
    [overview, setOverview] = useState<{
      owner: string;
      cart: ServerCartV2;
      data: CheckoutQuoteV4 | null;
      failed: boolean;
      capacity?: boolean;
      metadata?: boolean;
    } | null>(null);
  const [methodId, setMethodId] = useState(''),
    [planId, setPlanId] = useState(''),
    [savedState, setSavedState] = useState<{ owner: string; data: CheckoutQuoteV4 } | null>(null);
  const [pendingState, setPendingState] = useState<{ owner: string; value: QuoteV4Attempt } | null>(
      () => {
        const value = owner ? readQuoteV4Attempt(owner) : null;
        return owner && value ? { owner, value } : null;
      },
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [now, setNow] = useState(0);
  const saved = owner && savedState?.owner === owner ? savedState.data : null,
    pending = owner && pendingState?.owner === owner ? pendingState.value : null;
  const setSaved = useCallback(
      (data: CheckoutQuoteV4 | null) => setSavedState(owner && data ? { owner, data } : null),
      [owner],
    ),
    setPending = useCallback(
      (value: QuoteV4Attempt | null) => setPendingState(owner && value ? { owner, value } : null),
      [owner],
    );
  const generation = useRef(0),
    controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const ticket = ++generation.current;
    controller.current?.abort();
    setSaved(null);
    setPending(owner ? readQuoteV4Attempt(owner) : null);
    setError('');
    setBusy(false);
    if (
      !owner ||
      !cart?.version ||
      !cart.offerLines.length ||
      !shop.ready ||
      shop.cartBusy ||
      shop.quoteReviewIssue
    )
      return;
    const abort = new AbortController();
    setOverview({ owner, cart, data: null, failed: false });
    void requestQuoteV4(
      auth.store.fetch,
      locale,
      { cartVersion: cart.version, methodId: null, planId: null, requestId: null },
      abort.signal,
    )
      .then((data) => {
        if (ticket === generation.current && !abort.signal.aborted)
          setOverview({ owner, cart, data, failed: false });
      })
      .catch((error) => {
        if (ticket === generation.current && !abort.signal.aborted)
          setOverview({
            owner,
            cart,
            data: null,
            failed: true,
            capacity: isDigitalOrderCapacityError(error),
            metadata: isDigitalMetadataCapacityError(error),
          });
      });
    return () => {
      advanceRequestGeneration(generation);
      abort.abort();
      controller.current?.abort();
    };
  }, [
    owner,
    cart,
    shop.ready,
    shop.cartBusy,
    shop.quoteReviewIssue,
    locale,
    auth.store,
    attempt,
    setSaved,
    setPending,
  ]);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const data = owner && overview?.owner === owner && overview.cart === cart ? overview.data : null,
    failed = !!owner && overview?.owner === owner && overview.cart === cart && overview.failed;
  const currentMethods =
    data?.methods.filter((method) =>
      purchaseMethods.some((current) => current.enabled && current.id === method.id),
    ) ?? [];
  const method = currentMethods.find((m) => m.id === methodId) ?? currentMethods[0],
    plan =
      method?.kind === 'cheque'
        ? (data?.plans.find((p) => p.id === planId) ?? data?.plans[0])
        : undefined;
  const calculation =
      method &&
      saved &&
      saved.cartVersion === cart?.version &&
      saved.selectedMethod?.id === method?.id &&
      saved.selectedPlan?.id === plan?.id
        ? saved
        : null,
    display = calculation ?? data;
  const expired = !!display && Date.parse(display.expiresAt) <= (now || Date.now()),
    awaitingPlan = method?.kind === 'cheque' && !calculation;
  const amount = (value: string | null) =>
    value === null
      ? text('هنوز تعیین نشده', 'Not configured')
      : toman(BigInt(value)) + ' ' + t('تومان');
  const deadline = (value: string) =>
    new Date(value).toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-GB', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  const active = () =>
    auth.store.snapshot().status === 'member' && auth.store.snapshot().session?.user.id === owner;
  async function calculate(recover = false) {
    if (!owner || busy || !active()) return;
    const existing = readQuoteV4Attempt(owner);
    if (
      !recover &&
      (!data ||
        !cart?.version ||
        !method ||
        shop.cartBusy ||
        shop.quoteReviewIssue ||
        !shop.ready ||
        existing)
    )
      return;
    const frozen = recover
      ? existing
      : startQuoteV4Attempt(owner, locale, {
          cartVersion: cart!.version!,
          methodId: method!.id,
          planId: plan?.id ?? null,
          requestId: crypto.randomUUID(),
        });
    if (!frozen) return;
    setPending(frozen);
    setBusy(true);
    setError('');
    const ticket = generation.current,
      abort = new AbortController();
    controller.current = abort;
    try {
      const result = await requestQuoteV4(
        auth.store.fetch,
        frozen.locale,
        frozen.input,
        abort.signal,
      );
      if (!active() || ticket !== generation.current || abort.signal.aborted) {
        failQuoteV4Attempt(owner, frozen.input.requestId!, 0);
        return;
      }
      if (!finishQuoteV4Attempt(owner, frozen.input.requestId!)) return;
      setPending(null);
      if (result.cartVersion !== cart?.version || result.locale !== locale) {
        setSaved(null);
        setError('recovered');
        setAttempt((n) => n + 1);
        return;
      }
      setMethodId(result.selectedMethod!.id);
      setPlanId(result.selectedPlan?.id ?? '');
      setSaved(result);
      setNow(Date.now());
    } catch (e) {
      const status = e instanceof CartError ? e.status : 0,
        uncertain = failQuoteV4Attempt(owner, frozen.input.requestId!, status);
      if (!active() || ticket !== generation.current || abort.signal.aborted) return;
      setPending(readQuoteV4Attempt(owner));
      setError(
        uncertain
          ? 'uncertain'
          : isDigitalMetadataCapacityError(e)
            ? 'metadata'
            : isDigitalOrderCapacityError(e)
              ? 'capacity'
              : e instanceof CartError && e.code === 'cheque_amount_too_small'
                ? 'small'
                : status === 409
                  ? 'conflict'
                  : status === 401
                    ? 'signin'
                    : 'unavailable',
      );
    } finally {
      if (active() && ticket === generation.current && !abort.signal.aborted) setBusy(false);
    }
  }
  function refresh() {
    shop.retry();
    setAttempt((n) => n + 1);
  }
  function abandon() {
    if (owner && pending) {
      finishQuoteV4Attempt(owner, pending.input.requestId!);
      setPending(null);
      setSaved(null);
      setError('');
      setAttempt((n) => n + 1);
    }
  }
  return (
    <div className="container checkout-page server-quote accepted-quote-review">
      <div className="page-top">
        <div className="breadcrumbs">
          <Link href="/">{t('سایمان')}</Link>
          <ChevronLeft />
          <Link href="/cart">{t('سبد خرید')}</Link>
          <ChevronLeft />
          <span>{text('مرور مبلغ و شرایط', 'Review amounts and conditions')}</span>
        </div>
        <div className="page-title-row">
          <div>
            <span className="eyebrow">
              {text('اقلام عادی و پیشنهادهای پذیرفته‌شده', 'Ordinary items and accepted offers')}
            </span>
            <h1>{text('مرور مبلغ و شرایط', 'Review amounts and conditions')}</h1>
          </div>
        </div>
      </div>
      {auth.status !== 'member' ? (
        <section className="card-panel empty-state">
          <h2>{text('ورود برای مرور پیشنهادهای شخصی', 'Sign in to review your offers')}</h2>
          <p>
            {text(
              'برای دیدن شرایط توافقی، حساب صاحب سبد باید تأیید شود.',
              'Verify the cart owner’s account to view agreed conditions.',
            )}
          </p>
          {auth.status === 'unavailable' ? (
            <Button onClick={() => void auth.store.restore()}>
              {text('بررسی دوبارهٔ حساب', 'Check account again')}
            </Button>
          ) : (
            <Button asChild>
              <Link href="/account?returnTo=/checkout">{text('ورود به حساب', 'Sign in')}</Link>
            </Button>
          )}
        </section>
      ) : (
        <>
          <div className="notice checkout-notice">
            <Info size={18} />
            <p>
              {text(
                'این بخش مبلغ و شرایط را محاسبه می‌کند. برای سفارش موقت، پایین صفحه پیش‌فاکتور مستقلی دریافت کنید؛ پرداخت هنوز در دسترس نیست. درخواست‌های تأمینِ بدون پیشنهاد در جمع مبلغ وارد نمی‌شوند.',
                'This review calculates amounts and conditions. Prepare a separate temporary order quote below; payment is not available. Sourcing inquiries without an accepted offer are excluded from totals.',
              )}
            </p>
          </div>
          {pending && (
            <section className="card-panel" aria-live="polite">
              <h2>
                {text(
                  'پاسخ یک محاسبه هنوز مشخص نیست',
                  'A calculation response is still unresolved',
                )}
              </h2>
              <p>
                {text(
                  'نتیجهٔ محاسبهٔ قبلی را دوباره بررسی کنید تا مبلغ و شرایط روشن شود.',
                  'Check the previous calculation again to recover its amounts and conditions.',
                )}
              </p>
              <Button onClick={() => void calculate(true)} disabled={busy || creditUnresolved}>
                {busy
                  ? text('در حال بازیابی…', 'Recovering…')
                  : text('بازیابی همان محاسبه', 'Recover the same calculation')}
              </Button>
              <button
                className="text-link"
                type="button"
                onClick={abandon}
                disabled={busy || creditUnresolved}
              >
                {text(
                  'کنارگذاشتن درخواست قبلی و شروع محاسبهٔ تازه',
                  'Discard the previous request and start a new calculation',
                )}
              </button>
              <p className="small-note">
                {text(
                  'کنارگذاشتن، پیش‌فاکتور احتمالی ذخیره‌شده را حذف نمی‌کند؛ هیچ سفارشی ایجاد نمی‌شود.',
                  'Discarding does not delete a calculation that may already be saved. No order is created.',
                )}
              </p>
            </section>
          )}
          {error && (
            <div className="notice" role="alert">
              <p>
                {error === 'capacity' || error === 'metadata'
                  ? digitalOrderCapacityMessage(locale, error)
                  : error === 'uncertain'
                    ? text(
                        'پاسخ دریافت نشد. درخواست قبلی برای بازیابی محفوظ است.',
                        'The response was not received. The original request is kept for recovery.',
                      )
                    : error === 'conflict'
                      ? text(
                          'سبد یا شرایط توافق تغییر کرده‌اند. اطلاعات تازه را دریافت کنید.',
                          'The cart or agreed conditions changed. Load the latest details.',
                        )
                      : error === 'small'
                        ? text(
                            'مبلغ برای تعداد چک‌های این طرح کافی نیست؛ طرح دیگری انتخاب کنید.',
                            'This amount is too small for this cheque plan. Select another plan.',
                          )
                        : error === 'recovered'
                          ? text(
                              'درخواست قبلی بازیابی شد. اکنون شرایط سبد و زبان فعلی را دوباره دریافت کنید.',
                              'The earlier request was recovered. Load the current cart and language again.',
                            )
                          : text(
                              'محاسبه در دسترس نیست. حساب و شرایط سبد را دوباره بررسی کنید.',
                              'Calculation is unavailable. Check your account and cart conditions again.',
                            )}
              </p>
              {!pending && (
                <button type="button" onClick={refresh}>
                  {text('دریافت اطلاعات تازه', 'Load latest details')}
                </button>
              )}
            </div>
          )}
          {!shop.ready || shop.cartBusy ? (
            <div
              className="skeleton skeleton-card"
              role="status"
              aria-label={text('در حال بررسی سبد', 'Checking cart')}
            />
          ) : shop.quoteReviewIssue || failed ? (
            <section className="card-panel empty-state" role="alert">
              <h2>{text('شرایط قابل محاسبه نیست', 'Conditions could not be calculated')}</h2>
              <p>
                {overview?.owner === owner &&
                overview.cart === cart &&
                (overview.capacity || overview.metadata)
                  ? digitalOrderCapacityMessage(locale, overview.metadata ? 'metadata' : 'capacity')
                  : text(
                      'پیشنهاد، مهلت یا موجودی ممکن است تغییر کرده باشد؛ ابتدا سبد را بازبینی کنید.',
                      'An offer, deadline or stock may have changed. Review your cart first.',
                    )}
              </p>
              <Button onClick={refresh}>
                <RefreshCw size={16} />
                {text('بررسی دوباره', 'Check again')}
              </Button>
              <Link className="text-link" href="/cart">
                {text('بازگشت به سبد', 'Back to cart')}
              </Link>
            </section>
          ) : !data ? (
            <div
              className="skeleton skeleton-card"
              role="status"
              aria-label={text('در حال دریافت شرایط', 'Loading conditions')}
            />
          ) : (
            <div className="checkout-layout">
              <div className="checkout-sections">
                <section className="card-panel">
                  <h2>
                    <CreditCard size={20} />
                    {text('روش خرید برای محاسبه', 'Purchase method for calculation')}
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
                          name="accepted-purchase-method"
                          checked={method?.id === m.id}
                          onChange={() => {
                            setMethodId(m.id);
                            setPlanId('');
                            setSaved(null);
                            setError('');
                          }}
                          disabled={busy || creditUnresolved || !!pending}
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
                          'روش خرید مشترکی برای همهٔ این اقلام موجود نیست.',
                          'No eligible purchase method covers every item.',
                        )}
                      </p>
                    )}
                  </div>
                  {method?.kind === 'cheque' && (
                    <div className="checkout-cheque">
                      <label htmlFor="accepted-cheque-plan">
                        {text('طرح بازپرداخت', 'Repayment plan')}
                      </label>
                      <select
                        id="accepted-cheque-plan"
                        className="control-input"
                        value={plan?.id ?? ''}
                        onChange={(e) => {
                          setPlanId(e.target.value);
                          setSaved(null);
                          setError('');
                        }}
                        disabled={busy || creditUnresolved || !!pending}
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
                          {digits(plan.intervalMonths)} {text('ماه', 'months')}
                        </p>
                      )}
                    </div>
                  )}
                  {method?.kind === 'installment' && (
                    <p className="notice">
                      {text(
                        'ارائه‌دهندهٔ اقساط هنوز پیکربندی نشده است.',
                        'The installment provider is not configured yet.',
                      )}
                    </p>
                  )}
                  <Button
                    onClick={() => void calculate()}
                    disabled={
                      busy ||
                      creditUnresolved ||
                      !!pending ||
                      !method ||
                      (method.kind === 'cheque' && !plan)
                    }
                  >
                    {busy
                      ? text('در حال محاسبه…', 'Calculating…')
                      : text('محاسبهٔ مبلغ و شرایط', 'Calculate amounts and conditions')}
                  </Button>
                </section>
                <section className="card-panel">
                  <h2>{text('تحویل و هزینه‌ها', 'Delivery and charges')}</h2>
                  <p>
                    {display!.shippingRequired
                      ? display!.chargeRules.shippingMode === 'unconfigured'
                        ? text(
                            'روش، هزینه و زمان ارسال هنوز تعیین نشده‌اند.',
                            'Shipping method, cost and delivery time are not configured yet.',
                          )
                        : display!.chargeRules.shippingName
                      : text('ارسال فیزیکی لازم نیست.', 'Physical shipping is not required.')}
                  </p>
                  {display!.chargeRules.shippingDescription && (
                    <p>{display!.chargeRules.shippingDescription}</p>
                  )}
                  {hasPostpaidShipping(display!) && (
                    <p className="notice">{postpaidShippingNotice(locale)}</p>
                  )}
                  <p>
                    {display!.chargeRules.taxMode === 'unconfigured'
                      ? text(
                          'مالیات هنوز تعیین نشده است. مبلغ نهایی تا تعیین هزینه‌ها نامشخص است.',
                          'Tax is not configured yet. The final amount depends on charge settings.',
                        )
                      : hasUnitemizedTax(display!)
                        ? unitemizedTaxNotice(locale)
                        : display!.chargeRules.taxMode === 'exempt'
                          ? text(
                              'طبق تنظیم فعلی فروشگاه، مالیات جداگانه افزوده نمی‌شود.',
                              'Under current store settings, no separate tax is added.',
                            )
                          : text('نرخ مالیات', 'Tax rate') +
                            ' ' +
                            digits(display!.chargeRules.taxRateBasisPoints! / 100) +
                            (locale === 'fa' ? '٪' : '%') +
                            (display!.chargeRules.taxIncluded
                              ? text(
                                  '؛ مالیات در قیمت لحاظ شده است.',
                                  '; tax is included in the price.',
                                )
                              : text(
                                  '؛ مالیات جداگانه افزوده می‌شود.',
                                  '; tax is added separately.',
                                ))}
                  </p>
                </section>
                {calculation && (
                  <section className="card-panel" aria-live="polite">
                    <h2>{text('محاسبهٔ ذخیره‌شده', 'Saved calculation')}</h2>
                    <p className="small-note">
                      {text(
                        'این محاسبه رزرو تازه یا تمدید مهلت پیشنهاد ایجاد نمی‌کند.',
                        'This calculation creates no new reservation and does not extend an offer deadline.',
                      )}
                    </p>
                    <p className={expired ? 'notice' : 'small-note'}>
                      {expired
                        ? text(
                            'مهلت محاسبه تمام شده است؛ دوباره شرایط را بررسی کنید.',
                            'This calculation has expired. Check conditions again.',
                          )
                        : text('مهلت محاسبه تا ', 'Calculation expires at ') +
                          deadline(calculation.expiresAt)}
                    </p>
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
                            'این مبالغ برای مرور شرایط‌اند؛ خرید چکی به بررسی و تأیید نیاز دارد و سررسید دقیق هنوز در این مرحله تعیین نمی‌شود.',
                            'These amounts are for reviewing conditions. Cheque purchases require approval, and exact due dates are not set at this stage.',
                          )}
                        </p>
                      </>
                    )}
                  </section>
                )}
                {method?.kind === 'cheque' ? (
                  <CreditCheckoutQuotePanel
                    cartVersion={cart?.version ?? null}
                    methodId={method.id}
                    planId={plan?.id ?? null}
                    disabled={
                      busy ||
                      creditUnresolved ||
                      !!pending ||
                      shop.cartBusy ||
                      shop.quoteReviewIssue ||
                      !shop.ready
                    }
                  />
                ) : (
                  <AcceptedOrderPreparation
                    cartVersion={cart?.version ?? null}
                    methodId={method?.id ?? null}
                    planId={plan?.id ?? null}
                    disabled={
                      busy ||
                      creditUnresolved ||
                      !!pending ||
                      shop.cartBusy ||
                      shop.quoteReviewIssue ||
                      !shop.ready
                    }
                  />
                )}
              </div>
              <aside className="card-panel order-summary">
                <h2>{text('خلاصهٔ محاسبه', 'Calculation summary')}</h2>
                {display!.lines.map((l) => (
                  <div className="info-row" key={l.lineId}>
                    <span>
                      <small>
                        {l.lineKind === 'ordinary'
                          ? text('قیمت فعلی فروشگاه', 'Current store price')
                          : text('قیمت توافقی پذیرفته‌شده', 'Accepted agreed price')}
                      </small>
                      {l.name} · {l.label}
                      <small> × {digits(l.quantity)}</small>
                      {l.accepted && (
                        <small>
                          {text('مهلت سهم تأمین: ', 'Allocation deadline: ')}
                          {deadline(l.accepted.allocationExpiresAt)}
                        </small>
                      )}
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
                  <span>
                    {hasPostpaidShipping(display!)
                      ? postpaidShippingAmountLabel(locale)
                      : amount(display!.shippingRial)}
                  </span>
                </div>
                <div className="info-row">
                  <span>
                    {display!.chargeRules.taxIncluded
                      ? text('مالیات داخل قیمت', 'Tax included in price')
                      : t('مالیات')}
                  </span>
                  <span>
                    {hasUnitemizedTax(display!)
                      ? unitemizedTaxLabel(locale)
                      : awaitingPlan &&
                          (display!.chargeRules.taxMode === 'exclusive' ||
                            display!.chargeRules.taxMode === 'inclusive')
                        ? text('پس از محاسبهٔ طرح', 'Calculate the selected plan')
                        : amount(display!.taxRial)}
                  </span>
                </div>
                <div className="rule" />
                <div className="info-row">
                  <span>
                    {hasPostpaidShipping(display!)
                      ? text('جمع محاسبه‌شدهٔ فروشگاه', 'Calculated store total')
                      : text('جمع محاسبه‌شده', 'Calculated total')}
                  </span>
                  <strong>
                    {method?.kind === 'installment'
                      ? text('پس از اعلام شرایط ارائه‌دهنده', 'Awaiting provider terms')
                      : awaitingPlan
                        ? text('پس از محاسبهٔ طرح', 'Calculate the selected plan')
                        : amount(display!.payableTotalRial)}
                  </strong>
                </div>
                <p className="small-note">
                  {text(
                    'این مرور امکان ثبت سفارش یا پرداخت ندارد.',
                    'This review cannot create an order or payment.',
                  )}
                </p>
                <Link className="text-link cart-continue" href="/cart">
                  {text('بازگشت به سبد', 'Back to cart')}
                  <ArrowLeft size={16} />
                </Link>
              </aside>
            </div>
          )}
        </>
      )}
    </div>
  );
}
