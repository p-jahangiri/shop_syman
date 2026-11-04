import { useId, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { CircleAlert, ClipboardList, Clock3, RefreshCw, Search } from 'lucide-react';
import { api, ApiError } from '../../api/api';
import { adminViewRevision } from '../../auth/admin-view-authority';
import { Busy, ErrorBox, Field, Modal } from '../../components/ui';
import {
  paymentOrderFilter,
  paymentReasonLabel,
  paymentRialDifference,
  paymentStateLabels,
} from '../../features/finance/payment-workspace-model';
import {
  readPaymentPage,
  type PaymentFilter,
  type PaymentItem,
  type PaymentPage,
} from '@sayman/web-shared/lib/orders/payment-contract.ts';
import '../../styles/finance/payment-workspace.css';

const queues = [
  [null, 'همهٔ تلاش‌ها'],
  ['review', 'نیازمند تطبیق'],
  ['pending', 'در انتظار تأیید'],
  ['verified', 'پرداخت اعمال شده'],
] as const;

const number = new Intl.NumberFormat('fa-IR');
const time = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Tehran',
});

function Rial({ value }: { value: bigint | string }) {
  return (
    <bdi className="payment-rial">
      {number.format(BigInt(value))} <small>ریال</small>
    </bdi>
  );
}

function State({ item }: { item: PaymentItem }) {
  return (
    <span className="payment-state" data-state={item.state}>
      {paymentStateLabels[item.state]}
    </span>
  );
}

function Evidence({ item }: { item: PaymentItem }) {
  if (item.verifiedAmountRial === null) return <span className="payment-muted">ثبت نشده</span>;
  const difference = paymentRialDifference(item);
  return (
    <>
      <Rial value={item.verifiedAmountRial} />
      {difference !== null && difference !== 0n && (
        <small className="payment-delta">
          {difference > 0n ? 'بیشتر از مبلغ درخواست' : 'کمتر از مبلغ درخواست'}
        </small>
      )}
    </>
  );
}

function PaymentDetail({
  item,
  close,
  showOrderAttempts,
}: {
  item: PaymentItem;
  close: () => void;
  showOrderAttempts?: () => void;
}) {
  const difference = paymentRialDifference(item);
  return (
    <Modal title="جزئیات تلاش پرداخت" onClose={close}>
      <div className="payment-detail">
        <div className="payment-tags">
          <State item={item} />
          {item.containsDemo && <span className="payment-demo">نمونهٔ توسعه</span>}
        </div>
        <div className="payment-detail-grid">
          <section>
            <h3>مبالغ ثبت‌شده</h3>
            <dl>
              <dt>درخواست از درگاه</dt>
              <dd>
                <Rial value={item.amountRial} />
              </dd>
              <dt>تأییدشده از درگاه</dt>
              <dd>
                <Evidence item={item} />
              </dd>
              {difference !== null && (
                <>
                  <dt>اختلاف تأیید با درخواست</dt>
                  <dd>
                    <Rial value={difference} />
                  </dd>
                </>
              )}
            </dl>
          </section>
          <section>
            <h3>زمان‌ها · تهران</h3>
            <dl>
              <dt>ثبت درخواست</dt>
              <dd>
                <time dateTime={item.createdAt}>{time.format(new Date(item.createdAt))}</time>
              </dd>
              <dt>آخرین تغییر</dt>
              <dd>
                <time dateTime={item.changedAt}>{time.format(new Date(item.changedAt))}</time>
              </dd>
              <dt>پایان مهلت اولیهٔ سفارش</dt>
              <dd>
                <time dateTime={item.orderExpiresAt}>
                  {time.format(new Date(item.orderExpiresAt))}
                </time>
              </dd>
              {item.verifiedAt && (
                <>
                  <dt>ثبت تأیید درگاه</dt>
                  <dd>
                    <time dateTime={item.verifiedAt}>{time.format(new Date(item.verifiedAt))}</time>
                  </dd>
                </>
              )}
            </dl>
          </section>
        </div>
        <section className="payment-detail-note">
          <h3>نتیجه برای سفارش</h3>
          <p>
            {item.verificationDisposition === 'applied'
              ? 'این پرداخت به سفارش اعمال شده است. وضعیت ارسال را از بخش سفارش‌ها بررسی کنید.'
              : item.state === 'review'
                ? 'این تلاش به سفارش اعمال نشده است. وضعیت فعلی سفارش و مدارک مالی را جداگانه تطبیق دهید.'
                : 'تأیید قابل اعمال برای این تلاش ثبت نشده است. وضعیت سفارش را جداگانه بررسی کنید.'}
          </p>
          {item.verificationReason && (
            <p>
              {paymentReasonLabel(item.verificationReason)}{' '}
              <code dir="ltr">{item.verificationReason}</code>
            </p>
          )}
        </section>
        <dl className="payment-identifiers">
          <dt>شناسهٔ سفارش</dt>
          <dd>
            <code dir="ltr">{item.orderId}</code>
          </dd>
          <dt>شناسهٔ تلاش</dt>
          <dd>
            <code dir="ltr">{item.id}</code>
          </dd>
        </dl>
        {showOrderAttempts && (
          <div className="row-buttons">
            <button type="button" onClick={showOrderAttempts}>
              همهٔ تلاش‌های این سفارش
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function PaymentsPage({ viewerId }: { viewerId: string }) {
  const [orderDraft, setOrderDraft] = useState('');
  const [filter, setFilter] = useState<PaymentFilter>({ state: null, orderId: null });
  const [orderError, setOrderError] = useState('');
  const orderHelpId = useId();
  const [openId, setOpenId] = useState<string | null>(null);
  const query = useInfiniteQuery({
    queryKey: ['admin', 'payments', viewerId, filter],
    initialPageParam: null as string | null,
    getNextPageParam: (last: PaymentPage) => last.nextCursor ?? undefined,
    retry: false,
    gcTime: 0,
    queryFn: async ({ pageParam, signal }): Promise<PaymentPage> => {
      const revision = adminViewRevision();
      const params = new URLSearchParams();
      if (filter.state) params.set('state', filter.state);
      if (filter.orderId) params.set('orderId', filter.orderId);
      if (pageParam) params.set('cursor', pageParam);
      const raw = await api<unknown>(
        '/admin/payments/attempts' + (params.size ? '?' + params : ''),
        { signal },
      );
      if (adminViewRevision() !== revision) throw Error('دسترسی حساب باید دوباره بررسی شود.');
      return readPaymentPage(raw, filter);
    },
  });
  const items = [
    ...new Map(
      query.data?.pages.flatMap((page) => page.items.map((item) => [item.id, item] as const)) ?? [],
    ).values(),
  ];
  const denied = query.error instanceof ApiError && [401, 403].includes(query.error.status);
  const failedRefresh = !!query.error && (denied || !query.isFetchNextPageError);
  const current = !failedRefresh && items.find((item) => item.id === openId);
  const changeFilter = (next: PaymentFilter) => {
    setOpenId(null);
    setFilter(next);
  };
  const errorText = denied
    ? 'دسترسی به سوابق پرداخت تأیید نشد.'
    : 'دریافت سوابق معتبر کامل نشد. فهرست را دوباره بخوانید.';
  return (
    <section className="panel payment-workspace" aria-label="پیگیری پرداخت و تطبیق مالی">
      <header className="section-heading payment-heading">
        <div>
          <span className="payment-eyebrow">
            <ClipboardList size={16} aria-hidden="true" /> سوابق مالی
          </span>
          <h2>تلاش‌های پرداخت آنلاین</h2>
          <p>مبلغ درخواست، تأیید درگاه و نتیجهٔ اعمال آن به سفارش را کنار هم بررسی کنید.</p>
        </div>
        <button
          type="button"
          className="payment-button"
          disabled={query.isFetching}
          onClick={() => {
            setOpenId(null);
            void query.refetch();
          }}
        >
          <RefreshCw size={16} aria-hidden="true" />
          بازخوانی سوابق
        </button>
      </header>
      <div className="payment-info">
        <CircleAlert size={18} aria-hidden="true" />
        <p>
          از این صفحه سوابق ثبت‌شده را می‌خوانید. تأیید درگاه و اعمال پرداخت به سفارش دو مرحلهٔ جدا
          هستند.
        </p>
      </div>

      <div className="payment-queues" role="group" aria-label="صف‌های پرداخت">
        {queues.map(([value, label]) => (
          <button
            key={label}
            type="button"
            aria-pressed={filter.state === value}
            onClick={() => changeFilter({ ...filter, state: value })}
          >
            {label}
          </button>
        ))}
      </div>

      <form
        className="payment-filters"
        aria-label="جست‌وجوی سراسری سوابق پرداخت"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            const orderId = paymentOrderFilter(orderDraft);
            setOrderDraft(orderId ?? '');
            setOrderError('');
            changeFilter({ ...filter, orderId });
          } catch {
            setOrderError('شناسهٔ کامل سفارش را وارد کنید. شناسهٔ کوتاه قابل جست‌وجو نیست.');
          }
        }}
      >
        <Field label="شناسهٔ سفارش">
          <input
            type="search"
            dir="ltr"
            autoComplete="off"
            maxLength={48}
            aria-describedby={orderHelpId}
            aria-invalid={!!orderError}
            value={orderDraft}
            onChange={(event) => {
              setOrderDraft(event.target.value);
              setOrderError('');
            }}
          />
        </Field>
        <Field label="وضعیت تلاش">
          <select
            value={filter.state ?? ''}
            onChange={(event) => {
              const state = event.target.value as PaymentFilter['state'];
              changeFilter({ ...filter, state: state || null });
            }}
          >
            <option value="">همهٔ وضعیت‌ها</option>
            {Object.entries(paymentStateLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <div className="payment-filter-actions">
          <button className="primary payment-button" type="submit">
            <Search size={16} aria-hidden="true" /> جست‌وجوی سفارش
          </button>
          {(filter.orderId || orderDraft) && (
            <button
              type="button"
              onClick={() => {
                setOrderDraft('');
                setOrderError('');
                changeFilter({ ...filter, orderId: null });
              }}
            >
              پاک‌کردن سفارش
            </button>
          )}
        </div>
        <p className="payment-filter-help" id={orderHelpId} role={orderError ? 'alert' : undefined}>
          {orderError || 'شناسهٔ کامل را از جزئیات سفارش بردارید. خط تیره مجاز است.'}
        </p>
      </form>
      {filter.orderId && (
        <p className="payment-active-filter" role="status">
          سفارش در حال بررسی <code dir="ltr">{filter.orderId}</code>
        </p>
      )}

      {failedRefresh ? (
        <ErrorBox error={Error(errorText)} />
      ) : query.isPending ? (
        <Busy />
      ) : (
        <>
          <div className="payment-list-meta">
            <p role="status">
              {number.format(items.length)} تلاش دریافت‌شده
              {query.hasNextPage ? ' · نتایج بیشتری در دسترس است' : ''}
            </p>
            <span>
              <Clock3 size={15} aria-hidden="true" /> جدیدترین ابتدا · زمان تهران
            </span>
          </div>
          {items.length === 0 ? (
            <div className="admin-empty-state payment-empty">
              <ClipboardList size={27} aria-hidden="true" />
              <strong>تلاشی در این فهرست ثبت نشده است</strong>
              {(filter.state || filter.orderId) && (
                <button
                  type="button"
                  onClick={() => {
                    setOrderDraft('');
                    setOrderError('');
                    changeFilter({ state: null, orderId: null });
                  }}
                >
                  نمایش همهٔ تلاش‌ها
                </button>
              )}
            </div>
          ) : (
            <div className="payment-records" role="region" aria-label="تلاش‌های پرداخت">
              <div className="payment-columns" aria-hidden="true">
                <span>سفارش و زمان ثبت</span>
                <span>وضعیت تلاش</span>
                <span>مبلغ درخواست</span>
                <span>تأیید درگاه</span>
                <span />
              </div>
              <ul className="payment-list">
                {items.map((item) => (
                  <li className="payment-row" key={item.id}>
                    <div>
                      <span className="payment-cell-title">سفارش</span>
                      <code dir="ltr">{item.orderId}</code>
                      <time className="payment-row-time" dateTime={item.createdAt}>
                        {time.format(new Date(item.createdAt))}
                      </time>
                    </div>
                    <div className="payment-tags">
                      <State item={item} />
                      {item.containsDemo && <span className="payment-demo">نمونهٔ توسعه</span>}
                    </div>
                    <div>
                      <span className="payment-cell-title">مبلغ درخواست</span>
                      <Rial value={item.amountRial} />
                    </div>
                    <div>
                      <span className="payment-cell-title">تأیید درگاه</span>
                      <Evidence item={item} />
                    </div>
                    <button
                      type="button"
                      aria-label={'جزئیات تلاش پرداخت ' + item.id}
                      onClick={() => setOpenId(item.id)}
                    >
                      جزئیات
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {query.isFetchNextPageError && (
            <ErrorBox
              error={Error('نتایج بیشتر دریافت نشد. فهرست فعلی تا آخرین دریافت موفق است.')}
            />
          )}
          {query.hasNextPage && (
            <button
              className="payment-more"
              type="button"
              disabled={query.isFetching}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage
                ? 'در حال دریافت…'
                : query.isFetchNextPageError
                  ? 'تلاش دوباره برای نتایج بیشتر'
                  : 'بارگذاری تلاش‌های بیشتر'}
            </button>
          )}
        </>
      )}
      {current && (
        <PaymentDetail
          item={current}
          close={() => setOpenId(null)}
          showOrderAttempts={
            filter.orderId !== current.orderId || filter.state !== null
              ? () => {
                  setOrderDraft(current.orderId);
                  setOrderError('');
                  changeFilter({ state: null, orderId: current.orderId });
                }
              : undefined
          }
        />
      )}
    </section>
  );
}
