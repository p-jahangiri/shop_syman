'use client';
import { advanceRequestGeneration } from '../lib/request-generation';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useForm } from 'react-hook-form';
import { useCustomerSession } from './auth-provider';
import { useI18n } from './locale-provider';
import Link from './localized-link';
import { SavedAddressPicker } from './saved-address-picker';
import { addressOrderFields } from '../lib/address-contract';
import type { OrderFormValues } from '../lib/order-form';
import {
  creditOrderCommandSchema,
  creditOrderInputSchema,
  creditOrderReadinessSchema,
  creditOrderCommandPath,
  type CreditOrderCommand,
  type CreditOrderReadiness,
} from '../lib/credit-order-contract';
import { customerCreditOrderJournal as journal } from '../lib/credit-order-journal';
import type { CreditCheckoutQuote } from '../lib/credit-checkout-quote-contract';
import { formatToman } from '../lib/money';
type Values = OrderFormValues & { quoteAccepted: boolean };
export function CreditOrderForm({
  quote,
  recoveryOnly = false,
  disabled = false,
  onCreated,
}: {
  quote: CreditCheckoutQuote | null;
  recoveryOnly?: boolean;
  disabled?: boolean;
  onCreated?: () => void;
}) {
  const auth = useCustomerSession(),
    { locale } = useI18n(),
    owner = auth.status === 'member' ? auth.session!.user.id : null,
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const entry = useSyncExternalStore(
      journal.subscribe,
      () => journal.snapshot(owner),
      () => null,
    ),
    unresolved = entry?.state === 'pending' || entry?.state === 'unknown';
  const [ready, setReady] = useState<CreditOrderReadiness | null>(null),
    [loading, setLoading] = useState(false),
    [failed, setFailed] = useState(false),
    [refresh, setRefresh] = useState(0),
    [invalid, setInvalid] = useState(false),
    [now, setNow] = useState(0);
  const generation = useRef(0),
    created = useRef<string | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    reset,
    formState: { isDirty },
  } = useForm<Values>({
    defaultValues: {
      contactName: '',
      contactPhone: '',
      province: '',
      city: '',
      address: '',
      postalCode: '',
      note: '',
      acknowledgeTemporary: false,
      quoteAccepted: false,
    },
  });
  const transport = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const expected = auth.store.snapshot().session?.user.id,
        response = await auth.store.fetch(path, init),
        raw = await response.json().catch(() => null),
        current = auth.store.snapshot();
      if (current.status !== 'member' || current.session?.user.id !== expected)
        throw Object.assign(Error('Session changed'), { status: 0, code: 'session_changed' });
      if (!response.ok)
        throw Object.assign(Error('Cheque order unavailable'), {
          status: response.status,
          code: typeof raw?.title === 'string' ? raw.title : 'credit_order_unavailable',
        });
      return raw;
    },
    [auth.store],
  );
  useEffect(() => {
    const ticket = ++generation.current,
      controller = new AbortController();
    setReady(null);
    setFailed(false);
    setLoading(!!owner && !!quote && !recoveryOnly);
    if (owner && quote && !recoveryOnly)
      void transport('/api/credit-orders/quotes/' + quote.id + '/readiness', {
        signal: controller.signal,
      })
        .then((raw) => {
          const value = creditOrderReadinessSchema.parse(raw);
          if (
            value.creditQuoteId !== quote.id ||
            value.fingerprint !== quote.fingerprint ||
            Date.parse(value.expiresAt) !== Date.parse(quote.expiresAt)
          )
            throw Error('Wrong readiness');
          if (ticket === generation.current && !controller.signal.aborted) setReady(value);
        })
        .catch(() => {
          if (ticket === generation.current && !controller.signal.aborted) setFailed(true);
        })
        .finally(() => {
          if (ticket === generation.current && !controller.signal.aborted) setLoading(false);
        });
    return () => {
      advanceRequestGeneration(generation);
      controller.abort();
    };
  }, [owner, quote, recoveryOnly, refresh, transport]);
  useEffect(() => {
    reset({ ...getValues(), quoteAccepted: false, acknowledgeTemporary: false });
    setInvalid(false);
  }, [quote?.id, ready?.reviewHold?.policyVersion, getValues, reset]);
  useEffect(() => () => journal.interrupt(), []);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!unresolved && !isDirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unresolved, isDirty]);
  useEffect(() => {
    if (entry?.state === 'done' && created.current !== entry.command.id) {
      created.current = entry.command.id;
      reset({ ...getValues(), quoteAccepted: false, acknowledgeTemporary: false });
      setRefresh((n) => n + 1);
      onCreated?.();
    }
  }, [entry?.state, entry?.command.id, onCreated, getValues, reset]);
  async function send(c: CreditOrderCommand, retry = false) {
    if (!owner) return;
    let started = false;
    try {
      if (retry) journal.retry(owner);
      else journal.begin(owner, c);
      started = true;
      journal.finish(
        owner,
        c,
        await transport(creditOrderCommandPath(c), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(c.body),
        }),
      );
    } catch (error) {
      if (started) {
        const e = error as { status?: number; code?: string };
        journal.fail(owner, c, e.status ?? 0, e.code ?? 'credit_order_unavailable');
      }
    }
  }
  async function receipt() {
    if (!owner || entry?.state !== 'unknown') return;
    let c: CreditOrderCommand | undefined;
    try {
      c = journal.retry(owner);
      journal.finish(owner, c, await transport(creditOrderCommandPath(c)));
    } catch (error) {
      if (c) {
        const e = error as { status?: number; code?: string };
        journal.fail(owner, c, e.status ?? 0, e.code ?? 'credit_order_unavailable');
      }
    }
  }
  const core = quote?.ordinaryQuote ?? quote?.acceptedQuote,
    physical = core?.shippingRequired === true,
    expired = !!quote && Date.parse(quote.expiresAt) <= (now || Date.now()),
    canCreate =
      !!owner &&
      !disabled &&
      !unresolved &&
      !loading &&
      !failed &&
      !expired &&
      !!quote &&
      ready?.creditQuoteId === quote.id &&
      ready.fingerprint === quote.fingerprint &&
      ready.canCreate;
  function submit(values: Values) {
    if (!canCreate || !quote) return;
    const input = creditOrderInputSchema.safeParse({
      creditQuoteId: quote.id,
      fingerprint: quote.fingerprint,
      contactName: values.contactName,
      contactPhone: values.contactPhone,
      delivery: physical
        ? {
            countryCode: 'IR',
            province: values.province,
            city: values.city,
            address: values.address,
            postalCode: values.postalCode,
          }
        : null,
      note: values.note,
      quoteAccepted: values.quoteAccepted,
      acknowledgeTemporary: values.acknowledgeTemporary,
      ...(ready?.reviewHold ? { reviewHoldPolicyVersion: ready.reviewHold.policyVersion } : {}),
    });
    if (!input.success) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    void send(
      creditOrderCommandSchema.parse({
        id: crypto.randomUUID().replaceAll('-', ''),
        body: input.data,
        quoteSnapshot: quote,
      }),
    );
  }
  const blockers: Record<string, string> = {
    cheque_review_hold_changed_conflict: text(
      'مهلت بررسی چک تغییر کرده است؛ امکان ثبت را دوباره بررسی کنید و شرایط تازه را بپذیرید.',
      'The cheque review hold changed. Recheck eligibility and accept the current terms.',
    ),
    credit_purchase_scope_conflict: text(
      'مجوز تغییر کرده، منقضی، باطل یا قبلاً استفاده شده است.',
      'The scope changed, expired, was revoked or has already been used.',
    ),
    credit_quote_expired_conflict: text(
      'مهلت محاسبه پایان یافته است؛ محاسبهٔ تازه لازم است.',
      'This calculation expired. Calculate again.',
    ),
    credit_order_unavailable_conflict: text(
      'ثبت سفارش موقت، طرح یا هزینهٔ نهایی هنوز آماده نیست.',
      'Temporary ordering, the plan or final charges are not ready.',
    ),
    quote_changed_conflict: text(
      'قیمت یا شرایط تغییر کرده است؛ محاسبهٔ تازه بگیرید.',
      'Prices or conditions changed. Calculate again.',
    ),
    credit_quote_changed_conflict: text(
      'نسخهٔ محاسبه یا مجوز تغییر کرده است.',
      'The calculation or purchase authority changed.',
    ),
    cart_version_conflict: text(
      'سبد پس از این محاسبه تغییر کرده است.',
      'The cart changed after this calculation.',
    ),
    open_order_limit_conflict: text(
      'ابتدا سفارش‌های موقت باز خود را بررسی یا لغو کنید.',
      'Review or cancel existing temporary orders first.',
    ),
    quote_already_ordered_conflict: text(
      'این محاسبه قبلاً به سفارش متصل شده است.',
      'This calculation already belongs to an order.',
    ),
  };
  const fields: [keyof Values, string, string][] = [
    ['contactName', text('نام گیرنده', 'Recipient name'), 'name'],
    ['contactPhone', text('شمارهٔ همراه گیرنده', 'Recipient mobile number'), 'tel'],
    ...(physical
      ? ([
          ['province', text('استان', 'Province'), 'address-level1'],
          ['city', text('شهر', 'City'), 'address-level2'],
          ['postalCode', text('کد پستی ده‌رقمی', '10-digit postal code'), 'postal-code'],
        ] as [keyof Values, string, string][])
      : []),
  ];
  return (
    <section className="credit-order-panel">
      <h3>{text('ثبت سفارش موقت چکی', 'Place a temporary cheque order')}</h3>
      <p>
        {text(
          'این مرحله سفارش پرداخت‌نشده و رزرو موقت ایجاد می‌کند. وصول چک و دریافت پیش‌پرداخت هنوز تأیید نمی‌شوند. مجوز فقط برای همین یک خرید مصرف می‌شود؛ لغو یا انقضای سفارش آن را دوباره قابل استفاده نمی‌کند.',
          'This creates an unpaid order and temporary stock hold. Cheque collection and down payment are not verified. The scope is used for this one purchase; cancellation or expiry does not make it reusable.',
        )}
      </p>
      {!owner ? (
        <Link href="/account?returnTo=/checkout">{text('ورود به حساب', 'Sign in')}</Link>
      ) : (
        <>
          {entry && (
            <div
              className="credit-order-command"
              role={entry.state === 'rejected' ? 'alert' : 'status'}
            >
              <strong>
                {entry.state === 'done'
                  ? text(
                      'سفارش موقت چکی ثبت شد؛ هنوز پرداخت نشده است.',
                      'Temporary cheque order recorded; it remains unpaid.',
                    )
                  : entry.state === 'pending'
                    ? text('در حال ثبت سفارش و رزرو…', 'Recording order and stock hold…')
                    : entry.state === 'unknown'
                      ? text(
                          'نتیجهٔ ثبت سفارش هنوز مشخص نیست.',
                          'The order outcome is not confirmed.',
                        )
                      : text(
                          'سفارش پذیرفته نشد؛ وضعیت و شرایط را تازه کنید.',
                          'Order rejected. Refresh status and conditions.',
                        )}
              </strong>
              <p>
                {text('شناسهٔ پیگیری', 'Tracking ID')}: <bdi>{entry.command.id}</bdi>
              </p>
              {entry.state === 'unknown' ? (
                <>
                  <p>
                    {text(
                      'ابتدا رسید همین شناسه را بررسی کنید. تلاش دوباره همان محاسبه و اطلاعات قبلی را می‌فرستد.',
                      'Check this command’s receipt first. Retry sends the original calculation and details.',
                    )}
                  </p>
                  <div className="credit-quote-actions">
                    <button type="button" onClick={() => void receipt()}>
                      {text('بررسی رسید سفارش چکی', 'Check cheque order receipt')}
                    </button>
                    <button type="button" onClick={() => void send(entry.command, true)}>
                      {text('تلاش دوبارهٔ همان سفارش چکی', 'Retry the same cheque order')}
                    </button>
                  </div>
                </>
              ) : (
                entry.state !== 'pending' && (
                  <button type="button" onClick={() => journal.clear(owner)}>
                    {text('بستن نتیجهٔ سفارش', 'Close order result')}
                  </button>
                )
              )}
              {entry.state === 'done' && entry.result && (
                <>
                  <p>
                    {text('شمارهٔ سفارش', 'Order reference')}:{' '}
                    <bdi>{entry.result.order.summary.reference}</bdi> ·{' '}
                    {formatToman(entry.result.order.payableTotalRial, locale)}{' '}
                    {text('تومان', 'toman')}
                  </p>
                  <p>
                    {text('مهلت اولیهٔ رزرو', 'Original stock hold deadline')}:{' '}
                    {new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: 'Asia/Tehran',
                    }).format(new Date(entry.result.order.summary.expiresAt))}
                  </p>
                  <p>
                    {text(
                      'این رسیدِ زمان ثبت است؛ برای وضعیت فعلی و لغو، سفارش را باز کنید.',
                      'This is the creation receipt. Open the order for current status and cancellation.',
                    )}
                  </p>
                  <Link href={'/orders/' + entry.result.order.summary.id}>
                    {text('مشاهدهٔ وضعیت سفارش چکی', 'View cheque order status')}
                  </Link>
                </>
              )}
            </div>
          )}
          {!recoveryOnly && quote && (
            <>
              <button
                type="button"
                disabled={unresolved || loading || disabled}
                onClick={() => setRefresh((n) => n + 1)}
              >
                {text('بررسی دوبارهٔ امکان ثبت', 'Recheck order eligibility')}
              </button>
              {loading && (
                <p role="status">
                  {text(
                    'در حال بررسی مجوز و شرایط جاری…',
                    'Checking current scope and conditions…',
                  )}
                </p>
              )}
              {failed && (
                <p role="alert">
                  {text(
                    'شرایط ثبت خوانده نشد؛ دوباره بررسی کنید.',
                    'Order eligibility could not be loaded. Recheck it.',
                  )}
                </p>
              )}
              {ready && !ready.canCreate && (
                <ul>
                  {ready.blockers.map((code) => (
                    <li key={code}>
                      {blockers[code] ??
                        text(
                          'سبد و مجوز به بازبینی نیاز دارند.',
                          'The cart and purchase scope need review.',
                        )}
                    </li>
                  ))}
                </ul>
              )}
              {expired && (
                <p role="status">
                  {text('مهلت این محاسبه تمام شده است.', 'This calculation expired.')}
                </p>
              )}
              {canCreate && ready?.reviewHold && (
                <p>
                  {text(
                    'قیمت تا پایان مهلت همین محاسبه برای ثبت معتبر است. پس از ثبت، مهلت بررسی چک حداکثر ' +
                      ready.reviewHold.maximumMinutes.toLocaleString('fa-IR') +
                      ' دقیقه است؛ اعتبار مجوز یا تأمین کالای توافقی ممکن است آن را کوتاه‌تر کند. زمان نهایی در سفارش نمایش داده می‌شود.',
                    'Create the order before this calculation expires. The cheque review hold after creation is up to ' +
                      ready.reviewHold.maximumMinutes +
                      ' minutes; the purchase scope or agreed stock rights may shorten it. The final deadline appears in the order.',
                  )}
                </p>
              )}
              {canCreate && !ready?.reviewHold && (
                <p>
                  {text(
                    'موجودی هنگام ثبت دوباره بررسی می‌شود. رزرو از مهلت این محاسبه و مجوز فراتر نمی‌رود؛ زمان دقیق پس از ثبت نمایش داده می‌شود.',
                    'Stock is checked again at creation. The hold cannot outlast this calculation or scope; its exact deadline is shown after creation.',
                  )}
                </p>
              )}
              {(!entry || entry.state === 'rejected') && (
                <form onSubmit={handleSubmit(submit)} noValidate>
                  <fieldset className="order-fieldset" disabled={!canCreate}>
                    {physical && (
                      <SavedAddressPicker
                        disabled={!canCreate}
                        onUse={(address) => {
                          if (!canCreate) return;
                          const values = addressOrderFields(address);
                          for (const key of Object.keys(values) as (keyof typeof values)[])
                            setValue(key, values[key], { shouldDirty: true });
                        }}
                      />
                    )}
                    <div className="form-grid">
                      {fields.map(([name, label, auto]) => (
                        <label className="field" key={name}>
                          <span>{label}</span>
                          <input
                            autoComplete={auto}
                            inputMode={
                              name === 'contactPhone'
                                ? 'tel'
                                : name === 'postalCode'
                                  ? 'numeric'
                                  : 'text'
                            }
                            maxLength={name === 'contactPhone' || name === 'postalCode' ? 64 : 100}
                            {...register(name)}
                          />
                        </label>
                      ))}
                    </div>
                    {physical && (
                      <label className="field">
                        <span>{text('نشانی کامل در ایران', 'Full address in Iran')}</span>
                        <textarea
                          autoComplete="street-address"
                          rows={3}
                          maxLength={2000}
                          {...register('address')}
                        />
                      </label>
                    )}
                    <label className="field">
                      <span>{text('یادداشت سفارش — اختیاری', 'Order note — optional')}</span>
                      <textarea rows={2} maxLength={500} {...register('note')} />
                    </label>
                    <label className="credit-order-check">
                      <input type="checkbox" {...register('quoteAccepted')} />
                      <span>
                        {text(
                          'مبالغ، اقساط، مشخصات و شرایط همین نسخهٔ محاسبه را بررسی و تأیید می‌کنم.',
                          'I reviewed and accept the amounts, cheques, specifications and terms of this exact calculation.',
                        )}
                      </span>
                    </label>
                    <label className="credit-order-check">
                      <input type="checkbox" {...register('acknowledgeTemporary')} />
                      <span>
                        {ready?.reviewHold
                          ? text(
                              'مهلت بررسی حداکثر ' +
                                ready.reviewHold.maximumMinutes.toLocaleString('fa-IR') +
                                ' دقیقه و احتمال کوتاه‌تر بودن آن را پذیرفتم؛ سفارش پرداخت‌نشده است و این مجوز با لغو یا انقضا احیا نمی‌شود.',
                              'I accept a review hold of up to ' +
                                ready.reviewHold.maximumMinutes +
                                ' minutes, possibly shorter. The order is unpaid and cancellation or expiry does not restore this scope.',
                            )
                          : text(
                              'سفارش پرداخت‌نشده است؛ رزرو مهلت دارد و این مجوز پس از لغو یا انقضا هم دوباره مصرف نمی‌شود.',
                              'The order is unpaid, its hold has a deadline, and this scope stays used after cancellation or expiry.',
                            )}
                      </span>
                    </label>
                    {invalid && (
                      <p role="alert">
                        {text(
                          'اطلاعات گیرنده و نشانی را کامل کنید و هر دو تأیید را بخوانید.',
                          'Complete recipient and delivery details and review both confirmations.',
                        )}
                      </p>
                    )}
                    <button type="submit" disabled={!canCreate}>
                      {text(
                        'ثبت سفارش موقت چکی و رزرو',
                        'Create temporary cheque order and hold stock',
                      )}
                    </button>
                  </fieldset>
                </form>
              )}
            </>
          )}
          <p>
            <Link href="/credit/purchases">
              {text('تاریخچهٔ محاسبات و سفارش‌های چکی من', 'My cheque calculations and orders')}
            </Link>
          </p>
        </>
      )}
    </section>
  );
}
