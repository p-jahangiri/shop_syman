'use client';
import { CartAmount, CartCheckoutLink } from './cart-summary';
import { useI18n, useStorefront } from '@/components/navigation/locale-provider';
import Link from '@/components/navigation/localized-link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from '@sayman/web-shared/lib/config/schema-runtime.ts';
import {
  ArrowLeft,
  ChevronLeft,
  ShoppingBag,
  CreditCard,
  WalletCards,
  Check,
  Info,
  MapPin,
  Package,
  CircleCheck,
} from 'lucide-react';
import { useShop } from '../providers/shop-provider';
import { availableCartMethods, eligibleChequePlans } from '@/lib/catalog/purchasing';
import { CartLines } from '../navigation/shell';
import {
  cartTotal,
  chequeQuote,
  findVariant,
  normalizePersian,
} from '@sayman/web-shared/lib/shared/commerce.ts';
import { Button, Modal } from '../shared/ui';
import { ConnectedCheckout } from './connected-checkout';
import { AcceptedCartGroups } from './accepted-cart-groups';
import { CartCommandNotice } from './cart-command-notice';
import { cartV2BuyCount, cartV2HasBuyLines } from '@/lib/checkout/cart-v2-contract';
const addressSchema = z.object({
  name: z.string().trim().min(3, 'نام و نام خانوادگی را وارد کنید'),
  phone: z
    .string()
    .refine(
      (v) => /^09\d{9}$/.test(normalizePersian(v).replace(/\s/g, '')),
      'شمارهٔ موبایل معتبر وارد کنید',
    ),
  province: z.string().trim().min(2, 'استان را وارد کنید'),
  city: z.string().trim().min(2, 'شهر را وارد کنید'),
  address: z.string().trim().min(10, 'نشانی کامل را بنویسید'),
  postalCode: z
    .string()
    .refine(
      (v) => /^\d{10}$/.test(normalizePersian(v).replace(/\s/g, '')),
      'کد پستی باید ۱۰ رقم باشد',
    ),
  note: z.string().max(500, 'حداکثر ۵۰۰ نویسه').optional(),
});
type AddressForm = z.infer<typeof addressSchema>;
export function CartPage() {
  const { locale, t, digits } = useI18n(),
    { cart, ready, serverCart } = useShop(),
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const count = serverCart
      ? cartV2BuyCount(serverCart)
      : cart.reduce((sum, line) => sum + line.quantity, 0),
    nonempty = serverCart ? cartV2HasBuyLines(serverCart) : cart.length > 0;
  return (
    <div className="container cart-page">
      <div className="page-top">
        <div className="breadcrumbs">
          <Link href="/">{t('سایمان')}</Link>
          <ChevronLeft />
          <span>{t('سبد خرید')}</span>
        </div>
        <div className="page-title-row">
          <h1>{t('سبد خرید شما')}</h1>
          <span>
            {ready
              ? digits(count) + ' ' + text('کالا برای خرید', 'purchase items')
              : text('در حال بررسی…', 'Checking…')}
          </span>
        </div>
      </div>
      <CartCommandNotice />
      {!ready ? (
        <div
          className="skeleton skeleton-card"
          role="status"
          aria-label={text('در حال بازیابی سبد', 'Loading your cart')}
        />
      ) : (
        <>
          <div className="checkout-layout">
            <div>
              <section className="card-panel">
                <h2>{text('کالاهای عادی فروشگاه', 'Ordinary store products')}</h2>
                {cart.length ? (
                  <CartLines />
                ) : (
                  <p>
                    {text(
                      'در این بخش کالایی انتخاب نشده است.',
                      'No ordinary store products selected.',
                    )}
                  </p>
                )}
                <Link className="text-link cart-continue" href="/catalog">
                  {t('ادامهٔ انتخاب محصولات')}
                  <ArrowLeft size={16} />
                </Link>
              </section>
              <AcceptedCartGroups />
              {!nonempty && <EmptyCart />}
            </div>
            {nonempty && (
              <aside className="card-panel order-summary">
                <h2>{t('خلاصهٔ سبد')}</h2>
                <div className="info-row cart-summary-total">
                  <span>{text('جمع اقلام سبد', 'Cart subtotal')}</span>
                  <strong>
                    <CartAmount />
                  </strong>
                </div>
                <p>
                  {text(
                    'هزینهٔ ارسال و مالیات در مرحلهٔ پرداخت مشخص می‌شوند.',
                    'Shipping and tax are determined at checkout.',
                  )}
                </p>
                <CartCheckoutLink />
              </aside>
            )}
          </div>
        </>
      )}
    </div>
  );
}
function EmptyCart() {
  const { t, locale } = useI18n();
  useStorefront();
  return (
    <div className="empty-state card-panel">
      <ShoppingBag size={48} />
      <h2>{locale === 'fa' ? 'کالای قابل خریدی انتخاب نشده است' : 'No store products selected'}</h2>
      <p>{t('از میان گوشی‌ها، لپ‌تاپ‌ها و همراه‌های دیجیتال، انتخابت را پیدا کن.')}</p>
      <Button asChild>
        <Link href="/catalog">
          {t('شروع انتخاب')}
          <ArrowLeft size={17} />
        </Link>
      </Button>
    </div>
  );
}
export function Checkout() {
  return useStorefront().dataSource === 'api' ? <ConnectedCheckout /> : <PreviewCheckout />;
}
function PreviewCheckout() {
  const { t, digits, toman, locale } = useI18n();
  const { products, site, chequePlans, purchaseMethods } = useStorefront();
  const { cart, ready, serverCart, cartIssue, cartBusy } = useShop();
  const total = serverCart ? BigInt(serverCart.buySubtotalRial ?? '0') : cartTotal(cart, products);
  const [method, setMethod] = useState('online'),
    [planId, setPlanId] = useState(''),
    [consent, setConsent] = useState(false),
    [preview, setPreview] = useState(false),
    [submitted, setSubmitted] = useState<AddressForm | null>(null),
    [consentError, setConsentError] = useState(false);
  const cartProducts = cart.flatMap((l) => {
    const f = findVariant(products, l.variantId);
    return f ? [f.product] : [];
  });
  const plans = eligibleChequePlans(chequePlans, total, cartProducts);
  const methods = availableCartMethods(cart, products, purchaseMethods).filter(
    (m) => m.kind !== 'cheque' || plans.length > 0,
  );
  const selectedMethod = methods.find((m) => m.id === method) ?? methods[0];
  const plan = plans.find((p) => p.id === planId) ?? plans[0];
  const isCheque = selectedMethod?.kind === 'cheque';
  const quote = plan ? chequeQuote(total, plan) : undefined;
  const physical = cart.some((line) => !findVariant(products, line.variantId)?.product.isDigital);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AddressForm>({
    resolver: zodResolver(addressSchema),
    defaultValues: {
      name: '',
      phone: '',
      province: '',
      city: '',
      address: '',
      postalCode: '',
      note: '',
    },
  });
  function submit(values: AddressForm) {
    if (!selectedMethod || cartBusy || cartIssue || !ready) return;
    if (!consent) {
      setConsentError(true);
      return;
    }
    setConsentError(false);
    setSubmitted(values);
    setPreview(true);
  }
  if (serverCart && cartIssue)
    return (
      <div className="container page-empty empty-state">
        <h1>{locale === 'fa' ? 'سبد به بازبینی نیاز دارد' : 'Your cart needs review'}</h1>
        <p>
          {locale === 'fa'
            ? 'موجودی، مبلغ یا ارتباط سبد را بررسی کنید و سپس ادامه دهید.'
            : 'Check stock, amounts or the cart connection before continuing.'}
        </p>
        <Button asChild>
          <Link href="/cart">
            {t('سبد خرید')}
            <ArrowLeft size={17} />
          </Link>
        </Button>
      </div>
    );
  return (
    <div className="container checkout-page">
      <div className="page-top">
        <div className="breadcrumbs">
          <Link href="/">{t('سایمان')}</Link>
          <ChevronLeft />
          <Link href="/cart">{t('سبد خرید')}</Link>
          <ChevronLeft />
          <span>{t('اطلاعات و پرداخت')}</span>
        </div>
        <div className="checkout-steps">
          <span className="done">
            <Check size={14} />
            {t('سبد خرید')}
          </span>
          <i />
          <span className="active">
            <span>{t('۲')}</span>
            {t('اطلاعات و روش پرداخت')}
          </span>
          <i />
          <span>
            <span>{t('۳')}</span>
            {t('بررسی سفارش')}
          </span>
        </div>
        <div className="page-title-row">
          <div>
            <span className="eyebrow">{t('با خیال آسوده، قدم بعدی را بردار')}</span>
            <h1>{t('تکمیل اطلاعات خرید')}</h1>
          </div>
        </div>
      </div>
      {t(
        !ready ? (
          <div
            className="skeleton skeleton-card"
            role="status"
            aria-label={locale === 'fa' ? 'در حال بازیابی سبد' : 'Loading your cart'}
          />
        ) : !cart.length ? (
          <EmptyCart />
        ) : (
          <form onSubmit={handleSubmit(submit)} noValidate>
            <div className="notice checkout-notice">
              <Info size={18} />
              <p>
                <strong>{t('پیش‌نمایش فرایند خرید:')}</strong>
                {t(
                  'از اطلاعات آزمایشی استفاده کنید. اطلاعات این فرم ارسال یا ذخیره نمی‌شود و پرداخت واقعی انجام نخواهد شد.',
                )}
              </p>
            </div>
            <div className="checkout-layout">
              <div className="checkout-sections">
                <section className="card-panel">
                  <h2>
                    <MapPin size={20} />
                    {t(physical ? t('اطلاعات گیرنده و نشانی') : t('اطلاعات دریافت‌کننده'))}
                  </h2>
                  <div className="form-grid">
                    {t(
                      (
                        [
                          {
                            name: 'name',
                            label: t('نام و نام خانوادگی'),
                            placeholder: t('مثلاً سارا احمدی'),
                            autoComplete: 'name',
                          },
                          {
                            name: 'phone',
                            label: t('شمارهٔ موبایل'),
                            placeholder: t('۰۹۱۲۳۴۵۶۷۸۹'),
                            autoComplete: 'tel',
                            inputMode: 'tel',
                          },
                          {
                            name: 'province',
                            label: t('استان'),
                            placeholder: t('مثلاً تهران'),
                            autoComplete: 'address-level1',
                          },
                          {
                            name: 'city',
                            label: t('شهر'),
                            placeholder: t('مثلاً تهران'),
                            autoComplete: 'address-level2',
                          },
                          {
                            name: 'postalCode',
                            label: t('کد پستی'),
                            placeholder: t('۱۰ رقم'),
                            autoComplete: 'postal-code',
                            inputMode: 'numeric',
                          },
                        ] as const
                      ).map((field) => (
                        <div className="field" key={field.name}>
                          <label htmlFor={field.name}>{t(field.label)}</label>
                          <input
                            id={field.name}
                            {...register(field.name)}
                            placeholder={field.placeholder}
                            autoComplete={field.autoComplete}
                            inputMode={'inputMode' in field ? field.inputMode : undefined}
                            aria-invalid={!!errors[field.name]}
                            aria-describedby={
                              errors[field.name] ? `${field.name}-error` : undefined
                            }
                          />
                          {t(
                            errors[field.name] && (
                              <span className="field-error" id={`${field.name}-error`}>
                                {t(errors[field.name]?.message)}
                              </span>
                            ),
                          )}
                        </div>
                      )),
                    )}
                    <div className="field span-two">
                      <label htmlFor="address">{t('نشانی کامل')}</label>
                      <textarea
                        id="address"
                        {...register('address')}
                        placeholder={t('خیابان، کوچه، پلاک و واحد')}
                        autoComplete="street-address"
                        aria-invalid={!!errors.address}
                        aria-describedby={errors.address ? 'address-error' : undefined}
                      />
                      {t(
                        errors.address && (
                          <span className="field-error" id="address-error">
                            {t(errors.address.message)}
                          </span>
                        ),
                      )}
                    </div>
                    <div className="field span-two">
                      <label htmlFor="note">
                        {t('یادداشت سفارش')}
                        <span className="muted">{t('(اختیاری)')}</span>
                      </label>
                      <input
                        id="note"
                        {...register('note')}
                        placeholder={t('نکته‌ای دربارهٔ سفارش یا دریافت کالا')}
                      />
                      {t(
                        errors.note && (
                          <span className="field-error">{t(errors.note.message)}</span>
                        ),
                      )}
                    </div>
                  </div>
                </section>
                <section className="card-panel">
                  <h2>
                    <CreditCard size={20} />
                    {t('روش پرداخت')}
                  </h2>
                  <div className="payment-options">
                    {methods.map((m) => (
                      <label
                        key={m.id}
                        className={
                          selectedMethod?.id === m.id ? 'payment-option active' : 'payment-option'
                        }
                      >
                        <input
                          type="radio"
                          name="payment"
                          checked={selectedMethod?.id === m.id}
                          onChange={() => setMethod(m.id)}
                        />
                        {m.kind === 'cheque' ? <CreditCard size={23} /> : <WalletCards size={23} />}
                        <span>
                          <strong>{t(m.name)}</strong>
                          <small>{t(m.description)}</small>
                        </span>
                      </label>
                    ))}
                    {!methods.length && (
                      <p className="notice">
                        {t(
                          'روش خرید مشترکی برای تمام اقلام سبد موجود نیست؛ اقلام را جداگانه بررسی کنید.',
                        )}
                      </p>
                    )}
                  </div>
                  {t(
                    isCheque && (
                      <div className="checkout-cheque">
                        <label htmlFor="cheque-plan">{t('طرح نمونهٔ بازپرداخت')}</label>
                        <select
                          id="cheque-plan"
                          className="control-input"
                          value={plan?.id ?? ''}
                          onChange={(e) => setPlanId(e.target.value)}
                        >
                          {t(
                            plans.map((p) => (
                              <option key={p.id} value={p.id}>
                                {t(digits(p.months))}
                                {t('ماهه \u00B7')}
                                {t(digits(p.downPaymentPercent))}
                                {t('٪ پیش‌پرداخت \u00B7')}
                                {t(digits(p.markupPercent))}
                                {t('٪ افزودهٔ کل به مانده')}
                              </option>
                            )),
                          )}
                        </select>
                        <div className="info-row">
                          <span>{t('پیش‌پرداخت نمونه')}</span>
                          <strong>
                            {t(toman(quote!.downPayment))} <small>{t('تومان')}</small>
                          </strong>
                        </div>
                        <div className="info-row">
                          <span>
                            {t(digits(quote!.installments.length))}
                            {t('قسط با فاصلهٔ {0} ماه، از', [digits(plan!.intervalMonths)])}
                          </span>
                          <strong>
                            {t(toman(quote!.installments[0]))} <small>{t('تومان')}</small>
                          </strong>
                        </div>
                        <p className="small-note">{t(site.chequeDisclaimer)}</p>
                      </div>
                    ),
                  )}
                </section>
                <section className="card-panel delivery-panel">
                  <h2>
                    <Package size={20} />
                    {t('شرایط تحویل')}
                  </h2>
                  <p>
                    {t(
                      'روش ارسال، هزینه و زمان تحویل هنوز از سوی فروشگاه تعیین نشده است. این پیش‌نمایش مبلغ نهایی پرداخت را محاسبه نمی‌کند.',
                    )}
                  </p>
                  <Link href="/support" className="text-link">
                    {t('راهنمای ارسال و مرجوعی')}
                    <ArrowLeft size={15} />
                  </Link>
                </section>
              </div>
              <aside className="card-panel order-summary">
                <h2>{t('انتخاب‌های شما')}</h2>
                <CartLines />
                <div className="info-row">
                  <span>{t('جمع کالاها')}</span>
                  <strong>
                    <CartAmount />
                  </strong>
                </div>
                {t(
                  isCheque && (
                    <>
                      <div className="info-row">
                        <span>{t('افزودهٔ نمونهٔ طرح')}</span>
                        <span>
                          {t(toman(quote!.markup))}
                          {t('تومان')}
                        </span>
                      </div>
                      <div className="info-row">
                        <span>{t('جمع نمونهٔ کالا و طرح')}</span>
                        <strong>
                          {t(toman(quote!.total))} <small>{t('تومان')}</small>
                        </strong>
                      </div>
                    </>
                  ),
                )}
                <div className="rule" />
                <div className="info-row">
                  <span>{t('ارسال و مالیات')}</span>
                  <span>{t('تعیین نشده')}</span>
                </div>
                <label className="check-label consent-label">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => {
                      setConsent(e.target.checked);
                      setConsentError(false);
                    }}
                  />
                  <span>
                    {t(
                      'می‌دانم این فرایند صرفاً پیش‌نمایش است و سفارش یا پرداخت واقعی ثبت نمی‌شود.',
                    )}
                  </span>
                </label>
                {t(
                  consentError && (
                    <p className="field-error" role="alert">
                      {t('پیش از ادامه، نمایشی بودن فرایند را تأیید کنید.')}
                    </p>
                  ),
                )}
                <Button
                  className="full"
                  type="submit"
                  disabled={!selectedMethod || cartBusy || cartIssue || !ready}
                >
                  {t('بررسی پیش‌نمایش سفارش')}
                  <ArrowLeft size={17} />
                </Button>
                <p className="small-note">{t('این دکمه شما را به درگاه پرداخت نمی‌برد.')}</p>
              </aside>
            </div>
          </form>
        ),
      )}
      <Modal
        open={preview}
        onOpenChange={setPreview}
        title={t('پیش‌نمایش سفارش شما')}
        description={t('اطلاعات بررسی شد؛ سفارشی ثبت نشده و پرداختی انجام نشده است.')}
      >
        <div className="preview-order">
          <CircleCheck size={45} />
          <h3>{t('انتخاب‌ها آمادهٔ بررسی‌اند')}</h3>
          <p>
            {t(submitted?.name)}
            {t(
              '، این صفحه نمونهٔ مرحلهٔ بررسی نهایی است. ثبت واقعی پس از اتصال سرویس‌ها فعال خواهد شد.',
            )}
          </p>
          <div className="info-row">
            <span>{t('کالاها')}</span>
            <strong>
              {t(digits(cart.reduce((s, l) => s + l.quantity, 0)))}
              {t('عدد')}
            </strong>
          </div>
          <div className="info-row">
            <span>{t('روش انتخاب‌شده')}</span>
            <strong>
              {isCheque ? t('چکی {0} ماهه', [digits(plan!.months)]) : selectedMethod?.name}
            </strong>
          </div>
          <div className="info-row">
            <span>
              {t('جمع نمونهٔ کالاها')}
              {t(isCheque ? t(' و طرح') : '')}
            </span>
            <strong>
              {t(toman(isCheque ? quote!.total : total))} <small>{t('تومان')}</small>
            </strong>
          </div>
          <div className="notice">
            {t(
              'ارسال و مالیات تعیین نشده‌اند؛ مبلغ بالا مبلغ قابل پرداخت نیست. هیچ اطلاعاتی به سرور ارسال نشد.',
            )}
          </div>
          <Button variant="outline" className="full" onClick={() => setPreview(false)}>
            {t('برگشت و ویرایش اطلاعات')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
