import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../../api/api';
import { Busy, ErrorBox, Field } from '../../components/ui';
import {
  warehousePageSchema,
  type HolooSource,
} from '../../api/contracts/accounting/accounting-reconciliation-contract';

export function HolooSourcePicker({
  source,
  onSelect,
  disabled,
}: {
  source?: HolooSource;
  onSelect: (source?: HolooSource) => void;
  disabled: boolean;
}) {
  const pages = useInfiniteQuery({
    queryKey: ['admin', 'holoo-warehouses', 'source-picker'],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) =>
      warehousePageSchema.parse(
        await api(
          '/admin/accounting/holoo/warehouses' +
            (pageParam ? '?cursor=' + encodeURIComponent(pageParam) : ''),
          { signal },
        ),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const rows = Array.from(
    new Map(
      pages.data?.pages.flatMap((page) => page.items).map((row) => [row.id, row] as const),
    ).values(),
  );
  const current = rows.find(
    (row) =>
      row.companyKey === source?.companyKey &&
      row.externalWarehouseKey === source?.externalWarehouseKey,
  );
  return (
    <>
      <ErrorBox error={pages.error} />
      {pages.isPending && <Busy />}
      <Field
        label="شرکت و انبار مبدأ"
        hint="از میان نگاشت‌های انبار ثبت‌شده انتخاب کنید. انتخاب منبع صرفاً فیلتر و پیش‌فرض فرم‌ها را تنظیم می‌کند."
      >
        <select
          value={current?.id ?? (source ? 'selected' : '')}
          disabled={disabled || pages.isPending}
          onChange={(event) => {
            const match = rows.find((row) => row.id === event.target.value);
            onSelect(
              match
                ? { companyKey: match.companyKey, externalWarehouseKey: match.externalWarehouseKey }
                : undefined,
            );
          }}
        >
          <option value="">همهٔ منابع / ورود کلید به‌صورت دستی</option>
          {source && !current && (
            <option value="selected">
              {source.companyKey} / {source.externalWarehouseKey}
            </option>
          )}
          {rows.map((row) => (
            <option key={row.id} value={row.id}>
              {row.nameFa} · {row.companyKey} / {row.externalWarehouseKey}
            </option>
          ))}
        </select>
      </Field>
      {pages.data && !rows.length && <p>برای ساخت اولین منبع از «نگاشت انبارهای هلو» شروع کنید.</p>}
      {pages.hasNextPage && (
        <button
          type="button"
          disabled={disabled || pages.isFetchingNextPage}
          onClick={() => void pages.fetchNextPage()}
        >
          منابع بیشتر
        </button>
      )}
    </>
  );
}
