'use client';
import { advanceRequestGeneration } from '@sayman/web-shared/lib/data/request-generation.ts';
import { useEffect, useRef, useState } from 'react';
import { Truck } from 'lucide-react';
import { useCustomerSession } from '../auth/auth-provider';
import { useI18n } from '../navigation/locale-provider';
import { Button } from '../shared/ui';
import {
  readCustomerShipment,
  type CustomerShipment,
} from '@sayman/web-shared/lib/orders/order-shipment-contract.ts';
export function CustomerShipmentCard({
  orderId,
  initial,
  onRefresh,
}: {
  orderId: string;
  initial?: CustomerShipment;
  onRefresh?: () => void;
}) {
  const auth = useCustomerSession(),
    { locale, digits } = useI18n(),
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const [data, setData] = useState<CustomerShipment | null>(null),
    [busy, setBusy] = useState(true),
    [failed, setFailed] = useState(false),
    [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const owner = auth.session?.user.id;
  useEffect(() => {
    const ticket = ++generation.current,
      controller = new AbortController();
    setData(null);
    setBusy(true);
    setFailed(false);
    if (!owner || !/^[a-f0-9]{32}$/.test(orderId)) {
      setBusy(false);
      setFailed(true);
      return;
    }
    if (initial) {
      setData(initial);
      setBusy(false);
      return;
    }
    void (async () => {
      try {
        const response = await auth.store.fetch('/api/orders/v2/' + orderId + '/shipment', {
          signal: controller.signal,
        });
        if (!response.ok) throw Error('Shipment unavailable');
        const value = readCustomerShipment(await response.json(), orderId);
        if (
          ticket !== generation.current ||
          controller.signal.aborted ||
          auth.store.snapshot().session?.user.id !== owner
        )
          return;
        setData(value);
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
  }, [auth.store, owner, orderId, attempt, initial]);
  const date = (x: string) =>
    new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Tehran',
    }).format(new Date(x));
  const shipment = data?.shipment;
  return (
    <section className="card-panel">
      <div className="order-action-row">
        <h2>
          <Truck size={20} /> {text('ارسال و دستگاه‌های سفارش', 'Shipment and ordered devices')}
        </h2>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => (onRefresh ? onRefresh() : setAttempt((x) => x + 1))}
        >
          {text('بررسی وضعیت تازه', 'Refresh status')}
        </Button>
      </div>
      {busy ? (
        <p role="status">{text('در حال بررسی ارسال…', 'Checking shipment…')}</p>
      ) : failed ? (
        <p role="alert">
          {text(
            'وضعیت ارسال فعلاً خوانده نشد؛ دوباره بررسی کنید.',
            'Shipment status could not be loaded. Please retry.',
          )}
        </p>
      ) : !shipment ? (
        <p>
          {text(
            'هنوز بسته‌ای برای این سفارش ثبت نشده است. آماده‌سازی به تأیید پرداخت و تخصیص کالا نیاز دارد.',
            'No package has been recorded. Preparation requires confirmed payment and allocated goods.',
          )}
        </p>
      ) : (
        <>
          <p>
            <strong>
              {shipment.state === 'packed'
                ? text(
                    'بسته در حال آماده‌سازی برای خروج از انبار است.',
                    'Your package is prepared for warehouse hand-off.',
                  )
                : shipment.state === 'dispatched'
                  ? text(
                      'بسته به حمل‌کننده تحویل شده است.',
                      'Your package has been handed to the carrier.',
                    )
                  : text(
                      'تحویل بسته به مشتری ثبت شده است.',
                      'Delivery to the customer has been recorded.',
                    )}
            </strong>
          </p>
          {shipment.containsDemo && (
            <p className="small-note">
              {text(
                'دادهٔ نمونهٔ توسعه؛ ارسال واقعی نیست.',
                'Development sample data; not a real shipment.',
              )}
            </p>
          )}
          <dl className="charge-details">
            <dt>{text('نسخهٔ آماده‌سازی', 'Packing revision')}</dt>
            <dd>{digits(shipment.packingRevision)}</dd>
            <dt>{text('آماده‌سازی (تهران)', 'Prepared (Tehran time)')}</dt>
            <dd>{date(shipment.packedAt)}</dd>
            {shipment.dispatchedAt && (
              <>
                <dt>{text('تحویل به حمل‌کننده (تهران)', 'Carrier hand-off (Tehran time)')}</dt>
                <dd>{date(shipment.dispatchedAt)}</dd>
                <dt>{text('حمل‌کننده', 'Carrier')}</dt>
                <dd>{locale === 'fa' ? shipment.carrierNameFa : shipment.carrierNameEn}</dd>
                <dt>{text('شمارهٔ رهگیری گزارش‌شده', 'Reported tracking number')}</dt>
                <dd>
                  <bdi>{shipment.trackingNumber ?? text('ثبت نشده', 'Not recorded')}</bdi>
                </dd>
              </>
            )}
            {shipment.deliveredAt && (
              <>
                <dt>{text('تحویل به مشتری (تهران)', 'Customer delivery (Tehran time)')}</dt>
                <dd>{date(shipment.deliveredAt)}</dd>
              </>
            )}
          </dl>
          {data.manualCarrierReport && (
            <p className="small-note">
              {text(
                'این وضعیت و رهگیری، گزارش دستی فروشگاه است؛ تأیید خودکار شرکت حمل نیست.',
                'Status and tracking are manually recorded by the store; they are not automatic carrier confirmation.',
              )}
            </p>
          )}
          <h3>{text('اقلام همین بسته', 'Items in this package')}</h3>
          {shipment.lines.map((l) => (
            <p key={l.lineKey}>
              {l.name} · {l.label} · {text('تعداد', 'Quantity')}: {digits(l.quantity)} ·{' '}
              <bdi>{l.sku}</bdi>
            </p>
          ))}
          {!shipment.unitDetailsVisible ? (
            <p className="small-note">
              {text(
                'شناسه‌های اختصاصی دستگاه پس از خروج از انبار در حساب شما نمایش داده می‌شوند.',
                'Device identifiers become visible in your account after warehouse hand-off.',
              )}
            </p>
          ) : (
            shipment.units.length > 0 && (
              <>
                <h3>
                  {text(
                    'دستگاه‌های تحویل‌شده از انبار برای شما',
                    'Devices issued from the warehouse for your order',
                  )}
                </h3>
                {shipment.units.map((u, i) => (
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
                ))}
              </>
            )
          )}
        </>
      )}
    </section>
  );
}
