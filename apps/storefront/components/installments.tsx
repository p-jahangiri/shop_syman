'use client';
import { useI18n, useStorefront } from '@/components/locale-provider';
import Link from '@/components/localized-link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  Calculator,
  Check,
  CreditCard,
  FileCheck2,
  ShieldCheck,
  ShoppingBag,
  Info,
} from 'lucide-react';
import {
  availablePurchaseMethods,
  eligibleChequePlans,
  isPurchaseKindEnabled,
} from '@/lib/purchasing';
import { chequeQuote, normalizePersian } from '@/lib/commerce';
import { tomanInput, parseToman } from '@/lib/money';
import { Button, groupNavigation } from './ui';
export function Installments() {
  const { locale, t, digits, toman } = useI18n();
  const { products, site, chequePlans, purchaseMethods, isPreview } = useStorefront();
  const params = useSearchParams();
  const product = products.find((p) => p.slug === params.get('product'));
  const variant =
    product?.variants.find((v) => v.id === params.get('variant')) ?? product?.variants[0];
  const [amount, setAmount] = useState(variant ? tomanInput(variant.priceRial) : '68900000');
  const [planId, setPlanId] = useState('');
  const normalized = normalizePersian(amount).replace(/[ ,٬]/g, '').replace('٫', '.');
  const parsedAmount = parseToman(normalized);
  const valid = parsedAmount !== undefined && parsedAmount > 0n;
  const amountRial = valid ? parsedAmount : 0n;
  const methodAvailable =
    product && variant
      ? availablePurchaseMethods(product, variant, purchaseMethods, amountRial).some(
          (m) => m.kind === 'cheque',
        )
      : purchaseMethods.some(
          (m) =>
            m.kind === 'cheque' &&
            m.enabled &&
            (!m.minAmountRial || amountRial >= BigInt(m.minAmountRial)) &&
            (!m.maxAmountRial || amountRial <= BigInt(m.maxAmountRial)),
        );
  const plans =
    valid && methodAvailable
      ? eligibleChequePlans(chequePlans, amountRial, product ? [product] : [])
      : [];
  const plan = plans.find((p) => p.id === planId) ?? plans[0];
  const quote = plan ? chequeQuote(amountRial, plan) : undefined;
  if (!isPurchaseKindEnabled(purchaseMethods, 'cheque'))
    return (
      <div className="container empty-state page-empty">
        <h1>{locale === 'fa' ? 'خرید چکی فعلاً فعال نیست' : 'Cheque purchasing is unavailable'}</h1>
        <p>
          {locale === 'fa'
            ? 'کالاها و روش‌های خرید فعال را در فروشگاه ببینید. سوابق سفارش‌های قبلی از حساب شما در دسترس‌اند.'
            : 'Browse products and their available purchase options. Existing order history remains available in your account.'}
        </p>
        <Button asChild>
          <Link href="/catalog">{t('کشف محصولات')}</Link>
        </Button>
      </div>
    );
  return (
    <div className="container installments-page">
      <div className="page-top">
        <div className="breadcrumbs">
          <Link href="/">{t('سایمان')}</Link>
          <ChevronLeft />
          <span>{t('خرید چکی')}</span>
        </div>
      </div>
      <section className="installment-intro">
        <div>
          <span className="eyebrow">{t('برای انتخابت، راه‌های بیشتری هست')}</span>
          <h1>
            {t('امروز انتخاب کن.')}
            <br />
            <span>{t('قدم‌به‌قدم پرداخت کن.')}</span>
          </h1>
          <p>
            {t(
              'هزینه‌ها را شفاف ببین، طرح‌ها را کنار هم بگذار و بعد تصمیم بگیر. خرید چکی به بررسی مدارک و تأیید فروشگاه نیاز دارد.',
            )}
          </p>
          <div className="sample-label">
            <Info size={14} />
            {isPreview
              ? t('طرح‌های فعلی صرفاً نمونهٔ محاسبه‌اند')
              : locale === 'fa'
                ? 'برآورد اولیه؛ مبلغ نهایی هنگام ثبت سفارش مشخص می‌شود.'
                : 'Initial estimate; final amounts are confirmed when placing an order.'}
          </div>
        </div>
        <div className="installment-intro-art">
          <CreditCard size={115} strokeWidth={0.8} />
          <span className="art-asterisk">✳</span>
          <span>
            {t('یک انتخاب خوب،')}
            <br />
            {t('در چند قدم.')}
          </span>
        </div>
      </section>
      <section className="installment-calculator">
        <div className="calculator-controls card-panel">
          <h2>
            <Calculator size={21} />
            {t('محاسبه‌گر خرید چکی')}
          </h2>
          <p className="small-note">
            {t(
              product
                ? isPreview
                  ? t('مبلغ نمونهٔ {0} انتخاب شده است.', [product.name])
                  : locale === 'fa'
                    ? `مبلغ ${product.name} انتخاب شده است.`
                    : `The price of ${product.name} is selected.`
                : t('مبلغ دلخواهت را وارد کن تا نمونهٔ بازپرداخت را ببینی.'),
            )}
          </p>
          <div className="field">
            <label htmlFor="installment-amount">
              {t('مبلغ کالا')}
              <span className="muted">{t('(تومان)')}</span>
            </label>
            <input
              id="installment-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={!valid}
              aria-describedby={!valid ? 'amount-error' : undefined}
            />
            {t(
              !valid && (
                <span className="field-error" id="amount-error">
                  {t('مبلغ مثبت تومان با حداکثر یک رقم اعشار و در بازهٔ ریال مجاز وارد کنید.')}
                </span>
              ),
            )}
          </div>
          <div className="calculator-plans">
            <p>{t('مدت بازپرداخت نمونه')}</p>
            <div
              role="radiogroup"
              tabIndex={-1}
              aria-label={t('انتخاب طرح چکی')}
              onKeyDown={groupNavigation}
            >
              {t(
                plans.map((p) => (
                  <button
                    role="radio"
                    tabIndex={plan?.id === p.id ? 0 : -1}
                    aria-checked={plan?.id === p.id}
                    className={plan?.id === p.id ? 'active' : ''}
                    key={p.id}
                    onClick={() => setPlanId(p.id)}
                  >
                    {t(digits(p.months))}
                    <small>{t('ماهه')}</small>
                    {t(plan?.id === p.id && <Check size={14} />)}
                  </button>
                )),
              )}
            </div>
          </div>
          {!plan && (
            <p className="notice">
              {t(
                product
                  ? 'خرید چکی برای این کالا یا مبلغ فعال نیست.'
                  : 'طرح فعالی برای این مبلغ وجود ندارد.',
              )}
            </p>
          )}
          {plan && (
            <div className="plan-details">
              <span>
                {t('پیش‌پرداخت:')}
                <strong>
                  {t(digits(plan.downPaymentPercent))}
                  {t('٪ مبلغ کالا')}
                </strong>
              </span>
              <span>
                {t('افزودهٔ کل:')}
                <strong>
                  {t(digits(plan.markupPercent))}
                  {t('٪ مانده پس از پیش‌پرداخت')}
                </strong>
              </span>
              <span>
                {t('فاصلهٔ چک‌ها:')}
                <strong>
                  {plan.intervalMonths === 1
                    ? t('ماهانه')
                    : t('هر {0} ماه', [digits(plan.intervalMonths)])}
                </strong>
              </span>
            </div>
          )}
          <div className="notice">{t(site.chequeDisclaimer)}</div>
        </div>
        <div className="calculator-result card-panel">
          <span className="eyebrow">{t('نمونهٔ شفافِ هزینه‌ها')}</span>
          <h2>{t('تصویر کامل انتخابت')}</h2>
          {t(
            valid && quote ? (
              <>
                <div className="calculator-main">
                  <span>{t('مبلغ هر قسط، از')}</span>
                  <strong>
                    {t(toman(quote.installments[0]))}
                    <small>{t('تومان')}</small>
                  </strong>
                  <p>
                    {t(digits(quote.installments.length))}
                    {t('چک با فاصلهٔ {0} ماه، پس از پیش‌پرداخت', [digits(plan!.intervalMonths)])}
                  </p>
                </div>
                <div className="info-row">
                  <span>{locale === 'fa' ? 'قیمت کالا' : 'Product price'}</span>
                  <strong>
                    {t(toman(amountRial))} <small>{t('تومان')}</small>
                  </strong>
                </div>
                <div className="info-row">
                  <span>{t('پیش‌پرداخت')}</span>
                  <strong>
                    {t(toman(quote.downPayment))} <small>{t('تومان')}</small>
                  </strong>
                </div>
                <div className="info-row">
                  <span>{t('افزودهٔ کل طرح نمونه')}</span>
                  <span>
                    {t(toman(quote.markup))}
                    {t('تومان')}
                  </span>
                </div>
                <div className="rule" />
                <div className="info-row">
                  <span>{t('جمع کالا و هزینهٔ طرح')}</span>
                  <strong>
                    {t(toman(quote.total))} <small>{t('تومان')}</small>
                  </strong>
                </div>
                <details className="schedule-details">
                  <summary>{t('دیدن ریز اقساط')}</summary>
                  <div>
                    {t(
                      quote.installments.map((amount, index) => (
                        <div key={index}>
                          <span>
                            {t('چک')}
                            {t(digits(index + 1))}
                            {t('\u00B7 ماه')}
                            {t(digits((index + 1) * plan!.intervalMonths))}
                          </span>
                          <strong>
                            {t(toman(amount))}
                            {t('تومان')}
                          </strong>
                        </div>
                      )),
                    )}
                  </div>
                </details>
                <p className="small-note">
                  {t(
                    'افزودهٔ طرح نرخ سالانه نیست. محاسبه بر ماندهٔ پس از پیش‌پرداخت است. اختلاف گردکردن در قسط آخر لحاظ شده؛ ارسال و مالیات در این مبلغ نیست.',
                  )}
                </p>
              </>
            ) : (
              <div className="empty-state">
                <Calculator size={40} />
                <p>
                  {t(
                    valid
                      ? 'خرید چکی برای این کالا یا مبلغ فعال نیست.'
                      : 'برای محاسبه، یک مبلغ معتبر وارد کن.',
                  )}
                </p>
              </div>
            ),
          )}
          <Button asChild className="full">
            <Link href={product ? `/product/${product.slug}` : '/catalog'}>
              {t(product ? t('برگشت به محصول') : t('پیدا کردن محصول دلخواه'))}
              <ArrowLeft size={17} />
            </Link>
          </Button>
        </div>
      </section>
      <section className="cheque-process">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{t('از انتخاب تا تأیید')}</span>
            <h2>{t('چطور خرید چکی انجام می‌شود؟')}</h2>
          </div>
        </div>
        <div className="process-grid">
          {t(
            [
              {
                icon: ShoppingBag,
                title: t('انتخاب کالا و طرح'),
                text: t('کالای مورد نظر و طرح بازپرداخت مناسب را انتخاب می‌کنی.'),
              },
              {
                icon: FileCheck2,
                title: t('بررسی مدارک و چک'),
                text: t('مدارک و مشخصات چک‌ها در مسیر امن بررسی می‌شوند.'),
              },
              {
                icon: ShieldCheck,
                title: t('تأیید فروشگاه'),
                text: t('پس از تأیید اعتبار و چک، شرایط نهایی سفارش اعلام می‌شود.'),
              },
              {
                icon: Check,
                title: t('نهایی‌سازی سفارش'),
                text:
                  locale === 'fa'
                    ? 'پس از دریافت پیش‌پرداخت و تأیید دستی همهٔ چک‌ها، فرایند آماده‌سازی آغاز می‌شود.'
                    : 'Preparation starts after receiving the down payment and manually approving every cheque.',
              },
            ].map((step, i) => (
              <article key={step.title}>
                <span className="process-number">0{t(i + 1)}</span>
                <step.icon size={27} />
                <h3>{t(step.title)}</h3>
                <p>{t(step.text)}</p>
              </article>
            )),
          )}
        </div>
        <div className="notice">
          {isPreview
            ? t(
                'در این نسخه درخواست اعتبار ثبت یا مدرکی دریافت نمی‌شود. طرح واقعی و شرایط پذیرش چک پس از تعیین توسط مدیر فروشگاه منتشر خواهد شد.',
              )
            : locale === 'fa'
              ? 'خرید چکی به بررسی فروشگاه نیاز دارد. مبلغ محاسبه‌گر مجوز خرید یا ارسال نیست؛ دریافت پیش‌پرداخت و تأیید دستی همهٔ چک‌ها الزامی است.'
              : 'Cheque purchases require store review. This estimate does not authorize purchase or shipping; receipt of the down payment and manual approval of every cheque are required.'}
        </div>
      </section>
    </div>
  );
}
