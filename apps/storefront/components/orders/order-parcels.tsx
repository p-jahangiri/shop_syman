'use client';
import { advanceRequestGeneration } from '@sayman/web-shared/lib/data/request-generation.ts';
import { useEffect, useRef, useState } from 'react';
import { Truck } from 'lucide-react';
import { useCustomerSession } from '../auth/auth-provider';
import { useI18n } from '../navigation/locale-provider';
import { Button } from '../shared/ui';
import { CustomerShipmentCard } from './order-shipment';
import {
  customerFulfillmentPath,
  readCustomerFulfillment,
  readParcelDetail,
  type CustomerFulfillment,
  type ParcelDetail,
} from '@sayman/web-shared/lib/orders/order-parcel-contract.ts';
export function CustomerFulfillmentCard({ orderId }: { orderId: string }) {
  const auth = useCustomerSession(),
    owner = auth.session?.user.id,
    { locale, digits } = useI18n(),
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const [after, setAfter] = useState<string | undefined>(),
    [attempt, setAttempt] = useState(0),
    [page, setPage] = useState<{
      owner: string;
      order: string;
      after: string | undefined;
      value: CustomerFulfillment;
    } | null>(null),
    [failed, setFailed] = useState(false),
    [busy, setBusy] = useState(true),
    [selected, setSelected] = useState(''),
    [detail, setDetail] = useState<{
      owner: string;
      order: string;
      parcel: string;
      value: ParcelDetail;
    } | null>(null),
    [detailBusy, setDetailBusy] = useState(false),
    [detailFailed, setDetailFailed] = useState(false);
  const generation = useRef(0),
    detailGeneration = useRef(0);
  useEffect(() => {
    const ticket = ++generation.current,
      controller = new AbortController();
    setBusy(true);
    setFailed(false);
    setPage(null);
    setSelected('');
    setDetail(null);
    if (!owner) {
      setBusy(false);
      return;
    }
    void (async () => {
      try {
        const response = await auth.store.fetch(
          customerFulfillmentPath(orderId, undefined, after),
          { signal: controller.signal },
        );
        if (!response.ok || response.headers.get('X-Sayman-Fulfillment-Contract') !== 'parcels-v1')
          throw Error('Fulfillment unavailable');
        const value = readCustomerFulfillment(await response.json(), orderId);
        if (
          ticket !== generation.current ||
          controller.signal.aborted ||
          auth.store.snapshot().session?.user.id !== owner
        )
          return;
        setPage({ owner, order: orderId, after, value });
      } catch {
        if (ticket === generation.current && !controller.signal.aborted) setFailed(true);
      } finally {
        if (ticket === generation.current && !controller.signal.aborted) setBusy(false);
      }
    })();
    return () => {
      advanceRequestGeneration(generation);
      controller.abort();
    };
  }, [auth.store, owner, orderId, after, attempt]);
  useEffect(() => {
    const ticket = ++detailGeneration.current,
      controller = new AbortController();
    setDetail(null);
    setDetailFailed(false);
    setDetailBusy(!!selected);
    if (!owner || !selected) return;
    void (async () => {
      try {
        const response = await auth.store.fetch(customerFulfillmentPath(orderId, selected), {
          signal: controller.signal,
        });
        if (!response.ok || response.headers.get('X-Sayman-Fulfillment-Contract') !== 'parcels-v1')
          throw Error('Parcel unavailable');
        const value = readParcelDetail(await response.json(), orderId, selected, true);
        if (
          ticket !== detailGeneration.current ||
          controller.signal.aborted ||
          auth.store.snapshot().session?.user.id !== owner
        )
          return;
        setDetail({ owner, order: orderId, parcel: selected, value });
      } catch {
        if (ticket === detailGeneration.current && !controller.signal.aborted)
          setDetailFailed(true);
      } finally {
        if (ticket === detailGeneration.current && !controller.signal.aborted) setDetailBusy(false);
      }
    })();
    return () => {
      advanceRequestGeneration(detailGeneration);
      controller.abort();
    };
  }, [auth.store, owner, orderId, selected, attempt]);
  const p =
      page && page.owner === owner && page.order === orderId && page.after === after
        ? page.value
        : null,
    d =
      detail && detail.owner === owner && detail.order === orderId && detail.parcel === selected
        ? detail.value
        : null;
  const refresh = () => setAttempt((n) => n + 1),
    date = (v: string) =>
      new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Tehran',
      }).format(new Date(v));
  const state = (s: string) =>
    s === 'packed'
      ? text('بسته‌بندی‌شده', 'Packed')
      : s === 'void'
        ? text('باطل پیش از ارسال', 'Voided before dispatch')
        : s === 'dispatched'
          ? text('تحویل به حمل‌کننده', 'Handed to carrier')
          : text('تحویل‌شده به شما', 'Delivered to you');
  if (p && p.mode !== 'parcels' && p.single)
    return <CustomerShipmentCard orderId={orderId} initial={p.single} onRefresh={refresh} />;
  return (
    <section className="card-panel">
      <div className="order-action-row">
        <h2>
          <Truck size={20} />
          {text('بسته‌های سفارش', 'Order packages')}
        </h2>
        <Button variant="outline" disabled={busy} onClick={refresh}>
          {text('بررسی وضعیت تازه', 'Refresh status')}
        </Button>
      </div>
      {busy ? (
        <p role="status">{text('در حال بررسی بسته‌ها…', 'Loading packages…')}</p>
      ) : failed || !p ? (
        <p role="alert">
          {text(
            'وضعیت بسته‌ها فعلاً خوانده نشد؛ دوباره بررسی کنید.',
            'Package status could not be loaded. Please retry.',
          )}
        </p>
      ) : (
        <>
          <p className="small-note">
            {text(
              'زمان‌ها و رهگیری، گزارش دستی فروشگاه‌اند. سفارش پس از تحویل تمام کالاها تکمیل می‌شود.',
              'Times and tracking are manually recorded by the store. The order completes when all items have been delivered.',
            )}
          </p>
          {p.parcels.map((s) => (
            <article className="customer-order-item" key={s.id}>
              <div>
                <h3>
                  {text('بستهٔ', 'Package')} {digits(s.number)} · {s.reference}
                </h3>
                <p>
                  {state(s.state)} ·{' '}
                  {date(s.deliveredAt ?? s.dispatchedAt ?? s.voidedAt ?? s.packedAt)}
                </p>
                <p>
                  {text('تعداد اقلام این بسته', 'Items in this package')}:{' '}
                  {digits(s.lines.reduce((n, l) => n + l.quantity, 0))}
                </p>
                {s.dispatchedAt && (
                  <>
                    <p>
                      {text('حمل‌کننده', 'Carrier')}:{' '}
                      {locale === 'fa' ? s.carrierNameFa : s.carrierNameEn}
                    </p>
                    <p>
                      {text('شمارهٔ رهگیری گزارش‌شده', 'Reported tracking number')}:{' '}
                      <bdi>{s.trackingNumber ?? text('ثبت نشده', 'Not recorded')}</bdi>
                    </p>
                  </>
                )}
                <Button
                  variant="outline"
                  disabled={detailBusy && selected === s.id}
                  onClick={() => setSelected((current) => (current === s.id ? '' : s.id))}
                >
                  {selected === s.id
                    ? text('بستن جزئیات بسته', 'Close package details')
                    : text('مشاهدهٔ اقلام و دستگاه‌های بسته', 'View package items and devices')}
                </Button>
              </div>
            </article>
          ))}
          {p.parcels.length === 0 && (
            <p>{text('بسته‌ای در این صفحه وجود ندارد.', 'No packages on this page.')}</p>
          )}
          <div className="order-action-row">
            {p.nextAfter && (
              <Button variant="outline" onClick={() => setAfter(p.nextAfter!)}>
                {text('بسته‌های بعدی', 'Next packages')}
              </Button>
            )}
            {after && (
              <Button variant="outline" onClick={() => setAfter(undefined)}>
                {text('ابتدای فهرست بسته‌ها', 'First packages')}
              </Button>
            )}
          </div>
        </>
      )}
      {selected && (
        <section aria-live="polite">
          {detailBusy ? (
            <p>{text('در حال دریافت جزئیات بسته…', 'Loading package details…')}</p>
          ) : detailFailed ? (
            <p role="alert">
              {text(
                'جزئیات بسته خوانده نشد. وضعیت را دوباره بررسی کنید.',
                'Package details could not be loaded. Refresh the status to retry.',
              )}
            </p>
          ) : (
            d && (
              <>
                <h3>
                  {text('اقلام بستهٔ', 'Items in package')} {digits(d.parcel.number)}
                </h3>
                {d.containsDemo && (
                  <p className="small-note">
                    {text(
                      'دادهٔ نمونهٔ توسعه؛ ارسال واقعی نیست.',
                      'Development sample data; not a real shipment.',
                    )}
                  </p>
                )}
                {d.lines.map((l) => (
                  <p
                    key={l.lineKey}
                    className="preserve-lines"
                    style={{ overflowWrap: 'anywhere' }}
                  >
                    {l.name} · {l.label} · <bdi>{l.sku}</bdi> · {text('تعداد', 'Quantity')}:{' '}
                    {digits(l.quantity)} · {l.warranty}
                  </p>
                ))}
                {!d.unitDetailsVisible ? (
                  <p className="small-note">
                    {text(
                      'شناسه‌های دستگاه فقط پس از خروج بسته از انبار نمایش داده می‌شوند.',
                      'Device identifiers are shown after the package leaves the warehouse.',
                    )}
                  </p>
                ) : (
                  d.units.map((u, i) => (
                    <div className="customer-order-item" key={u.unitId}>
                      <div>
                        <h4>
                          {text('دستگاه', 'Device')} {digits(i + 1)}
                        </h4>
                        {u.serial && (
                          <p>
                            {text('سریال', 'Serial')}: <bdi>{u.serial}</bdi>
                          </p>
                        )}
                        {u.imei1 && (
                          <p>
                            IMEI 1: <bdi>{u.imei1}</bdi>
                          </p>
                        )}
                        {u.imei2 && (
                          <p>
                            IMEI 2: <bdi>{u.imei2}</bdi>
                          </p>
                        )}
                        <p>
                          {text('پایان گارانتی ثبت‌شده', 'Recorded warranty end')}:{' '}
                          {u.warrantyUntil ? date(u.warrantyUntil) : text('نامشخص', 'Unknown')}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </>
            )
          )}
        </section>
      )}
    </section>
  );
}
