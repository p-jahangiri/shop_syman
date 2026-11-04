'use client';
import { advanceRequestGeneration } from '@sayman/web-shared/lib/data/request-generation.ts';
import { UsedConditionReport } from '@sayman/web-shared/components/catalog/used-condition';
import {
  hasPostpaidShipping,
  postpaidShippingAmountLabel,
  postpaidShippingNotice,
  hasUnitemizedTax,
  unitemizedTaxLabel,
  unitemizedTaxNotice,
} from '@sayman/web-shared/lib/checkout/checkout-shipping.ts';
import { useEffect, useRef, useState } from 'react';
import { useCustomerSession } from '../auth/auth-provider';
import { useI18n } from '../navigation/locale-provider';
import { useShop } from '../providers/shop-provider';
import Link from '../navigation/localized-link';
import { Button } from '../shared/ui';
import { OrderV2Form } from '../orders/order-v2-form';
import { CartError } from '@/lib/checkout/cart-client';
import { requestQuoteV5 } from '@/lib/checkout/quote-v5-client';
import {
  readQuoteV5Attempt,
  startQuoteV5Attempt,
  finishQuoteV5Attempt,
  failQuoteV5Attempt,
  type QuoteV5Attempt,
} from '@/lib/checkout/quote-v5-journal';
import type { CheckoutQuoteV5 } from '@sayman/web-shared/lib/checkout/quote-v5-contract.ts';

export function AcceptedOrderPreparation({
  cartVersion,
  methodId,
  planId,
  disabled = false,
}: {
  cartVersion: string | null;
  methodId: string | null;
  planId: string | null;
  disabled?: boolean;
}) {
  const auth = useCustomerSession(),
    shop = useShop(),
    { locale, toman, t, digits } = useI18n();
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const owner = auth.status === 'member' ? auth.session!.user.id : null,
    choice = JSON.stringify([locale, cartVersion, methodId, planId]);
  const [prepared, setPrepared] = useState<{
      owner: string;
      choice: string;
      data: CheckoutQuoteV5;
    } | null>(null),
    [pending, setPending] = useState<QuoteV5Attempt | null>(() =>
      owner ? readQuoteV5Attempt(owner) : null,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [now, setNow] = useState(0);
  const generation = useRef(0),
    controller = useRef<AbortController | null>(null);
  const active = () =>
    !!owner &&
    auth.store.snapshot().status === 'member' &&
    auth.store.snapshot().session?.user.id === owner;
  useEffect(() => {
    advanceRequestGeneration(generation);
    controller.current?.abort();
    setPrepared(null);
    setPending(owner ? readQuoteV5Attempt(owner) : null);
    setBusy(false);
    setError('');
    return () => {
      advanceRequestGeneration(generation);
      controller.current?.abort();
    };
  }, [owner, choice]);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const quote =
    owner && prepared?.owner === owner && prepared.choice === choice ? prepared.data : null;
  const expired = !!quote && Date.parse(quote.expiresAt) <= (now || Date.now());
  const amount = (value: string | null) =>
    value === null
      ? text('هنوز تعیین نشده', 'Not configured')
      : toman(BigInt(value)) + ' ' + t('تومان');
  const deadline = (value: string) =>
    new Date(value).toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-GB', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  async function prepare(recover = false) {
    if (!owner || busy || !active()) return;
    const previous = readQuoteV5Attempt(owner);
    if (!recover && (disabled || !cartVersion || !methodId || previous)) return;
    const frozen = recover
      ? previous
      : startQuoteV5Attempt(owner, locale, {
          cartVersion: cartVersion!,
          methodId,
          planId,
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
      const result = await requestQuoteV5(
        auth.store.fetch,
        frozen.locale,
        frozen.input,
        abort.signal,
      );
      if (!active() || ticket !== generation.current || abort.signal.aborted) {
        failQuoteV5Attempt(owner, frozen.input.requestId!, 0);
        return;
      }
      if (!finishQuoteV5Attempt(owner, frozen.input.requestId!)) return;
      setPending(null);
      if (
        result.locale !== locale ||
        result.cartVersion !== cartVersion ||
        result.selectedMethod?.id !== methodId ||
        (result.selectedPlan?.id ?? null) !== planId
      ) {
        setPrepared(null);
        setError('recovered');
        shop.retry();
        return;
      }
      setPrepared({ owner, choice, data: result });
      setNow(Date.now());
    } catch (e) {
      const status = e instanceof CartError ? e.status : 0,
        uncertain = failQuoteV5Attempt(owner, frozen.input.requestId!, status);
      if (!active() || ticket !== generation.current || abort.signal.aborted) return;
      setPending(readQuoteV5Attempt(owner));
      setError(uncertain ? 'uncertain' : status === 409 ? 'conflict' : 'unavailable');
    } finally {
      if (active() && ticket === generation.current && !abort.signal.aborted) setBusy(false);
    }
  }
  function discard() {
    if (owner && pending && finishQuoteV5Attempt(owner, pending.input.requestId!)) {
      setPending(null);
      setPrepared(null);
      setError('');
      shop.retry();
    }
  }
  if (!owner) return null;
  const groups = quote
    ? [
        ...new Map(
          quote.lines.filter((l) => l.accepted).map((l) => [l.accepted!.agreementId, l.accepted!]),
        ).values(),
      ]
    : [];
  return (
    <section className="accepted-order-preparation">
      <section className="card-panel">
        <h2>{text('آماده‌سازی سفارش موقت', 'Prepare a temporary order')}</h2>
        <p>
          {text(
            'برای ثبت سفارش، پیش‌فاکتور تازه و مستقلی دریافت کنید. محاسبهٔ بالا به سفارش تبدیل نمی‌شود. این بررسی موجودی را رزرو و مهلت پیشنهاد را تمدید نمی‌کند.',
            'Prepare a separate current order quote. The calculation above is not converted into an order. This check reserves no stock and does not extend an offer deadline.',
          )}
        </p>
        {pending ? (
          <div className="notice" aria-live="polite">
            <p>
              {text(
                'پاسخ پیش‌فاکتور قبلی مشخص نیست؛ بازیابی دقیقاً همان درخواست را بررسی می‌کند.',
                'The previous order quote response is unresolved. Recovery checks exactly the same request.',
              )}
            </p>
            <Button disabled={busy} onClick={() => void prepare(true)}>
              {busy
                ? text('در حال بازیابی…', 'Recovering…')
                : text('بازیابی همان پیش‌فاکتور سفارش', 'Recover the same order quote')}
            </Button>
            <p>
              <button className="text-link" type="button" onClick={discard} disabled={busy}>
                {text(
                  'کنارگذاشتن پیش‌فاکتور و بررسی تازه',
                  'Discard quote attempt and check again',
                )}
              </button>
            </p>
            <p className="small-note">
              {text(
                'این درخواست فقط پیش‌فاکتور است و هیچ سفارشی ایجاد نمی‌کند.',
                'This request only prepares a quote and creates no order.',
              )}
            </p>
          </div>
        ) : (
          <Button
            disabled={busy || disabled || !cartVersion || !methodId}
            onClick={() => void prepare()}
          >
            {busy
              ? text('در حال بررسی…', 'Checking…')
              : text('دریافت شرایط ثبت سفارش موقت', 'Prepare temporary order conditions')}
          </Button>
        )}
        {error && (
          <p className="notice" role="alert">
            {error === 'uncertain'
              ? text(
                  'پاسخ دریافت نشد؛ شناسهٔ اصلی برای بازیابی محفوظ است.',
                  'The response was not received. The original id is retained for recovery.',
                )
              : error === 'recovered'
                ? text(
                    'پیش‌فاکتور قبلی بازیابی شد؛ برای سبد و انتخاب فعلی بررسی تازه انجام دهید.',
                    'The previous quote was recovered. Prepare current conditions for this cart and selection.',
                  )
                : error === 'conflict'
                  ? text(
                      'سبد، موجودی یا شرایط تغییر کرده است؛ ابتدا سبد را تازه کنید.',
                      'The cart, stock or conditions changed. Refresh the cart first.',
                    )
                  : text(
                      'شرایط ثبت سفارش دریافت نشد؛ حساب و ارتباط را بررسی کنید.',
                      'Order conditions were not received. Check your account and connection.',
                    )}
          </p>
        )}
        {quote && (
          <div aria-live="polite">
            <h3>{text('پیش‌فاکتور مستقل سفارش', 'Separate order quote')}</h3>
            <p className={expired ? 'notice' : 'small-note'}>
              {expired
                ? text('مهلت پیش‌فاکتور پایان یافته است.', 'The order quote has expired.')
                : text('مهلت بررسی تا ', 'Review deadline: ') + deadline(quote.expiresAt)}
            </p>
            {quote.lines.map((line) => (
              <div className="info-row" key={line.lineId}>
                <span>
                  {line.lineKind === 'acceptedOffer'
                    ? text('قیمت توافقی', 'Agreed price')
                    : text('قیمت فعلی فروشگاه', 'Current store price')}{' '}
                  · {line.name} · {line.label}
                  <small> × {digits(line.quantity)}</small>
                  <UsedConditionReport condition={line.usedCondition} locale={locale} />
                </span>
                <strong>{amount(line.lineTotalRial)}</strong>
              </div>
            ))}
            <div className="rule" />
            {[
              { label: text('جمع کالاها', 'Items'), value: amount(quote.itemsSubtotalRial) },
              {
                label: text('ارسال', 'Shipping'),
                value: hasPostpaidShipping(quote)
                  ? postpaidShippingAmountLabel(locale)
                  : amount(quote.shippingRial),
              },
              {
                label: quote.chargeRules.taxIncluded
                  ? text('مالیات داخل قیمت', 'Included tax')
                  : text('مالیات', 'Tax'),
                value: hasUnitemizedTax(quote) ? unitemizedTaxLabel(locale) : amount(quote.taxRial),
              },
              {
                label: hasPostpaidShipping(quote)
                  ? text('مبلغ سفارش نزد فروشگاه', 'Store order total')
                  : text('مبلغ نهایی سفارش', 'Order total'),
                value: amount(quote.payableTotalRial),
              },
            ].map(({ label, value }) => (
              <div className="info-row" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
            {hasPostpaidShipping(quote) && (
              <p className="notice">{postpaidShippingNotice(locale)}</p>
            )}
            {hasUnitemizedTax(quote) && <p className="small-note">{unitemizedTaxNotice(locale)}</p>}
            {groups.map((group) => (
              <div className="notice" key={group.agreementId}>
                <strong>
                  {text('شرایط پذیرفته‌شده · ویرایش ', 'Accepted terms · Revision ')}
                  {digits(group.revision)}
                </strong>
                {group.containsDemo && (
                  <p className="small-note">
                    {text('دادهٔ نمونهٔ محیط توسعه', 'Development sample data')}
                  </p>
                )}
                <p className="preserve-lines">{locale === 'fa' ? group.termsFa : group.termsEn}</p>
                <p className="small-note">
                  {text('مهلت سهم تأمین: ', 'Allocation deadline: ')}
                  {deadline(group.allocationExpiresAt)}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
      {quote && (
        <OrderV2Form
          key={`${owner}:${quote.quoteId}`}
          quote={quote}
          onCreated={shop.retry}
          onInvalidated={() => {
            setPrepared(null);
            setError('conflict');
          }}
        />
      )}
      <p className="small-note">
        <Link className="text-link" href="/orders">
          {text('بررسی سفارش‌های من', 'Check my orders')}
        </Link>
      </p>
    </section>
  );
}
