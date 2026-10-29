import { AdminTable } from './admin-table';
import { OrderFulfillmentManager } from './order-parcels';
import { AdminCreditOrderInformation } from './credit-order-information';
import { ShipmentJournalPanel } from './order-shipment';
import { UsedConditionReport } from '../../storefront/components/used-condition';
import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { api, save } from './api';
import { Busy, Check, ErrorBox, Field, Modal } from './ui';
import { FormActions } from './forms';
import {
  type AdminOrderSummaryV2 as Summary,
  type AdminOrderDetailV2 as OrderDetail,
} from './orders-contract';
import { listAdminOrdersV2, readAdminOrderV2, cancelAdminOrderV2 } from './orders-client';
import { adminViewRevision } from './admin-view-authority';

const stateNames = {
  AwaitingPayment: 'در انتظار پرداخت',
  Paid: 'پرداخت‌شده',
  Cancelled: 'لغوشده',
  Expired: 'منقضی‌شده',
  Fulfilled: 'تحویل‌شده',
  CreditApproved: 'تأیید مالی چکی',
};
interface Settings {
  id: number;
  temporaryOrdersEnabled: boolean;
  chequeOrdersEnabled: boolean;
  reservationMinutes: number;
  maxOpenOrdersPerCustomer: number;
  version: string;
}
const date = (v: string) =>
  new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v));
const amount = (v: string) => new Intl.NumberFormat('fa-IR').format(BigInt(v)) + ' ریال';
const digits = (v: string) =>
  v
    .normalize('NFKC')
    .replace(/[۰-۹٠-٩]/g, (c) =>
      String('۰۱۲۳۴۵۶۷۸۹'.includes(c) ? '۰۱۲۳۴۵۶۷۸۹'.indexOf(c) : '٠١٢٣٤٥٦٧٨٩'.indexOf(c)),
    );

export default function OrdersPage({
  writable,
  inventoryReadable,
  inventoryWritable,
  viewerId,
}: {
  writable: boolean;
  inventoryReadable: boolean;
  inventoryWritable: boolean;
  viewerId: string;
}) {
  const settings = useQuery({
    queryKey: ['admin', 'order-settings'],
    queryFn: () => api<Settings>('/admin/order-settings'),
    refetchOnWindowFocus: false,
  });
  const orders = useInfiniteQuery({
    queryKey: ['admin', 'orders-v2', viewerId],
    queryFn: ({ pageParam }) => listAdminOrdersV2(api, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const [editing, setEditing] = useState<Settings | null>(null),
    [selected, setSelected] = useState<Summary | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const items = Array.from(
    new Map((orders.data?.pages.flatMap((p) => p.items) ?? []).map((o) => [o.id, o])).values(),
  );
  return (
    <>
      <ShipmentJournalPanel viewerId={viewerId} writable={writable && inventoryWritable} />
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>سفارش موقت و رزرو</h2>
            <p>
              سفارش موقت تا پایان مهلت موجودی را نگه می‌دارد. اتصال درگاه و پرداخت واقعی هنوز آماده
              نیست. سفارش چکی به محاسبه و مجوز خرید معتبر نیاز دارد؛ وصول چک جداگانه بررسی می‌شود.
            </p>
          </div>
          <button
            className="primary"
            disabled={!writable || !settings.data}
            onClick={() => setEditing(settings.data!)}
          >
            تنظیم سفارش موقت
          </button>
        </div>
        <ErrorBox error={settings.error} />
        {settings.isPending ? (
          <Busy />
        ) : (
          settings.data && (
            <dl className="charge-details">
              <dt>ثبت سفارش موقت نقدی</dt>
              <dd>{settings.data.temporaryOrdersEnabled ? 'فعال' : 'غیرفعال'}</dd>
              <dt>ثبت سفارش موقت چکی</dt>
              <dd>{settings.data.chequeOrdersEnabled ? 'فعال' : 'غیرفعال'}</dd>
              <dt>مدت رزرو پس از ثبت</dt>
              <dd>{settings.data.reservationMinutes.toLocaleString('fa-IR')} دقیقه</dd>
              <dt>حداکثر سفارش باز هر مشتری</dt>
              <dd>{settings.data.maxOpenOrdersPerCustomer.toLocaleString('fa-IR')}</dd>
            </dl>
          )
        )}
        <p className="notice">
          فعال‌سازی هر روش مستقل است و پرداخت را فعال نمی‌کند. محاسبه باید مبلغ نهایی مشخص، روش مجاز
          و نسخهٔ معتبر داشته باشد؛ خرید چکی علاوه بر این به مجوز خرید معتبر نیاز دارد. تنظیم جدید
          روی سفارش‌های ثبت‌شده و مهلت قبلی اثر نمی‌گذارد.
        </p>
      </section>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>سفارش‌ها</h2>
            <p>
              صفحه‌بندی سرور، هر بار ۲۰ سفارش؛ جدیدترین ابتدا. دسترسی فقط خواندن، اطلاعات تماس و
              نشانی را نمایش نمی‌دهد.
            </p>
          </div>
          <button disabled={orders.isFetching} onClick={() => void orders.refetch()}>
            دریافت وضعیت تازه
          </button>
        </div>
        <ErrorBox error={orders.error} />
        {orders.isPending ? (
          <Busy />
        ) : (
          <>
            <div className="table-wrap">
              <AdminTable>
                <thead>
                  <tr>
                    <th>شماره</th>
                    <th>وضعیت</th>
                    <th>تاریخ ثبت</th>
                    <th>مهلت رزرو</th>
                    <th>تعداد</th>
                    <th>مبلغ نهایی</th>
                    {writable && <th>عملیات</th>}
                  </tr>
                </thead>
                <tbody>
                  {items.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <bdi>{o.reference}</bdi>
                      </td>
                      <td>
                        {
                          stateNames[
                            o.state === 'AwaitingPayment' && Date.parse(o.expiresAt) <= now
                              ? 'Expired'
                              : o.state
                          ]
                        }
                      </td>
                      <td data-sort-value={o.createdAt}>{date(o.createdAt)}</td>
                      <td data-sort-value={o.expiresAt}>{date(o.expiresAt)}</td>
                      <td>{o.itemCount.toLocaleString('fa-IR')}</td>
                      <td data-sort-value={o.payableTotalRial}>{amount(o.payableTotalRial)}</td>
                      {writable && (
                        <td>
                          <button onClick={() => setSelected(o)}>
                            {inventoryReadable ? 'جزئیات و ارسال' : 'جزئیات و لغو'}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {!items.length && (
                    <tr>
                      <td colSpan={writable ? 7 : 6} className="empty">
                        هنوز سفارشی ثبت نشده است.
                      </td>
                    </tr>
                  )}
                </tbody>
              </AdminTable>
            </div>
            {orders.hasNextPage && (
              <button
                disabled={orders.isFetchingNextPage}
                onClick={() => void orders.fetchNextPage()}
              >
                {orders.isFetchingNextPage ? 'در حال دریافت…' : '۲۰ سفارش بعدی'}
              </button>
            )}
          </>
        )}
      </section>
      {editing && (
        <Modal title="تنظیم سفارش موقت" onClose={() => setEditing(null)}>
          <SettingsForm initial={editing} onClose={() => setEditing(null)} />
        </Modal>
      )}
      {selected && writable && (
        <Modal title={`سفارش ${selected.reference}`} onClose={() => setSelected(null)}>
          <OrderDetails
            key={`${viewerId}:${selected.ownerId}:${selected.id}`}
            viewerId={viewerId}
            summary={selected}
            now={now}
            inventoryReadable={inventoryReadable}
            inventoryWritable={inventoryWritable}
          />
        </Modal>
      )}
    </>
  );
}
function SettingsForm({ initial, onClose }: { initial: Settings; onClose: () => void }) {
  const client = useQueryClient();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    defaultValues: {
      enabled: initial.temporaryOrdersEnabled,
      chequeEnabled: initial.chequeOrdersEnabled,
      minutes: String(initial.reservationMinutes),
      max: String(initial.maxOpenOrdersPerCustomer),
    },
  });
  const mutation = useMutation({
    mutationFn: (v: unknown) => save('/admin/order-settings', v, 'PUT'),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['admin'] });
      onClose();
    },
  });
  const numeric = (min: number, max: number) =>
    z
      .string()
      .transform(digits)
      .refine((v) => /^\d{1,2}$/.test(v) && Number(v) >= min && Number(v) <= max)
      .transform(Number);
  const schema = z.object({
    enabled: z.boolean(),
    chequeEnabled: z.boolean(),
    minutes: numeric(1, 60),
    max: numeric(1, 10),
  });
  return (
    <form
      onSubmit={handleSubmit((values) => {
        if (mutation.isPending) return;
        const parsed = schema.safeParse(values);
        if (!parsed.success) {
          for (const issue of parsed.error.issues)
            setError(issue.path[0] as 'minutes' | 'max', {
              message: 'عدد صحیح در محدودهٔ اعلام‌شده وارد کنید.',
            });
          return;
        }
        mutation.mutate({
          temporaryOrdersEnabled: parsed.data.enabled,
          chequeOrdersEnabled: parsed.data.chequeEnabled,
          reservationMinutes: parsed.data.minutes,
          maxOpenOrdersPerCustomer: parsed.data.max,
          version: initial.version || null,
        });
      })}
    >
      <ErrorBox error={mutation.error} />
      <fieldset disabled={mutation.isPending}>
        <Check label="فعال‌سازی سفارش موقت نقدی برای روش مجاز" {...register('enabled')} />
        <Check label="فعال‌سازی سفارش موقت چکی با مجوز خرید معتبر" {...register('chequeEnabled')} />
        <div className="form-grid">
          <Field label="مهلت رزرو (۱ تا ۶۰ دقیقه)">
            <input inputMode="numeric" {...register('minutes')} />
            {errors.minutes && <small className="invalid">{errors.minutes.message}</small>}
          </Field>
          <Field label="حداکثر سفارش باز هر مشتری (۱ تا ۱۰)">
            <input inputMode="numeric" {...register('max')} />
            {errors.max && <small className="invalid">{errors.max.message}</small>}
          </Field>
        </div>
        <p className="notice">
          فعال‌سازی هر روش مستقل است. هزینهٔ ارسال و مالیات باید مشخص باشند؛ سفارش چکی به مجوز معتبر
          یک خرید نیاز دارد. این تنظیم دریافت وجه یا وصول چک را تأیید نمی‌کند. تغییر تنظیمات باعث
          نیاز به محاسبهٔ تازه پیش از ثبت سفارش می‌شود.
        </p>
      </fieldset>
      <FormActions pending={mutation.isPending} onClose={onClose} />
    </form>
  );
}
function OrderDetails({
  summary,
  now,
  viewerId,
  inventoryReadable,
  inventoryWritable,
}: {
  summary: Summary;
  now: number;
  viewerId: string;
  inventoryReadable: boolean;
  inventoryWritable: boolean;
}) {
  const client = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const authority = useRef(adminViewRevision()).current;
  const query = useQuery({
    queryKey: ['admin', 'order-v2', viewerId, summary.ownerId, summary.id],
    queryFn: () => readAdminOrderV2(api, summary.ownerId, summary.id),
    refetchOnWindowFocus: false,
  });
  const mutation = useMutation({
    mutationFn: (order: OrderDetail) => cancelAdminOrderV2(api, summary.ownerId, order),
    onSuccess: async (order) => {
      if (authority !== adminViewRevision()) return;
      client.setQueryData(['admin', 'order-v2', viewerId, summary.ownerId, summary.id], order);
      setConfirm(false);
      await client.invalidateQueries({ queryKey: ['admin', 'orders-v2', viewerId] });
    },
  });
  if (query.isPending) return <Busy />;
  const o = query.data;
  const expired = o?.summary.state === 'AwaitingPayment' && Date.parse(o.summary.expiresAt) <= now;
  return (
    <>
      <ErrorBox error={query.error ?? mutation.error} />
      <button
        disabled={query.isFetching || mutation.isPending}
        onClick={() => {
          setConfirm(false);
          mutation.reset();
          void query.refetch();
        }}
      >
        دریافت وضعیت تازه
      </button>
      {o && (
        <>
          <dl className="charge-details">
            <dt>نوع اقلام</dt>
            <dd>{o.originalSnapshotVersion === 2 ? 'شامل اقلام توافقی' : 'اقلام عادی فروشگاه'}</dd>
            <dt>وضعیت</dt>
            <dd>{stateNames[expired ? 'Expired' : o.summary.state]}</dd>
            <dt>نام</dt>
            <dd>{o.contactName}</dd>
            <dt>شمارهٔ تماس</dt>
            <dd>
              <bdi>{o.contactPhone}</bdi>
            </dd>
            <dt>ثبت / پایان رزرو</dt>
            <dd>
              {date(o.summary.createdAt)} / {date(o.summary.expiresAt)}
            </dd>
            <dt>روش خرید</dt>
            <dd>{o.methodName}</dd>
            <dt>مبلغ نهایی</dt>
            <dd>{amount(o.payableTotalRial)}</dd>
          </dl>
          <div className="notice">
            {o.paymentAvailability === 'credit_manual_authorization'
              ? 'سفارش دارای تعهد مالی چکی است؛ اعتبار جاری مجوز برای ارسال جداگانه بررسی می‌شود.'
              : o.paymentAvailability === 'credit_settlement_pending'
                ? 'سفارش چکی است؛ مجوز نهایی مالی را در بخش سفارش‌های چکی بررسی کنید.'
                : 'درگاه متصل نیست؛ پرداخت این سفارش در دسترس نیست.'}
          </div>
          {['credit_settlement_pending', 'credit_manual_authorization'].includes(
            o.paymentAvailability,
          ) && (
            <AdminCreditOrderInformation
              viewerId={viewerId}
              ownerId={summary.ownerId}
              orderId={summary.id}
              version={o.summary.version}
            />
          )}
          {o.delivery ? (
            <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              ایران، {o.delivery.province}، {o.delivery.city}
              <br />
              {o.delivery.address}
              <br />
              کد پستی: {o.delivery.postalCode}
            </p>
          ) : (
            <p>سفارش دیجیتال؛ ارسال فیزیکی ندارد.</p>
          )}
          {o.note && <p style={{ whiteSpace: 'pre-wrap' }}>{o.note}</p>}
          <div className="table-wrap">
            <AdminTable>
              <thead>
                <tr>
                  <th>کالا / تنوع</th>
                  <th>SKU</th>
                  <th>تعداد</th>
                  <th>جمع</th>
                </tr>
              </thead>
              <tbody>
                {o.lines.map((l) => (
                  <tr key={l.lineId}>
                    <td>
                      {l.name}
                      <small>
                        {l.label} · {l.warranty}
                      </small>
                      <UsedConditionReport condition={l.usedCondition} historical />
                      {l.accepted && (
                        <details>
                          <summary>
                            شرایط توافقی · ویرایش {l.accepted.revision.toLocaleString('fa-IR')}
                          </summary>
                          {l.accepted.containsDemo && <p className="notice">دادهٔ نمونهٔ توسعه</p>}
                          <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                            {l.accepted.termsFa}
                          </p>
                          <p
                            lang="en"
                            dir="ltr"
                            style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                          >
                            {l.accepted.termsEn}
                          </p>
                          <small>مهلت سهم اصلی: {date(l.accepted.allocationExpiresAt)}</small>
                        </details>
                      )}
                    </td>
                    <td>
                      <bdi>{l.sku}</bdi>
                    </td>
                    <td>{l.quantity.toLocaleString('fa-IR')}</td>
                    <td data-sort-value={l.lineTotalRial}>{amount(l.lineTotalRial)}</td>
                  </tr>
                ))}
              </tbody>
            </AdminTable>
          </div>
          <dl className="charge-details">
            <dt>اصل کالاها</dt>
            <dd>{amount(o.itemsSubtotalRial)}</dd>
            <dt>کالاها با افزوده</dt>
            <dd>{amount(o.goodsTotalRial)}</dd>
            <dt>ارسال</dt>
            <dd>{amount(o.shippingRial)}</dd>
            <dt>{o.taxIncluded ? 'مالیات داخل قیمت' : 'مالیات'}</dt>
            <dd>{amount(o.taxRial)}</dd>
          </dl>
          {o.canCancel &&
            !expired &&
            (confirm ? (
              <div className="notice">
                <p>
                  لغو سفارش پرداخت‌نشده و آزادسازی رزرو را تأیید می‌کنید؟ عملیات در audit ثبت
                  می‌شود.
                </p>
                {o.paymentAvailability === 'credit_settlement_pending' && (
                  <p>مجوز این خرید با لغو دوباره قابل استفاده نمی‌شود.</p>
                )}
                {o.originalSnapshotVersion === 2 && (
                  <p>
                    پیشنهادهای مصرف‌شده با لغو دوباره فعال نمی‌شوند؛ خرید دوباره به پیشنهاد تازه
                    نیاز دارد.
                  </p>
                )}
                <button
                  className="primary"
                  disabled={mutation.isPending || !!mutation.error}
                  onClick={() => mutation.mutate(o)}
                >
                  {mutation.isPending ? 'در حال لغو…' : 'تأیید لغو سفارش'}
                </button>
                <button disabled={mutation.isPending} onClick={() => setConfirm(false)}>
                  انصراف
                </button>
              </div>
            ) : (
              <button
                disabled={query.isFetching || !!mutation.error}
                onClick={() => setConfirm(true)}
              >
                لغو سفارش پرداخت‌نشده
              </button>
            ))}
          {inventoryReadable && (
            <OrderFulfillmentManager
              viewerId={viewerId}
              ownerId={summary.ownerId}
              orderId={summary.id}
              orderState={o.summary.state}
              writable={inventoryWritable}
            />
          )}
        </>
      )}
    </>
  );
}
