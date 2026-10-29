import { AdminTable } from './admin-table';
import { AdminFilterForm } from './admin-filters';
import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from './api';
import { adminViewRevision } from './admin-view-authority';
import { Busy, ErrorBox, Field } from './ui';
import {
  paymentFilterSchema,
  readPaymentPage,
  type PaymentFilter,
  type PaymentPage,
} from '../../storefront/lib/payment-contract';
const names = {
  created: 'ثبت درخواست',
  initiating: 'آغاز نامشخص / در حال بررسی',
  pending: 'منتظر تأیید درگاه',
  verified: 'پرداخت تأییدشده',
  review: 'نیازمند تطبیق مالی',
  failed: 'ناموفق',
  cancelled: 'لغوشده',
} as const;
export function PaymentsPage({ viewerId }: { viewerId: string }) {
  const [draft, setDraft] = useState({ state: '', orderId: '' }),
    [filter, setFilter] = useState<PaymentFilter>({ state: null, orderId: null }),
    [error, setError] = useState<unknown>();
  const query = useInfiniteQuery({
    queryKey: ['admin', 'payments', viewerId, filter],
    initialPageParam: null as string | null,
    getNextPageParam: (last: PaymentPage) => last.nextCursor ?? undefined,
    queryFn: async ({ pageParam, signal }): Promise<PaymentPage> => {
      const revision = adminViewRevision(),
        params = new URLSearchParams();
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
  const items = query.data?.pages.flatMap((p) => p.items) ?? [],
    amount = (x: string) => BigInt(x).toLocaleString('fa-IR') + ' ریال',
    date = (x: string) =>
      new Intl.DateTimeFormat('fa-IR', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Tehran',
      }).format(new Date(x));
  return (
    <>
      <section className="panel">
        <h2>پیگیری پرداخت و تطبیق مالی</h2>
        <p>
          ثبت درخواست یا بازگشت مرورگر، تأیید پرداخت نیست. فقط تأیید معتبر سرور می‌تواند سفارش و
          تخصیص انبار را قطعی کند. این صفحه وضعیت ثبت‌شده را نشان می‌دهد.
        </p>
        <p className="notice">
          اتصال درگاه واقعی هنوز پیکربندی و پذیرفته نشده است. ثبت درخواست پرداخت، به‌تنهایی سفارش را
          قطعی نمی‌کند.
        </p>
        <AdminFilterForm
          onSubmit={(e) => {
            e.preventDefault();
            try {
              const value = paymentFilterSchema.parse({
                state: draft.state || null,
                orderId: draft.orderId.trim() || null,
              });
              setFilter(value);
              setError(null);
            } catch {
              setError(Error('وضعیت معتبر و شناسهٔ کامل ۳۲حرفی سفارش را وارد کنید.'));
            }
          }}

          label="فیلتر سوابق پرداخت"
          search={
            <Field label="شناسهٔ سفارش (اختیاری)">
              <input
                dir="ltr"
                maxLength={32}
                value={draft.orderId}
                onChange={(e) => setDraft({ ...draft, orderId: e.target.value })}
              />
            </Field>
          }
          actions={
            <div className="row-buttons">
              <button className="primary" type="submit">
                اعمال فیلتر
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft({ state: '', orderId: '' });
                  setFilter({ state: null, orderId: null });
                  setError(undefined);
                }}
              >
                پاک‌کردن فیلترها
              </button>
              <button
                type="button"
                disabled={query.isFetching}
                onClick={() => void query.refetch()}
              >
                بازخوانی سوابق
              </button>
            </div>
          }
          applied={[
            filter.orderId ? 'سفارش: ' + filter.orderId : '',
            filter.state ? names[filter.state] : '',
          ].filter(Boolean)}
        >
          <Field label="وضعیت پرداخت">
            <select
              value={draft.state}
              onChange={(e) => setDraft({ ...draft, state: e.target.value })}
            >
              <option value="">همهٔ وضعیت‌ها</option>
              {Object.entries(names).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </AdminFilterForm>
        <ErrorBox error={error} />
      </section>
      <section className="panel payment-history">
        <h2>تلاش‌های ثبت‌شدهٔ پرداخت</h2>
        <p>
          هر صفحه حداکثر۵۰ردیف، جدیدترین ابتدا؛ زمان‌ها به وقت تهران و مبالغ به ریال‌اند. شناسهٔ
          محرمانهٔ درگاه و اطلاعات اتصال نمایش داده نمی‌شوند.
        </p>
        <ErrorBox error={query.error} />
        {query.isPending ? (
          <Busy />
        ) : (
          <>
            <div className="table-wrap" role="region" aria-label="سوابق خصوصی پرداخت">
              <AdminTable>
                <thead>
                  <tr>
                    <th>تلاش / سفارش</th>
                    <th>وضعیت</th>
                    <th>مبلغ سفارش</th>
                    <th>مبلغ تأیید درگاه</th>
                    <th>زمان / نتیجهٔ تطبیق</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <code dir="ltr">{item.id}</code>
                        <small>
                          سفارش: <code dir="ltr">{item.orderId}</code>
                        </small>
                        {item.containsDemo && <small>نمونهٔ توسعه؛ تراکنش واقعی نیست</small>}
                      </td>
                      <td>{names[item.state]}</td>
                      <td data-sort-value={item.amountRial}>{amount(item.amountRial)}</td>
                      <td>
                        {item.verifiedAmountRial === null
                          ? 'هنوز تأیید نشده'
                          : amount(item.verifiedAmountRial)}
                      </td>
                      <td data-sort-value={item.createdAt}>
                        {date(item.createdAt)}
                        {item.verifiedAt && <small>تأیید: {date(item.verifiedAt)}</small>}
                        {item.state === 'review' && (
                          <small>نیازمند بررسی؛ سفارش با این نتیجه پرداخت‌شده فرض نشود.</small>
                        )}
                        {item.verificationReason && (
                          <small>
                            <code dir="ltr">{item.verificationReason}</code>
                          </small>
                        )}
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={5} className="empty">
                        هنوز تلاش پرداختی در این فیلتر ثبت نشده است.
                      </td>
                    </tr>
                  )}
                </tbody>
              </AdminTable>
            </div>
            {query.hasNextPage && (
              <button
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {query.isFetchingNextPage ? 'در حال دریافت…' : '۵۰ردیف بعدی'}
              </button>
            )}
          </>
        )}
      </section>
    </>
  );
}
