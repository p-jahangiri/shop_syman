'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useCustomerSession } from '../auth/auth-provider';
import { useI18n } from '../navigation/locale-provider';
import { Button } from '../shared/ui';
import {
  readRmaContext,
  readRmaDetail,
  readRmaPage,
  rmaCreateInputSchema,
  rmaWithdrawInputSchema,
  type RmaContext,
  type RmaDetail,
  type RmaPage,
} from '@sayman/web-shared/lib/orders/rma-contract.ts';
import { customerRmaJournal, rmaCommand } from '@sayman/web-shared/lib/orders/rma-journal.ts';
import { rmaErrorText, rmaRequest } from '@sayman/web-shared/lib/orders/rma-client.ts';
import { advanceRequestGeneration } from '@sayman/web-shared/lib/data/request-generation.ts';
import { RmaReceiptPanel } from '@sayman/web-shared/components/orders/rma-receipt-panel';
import {
  ReturnFinancialNotice,
  ReturnCaseDetail,
  returnStateNames as stateNames,
} from '@sayman/web-shared/components/orders/rma-case-detail';
export function CustomerReturns({ orderId }: { orderId: string }) {
  const auth = useCustomerSession(),
    { locale } = useI18n();
  const actor = auth.session?.user.id ?? null;
  if (auth.status !== 'member' || !actor) return null;
  return (
    <CustomerReturnsView
      key={`${actor}:${orderId}:${locale}`}
      orderId={orderId}
      actor={actor}
      locale={locale}
      store={auth.store}
    />
  );
}
export function CustomerReturnsView({
  orderId,
  actor,
  locale,
  store,
}: {
  orderId: string;
  actor: string;
  locale: 'fa' | 'en';
  store: {
    fetch: (path: string, init?: RequestInit) => Promise<Response>;
    snapshot: () => { session: { user: { id: string } } | null };
  };
}) {
  const [open, setOpen] = useState(false),
    [context, setContext] = useState<RmaContext | null>(null),
    [page, setPage] = useState<RmaPage | null>(null),
    [detail, setDetail] = useState<RmaDetail | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  const epoch = useRef(0),
    inflight = useRef(false);
  const copy = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const entry = useSyncExternalStore(
    customerRmaJournal.subscribe,
    () => customerRmaJournal.snapshot(actor),
    () => null,
  );
  const current = () => store.snapshot().session?.user.id === actor;
  const request = (path: string, init?: RequestInit) => rmaRequest(store.fetch, path, init);
  useEffect(() => {
    if (!open) return;
    const ticket = ++epoch.current;
    const abort = new AbortController();
    setBusy(true);
    setError('');
    setContext(null);
    setPage(null);
    setDetail(null);
    void Promise.all([
      request(`/api/orders/${orderId}/returns/context`, { signal: abort.signal }).then((raw) =>
        readRmaContext(raw, orderId),
      ),
      request('/api/returns', { signal: abort.signal }).then((raw) => readRmaPage(raw)),
    ])
      .then(([c, p]) => {
        if (ticket === epoch.current && current()) {
          setContext(c);
          setPage(p);
        }
      })
      .catch((e) => {
        if (ticket === epoch.current && current() && !abort.signal.aborted)
          setError(rmaErrorText(e, locale));
      })
      .finally(() => {
        if (ticket === epoch.current && current()) setBusy(false);
      });
    return () => {
      advanceRequestGeneration(epoch);
      abort.abort();
    };
    // Request closure uses only the stable store and immutable actor/order/locale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orderId, actor, store, locale, attempt]);
  useEffect(
    () => () => {
      advanceRequestGeneration(epoch);
    },
    [],
  );
  async function select(caseId: string) {
    if (inflight.current) return;
    inflight.current = true;
    const ticket = epoch.current;
    setBusy(true);
    setDetail(null);
    setError('');
    try {
      const d = readRmaDetail(await request(`/api/returns/${caseId}`), { caseId, orderId });
      if (ticket === epoch.current && current()) setDetail(d);
    } catch (e) {
      if (ticket === epoch.current && current()) setError(rmaErrorText(e, locale));
    } finally {
      inflight.current = false;
      if (ticket === epoch.current && current()) setBusy(false);
    }
  }
  async function more() {
    if (inflight.current || !page?.nextCursor) return;
    inflight.current = true;
    const ticket = epoch.current;
    setBusy(true);
    try {
      const next = readRmaPage(
        await request(`/api/returns?after=${encodeURIComponent(page.nextCursor)}`),
      );
      if (ticket === epoch.current && current())
        setPage((p) =>
          p
            ? {
                ...next,
                items: [
                  ...p.items,
                  ...next.items.filter((x) => !p.items.some((y) => y.id === x.id)),
                ],
              }
            : next,
        );
    } catch (e) {
      if (ticket === epoch.current && current()) setError(rmaErrorText(e, locale));
    } finally {
      inflight.current = false;
      if (ticket === epoch.current && current()) setBusy(false);
    }
  }
  return (
    <section className="card-panel">
      <h2>{copy('مرجوعی و مشکل کالای دیجیتال', 'Returns and digital-item issues')}</h2>
      <p>
        {copy(
          'انتخاب اقلام از سابقهٔ همین سفارش و طبق شرایط معتبر سرور انجام می‌شود.',
          'Items are selected from this order’s historical record under current server policy.',
        )}
      </p>
      <Button
        variant="outline"
        onClick={() => {
          setOpen((v) => !v);
          setDetail(null);
        }}
      >
        {open
          ? copy('بستن بخش درخواست', 'Close requests')
          : copy('ثبت یا پیگیری درخواست', 'Create or track a request')}
      </Button>
      {open && (
        <>
          <ReturnFinancialNotice locale={locale} />
          <RmaReceiptPanel
            journal={customerRmaJournal}
            actor={actor}
            request={request}
            locale={locale}
            onResolved={() => setAttempt((v) => v + 1)}
          />
          {busy && <p role="status">{copy('در حال دریافت…', 'Loading…')}</p>}
          {error && <p role="alert">{error}</p>}
          <Button variant="outline" disabled={busy} onClick={() => setAttempt((v) => v + 1)}>
            {copy('تازه‌سازی وضعیت', 'Refresh status')}
          </Button>
          {context && (
            <>
              <h3>{copy('درخواست تازه', 'New request')}</h3>
              {context.policy.current && (
                <p className="preserve-lines">
                  {locale === 'fa'
                    ? context.policy.current.conditionsFa
                    : context.policy.current.conditionsEn}
                </p>
              )}
              {context.policy.current?.windowMode === 'deliveryDays' && (
                <p>
                  {copy(
                    `مهلت: ${context.policy.current.windowDays} روز از تحویل ثبت‌شدهٔ کالا یا آماده‌شدن محتوای دیجیتال؛ بازکردن محتوا مبدأ مهلت نیست.`,
                    `Window: ${context.policy.current.windowDays} days from recorded physical delivery or digital availability. Opening content does not start the window.`,
                  )}
                </p>
              )}
              {!context.canRequest && (
                <p role="status">
                  {context.blockers.map((b) => blockerText(b, locale)).join(' · ')}
                </p>
              )}
              {context.canRequest && !entry && (
                <CustomerReturnCreateForm
                  key={`${context.orderVersion}:${context.policy.current!.id}`}
                  context={context}
                  actor={actor}
                  locale={locale}
                  request={request}
                  current={current}
                  onSaved={() => setAttempt((v) => v + 1)}
                />
              )}
            </>
          )}
          {page && (
            <>
              <h3>{copy('سابقهٔ درخواست‌های این سفارش', 'Requests for this order')}</h3>
              {page.items
                .filter((c) => c.orderId === orderId)
                .map((c) => (
                  <div key={c.id} className="customer-order-item">
                    <div>
                      <strong>{c.reference}</strong>
                      <p>
                        {stateNames[c.state][locale === 'fa' ? 0 : 1]} ·{' '}
                        {c.kind === 'physicalReturn'
                          ? copy('کالای فیزیکی', 'Physical return')
                          : copy('مشکل دیجیتال', 'Digital issue')}
                        {c.outcome &&
                          ` · ${c.outcome === 'followUp' ? copy('نیازمند پیگیری', 'Follow-up needed') : copy('رد درخواست', 'Declined')}`}
                      </p>
                    </div>
                    <Button variant="outline" disabled={busy} onClick={() => void select(c.id)}>
                      {copy('جزئیات و سابقه', 'Details and history')}
                    </Button>
                  </div>
                ))}
              {page.nextCursor && (
                <Button variant="outline" disabled={busy} onClick={() => void more()}>
                  {copy('دریافت سوابق بیشتر', 'Load older requests')}
                </Button>
              )}
            </>
          )}
          {detail && <ReturnCaseDetail detail={detail} locale={locale} />}{' '}
          {detail?.canWithdraw && !entry && (
            <CustomerReturnWithdrawForm
              key={detail.case.version}
              detail={detail}
              actor={actor}
              locale={locale}
              request={request}
              current={current}
              onSaved={() => setAttempt((v) => v + 1)}
            />
          )}
        </>
      )}
    </section>
  );
}
function blockerText(code: string, locale: 'fa' | 'en') {
  const labels: Record<string, [string, string]> = {
    policy_unconfigured: ['شرایط هنوز تنظیم نشده‌اند', 'Policy is not configured'],
    policy_disabled: ['ثبت درخواست تازه غیرفعال است', 'New requests are disabled'],
    payment_not_confirmed: [
      'تأیید مالی سفارش ثبت نشده است',
      'Financial authorization is not confirmed',
    ],
    active_request_exists: ['این سفارش درخواست باز دارد', 'This order has an open request'],
    owner_request_capacity: ['سقف درخواست‌های باز تکمیل است', 'Open-request limit reached'],
    no_requestable_fulfillment: [
      'قلمی با تحویل معتبر و مهلت باز برای درخواست وجود ندارد',
      'No delivered/available item is eligible within the request window',
    ],
  };
  return (
    labels[code]?.[locale === 'fa' ? 0 : 1] ??
    (locale === 'fa' ? 'ثبت درخواست فعلاً مجاز نیست' : 'A new request is currently unavailable')
  );
}
function normalizeReason(value: string) {
  return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim();
}
export function CustomerReturnCreateForm({
  context,
  actor,
  locale,
  request,
  current,
  onSaved,
}: {
  context: RmaContext;
  actor: string;
  locale: 'fa' | 'en';
  request: (path: string, init?: RequestInit) => Promise<unknown>;
  current: () => boolean;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<'physicalReturn' | 'digitalComplaint'>(
      context.lines.some((l) => !l.isDigital && l.requestableQuantity > 0)
        ? 'physicalReturn'
        : 'digitalComplaint',
    ),
    [quantities, setQuantities] = useState<Record<string, number>>({}),
    [reason, setReason] = useState(''),
    [ack, setAck] = useState(false),
    [error, setError] = useState('');
  const locked = useRef(false);
  const copy = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const lines = context.lines.filter(
    (l) => l.isDigital === (kind === 'digitalComplaint') && l.requestableQuantity > 0,
  );
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (locked.current || !current() || customerRmaJournal.snapshot(actor)) return;
    setError('');
    let command;
    try {
      const body = rmaCreateInputSchema.parse({
        policyRevisionId: context.policy.current!.id,
        orderVersion: context.orderVersion,
        kind,
        lines: lines
          .filter((l) => quantities[l.lineKey] > 0)
          .map((l) => ({ lineKey: l.lineKey, quantity: quantities[l.lineKey] })),
        reason: normalizeReason(reason),
        acknowledgeNoFinancialAction: ack,
      });
      if (
        body.lines.some(
          (l) => l.quantity > lines.find((x) => x.lineKey === l.lineKey)!.requestableQuantity,
        )
      )
        throw Error();
      command = rmaCommand('create', body, { orderId: context.orderId });
      customerRmaJournal.begin(actor, command);
    } catch {
      setError(
        copy(
          'قلم، تعداد، دلیل و تأیید را کامل کنید.',
          'Select valid quantities, enter a reason and acknowledge the review process.',
        ),
      );
      return;
    }
    locked.current = true;
    setReason('');
    setQuantities({});
    setAck(false);
    try {
      const raw = await request(command.path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command.body),
      });
      if (current() && customerRmaJournal.finish(actor, command.commandId, raw)) onSaved();
    } catch (e) {
      const issue = e as { status?: number; code?: string };
      customerRmaJournal.fail(
        actor,
        command.commandId,
        issue.status ?? 0,
        issue.code ?? 'rma_unavailable',
      );
    } finally {
      locked.current = false;
    }
  }
  return (
    <form className="temporary-order" onSubmit={(e) => void submit(e)}>
      <div className="field">
        <label>
          {copy('نوع درخواست', 'Request type')}
          <select
            name="return-kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as typeof kind);
              setQuantities({});
              setAck(false);
            }}
          >
            {context.lines.some((l) => !l.isDigital && l.requestableQuantity > 0) && (
              <option value="physicalReturn">
                {copy('درخواست مرجوعی فیزیکی', 'Physical return request')}
              </option>
            )}
            {context.lines.some((l) => l.isDigital && l.requestableQuantity > 0) && (
              <option value="digitalComplaint">
                {copy('گزارش مشکل کالای دیجیتال', 'Digital-item complaint')}
              </option>
            )}
          </select>
        </label>
      </div>
      {lines.map((l) => (
        <div className="field" key={l.lineKey}>
          <label>
            {l.name} · {l.label} · {copy('قابل درخواست', 'Eligible')}: {l.requestableQuantity}
            <input
              name={`return-quantity-${l.lineKey}`}
              type="number"
              min={0}
              max={l.requestableQuantity}
              step={1}
              value={quantities[l.lineKey] ?? 0}
              onChange={(e) => {
                const v = Number(e.target.value);
                setQuantities((q) => ({
                  ...q,
                  [l.lineKey]: Number.isInteger(v) && v >= 0 && v <= l.requestableQuantity ? v : 0,
                }));
              }}
            />
          </label>
        </div>
      ))}
      <div className="field">
        <label>
          {copy(
            'دلیل درخواست؛ اطلاعات بانکی، رمز یا کد دیجیتال ننویسید',
            'Reason; do not include bank details, passwords or digital codes',
          )}
          <textarea
            name="return-reason"
            required
            maxLength={4000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      </div>
      <div>
        <label className="check-label">
          <input
            name="return-ack"
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
          />
          {copy(
            'شرایط را خواندم؛ ثبت درخواست به معنی پذیرش کالا یا بازپرداخت نیست.',
            'I read the terms. Submitting a request does not approve a return or refund.',
          )}
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      <Button
        type="submit"
        disabled={!ack || !reason.trim() || !lines.some((l) => (quantities[l.lineKey] ?? 0) > 0)}
      >
        {copy('ثبت درخواست برای بررسی', 'Submit for review')}
      </Button>
    </form>
  );
}
export function CustomerReturnWithdrawForm({
  detail,
  actor,
  locale,
  request,
  current,
  onSaved,
}: {
  detail: RmaDetail;
  actor: string;
  locale: 'fa' | 'en';
  request: (path: string, init?: RequestInit) => Promise<unknown>;
  current: () => boolean;
  onSaved: () => void;
}) {
  const [reason, setReason] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState('');
  const locked = useRef(false);
  const copy = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (locked.current || !current() || customerRmaJournal.snapshot(actor)) return;
    let command;
    try {
      command = rmaCommand(
        'withdraw',
        rmaWithdrawInputSchema.parse({
          version: detail.case.version,
          reason: normalizeReason(reason),
          confirmed,
        }),
        { caseId: detail.case.id, orderId: detail.case.orderId },
      );
      customerRmaJournal.begin(actor, command);
    } catch {
      setError(
        copy('دلیل و تأیید انصراف لازم است.', 'A reason and explicit confirmation are required.'),
      );
      return;
    }
    locked.current = true;
    setReason('');
    setConfirmed(false);
    try {
      const raw = await request(command.path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command.body),
      });
      if (current() && customerRmaJournal.finish(actor, command.commandId, raw)) onSaved();
    } catch (e) {
      const issue = e as { status?: number; code?: string };
      customerRmaJournal.fail(
        actor,
        command.commandId,
        issue.status ?? 0,
        issue.code ?? 'rma_unavailable',
      );
    } finally {
      locked.current = false;
    }
  }
  return (
    <form className="temporary-order" onSubmit={(e) => void submit(e)}>
      <h4>{copy('انصراف از درخواست', 'Withdraw request')}</h4>
      <div className="field">
        <label>
          {copy('دلیل انصراف', 'Withdrawal reason')}
          <textarea
            name="withdraw-reason"
            required
            maxLength={4000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      </div>
      <div>
        <label className="check-label">
          <input
            name="withdraw-confirm"
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          {copy(
            'فقط درخواست بررسی بسته شود؛ سفارش و پرداخت تغییر نمی‌کنند.',
            'Close this review request. The order and payment remain unchanged.',
          )}
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      <Button type="submit" variant="outline" disabled={!confirmed || !reason.trim()}>
        {copy('انصراف از درخواست بررسی', 'Withdraw review request')}
      </Button>
    </form>
  );
}
