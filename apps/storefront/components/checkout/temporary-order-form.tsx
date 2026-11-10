'use client';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useCustomerSession } from '../auth/auth-provider';
import { useI18n } from '../navigation/locale-provider';
import Link, { useRouter } from '../navigation/localized-link';
import { Button } from '../shared/ui';
import { SavedAddressPicker } from '../address/saved-address-picker';
import { useShop } from '../providers/shop-context';
import { addressOrderFields } from '@/lib/address/address-contract';
import { createOrder } from '@/lib/orders/order-client';
import { CartError, isCartReviewConflict } from '@/lib/checkout/cart-client';
import {
  digitalOrderCapacityMessage,
  physicalOrderCapacityMessage,
  isPhysicalOrderCapacityError,
  isDigitalOrderCapacityError,
  isDigitalMetadataCapacityError,
} from '@/lib/orders/order-capacity-message';
import {
  normalizeOrderDigits,
  normalizeOrderPhone,
  validateOrderForm,
  type OrderFormValues,
} from '@sayman/web-shared/lib/orders/order-form.ts';
import type { OrderInput } from '@sayman/web-shared/lib/orders/order-contract.ts';
import type { CheckoutQuote } from '@sayman/web-shared/lib/checkout/quote-contract.ts';

export function TemporaryOrderForm({
  quote,
  expired,
  onCreated,
}: {
  quote: CheckoutQuote | null;
  expired: boolean;
  onCreated: () => void;
}) {
  const { locale, digits } = useI18n();
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const auth = useCustomerSession();
  const shop = useShop();
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [uncertain, setUncertain] = useState(false),
    [reviewQuoteId, setReviewQuoteId] = useState<string | null>(null);
  const needsCartReview = reviewQuoteId !== null && quote?.quoteId === reviewQuoteId;
  const pending = useRef<OrderInput | null>(null);
  const submittedMinutes = useRef<number | null>(null);
  const mounted = useRef(true);
  const abort = useRef<AbortController | null>(null);
  const {
    register,
    handleSubmit,
    setError: fieldError,
    clearErrors,
    setValue,
    formState: { errors },
  } = useForm<OrderFormValues>({
    defaultValues: {
      contactName: '',
      contactPhone: '',
      province: '',
      city: '',
      address: '',
      postalCode: '',
      note: '',
      acknowledgeTemporary: false,
    },
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
      pending.current = null;
    };
  }, []);
  async function submit(values: OrderFormValues) {
    if (busy || needsCartReview || auth.status !== 'member' || shop.serverCart?.offerLines.length)
      return;
    clearErrors();
    setError('');
    if (!pending.current) {
      if (!quote?.quoteId || !quote.temporaryOrder?.canCreate || expired) return;
      const parsed = validateOrderForm(values, quote.shippingRequired);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const key = issue.path[0] as keyof OrderFormValues;
          fieldError(key, {
            type: 'validate',
            message: text(
              'این فیلد را کامل و صحیح وارد کنید.',
              'Complete this field with a valid value.',
            ),
          });
        }
        return;
      }
      const v = parsed.data;
      submittedMinutes.current = quote.temporaryOrder.reservationMinutes;
      pending.current = {
        quoteId: quote.quoteId,
        requestId: crypto.randomUUID(),
        contactName: v.contactName,
        contactPhone: normalizeOrderPhone(v.contactPhone),
        delivery: quote.shippingRequired
          ? {
              countryCode: 'IR',
              province: v.province.trim(),
              city: v.city.trim(),
              address: v.address.trim(),
              postalCode: normalizeOrderDigits(v.postalCode).replace(/ /g, ''),
            }
          : null,
        note: v.note.trim(),
        acknowledgeTemporary: true,
      };
    }
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const result = await createOrder(auth.store.fetch, pending.current, controller.signal);
      if (!mounted.current) return;
      pending.current = null;
      setUncertain(false);
      router.push(`/orders/${result.order.summary.id}`);
      onCreated();
    } catch (e) {
      if (!mounted.current || controller.signal.aborted) return;
      const status = e instanceof CartError ? e.status : 0;
      if (status >= 400 && status < 500) {
        if (isCartReviewConflict(e)) {
          setReviewQuoteId(pending.current?.quoteId ?? null);
          pending.current = null;
          setUncertain(false);
          return;
        }
        pending.current = null;
        setUncertain(false);
        setError(
          isDigitalMetadataCapacityError(e)
            ? 'metadata'
            : isDigitalOrderCapacityError(e)
              ? 'capacity'
              : isPhysicalOrderCapacityError(e)
                ? 'physical-capacity'
                : e instanceof CartError && e.code === 'open_order_limit_conflict'
                  ? 'open-limit'
                  : status === 409
                    ? 'conflict'
                    : status === 401
                      ? 'signin'
                      : status === 429
                        ? 'limited'
                        : 'invalid',
        );
      } else {
        setUncertain(true);
        setError('uncertain');
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const option = quote?.temporaryOrder;
  if (auth.status !== 'member')
    return (
      <section className="card-panel">
        <h2>{text('ثبت سفارش موقت', 'Temporary order')}</h2>
        <p>
          {text(
            'برای ثبت سفارش و رزرو موجودی وارد حساب شوید.',
            'Sign in to create an order and reserve stock.',
          )}
        </p>
        <Button asChild>
          <Link href="/account?returnTo=/checkout">
            {text('ورود و ادامه', 'Sign in and continue')}
          </Link>
        </Button>
      </section>
    );
  if (!option?.canCreate && !uncertain)
    return (
      <section className="card-panel">
        <h2>{text('ثبت سفارش موقت', 'Temporary order')}</h2>
        <p className="small-note">
          {!quote
            ? text('ابتدا مبلغ و شرایط را محاسبه کنید.', 'Calculate amounts and conditions first.')
            : option?.blockers.includes('temporary_orders_disabled')
              ? text(
                  'ثبت سفارش موقت هنوز از مدیریت فعال نشده است.',
                  'Temporary ordering has not been enabled by the store.',
                )
              : quote.selectedMethod?.kind !== 'online' || quote.requiresApproval
                ? text(
                    'گردش ثبت و تأیید این روش خرید هنوز آماده نیست.',
                    'The order and approval workflow for this method is not ready yet.',
                  )
                : text(
                    'برای ثبت سفارش، مبلغ نهایی و شرایط معتبر باید مشخص باشند.',
                    'A known final amount and valid conditions are required to create an order.',
                  )}
        </p>
        <Link href="/orders" className="text-link">
          {text('سفارش‌های من', 'My orders')}
        </Link>
      </section>
    );
  const physical = pending.current
    ? pending.current.delivery !== null
    : quote?.shippingRequired === true;
  const holdMinutes = pending.current ? submittedMinutes.current : option?.reservationMinutes;
  const fields: [keyof OrderFormValues, string, string, string?][] = [
    ['contactName', text('نام و نام خانوادگی', 'Full name'), 'name'],
    ['contactPhone', text('شمارهٔ همراه', 'Mobile number'), 'tel'],
    ...(physical
      ? ([
          ['province', text('استان', 'Province'), 'address-level1'],
          ['city', text('شهر', 'City'), 'address-level2'],
          ['postalCode', text('کد پستی ده‌رقمی', '10-digit postal code'), 'postal-code'],
        ] as [keyof OrderFormValues, string, string][])
      : []),
  ];
  return (
    <section className="card-panel temporary-order">
      <h2>{text('اطلاعات سفارش موقت', 'Temporary order details')}</h2>
      <div className="notice">
        <p>
          {text(
            'درگاه پرداخت هنوز متصل نیست. این درخواست فقط سفارش پرداخت‌نشده و رزرو موقت می‌سازد.',
            'The payment gateway is not connected. This creates an unpaid order and a temporary stock reservation only.',
          )}{' '}
          {text('مهلت رزرو از ثبت موفق:', 'Reservation after creation:')}{' '}
          {holdMinutes === null || holdMinutes === undefined ? '—' : digits(holdMinutes)}{' '}
          {text(
            'دقیقه؛ پس از پایان مهلت، موجودی آزاد می‌شود.',
            'minutes. Stock is released when the deadline passes.',
          )}
        </p>
      </div>
      <form id="temporary-order" onSubmit={handleSubmit(submit)} noValidate>
        <fieldset disabled={busy || uncertain} className="order-fieldset">
          {physical && (
            <SavedAddressPicker
              disabled={busy || uncertain}
              onUse={(address) => {
                if (busy || uncertain || pending.current) return;
                const fields = addressOrderFields(address);
                for (const key of Object.keys(fields) as (keyof typeof fields)[])
                  setValue(key, fields[key], { shouldDirty: true, shouldValidate: false });
                clearErrors(Object.keys(fields) as (keyof typeof fields)[]);
              }}
            />
          )}
          <div className="form-grid">
            {fields.map(([name, label, autocomplete]) => (
              <div className="field" key={name}>
                <label htmlFor={`order-${name}`}>{label}</label>
                <input
                  id={`order-${name}`}
                  autoComplete={autocomplete}
                  inputMode={
                    name === 'contactPhone' ? 'tel' : name === 'postalCode' ? 'numeric' : 'text'
                  }
                  maxLength={name === 'contactPhone' || name === 'postalCode' ? 64 : 100}
                  aria-invalid={!!errors[name]}
                  aria-describedby={errors[name] ? `error-${name}` : undefined}
                  {...register(name)}
                />
                {errors[name] && (
                  <small id={`error-${name}`} className="field-error">
                    {errors[name]?.message}
                  </small>
                )}
              </div>
            ))}
          </div>
          {physical && (
            <div className="field">
              <label htmlFor="order-address">
                {text('نشانی کامل در ایران', 'Full delivery address in Iran')}
              </label>
              <textarea
                id="order-address"
                autoComplete="street-address"
                rows={3}
                maxLength={2000}
                aria-invalid={!!errors.address}
                {...register('address')}
              />
              {errors.address && <small className="field-error">{errors.address.message}</small>}
            </div>
          )}
          <div className="field">
            <label htmlFor="order-note">
              {text('یادداشت سفارش (اختیاری)', 'Order note (optional)')}
            </label>
            <textarea id="order-note" maxLength={500} rows={2} {...register('note')} />
            {errors.note && <small className="field-error">{errors.note.message}</small>}
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              {...register('acknowledgeTemporary')}
              aria-invalid={!!errors.acknowledgeTemporary}
            />
            <span>
              {text(
                'می‌دانم سفارش پرداخت نشده است و رزرو پس از مهلت اعلام‌شده منقضی می‌شود.',
                'I understand that this order is unpaid and the reservation expires at the stated deadline.',
              )}
            </span>
          </label>
          {errors.acknowledgeTemporary && (
            <small className="field-error">{errors.acknowledgeTemporary.message}</small>
          )}
        </fieldset>
        {expired && !uncertain && (
          <p className="notice" role="status">
            {text(
              'مهلت محاسبه تمام شد؛ مبلغ را دوباره بررسی کنید.',
              'The calculation expired. Check amounts again.',
            )}
          </p>
        )}
        {needsCartReview && (
          <div className="notice" role="alert">
            <p>
              {text(
                'موجودی یا اقلام سبد هنگام ثبت سفارش تغییر کرد. سبد را بازبینی کنید و دوباره ادامه دهید.',
                'Stock or cart items changed while placing the order. Review your cart before continuing.',
              )}
            </p>
            <Link href="/cart" className="text-link">
              {text('بازبینی سبد خرید', 'Review cart')}
            </Link>
          </div>
        )}
        {error && (
          <div className="notice" role="alert">
            <p>
              {error === 'open-limit'
                ? text(
                    'سقف سفارش‌های باز شما تکمیل است. ابتدا سفارش‌های موقت باز خود را بررسی یا لغو کنید و سپس دوباره سفارش بدهید.',
                    'Your open-order limit is reached. Review or cancel existing temporary orders before placing another order.',
                  )
                : error === 'physical-capacity'
                  ? physicalOrderCapacityMessage(locale)
                  : error === 'capacity' || error === 'metadata'
                    ? digitalOrderCapacityMessage(locale, error)
                    : error === 'uncertain'
                      ? text(
                          'نتیجهٔ درخواست دریافت نشد. اطلاعات را نگه داشته‌ایم؛ تلاش دوباره دقیقاً همان درخواست را می‌فرستد. می‌توانید سفارش‌های خود را نیز بررسی کنید.',
                          'The result was not received. Your details are held in memory; retry sends the same request. You can also check your orders.',
                        )
                      : error === 'conflict'
                        ? text(
                            'سبد، مبلغ، موجودی یا شرایط تغییر کرده، یا این محاسبه قبلاً سفارش شده است. سفارش‌های خود را بررسی و سپس شرایط تازه را محاسبه کنید.',
                            'The cart, amount, stock or conditions changed, or this calculation already has an order. Check your orders, then calculate current conditions.',
                          )
                        : error === 'limited'
                          ? text(
                              'تعداد درخواست‌ها زیاد است؛ کمی بعد تلاش کنید.',
                              'Too many requests. Try again shortly.',
                            )
                          : error === 'signin'
                            ? text(
                                'برای ادامه دوباره وارد حساب شوید.',
                                'Sign in again to continue.',
                              )
                            : text(
                                'اطلاعات درخواست معتبر نیست؛ فیلدها و شرایط را بررسی کنید.',
                                'The request is invalid. Check the fields and conditions.',
                              )}
            </p>
            <Link href="/orders" className="text-link">
              {text('بررسی سفارش‌های من', 'Check my orders')}
            </Link>
          </div>
        )}
        <Button
          type="submit"
          disabled={busy || needsCartReview || (!uncertain && (!option?.canCreate || expired))}
        >
          {busy
            ? text('در حال ثبت…', 'Creating…')
            : uncertain
              ? text('تلاش دوباره با همان درخواست', 'Retry the same request')
              : text('ثبت سفارش موقت و رزرو', 'Create temporary order and reserve')}
        </Button>
      </form>
    </section>
  );
}
