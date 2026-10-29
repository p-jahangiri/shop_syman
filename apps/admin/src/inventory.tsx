import { AdminTable } from './admin-table';
import { AdminFilterForm } from './admin-filters';
import { lazy, Suspense, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, save } from './api';
import { Busy, ErrorBox, Field, Modal } from './ui';
import { Area, FormActions, Text } from './forms';
import { InventoryHistory } from './inventory-history';
import {
  emptyInventoryFilters,
  inventoryFiltersSchema,
  inventoryPath,
  inventoryDetailPath,
  inventoryRowSchema,
  readInventoryPage,
  stockAdjustment,
  type InventoryFilters,
  type InventoryRow,
} from './inventory-contract';
const statusNames = { Draft: 'پیش‌نویس', Published: 'منتشرشده', Hidden: 'پنهان' };
const SerialInventoryPanel = lazy(() =>
  import('./serial-inventory').then((m) => ({ default: m.SerialInventoryPanel })),
);
export function InventoryPage({ writable }: { writable: boolean }) {
  const [draft, setDraft] = useState<InventoryFilters>(emptyInventoryFilters);
  const [filters, setFilters] = useState<InventoryFilters>(emptyInventoryFilters);
  const [error, setError] = useState<unknown>();
  const [generation, setGeneration] = useState(0);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors.at(-1)!;
  const [selected, setSelected] = useState<InventoryRow | null>(null);
  const [history, setHistory] = useState<{ id: string | null; key: number }>({ id: null, key: 0 });
  const [serial, setSerial] = useState<InventoryRow | null>(null);
  const [serialPending, setSerialPending] = useState(false);
  const query = useQuery({
    queryKey: ['admin', 'stock-page', 2, generation, filters, cursor],
    queryFn: async ({ signal }) =>
      readInventoryPage(await api<unknown>(inventoryPath(filters, cursor), { signal }), filters),
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
  function apply(e: React.FormEvent) {
    e.preventDefault();
    const parsed = inventoryFiltersSchema.safeParse(draft);
    if (!parsed.success) {
      setError(new Error('جست‌وجو حداکثر ۱۲۰ نویسه و ۸ واژه است.'));
      return;
    }
    setError(undefined);
    setFilters(parsed.data);
    setCursors([null]);
    setGeneration((v) => v + 1);
  }
  return (
    <>
      <section className="panel inventory-page">
        <div className="section-heading">
          <div>
            <h2>موجودی تنوع‌ها</h2>
            <p>
              موجودی فیزیکی، رزرو سفارش، رزرو تأمین و ماندهٔ آزاد هر تنوع؛ شامل تنوع‌های بدون سابقهٔ
              انبار.
            </p>
          </div>
          <button
            disabled={query.isFetching}
            onClick={() => {
              setCursors([null]);
              setGeneration((v) => v + 1);
            }}
          >
            دریافت موجودی تازه
          </button>
        </div>
        <AdminFilterForm
          label="فیلتر موجودی"
          onSubmit={apply}
          search={
            <Field label="نام کالا یا SKU">
              <input
                value={draft.query}
                onChange={(e) => setDraft({ ...draft, query: e.target.value })}
                maxLength={120}
              />
            </Field>
          }
          actions={
            <>
              <button className="primary" type="submit">
                جست‌وجوی موجودی
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(emptyInventoryFilters);
                  setFilters(emptyInventoryFilters);
                  setCursors([null]);
                  setGeneration((v) => v + 1);
                  setError(undefined);
                }}
              >
                پاک‌کردن جست‌وجو
              </button>
            </>
          }
          applied={[
            filters.query ? 'جست‌وجو: ' + filters.query : null,
            filters.active === 'all'
              ? null
              : filters.active === 'true'
                ? 'تنوع فعال'
                : 'تنوع غیرفعال',
          ].filter((value): value is string => value !== null)}
        >
          <Field label="فعال‌بودن تنوع">
            <select
              value={draft.active}
              onChange={(e) =>
                setDraft({ ...draft, active: e.target.value as InventoryFilters['active'] })
              }
            >
              <option value="all">همهٔ تنوع‌ها</option>
              <option value="true">فعال</option>
              <option value="false">غیرفعال</option>
            </select>
          </Field>
        </AdminFilterForm>
        <ErrorBox error={error ?? query.error} />
        {query.isPending ? (
          <Busy />
        ) : query.error ? (
          <div className="row-buttons">
            <button onClick={() => void query.refetch()}>تلاش دوباره برای موجودی</button>
            {cursors.length > 1 && (
              <button onClick={() => setCursors((v) => v.slice(0, -1))}>صفحهٔ قبلی موجودی</button>
            )}
          </div>
        ) : (
          query.data && (
            <>
              <p className="muted" role="status">
                {query.data.items.length.toLocaleString('fa-IR')} تنوع در این صفحه؛ ترتیب شناسه
              </p>
              <div
                className="table-wrap"
                tabIndex={0}
                role="region"
                aria-label="جدول موجودی، قابل پیمایش افقی"
              >
                <AdminTable searchable={false}>
                  <thead>
                    <tr>
                      <th>کالا / SKU</th>
                      <th>وضعیت</th>
                      <th>فیزیکی</th>
                      <th>رزرو سفارش</th>
                      <th>رزرو تأمین</th>
                      <th>ماندهٔ آزاد</th>
                      <th>عملیات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.items.map((row) => (
                      <tr key={row.variantId}>
                        <td>
                          <strong>{row.nameFa || row.nameEn || row.sku}</strong>
                          <small>
                            <bdi>{row.sku}</bdi>
                          </small>
                          <small>
                            <bdi>{row.variantId}</bdi>
                          </small>
                        </td>
                        <td>
                          {row.isActive ? 'فعال' : 'غیرفعال'}
                          <small>{statusNames[row.productStatus]}</small>
                        </td>
                        <td>
                          {row.onHand.toLocaleString('fa-IR')}
                          {row.version === null && <small>بدون سابقهٔ انبار</small>}
                        </td>
                        <td>{row.reserved.toLocaleString('fa-IR')}</td>
                        <td>{row.sourcingReserved.toLocaleString('fa-IR')}</td>
                        <td>{row.available.toLocaleString('fa-IR')}</td>
                        <td>
                          <div className="row-buttons">
                            <a
                              href="#inventory-movements"
                              onClick={() =>
                                setHistory((old) => ({ id: row.variantId, key: old.key + 1 }))
                              }
                            >
                              گردش
                            </a>
                            <button
                              onClick={() => {
                                setSerial(row);
                                setSerialPending(false);
                              }}
                            >
                              سریال / IMEI
                            </button>
                            {writable && (
                              <button className="row-action" onClick={() => setSelected(row)}>
                                اصلاح موجودی
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!query.data.items.length && (
                      <tr>
                        <td colSpan={7} className="empty">
                          تنوعی با این جست‌وجو پیدا نشد.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </AdminTable>
              </div>
              <div className="pagination">
                <button
                  disabled={cursors.length === 1 || query.isFetching}
                  onClick={() => setCursors((v) => v.slice(0, -1))}
                >
                  موجودی قبلی
                </button>
                <span>صفحهٔ {cursors.length.toLocaleString('fa-IR')}</span>
                <button
                  disabled={!query.data.nextCursor || query.isFetching}
                  onClick={() => {
                    if (query.data?.nextCursor) setCursors((v) => [...v, query.data!.nextCursor]);
                  }}
                >
                  ۵۰ تنوع بعدی
                </button>
              </div>
            </>
          )
        )}
      </section>
      <InventoryHistory key={history.key} initialVariantId={history.id} />
      {selected && writable && (
        <Modal title={`اصلاح موجودی · ${selected.sku}`} onClose={() => setSelected(null)}>
          <StockForm variantId={selected.variantId} onClose={() => setSelected(null)} />
        </Modal>
      )}
      {serial && (
        <Modal
          title={`سریال / IMEI · ${serial.sku}`}
          preventClose={serialPending}
          onClose={() => {
            setSerial(null);
            setSerialPending(false);
          }}
        >
          <Suspense fallback={<Busy />}>
            <SerialInventoryPanel
              variantId={serial.variantId}
              sku={serial.sku}
              writable={writable}
              onPendingChange={setSerialPending}
            />
          </Suspense>
        </Modal>
      )}
    </>
  );
}
function StockForm({ variantId, onClose }: { variantId: string; onClose: () => void }) {
  const client = useQueryClient();
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [requestId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<unknown>();
  const [attempt, setAttempt] = useState<ReturnType<typeof stockAdjustment> | null>(null);
  const stock = useQuery({
    queryKey: ['admin', 'stock-one', 2, variantId],
    queryFn: async ({ signal }) => {
      const row = inventoryRowSchema.parse(
        await api<unknown>(inventoryDetailPath(variantId), { signal }),
      );
      if (row.variantId.toLowerCase() !== variantId.toLowerCase())
        throw new Error('تنوع دریافت‌شده معتبر نیست.');
      return row;
    },
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: (value: ReturnType<typeof stockAdjustment>) =>
      save(`/admin/inventory/${encodeURIComponent(variantId)}/adjust`, value),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['admin'] });
      onClose();
    },
    onError: (error) => {
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 408
      )
        setAttempt(null);
    },
  });
  if (stock.isPending) return <Busy />;
  if (stock.error || !stock.data)
    return (
      <>
        <ErrorBox error={stock.error} />
        <button onClick={() => void stock.refetch()}>دریافت دوبارهٔ موجودی</button>
      </>
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (mutation.isPending) return;
        setError(undefined);
        try {
          const payload = attempt ?? stockAdjustment(delta, reason, stock.data.version, requestId);
          setAttempt(payload);
          mutation.mutate(payload);
        } catch (error) {
          setError(error);
        }
      }}
    >
      <ErrorBox error={error ?? mutation.error} />
      <p className="notice">
        موجودی فیزیکی: {stock.data.onHand.toLocaleString('fa-IR')} · رزرو سفارش:{' '}
        {stock.data.reserved.toLocaleString('fa-IR')} · رزرو تأمین:{' '}
        {stock.data.sourcingReserved.toLocaleString('fa-IR')} · آزاد:{' '}
        {stock.data.available.toLocaleString('fa-IR')}
      </p>
      {attempt && mutation.error && (
        <p className="notice">
          نتیجهٔ درخواست هنوز قطعی نیست؛ ارسال دوباره با همان شناسه و مقادیر انجام می‌شود. بستن
          پنجره یا بارگیری دوباره، شناسهٔ این تلاش را از حافظه پاک می‌کند؛ پیش از اصلاح تازه، گردش
          انبار را بررسی کنید.
        </p>
      )}
      <fieldset disabled={mutation.isPending || !!attempt}>
        <Text
          label="تعداد تغییر، مثبت یا منفی"
          value={delta}
          dir="ltr"
          onChange={setDelta}
          required
          hint="عدد صحیح غیرصفر، حداکثر یک میلیون؛ ارقام فارسی هم پذیرفته می‌شوند."
        />
        <Area label="دلیل اصلاح" value={reason} onChange={setReason} />
      </fieldset>
      <button
        type="button"
        disabled={mutation.isPending || !!attempt || stock.isFetching}
        onClick={() => void stock.refetch()}
      >
        دریافت مانده و نسخهٔ تازه
      </button>
      <FormActions pending={mutation.isPending} onClose={onClose} />
    </form>
  );
}
