import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronLeft,
  ContactRound,
  MessagesSquare,
  RefreshCw,
  Search,
  SearchX,
  ShoppingBag,
  UsersRound,
  X,
} from 'lucide-react';
import { api } from '../../api/api';
import { Busy, ErrorBox, Field, Modal } from '../../components/ui';
import {
  customerFiltersSchema,
  emptyCustomerFilters,
  customerListPath,
  readCustomerPage,
  type CustomerFilters,
} from '../../api/contracts/customers/customers-contract';
import { CustomerProfile } from '../../features/customers/customer-profile';
import { CustomerPager, count } from '../../features/customers/customer-ui';
import '../../styles/customers/customer-directory.css';

const accountScopes = [
  { value: 'customer', label: 'مشتریان' },
  { value: 'staff', label: 'همکاران' },
  { value: 'all', label: 'همهٔ حساب‌ها' },
] satisfies { value: CustomerFilters['kind']; label: string }[];

const joinDate = new Intl.DateTimeFormat('fa-IR', {
  dateStyle: 'medium',
  timeZone: 'Asia/Tehran',
});

export function CustomersPage({ viewerId }: { viewerId: string }) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<CustomerFilters['kind']>(emptyCustomerFilters.kind);
  const [active, setActive] = useState<CustomerFilters['active']>(emptyCustomerFilters.active);
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const [selected, setSelected] = useState<{
    id: string;
    section: 'overview' | 'orders' | 'tickets';
  } | null>(null);

  const filters: CustomerFilters = { query, active, kind };
  const page = pages.at(-1) ?? null;
  const normalizedSearch = search.trim();
  const validSearch = customerFiltersSchema.shape.query.safeParse(normalizedSearch).success;

  useEffect(() => {
    if (!validSearch || normalizedSearch === query) return;
    const timer = window.setTimeout(() => {
      setQuery(normalizedSearch);
      setPages([null]);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [normalizedSearch, query, validSearch]);

  const list = useQuery({
    queryKey: ['admin', 'customers', viewerId, filters, page],
    queryFn: async ({ signal }) =>
      readCustomerPage(await api<unknown>(customerListPath(filters, page), { signal }), filters),
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });

  function reset() {
    setSearch('');
    setQuery('');
    setActive(emptyCustomerFilters.active);
    setKind(emptyCustomerFilters.kind);
    setPages([null]);
  }

  const hasFilters = !!normalizedSearch || active !== 'all' || kind !== emptyCustomerFilters.kind;
  const showingPreviousSearch = !!query && !validSearch;
  const openProfile = (id: string, section: 'overview' | 'orders' | 'tickets') =>
    setSelected({ id, section });

  return (
    <section className="panel customer-directory">
      <header className="customer-directory-header">
        <div className="customer-directory-title">
          <span className="customer-directory-icon" aria-hidden="true">
            <UsersRound size={22} />
          </span>
          <div>
            <h2>مشتریان فروشگاه</h2>
            <p>حساب مشتری را پیدا کنید و خریدها و درخواست‌های پشتیبانی او را ببینید.</p>
          </div>
        </div>
        <button
          type="button"
          className="customer-directory-button"
          onClick={() => void list.refetch()}
          disabled={list.isFetching}
        >
          <RefreshCw size={16} aria-hidden="true" />
          تازه‌سازی
        </button>
      </header>

      <div className="customer-directory-controls">
        <div className="customer-directory-segments" role="group" aria-label="نوع حساب">
          {accountScopes.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={kind === value}
              onClick={() => {
                if (kind === value) return;
                setKind(value);
                setPages([null]);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <form
          className="customer-directory-filters"
          role="search"
          aria-label="جست‌وجوی مشتریان"
          onSubmit={(event) => {
            event.preventDefault();
            if (!validSearch || normalizedSearch === query) return;
            setQuery(normalizedSearch);
            setPages([null]);
          }}
        >
          <div className="customer-directory-search">
            <Field
              label="نام یا نام کاربری"
              error={!validSearch ? 'جست‌وجو می‌تواند حداکثر ۸ واژه داشته باشد.' : undefined}
            >
              <input
                type="search"
                placeholder="مثلاً مریم رضایی یا maryam"
                maxLength={120}
                autoComplete="off"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </Field>
            <Search size={17} aria-hidden="true" />
          </div>
          <Field label="وضعیت حساب">
            <select
              value={active}
              onChange={(event) => {
                const next = event.target.value as CustomerFilters['active'];
                setActive(next);
                setPages([null]);
              }}
            >
              <option value="all">همهٔ وضعیت‌ها</option>
              <option value="true">فعال</option>
              <option value="false">غیرفعال</option>
            </select>
          </Field>
        </form>
      </div>

      <div className="customer-directory-summary">
        <p role="status">
          {list.data
            ? `${list.data.items.length.toLocaleString('fa-IR')} حساب در این صفحه`
            : 'فهرست حساب‌ها'}
          {showingPreviousSearch && <> · نتایج جست‌وجوی پیشین</>}
        </p>
        {hasFilters && (
          <button type="button" className="customer-directory-clear" onClick={reset}>
            <X size={15} aria-hidden="true" />
            بازنشانی جست‌وجو و فیلترها
          </button>
        )}
      </div>

      {list.isPending ? (
        <Busy />
      ) : list.isError ? (
        <div className="customer-directory-empty">
          <ErrorBox error={list.error} />
          <button type="button" onClick={() => void list.refetch()}>
            تلاش دوباره
          </button>
        </div>
      ) : list.data.items.length ? (
        <div className="customer-directory-results">
          {/* eslint-disable jsx-a11y/no-redundant-roles, jsx-a11y/no-interactive-element-to-noninteractive-role -- Keep table semantics in the accessibility tree when mobile CSS changes the native table display roles. */}
          <table className="customer-directory-table" role="table">
            <caption className="sr-only">فهرست حساب‌های مشتریان فروشگاه</caption>
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col">
                  مشتری
                </th>
                <th role="columnheader" scope="col">
                  وضعیت حساب
                </th>
                {list.data.canReadOrders && (
                  <th role="columnheader" scope="col">
                    خرید و سفارش
                  </th>
                )}
                {list.data.canReadSupport && (
                  <th role="columnheader" scope="col">
                    پشتیبانی
                  </th>
                )}
                <th role="columnheader" scope="col">
                  عضویت
                </th>
                <th role="columnheader" scope="col">
                  پرونده
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {list.data.items.map(({ account, orders, support }) => {
                const name = account.displayName || account.userName;
                return (
                  <tr key={account.id} role="row">
                    <td role="cell" className="customer-directory-cell-identity">
                      <div className="customer-directory-identity">
                        <span className="customer-directory-avatar" aria-hidden="true">
                          {Array.from(name.trim())[0] || <ContactRound size={20} />}
                        </span>
                        <div className="customer-directory-text">
                          <strong dir="auto">{name}</strong>
                          <small>
                            <bdi>{account.userName}</bdi>
                            {account.isStaff && <span>همکار</span>}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td role="cell" className="customer-directory-cell-status">
                      <span className="customer-directory-state" data-active={account.isActive}>
                        {account.isActive ? 'فعال' : 'غیرفعال'}
                      </span>
                    </td>
                    {orders && (
                      <td role="cell" className="customer-directory-cell-orders">
                        <button
                          type="button"
                          className="customer-directory-activity"
                          aria-label={`سابقهٔ سفارش ${name}، ${count(orders.totalOrders)} سفارش`}
                          onClick={() => openProfile(account.id, 'orders')}
                        >
                          <ShoppingBag size={17} aria-hidden="true" />
                          <span>
                            <strong>{count(orders.confirmedPurchases)} خرید قطعی</strong>
                            <small>{count(orders.totalOrders)} سفارش</small>
                          </span>
                        </button>
                      </td>
                    )}
                    {support && (
                      <td role="cell" className="customer-directory-cell-tickets">
                        <button
                          type="button"
                          className="customer-directory-activity"
                          aria-label={`سوابق پشتیبانی ${name}، ${count(support.totalTickets)} تیکت`}
                          onClick={() => openProfile(account.id, 'tickets')}
                        >
                          <MessagesSquare size={17} aria-hidden="true" />
                          <span>
                            <strong>{count(support.totalTickets)} تیکت</strong>
                            <small data-open={support.openTickets !== '0'}>
                              {count(support.openTickets)} باز
                            </small>
                          </span>
                        </button>
                      </td>
                    )}
                    <td role="cell" className="customer-directory-cell-date">
                      <span aria-hidden="true">عضویت</span>
                      <time dateTime={account.createdAt}>
                        {joinDate.format(new Date(account.createdAt))}
                      </time>
                    </td>
                    <td role="cell" className="customer-directory-cell-action">
                      <button
                        type="button"
                        className="customer-directory-button"
                        aria-label={`مشاهدهٔ پروندهٔ ${name}`}
                        onClick={() => openProfile(account.id, 'overview')}
                      >
                        پرونده
                        <ChevronLeft size={16} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {/* eslint-enable jsx-a11y/no-redundant-roles, jsx-a11y/no-interactive-element-to-noninteractive-role */}
        </div>
      ) : (
        <div className="customer-directory-empty">
          <SearchX size={28} aria-hidden="true" />
          <strong>
            {page
              ? 'در این صفحه حسابی نیست'
              : hasFilters
                ? 'حسابی با این شرایط پیدا نشد'
                : 'هنوز مشتری ثبت نشده است'}
          </strong>
          <p>
            {page
              ? 'برای دیدن حساب‌ها به صفحهٔ قبلی برگردید.'
              : hasFilters
                ? 'نام دیگری جست‌وجو کنید یا فیلترها را بازنشانی کنید.'
                : 'پس از ثبت‌نام اولین مشتری، حساب او در این فهرست نمایش داده می‌شود.'}
          </p>
        </div>
      )}
      {list.data && !list.isError && (pages.length > 1 || list.data.nextCursor) && (
        <CustomerPager
          pages={pages}
          next={list.data.nextCursor}
          busy={list.isFetching}
          onChange={setPages}
        />
      )}

      {selected && (
        <Modal title="پروندهٔ مشتری" onClose={() => setSelected(null)}>
          <CustomerProfile
            key={viewerId + ':' + selected.id}
            id={selected.id}
            viewerId={viewerId}
            initialSection={selected.section}
          />
        </Modal>
      )}
    </section>
  );
}
