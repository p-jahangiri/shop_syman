import { PersianDateField } from '../../components/forms/persian-date-field';
import { AdminTable } from '../../components/tables/admin-table';
import { orderParcelJournal } from '../../state/orders/order-parcel-journal';
import { orderDigitalJournal } from '../../state/orders/order-digital-journal';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/api';
import { Busy, ErrorBox, Field } from '../../components/ui';
import { adminViewRevision } from '../../auth/admin-view-authority';
import {
  shipmentInputSchema,
  shipmentResultSchema,
  readAdminShipment,
  shipmentReadPath,
  shipmentReceiptPath,
  type ShipmentResult,
  type AdminShipment,
} from '../../api/contracts/orders/order-shipment-contract';
import {
  subscribeShipmentJournal,
  shipmentJournalSnapshot,
  clearShipmentJournal,
} from '../../state/orders/order-shipment-journal';
import { sendShipment, recoverShipment } from './order-shipment-actions';
const names = {
  pack: 'آماده‌سازی بسته',
  repack: 'بازبینی و آماده‌سازی دوبارهٔ بسته',
  dispatch: 'تحویل بسته به حمل‌کننده',
  deliver: 'تأیید تحویل به مشتری',
} as const;
const stages = {
  packed: 'آمادهٔ خروج از انبار',
  dispatched: 'تحویل‌شده به حمل‌کننده',
  delivered: 'تحویل به مشتری ثبت شده',
} as const;
const blockers: Record<string, string> = {
  credit_clearance_required: 'مجوز مالی چکی معتبر نیست؛ مالی باید نسخهٔ جاری چک‌ها را بازبینی کند.',
  payment_not_confirmed: 'پرداخت یا مجوز مستقل مالی چکی تأیید نشده است.',
  physical_only_fulfillment_required:
    'این گردش برای ارسال کامل سفارش صرفاً فیزیکی است؛ تحویل دیجیتال یا ارسال جزئی مسیر جدا می‌خواهد.',
  shipment_tracked_unit_limit:
    'این بسته بیش از ۱۰۰ دستگاه قابل رهگیری دارد و در این گردش پشتیبانی نمی‌شود.',
  reservation_not_allocated: 'رزرو سفارش باید پس از پرداخت یا مجوز مالی چکی متعهد شده باشد.',
  reservation_not_fulfilled: 'خروج کامل این سفارش از انبار تأیید نشده است.',
  complete_serial_assignment_required:
    'تمام دستگاه‌های سریال/IMEI باید به خطوط دقیق همین سفارش تخصیص یافته باشند.',
  packed_inventory_changed:
    'مشخصات رزرو یا دستگاه‌ها پس از آماده‌سازی تغییر کرده؛ بستهٔ متفاوت را ارسال نکنید.',
  shipment_complete: 'تحویل این سفارش ثبت شده است.',
};
const date = (x: string) =>
  new Intl.DateTimeFormat('fa-IR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tehran',
  }).format(new Date(x));
const localNow = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 23);
};
function ShipmentFacts({ shipment }: { shipment: ShipmentResult['shipment'] }) {
  return (
    <>
      <p>
        <strong>{stages[shipment.state]}</strong>
        {shipment.containsDemo && <span className="notice"> · دادهٔ نمونهٔ توسعه</span>}
      </p>
      <dl className="charge-details">
        <dt>شناسهٔ بسته</dt>
        <dd>
          <code dir="ltr">{shipment.id}</code>
        </dd>
        <dt>نسخهٔ آماده‌سازی</dt>
        <dd>{shipment.packingRevision.toLocaleString('fa-IR')}</dd>
        <dt>آماده‌سازی (تهران)</dt>
        <dd>{date(shipment.packedAt)}</dd>
        {shipment.dispatchedAt && (
          <>
            <dt>خروج و تحویل به حمل‌کننده (تهران)</dt>
            <dd>{date(shipment.dispatchedAt)}</dd>
            <dt>حمل‌کنندهٔ گزارش‌شده</dt>
            <dd>
              {shipment.carrierNameFa} · {shipment.carrierNameEn}
            </dd>
            <dt>شمارهٔ رهگیری گزارش‌شده</dt>
            <dd>
              <bdi>{shipment.trackingNumber ?? 'ثبت نشده'}</bdi>
            </dd>
          </>
        )}
        {shipment.deliveredAt && (
          <>
            <dt>تحویل به مشتری (تهران)</dt>
            <dd>{date(shipment.deliveredAt)}</dd>
          </>
        )}
      </dl>
      <PackingFacts lines={shipment.lines} units={shipment.units} />
    </>
  );
}
function PackingFacts({
  lines,
  units,
}: {
  lines: AdminShipment['packingLines'];
  units: AdminShipment['packingUnits'];
}) {
  return (
    <>
      <div className="table-wrap" role="region" aria-label="اقلام بستهٔ سفارش">
        <AdminTable>
          <thead>
            <tr>
              <th>کالا / SKU</th>
              <th>خط سفارش</th>
              <th>تعداد / رهگیری</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.lineKey}>
                <td>
                  {l.name}
                  <small>
                    {l.label} · {l.warranty}
                  </small>
                  <bdi>{l.sku}</bdi>
                </td>
                <td>
                  <code dir="ltr">{l.lineKey}</code>
                </td>
                <td>
                  {l.quantity.toLocaleString('fa-IR')} · {l.trackingMode}
                </td>
              </tr>
            ))}
          </tbody>
        </AdminTable>
      </div>
      {units.length > 0 && (
        <details>
          <summary>
            دستگاه‌های همین بسته ({units.length.toLocaleString('fa-IR')}) · اطلاعات خصوصی
          </summary>
          {units.map((u) => (
            <dl className="charge-details" key={u.unitId}>
              <dt>شناسهٔ دستگاه / خط</dt>
              <dd>
                <code dir="ltr">
                  {u.unitId} / {u.lineKey}
                </code>
              </dd>
              <dt>سریال</dt>
              <dd>
                <bdi>{u.serial ?? 'ثبت نشده'}</bdi>
              </dd>
              <dt>IMEI اول / دوم</dt>
              <dd>
                <bdi>
                  {u.imei1 ?? 'ثبت نشده'} / {u.imei2 ?? 'ثبت نشده'}
                </bdi>
              </dd>
              <dt>پایان گارانتی ثبت‌شده</dt>
              <dd>
                {u.warrantyUntil ? date(u.warrantyUntil) : 'نامشخص؛ تاریخ خودکار تعیین نمی‌شود'}
              </dd>
            </dl>
          ))}
        </details>
      )}
    </>
  );
}
export function ShipmentCommandGuard({ viewerId }: { viewerId: string }) {
  const entry = useSyncExternalStore(
    subscribeShipmentJournal,
    () => shipmentJournalSnapshot(viewerId),
    () => null,
  );
  if (!entry || entry.state === 'done' || entry.state === 'rejected') return null;
  return (
    <div className="notice" role="status">
      نتیجهٔ فرمان ارسال سفارش <code dir="ltr">{entry.command.orderId}</code>{' '}
      {entry.state === 'pending' ? 'در حال دریافت است' : 'هنوز مشخص نیست'}. بدنه و شناسه در حافظهٔ
      همین حساب محفوظ‌اند؛ از بخش سفارش‌ها همان رسید را پیگیری کنید.
    </div>
  );
}
export function ShipmentJournalPanel({
  viewerId,
  writable,
  inline = false,
}: {
  viewerId: string;
  writable: boolean;
  inline?: boolean;
}) {
  const entry = useSyncExternalStore(
    subscribeShipmentJournal,
    () => shipmentJournalSnapshot(viewerId),
    () => null,
  );
  const client = useQueryClient();
  const [lookup, setLookup] = useState({ order: '', command: '' }),
    [historical, setHistorical] = useState<ShipmentResult | null>(null),
    [error, setError] = useState<unknown>(),
    [reading, setReading] = useState(false);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['admin', 'shipment', viewerId] });
    void client.invalidateQueries({ queryKey: ['admin', 'order-digital', viewerId] });
    void client.invalidateQueries({ queryKey: ['admin', 'orders-v2', viewerId] });
    void client.invalidateQueries({ queryKey: ['admin', 'order-v2', viewerId] });
  };
  async function readHistorical() {
    setReading(true);
    setError(null);
    setHistorical(null);
    try {
      const revision = adminViewRevision();
      const value = shipmentResultSchema.parse(
        await api(shipmentReceiptPath(lookup.order, lookup.command)),
      );
      if (adminViewRevision() !== revision) return;
      if (value.orderId !== lookup.order || value.commandId !== lookup.command)
        throw Error('رسید متعلق به شناسه‌های واردشده نیست.');
      setHistorical(value);
    } catch (e) {
      setError(e);
    } finally {
      setReading(false);
    }
  }
  return (
    <section className="panel">
      <h2>رسید و پیگیری ارسال سفارش</h2>
      {entry && (
        <div className="notice" role="status">
          <strong>
            {entry.state === 'done'
              ? 'فرمان ارسال با رسید سرور تأیید شد.'
              : entry.state === 'rejected'
                ? 'فرمان ارسال پذیرفته نشد.'
                : entry.state === 'pending'
                  ? 'در حال پیگیری همان فرمان ارسال…'
                  : 'نتیجهٔ فرمان ارسال هنوز مشخص نیست.'}
          </strong>
          <p>
            سفارش: <code dir="ltr">{entry.command.orderId}</code> · فرمان:{' '}
            <code dir="ltr">{entry.command.input.commandId}</code>
          </p>
          {entry.message && <p>{entry.message}</p>}
          {entry.result ? (
            <>
              <p>این رسید تاریخی همان فرمان است؛ وضعیت جاری را جدا بازخوانی کنید.</p>
              <p>
                {entry.result.reason} · ثبت رسید: {date(entry.result.recordedAt)}
              </p>
              <ShipmentFacts shipment={entry.result.shipment} />
              <button
                onClick={() => {
                  refresh();
                  clearShipmentJournal(viewerId);
                }}
              >
                بازخوانی وضعیت و آماده‌کردن مرحلهٔ بعد
              </button>
            </>
          ) : entry.state === 'rejected' ? (
            <button
              onClick={() => {
                refresh();
                clearShipmentJournal(viewerId);
              }}
            >
              بازخوانی برای اصلاح فرمان ارسال
            </button>
          ) : (
            <>
              <p>
                پیش از تعیین نتیجه، فرمان تازه نسازید. بستن تب یا خروج این بدنه را پاک می‌کند؛
                شناسه‌ها را برای خواندن رسید نگه دارید.
              </p>
              <div className="row-buttons">
                <button
                  disabled={!writable || entry.state === 'pending'}
                  onClick={() => void recoverShipment(viewerId, entry.command)}
                >
                  رسید همین فرمان ارسال
                </button>
                <button
                  disabled={!writable || entry.state === 'pending'}
                  onClick={() => void sendShipment(viewerId, entry.command)}
                >
                  ارسال دقیق همان فرمان ارسال
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {!inline && (
        <details>
          <summary>خواندن رسید تاریخی ارسال با شناسه</summary>
          <Field label="شناسهٔ سفارش برای رسید ارسال">
            <input
              dir="ltr"
              maxLength={32}
              disabled={!writable || reading}
              value={lookup.order}
              onChange={(e) => setLookup({ ...lookup, order: e.target.value })}
            />
          </Field>
          <Field label="شناسهٔ فرمان ارسال">
            <input
              dir="ltr"
              maxLength={32}
              disabled={!writable || reading}
              value={lookup.command}
              onChange={(e) => setLookup({ ...lookup, command: e.target.value })}
            />
          </Field>
          <button disabled={!writable || reading} onClick={() => void readHistorical()}>
            خواندن رسید تاریخی ارسال
          </button>
          <ErrorBox error={error} />
          {historical && (
            <>
              <p>
                رسید تاریخی · {names[historical.action]} · {historical.reason}
              </p>
              <ShipmentFacts shipment={historical.shipment} />
            </>
          )}
        </details>
      )}
    </section>
  );
}
export function OrderShipmentManager({
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
  const query = useQuery({
    queryKey: ['admin', 'shipment', viewerId, ownerId, orderId],
    queryFn: async ({ signal }) => {
      const revision = adminViewRevision(),
        value = await api(shipmentReadPath(ownerId, orderId), { signal });
      if (adminViewRevision() !== revision) throw Error('دسترسی حساب دوباره باید بررسی شود.');
      return readAdminShipment(value, ownerId, orderId);
    },
    refetchOnWindowFocus: false,
  });
  const entry = useSyncExternalStore(
    subscribeShipmentJournal,
    () => shipmentJournalSnapshot(viewerId),
    () => null,
  );
  const [reason, setReason] = useState(''),
    [ack, setAck] = useState(false),
    [occurred, setOccurred] = useState(''),
    [fa, setFa] = useState(''),
    [en, setEn] = useState(''),
    [tracking, setTracking] = useState(''),
    [error, setError] = useState<unknown>();
  const parcelEntry = useSyncExternalStore(
    orderParcelJournal.subscribe,
    () => orderParcelJournal.snapshot(viewerId),
    () => null,
  );
  const digitalEntry = useSyncExternalStore(
    orderDigitalJournal.subscribe,
    () => orderDigitalJournal.snapshot(viewerId),
    () => null,
  );
  const data = query.data,
    action = data?.canPack
      ? 'pack'
      : data?.canRepack
        ? 'repack'
        : data?.canDispatch
          ? 'dispatch'
          : data?.canDeliver
            ? 'deliver'
            : null,
    locked = entry !== null || parcelEntry !== null || digitalEntry !== null;
  useEffect(() => {
    setAck(false);
    setReason('');
    setOccurred('');
  }, [action, data?.orderVersion, data?.shipment?.version, data?.inventoryFingerprint]);
  function submit() {
    if (!data || !action || !writable || locked) return;
    try {
      const input = shipmentInputSchema.parse({
        ownerId,
        commandId: crypto.randomUUID().replaceAll('-', ''),
        action,
        orderVersion: data.orderVersion,
        shipmentVersion: data.shipment?.version ?? null,
        inventoryFingerprint: data.inventoryFingerprint,
        reason,
        acknowledge: ack,
        carrierNameFa: action === 'dispatch' ? fa.trim() : null,
        carrierNameEn: action === 'dispatch' ? en.trim() : null,
        trackingNumber: action === 'dispatch' && tracking.trim() ? tracking.trim() : null,
        occurredAt:
          action === 'pack' || action === 'repack' ? null : new Date(occurred).toISOString(),
      });
      setError(null);
      void sendShipment(viewerId, { orderId, input, before: structuredClone(data) }, true);
    } catch (e) {
      setError(e);
    }
  }
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>آماده‌سازی، ارسال و تحویل</h2>
        <button
          disabled={query.isFetching || entry?.state === 'pending'}
          onClick={() => {
            setAck(false);
            void query.refetch();
          }}
        >
          بازخوانی وضعیت ارسال
        </button>
      </div>
      <p>
        خروج از انبار و تحویل به مشتری دو مرحلهٔ جدا هستند. این بخش، پرداختی ثبت نمی‌کند. حمل‌کننده
        و رهگیری گزارش دستی‌اند؛ اتصال زندهٔ ارسال فعال نیست.
      </p>
      <ErrorBox error={query.error} />
      {query.isPending ? (
        <Busy />
      ) : (
        data && (
          <>
            {data.containsDemo && <p className="notice">این سفارش دادهٔ نمونهٔ توسعه دارد.</p>}
            {data.shipment && <ShipmentFacts shipment={data.shipment} />}
            <h3>اقلام و دستگاه‌های بازبینی جاری</h3>
            <PackingFacts lines={data.packingLines} units={data.packingUnits} />
            {data.blockers.length > 0 && (
              <ul>
                {data.blockers.map((b) => (
                  <li key={b}>{blockers[b] ?? b}</li>
                ))}
              </ul>
            )}
            {action && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                <h3>{names[action]}</h3>
                {action !== 'pack' && action !== 'repack' && (
                  <div className="field">
                    <PersianDateField
                      label="زمان واقعی این رویداد (وقت این دستگاه)"
                      encoding="local"
                      required
                      disabled={locked || !writable}
                      value={occurred}
                      onChange={(next) => setOccurred(next)}
                    />
                    <button
                      type="button"
                      disabled={locked || !writable}
                      onClick={() => setOccurred(localNow())}
                    >
                      درج زمان کنونی دستگاه
                    </button>
                  </div>
                )}
                {action === 'dispatch' && (
                  <div className="form-grid">
                    <Field label="نام حمل‌کننده به فارسی (گزارش دستی)">
                      <input
                        required
                        maxLength={120}
                        disabled={locked || !writable}
                        value={fa}
                        onChange={(e) => setFa(e.target.value)}
                      />
                    </Field>
                    <Field label="نام حمل‌کننده به انگلیسی (گزارش دستی)">
                      <input
                        required
                        maxLength={120}
                        disabled={locked || !writable}
                        value={en}
                        onChange={(e) => setEn(e.target.value)}
                      />
                    </Field>
                    <Field label="شمارهٔ رهگیری گزارش‌شده (اختیاری)">
                      <input
                        dir="auto"
                        maxLength={120}
                        disabled={locked || !writable}
                        value={tracking}
                        onChange={(e) => setTracking(e.target.value)}
                      />
                    </Field>
                  </div>
                )}
                <Field label="دلیل ثبت این مرحله">
                  <input
                    required
                    maxLength={400}
                    disabled={locked || !writable}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
                <label className="check">
                  <input
                    type="checkbox"
                    disabled={locked || !writable}
                    checked={ack}
                    onChange={(e) => setAck(e.target.checked)}
                  />
                  {action === 'repack'
                    ? 'بسته را با مشخصات جاری دوباره تطبیق داده‌ام؛ نسخهٔ قبلی و رسید آن حفظ می‌شوند.'
                    : action === 'pack'
                      ? 'اقلام و تمام دستگاه‌های همین بسته را با سفارش و مجوز آماده‌سازی آن تطبیق داده‌ام.'
                      : action === 'dispatch'
                        ? 'کل این بسته واقعاً از انبار خارج و به حمل‌کنندهٔ ثبت‌شده تحویل شده است.'
                        : 'تحویل واقعی همین بسته به مشتری را بررسی کرده‌ام؛ گزارش خودکار حمل نیست.'}
                </label>
                <ErrorBox error={error} />
                <button
                  className="primary"
                  disabled={locked || !writable || !ack || !reason.trim() || query.isFetching}
                >
                  {names[action]}
                </button>
              </form>
            )}
          </>
        )
      )}
      {locked && (
        <p className="notice">
          فرمان قبلی در بخش رسید محفوظ است؛ پیش از اقدام تازه نتیجهٔ همان فرمان را پیگیری کنید.
        </p>
      )}
      <ShipmentJournalPanel viewerId={viewerId} writable={writable} inline />
    </section>
  );
}
