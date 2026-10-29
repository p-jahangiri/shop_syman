import { AdminTable } from './admin-table';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UserRound } from 'lucide-react';
import { api } from './api';
import { Busy, ErrorBox, Field, Modal } from './ui';
import { AdminFilterForm } from './admin-filters';
import {
  customerFiltersSchema,
  emptyCustomerFilters,
  customerListPath,
  readCustomerPage,
  type CustomerFilters,
} from './customers-contract';
import { CustomerProfile } from './customer-profile';
import { CustomerPager, date, count } from './customer-ui';
export function CustomersPage({ viewerId }: { viewerId: string }) {
  const [draft, setDraft] = useState<CustomerFilters>(emptyCustomerFilters);
  const [filters, setFilters] = useState<CustomerFilters>(emptyCustomerFilters);
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<unknown>();
  const [selected, setSelected] = useState<string | null>(null);
  const page = pages.at(-1)!;
  const list = useQuery({
    queryKey: ['admin', 'customers', viewerId, filters, page, revision],
    queryFn: async ({ signal }) =>
      readCustomerPage(await api<unknown>(customerListPath(filters, page), { signal }), filters),
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
  function refresh() {
    setPages([null]);
    setRevision((value) => value + 1);
  }
  return (
    <section className="panel customers-page">
      <div className="section-heading">
        <div>
          <h2>مشتریان فروشگاه</h2>
          <p>پروندهٔ ارتباط با مشتری؛ خریدها، تیکت‌ها و اطلاعات حساب در یک جا.</p>
        </div>
        <button onClick={refresh} disabled={list.isFetching}>
          تازه‌سازی مشتریان
        </button>
      </div>
      <AdminFilterForm
        label="فیلتر مشتریان"
        onSubmit={(event) => {
          event.preventDefault();
          const result = customerFiltersSchema.safeParse(draft);
          if (!result.success) {
            setError(new Error('جست‌وجو حداکثر ۱۲۰ نویسه و ۸ واژه است.'));
            return;
          }
          setError(undefined);
          setFilters(result.data);
          refresh();
        }}
        search={
          <Field label="نام یا نام کاربری مشتری">
            <input
              maxLength={120}
              value={draft.query}
              onChange={(event) => setDraft({ ...draft, query: event.target.value })}
            />
          </Field>
        }
        actions={
          <>
            <button className="primary">جست‌وجوی مشتریان</button>
            <button
              type="button"
              onClick={() => {
                setDraft(emptyCustomerFilters);
                setFilters(emptyCustomerFilters);
                setError(undefined);
                refresh();
              }}
            >
              پاک‌کردن فیلترها
            </button>
          </>
        }
        applied={[
          filters.query ? 'جست‌وجو: ' + filters.query : '',
          filters.kind === 'all' ? '' : filters.kind === 'staff' ? 'حساب همکاران' : 'حساب مشتریان',
          filters.active === 'all' ? '' : filters.active === 'true' ? 'فعال' : 'غیرفعال',
        ].filter(Boolean)}
      >
        <Field label="وضعیت حساب">
          <select
            value={draft.active}
            onChange={(event) =>
              setDraft({ ...draft, active: event.target.value as CustomerFilters['active'] })
            }
          >
            <option value="all">همهٔ وضعیت‌ها</option>
            <option value="true">فعال</option>
            <option value="false">غیرفعال</option>
          </select>
        </Field>
        <Field label="نوع حساب">
          <select
            value={draft.kind}
            onChange={(event) =>
              setDraft({ ...draft, kind: event.target.value as CustomerFilters['kind'] })
            }
          >
            <option value="customer">مشتریان</option>
            <option value="staff">همکاران با سابقهٔ فروشگاهی</option>
            <option value="all">همهٔ حساب‌ها</option>
          </select>
        </Field>
      </AdminFilterForm>
      <ErrorBox error={error ?? list.error} />
      {list.isPending ? (
        <Busy />
      ) : list.error ? (
        <button onClick={() => void list.refetch()}>دریافت دوبارهٔ مشتریان</button>
      ) : (
        list.data && (
          <>
            <p className="muted" role="status">
              {list.data.items.length.toLocaleString('fa-IR')} حساب در این صفحه؛ آمار خرید و تیکت
              مربوط به کل سابقهٔ هر حساب است.
            </p>
            <div
              className="table-wrap"
              role="region"
              aria-label="فهرست مشتریان فروشگاه"
              tabIndex={0}
            >
              <AdminTable searchable={false}>
                <thead>
                  <tr>
                    <th>مشتری</th>
                    <th>وضعیت حساب</th>
                    <th>خرید و سفارش</th>
                    <th>پشتیبانی</th>
                    <th>عضویت</th>
                    <th>پرونده</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map(({ account, orders, support }) => (
                    <tr key={account.id}>
                      <td>
                        <div className="staff-identity">
                          <span className="staff-avatar" aria-hidden="true">
                            {Array.from(account.displayName || account.userName)[0] || (
                              <UserRound size={18} />
                            )}
                          </span>
                          <div>
                            <strong>{account.displayName || account.userName}</strong>
                            <small>
                              <bdi>{account.userName}</bdi>
                              {account.isStaff ? ' · همکار' : ''}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`staff-state ${account.isActive ? 'is-active' : ''}`}>
                          {account.isActive ? 'فعال' : 'غیرفعال'}
                        </span>
                        <small className="customer-contact-state">
                          {account.phoneVerified
                            ? 'موبایل تأییدشده'
                            : account.emailVerified
                              ? 'ایمیل تأییدشده'
                              : 'تماس تأییدنشده'}
                        </small>
                      </td>
                      <td>
                        {orders ? (
                          <>
                            <strong>{count(orders.confirmedPurchases)} خرید قطعی</strong>
                            <small className="customer-contact-state">
                              {count(orders.totalOrders)} سفارش ثبت‌شده
                              {orders.demoOrders !== '0'
                                ? ` · ${count(orders.demoOrders)} نمونهٔ توسعه`
                                : ''}
                            </small>
                          </>
                        ) : (
                          <span className="muted">مجوز مشاهده ندارید</span>
                        )}
                      </td>
                      <td>
                        {support ? (
                          <>
                            <strong>{count(support.totalTickets)} تیکت</strong>
                            <small className="customer-contact-state">
                              {count(support.openTickets)} پروندهٔ باز
                            </small>
                          </>
                        ) : (
                          <span className="muted">مجوز مشاهده ندارید</span>
                        )}
                      </td>
                      <td data-sort-value={account.createdAt}>{date(account.createdAt)}</td>
                      <td>
                        <button onClick={() => setSelected(account.id)}>مشاهدهٔ پرونده</button>
                      </td>
                    </tr>
                  ))}
                  {!list.data.items.length && (
                    <tr>
                      <td colSpan={6}>
                        <div className="admin-empty-state">
                          <UserRound size={28} />
                          <strong>حسابی با این شرایط پیدا نشد</strong>
                          <p>فیلترها را پاک کنید یا نوع حساب را تغییر دهید.</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </AdminTable>
            </div>
            <CustomerPager
              pages={pages}
              next={list.data.nextCursor}
              busy={list.isFetching}
              onChange={setPages}
            />
          </>
        )
      )}
      {selected && (
        <Modal title="پروندهٔ مشتری" onClose={() => setSelected(null)}>
          <CustomerProfile key={viewerId + ':' + selected} id={selected} viewerId={viewerId} />
        </Modal>
      )}
    </section>
  );
}
