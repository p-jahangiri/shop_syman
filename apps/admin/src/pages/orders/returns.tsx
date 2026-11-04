import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ClipboardList, RotateCcw, RotateCw, Settings2 } from 'lucide-react';
import { api } from '../../api/api';
import { AdminTable } from '../../components/tables/admin-table';
import { Busy, ErrorBox, Field, Check } from '../../components/ui';
import { adminViewRevision } from '../../auth/admin-view-authority';
import { adminRmaJournal, rmaCommand } from '@sayman/web-shared/lib/orders/rma-journal.ts';
import { advanceRequestGeneration } from '@sayman/web-shared/lib/data/request-generation.ts';
import {
  readRmaPage,
  readRmaDetail,
  readRmaPolicyCurrent,
  readRmaPolicyHistory,
  rmaPolicyInputSchema,
  rmaReviewInputSchema,
  type RmaPolicyCurrent,
  type RmaPolicyData,
  type RmaDetail,
  type RmaPage,
  type RmaPolicyInput,
} from '@sayman/web-shared/lib/orders/rma-contract.ts';
import { RmaReceiptPanel } from '@sayman/web-shared/components/orders/rma-receipt-panel';
import {
  ReturnCaseDetail,
  ReturnFinancialNotice,
  returnStateNames,
} from '@sayman/web-shared/components/orders/rma-case-detail';
import '../../styles/orders/sales-order-workspace.css';
const request = (path: string, init?: RequestInit) =>
  api<unknown>(path.replace(/^\/api(?=\/)/, ''), init);
const dateTime = new Intl.DateTimeFormat('fa-IR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Tehran',
});
const date = (at: string) => dateTime.format(new Date(at));
const clean = (s: string) => s.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim();
const caseTone = {
  submitted: 'pending',
  reviewing: 'info',
  reviewed: 'positive',
  withdrawn: 'neutral',
};
export default function ReturnsPage({
  viewerId,
  writable,
}: {
  viewerId: string;
  writable: boolean;
}) {
  const [policy, setPolicy] = useState<RmaPolicyCurrent | null>(null),
    [history, setHistory] = useState<RmaPolicyData[]>([]),
    [before, setBefore] = useState<number | null>(null),
    [page, setPage] = useState<RmaPage | null>(null),
    [state, setState] = useState(''),
    [detail, setDetail] = useState<RmaDetail | null>(null),
    [queueLoading, setQueueLoading] = useState(true),
    [policyLoading, setPolicyLoading] = useState(true),
    [working, setWorking] = useState(false),
    [queueError, setQueueError] = useState<unknown>(null),
    [policyError, setPolicyError] = useState<unknown>(null),
    [historyError, setHistoryError] = useState<unknown>(null),
    [queueAttempt, setQueueAttempt] = useState(0),
    [policyAttempt, setPolicyAttempt] = useState(0),
    [view, setView] = useState<'queue' | 'policy'>('queue'),
    [editing, setEditing] = useState(false);
  const generation = useRef(0),
    policyGeneration = useRef(0),
    detailHeading = useRef<HTMLHeadingElement>(null),
    locked = useRef(false);
  const entry = useSyncExternalStore(
    adminRmaJournal.subscribe,
    () => adminRmaJournal.snapshot(viewerId),
    () => null,
  );
  useEffect(() => {
    const ticket = ++generation.current,
      revision = adminViewRevision();
    const current = () =>
      ticket === generation.current &&
      revision === adminViewRevision() &&
      adminRmaJournal.isBound(viewerId);
    const abort = new AbortController();
    setQueueLoading(true);
    setQueueError(null);
    setDetail(null);
    setPage(null);
    void request(`/api/admin/returns${state ? `?state=${state}` : ''}`, { signal: abort.signal })
      .then((raw) => readRmaPage(raw, { staff: true }))
      .then((result) => {
        if (current()) setPage(result);
      })
      .catch((e) => {
        if (current() && !abort.signal.aborted) setQueueError(e);
      })
      .finally(() => {
        if (current()) setQueueLoading(false);
      });
    return () => {
      advanceRequestGeneration(generation);
      abort.abort();
    };
  }, [viewerId, state, queueAttempt]);
  useEffect(() => {
    const ticket = ++policyGeneration.current;
    const revision = adminViewRevision();
    const current = () =>
      ticket === policyGeneration.current &&
      revision === adminViewRevision() &&
      adminRmaJournal.isBound(viewerId);
    const abort = new AbortController();
    setPolicyLoading(true);
    setPolicyError(null);
    setHistoryError(null);
    setPolicy(null);
    setHistory([]);
    setBefore(null);
    setEditing(false);
    void Promise.allSettled([
      request('/api/admin/returns/policy', { signal: abort.signal }).then(readRmaPolicyCurrent),
      request('/api/admin/returns/policy/history', { signal: abort.signal }).then(
        readRmaPolicyHistory,
      ),
    ]).then(([conditions, versions]) => {
      if (!current()) return;
      if (conditions.status === 'fulfilled') setPolicy(conditions.value);
      else setPolicyError(conditions.reason);
      if (versions.status === 'fulfilled') {
        setHistory(versions.value.items);
        setBefore(versions.value.nextBefore);
      } else setHistoryError(versions.reason);
      setPolicyLoading(false);
    });
    return () => {
      advanceRequestGeneration(policyGeneration);
      abort.abort();
    };
  }, [viewerId, policyAttempt]);
  useEffect(() => {
    if (detail) detailHeading.current?.focus();
  }, [detail]);
  const refreshQueue = () => {
    setDetail(null);
    setQueueAttempt((v) => v + 1);
  };
  const refreshPolicy = () => {
    setEditing(false);
    setPolicyAttempt((v) => v + 1);
  };
  const refreshReceipt = () => {
    if (entry?.command.kind === 'policy') refreshPolicy();
    else refreshQueue();
  };
  async function show(ownerId: string, caseId: string) {
    if (!writable || locked.current) return;
    locked.current = true;
    const ticket = generation.current,
      revision = adminViewRevision();
    setWorking(true);
    setDetail(null);
    setQueueError(null);
    try {
      const d = readRmaDetail(
        await request(`/api/admin/returns/${encodeURIComponent(ownerId)}/${caseId}`),
        { caseId, ownerId, staff: true },
      );
      if (
        ticket === generation.current &&
        revision === adminViewRevision() &&
        adminRmaJournal.isBound(viewerId)
      )
        setDetail(d);
    } catch (e) {
      if (ticket === generation.current && revision === adminViewRevision()) setQueueError(e);
    } finally {
      locked.current = false;
      if (revision === adminViewRevision()) setWorking(false);
    }
  }
  async function more(kind: 'cases' | 'history') {
    if (locked.current) return;
    const cursor = kind === 'cases' ? page?.nextCursor : before;
    if (!cursor) return;
    locked.current = true;
    const activeGeneration = kind === 'cases' ? generation : policyGeneration;
    const ticket = activeGeneration.current,
      revision = adminViewRevision();
    setWorking(true);
    const setError = kind === 'cases' ? setQueueError : setHistoryError;
    setError(null);
    try {
      if (kind === 'cases') {
        const next = readRmaPage(
          await request(
            `/api/admin/returns?${state ? `state=${state}&` : ''}after=${encodeURIComponent(cursor)}`,
          ),
          { staff: true },
        );
        if (
          ticket === activeGeneration.current &&
          revision === adminViewRevision() &&
          adminRmaJournal.isBound(viewerId)
        )
          setPage((old) =>
            old
              ? {
                  ...next,
                  items: [
                    ...old.items,
                    ...next.items.filter((x) => !old.items.some((y) => y.id === x.id)),
                  ],
                }
              : next,
          );
      } else {
        const next = readRmaPolicyHistory(
          await request(`/api/admin/returns/policy/history?beforeRevision=${cursor}`),
        );
        if (
          ticket === activeGeneration.current &&
          revision === adminViewRevision() &&
          adminRmaJournal.isBound(viewerId)
        ) {
          setHistory((old) => [
            ...old,
            ...next.items.filter((x) => !old.some((y) => y.id === x.id)),
          ]);
          setBefore(next.nextBefore);
        }
      }
    } catch (e) {
      if (ticket === activeGeneration.current && revision === adminViewRevision()) setError(e);
    } finally {
      locked.current = false;
      if (revision === adminViewRevision()) setWorking(false);
    }
  }
  return (
    <div className="sales-workspace">
      <section className="panel sales-hero">
        <div className="sales-hero-heading">
          <span className="sales-hero-icon">
            <RotateCcw aria-hidden="true" />
          </span>
          <div>
            <h2>مرجوعی و مشکلات دیجیتال</h2>
            <p>درخواست مشتری، اقلام سفارش و سابقهٔ تصمیم‌ها را در یک مسیر پیگیری کنید.</p>
          </div>
        </div>
        <div className="sales-view-switch" aria-label="بخش‌های رسیدگی به مرجوعی">
          <button
            type="button"
            className={view === 'queue' ? 'primary' : undefined}
            aria-pressed={view === 'queue'}
            onClick={() => setView('queue')}
          >
            <ClipboardList size={17} aria-hidden="true" /> صف رسیدگی
          </button>
          <button
            type="button"
            className={view === 'policy' ? 'primary' : undefined}
            aria-pressed={view === 'policy'}
            onClick={() => setView('policy')}
          >
            <Settings2 size={17} aria-hidden="true" /> شرایط و تاریخچه
          </button>
        </div>
        <details>
          <summary>ⓘ راهنمای مدیر</summary>
          <p>
            مشتری از جزئیات سفارش، اقلامی را که واقعاً تحویل شده یا دیجیتال آن آماده شده انتخاب
            می‌کند. مهلت از همان رخداد معتبر محاسبه می‌شود، نه زمان مشاهدهٔ محتوا. شرایط معتبر هنگام
            ثبت، همراه درخواست نگهداری می‌شود.
          </p>
          <ol>
            <li>درخواست ثبت‌شده را باز و دلیل، تعداد و شرایط تاریخی را بخوانید.</li>
            <li>با یادداشت خصوصی و تأیید صریح «شروع بررسی» را ثبت کنید.</li>
            <li>
              در پایان، «نیازمند پیگیری» یا «رد درخواست» و پیام قابل مشاهدهٔ مشتری را انتخاب کنید.
              نیازمند پیگیری همچنان باز است و مشتری می‌تواند انصراف دهد.
            </li>
            <li>
              اگر نتیجه نامعلوم شد، فقط رسید همان شناسه را دریافت کنید؛ فرم تازه تا تعیین نتیجه بسته
              می‌ماند.
            </li>
          </ol>
          <p>
            شرایط تازه فقط بر درخواست‌های آینده اثر دارند. یادداشت خصوصی مدیر برای مشتری ارسال
            نمی‌شود. اطلاعات بانکی، رمز یا کد دیجیتال را در یادداشت ننویسید.
          </p>
        </details>
        <ReturnFinancialNotice />
      </section>
      <RmaReceiptPanel
        journal={adminRmaJournal}
        actor={viewerId}
        request={request}
        onResolved={refreshReceipt}
      />
      <section className="panel sales-queue" hidden={view !== 'queue'}>
        <div className="section-heading sales-queue-heading">
          <div>
            <h2>صف درخواست‌ها</h2>
            <p>فیلتر وضعیت روی همهٔ درخواست‌ها اعمال می‌شود.</p>
          </div>
          <button type="button" disabled={queueLoading || working} onClick={refreshQueue}>
            <RotateCw size={16} aria-hidden="true" /> تازه‌سازی درخواست‌ها
          </button>
        </div>
        <ErrorBox error={queueError} />
        {queueLoading && <Busy />}
        <div className="sales-queue-filters">
          <Field label="وضعیت درخواست">
            <select name="rma-state" value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">همهٔ وضعیت‌ها</option>
              {Object.entries(returnStateNames).map(([v, n]) => (
                <option value={v} key={v}>
                  {n[0]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {Boolean(page?.items.length) && (
          <p className="sales-queue-note">جست‌وجوی جدول روی درخواست‌های دریافت‌شده اعمال می‌شود.</p>
        )}
        {page && (
          <>
            {!!page.items.length && (
              <AdminTable pageable aria-label="درخواست‌های مرجوعی و مشکلات دیجیتال">
                <thead>
                  <tr>
                    <th>شناسهٔ پیگیری</th>
                    <th>مشتری</th>
                    <th>سفارش</th>
                    <th>نوع</th>
                    <th>وضعیت</th>
                    <th>تعداد</th>
                    <th>آخرین تغییر</th>
                    <th>عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((c) => (
                    <tr key={c.id}>
                      <td>{c.reference}</td>
                      <td>
                        <code>{c.ownerId}</code>
                      </td>
                      <td>
                        <code>{c.orderId}</code>
                      </td>
                      <td>{c.kind === 'physicalReturn' ? 'مرجوعی فیزیکی' : 'مشکل دیجیتال'}</td>
                      <td>
                        <span
                          className="sales-state"
                          data-tone={c.outcome === 'declined' ? 'negative' : caseTone[c.state]}
                        >
                          {returnStateNames[c.state][0]}
                        </span>
                        {c.outcome &&
                          ` · ${c.outcome === 'followUp' ? 'نیازمند پیگیری' : 'رد درخواست'}`}
                      </td>
                      <td>{c.itemCount.toLocaleString('fa-IR')}</td>
                      <td data-sort-value={c.changedAt}>{date(c.changedAt)}</td>
                      <td>
                        <button
                          type="button"
                          disabled={working || !writable}
                          onClick={() => void show(c.ownerId!, c.id)}
                        >
                          جزئیات و بررسی
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </AdminTable>
            )}
            {!page.items.length && (
              <div className="sales-empty">
                <ClipboardList aria-hidden="true" />
                <p>
                  {state ? 'درخواستی در وضعیت انتخاب‌شده نیست.' : 'هنوز درخواستی ثبت نشده است.'}
                </p>
                {state && (
                  <button type="button" onClick={() => setState('')}>
                    نمایش همهٔ وضعیت‌ها
                  </button>
                )}
              </div>
            )}
            {page.nextCursor && (
              <button type="button" disabled={working} onClick={() => void more('cases')}>
                دریافت ردیف‌های بیشتر
              </button>
            )}
          </>
        )}
        {!writable && <p>دیدن جزئیات خصوصی و ثبت بررسی به دسترسی ویرایش فروش نیاز دارد.</p>}
        {writable && detail && (
          <section className="sales-section sales-case-detail">
            <div className="section-heading">
              <h3 tabIndex={-1} ref={detailHeading}>
                رسیدگی به <bdi>{detail.case.reference}</bdi>
              </h3>
              <button type="button" onClick={() => setDetail(null)}>
                بستن جزئیات
              </button>
            </div>
            <ReturnCaseDetail detail={detail} staff />
            {writable && !entry && ['submitted', 'reviewing'].includes(detail.case.state) && (
              <RmaReviewForm
                key={`${detail.case.id}:${detail.case.version}`}
                detail={detail}
                viewerId={viewerId}
                onSaved={refreshQueue}
              />
            )}
          </section>
        )}
      </section>
      <section className="panel" hidden={view !== 'policy'}>
        <div className="section-heading">
          <h2>شرایط ثبت درخواست</h2>
          <div className="sales-view-switch">
            <button type="button" disabled={policyLoading || working} onClick={refreshPolicy}>
              تازه‌سازی شرایط
            </button>
            <button
              type="button"
              disabled={!writable || !!entry || !policy || policyLoading || working}
              onClick={() => setEditing((v) => !v)}
            >
              {editing ? 'بستن ویرایش' : 'ویرایش شرایط'}
            </button>
          </div>
        </div>
        <ErrorBox error={policyError} />
        {policyLoading && <Busy />}
        {policy &&
          (policy.current ? (
            <>
              <p>
                ویرایش {policy.current.revision} ·{' '}
                {policy.current.enabled ? 'ثبت درخواست فعال' : 'ثبت درخواست غیرفعال'}
              </p>
              <p className="preserve-lines">{policy.current.conditionsFa}</p>
              <p>
                {policy.current.windowMode === 'deliveryDays'
                  ? `${policy.current.windowDays?.toLocaleString('fa-IR')} روز از تحویل فیزیکی یا آماده‌شدن دیجیتال`
                  : 'بررسی دستی زمان و شرایط'}
              </p>
              <p>
                سقف درخواست باز هر مشتری{' '}
                {policy.current.maxOpenPerOwner?.toLocaleString('fa-IR') ?? 'تعیین نشده'}
              </p>
            </>
          ) : (
            <p>هنوز شرایطی ذخیره نشده؛ ثبت درخواست تازه بسته است.</p>
          ))}
        {editing && policy && !entry && (
          <RmaPolicyForm
            key={policy.current?.version ?? 'new'}
            policy={policy}
            viewerId={viewerId}
            onSaved={refreshPolicy}
          />
        )}
        <h3>تاریخچهٔ شرایط</h3>
        <ErrorBox error={historyError} />
        {!policyLoading && !historyError && !history.length && (
          <p>هنوز نسخه‌ای در تاریخچه ثبت نشده است.</p>
        )}
        {!!history.length && (
          <AdminTable pageable aria-label="تاریخچهٔ شرایط مرجوعی">
            <thead>
              <tr>
                <th>ویرایش</th>
                <th>ثبت</th>
                <th>وضعیت</th>
                <th>مهلت</th>
                <th>شرایط</th>
              </tr>
            </thead>
            <tbody>
              {history.map((p) => (
                <tr key={p.id}>
                  <td>{p.revision}</td>
                  <td>{date(p.at)}</td>
                  <td>{p.enabled ? 'فعال' : 'غیرفعال'}</td>
                  <td>{p.windowMode === 'deliveryDays' ? `${p.windowDays} روز` : 'بررسی دستی'}</td>
                  <td>
                    <details>
                      <summary>متن دو زبان</summary>
                      <p className="preserve-lines">{p.conditionsFa}</p>
                      <p className="preserve-lines" dir="ltr">
                        {p.conditionsEn}
                      </p>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
        )}
        {before && (
          <button type="button" disabled={working} onClick={() => void more('history')}>
            نسخه‌های پیشین
          </button>
        )}
      </section>
    </div>
  );
}
export function RmaReviewForm({
  detail,
  viewerId,
  onSaved,
}: {
  detail: RmaDetail;
  viewerId: string;
  onSaved: () => void;
}) {
  const [outcome, setOutcome] = useState<'followUp' | 'declined'>('followUp'),
    [note, setNote] = useState(''),
    [message, setMessage] = useState(''),
    [ack, setAck] = useState(false),
    [error, setError] = useState('');
  const locked = useRef(false);
  const revision = useRef(adminViewRevision());
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (
      locked.current ||
      revision.current !== adminViewRevision() ||
      !adminRmaJournal.isBound(viewerId) ||
      adminRmaJournal.snapshot(viewerId)
    )
      return;
    let command;
    try {
      const body = rmaReviewInputSchema.parse({
        ownerId: detail.case.ownerId,
        version: detail.case.version,
        action: detail.case.state === 'submitted' ? 'startReview' : 'completeReview',
        outcome: detail.case.state === 'submitted' ? null : outcome,
        note: clean(note),
        customerMessage: clean(message) || null,
        acknowledgeNoFinancialAction: ack,
      });
      command = rmaCommand('review', body, {
        caseId: detail.case.id,
        orderId: detail.case.orderId,
        ownerId: detail.case.ownerId,
      });
      adminRmaJournal.begin(viewerId, command);
    } catch {
      setError('یادداشت خصوصی و تأیید صریح لازم است.');
      return;
    }
    locked.current = true;
    setNote('');
    setMessage('');
    setAck(false);
    try {
      const raw = await request(command.path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command.body),
      });
      if (
        revision.current === adminViewRevision() &&
        adminRmaJournal.finish(viewerId, command.commandId, raw)
      )
        onSaved();
    } catch (e) {
      const issue = e as { status?: number; code?: string };
      adminRmaJournal.fail(
        viewerId,
        command.commandId,
        issue.status ?? 0,
        issue.code ?? 'rma_unavailable',
      );
    } finally {
      locked.current = false;
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)}>
      <h3>{detail.case.state === 'submitted' ? 'شروع بررسی درخواست' : 'ثبت نتیجهٔ بررسی'}</h3>
      {detail.case.state === 'reviewing' && (
        <Field label="نتیجهٔ بررسی">
          <select
            name="rma-outcome"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as typeof outcome)}
          >
            <option value="followUp">نیازمند پیگیری؛ درخواست باز می‌ماند</option>
            <option value="declined">رد درخواست؛ بسته می‌شود</option>
          </select>
        </Field>
      )}
      <Field label="یادداشت خصوصی مدیر؛ برای مشتری نمایش داده نمی‌شود">
        <textarea
          name="rma-private-note"
          required
          maxLength={4000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <Field label="پیام قابل مشاهدهٔ مشتری (اختیاری)">
        <textarea
          name="rma-customer-message"
          maxLength={2000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </Field>
      <Check
        name="rma-review-ack"
        checked={ack}
        onChange={(e) => setAck(e.target.checked)}
        label="فقط بررسی ثبت می‌شود؛ پذیرش کالا، بازپرداخت و تغییر موجودی انجام نمی‌شود."
      />
      {error && <p role="alert">{error}</p>}
      <button type="submit" className="primary" disabled={!ack || !note.trim()}>
        ثبت بررسی
      </button>
    </form>
  );
}
export function RmaPolicyForm({
  policy,
  viewerId,
  onSaved,
}: {
  policy: RmaPolicyCurrent;
  viewerId: string;
  onSaved: () => void;
}) {
  const current = policy.current;
  const [enabled, setEnabled] = useState(current?.enabled ?? false),
    [physical, setPhysical] = useState(current?.physicalReturns ?? true),
    [digital, setDigital] = useState(current?.digitalComplaints ?? true),
    [fa, setFa] = useState(current?.conditionsFa ?? ''),
    [en, setEn] = useState(current?.conditionsEn ?? ''),
    [mode, setMode] = useState<'manualReview' | 'deliveryDays'>(
      current?.windowMode ?? 'deliveryDays',
    ),
    [days, setDays] = useState(String(current?.windowDays ?? 3)),
    [cap, setCap] = useState(current?.maxOpenPerOwner?.toString() ?? ''),
    [note, setNote] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState('');
  const locked = useRef(false),
    revision = useRef(adminViewRevision());
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (
      locked.current ||
      revision.current !== adminViewRevision() ||
      !adminRmaJournal.isBound(viewerId) ||
      adminRmaJournal.snapshot(viewerId)
    )
      return;
    let command;
    try {
      const body: RmaPolicyInput = rmaPolicyInputSchema.parse({
        version: current?.version ?? null,
        enabled,
        physicalReturns: physical,
        digitalComplaints: digital,
        conditionsFa: clean(fa),
        conditionsEn: clean(en),
        windowMode: mode,
        windowDays: mode === 'deliveryDays' ? Number(days) : null,
        maxOpenPerOwner: cap.trim() ? Number(cap) : null,
        note: clean(note),
        confirmed,
      });
      command = rmaCommand('policy', body);
      adminRmaJournal.begin(viewerId, command);
    } catch {
      setError(
        'شرایط دو زبان، مهلت معتبر، یادداشت و تأیید را کامل کنید؛ سقف خالی یعنی بدون سقف این سیاست.',
      );
      return;
    }
    locked.current = true;
    setNote('');
    setConfirmed(false);
    try {
      const raw = await request(command.path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command.body),
      });
      if (
        revision.current === adminViewRevision() &&
        adminRmaJournal.finish(viewerId, command.commandId, raw)
      )
        onSaved();
    } catch (e) {
      const issue = e as { status?: number; code?: string };
      adminRmaJournal.fail(
        viewerId,
        command.commandId,
        issue.status ?? 0,
        issue.code ?? 'rma_unavailable',
      );
    } finally {
      locked.current = false;
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)}>
      <p>
        ذخیره، نسخهٔ جدید شرایط را برای درخواست‌های آینده فعال می‌کند؛ متن و مهلت درخواست‌های قبلی
        تغییر نمی‌کنند. مهلت دیجیتال از زمان آماده‌شدن آغاز می‌شود، نه مشاهدهٔ محتوا.
      </p>
      <Check
        name="rma-policy-enabled"
        label="ثبت درخواست تازه فعال باشد"
        checked={enabled}
        onChange={(e) => setEnabled(e.target.checked)}
      />
      <Check
        name="rma-policy-physical"
        label="درخواست مرجوعی فیزیکی"
        checked={physical}
        onChange={(e) => setPhysical(e.target.checked)}
      />
      <Check
        name="rma-policy-digital"
        label="گزارش مشکل دیجیتال"
        checked={digital}
        onChange={(e) => setDigital(e.target.checked)}
      />
      <Field label="شرایط فارسی">
        <textarea
          name="rma-conditions-fa"
          required
          maxLength={4000}
          value={fa}
          onChange={(e) => setFa(e.target.value)}
        />
      </Field>
      <Field label="شرایط انگلیسی">
        <textarea
          name="rma-conditions-en"
          dir="ltr"
          required
          maxLength={4000}
          value={en}
          onChange={(e) => setEn(e.target.value)}
        />
      </Field>
      <Field label="مبنای مهلت">
        <select
          name="rma-window-mode"
          value={mode}
          onChange={(e) => {
            setMode(e.target.value as typeof mode);
            setConfirmed(false);
          }}
        >
          <option value="deliveryDays">تعداد روز از تحویل فیزیکی / آماده‌شدن دیجیتال</option>
          <option value="manualReview">بررسی دستی شرایط و مهلت</option>
        </select>
      </Field>
      {mode === 'deliveryDays' && (
        <Field label="تعداد روز">
          <input
            name="rma-window-days"
            type="number"
            min={1}
            max={3650}
            required
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </Field>
      )}
      <Field
        label="سقف درخواست باز هر مشتری (اختیاری)"
        hint="این سقف مربوط به درخواست مرجوعی است و با سقف سفارش‌های باز تفاوت دارد."
      >
        <input
          name="rma-open-cap"
          type="number"
          min={1}
          max={10000}
          value={cap}
          onChange={(e) => setCap(e.target.value)}
        />
      </Field>
      <Field label="یادداشت خصوصی تغییر شرایط">
        <textarea
          name="rma-policy-note"
          required
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <Check
        name="rma-policy-confirm"
        label="نسخهٔ تازه برای درخواست‌های آینده اعمال شود؛ بازپرداخت همچنان غیرفعال است."
        checked={confirmed}
        onChange={(e) => setConfirmed(e.target.checked)}
      />
      {error && <p role="alert">{error}</p>}
      <button type="submit" className="primary" disabled={!confirmed || !note.trim()}>
        ذخیرهٔ نسخهٔ تازهٔ شرایط
      </button>
    </form>
  );
}
