import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UserRound, ShoppingBag, MessagesSquare, CheckCircle2 } from 'lucide-react';
import { api } from './api';
import { Busy, ErrorBox } from './ui';
import { customerPath, readCustomerDetail } from './customers-contract';
import { date, count } from './customer-ui';
import { CustomerOrders, CustomerTickets } from './customer-history';
export function CustomerProfile({ id, viewerId }: { id: string; viewerId: string }) {
  const [section, setSection] = useState<'overview' | 'orders' | 'tickets'>('overview');
  const detail = useQuery({
    queryKey: ['admin', 'customer-detail', viewerId, id],
    queryFn: async ({ signal }) =>
      readCustomerDetail(await api<unknown>(customerPath(id), { signal }), id),
    gcTime: 0,
    retry: false,
  });
  if (detail.isPending) return <Busy />;
  if (detail.error || !detail.data)
    return (
      <>
        <ErrorBox error={detail.error} />
        <button onClick={() => void detail.refetch()}>دریافت دوبارهٔ پرونده</button>
      </>
    );
  const { identity, orders, support } = detail.data;
  const account = identity.account;
  const visibleSection =
    (section === 'orders' && !orders) || (section === 'tickets' && !support) ? 'overview' : section;
  return (
    <div className="customer-profile">
      <div className="customer-profile-heading">
        <span className="staff-avatar" aria-hidden="true">
          <UserRound size={24} />
        </span>
        <div>
          <h3>{account.displayName || account.userName}</h3>
          <bdi>{account.userName}</bdi>
          <p>{account.isStaff ? 'حساب همکار · سوابق فروشگاهی همین هویت' : 'مشتری فروشگاه'}</p>
        </div>
        <span className={`staff-state ${account.isActive ? 'is-active' : ''}`}>
          {account.isActive ? 'فعال' : 'غیرفعال'}
        </span>
      </div>
      <div className="customer-section-buttons" aria-label="بخش‌های پرونده">
        <button aria-pressed={visibleSection === 'overview'} onClick={() => setSection('overview')}>
          <UserRound size={17} />
          اطلاعات و سابقه
        </button>
        {orders && (
          <button aria-pressed={visibleSection === 'orders'} onClick={() => setSection('orders')}>
            <ShoppingBag size={17} />
            سفارش‌ها ({count(orders.totalOrders)})
          </button>
        )}
        {support && (
          <button aria-pressed={visibleSection === 'tickets'} onClick={() => setSection('tickets')}>
            <MessagesSquare size={17} />
            تیکت‌ها ({count(support.totalTickets)})
          </button>
        )}
      </div>
      {visibleSection === 'overview' ? (
        <>
          <dl className="customer-info-grid">
            <div>
              <dt>ایمیل</dt>
              <dd>
                <bdi>{identity.email || 'ثبت نشده'}</bdi>
                {identity.email && (
                  <small>{account.emailVerified ? 'تأییدشده' : 'تأییدنشده'}</small>
                )}
              </dd>
            </div>
            <div>
              <dt>شمارهٔ تماس</dt>
              <dd>
                <bdi>{identity.phoneNumber || 'ثبت نشده'}</bdi>
                {identity.phoneNumber && (
                  <small>{account.phoneVerified ? 'تأییدشده' : 'تأییدنشده'}</small>
                )}
              </dd>
            </div>
            <div>
              <dt>تاریخ عضویت</dt>
              <dd>{date(account.createdAt)}</dd>
            </div>
            <div>
              <dt>شناسهٔ مشتری</dt>
              <dd>
                <bdi>{id}</bdi>
              </dd>
            </div>
          </dl>
          <div className="customer-metrics">
            {orders ? (
              <>
                <CustomerMetric label="خرید قطعی" value={count(orders.confirmedPurchases)} />
                <CustomerMetric label="کل سفارش‌های ثبت‌شده" value={count(orders.totalOrders)} />
                <CustomerMetric
                  label="سفارش فعال در انتظار پرداخت"
                  value={count(orders.awaitingPaymentOrders)}
                />
              </>
            ) : (
              <p>برای مشاهدهٔ سابقهٔ سفارش، مجوز فروش لازم است.</p>
            )}
            {support ? (
              <CustomerMetric label="تیکت‌های باز" value={count(support.openTickets)} />
            ) : (
              <p>برای مشاهدهٔ تیکت، مجوز پشتیبانی لازم است.</p>
            )}
          </div>
          <p className="notice">
            خرید قطعی شامل سفارش پرداخت‌شده، خرید چکی تأییدشده یا تحویل‌شده است؛ ثبت سفارش به‌تنهایی
            خرید قطعی یا وصول وجه نیست.
            {orders && orders.demoOrders !== '0'
              ? ` این حساب ${count(orders.demoOrders)} سفارش نمونهٔ توسعه دارد که در آمار همین محیط لحاظ شده‌اند.`
              : ''}
          </p>
          <dl className="customer-info-grid">
            <div>
              <dt>آخرین سفارش</dt>
              <dd>
                {orders
                  ? orders.lastOrderAt
                    ? date(orders.lastOrderAt)
                    : 'سفارشی ثبت نشده'
                  : 'مجوز مشاهده ندارید'}
              </dd>
            </div>
            <div>
              <dt>آخرین تغییر تیکت</dt>
              <dd>
                {support
                  ? support.lastTicketAt
                    ? date(support.lastTicketAt)
                    : 'تیکتی ثبت نشده'
                  : 'مجوز مشاهده ندارید'}
              </dd>
            </div>
          </dl>
        </>
      ) : visibleSection === 'orders' && orders ? (
        <CustomerOrders id={id} viewerId={viewerId} />
      ) : visibleSection === 'tickets' && support ? (
        <CustomerTickets id={id} viewerId={viewerId} />
      ) : null}
    </div>
  );
}
function CustomerMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <CheckCircle2 size={19} aria-hidden="true" />
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
