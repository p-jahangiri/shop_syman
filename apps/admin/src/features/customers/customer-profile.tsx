import { useId, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarDays,
  ChevronLeft,
  CircleCheck,
  ContactRound,
  Hash,
  Mail,
  MessagesSquare,
  Phone,
  ShoppingBag,
  UserRound,
} from 'lucide-react';
import { api } from '../../api/api';
import { Busy, ErrorBox } from '../../components/ui';
import { customerPath, readCustomerDetail } from '../../api/contracts/customers/customers-contract';
import { date, count } from './customer-ui';
import { CustomerOrders, CustomerTickets } from './customer-history';

type ProfileSection = 'overview' | 'orders' | 'tickets';

export function CustomerProfile({
  id,
  viewerId,
  initialSection = 'overview',
}: {
  id: string;
  viewerId: string;
  initialSection?: ProfileSection;
}) {
  const [section, setSection] = useState(initialSection);
  const contentId = useId();
  const detail = useQuery({
    queryKey: ['admin', 'customer-detail', viewerId, id],
    queryFn: async ({ signal }) =>
      readCustomerDetail(await api<unknown>(customerPath(id), { signal }), id),
    gcTime: 0,
    retry: false,
  });

  if (detail.isPending) return <Busy />;
  if (detail.isError)
    return (
      <div className="customer-directory-empty">
        <ErrorBox error={detail.error} />
        <button type="button" onClick={() => void detail.refetch()}>
          دریافت دوبارهٔ پرونده
        </button>
      </div>
    );

  const { identity, orders, support } = detail.data;
  const account = identity.account;
  const name = account.displayName || account.userName;
  const visibleSection =
    (section === 'orders' && !orders) || (section === 'tickets' && !support) ? 'overview' : section;

  return (
    <div className="customer-record">
      <header className="customer-record-header">
        <div className="customer-directory-identity">
          <span className="customer-directory-avatar" aria-hidden="true">
            {Array.from(name.trim())[0] || <ContactRound size={24} />}
          </span>
          <div className="customer-directory-text">
            <h3 dir="auto">{name}</h3>
            <small>
              <bdi>{account.userName}</bdi>
              <span>{account.isStaff ? 'حساب همکار' : 'حساب مشتری'}</span>
            </small>
          </div>
        </div>
        <span className="customer-directory-state" data-active={account.isActive}>
          {account.isActive ? 'حساب فعال' : 'حساب غیرفعال'}
        </span>
      </header>
      {(orders || support) && (
        <div className="customer-directory-segments" role="group" aria-label="بخش‌های پرونده">
          <button
            type="button"
            aria-controls={contentId}
            aria-pressed={visibleSection === 'overview'}
            onClick={() => setSection('overview')}
          >
            <UserRound size={16} aria-hidden="true" /> نمای کلی
          </button>
          {orders && (
            <button
              type="button"
              aria-controls={contentId}
              aria-pressed={visibleSection === 'orders'}
              onClick={() => setSection('orders')}
            >
              <ShoppingBag size={16} aria-hidden="true" /> سفارش‌ها
            </button>
          )}
          {support && (
            <button
              type="button"
              aria-controls={contentId}
              aria-pressed={visibleSection === 'tickets'}
              onClick={() => setSection('tickets')}
            >
              <MessagesSquare size={16} aria-hidden="true" /> تیکت‌ها
            </button>
          )}
        </div>
      )}
      <div id={contentId} className="customer-record-body">
        {visibleSection === 'overview' ? (
          <>
            <section className="customer-record-section">
              <h4>مشخصات حساب</h4>
              <dl className="customer-record-facts">
                <CustomerFact icon={<Phone size={16} />} label="شمارهٔ تماس">
                  {identity.phoneNumber ? (
                    <>
                      <bdi>{identity.phoneNumber}</bdi>
                      <Verification verified={account.phoneVerified} />
                    </>
                  ) : (
                    <span>ثبت نشده</span>
                  )}
                </CustomerFact>
                <CustomerFact icon={<Mail size={16} />} label="ایمیل">
                  {identity.email ? (
                    <>
                      <bdi>{identity.email}</bdi>
                      <Verification verified={account.emailVerified} />
                    </>
                  ) : (
                    <span>ثبت نشده</span>
                  )}
                </CustomerFact>
                <CustomerFact icon={<CalendarDays size={16} />} label="تاریخ عضویت">
                  <time dateTime={account.createdAt}>{date(account.createdAt)}</time>
                </CustomerFact>
                <CustomerFact icon={<Hash size={16} />} label="شناسهٔ حساب">
                  <bdi>{id}</bdi>
                </CustomerFact>
              </dl>
            </section>
            {(orders || support) && (
              <section className="customer-record-section">
                <h4>سابقهٔ مشتری</h4>
                <div className="customer-record-activities">
                  {orders && (
                    <ActivityCard
                      icon={<ShoppingBag size={19} />}
                      title="خرید و سفارش"
                      tone="orders"
                      onClick={() => setSection('orders')}
                    >
                      <dl>
                        <ActivityMetric label="خرید قطعی" value={orders.confirmedPurchases} />
                        <ActivityMetric label="همهٔ سفارش‌ها" value={orders.totalOrders} />
                        <ActivityMetric
                          label="در انتظار پرداخت"
                          value={orders.awaitingPaymentOrders}
                        />
                      </dl>
                      <p>
                        {orders.lastOrderAt ? (
                          <>
                            آخرین سفارش:{' '}
                            <time dateTime={orders.lastOrderAt}>{date(orders.lastOrderAt)}</time>
                          </>
                        ) : (
                          'هنوز سفارشی ثبت نشده است.'
                        )}
                      </p>
                    </ActivityCard>
                  )}
                  {support && (
                    <ActivityCard
                      icon={<MessagesSquare size={19} />}
                      title="پشتیبانی"
                      tone="tickets"
                      onClick={() => setSection('tickets')}
                    >
                      <dl>
                        <ActivityMetric label="تیکت‌های باز" value={support.openTickets} />
                        <ActivityMetric label="همهٔ تیکت‌ها" value={support.totalTickets} />
                      </dl>
                      <p>
                        {support.lastTicketAt ? (
                          <>
                            آخرین تغییر:{' '}
                            <time dateTime={support.lastTicketAt}>
                              {date(support.lastTicketAt)}
                            </time>
                          </>
                        ) : (
                          'هنوز تیکتی ثبت نشده است.'
                        )}
                      </p>
                    </ActivityCard>
                  )}
                </div>
                {orders && (
                  <p className="customer-record-note">
                    خرید قطعی شامل سفارش پرداخت‌شده، خرید چکی تأییدشده یا سفارش تحویل‌شده است.
                    {orders.demoOrders !== '0' &&
                      ` در آمار این حساب ${count(orders.demoOrders)} سفارش نمونهٔ توسعه هم لحاظ شده است.`}
                  </p>
                )}
              </section>
            )}
          </>
        ) : visibleSection === 'orders' ? (
          <CustomerOrders id={id} viewerId={viewerId} />
        ) : (
          <CustomerTickets id={id} viewerId={viewerId} />
        )}
      </div>
    </div>
  );
}

function CustomerFact({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <dt>
        <span aria-hidden="true">{icon}</span>
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

function Verification({ verified }: { verified: boolean }) {
  return (
    <span className="customer-record-verification" data-verified={verified}>
      {verified && <CircleCheck size={13} aria-hidden="true" />}
      {verified ? 'تأییدشده' : 'تأییدنشده'}
    </span>
  );
}

function ActivityCard({
  icon,
  title,
  tone,
  onClick,
  children,
}: {
  icon: ReactNode;
  title: string;
  tone: 'orders' | 'tickets';
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <div className="customer-record-activity" data-tone={tone}>
      <div className="customer-record-activity-heading">
        <h5>
          <span aria-hidden="true">{icon}</span>
          {title}
        </h5>
        <button type="button" className="customer-directory-button" onClick={onClick}>
          {tone === 'orders' ? 'سابقهٔ سفارش' : 'سابقهٔ تیکت'}
          <ChevronLeft size={15} aria-hidden="true" />
        </button>
      </div>
      {children}
    </div>
  );
}

function ActivityMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{count(value)}</dd>
    </div>
  );
}
