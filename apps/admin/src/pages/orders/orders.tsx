import { AdminTable } from '../../components/tables/admin-table';
import { OrderFulfillmentManager } from '../../features/orders/order-parcels';
import {
  DigitalJournalPanel,
  OrderDigitalDeliveryManager,
} from '../../features/orders/order-digital-delivery';
import { AdminCreditOrderInformation } from '../../features/finance/credit-order-information';
import { ShipmentJournalPanel } from '../../features/orders/order-shipment';
import { UsedConditionReport } from '@sayman/web-shared/components/catalog/used-condition';
import {
  hasPostpaidShipping,
  postpaidShippingNotice,
  hasUnitemizedTax,
  postpaidShippingAmountLabel,
  unitemizedTaxLabel,
  unitemizedTaxNotice,
} from '@sayman/web-shared/lib/checkout/checkout-shipping.ts';
import { useEffect, useRef, useState } from 'react';
import { Clock3, Package, RotateCw, Search, Settings2, X } from 'lucide-react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { api, save } from '../../api/api';
import { Busy, Check, ErrorBox, Field, Modal } from '../../components/ui';
import { FormActions } from '../../components/forms/forms';
import {
  type AdminOrderSummaryV2 as Summary,
  type AdminOrderDetailV2 as OrderDetail,
  type AdminOrderState,
} from '../../api/contracts/orders/orders-contract';
import { listAdminOrdersV2, readAdminOrderV2, cancelAdminOrderV2 } from '../../api/orders-client';
import { adminViewRevision } from '../../auth/admin-view-authority';
import '../../styles/orders/sales-order-workspace.css';

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
const dateTime = new Intl.DateTimeFormat('fa-IR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Tehran',
});
const date = (v: string) => dateTime.format(new Date(v));
const amount = (v: string | null) =>
  v === null ? 'تفکیک نشده' : new Intl.NumberFormat('fa-IR').format(BigInt(v)) + ' ریال';
const digits = (v: string) =>
  v
    .normalize('NFKC')
    .replace(/[۰-۹٠-٩]/g, (c) =>
      String('۰۱۲۳۴۵۶۷۸۹'.includes(c) ? '۰۱۲۳۴۵۶۷۸۹'.indexOf(c) : '٠١٢٣٤٥٦٧٨٩'.indexOf(c)),
    );

function effectiveOrderState(order: Summary | OrderDetail['summary'], now: number) {
  return order.state === 'AwaitingPayment' && Date.parse(order.expiresAt) <= now
    ? 'Expired'
    : order.state;
}

function OrderStateBadge({ state }: { state: AdminOrderState }) {
  const tone = {
    AwaitingPayment: 'pending',
    Paid: 'positive',
    Cancelled: 'negative',
    Expired: 'neutral',
    Fulfilled: 'positive',
    CreditApproved: 'info',
  }[state];
  return (
    <span className="sales-state" data-tone={tone}>
      {stateNames[state]}
    </span>
  );
}

const eventLabels: Record<string, string> = {
  temporary_order_created: 'ثبت سفارش موقت',
  temporary_order_v2_created: 'ثبت سفارش موقت',
  credit_temporary_order_created: 'ثبت سفارش چکی',
  reservation_expired: 'پایان مهلت رزرو',
  unpaid_order_cancelled: 'لغو سفارش پرداخت‌نشده',
  cash_payment_verified: 'تأیید پرداخت نقدی',
  credit_financially_approved: 'تأیید مالی خرید چکی',
  digital_content_available: 'آماده‌شدن محتوای دیجیتال',
  shipment_repacked: 'بسته‌بندی دوباره',
  shipment_packed: 'ثبت بسته‌بندی',
  shipment_shipped: 'ثبت ارسال',
  shipment_delivered: 'ثبت تحویل',
  parcel_pack: 'ثبت بسته‌بندی بسته',
  parcel_repack: 'بسته‌بندی دوباره',
  parcel_ship: 'ثبت ارسال بسته',
  parcel_deliver: 'ثبت تحویل بسته',
};

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
  const [state, setState] = useState<AdminOrderState | undefined>();
  const [search, setSearch] = useState('');
  const [reference, setReference] = useState('');
  const [searchError, setSearchError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settings = useQuery({
    queryKey: ['admin', 'order-settings'],
    queryFn: () => api<Settings>('/admin/order-settings'),
    refetchOnWindowFocus: false,
  });
  const orders = useInfiniteQuery({
    queryKey: ['admin', 'orders-v2', viewerId, state ?? '', reference],
    queryFn: ({ pageParam, signal }) =>
      listAdminOrdersV2(api, pageParam, { state, reference }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchOnWindowFocus: true,
  });
  const [editing, setEditing] = useState<Settings | null>(null),
    [selected, setSelected] = useState<Summary | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const items = Array.from(
    new Map((orders.data?.pages.flatMap((p) => p.items) ?? []).map((o) => [o.id, o])).values(),
  );
  const settingsSaved = Boolean(settings.data?.version);
  const hasFilters = Boolean(state || reference);
  function resetFilters() {
    setState(undefined);
    setReference('');
    setSearch('');
    setSearchError('');
  }
  return (
    <div className="sales-workspace">
      <section className="panel sales-queue">
        <header className="section-heading sales-queue-heading">
          <div>
            <h2>فهرست سفارش‌ها</h2>
            <p>شمارهٔ کامل سفارش را جست‌وجو کنید یا وضعیت را برای همهٔ سفارش‌ها تغییر دهید.</p>
          </div>
          <button type="button" disabled={orders.isFetching} onClick={() => void orders.refetch()}>
            <RotateCw size={16} aria-hidden="true" /> تازه‌سازی
          </button>
        </header>
        <form
          className="sales-queue-filters sales-search"
          role="search"
          aria-label="جست‌وجو در سفارش‌ها"
          onSubmit={(event) => {
            event.preventDefault();
            const input = digits(search).trim();
            const value = input.replace(/^SM-/i, '');
            if (
              input &&
              (!/^[0-9]{1,19}$/.test(value) ||
                BigInt(value) === 0n ||
                BigInt(value) > 9_223_372_036_854_775_807n)
            ) {
              setSearchError('شمارهٔ کامل سفارش را وارد کنید، مثل SM-1234.');
              return;
            }
            setSearchError('');
            const canonical = value ? BigInt(value).toString() : '';
            setReference(canonical);
          }}
        >
          <Field label="شمارهٔ سفارش" error={searchError || undefined}>
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setSearchError('');
                if (!event.target.value.trim()) setReference('');
              }}
              placeholder="SM-1234"
              dir="ltr"
              maxLength={24}
              autoComplete="off"
            />
          </Field>
          <Field label="وضعیت سفارش">
            <select
              value={state ?? ''}
              onChange={(event) =>
                setState((event.target.value || undefined) as AdminOrderState | undefined)
              }
            >
              <option value="">همهٔ وضعیت‌ها</option>
              {Object.entries(stateNames).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <button type="submit" className="primary sales-search-submit">
            <Search size={16} aria-hidden="true" /> جست‌وجو
          </button>
        </form>
        <div className="sales-queue-summary">
          <p role="status">
            {orders.isPending
              ? 'در حال دریافت سفارش‌ها…'
              : orders.isError && !orders.data
                ? 'دریافت فهرست با خطا روبه‌رو شد.'
                : `${items.length.toLocaleString('fa-IR')} سفارش دریافت‌شده`}
            {state && <> · {stateNames[state]}</>}
            {reference && (
              <>
                {' '}
                · <bdi>SM-{reference}</bdi>
              </>
            )}
          </p>
          {hasFilters && (
            <button type="button" onClick={resetFilters}>
              <X size={16} aria-hidden="true" /> پاک‌کردن فیلترها
            </button>
          )}
        </div>
        <ErrorBox error={orders.error} />
        {orders.isPending ? (
          <Busy />
        ) : (
          <>
            {!!items.length && (
              <AdminTable aria-label="فهرست سفارش‌ها" searchable={false}>
                <thead>
                  <tr>
                    <th>شماره</th>
                    <th>وضعیت</th>
                    <th>تاریخ ثبت</th>
                    <th>مهلت پرداخت</th>
                    <th>تعداد</th>
                    <th>مبلغ نهایی</th>
                    {writable && <th>عملیات</th>}
                  </tr>
                </thead>
                <tbody>
                  {items.map((o) => {
                    const current = o.state;
                    return (
                      <tr key={o.id}>
                        <td>
                          <bdi>{o.reference}</bdi>
                        </td>
                        <td>
                          <OrderStateBadge state={current} />
                        </td>
                        <td data-sort-value={o.createdAt}>{date(o.createdAt)}</td>
                        <td
                          data-sort-value={
                            current === 'AwaitingPayment' || current === 'Expired'
                              ? o.expiresAt
                              : ''
                          }
                        >
                          {current === 'AwaitingPayment' || current === 'Expired'
                            ? date(o.expiresAt)
                            : '—'}
                        </td>
                        <td>{o.itemCount.toLocaleString('fa-IR')}</td>
                        <td data-sort-value={o.payableTotalRial}>{amount(o.payableTotalRial)}</td>
                        {writable && (
                          <td>
                            <button
                              onClick={() => {
                                setNow(Date.now());
                                setSelected(o);
                              }}
                            >
                              باز کردن سفارش
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </AdminTable>
            )}
            {!items.length && !orders.error && (
              <div className="sales-empty">
                <Package aria-hidden="true" />
                <p>
                  {state || reference
                    ? 'سفارشی با این فیلترها پیدا نشد.'
                    : 'هنوز سفارشی ثبت نشده است.'}
                </p>
              </div>
            )}
            {!writable && (
              <p className="muted">
                دسترسی مشاهده شامل اطلاعات تماس، نشانی و اقدام‌های سفارش نمی‌شود.
              </p>
            )}
            {orders.hasNextPage && (
              <button disabled={orders.isFetching} onClick={() => void orders.fetchNextPage()}>
                {orders.isFetchingNextPage ? 'در حال دریافت…' : 'بارگذاری سفارش‌های بیشتر'}
              </button>
            )}
          </>
        )}
      </section>
      <ShipmentJournalPanel viewerId={viewerId} writable={writable && inventoryWritable} />
      <DigitalJournalPanel viewerId={viewerId} writable={writable && inventoryWritable} />
      <section className="panel sales-hero">
        <div className="sales-hero-heading">
          <span className="sales-hero-icon">
            <Package aria-hidden="true" />
          </span>
          <div>
            <h2>پیگیری سفارش‌ها و رزرو</h2>
            <p>
              سفارش را با شماره یا وضعیت پیدا کنید و مرحلهٔ پرداخت، ارسال یا تحویل را پیگیری کنید.
            </p>
          </div>
          <button
            aria-expanded={settingsOpen}
            aria-controls="order-reservation-settings"
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <Settings2 size={17} aria-hidden="true" /> تنظیمات رزرو
          </button>
        </div>
        <div className="sales-metrics">
          <div>
            <span>ثبت سفارش نقدی</span>
            <strong>
              {settings.data ? (settings.data.temporaryOrdersEnabled ? 'فعال' : 'غیرفعال') : '—'}
            </strong>
          </div>
          <div>
            <span>ثبت سفارش چکی</span>
            <strong>
              {settings.data ? (settings.data.chequeOrdersEnabled ? 'فعال' : 'غیرفعال') : '—'}
            </strong>
          </div>
          <div>
            <span>مهلت رزرو</span>
            <strong>
              {settingsSaved && settings.data
                ? settings.data.reservationMinutes.toLocaleString('fa-IR') + ' دقیقه'
                : '—'}
            </strong>
          </div>
          <div>
            <span>سقف سفارش باز هر مشتری</span>
            <strong>
              {settingsSaved && settings.data
                ? settings.data.maxOpenOrdersPerCustomer.toLocaleString('fa-IR')
                : '—'}
            </strong>
          </div>
        </div>
        <div id="order-reservation-settings" className="sales-section" hidden={!settingsOpen}>
          <ErrorBox error={settings.error} />
          {settings.isPending && <Busy />}
          <p>
            این تنظیم‌ها برای سفارش تازه اعمال می‌شوند. خرید چکی به مجوز معتبر نیاز دارد و اتصال
            درگاه پرداخت جداگانه تنظیم می‌شود.
          </p>
          {writable && settings.data && (
            <button type="button" onClick={() => setEditing(settings.data!)}>
              ویرایش تنظیمات سفارش موقت
            </button>
          )}
          {settings.error && (
            <button type="button" onClick={() => void settings.refetch()}>
              تلاش دوباره برای دریافت تنظیمات
            </button>
          )}
        </div>
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
    </div>
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
      minutes: initial.version ? String(initial.reservationMinutes) : '60',
      max: initial.version ? String(initial.maxOpenOrdersPerCustomer) : '',
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
          <Field
            label="مهلت رزرو (۱ تا ۶۰ دقیقه)"
            hint="برای تنظیم ذخیره‌نشده، ۶۰ دقیقه پیشنهاد می‌شود؛ اعمال فقط پس از ذخیره است."
          >
            <input required inputMode="numeric" {...register('minutes')} />
            {errors.minutes && <small className="invalid">{errors.minutes.message}</small>}
          </Field>
          <Field
            label="حداکثر سفارش باز هر مشتری (۱ تا ۱۰)"
            hint="سقف باید صریح انتخاب شود؛ تا پیش از انتخاب، عدد اولیهٔ تأییدشده‌ای وجود ندارد."
          >
            <input required inputMode="numeric" {...register('max')} />
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
  const state = o ? effectiveOrderState(o.summary, now) : null;
  const expires = state === 'AwaitingPayment' || state === 'Expired';
  const hasAcceptedTerms = o?.lines.some((line) => line.accepted !== null);
  const credit = o && o.paymentAvailability !== 'gateway_unconfigured';
  return (
    <div className="sales-order-detail">
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
      {o && state && (
        <>
          <section className="sales-section">
            <div className="section-heading">
              <h3>وضعیت و اطلاعات سفارش</h3>
              <OrderStateBadge state={state} />
            </div>
            <dl className="charge-details">
              <dt>نوع اقلام</dt>
              <dd>{hasAcceptedTerms ? 'شامل اقلام توافقی' : 'اقلام عادی فروشگاه'}</dd>
              <dt>نام</dt>
              <dd>{o.contactName}</dd>
              <dt>شمارهٔ تماس</dt>
              <dd>
                <bdi>{o.contactPhone}</bdi>
              </dd>
              <dt>زمان ثبت</dt>
              <dd>{date(o.summary.createdAt)}</dd>
              {expires && (
                <>
                  <dt>مهلت پرداخت موقت</dt>
                  <dd>{date(o.summary.expiresAt)}</dd>
                </>
              )}
              <dt>روش خرید</dt>
              <dd>{o.methodName}</dd>
              <dt>{hasPostpaidShipping(o) ? 'مبلغ سفارش نزد فروشگاه' : 'مبلغ نهایی'}</dt>
              <dd>{amount(o.payableTotalRial)}</dd>
            </dl>
            {hasPostpaidShipping(o) && <p className="notice">{postpaidShippingNotice('fa')}</p>}
            {hasUnitemizedTax(o) && <p className="notice">{unitemizedTaxNotice('fa')}</p>}
            {(credit || state === 'AwaitingPayment') && (
              <div className="notice">
                {o.paymentAvailability === 'credit_manual_authorization'
                  ? 'سفارش دارای تعهد مالی چکی است؛ اعتبار جاری مجوز برای ارسال جداگانه بررسی می‌شود.'
                  : o.paymentAvailability === 'credit_settlement_pending'
                    ? state === 'AwaitingPayment'
                      ? 'سفارش چکی است؛ مجوز نهایی مالی را در بخش سفارش‌های چکی بررسی کنید.'
                      : 'این سفارش با روش چکی ثبت شده است.'
                    : 'درگاه متصل نیست؛ پرداخت این سفارش در دسترس نیست.'}
              </div>
            )}
            {credit && (
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
          </section>
          <section className="sales-section">
            <h3>اقلام سفارش و صورت‌حساب</h3>
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
                            {l.accepted.containsDemo && (
                              <p className="notice">دادهٔ نمونهٔ توسعه</p>
                            )}
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
              <dd>
                {hasPostpaidShipping(o)
                  ? postpaidShippingAmountLabel('fa')
                  : amount(o.shippingRial)}
              </dd>
              <dt>{o.taxIncluded ? 'مالیات داخل قیمت' : 'مالیات'}</dt>
              <dd>{hasUnitemizedTax(o) ? unitemizedTaxLabel('fa') : amount(o.taxRial)}</dd>
            </dl>
          </section>
          <details className="sales-section">
            <summary>
              <Clock3 size={17} aria-hidden="true" /> رویدادهای ثبت‌شدهٔ سفارش (
              {o.events.length.toLocaleString('fa-IR')})
            </summary>
            <ol className="sales-order-timeline">
              {o.events.map((event, index) => (
                <li key={index}>
                  <span>{eventLabels[event.reason] ?? stateNames[event.state]}</span>
                  <time dateTime={event.at}>{date(event.at)}</time>
                </li>
              ))}
            </ol>
          </details>
          {o.canCancel &&
            state === 'AwaitingPayment' &&
            (confirm ? (
              <div className="notice">
                <p>
                  لغو سفارش پرداخت‌نشده و آزادسازی رزرو را تأیید می‌کنید؟ عملیات در audit ثبت
                  می‌شود.
                </p>
                {o.paymentAvailability === 'credit_settlement_pending' && (
                  <p>مجوز این خرید با لغو دوباره قابل استفاده نمی‌شود.</p>
                )}
                {hasAcceptedTerms && (
                  <p>
                    پیشنهادهای مصرف‌شده با لغو دوباره فعال نمی‌شوند؛ خرید دوباره به پیشنهاد تازه
                    نیاز دارد.
                  </p>
                )}
                <button
                  className="primary"
                  disabled={
                    mutation.isPending || query.isFetching || !!mutation.error || !!query.error
                  }
                  onClick={() => {
                    if (effectiveOrderState(o.summary, Date.now()) === 'Expired') {
                      setConfirm(false);
                      void query.refetch();
                      return;
                    }
                    mutation.mutate(o);
                  }}
                >
                  {mutation.isPending ? 'در حال لغو…' : 'تأیید لغو سفارش'}
                </button>
                <button disabled={mutation.isPending} onClick={() => setConfirm(false)}>
                  انصراف
                </button>
              </div>
            ) : (
              <button
                disabled={query.isFetching || !!mutation.error || !!query.error}
                onClick={() => setConfirm(true)}
              >
                لغو سفارش پرداخت‌نشده
              </button>
            ))}
          {inventoryReadable && (
            <OrderFulfillmentManager
              key={`physical:${viewerId}:${summary.ownerId}:${summary.id}`}
              viewerId={viewerId}
              ownerId={summary.ownerId}
              orderId={summary.id}
              orderState={o.summary.state}
              writable={inventoryWritable}
              hasDigital={o.lines.some((l) => l.isDigital)}
              hasPhysical={o.lines.some((l) => !l.isDigital)}
            />
          )}
          {inventoryReadable && o.lines.some((l) => l.isDigital) && (
            <OrderDigitalDeliveryManager
              key={`digital:${viewerId}:${summary.ownerId}:${summary.id}`}
              viewerId={viewerId}
              ownerId={summary.ownerId}
              orderId={summary.id}
              writable={inventoryWritable}
            />
          )}
        </>
      )}
    </div>
  );
}
