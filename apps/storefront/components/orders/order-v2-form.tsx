'use client';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useCustomerSession } from '../auth/auth-provider';
import { useI18n } from '../navigation/locale-provider';
import Link, { useRouter } from '../navigation/localized-link';
import { Button } from '../shared/ui';
import { SavedAddressPicker } from '../address/saved-address-picker';
import { addressOrderFields } from '@/lib/address/address-contract';
import { createOrderV2 } from '@/lib/orders/order-v2-client';
import {
  readOrderV2Attempt,
  startOrderV2Attempt,
  finishOrderV2Attempt,
  failOrderV2Attempt,
  type OrderV2Attempt,
} from '@/lib/orders/order-v2-journal';
import { CartError } from '@/lib/checkout/cart-client';
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
import type { CheckoutQuoteV5 } from '@sayman/web-shared/lib/checkout/quote-v5-contract.ts';

export function OrderV2Form({
  quote,
  onCreated,
  onInvalidated,
}: {
  quote: CheckoutQuoteV5 | null;
  onCreated: () => void;
  onInvalidated?: () => void;
}) {
  const { locale, digits } = useI18n(),
    auth = useCustomerSession(),
    router = useRouter();
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const owner = auth.status === 'member' ? auth.session!.user.id : null;
  const [pending, setPending] = useState<OrderV2Attempt | null>(() =>
      owner ? readOrderV2Attempt(owner) : null,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [now, setNow] = useState(0);
  const mounted = useRef(true),
    abort = useRef<AbortController | null>(null);
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
  const active = () =>
    !!owner &&
    auth.store.snapshot().status === 'member' &&
    auth.store.snapshot().session?.user.id === owner;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, []);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const expired = !!quote && Date.parse(quote.expiresAt) <= (now || Date.now());
  async function send(frozen: OrderV2Attempt) {
    if (!owner || busy || !active()) return;
    setPending(frozen);
    setBusy(true);
    setError('');
    const controller = new AbortController();
    abort.current = controller;
    try {
      const result = await createOrderV2(auth.store.fetch, frozen.input, controller.signal);
      if (!active() || !mounted.current || controller.signal.aborted) {
        failOrderV2Attempt(owner, frozen.input.requestId, 0);
        return;
      }
      if (!finishOrderV2Attempt(owner, frozen.input.requestId)) return;
      setPending(null);
      onCreated();
      router.push(`/orders/${result.order.summary.id}`);
    } catch (e) {
      const status = e instanceof CartError ? e.status : 0,
        uncertain = failOrderV2Attempt(owner, frozen.input.requestId, status);
      if (!active() || !mounted.current || controller.signal.aborted) return;
      setPending(readOrderV2Attempt(owner));
      setError(
        uncertain
          ? 'uncertain'
          : isDigitalMetadataCapacityError(e)
            ? 'metadata'
            : isDigitalOrderCapacityError(e)
              ? 'capacity'
              : isPhysicalOrderCapacityError(e)
                ? 'physical-capacity'
                : e instanceof CartError && e.code === 'open_order_limit_conflict'
                  ? 'open-limit'
                  : status === 409
                    ? 'conflict'
                    : status === 429
                      ? 'limited'
                      : 'invalid',
      );
      if (!uncertain) onInvalidated?.();
    } finally {
      if (active() && mounted.current && !controller.signal.aborted) setBusy(false);
    }
  }
  async function submit(values: OrderFormValues) {
    if (!owner || busy || !active()) return;
    const previous = readOrderV2Attempt(owner);
    if (previous) {
      await send(previous);
      return;
    }
    if (!quote?.quoteId || !quote.temporaryOrder.canCreate || expired) return;
    clearErrors();
    const parsed = validateOrderForm(values, quote.shippingRequired);
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        fieldError(issue.path[0] as keyof OrderFormValues, {
          type: 'validate',
          message: text(
            'این فیلد را کامل و صحیح وارد کنید.',
            'Complete this field with a valid value.',
          ),
        });
      return;
    }
    const v = parsed.data;
    const frozen = startOrderV2Attempt(
      owner,
      locale,
      {
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
      },
      quote.expiresAt,
      quote.temporaryOrder.reservationMinutes,
    );
    await send(frozen);
  }
  if (!owner) return null;
  if (pending)
    return (
      <section className="card-panel temporary-order" aria-live="polite">
        <h2>{text('بازیابی سفارش موقت', 'Recover temporary order')}</h2>
        <p>
          {text(
            'پاسخ سفارش هنوز مشخص نیست. درخواست با همان اطلاعات و شناسه در حافظهٔ همین صفحه محفوظ است؛ بازیابی، سفارش دیگری نمی‌سازد.',
            'The order response is unresolved. Its original details and request id are held in this page’s memory; recovery does not create another order.',
          )}
        </p>
        {error && (
          <p className="notice" role="alert">
            {text(
              'پاسخ قطعی دریافت نشد؛ درخواست اصلی برای تلاش دوباره محفوظ است.',
              'A definitive response was not received. The original request remains available for retry.',
            )}
          </p>
        )}
        <Button onClick={() => void send(pending)} disabled={busy}>
          {busy
            ? text('در حال بررسی…', 'Checking…')
            : text('بازیابی همان سفارش', 'Recover the same order')}
        </Button>
        <p>
          <Link className="text-link" href="/orders">
            {text('بررسی سفارش‌های من', 'Check my orders')}
          </Link>
        </p>
        <p className="small-note">
          {text(
            'خروج از حساب یا بستن کامل صفحه، اطلاعات نگهداری‌شده در حافظه را پاک می‌کند؛ سفارش احتمالی سرور حذف نمی‌شود.',
            'Signing out or closing this page clears the details held in memory; an order already saved on the server is not deleted.',
          )}
        </p>
      </section>
    );
  if (!quote?.temporaryOrder.canCreate)
    return (
      <section className="card-panel">
        <h2>{text('سفارش موقت اقلام توافقی', 'Temporary order for accepted items')}</h2>
        <p>
          {quote?.temporaryOrder.blockers.includes('temporary_orders_disabled')
            ? text(
                'ثبت سفارش موقت هنوز از مدیریت فعال نشده است.',
                'Temporary ordering has not been enabled by the store.',
              )
            : text(
                'برای ثبت سفارش، روش مجاز، مبلغ نهایی و تنظیمات معتبر باید مشخص باشند.',
                'An eligible method, known final amount and valid store settings are required to create an order.',
              )}
        </p>
        <Link className="text-link" href="/orders">
          {text('سفارش‌های من', 'My orders')}
        </Link>
      </section>
    );
  const physical = quote.shippingRequired;
  const fields: [keyof OrderFormValues, string, string][] = [
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
      <p className="notice">
        {text(
          'این درخواست فقط سفارش پرداخت‌نشده می‌سازد. سهم توافقی به رزرو سفارش منتقل می‌شود و اقلام عادی از موجودی آزاد رزرو می‌شوند؛ درخواست‌های تأمین از سبد حذف نمی‌شوند. پرداخت هنوز در دسترس نیست.',
          'This creates an unpaid order. Agreed allocations transfer to its reservation and ordinary items reserve free stock; sourcing inquiries remain in the cart. Payment is not available.',
        )}
      </p>
      <p className="small-note">
        {text('حداکثر مدت تنظیم‌شدهٔ رزرو: ', 'Configured reservation maximum: ')}
        {digits(quote.temporaryOrder.reservationMinutes)}{' '}
        {text(
          'دقیقه. مهلت حقوق توافقی موجودی، قیمت و پیش‌فاکتور می‌تواند رزرو را کوتاه کند؛ زمان دقیق پایان رزرو در سفارش ثبت‌شده نمایش داده می‌شود.',
          'minutes. Accepted stock, price and quoted terms can shorten the hold. The recorded order shows the exact reservation deadline.',
        )}
      </p>
      <form onSubmit={handleSubmit(submit)} noValidate>
        <fieldset disabled={busy} className="order-fieldset">
          {physical && (
            <SavedAddressPicker
              disabled={busy}
              onUse={(address) => {
                const values = addressOrderFields(address);
                for (const key of Object.keys(values) as (keyof typeof values)[])
                  setValue(key, values[key], { shouldDirty: true, shouldValidate: false });
                clearErrors(Object.keys(values) as (keyof typeof values)[]);
              }}
            />
          )}
          <div className="form-grid">
            {fields.map(([name, label, autocomplete]) => (
              <div className="field" key={name}>
                <label htmlFor={`order2-${name}`}>{label}</label>
                <input
                  id={`order2-${name}`}
                  autoComplete={autocomplete}
                  inputMode={
                    name === 'contactPhone' ? 'tel' : name === 'postalCode' ? 'numeric' : 'text'
                  }
                  maxLength={name === 'contactPhone' || name === 'postalCode' ? 64 : 100}
                  aria-invalid={!!errors[name]}
                  aria-describedby={errors[name] ? `order2-error-${name}` : undefined}
                  {...register(name)}
                />
                {errors[name] && (
                  <small id={`order2-error-${name}`} className="field-error">
                    {errors[name]?.message}
                  </small>
                )}
              </div>
            ))}
          </div>
          {physical && (
            <div className="field">
              <label htmlFor="order2-address">
                {text('نشانی کامل در ایران', 'Full delivery address in Iran')}
              </label>
              <textarea
                id="order2-address"
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
            <label htmlFor="order2-note">
              {text('یادداشت سفارش (اختیاری)', 'Order note (optional)')}
            </label>
            <textarea id="order2-note" maxLength={500} rows={2} {...register('note')} />
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
                'شرایط و اقلام را بررسی کرده‌ام؛ می‌دانم سفارش پرداخت نشده و پس از پایان مهلت، رزرو آزاد می‌شود و پیشنهاد قبلی دوباره فعال نمی‌شود.',
                'I reviewed the terms and items. I understand that the order is unpaid; its reservation is released after the deadline and the original accepted offer is not reactivated.',
              )}
            </span>
          </label>
          {errors.acknowledgeTemporary && (
            <small className="field-error">{errors.acknowledgeTemporary.message}</small>
          )}
        </fieldset>
        {expired && (
          <p className="notice" role="status">
            {text(
              'مهلت پیش‌فاکتور تمام شده است؛ شرایط تازه را دریافت کنید.',
              'The order quote has expired. Prepare current conditions again.',
            )}
          </p>
        )}
        {error && (
          <p className="notice" role="alert">
            {error === 'open-limit'
              ? text(
                  'سقف سفارش‌های باز شما تکمیل است. ابتدا سفارش‌های موقت باز خود را بررسی یا لغو کنید و سپس دوباره سفارش بدهید.',
                  'Your open-order limit is reached. Review or cancel existing temporary orders before placing another order.',
                )
              : error === 'physical-capacity'
                ? physicalOrderCapacityMessage(locale)
                : error === 'capacity' || error === 'metadata'
                  ? digitalOrderCapacityMessage(locale, error)
                  : error === 'conflict'
                    ? text(
                        'سبد، سهم یا شرایط تغییر کرده است. سفارش‌های خود را بررسی و سپس پیش‌فاکتور تازه دریافت کنید.',
                        'The cart, allocation or conditions changed. Check your orders, then prepare a new quote.',
                      )
                    : error === 'limited'
                      ? text(
                          'تعداد درخواست‌ها زیاد است؛ کمی بعد تلاش کنید.',
                          'Too many requests. Try again shortly.',
                        )
                      : text(
                          'اطلاعات یا شرایط درخواست معتبر نیست؛ دوباره بررسی کنید.',
                          'Check the request details and conditions.',
                        )}
          </p>
        )}
        <Button type="submit" disabled={busy || expired}>
          {busy
            ? text('در حال ثبت…', 'Creating…')
            : text('ثبت سفارش موقت و رزرو', 'Create temporary order and reserve')}
        </Button>
      </form>
    </section>
  );
}
