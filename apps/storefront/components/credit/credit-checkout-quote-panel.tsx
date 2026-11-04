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
import {
  digitalOrderCapacityCode,
  digitalMetadataCapacityCode,
  digitalOrderCapacityMessage,
} from '../../lib/orders/order-capacity-message';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react';
import { CreditOrderForm } from './credit-order-form';
import { useShop } from '../providers/shop-context';
import { useCustomerSession } from '../auth/auth-provider';
import { useI18n, useStorefront } from '../navigation/locale-provider';
import Link from '../navigation/localized-link';
import { UsedConditionReport } from '@sayman/web-shared/components/catalog/used-condition';
import { formatToman } from '@sayman/web-shared/lib/shared/money.ts';
import {
  readCreditApplicationPage,
  type CreditApplicationSummary,
} from '@sayman/web-shared/lib/credit/credit-application-contract.ts';
import {
  readCreditPurchaseScopePage,
  type CreditPurchaseScopePage,
} from '@sayman/web-shared/lib/credit/credit-purchase-scope-contract.ts';
import {
  creditCheckoutQuoteCommandSchema,
  creditCheckoutQuoteCommandPath,
  type CreditCheckoutQuoteCommand,
  type CreditCheckoutQuote,
} from '@sayman/web-shared/lib/credit/credit-checkout-quote-contract.ts';
import { customerCreditCheckoutQuoteJournal as journal } from '../../lib/credit/credit-checkout-quote-journal';

export function CreditCheckoutQuotePanel({
  cartVersion,
  methodId,
  planId,
  disabled = false,
  recoveryOnly = false,
}: {
  cartVersion: string | null;
  methodId: string | null;
  planId: string | null;
  disabled?: boolean;
  recoveryOnly?: boolean;
}) {
  const auth = useCustomerSession(),
    shop = useShop(),
    { locale } = useI18n(),
    owner = auth.status === 'member' ? auth.session!.user.id : null,
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const { purchaseMethods } = useStorefront();
  const entry = useSyncExternalStore(
      journal.subscribe,
      () => journal.snapshot(owner),
      () => null,
    ),
    unresolved = entry?.state === 'pending' || entry?.state === 'unknown';
  const retainedMethodId = entry?.command.body.methodId;
  const retainedMethodEnabled = purchaseMethods.some(
    (method) => method.enabled && method.id === retainedMethodId,
  );
  const [cases, setCases] = useState<CreditApplicationSummary[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [listBusy, setListBusy] = useState(false),
    [listFailed, setListFailed] = useState(false),
    [selected, setSelected] = useState(''),
    [scope, setScope] = useState<CreditPurchaseScopePage | null>(null),
    [scopeBusy, setScopeBusy] = useState(false),
    [scopeFailed, setScopeFailed] = useState(false),
    [refresh, setRefresh] = useState(0),
    [now, setNow] = useState(0);
  const generation = useRef(0),
    scopeGeneration = useRef(0),
    abort = useRef<AbortController | null>(null);
  const transport = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const expected = auth.store.snapshot().session?.user.id,
        response = await auth.store.fetch(path, init),
        raw = await response.json().catch(() => null),
        current = auth.store.snapshot();
      if (current.status !== 'member' || current.session?.user.id !== expected)
        throw Object.assign(Error('Session changed'), { status: 0, code: 'session_changed' });
      if (!response.ok)
        throw Object.assign(Error('Cheque quote unavailable'), {
          status: response.status,
          code: typeof raw?.title === 'string' ? raw.title : 'credit_quote_unavailable',
        });
      return raw;
    },
    [auth.store],
  );
  const load = useCallback(
    async (
      after: string | null,
      replace: boolean,
      ticket: number,
      previous: CreditApplicationSummary[] = [],
    ) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setListBusy(true);
      setListFailed(false);
      try {
        const query = new URLSearchParams({ state: 'Approved' });
        if (after) query.set('cursor', after);
        const page = readCreditApplicationPage(
          await transport('/api/credit/applications?' + query, { signal: controller.signal }),
          'Approved',
        );
        if (ticket !== generation.current || controller.signal.aborted) return;
        const items = replace ? page.items : [...previous, ...page.items];
        if (new Set(items.map((i) => i.id)).size !== items.length)
          throw Error('Duplicate private application');
        setCases(items);
        setCursor(page.nextCursor);
      } catch {
        if (ticket === generation.current && !controller.signal.aborted) setListFailed(true);
      } finally {
        if (ticket === generation.current && !controller.signal.aborted) setListBusy(false);
      }
    },
    [transport],
  );
  useEffect(() => {
    const ticket = ++generation.current;
    setCases([]);
    setCursor(null);
    setSelected('');
    setScope(null);
    setListFailed(false);
    if (owner && planId && !recoveryOnly) void load(null, true, ticket);
    return () => {
      advanceRequestGeneration(generation);
      abort.current?.abort();
    };
  }, [owner, planId, recoveryOnly, refresh, load]);
  useEffect(() => {
    const ticket = ++scopeGeneration.current,
      controller = new AbortController();
    setScope(null);
    setScopeFailed(false);
    setScopeBusy(!!selected);
    if (owner && selected)
      void transport('/api/credit/applications/' + selected + '/purchase-scope', {
        signal: controller.signal,
      })
        .then((raw) => {
          const page = readCreditPurchaseScopePage(raw, selected);
          if (page.application.planId !== planId) throw Error('Wrong plan');
          if (ticket === scopeGeneration.current && !controller.signal.aborted) setScope(page);
        })
        .catch(() => {
          if (ticket === scopeGeneration.current && !controller.signal.aborted)
            setScopeFailed(true);
        })
        .finally(() => {
          if (ticket === scopeGeneration.current && !controller.signal.aborted) setScopeBusy(false);
        });
    return () => {
      advanceRequestGeneration(scopeGeneration);
      controller.abort();
    };
  }, [owner, selected, planId, refresh, transport]);
  useEffect(() => () => journal.interrupt(), []);
  const hasQuoteTimer = entry !== null || !!scope?.scope;
  useEffect(() => {
    if (!hasQuoteTimer) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasQuoteTimer]);
  useEffect(() => {
    if (!unresolved) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unresolved]);
  async function send(c: CreditCheckoutQuoteCommand, retry = false) {
    if (!owner) return;
    let started = false;
    try {
      if (retry) journal.retry(owner);
      else journal.begin(owner, c);
      started = true;
      journal.finish(
        owner,
        c,
        await transport(creditCheckoutQuoteCommandPath(c), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(c.body),
        }),
      );
    } catch (error) {
      if (started) {
        const e = error as { status?: number; code?: string };
        journal.fail(owner, c, e.status ?? 0, e.code ?? 'credit_quote_unavailable');
      }
    }
  }
  async function receipt() {
    if (!owner || entry?.state !== 'unknown') return;
    let c: CreditCheckoutQuoteCommand | undefined;
    try {
      c = journal.retry(owner);
      journal.finish(owner, c, await transport(creditCheckoutQuoteCommandPath(c)));
    } catch (error) {
      if (c) {
        const e = error as { status?: number; code?: string };
        journal.fail(owner, c, e.status ?? 0, e.code ?? 'credit_quote_unavailable');
      }
    }
  }
  const scopeExpired = !!scope?.scope && Date.parse(scope.scope.expiresAt) <= (now || Date.now()),
    canCalculate =
      !!owner &&
      !disabled &&
      !unresolved &&
      !scopeBusy &&
      !scopeFailed &&
      scope?.eligibleForQuote &&
      !scopeExpired &&
      !!cartVersion &&
      !!methodId &&
      !!planId;
  function calculate(e: FormEvent) {
    e.preventDefault();
    if (!canCalculate || !scope?.scope) return;
    const c = creditCheckoutQuoteCommandSchema.parse({
      id: crypto.randomUUID().replaceAll('-', ''),
      locale,
      body: {
        cartVersion,
        methodId,
        planId,
        applicationId: scope.application.id,
        scopeId: scope.scope.id,
        applicationVersion: scope.application.version,
        scopeVersion: scope.scope.version,
      },
      scopeSnapshot: {
        reviewId: scope.scope.reviewId,
        submissionId: scope.scope.submissionId,
        limitBasis: scope.scope.limitBasis,
        limitAmountRial: scope.scope.limitAmountRial,
        expiresAt: scope.scope.expiresAt,
      },
    });
    void send(c);
  }
  const date = (value: string) =>
      new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Tehran',
      }).format(new Date(value)),
    amount = (value: string) => formatToman(value, locale) + ' ' + text('تومان', 'toman');
  const blockers: Record<string, string> = {
    credit_application_not_approved: text(
      'پرونده تأیید بررسی ندارد.',
      'The application has no approved review.',
    ),
    credit_scope_plan_changed: text(
      'طرح تغییر کرده یا غیرفعال شده است.',
      'The plan changed or was disabled.',
    ),
    credit_scope_required: text(
      'بازبین هنوز برای این تأییدیه مجوز خرید صادر نکرده است.',
      'A reviewer has not granted a purchase scope for this approval.',
    ),
    credit_scope_revoked: text('مجوز این پرونده باطل شده است.', 'This purchase scope was revoked.'),
    credit_scope_used: text(
      'مجوز این پرونده برای یک سفارش استفاده شده است.',
      'This purchase scope has been used for an order.',
    ),
    credit_scope_expired: text('مهلت مجوز پایان یافته است.', 'This purchase scope has expired.'),
  };
  return (
    <section className="card-panel credit-checkout-quote-panel">
      <h2>
        {recoveryOnly
          ? text('پیگیری محاسبهٔ قبلی', 'Review a previous calculation')
          : text('محاسبهٔ خرید چکی با تأییدیه', 'Calculate cheque purchase with approval')}
      </h2>
      {!recoveryOnly && (
        <p>
          {text(
            'تأییدیهٔ همین حساب و طرح را صریحاً انتخاب کنید. قیمت، اقساط و هزینه‌ها دوباره از سرور محاسبه می‌شوند. این مرحله سفارش یا رزرو ایجاد نمی‌کند.',
            'Explicitly choose an approval owned by this account for the selected plan. Prices, cheques and charges are recalculated by the server. This stage creates no order or reservation.',
          )}
        </p>
      )}
      {!owner ? (
        <p>
          <Link href="/account?returnTo=/checkout">
            {text('ورود به حساب صاحب تأییدیه', 'Sign in to the approval owner’s account')}
          </Link>
        </p>
      ) : (
        <>
          {entry && (
            <div
              className="credit-quote-command"
              role={entry.state === 'rejected' ? 'alert' : 'status'}
            >
              <strong>
                {entry.state === 'done'
                  ? text('محاسبهٔ مقید به مجوز ثبت شد', 'Approval-bound calculation recorded')
                  : entry.state === 'rejected'
                    ? entry.code === digitalOrderCapacityCode ||
                      entry.code === digitalMetadataCapacityCode
                      ? digitalOrderCapacityMessage(
                          locale,
                          entry.code === digitalMetadataCapacityCode ? 'metadata' : 'capacity',
                        )
                      : text(
                          'محاسبه پذیرفته نشد؛ سبد، طرح و مجوز را تازه کنید.',
                          'Calculation rejected. Refresh the cart, plan and purchase scope.',
                        )
                    : entry.state === 'pending'
                      ? text('در حال ثبت محاسبه…', 'Recording calculation…')
                      : text(
                          'پاسخ محاسبه هنوز مشخص نیست',
                          'The calculation outcome is not confirmed',
                        )}
              </strong>
              <p>
                {text('شناسهٔ پیگیری', 'Tracking ID')}: <bdi>{entry.command.id}</bdi>
              </p>
              {entry.state === 'unknown' ? (
                <>
                  <p>
                    {text(
                      'ابتدا رسید را بررسی کنید؛ تلاش دوباره همان شناسه، نسخه‌ها و انتخاب قبلی را می‌فرستد.',
                      'Check the receipt first. Retry sends the same ID, versions and original selection.',
                    )}
                  </p>
                  <div className="credit-quote-actions">
                    <button type="button" onClick={() => void receipt()}>
                      {text('بررسی رسید محاسبهٔ چکی', 'Check cheque calculation receipt')}
                    </button>
                    <button type="button" onClick={() => void send(entry.command, true)}>
                      {text('تلاش دوبارهٔ همان محاسبهٔ چکی', 'Retry the same cheque calculation')}
                    </button>
                  </div>
                </>
              ) : (
                entry.state !== 'pending' && (
                  <button type="button" onClick={() => journal.clear(owner)}>
                    {text('بستن نتیجهٔ محاسبه', 'Close calculation result')}
                  </button>
                )
              )}
            </div>
          )}
          {entry?.state === 'done' && entry.result && (
            <>
              <CreditCheckoutQuoteSnapshot quote={entry.result.quote} now={now || Date.now()} />
              <CreditOrderForm
                quote={entry.result.quote}
                recoveryOnly={!retainedMethodEnabled}
                disabled={(!recoveryOnly && disabled) || unresolved}
                onCreated={shop.retry}
              />
            </>
          )}
          {!recoveryOnly && (
            <>
              <form onSubmit={calculate}>
                <div className="credit-quote-actions">
                  <button
                    type="button"
                    disabled={unresolved || listBusy || disabled}
                    onClick={() => setRefresh((x) => x + 1)}
                  >
                    {text('دریافت تأییدیه‌های تازه', 'Refresh approvals')}
                  </button>
                  <Link href="/credit">
                    {text('پرونده‌ها و مجوزهای خرید من', 'My applications and purchase scopes')}
                  </Link>
                </div>
                {listBusy && (
                  <p role="status">{text('در حال دریافت پرونده‌ها…', 'Loading applications…')}</p>
                )}
                {listFailed && (
                  <p role="alert">
                    {text(
                      'تأییدیه‌ها خوانده نشدند؛ دوباره دریافت کنید.',
                      'Approvals could not be loaded. Refresh and retry.',
                    )}
                  </p>
                )}
                <label className="field">
                  <span>{text('تأییدیهٔ صریح برای این طرح', 'Approval for this plan')}</span>
                  <select
                    className="control-input"
                    value={selected}
                    required
                    disabled={unresolved || disabled || listBusy || listFailed}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    <option value="">
                      {text('یک پروندهٔ تأییدشده انتخاب کنید', 'Choose an approved application')}
                    </option>
                    {cases
                      .filter((c) => c.planId === planId)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {date(c.createdAt)} · {amount(c.requestedAmountRial)} · {c.id}
                        </option>
                      ))}
                  </select>
                </label>
                {!listBusy && !listFailed && !cases.some((c) => c.planId === planId) && (
                  <p>
                    {text(
                      'در این صفحه تأییدیه‌ای برای طرح انتخاب‌شده نیست. درخواست را از بخش پرونده‌ها پیگیری کنید.',
                      'This page has no approval for the selected plan. Follow your request in applications.',
                    )}
                  </p>
                )}
                {cursor && (
                  <button
                    type="button"
                    disabled={listBusy || unresolved || disabled}
                    onClick={() => void load(cursor, false, generation.current, cases)}
                  >
                    {text('تأییدیه‌های بیشتر', 'More approvals')}
                  </button>
                )}
                {scopeBusy && (
                  <p role="status">
                    {text(
                      'در حال بررسی مجوز همین پرونده…',
                      'Checking this application’s purchase scope…',
                    )}
                  </p>
                )}
                {scopeFailed && (
                  <p role="alert">
                    {text(
                      'مجوز خوانده نشد؛ دوباره تأییدیه‌ها را دریافت کنید.',
                      'The scope could not be loaded. Refresh approvals.',
                    )}
                  </p>
                )}
                {scope && (
                  <>
                    <ul>
                      {scope.quoteBlockers.map((code) => (
                        <li key={code}>{blockers[code]}</li>
                      ))}
                    </ul>
                    {scope.scope && (
                      <p>
                        {text('سقف مجوز', 'Scope limit')}: {amount(scope.scope.limitAmountRial)} ·{' '}
                        {scope.scope.limitBasis === 'PayableTotalRial'
                          ? text('کل تعهد خرید', 'Total purchase obligation')
                          : text(
                              'جمع چک‌ها، بدون پیش‌پرداخت',
                              'Total cheques, excluding down payment',
                            )}{' '}
                        · {text('انقضا', 'Expiry')}: {date(scope.scope.expiresAt)}
                      </p>
                    )}
                    {scopeExpired && (
                      <p role="status">
                        {text(
                          'مهلت مجوز پایان یافته است؛ وضعیت تازه را دریافت کنید.',
                          'The scope has expired. Refresh its status.',
                        )}
                      </p>
                    )}
                  </>
                )}
                <button type="submit" disabled={!canCalculate}>
                  {text('محاسبه با همین مجوز خرید', 'Calculate with this purchase scope')}
                </button>
              </form>
            </>
          )}
        </>
      )}
    </section>
  );
}
export function CreditCheckoutQuoteSnapshot({
  quote,
  now,
}: {
  quote: CreditCheckoutQuote;
  now: number;
}) {
  const { locale } = useI18n(),
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en),
    q = quote.ordinaryQuote ?? quote.acceptedQuote!,
    money = (value: string | null) =>
      value === null
        ? text('تعیین نشده', 'Not configured')
        : formatToman(value, locale) + ' ' + text('تومان', 'toman');
  const blockers: Record<string, string> = {
    tax_unconfigured: text('مالیات تنظیم نشده است.', 'Tax is not configured.'),
    tax_basis_unavailable: text(
      'مبنای مالیات قابل محاسبه نیست.',
      'The taxable basis is unavailable.',
    ),
    shipping_unconfigured: text('هزینهٔ ارسال تنظیم نشده است.', 'Shipping is not configured.'),
    credit_quote_amount_unavailable: text(
      'مبلغ مبنای سقف هنوز مشخص نیست.',
      'The amount for the limit basis is unavailable.',
    ),
    credit_scope_limit_exceeded: text(
      'مبلغ خرید از سقف همین مجوز بیشتر است.',
      'The purchase exceeds this scope’s limit.',
    ),
    credit_quote_final_charges_unavailable: text(
      'جمع نهایی تا تعیین ارسال و مالیات مشخص نیست.',
      'The final total is unavailable until shipping and tax are configured.',
    ),
    credit_order_not_configured: text(
      'این نسخهٔ محاسبه به‌تنهایی سفارش نیست؛ ثبت سفارش به تأیید و بررسی جاری جداگانه نیاز دارد.',
      'This calculation alone is not an order. Creating an order requires a separate confirmation and current checks.',
    ),
  };
  return (
    <div className="credit-quote-snapshot">
      <h3>{text('نسخهٔ ثابت محاسبهٔ چکی', 'Retained cheque calculation')}</h3>
      <p>
        <bdi>{quote.id}</bdi>
      </p>
      <p>
        {text('زمان محاسبه', 'Calculated at')}:{' '}
        {new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'Asia/Tehran',
        }).format(new Date(quote.createdAt))}
      </p>
      {Date.parse(quote.expiresAt) <= now && (
        <p className="notice" role="status">
          {text(
            'مهلت این محاسبه پایان یافته است. رسید تاریخی محفوظ است؛ برای ادامه محاسبهٔ تازه لازم است.',
            'This calculation expired. The historical receipt is retained; calculate again to continue.',
          )}
        </p>
      )}
      <ul className="credit-quote-lines">
        {q.lines.map((line) => (
          <li key={'lineId' in line ? line.lineId : line.variantId}>
            <span lang={quote.locale} dir={quote.locale === 'fa' ? 'rtl' : 'ltr'}>
              {line.name} · {line.label}
            </span>
            <span>
              {' '}
              × {line.quantity.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-GB')} ·{' '}
              {money(line.lineTotalRial)}
            </span>
            <UsedConditionReport condition={line.usedCondition} locale={locale} />
            {'accepted' in line && line.accepted && (
              <details>
                <summary>{text('شرایط توافقی همین ردیف', 'Accepted terms for this line')}</summary>
                <p lang={quote.locale} dir={quote.locale === 'fa' ? 'rtl' : 'ltr'}>
                  {quote.locale === 'fa' ? line.accepted.termsFa : line.accepted.termsEn}
                </p>
              </details>
            )}
          </li>
        ))}
      </ul>
      <dl className="credit-quote-totals">
        <dt>{text('اصل کالاها', 'Items subtotal')}</dt>
        <dd>{money(q.itemsSubtotalRial)}</dd>
        <dt>{text('افزودهٔ طرح', 'Plan markup')}</dt>
        <dd>{money(q.markupRial)}</dd>
        <dt>{text('پیش‌پرداخت', 'Down payment')}</dt>
        <dd>{money(q.downPaymentRial)}</dd>
        <dt>{text('ارسال', 'Shipping')}</dt>
        <dd>
          {hasPostpaidShipping(q) ? postpaidShippingAmountLabel(locale) : money(q.shippingRial)}
        </dd>
        <dt>
          {q.chargeRules?.taxIncluded
            ? text('مالیات داخل قیمت', 'Tax included in price')
            : text('مالیات', 'Tax')}
        </dt>
        <dd>{hasUnitemizedTax(q) ? unitemizedTaxLabel(locale) : money(q.taxRial)}</dd>
        <dt>
          {hasPostpaidShipping(q)
            ? text('جمع مبلغ فروشگاه', 'Store total')
            : text('جمع نهایی', 'Final total')}
        </dt>
        <dd>{money(q.payableTotalRial)}</dd>
        <dt>{text('مبلغ مبنای سقف', 'Assessed limit amount')}</dt>
        <dd>{money(quote.assessment.assessedAmountRial)}</dd>
        <dt>{text('سقف مجوز', 'Scope limit')}</dt>
        <dd>{money(quote.authority.limitAmountRial)}</dd>
      </dl>
      {hasPostpaidShipping(q) && <p className="notice">{postpaidShippingNotice(locale)}</p>}
      {hasUnitemizedTax(q) && <p className="small-note">{unitemizedTaxNotice(locale)}</p>}
      <p>
        {quote.assessment.withinLimit === true
          ? text(
              'مبلغ محاسبه‌شده در سقف مجوز است. این نتیجهٔ زمان محاسبه است و هنگام سفارش دوباره بررسی می‌شود.',
              'The calculated amount is within the limit as of this calculation. It must be checked again at order placement.',
            )
          : quote.assessment.withinLimit === false
            ? text(
                'مبلغ محاسبه‌شده از سقف مجوز بیشتر است.',
                'The calculated amount exceeds the scope limit.',
              )
            : text(
                'مقایسهٔ سقف تا تعیین مبلغ نهایی ممکن نیست.',
                'The limit cannot be assessed until the final amount is available.',
              )}
      </p>
      <ol>
        {q.installments.map((c) => (
          <li key={c.sequence}>
            {text('چک', 'Cheque')} {c.sequence.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-GB')}{' '}
            · {text('ماه', 'Month')}{' '}
            {c.monthOffset.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-GB')} —{' '}
            {money(c.amountRial)}
          </li>
        ))}
      </ol>
      <ul>
        {quote.assessment.blockers.map((code) => (
          <li key={code}>
            {blockers[code] ??
              text('شرایط خرید نیاز به بازبینی دارد.', 'Purchase conditions need review.')}
          </li>
        ))}
      </ul>
    </div>
  );
}
