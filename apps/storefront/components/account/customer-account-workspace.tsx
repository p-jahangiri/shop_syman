'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  ArrowUpLeft,
  Bell,
  ChevronLeft,
  CircleHelp,
  CreditCard,
  Clock3,
  Heart,
  LayoutDashboard,
  LogOut,
  MapPin,
  Package,
  RefreshCw,
  Settings2,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import Link from '../navigation/localized-link';
import { useCustomerSession } from '../auth/auth-provider';
import { useI18n } from '../navigation/locale-provider';
import { useShop } from '../providers/shop-provider';
import { Button, groupNavigation } from '../shared/ui';
import { AccountSettings } from './account-settings';
import {
  loadAccountOverview,
  type AccountOverview,
  type AccountOverviewSection,
} from '@/lib/account/account-overview';
import { CustomerAccountError, readCustomerAccount } from '@/lib/account/customer-account-client';
import type { CustomerAccountProfile } from '@/lib/account/customer-account-contract';
import type { CustomerSession } from '@/lib/account/customer-session';
import { advanceRequestGeneration } from '@sayman/web-shared/lib/data/request-generation.ts';
import './customer-account-workspace.css';

type View = 'overview' | 'settings';
type Section<T> = AccountOverviewSection<T> | { status: 'loading' };
type Overview = {
  [K in keyof AccountOverview]: Section<
    AccountOverview[K] extends AccountOverviewSection<infer T> ? T : never
  >;
};
const emptyOverview = (): Overview => ({
  orders: { status: 'loading' },
  addresses: { status: 'loading' },
  notifications: { status: 'loading' },
});
const orderStates = {
  AwaitingPayment: ['در انتظار پرداخت', 'Awaiting payment'],
  Paid: ['پرداخت‌شده', 'Paid'],
  Cancelled: ['لغوشده', 'Cancelled'],
  Expired: ['منقضی‌شده', 'Expired'],
  Fulfilled: ['تحویل‌شده', 'Fulfilled'],
  CreditApproved: ['تأیید مالی چکی', 'Credit financially approved'],
} as const;

export function CustomerAccountWorkspace({
  session,
  busy,
  error,
  onLogout,
  onPasswordChanged,
}: {
  session: CustomerSession;
  busy: boolean;
  error: string;
  onLogout: () => Promise<void>;
  onPasswordChanged: (outcome: 'changed' | 'unknown') => Promise<void>;
}) {
  const { store } = useCustomerSession();
  const { locale, digits, toman, t } = useI18n();
  const { wishlist, wishlistStatus } = useShop();
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const owner = session.user.id;
  const revision = store.viewRevision();
  const id = useId();
  const [view, setView] = useState<View>('overview');
  const [overview, setOverview] = useState<Overview>(emptyOverview);
  const [profile, setProfile] = useState<CustomerAccountProfile | null>(null);
  const [profileStatus, setProfileStatus] = useState<
    'loading' | 'ready' | 'unavailable' | 'forbidden'
  >('loading');
  const [attempt, setAttempt] = useState(0);
  const [profileAttempt, setProfileAttempt] = useState(0);
  const generation = useRef(0);
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const current = ++generation.current;
    const abort = new AbortController();
    const active = () =>
      !abort.signal.aborted &&
      current === generation.current &&
      store.snapshot().status === 'member' &&
      store.snapshot().session?.user.id === owner &&
      store.viewRevision() === revision;
    setOverview(emptyOverview());
    void loadAccountOverview(store.fetch, abort.signal, (section) => {
      if (!active()) return;
      setOverview((previous) => ({ ...previous, [section.kind]: section }));
    }).catch(() => {
      if (active())
        setOverview((previous) => ({
          orders:
            previous.orders.status === 'loading' ? { status: 'unavailable' } : previous.orders,
          addresses:
            previous.addresses.status === 'loading'
              ? { status: 'unavailable' }
              : previous.addresses,
          notifications:
            previous.notifications.status === 'loading'
              ? { status: 'unavailable' }
              : previous.notifications,
        }));
    });
    return () => {
      advanceRequestGeneration(generation);
      abort.abort();
    };
  }, [store, owner, revision, attempt]);
  useEffect(() => {
    const abort = new AbortController();
    const active = () =>
      !abort.signal.aborted &&
      store.snapshot().status === 'member' &&
      store.snapshot().session?.user.id === owner &&
      store.viewRevision() === revision;
    setProfileStatus('loading');
    void readCustomerAccount(store.fetch, owner, abort.signal)
      .then((value) => {
        if (active()) {
          setProfile(value);
          setProfileStatus('ready');
        }
      })
      .catch((error) => {
        if (active())
          setProfileStatus(
            error instanceof CustomerAccountError && error.status === 403
              ? 'forbidden'
              : 'unavailable',
          );
      });
    return () => abort.abort();
  }, [store, owner, revision, profileAttempt]);
  const name =
    profile?.displayName.trim() || session.user.displayName.trim() || session.user.userName;
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => Array.from(part)[0])
    .join('');
  const orders = overview.orders.status === 'ready' ? overview.orders.data : null;
  const openOrder = now
    ? orders?.items.find(
        (order) => order.state === 'AwaitingPayment' && Date.parse(order.expiresAt) > now,
      )
    : undefined;
  const addresses = overview.addresses.status === 'ready' ? overview.addresses.data : null;
  const unread = overview.notifications.status === 'ready' ? overview.notifications.data : null;
  const defaultAddress = addresses?.items.find((address) => address.isDefault);
  const wishlistReady = wishlistStatus?.ready && wishlistStatus.account && !wishlistStatus.failed;
  const retry = () => setAttempt((value) => value + 1);
  const loading = Object.values(overview).some((section) => section.status === 'loading');
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', { dateStyle: 'medium' }).format(
      new Date(value),
    );
  const navigation = [
    { href: '/orders', icon: Package, title: text('سفارش‌های من', 'My orders') },
    { href: '/addresses', icon: MapPin, title: text('نشانی‌های من', 'My addresses') },
    { href: '/wishlist', icon: Heart, title: text('علاقه‌مندی‌ها', 'Wishlist') },
    { href: '/notifications', icon: Bell, title: text('اعلان‌ها و پیام‌ها', 'Notifications') },
    { href: '/credit', icon: CreditCard, title: text('سوابق خرید چکی', 'Cheque history') },
    {
      href: '/support/tickets',
      icon: CircleHelp,
      title: text('درخواست‌های پشتیبانی', 'Support requests'),
    },
  ];
  const goSettings = () => {
    setView('settings');
    document.getElementById(id + '-settings-tab')?.focus({ preventScroll: true });
  };
  return (
    <div className="customer-account-workspace">
      <aside className="customer-account-sidebar">
        <div className="customer-account-identity">
          <span className="customer-account-avatar" aria-hidden="true">
            {initials || <UserRound />}
          </span>
          <div>
            <strong>{name}</strong>
            <bdi className="customer-account-username">
              {profile?.userName ?? session.user.userName}
            </bdi>
            <span className="customer-account-session">
              <span />
              {text('حساب شخصی شما', 'Your personal account')}
            </span>
          </div>
        </div>
        <div
          className="customer-account-tabs"
          role="tablist"
          aria-orientation="horizontal"
          tabIndex={-1}
          aria-label={text('نمای حساب', 'Account view')}
          onKeyDown={groupNavigation}
        >
          {(
            [
              { key: 'overview', icon: LayoutDashboard, label: text('نمای کلی', 'Overview') },
              {
                key: 'settings',
                icon: Settings2,
                label: text('اطلاعات و امنیت', 'Profile & security'),
              },
            ] as const
          ).map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              id={id + '-' + key + '-tab'}
              type="button"
              role="tab"
              aria-selected={view === key}
              aria-controls={id + '-' + key + '-panel'}
              tabIndex={view === key ? 0 : -1}
              onClick={() => setView(key)}
            >
              <Icon size={19} />
              {label}
            </button>
          ))}
        </div>
        <nav
          className="customer-account-navigation"
          aria-label={text('بخش‌های حساب کاربری', 'Account sections')}
        >
          {navigation.map(({ href, icon: Icon, title }) => (
            <Link key={href} href={href}>
              <Icon size={18} />
              <span>{title}</span>
              <ChevronLeft size={15} className="customer-account-direction" />
            </Link>
          ))}
        </nav>
        <button
          className="customer-account-logout"
          type="button"
          disabled={busy}
          onClick={() => void onLogout()}
        >
          <LogOut size={18} />
          {busy ? text('در حال خروج…', 'Signing out…') : text('خروج از حساب', 'Sign out')}
        </button>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
      </aside>
      <div className="customer-account-content">
        <section
          role="tabpanel"
          id={id + '-overview-panel'}
          aria-labelledby={id + '-overview-tab'}
          hidden={view !== 'overview'}
        >
          <header className="customer-account-greeting">
            <div>
              <span className="eyebrow">{text('سایمانِ شما', 'Your Sayman')}</span>
              <h2>
                {text('خوش آمدید،', 'Welcome,')} {name}
              </h2>
              <p>
                {text(
                  'خریدها، پیام‌ها و اطلاعات شخصی‌تان را از اینجا دنبال کنید.',
                  'Keep up with your orders, messages and personal details.',
                )}
              </p>
            </div>
            <button
              className="customer-account-refresh"
              type="button"
              aria-label={text('تازه‌سازی اطلاعات حساب', 'Refresh account information')}
              disabled={loading}
              onClick={retry}
            >
              <RefreshCw size={17} />
              <span>
                {loading ? text('در حال دریافت…', 'Loading…') : text('تازه‌سازی', 'Refresh')}
              </span>
            </button>
          </header>
          {openOrder && (
            <section className="customer-account-resume" aria-labelledby={id + '-resume'}>
              <span className="customer-account-order-symbol">
                <Clock3 size={21} aria-hidden="true" />
              </span>
              <div>
                <h3 id={id + '-resume'}>
                  {text('سفارش در انتظار پرداخت', 'Order awaiting payment')}
                </h3>
                <p>
                  <bdi>{openOrder.reference}</bdi> · {text('مهلت رزرو تا', 'Reserved until')}{' '}
                  <time dateTime={openOrder.expiresAt}>
                    {new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: 'Asia/Tehran',
                    }).format(new Date(openOrder.expiresAt))}
                  </time>
                </p>
              </div>
              <Button asChild>
                <Link href={'/orders/' + openOrder.id}>{text('پیگیری سفارش', 'View order')}</Link>
              </Button>
            </section>
          )}
          <div className="customer-account-stats">
            <AccountStat
              icon={<Package />}
              title={text('سفارش‌های اخیر', 'Recent orders')}
              href="/orders"
              value={orders ? digits(orders.items.length) + (orders.nextCursor ? '+' : '') : null}
              status={overview.orders.status}
              note={
                orders?.nextCursor
                  ? text('همهٔ سفارش‌ها را ببینید', 'View your full order list')
                  : text('سفارش‌های ثبت‌شده', 'Placed orders')
              }
              retry={retry}
            />
            <AccountStat
              icon={<Bell />}
              title={text('اعلان خوانده‌نشده', 'Unread notifications')}
              href="/notifications"
              value={unread ? digits(unread.total) : null}
              status={overview.notifications.status}
              note={text('پیام‌ها و یادآوری‌های شما', 'Your messages and reminders')}
              retry={retry}
            />
            <AccountStat
              icon={<Heart />}
              title={text('علاقه‌مندی‌ها', 'Wishlist')}
              href="/wishlist"
              value={wishlistReady ? digits(wishlist.length) : null}
              status={wishlistReady ? 'ready' : wishlistStatus?.failed ? 'unavailable' : 'loading'}
              note={text('ذخیره‌شده در حساب شما', 'Saved to your account')}
              retry={wishlistStatus?.retry ?? retry}
            />
            <AccountStat
              icon={<MapPin />}
              title={text('نشانی‌های ذخیره‌شده', 'Saved addresses')}
              href="/addresses"
              value={addresses ? digits(addresses.items.length) : null}
              status={overview.addresses.status}
              note={text('برای دریافت سفارش‌ها', 'For your deliveries')}
              retry={retry}
            />
          </div>
          <section
            className="customer-account-card customer-account-orders"
            aria-labelledby={id + '-orders'}
          >
            <div className="customer-account-section-heading">
              <div>
                <span className="customer-account-kicker">
                  {text('پیگیری خرید', 'Order tracking')}
                </span>
                <h3 id={id + '-orders'}>{text('آخرین سفارش‌های شما', 'Your latest orders')}</h3>
              </div>
              <Link href="/orders" className="customer-account-text-link">
                {text('همهٔ سفارش‌ها', 'All orders')}
                <ChevronLeft size={16} className="customer-account-direction" />
              </Link>
            </div>
            {overview.orders.status === 'loading' ? (
              <LoadingLines label={text('در حال دریافت سفارش‌ها…', 'Loading your orders…')} />
            ) : !orders ? (
              <AccountIssue retry={retry}>
                {text('فهرست سفارش‌ها بارگیری نشد.', 'Your orders could not be loaded.')}
              </AccountIssue>
            ) : orders.items.length === 0 ? (
              <div className="customer-account-empty">
                <span className="customer-account-empty-icon">
                  <Package size={28} />
                </span>
                <h4>{text('اولین انتخاب شما در راه است', 'Your first order starts here')}</h4>
                <p>
                  {text(
                    'بعد از ثبت سفارش، وضعیت و جزئیات آن را اینجا می‌بینید.',
                    'Once you place an order, its status and details will appear here.',
                  )}
                </p>
                <Link href="/catalog" className="customer-account-text-link">
                  {text('دیدن محصولات', 'Browse products')}
                  <ArrowUpLeft size={16} className="customer-account-direction" />
                </Link>
              </div>
            ) : (
              <div className="customer-account-order-list">
                {orders.items.slice(0, 3).map((order) => {
                  const state =
                    order.state === 'AwaitingPayment' &&
                    Date.parse(order.expiresAt) <= (now || Date.now())
                      ? 'Expired'
                      : order.state;
                  return (
                    <Link
                      key={order.id}
                      href={'/orders/' + order.id}
                      className="customer-account-order-row"
                    >
                      <span className="customer-account-order-symbol">
                        <Package size={21} />
                      </span>
                      <div className="customer-account-order-primary">
                        <strong>
                          <bdi>{order.reference}</bdi>
                        </strong>
                        <span>
                          <time dateTime={order.createdAt}>{date(order.createdAt)}</time>
                          <span aria-hidden="true"> · </span>
                          {digits(order.itemCount)} {text('کالا', 'items')}
                        </span>
                      </div>
                      <span className="customer-account-order-state" data-state={state}>
                        {orderStates[state][locale === 'fa' ? 0 : 1]}
                      </span>
                      <strong className="customer-account-order-amount">
                        {toman(BigInt(order.payableTotalRial))} <small>{t('تومان')}</small>
                      </strong>
                      <ChevronLeft size={18} className="customer-account-direction" />
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
          <div className="customer-account-detail-grid">
            <section className="customer-account-card" aria-labelledby={id + '-address'}>
              <div className="customer-account-section-heading">
                <div>
                  <span className="customer-account-kicker">
                    {text('آمادهٔ ارسال', 'Delivery details')}
                  </span>
                  <h3 id={id + '-address'}>{text('نشانی پیش‌فرض', 'Default address')}</h3>
                </div>
                <MapPin size={22} />
              </div>
              {overview.addresses.status === 'loading' ? (
                <LoadingLines label={text('در حال دریافت نشانی…', 'Loading your address…')} />
              ) : !addresses ? (
                <AccountIssue retry={retry}>
                  {text('نشانی‌ها بارگیری نشدند.', 'Your addresses could not be loaded.')}
                </AccountIssue>
              ) : defaultAddress ? (
                <div className="customer-account-default-address">
                  <strong>{defaultAddress.label}</strong>
                  <p>
                    {defaultAddress.delivery.province}، {defaultAddress.delivery.city}
                  </p>
                  <p className="customer-account-address-detail">
                    {defaultAddress.delivery.address}
                  </p>
                  <Link className="customer-account-text-link" href="/addresses">
                    {text('ویرایش و مدیریت نشانی‌ها', 'Edit and manage addresses')}
                    <ChevronLeft size={16} className="customer-account-direction" />
                  </Link>
                </div>
              ) : (
                <div className="customer-account-empty-inline">
                  <p>
                    {text(
                      'با ذخیرهٔ نشانی، هنگام خرید سریع‌تر ادامه دهید.',
                      'Save an address for a quicker checkout.',
                    )}
                  </p>
                  <Button asChild variant="outline">
                    <Link href="/addresses">{text('افزودن نشانی', 'Add an address')}</Link>
                  </Button>
                </div>
              )}
            </section>
            <section className="customer-account-card" aria-labelledby={id + '-messages'}>
              <div className="customer-account-section-heading">
                <div>
                  <span className="customer-account-kicker">
                    {text('چیزی را از دست ندهید', 'Stay up to date')}
                  </span>
                  <h3 id={id + '-messages'}>
                    {text('پیام‌ها و یادآوری‌ها', 'Messages & reminders')}
                  </h3>
                </div>
                <Bell size={22} />
              </div>
              {overview.notifications.status === 'loading' ? (
                <LoadingLines label={text('در حال بررسی پیام‌ها…', 'Checking your messages…')} />
              ) : !unread ? (
                <AccountIssue retry={retry}>
                  {text('شمار پیام‌ها در دسترس نیست.', 'Unread counts are unavailable.')}
                </AccountIssue>
              ) : (
                <ul className="customer-account-message-list">
                  {[
                    {
                      icon: CircleHelp,
                      label: text('پیام‌های پشتیبانی', 'Support messages'),
                      count: unread.support,
                    },
                    {
                      icon: CreditCard,
                      label: text('یادآوری‌های چک', 'Cheque reminders'),
                      count: unread.creditReminders,
                    },
                  ].map(({ icon: Icon, label, count }) => (
                    <li key={label}>
                      <Link href="/notifications">
                        <Icon size={18} />
                        <span>{label}</span>
                        <strong>{digits(count)}</strong>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          <section className="customer-account-profile-strip">
            <span className="customer-account-profile-symbol">
              <ShieldCheck size={27} />
            </span>
            <div>
              <h3>{text('اطلاعات و امنیت حساب', 'Your profile & security')}</h3>
              <p>
                {profileStatus === 'ready' && profile
                  ? text('عضو سایمان از ', 'Member since ') + date(profile.createdAt)
                  : text(
                      'نام نمایشی، اطلاعات تماس و رمز عبورتان را مدیریت کنید.',
                      'Manage your display name, contact details and password.',
                    )}
              </p>
            </div>
            <Button variant="outline" onClick={goSettings}>
              {text('تنظیمات حساب', 'Account settings')}
              <Settings2 size={17} />
            </Button>
          </section>
        </section>
        <section
          role="tabpanel"
          id={id + '-settings-panel'}
          aria-labelledby={id + '-settings-tab'}
          hidden={view !== 'settings'}
        >
          {view === 'settings' &&
            (profileStatus === 'loading' ? (
              <div className="customer-account-card">
                <LoadingLines
                  label={text('در حال دریافت اطلاعات حساب…', 'Loading your profile…')}
                />
              </div>
            ) : profileStatus === 'forbidden' ? (
              <div className="customer-account-card">
                <AccountIssue
                  retry={() => void onLogout()}
                  actionLabel={text('خروج از این نشست', 'Sign out of this session')}
                >
                  {text(
                    'این نشست به تنظیمات حساب مشتری دسترسی ندارد. از حساب خارج شوید و با حساب مشتری وارد شوید.',
                    'This session cannot access customer settings. Sign out and use a customer account.',
                  )}
                </AccountIssue>
              </div>
            ) : profileStatus !== 'ready' || !profile ? (
              <div className="customer-account-card">
                <AccountIssue retry={() => setProfileAttempt((value) => value + 1)}>
                  {text(
                    'اطلاعات حساب بارگیری نشد. بخش‌های دیگر حساب همچنان در دسترس‌اند.',
                    'Your profile could not be loaded. Other account sections remain available.',
                  )}
                </AccountIssue>
              </div>
            ) : (
              <AccountSettings
                profile={profile}
                onProfileChanged={(value) => {
                  if (
                    store.snapshot().session?.user.id === owner &&
                    store.viewRevision() === revision
                  )
                    setProfile(value);
                }}
                onPasswordChanged={onPasswordChanged}
              />
            ))}
        </section>
      </div>
    </div>
  );
}

function AccountStat({
  icon,
  title,
  href,
  value,
  status,
  note,
  retry,
}: {
  icon: ReactNode;
  title: string;
  href: string;
  value: string | null;
  status: 'loading' | 'ready' | 'unavailable';
  note: string;
  retry: () => void;
}) {
  const { locale } = useI18n();
  return (
    <article className="customer-account-stat">
      <Link href={href}>
        <span className="customer-account-stat-icon">{icon}</span>
        <span className="customer-account-stat-title">{title}</span>
        <strong aria-busy={status === 'loading'}>{value ?? '—'}</strong>
        <span className="customer-account-stat-note">
          {status === 'loading'
            ? locale === 'fa'
              ? 'در حال دریافت…'
              : 'Loading…'
            : status === 'unavailable'
              ? locale === 'fa'
                ? 'در دسترس نیست'
                : 'Unavailable'
              : note}
        </span>
      </Link>
      {status === 'unavailable' && (
        <button type="button" onClick={retry}>
          {locale === 'fa' ? 'تلاش دوباره' : 'Retry'}
          <RefreshCw size={13} />
        </button>
      )}
    </article>
  );
}
function AccountIssue({
  children,
  retry,
  actionLabel,
}: {
  children: ReactNode;
  retry: () => void;
  actionLabel?: string;
}) {
  const { locale } = useI18n();
  return (
    <div className="customer-account-issue" role="status">
      <p>{children}</p>
      <Button variant="outline" onClick={retry}>
        <RefreshCw size={15} />
        {actionLabel ?? (locale === 'fa' ? 'تلاش دوباره' : 'Retry')}
      </Button>
    </div>
  );
}
function LoadingLines({ label }: { label: string }) {
  return (
    <div className="customer-account-loading" role="status">
      <span className="sr-only">{label}</span>
      <i />
      <i />
      <i />
    </div>
  );
}
