import { AdminTable } from './admin-table';
import { Plus, RefreshCw, Pencil, Package, Star, X } from 'lucide-react';
import { AdminFilterForm } from './admin-filters';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { Busy, ErrorBox, Field, Modal } from './ui';
import { ProductForm } from './catalog';
import { nameOf, type Catalog, type PurchaseMethod, type ChequePlan } from './types';
import {
  emptyProductFilters,
  productFiltersSchema,
  productsPath,
  readProductsPage,
  readProductDetail,
  type ProductFilters,
} from './products-contract';
const names = { Draft: 'پیش‌نویس', Published: 'منتشرشده', Hidden: 'پنهان' };
export function ProductsPage({
  data,
  methods,
  plans,
  writable,
}: {
  data: Catalog;
  methods: PurchaseMethod[];
  plans: ChequePlan[];
  writable: boolean;
}) {
  const [draft, setDraft] = useState<ProductFilters>(emptyProductFilters);
  const [filters, setFilters] = useState(emptyProductFilters);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState<unknown>();
  const [editing, setEditing] = useState<string | null | undefined>();
  const cursor = cursors.at(-1)!;
  const query = useQuery({
    queryKey: ['admin', 'products-page', generation, filters, cursor],
    queryFn: async ({ signal }) =>
      readProductsPage(await api<unknown>(productsPath(filters, cursor), { signal }), filters),
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
  function commit(value: ProductFilters) {
    const parsed = productFiltersSchema.safeParse(value);
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
    <section className="panel products-page product-workspace-v2">
      <div className="section-heading">
        <div>
          <h2>
            کالاهای فروشگاه{' '}
            {query.data && (
              <span className="product-result-badge">
                {query.data.items.length.toLocaleString('fa-IR')}
              </span>
            )}
          </h2>
          <p>مشخصات، تنوع‌ها و وضعیت نمایش کالاها را از اینجا مدیریت کنید.</p>
        </div>
        <div className="row-buttons">
          <button
            className="icon product-refresh"
            aria-label="تازه‌سازی کالاها"
            title="تازه‌سازی کالاها"
            disabled={query.isFetching}
            onClick={() => {
              setCursors([null]);
              setGeneration((v) => v + 1);
            }}
          >
            <RefreshCw size={16} aria-hidden="true" />
          </button>
          {writable && (
            <button className="primary" onClick={() => setEditing(null)}>
              <Plus size={17} aria-hidden="true" />
              کالای جدید
            </button>
          )}
        </div>
      </div>
      <div className="product-state-tabs" role="group" aria-label="وضعیت نمایش کالاها">
        {(
          [
            ['all', 'همهٔ کالاها'],
            ['Published', 'منتشرشده'],
            ['Draft', 'پیش‌نویس'],
            ['Hidden', 'پنهان'],
          ] as const
        ).map(([value, label]) => (
          <button
            type="button"
            key={value}
            aria-pressed={draft.status === value}
            onClick={() => {
              const next = { ...draft, status: value };
              setDraft(next);
              commit(next);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <AdminFilterForm
        inline
        label="فیلتر کالاها"
        onSubmit={(event) => {
          event.preventDefault();
          commit(draft);
        }}
        search={
          <Field label="نام کالا یا SKU">
            <input
              type="search"
              placeholder="جست‌وجوی نام کالا، مدل یا SKU…"
              maxLength={120}
              value={draft.query}
              onChange={(e) => setDraft({ ...draft, query: e.target.value })}
            />
          </Field>
        }
        actions={
          <>
            <button className="primary">جست‌وجوی کالا</button>
            {(draft.query || draft.status !== 'all' || draft.categoryId || draft.brandId) && (
              <button
                className="product-clear-filter"
                type="button"
                title="پاک‌کردن فیلترها"
                aria-label="پاک‌کردن فیلترها"
                onClick={() => {
                  setDraft(emptyProductFilters);
                  setFilters(emptyProductFilters);
                  setCursors([null]);
                  setGeneration((v) => v + 1);
                  setError(undefined);
                }}
              >
                <X size={14} aria-hidden="true" />
                <span>پاک‌کردن</span>
              </button>
            )}
          </>
        }
        applied={[
          filters.query ? 'جست‌وجو: ' + filters.query : null,
          filters.status === 'all' ? null : names[filters.status],
          filters.categoryId
            ? nameOf(data.categories.find((item) => item.id === filters.categoryId)!)
            : null,
          filters.brandId
            ? (data.brands.find((item) => item.id === filters.brandId)?.name ?? 'برند انتخاب‌شده')
            : null,
        ].filter((value): value is string => value !== null)}
      >
        <Field label="دستهٔ کالا">
          <select
            value={draft.categoryId ?? ''}
            onChange={(e) => setDraft({ ...draft, categoryId: e.target.value || null })}
          >
            <option value="">همهٔ دسته‌ها</option>
            {data.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {nameOf(c)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="برند کالا">
          <select
            value={draft.brandId ?? ''}
            onChange={(e) => setDraft({ ...draft, brandId: e.target.value || null })}
          >
            <option value="">همهٔ برندها</option>
            {data.brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
      </AdminFilterForm>
      <ErrorBox error={error ?? query.error} />
      {query.isPending ? (
        <Busy />
      ) : query.error ? (
        <div className="row-buttons">
          <button onClick={() => void query.refetch()}>تلاش دوباره برای کالاها</button>
          {cursors.length > 1 && (
            <button onClick={() => setCursors((v) => v.slice(0, -1))}>بازگشت به صفحهٔ قبل</button>
          )}
        </div>
      ) : (
        query.data && (
          <>
            <div
              className="table-wrap"
              role="region"
              aria-label="فهرست کالاها، قابل پیمایش افقی"
              tabIndex={0}
            >
              <AdminTable pageable searchable={false} aria-label="کالاهای فروشگاه">
                <thead>
                  <tr>
                    <th>کالا</th>
                    <th>دسته‌بندی</th>
                    <th>برند</th>
                    <th>وضعیت</th>
                    <th>تنوع‌ها</th>
                    {writable && <th>عملیات</th>}
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div className="product-table-identity">
                          <span className="product-table-symbol" aria-hidden="true">
                            <Package size={22} />
                          </span>
                          <div>
                            <strong>
                              {p.nameFa || p.nameEn || p.slug}
                              {p.featured && (
                                <Star
                                  size={13}
                                  className="product-featured-star"
                                  aria-label="کالای منتخب"
                                />
                              )}
                            </strong>
                            <small>
                              <bdi>{p.slug}</bdi>
                            </small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="product-category-label">
                          {nameOf(data.categories.find((c) => c.id === p.categoryId))}
                        </span>
                      </td>
                      <td>{data.brands.find((brand) => brand.id === p.brandId)?.name ?? '—'}</td>
                      <td>
                        <span className={'product-status product-status-' + p.status.toLowerCase()}>
                          {names[p.status]}
                        </span>
                      </td>
                      <td data-sort-value={p.variantCount}>
                        <span className="product-variant-count">
                          {p.variantCount.toLocaleString('fa-IR')}
                        </span>
                      </td>
                      {writable && (
                        <td>
                          <button
                            className="row-action product-edit-action"
                            onClick={() => setEditing(p.id)}
                          >
                            <Pencil size={15} aria-hidden="true" />
                            ویرایش
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {!query.data.items.length && (
                    <tr>
                      <td colSpan={writable ? 6 : 5} className="empty">
                        کالایی با این جست‌وجو پیدا نشد.
                      </td>
                    </tr>
                  )}
                </tbody>
              </AdminTable>
            </div>
            {(cursors.length > 1 || query.data.nextCursor) && (
              <div className="pagination product-continuation">
                <button
                  disabled={cursors.length === 1 || query.isFetching}
                  onClick={() => setCursors((v) => v.slice(0, -1))}
                >
                  کالاهای قبلی
                </button>
                <span>صفحهٔ {cursors.length.toLocaleString('fa-IR')}</span>
                <button
                  disabled={!query.data.nextCursor || query.isFetching}
                  onClick={() => {
                    if (query.data?.nextCursor) setCursors((v) => [...v, query.data!.nextCursor]);
                  }}
                >
                  ۵۰ کالای بعدی
                </button>
              </div>
            )}
          </>
        )
      )}
      {editing !== undefined && writable && (
        <Modal
          title={editing ? 'ویرایش کالا' : 'افزودن کالا'}
          onClose={() => setEditing(undefined)}
        >
          {editing ? (
            <ProductEditor
              id={editing}
              data={data}
              methods={methods}
              plans={plans}
              onClose={() => setEditing(undefined)}
            />
          ) : (
            <ProductForm
              data={data}
              methods={methods}
              plans={plans}
              onClose={() => setEditing(undefined)}
            />
          )}
        </Modal>
      )}
    </section>
  );
}
function ProductEditor({
  id,
  ...props
}: {
  id: string;
  data: Catalog;
  methods: PurchaseMethod[];
  plans: ChequePlan[];
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: ['admin', 'product-detail', id],
    queryFn: async ({ signal }) =>
      readProductDetail(
        await api<unknown>(`/admin/products/${encodeURIComponent(id)}`, { signal }),
        id,
      ),
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  return query.isPending ? (
    <Busy />
  ) : query.error ? (
    <>
      <ErrorBox error={query.error} />
      <button onClick={() => void query.refetch()}>دریافت دوبارهٔ جزئیات کالا</button>
    </>
  ) : query.data ? (
    <ProductForm key={query.data.version} item={query.data} {...props} />
  ) : null;
}
