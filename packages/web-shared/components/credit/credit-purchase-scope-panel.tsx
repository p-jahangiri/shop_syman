'use client';
import { advanceRequestGeneration } from '../../lib/data/request-generation';
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import {
  creditScopeCommandSchema,
  creditScopeCommandPath,
  readCreditPurchaseScopePage,
  type CreditScopeCommand,
  type CreditPurchaseScopePage,
} from '../../lib/credit/credit-purchase-scope-contract';
import {
  readCreditReviewDetail,
  type CreditReviewDetail,
} from '../../lib/credit/credit-review-contract';
import type { CreditScopeJournal } from '../../lib/credit/credit-purchase-scope-journal';
import type { CreditApplicationTransport } from './credit-applications-workspace';
import { formatToman } from '../../lib/shared/money';
const noSubscribe = () => () => {};
export function CreditPurchaseScopePanel({
  owner,
  applicationId,
  locale,
  transport,
  staff = false,
  journal,
  refreshToken = 0,
  blocked = false,
}: {
  owner: string;
  applicationId: string;
  locale: 'fa' | 'en';
  transport: CreditApplicationTransport;
  staff?: boolean;
  journal?: CreditScopeJournal;
  refreshToken?: number;
  blocked?: boolean;
}) {
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en),
    prefix = staff ? '/api/admin/credit' : '/api/credit',
    path = prefix + '/applications/' + applicationId;
  const [page, setPage] = useState<CreditPurchaseScopePage | null>(null),
    [approval, setApproval] = useState<CreditReviewDetail | null>(null),
    [loading, setLoading] = useState(true),
    [failed, setFailed] = useState(false),
    [refresh, setRefresh] = useState(0),
    [basis, setBasis] = useState(''),
    [grantConfirmed, setGrantConfirmed] = useState(false),
    [revokeConfirmed, setRevokeConfirmed] = useState(false),
    [note, setNote] = useState(''),
    [invalid, setInvalid] = useState(false);
  const generation = useRef(0),
    all = useSyncExternalStore(
      journal?.subscribe ?? noSubscribe,
      () => journal?.snapshot(owner) ?? null,
      () => null,
    ),
    entry = all?.command.applicationId === applicationId ? all : null,
    unresolved = entry?.state === 'pending' || entry?.state === 'unknown';
  useEffect(() => {
    const current = ++generation.current,
      abort = new AbortController();
    setPage(null);
    setApproval(null);
    setLoading(true);
    setFailed(false);
    setBasis('');
    setGrantConfirmed(false);
    setRevokeConfirmed(false);
    setNote('');
    setInvalid(false);
    void (async () => {
      const p = readCreditPurchaseScopePage(
        await transport(path + '/purchase-scope', { signal: abort.signal }),
        applicationId,
        staff,
      );
      let review: CreditReviewDetail | null = null;
      if (p.canGrant && p.reviewId) {
        review = readCreditReviewDetail(
          await transport(path + '/reviews/' + p.reviewId, { signal: abort.signal }),
          applicationId,
          p.reviewId,
        );
        if (
          review.application.version !== p.application.version ||
          review.application.state !== 'Approved' ||
          review.review.outcome !== 'Approved'
        )
          throw Error('Approval changed');
      }
      if (current === generation.current && !abort.signal.aborted) {
        setPage(p);
        setApproval(review);
      }
    })()
      .catch(() => {
        if (current === generation.current && !abort.signal.aborted) setFailed(true);
      })
      .finally(() => {
        if (current === generation.current && !abort.signal.aborted) setLoading(false);
      });
    return () => {
      advanceRequestGeneration(generation);
      abort.abort();
    };
  }, [owner, applicationId, staff, transport, refreshToken, refresh, path]);
  async function send(c: CreditScopeCommand, retry = false) {
    if (!journal) return;
    let started = false;
    try {
      if (retry) journal.retry(owner);
      else journal.begin(owner, c);
      started = true;
      journal.finish(
        owner,
        c,
        await transport(creditScopeCommandPath(c), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(c.body),
        }),
      );
    } catch (error) {
      if (started) {
        const e = error as { status?: number; code?: string };
        journal.fail(owner, c, e.status ?? 0, e.code ?? 'credit_application_unavailable');
      }
    }
  }
  async function receipt() {
    if (!journal || entry?.state !== 'unknown') return;
    let c: CreditScopeCommand | undefined;
    try {
      c = journal.retry(owner);
      journal.finish(owner, c, await transport(creditScopeCommandPath(c, true)));
    } catch (error) {
      if (c) {
        const e = error as { status?: number; code?: string };
        journal.fail(owner, c, e.status ?? 0, e.code ?? 'credit_application_unavailable');
      }
    }
  }
  function submit(e: FormEvent, kind: 'Grant' | 'Revoke') {
    e.preventDefault();
    if (
      !journal ||
      !page ||
      blocked ||
      unresolved ||
      loading ||
      failed ||
      (kind === 'Grant' && (!staff || !page.canGrant || !approval)) ||
      (kind === 'Revoke' && !page.canRevoke)
    )
      return;
    const command = creditScopeCommandSchema.safeParse({
      id: crypto.randomUUID().replaceAll('-', ''),
      applicationId,
      staff,
      kind,
      ...(kind === 'Grant'
        ? {
            approval: {
              approvedAmountRial: approval!.review.approvedAmountRial,
              expiresAt: approval!.review.expiresAt,
              submissionId: approval!.review.submissionId,
            },
          }
        : {}),
      body:
        kind === 'Grant'
          ? {
              applicationVersion: page.application.version,
              reviewId: page.reviewId,
              limitBasis: basis,
              grantConfirmed,
            }
          : {
              applicationVersion: page.application.version,
              scopeVersion: page.scope?.version,
              locale,
              note: note.trim(),
              revokeConfirmed,
            },
    });
    if (!command.success) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    void send(command.data);
  }
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Tehran',
    }).format(new Date(value));
  const basisName = (value: string) =>
    value === 'PayableTotalRial'
      ? text(
          'کل تعهد خرید، شامل پیش‌پرداخت و چک‌ها و هزینه‌های نهایی',
          'Total purchase obligation, including down payment, cheques and final charges',
        )
      : text(
          'جمع چک‌ها با افزایش مبلغ؛ بدون پیش‌پرداخت',
          'Total cheques including markup; excluding down payment',
        );
  const blockers: Record<string, string> = {
    credit_scope_grant_write_required: text(
      'صدور مجوز فقط در اختیار بازبین دارای دسترسی ثبت است.',
      'Only a reviewer with write access can grant a purchase scope.',
    ),
    credit_application_not_approved: text(
      'پرونده هنوز تأیید بررسی معتبر ندارد.',
      'The application has no approved review.',
    ),
    credit_scope_plan_changed: text(
      'طرح جاری تغییر کرده یا غیرفعال شده است؛ استفاده در خرید مجاز نیست.',
      'The current plan changed or was disabled. Purchase use is unavailable.',
    ),
    credit_scope_already_granted: text(
      'برای این تأییدیه قبلاً مجوز صادر شده است.',
      'A scope was already granted for this approval.',
    ),
    credit_scope_expired: text(
      'مهلت تأییدیه یا مجوز پایان یافته است.',
      'The approval or scope has expired.',
    ),
    private_file_unavailable: text(
      'دسترسی امن مدارک آماده نیست.',
      'Secure document access is unavailable.',
    ),
    credit_scope_used: text(
      'مجوز برای یک سفارش استفاده شده است؛ برای خرید تازه، درخواست و تأیید تازه لازم است.',
      'This scope was used for an order. A new purchase requires a new application and approval.',
    ),
    credit_scope_required: text(
      'مجوز استفاده در خرید هنوز صادر نشده است.',
      'A purchase scope has not been granted.',
    ),
    credit_scope_revoked: text(
      'مجوز استفاده در خرید باطل شده است.',
      'The purchase scope was revoked.',
    ),
  };
  return (
    <section className="credit-scope-panel">
      <div className="ticket-heading">
        <h3>{text('مجوز استفاده از تأییدیه در خرید', 'Purchase use of approval')}</h3>
        <button
          type="button"
          disabled={loading || blocked || unresolved}
          onClick={() => setRefresh((n) => n + 1)}
        >
          {text('تازه‌سازی مجوز خرید', 'Refresh purchase scope')}
        </button>
      </div>
      <p>
        {text(
          'این مجوز برای یک خرید است. ثبت آن هنوز سفارش، رزرو کالا یا پرداخت ایجاد نمی‌کند.',
          'This scope is for one purchase. Granting it does not create an order, reserve stock or take payment.',
        )}
      </p>
      {entry && (
        <div className="ticket-command" role={entry.state === 'rejected' ? 'alert' : 'status'}>
          <strong>
            {entry.state === 'done'
              ? text('فرمان مجوز ثبت شد', 'Scope command recorded')
              : entry.state === 'rejected'
                ? text(
                    'فرمان پذیرفته نشد؛ وضعیت و مجوز را تازه کنید.',
                    'Command rejected. Refresh status and permissions.',
                  )
                : text(
                    'نتیجهٔ فرمان مجوز هنوز مشخص نیست',
                    'The scope command outcome is not confirmed',
                  )}
          </strong>
          <p>
            {text('شناسهٔ پیگیری', 'Tracking ID')}: <bdi>{entry.command.id}</bdi>
          </p>
          {entry.state === 'pending' ? (
            <p>{text('در حال ثبت…', 'Saving…')}</p>
          ) : entry.state === 'unknown' ? (
            <>
              <p>
                {text(
                  'ابتدا رسید را بررسی کنید. تلاش دوباره دقیقاً همان شناسه و فرمان را می‌فرستد.',
                  'Check the receipt first. Retry sends exactly the same ID and command.',
                )}
              </p>
              <div className="ticket-actions">
                <button type="button" onClick={() => void receipt()}>
                  {text('بررسی رسید مجوز', 'Check scope receipt')}
                </button>
                <button type="button" onClick={() => void send(entry.command, true)}>
                  {text('تلاش دوبارهٔ همان فرمان مجوز', 'Retry the same scope command')}
                </button>
              </div>
            </>
          ) : (
            <button type="button" onClick={() => journal?.clear(owner)}>
              {text('بستن نتیجه', 'Close result')}
            </button>
          )}
        </div>
      )}
      {loading && (
        <p role="status">{text('در حال دریافت مجوز خرید…', 'Loading purchase scope…')}</p>
      )}
      {failed && (
        <p role="alert">
          {text(
            'وضعیت مجوز خوانده نشد؛ دوباره دریافت کنید.',
            'The purchase scope could not be loaded. Refresh and retry.',
          )}
        </p>
      )}
      {page && (
        <>
          <ul>
            {[...new Set([...page.quoteBlockers, ...(staff ? page.grantBlockers : [])])].map(
              (code) => (
                <li key={code}>{blockers[code]}</li>
              ),
            )}
          </ul>
          {page.scope && (
            <>
              <dl className="credit-terms">
                <dt>{text('وضعیت مجوز', 'Scope state')}</dt>
                <dd>
                  {page.scope.state === 'Active'
                    ? text('فعال', 'Active')
                    : page.scope.state === 'Revoked'
                      ? text('باطل‌شده', 'Revoked')
                      : page.scope.state === 'Used'
                        ? text('استفاده‌شده', 'Used')
                        : text('منقضی', 'Expired')}
                </dd>
                <dt>{text('مبنای سقف', 'Limit basis')}</dt>
                <dd>{basisName(page.scope.limitBasis)}</dd>
                <dt>{text('سقف تأییدشده', 'Approved limit')}</dt>
                <dd>
                  {formatToman(page.scope.limitAmountRial, locale)} {text('تومان', 'toman')}
                </dd>
                <dt>{text('انقضا', 'Expiry')}</dt>
                <dd>{date(page.scope.expiresAt)}</dd>
              </dl>
              {page.scope.use && (
                <p>
                  {text('سفارش مربوط به این مجوز', 'Order using this scope')}:{' '}
                  <bdi>{page.scope.use.orderId}</bdi> · {date(page.scope.use.at)}
                </p>
              )}
              {page.scope.revocation && (
                <div>
                  <p>
                    {text('ابطال توسط', 'Revoked by')}:{' '}
                    {page.scope.revocation.actorKind === 'Owner'
                      ? text('صاحب پرونده', 'Application owner')
                      : text('بازبین', 'Reviewer')}{' '}
                    · {date(page.scope.revocation.at)}
                  </p>
                  {page.scope.revocation.note && (
                    <p
                      className="credit-private-note"
                      lang={page.scope.revocation.locale}
                      dir={page.scope.revocation.locale === 'fa' ? 'rtl' : 'ltr'}
                    >
                      {page.scope.revocation.note}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
          {page.canGrant && approval && journal && (
            <form onSubmit={(e) => submit(e, 'Grant')}>
              <p>
                {text(
                  'مبلغ و انقضا از همین تأییدیه حفظ می‌شوند و در این مرحله قابل افزایش نیستند.',
                  'The amount and expiry are copied from this approval and cannot be increased here.',
                )}
              </p>
              <p>
                {formatToman(approval.review.approvedAmountRial!, locale)}{' '}
                {text('تومان؛ انقضا', 'toman; expiry')}: {date(approval.review.expiresAt!)}
              </p>
              <p
                className="credit-private-note"
                lang={approval.review.locale}
                dir={approval.review.locale === 'fa' ? 'rtl' : 'ltr'}
              >
                {approval.note}
              </p>
              <label className="ticket-field">
                <span>{text('مبنای صریح سقف مجاز', 'Explicit purchase limit basis')}</span>
                <select
                  required
                  value={basis}
                  disabled={blocked || unresolved}
                  onChange={(e) => {
                    setBasis(e.target.value);
                    setGrantConfirmed(false);
                  }}
                >
                  <option value="">
                    {text('مبنای سقف را انتخاب کنید', 'Choose the limit basis')}
                  </option>
                  <option value="PayableTotalRial">{basisName('PayableTotalRial')}</option>
                  <option value="InstallmentsTotalRial">
                    {basisName('InstallmentsTotalRial')}
                  </option>
                </select>
              </label>
              <label className="credit-confirmation">
                <input
                  type="checkbox"
                  checked={grantConfirmed}
                  disabled={blocked || unresolved}
                  onChange={(e) => setGrantConfirmed(e.target.checked)}
                />
                <span>
                  {text(
                    'تأییدیه و مبنای سقف را بررسی کردم و مجوز یک خرید را صادر می‌کنم.',
                    'I reviewed the approval and limit basis and grant use for one purchase.',
                  )}
                </span>
              </label>
              <button type="submit" disabled={blocked || unresolved || !basis || !grantConfirmed}>
                {text('صدور مجوز یک خرید', 'Grant one purchase scope')}
              </button>
            </form>
          )}
          {page.canRevoke && journal && (
            <form onSubmit={(e) => submit(e, 'Revoke')}>
              <label className="ticket-field">
                <span>
                  {staff
                    ? text(
                        'دلیل ابطال — قابل مشاهدهٔ مشتری',
                        'Revocation reason — visible to the customer',
                      )
                    : text('یادداشت ابطال — اختیاری', 'Revocation note — optional')}
                </span>
                <textarea
                  required={staff}
                  maxLength={2000}
                  value={note}
                  disabled={blocked || unresolved}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <label className="credit-confirmation">
                <input
                  type="checkbox"
                  checked={revokeConfirmed}
                  disabled={blocked || unresolved}
                  onChange={(e) => setRevokeConfirmed(e.target.checked)}
                />
                <span>
                  {text(
                    'مجوز استفاده‌نشدهٔ همین تأییدیه را با حفظ سابقه باطل می‌کنم.',
                    'I revoke this unused purchase scope while retaining its history.',
                  )}
                </span>
              </label>
              <button
                type="submit"
                disabled={blocked || unresolved || !revokeConfirmed || (staff && !note.trim())}
              >
                {text('ابطال مجوز خرید', 'Revoke purchase scope')}
              </button>
            </form>
          )}
        </>
      )}
      {invalid && (
        <p role="alert">
          {text(
            'مبنا، تأیید صریح و یادداشت لازم را بررسی کنید.',
            'Check the basis, explicit confirmation and required note.',
          )}
        </p>
      )}
    </section>
  );
}
