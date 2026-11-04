import { PersianDateField } from '../../components/forms/persian-date-field';
import { AdminTable } from '../../components/tables/admin-table';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/api';
import { Busy, Check, ErrorBox, Field, Modal } from '../../components/ui';
import { adminViewRevision } from '../../auth/admin-view-authority';
import { orderParcelJournal as journal } from '../../state/orders/order-parcel-journal';
import { orderDigitalJournal } from '../../state/orders/order-digital-journal';
import {
  subscribeShipmentJournal,
  shipmentJournalSnapshot,
} from '../../state/orders/order-shipment-journal';
import { OrderShipmentManager } from './order-shipment';
import {
  parcelBase,
  parcelCommandSchema,
  readParcelPage,
  readParcelDetail,
  type ParcelCommand,
  type ParcelDetail,
} from '@sayman/web-shared/lib/orders/order-parcel-contract.ts';
const labels = {
  pack: 'بسته‌بندی جدید',
  repack: 'بازبسته‌بندی',
  void: 'ابطال بستهٔ ارسال‌نشده',
  dispatch: 'خروج و تحویل به حمل‌کننده',
  deliver: 'ثبت تحویل به مشتری',
} as const;
const states = {
  packed: 'بسته‌بندی‌شده',
  void: 'باطل پیش از ارسال',
  dispatched: 'تحویل به حمل‌کننده',
  delivered: 'تحویل‌شده به مشتری',
} as const;
const date = (t: string) =>
  new Intl.DateTimeFormat('fa-IR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tehran',
  }).format(new Date(t));
const normalized = (s: string) =>
  s
    .normalize('NFKC')
    .replace(/[۰-۹٠-٩]/g, (c) =>
      String('۰۱۲۳۴۵۶۷۸۹'.includes(c) ? '۰۱۲۳۴۵۶۷۸۹'.indexOf(c) : '٠١٢٣٤٥٦٧٨٩'.indexOf(c)),
    );
const blockers: Record<string, string> = {
  payment_not_confirmed: 'پرداخت یا مجوز مالی سفارش تأیید نشده است.',
  credit_clearance_required: 'مجوز مالی جاری ارسال کامل نیست؛ بررسی مالی لازم است.',
  physical_only_fulfillment_required: 'این مسیر فقط سفارش تماماً فیزیکی را پشتیبانی می‌کند.',
  physical_line_required: 'این سفارش خط فیزیکی ندارد؛ از تحویل خصوصی دیجیتال استفاده کنید.',
  reservation_not_allocated: 'موجودی قابل ارسال باقی نمانده است.',
  parcel_capacity_reached:
    'ظرفیت بسته‌های فعال تکمیل است؛ بستهٔ ارسال‌نشده را بازبینی یا باطل کنید.',
  complete_serial_assignment_required:
    'همهٔ دستگاه‌های باقی‌مانده باید به همین سفارش تخصیص یافته باشند.',
};
async function invalidate(client: ReturnType<typeof useQueryClient>) {
  await Promise.all(
    [
      'order-parcels',
      'order-digital',
      'shipment',
      'orders-v2',
      'order-v2',
      'credit-clearance',
      'credit-upfront',
    ].map((k) => client.invalidateQueries({ queryKey: ['admin', k] })),
  );
}
export function ParcelCommandGuard({
  viewerId,
  writable,
  inline = false,
}: {
  viewerId: string;
  writable: boolean;
  inline?: boolean;
}) {
  const e = useSyncExternalStore(
      journal.subscribe,
      () => journal.snapshot(viewerId),
      () => null,
    ),
    client = useQueryClient(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  useEffect(() => {
    if (!e || !['pending', 'unknown'].includes(e.state)) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [e]);
  async function recover(retry = false) {
    if (!e || e.state !== 'unknown' || !writable || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      if (retry) journal.retry(viewerId);
      const c = e.command,
        raw = await api(
          parcelBase(c.input.ownerId, c.orderId) + '/commands/' + c.input.commandId,
          retry ? { method: 'POST', body: JSON.stringify(c.input) } : {},
        );
      if (journal.finish(viewerId, c, raw)) await invalidate(client);
    } catch (err) {
      journal.fail(
        viewerId,
        e.command,
        err instanceof ApiError ? err.status : 0,
        err instanceof ApiError ? err.code : 'unknown',
      );
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  if (!e) return null;
  return (
    <section className={inline ? 'notice' : 'panel'} role="status">
      <h2>
        {e.state === 'done'
          ? 'رسید عملیات مرسوله'
          : e.state === 'rejected'
            ? 'عملیات مرسوله رد شد'
            : e.state === 'pending'
              ? 'در حال ثبت عملیات مرسوله…'
              : 'نتیجهٔ عملیات مرسوله مشخص نیست'}
      </h2>
      <p>
        سفارش: <bdi>{e.command.orderId}</bdi>
        <br />
        فرمان: <bdi>{e.command.input.commandId}</bdi>
      </p>
      <ErrorBox error={error} />
      {e.state === 'unknown' && (
        <>
          <p>ابتدا رسید همین شناسه را بررسی کنید. فرمان تازه‌ای برای همان خروج نسازید.</p>
          <div className="row-buttons">
            <button disabled={busy || !writable} onClick={() => void recover()}>
              بررسی رسید همین مرسوله
            </button>
            <button disabled={busy || !writable} onClick={() => void recover(true)}>
              تلاش دوباره با همان شناسه و بدنه
            </button>
          </div>
        </>
      )}
      {e.result && (
        <p>
          {labels[e.result.action]} · بستهٔ <bdi>{e.result.detail.parcel.number}</bdi> ·{' '}
          {states[e.result.detail.parcel.state]} · {date(e.result.recordedAt)}. این رسید تاریخی است؛
          وضعیت جاری را بازخوانی کنید.
        </p>
      )}
      {['done', 'rejected'].includes(e.state) && (
        <button
          onClick={() => {
            journal.clear(viewerId);
            void invalidate(client);
          }}
        >
          بستن نتیجه و بازخوانی مرسوله‌ها
        </button>
      )}
      <small>بدنه و رسید فقط در حافظهٔ همین نشست نگهداری می‌شوند.</small>
    </section>
  );
}
export function OrderFulfillmentManager({
  viewerId,
  ownerId,
  orderId,
  writable,
  orderState,
  hasDigital = false,
  hasPhysical = true,
}: {
  viewerId: string;
  ownerId: string;
  orderId: string;
  writable: boolean;
  orderState: string;
  hasDigital?: boolean;
  hasPhysical?: boolean;
}) {
  const eligible = ['Paid', 'CreditApproved', 'Fulfilled'].includes(orderState);
  const [mode, setMode] = useState<'' | 'single' | 'parcels'>('');
  const query = useQuery({
    queryKey: ['admin', 'order-parcels', viewerId, ownerId, orderId, 'mode'],
    enabled: hasPhysical && (eligible || hasDigital),
    queryFn: async ({ signal }) =>
      readParcelPage(await api(parcelBase(ownerId, orderId), { signal }), ownerId, orderId),
    refetchOnWindowFocus: false,
    retry: false,
  });
  if (!hasPhysical) return null;
  if (!eligible && !hasDigital)
    return (
      <OrderShipmentManager
        viewerId={viewerId}
        ownerId={ownerId}
        orderId={orderId}
        writable={writable}
      />
    );
  if (
    !hasDigital &&
    query.error instanceof ApiError &&
    query.error.code === 'parcel_workflow_conflict'
  )
    return (
      <OrderShipmentManager
        viewerId={viewerId}
        ownerId={ownerId}
        orderId={orderId}
        writable={writable}
      />
    );
  if (query.isPending) return <Busy />;
  if (query.error)
    return (
      <section className="panel">
        <h2>گردش ارسال سفارش</h2>
        <ErrorBox error={query.error} />
        <button onClick={() => void query.refetch()}>بررسی دوبارهٔ گردش ارسال</button>
      </section>
    );
  if (hasDigital || query.data?.mode === 'parcels' || mode === 'parcels')
    return (
      <OrderParcelManager
        viewerId={viewerId}
        ownerId={ownerId}
        orderId={orderId}
        writable={writable}
      />
    );
  if (mode === 'single')
    return (
      <>
        <button onClick={() => setMode('')}>بازگشت به انتخاب گردش ارسال</button>
        <OrderShipmentManager
          viewerId={viewerId}
          ownerId={ownerId}
          orderId={orderId}
          writable={writable}
        />
      </>
    );
  return (
    <section className="panel">
      <h2>انتخاب گردش ارسال</h2>
      <p>
        گردش با ثبت اولین بسته برای این سفارش ثابت می‌شود. بسته‌بندی موجودی را کم نمی‌کند؛ خروج هر
        بسته و تحویل به مشتری جدا ثبت می‌شوند.
      </p>
      <button onClick={() => setMode('single')}>یک بسته برای تمام سفارش</button>
      <button onClick={() => setMode('parcels')}>ارسال در چند بسته</button>
      <ParcelCommandGuard viewerId={viewerId} writable={writable} inline />
    </section>
  );
}
export function OrderParcelManager({
  viewerId,
  ownerId,
  orderId,
  writable,
}: {
  viewerId: string;
  ownerId: string;
  orderId: string;
  writable: boolean;
}) {
  const client = useQueryClient(),
    authority = useRef(adminViewRevision()).current,
    base = parcelBase(ownerId, orderId);
  const [after, setAfter] = useState<string | null>(null),
    [action, setAction] = useState<keyof typeof labels | ''>(''),
    [selected, setSelected] = useState(''),
    [quantities, setQuantities] = useState<Record<string, string>>({}),
    [unitIds, setUnitIds] = useState<string[]>([]),
    [reference, setReference] = useState(''),
    [reason, setReason] = useState(''),
    [occurred, setOccurred] = useState(''),
    [fa, setFa] = useState(''),
    [en, setEn] = useState(''),
    [tracking, setTracking] = useState(''),
    [review, setReview] = useState<ParcelCommand | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const entry = useSyncExternalStore(
      journal.subscribe,
      () => journal.snapshot(viewerId),
      () => null,
    ),
    oldEntry = useSyncExternalStore(
      subscribeShipmentJournal,
      () => shipmentJournalSnapshot(viewerId),
      () => null,
    ),
    digitalEntry = useSyncExternalStore(
      orderDigitalJournal.subscribe,
      () => orderDigitalJournal.snapshot(viewerId),
      () => null,
    );
  const query = useQuery({
    queryKey: ['admin', 'order-parcels', viewerId, ownerId, orderId, after],
    queryFn: async ({ signal }) => {
      const p = readParcelPage(
        await api(base + (after ? '?after=' + after : ''), { signal }),
        ownerId,
        orderId,
      );
      if (authority !== adminViewRevision()) throw Error('دسترسی تغییر کرده است.');
      return p;
    },
    refetchOnWindowFocus: false,
    retry: false,
  });
  const detail = useQuery({
    queryKey: [
      'admin',
      'order-parcels',
      viewerId,
      ownerId,
      orderId,
      'detail',
      selected,
      query.data?.inventoryFingerprint,
    ],
    enabled: !!selected,
    queryFn: async ({ signal }) => {
      const d = readParcelDetail(
        await api(base + '/parcels/' + selected, { signal }),
        orderId,
        selected,
      );
      if (authority !== adminViewRevision()) throw Error('دسترسی تغییر کرده است.');
      return d;
    },
    refetchOnWindowFocus: false,
    retry: false,
  });
  const p = query.data,
    previous = detail.data,
    disabled =
      busy ||
      !!entry ||
      !!oldEntry ||
      !!digitalEntry ||
      !writable ||
      query.isFetching ||
      detail.isFetching;
  useEffect(() => {
    setAction('');
    setSelected('');
    setQuantities({});
    setUnitIds([]);
    setReason('');
    setReference('');
    setOccurred('');
    setFa('');
    setEn('');
    setTracking('');
    setReview(null);
    setConfirmed(false);
  }, [query.data?.inventoryFingerprint]);
  useEffect(() => {
    setQuantities({});
    setUnitIds([]);
    setReview(null);
    setConfirmed(false);
    setOccurred('');
    setReason('');
    setReference('');
    setFa('');
    setEn('');
    setTracking('');
  }, [action, selected]);
  useEffect(() => () => journal.interrupt(), []);
  const packing = action === 'pack' || action === 'repack',
    candidates = p
      ? [
          ...p.availableUnits,
          ...p.packedUnits.filter((x) => x.parcelId === selected).map((x) => x.unit),
        ]
      : [];
  function preview(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setConfirmed(false);
    try {
      if (!p || !action || disabled || authority !== adminViewRevision())
        throw Error('آخرین وضعیت و عملیات را بررسی کنید.');
      const lines = packing
        ? p.orderLines.flatMap((l) => {
            const q = normalized(quantities[l.lineKey] ?? '').trim();
            if (!q) return [];
            if (!/^[1-9][0-9]{0,6}$/.test(q) || Number(q) > 1000000)
              throw Error('تعداد صحیح و مثبت وارد کنید.');
            return [
              {
                lineKey: l.lineKey,
                quantity: Number(q),
                unitIds: unitIds.filter((id) =>
                  candidates.some((u) => u.id === id && u.lineKey === l.lineKey),
                ),
              },
            ];
          })
        : [];
      if (packing && unitIds.some((id) => !lines.some((l) => l.unitIds.includes(id))))
        throw Error('برای هر دستگاه انتخاب‌شده، تعداد خط مربوط را هم وارد کنید.');
      const command = parcelCommandSchema.parse({
        orderId,
        input: {
          ownerId: p.ownerId,
          commandId: crypto.randomUUID().replaceAll('-', ''),
          action,
          orderVersion: p.orderVersion,
          parcelId: action === 'pack' ? null : selected,
          parcelVersion: action === 'pack' ? null : (previous?.parcel.version ?? null),
          inventoryFingerprint: p.inventoryFingerprint,
          reason: reason.trim(),
          acknowledge: true,
          reference: action === 'pack' ? reference.trim() : null,
          lines,
          carrierNameFa: action === 'dispatch' ? fa.trim() : null,
          carrierNameEn: action === 'dispatch' ? en.trim() : null,
          trackingNumber: action === 'dispatch' && tracking.trim() ? tracking.trim() : null,
          occurredAt:
            action === 'dispatch' || action === 'deliver' ? new Date(occurred).toISOString() : null,
        },
        before: p,
        previous: action === 'pack' ? null : (previous ?? null),
      });
      setReview(command);
    } catch (err) {
      setError(
        err instanceof Error && err.message.startsWith('تعداد')
          ? err
          : Error('عملیات، بسته، تعداد، دستگاه‌ها، زمان و توضیح را مطابق بازبینی جاری تکمیل کنید.'),
      );
    }
  }
  async function send() {
    if (!review || !confirmed || disabled || authority !== adminViewRevision()) return;
    setBusy(true);
    setError(undefined);
    try {
      journal.begin(viewerId, review);
      const raw = await api(base + '/commands/' + review.input.commandId, {
        method: 'POST',
        body: JSON.stringify(review.input),
      });
      if (journal.finish(viewerId, review, raw)) {
        setReview(null);
        await invalidate(client);
      }
    } catch (err) {
      journal.fail(
        viewerId,
        review,
        err instanceof ApiError ? err.status : 0,
        err instanceof ApiError ? err.code : 'unknown',
      );
      setReview(null);
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>مرسوله‌های سفارش</h2>
        <button
          disabled={busy || query.isFetching || entry?.state === 'pending'}
          onClick={() => void invalidate(client)}
        >
          بازخوانی مرسوله‌ها
        </button>
      </div>
      <p>
        فقط تعداد داخل بسته هنگام خروج از انبار کم می‌شود. تحویل تمام کالاها پایان سفارش است؛ هزینهٔ
        ارسال و مبلغ سفارش دوباره محاسبه نمی‌شوند. حمل و رهگیری گزارش دستی فروشگاه‌اند.
      </p>
      <ErrorBox error={error ?? query.error ?? detail.error} />
      {query.isPending ? (
        <Busy />
      ) : (
        p && (
          <>
            {p.containsDemo && <p className="notice">دادهٔ نمونهٔ توسعه</p>}
            <div className="table-wrap">
              <AdminTable>
                <caption>تعداد اقلام در مراحل ارسال</caption>
                <thead>
                  <tr>
                    <th>کالا / SKU</th>
                    <th>سفارش</th>
                    <th>بسته‌بندی</th>
                    <th>خروج</th>
                    <th>تحویل</th>
                    <th>ماندهٔ انبار</th>
                  </tr>
                </thead>
                <tbody>
                  {p.lines
                    .filter((l) => !p.digitalLineKeys?.includes(l.lineKey))
                    .map((l) => (
                      <tr key={l.lineKey}>
                        <td>
                          {p.orderLines.find((x) => x.lineKey === l.lineKey)?.name}
                          <small>
                            <bdi>{p.orderLines.find((x) => x.lineKey === l.lineKey)?.sku}</bdi>
                          </small>
                        </td>
                        {[l.ordered, l.packed, l.dispatched, l.delivered, l.remaining].map(
                          (n, i) => (
                            <td key={i}>{n.toLocaleString('fa-IR')}</td>
                          ),
                        )}
                      </tr>
                    ))}
                </tbody>
              </AdminTable>
            </div>
            {p.blockers.length > 0 && (
              <ul>
                {p.blockers.map((b) => (
                  <li key={b}>{blockers[b] ?? b}</li>
                ))}
              </ul>
            )}
            <div className="table-wrap">
              <AdminTable>
                <caption>بسته‌های ثبت‌شده</caption>
                <thead>
                  <tr>
                    <th>بسته / مرجع</th>
                    <th>وضعیت</th>
                    <th>زمان</th>
                    <th>جزئیات</th>
                  </tr>
                </thead>
                <tbody>
                  {p.parcels.map((s) => (
                    <tr key={s.id}>
                      <td>
                        {BigInt(s.number).toLocaleString('fa-IR')} · {s.reference}
                      </td>
                      <td>{states[s.state]}</td>
                      <td
                        data-sort-value={
                          s.deliveredAt ?? s.dispatchedAt ?? s.voidedAt ?? s.packedAt
                        }
                      >
                        {date(s.deliveredAt ?? s.dispatchedAt ?? s.voidedAt ?? s.packedAt)}
                      </td>
                      <td>
                        <button
                          disabled={busy || !!entry}
                          onClick={() => {
                            setAction('');
                            setSelected(s.id);
                          }}
                        >
                          مشاهدهٔ بستهٔ {BigInt(s.number).toLocaleString('fa-IR')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </AdminTable>
            </div>
            <div className="row-buttons">
              {p.nextAfter && (
                <button
                  disabled={disabled}
                  onClick={() => {
                    setSelected('');
                    setAfter(p.nextAfter);
                  }}
                >
                  بسته‌های بعدی
                </button>
              )}
              {after && (
                <button
                  disabled={disabled}
                  onClick={() => {
                    setSelected('');
                    setAfter(null);
                  }}
                >
                  ابتدای فهرست بسته‌ها
                </button>
              )}
            </div>
            {previous && <ParcelFacts detail={previous} />}
            {writable && (
              <form onSubmit={preview}>
                <fieldset disabled={disabled}>
                  <Field label="عملیات مرسوله">
                    <select
                      required
                      value={action}
                      onChange={(e) => {
                        setAction(e.target.value as typeof action);
                        if (e.target.value === 'pack') setSelected('');
                      }}
                    >
                      <option value="">انتخاب کنید</option>
                      {Object.entries(labels).map(([k, v]) => (
                        <option
                          key={k}
                          value={k}
                          disabled={
                            k === 'pack'
                              ? !p.canPack
                              : k === 'deliver'
                                ? previous?.parcel.state !== 'dispatched'
                                : previous?.parcel.state !== 'packed' ||
                                  (k === 'dispatch' && !p.creditAuthorized)
                          }
                        >
                          {v}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {action === 'pack' && (
                    <Field label="مرجع بستهٔ جدید">
                      <input
                        required
                        maxLength={120}
                        value={reference}
                        onChange={(e) => setReference(e.target.value)}
                      />
                    </Field>
                  )}
                  {packing &&
                    p.orderLines
                      .filter((l) => !p.digitalLineKeys?.includes(l.lineKey))
                      .map((l) => {
                        const b = p.lines.find((x) => x.lineKey === l.lineKey)!,
                          own =
                            action === 'repack'
                              ? (previous?.lines.find((x) => x.lineKey === l.lineKey)?.quantity ??
                                0)
                              : 0,
                          max = b.remaining - b.packed + own;
                        return (
                          <section key={l.lineKey}>
                            <Field
                              label={
                                l.name +
                                ' · ' +
                                l.sku +
                                ' · ظرفیت این بسته: ' +
                                max.toLocaleString('fa-IR')
                              }
                            >
                              <input
                                inputMode="numeric"
                                maxLength={7}
                                value={quantities[l.lineKey] ?? ''}
                                onChange={(e) =>
                                  setQuantities({ ...quantities, [l.lineKey]: e.target.value })
                                }
                              />
                            </Field>
                            {l.trackingMode !== 'none' &&
                              candidates
                                .filter((u) => u.lineKey === l.lineKey)
                                .map((u) => (
                                  <Check
                                    key={u.id}
                                    label={'دستگاه: ' + (u.serial ?? u.imei1 ?? u.id)}
                                    checked={unitIds.includes(u.id)}
                                    onChange={(e) =>
                                      setUnitIds((ids) =>
                                        e.target.checked
                                          ? [...ids, u.id]
                                          : ids.filter((id) => id !== u.id),
                                      )
                                    }
                                  />
                                ))}
                          </section>
                        );
                      })}
                  {(action === 'dispatch' || action === 'deliver') && (
                    <div className="field">
                      <PersianDateField
                        label="زمان واقعی رویداد (وقت دستگاه شما)"
                        encoding="local"
                        required
                        value={occurred}
                        onChange={(next) => setOccurred(next)}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const d = new Date();
                          setOccurred(
                            new Date(d.getTime() - d.getTimezoneOffset() * 60000)
                              .toISOString()
                              .slice(0, 23),
                          );
                        }}
                      >
                        درج زمان کنونی دستگاه
                      </button>
                    </div>
                  )}
                  {action === 'dispatch' && (
                    <div className="form-grid">
                      <Field label="نام فارسی حمل‌کننده">
                        <input
                          required
                          maxLength={120}
                          value={fa}
                          onChange={(e) => setFa(e.target.value)}
                        />
                      </Field>
                      <Field label="نام انگلیسی حمل‌کننده">
                        <input
                          required
                          maxLength={120}
                          value={en}
                          onChange={(e) => setEn(e.target.value)}
                        />
                      </Field>
                      <Field label="شمارهٔ رهگیری گزارش‌شده (اختیاری)">
                        <input
                          maxLength={120}
                          value={tracking}
                          onChange={(e) => setTracking(e.target.value)}
                        />
                      </Field>
                    </div>
                  )}
                  {action && (
                    <>
                      <Field label="دلیل خصوصی عملیات مرسوله">
                        <textarea
                          required
                          maxLength={400}
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                      </Field>
                      <button type="submit">بازبینی عملیات مرسوله</button>
                    </>
                  )}
                </fieldset>
              </form>
            )}
          </>
        )
      )}
      <ParcelCommandGuard viewerId={viewerId} writable={writable} inline />
      {oldEntry && <p className="notice">ابتدا نتیجهٔ فرمان ارسال کامل قبلی را پیگیری کنید.</p>}
      {review && (
        <Modal
          title="بازبینی عملیات مرسوله"
          onClose={() => {
            if (!busy) setReview(null);
          }}
        >
          <p>
            <strong>{labels[review.input.action]}</strong> ·{' '}
            {review.input.reference ?? review.previous?.parcel.reference}
          </p>
          {review.input.lines.map((l) => (
            <p key={l.lineKey}>
              {review.before.orderLines.find((x) => x.lineKey === l.lineKey)?.name} ·{' '}
              {l.quantity.toLocaleString('fa-IR')} عدد · {l.unitIds.length.toLocaleString('fa-IR')}{' '}
              دستگاه رهگیری‌شده
            </p>
          ))}
          {review.previous && <ParcelFacts detail={review.previous} />}
          <p style={{ overflowWrap: 'anywhere' }}>{review.input.reason}</p>
          {review.input.occurredAt && <p>زمان واقعی: {date(review.input.occurredAt)}</p>}
          {review.input.action === 'dispatch' && (
            <p>
              {review.input.carrierNameFa} · {review.input.carrierNameEn} ·{' '}
              <bdi>{review.input.trackingNumber ?? 'بدون شمارهٔ رهگیری'}</bdi>
            </p>
          )}
          <p>
            {review.input.action === 'dispatch'
              ? 'فقط اقلام همین بسته از انبار خارج می‌شوند؛ این ثبت تأیید بانکی نیست.'
              : review.input.action === 'void'
                ? 'این بسته پیش از خروج باطل می‌شود؛ موجودی و مبلغ سفارش تغییر نمی‌کنند.'
                : review.input.action === 'deliver'
                  ? 'تحویل واقعی همین بسته ثبت می‌شود؛ سفارش فقط پس از تحویل تمام کالاها تکمیل می‌شود.'
                  : 'نسخهٔ اقلام و دستگاه‌های همین بسته ثبت می‌شود؛ موجودی هنوز از انبار کم نمی‌شود.'}
          </p>
          <Check
            label="اقلام، دستگاه‌ها و اثر همین عملیات را بررسی و تأیید کردم"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <button
            disabled={busy || !confirmed || !writable || !!entry || !!oldEntry}
            onClick={() => void send()}
          >
            تأیید ثبت عملیات مرسوله
          </button>
        </Modal>
      )}
    </section>
  );
}
function ParcelFacts({ detail: d }: { detail: ParcelDetail }) {
  return (
    <section className="notice">
      <h3>
        بستهٔ {BigInt(d.parcel.number).toLocaleString('fa-IR')} · {d.parcel.reference}
      </h3>
      <p>
        {states[d.parcel.state]} · ویرایش {d.parcel.packingRevision.toLocaleString('fa-IR')}
      </p>
      {d.lines.map((l) => (
        <p key={l.lineKey} style={{ overflowWrap: 'anywhere' }}>
          {l.name} · <bdi>{l.sku}</bdi> · {l.quantity.toLocaleString('fa-IR')} عدد · {l.label} ·{' '}
          {l.warranty}
        </p>
      ))}
      {d.units.map((u) => (
        <p key={u.unitId} style={{ overflowWrap: 'anywhere' }}>
          دستگاه <bdi>{u.serial ?? u.imei1 ?? u.unitId}</bdi>
          {u.imei2 && (
            <>
              {' '}
              · IMEI 2: <bdi>{u.imei2}</bdi>
            </>
          )}{' '}
          · پایان گارانتی: {u.warrantyUntil ? date(u.warrantyUntil) : 'نامشخص'}
        </p>
      ))}
    </section>
  );
}
