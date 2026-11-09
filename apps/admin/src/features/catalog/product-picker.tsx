import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/api';
import { Busy, Check, ErrorBox, Field } from '../../components/ui';
import {
  emptyProductFilters,
  productFiltersSchema,
  productsPath,
  readProductsPage,
  productLookupPath,
  readProductLookup,
  toggleProductSelection,
  type ProductSummary,
} from '../../api/contracts/catalog/products-contract';
const names = { Draft: 'پیش‌نویس', Published: 'منتشرشده', Hidden: 'پنهان' };
export function ProductPicker({
  value,
  onChange,
  maximum = 24,
  excluded,
  label,
  publishedOnly = false,
  onPickProduct,
  disabled = false,
}: {
  publishedOnly?: boolean;
  onPickProduct?: (product: ProductSummary) => void;
  disabled?: boolean;
  maximum?: number;
  excluded?: string;
  label?: string;
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState<unknown>();
  const cursor = cursors.at(-1)!;
  const filters = {
    ...emptyProductFilters,
    query: search,
    status: publishedOnly ? ('Published' as const) : ('all' as const),
  };
  const query = useQuery({
    queryKey: ['admin', 'product-picker', publishedOnly, generation, search, cursor],
    queryFn: async ({ signal }) =>
      readProductsPage(await api<unknown>(productsPath(filters, cursor), { signal }), filters),
    enabled: choosing,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const selected = useQuery({
    queryKey: ['admin', 'product-picker-selected', value],
    queryFn: async ({ signal }) =>
      readProductLookup(await api<unknown>(productLookupPath(value), { signal }), value),
    enabled: choosing && value.length > 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
  function move(index: number, offset: number) {
    const next = [...value];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    onChange(next);
  }
  return (
    <fieldset className="product-picker" disabled={disabled}>
      {!onPickProduct && <p>{value.length.toLocaleString('fa-IR')} کالای دستی انتخاب شده است.</p>}
      <button type="button" onClick={() => setChoosing((v) => !v)}>
        {choosing ? 'بستن انتخاب‌گر کالا' : (label ?? 'انتخاب و مرتب‌سازی کالاها')}
      </button>
      {choosing && (
        <>
          <div className="form-grid">
            <Field label={onPickProduct ? 'جست‌وجوی کالای منتشرشده' : 'جست‌وجوی کالای بلوک'}>
              <input value={draft} maxLength={120} onChange={(e) => setDraft(e.target.value)} />
            </Field>
            <button
              type="button"
              onClick={() => {
                const parsed = productFiltersSchema.safeParse({
                  ...emptyProductFilters,
                  query: draft,
                });
                if (!parsed.success) {
                  setError(new Error('حداکثر ۱۲۰ نویسه و ۸ واژه جست‌وجو کنید.'));
                  return;
                }
                setError(undefined);
                setSearch(parsed.data.query);
                setCursors([null]);
                setGeneration((v) => v + 1);
              }}
            >
              جست‌وجو در همهٔ کالاها
            </button>
          </div>
          {!onPickProduct && (
            <p className="muted">
              {value.length.toLocaleString('fa-IR')} از {maximum.toLocaleString('fa-IR')} کالا
              انتخاب شده؛ ترتیب زیر، ترتیب نمایش است. انتخاب‌های خارج از صفحه حفظ می‌شوند.
            </p>
          )}
          <ErrorBox error={error ?? selected.error} />
          {selected.error && (
            <button type="button" onClick={() => void selected.refetch()}>
              دریافت دوبارهٔ انتخاب‌ها
            </button>
          )}
          <ol className="selected-products">
            {value.map((id, index) => {
              const p = selected.data?.find((p) => p.id.toLowerCase() === id.toLowerCase());
              return (
                <li key={id}>
                  <span>
                    {p
                      ? p.nameFa || p.nameEn || p.slug
                      : selected.isPending
                        ? 'در حال دریافت نام…'
                        : `کالا در دسترس نیست · ${id}`}
                    {p && <small> · {names[p.status]}</small>}
                  </span>
                  <div className="row-buttons">
                    <button
                      type="button"
                      aria-label={`بالا بردن کالای ${index + 1}`}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      بالا
                    </button>
                    <button
                      type="button"
                      aria-label={`پایین بردن کالای ${index + 1}`}
                      disabled={index === value.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      پایین
                    </button>
                    <button
                      type="button"
                      onClick={() => onChange(value.filter((_, i) => i !== index))}
                    >
                      حذف از بلوک
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
          <ErrorBox error={query.error} />
          {query.isPending ? (
            <Busy />
          ) : query.error ? (
            <button type="button" onClick={() => void query.refetch()}>
              دریافت دوبارهٔ فهرست
            </button>
          ) : (
            query.data && (
              <>
                <div className="product-picker-results">
                  {query.data.items
                    .filter((p) => p.id !== excluded)
                    .map((p) => {
                      if (onPickProduct)
                        return (
                          <button
                            type="button"
                            key={p.id}
                            onClick={() => {
                              onPickProduct(p);
                              setChoosing(false);
                            }}
                          >
                            {p.nameFa || p.nameEn || p.slug}
                          </button>
                        );
                      const checked = value.some((v) => v.toLowerCase() === p.id.toLowerCase());
                      return (
                        <Check
                          key={p.id}
                          label={`${p.nameFa || p.nameEn || p.slug} · ${names[p.status]}`}
                          checked={checked}
                          disabled={!checked && value.length >= maximum}
                          onChange={() => onChange(toggleProductSelection(value, p.id))}
                        />
                      );
                    })}
                  {!query.data.items.length && (
                    <p className="empty">کالایی در نتیجهٔ جست‌وجو نیست.</p>
                  )}
                </div>
                <div className="pagination">
                  <button
                    type="button"
                    disabled={cursors.length === 1 || query.isFetching}
                    onClick={() => setCursors((v) => v.slice(0, -1))}
                  >
                    انتخاب‌های صفحهٔ قبل
                  </button>
                  <span>صفحهٔ {cursors.length.toLocaleString('fa-IR')}</span>
                  <button
                    type="button"
                    disabled={!query.data.nextCursor || query.isFetching}
                    onClick={() => {
                      if (query.data?.nextCursor) setCursors((v) => [...v, query.data!.nextCursor]);
                    }}
                  >
                    ۵۰ گزینهٔ بعدی
                  </button>
                </div>
              </>
            )
          )}
        </>
      )}
    </fieldset>
  );
}
