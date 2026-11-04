import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import { RefreshCw } from 'lucide-react';
import { PersianDateField } from '../../components/forms/persian-date-field';
import { api } from '../../api/api';
import {
  WorkspaceDataTable,
  type WorkspaceColumn,
} from '../../components/tables/workspace-data-table';
import {
  emptyMovementFilters,
  localMovementTime,
  movementFiltersSchema,
  movementPath,
  readMovementPage,
  type MovementFilters,
  type MovementPage,
} from '../../api/contracts/inventory/inventory-history-contract';

type Movement = MovementPage['items'][number];
type MovementColumn = 'event' | 'direction' | 'balance' | 'reason' | 'actor' | 'at';
const date = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short', timeStyle: 'short' });
const number = new Intl.NumberFormat('fa-IR');
const signed = new Intl.NumberFormat('fa-IR', { signDisplay: 'exceptZero' });
const directions = [
  ['all', 'همهٔ گردش‌ها'],
  ['in', 'ورود فیزیکی'],
  ['out', 'خروج فیزیکی'],
] as const;
const movementColumns: readonly WorkspaceColumn<Movement, MovementColumn>[] = [
  {
    key: 'event',
    label: 'رویداد / تنوع',
    type: 'text',
    sticky: 'start',
    width: 200,
    mobilePriority: 'primary',
    formatter: (r) => (
      <span className="inventory-row-details">
        <strong>{number.format(BigInt(r.id))}</strong>
        <small>
          <bdi>{r.variantId}</bdi>
        </small>
      </span>
    ),
  },
  {
    key: 'direction',
    label: 'تغییر',
    type: 'number',
    filter: 'multiselect',
    width: 115,
    mobilePriority: 'primary',
    formatter: (r) => (
      <Chip
        size="small"
        label={signed.format(r.delta)}
        color={r.delta > 0 ? 'success' : r.delta < 0 ? 'warning' : 'default'}
        variant="outlined"
      />
    ),
  },
  {
    key: 'balance',
    label: 'ماندهٔ فیزیکی',
    type: 'number',
    width: 134,
    formatter: (r) => number.format(r.balance),
  },
  {
    key: 'reason',
    label: 'دلیل',
    type: 'text',
    width: 216,
    tooltip: (r) => r.reason,
    formatter: (r) => r.reason,
  },
  {
    key: 'at',
    label: 'زمان ثبت',
    type: 'date',
    filter: 'dateRange',
    width: 158,
    mobilePriority: 'primary',
    formatter: (r) => <time dateTime={r.at}>{date.format(new Date(r.at))}</time>,
  },
  {
    key: 'actor',
    label: 'عامل / درخواست',
    type: 'text',
    width: 230,
    formatter: (r) => (
      <span className="inventory-row-details">
        <bdi>{r.actorId}</bdi>
        <small>
          <bdi>{r.requestId}</bdi>
        </small>
      </span>
    ),
  },
];

function localInput(at: string | null) {
  if (!at) return '';
  const time = new Date(at);
  const date = [time.getFullYear(), time.getMonth() + 1, time.getDate()]
    .map((part) => String(part).padStart(2, '0'))
    .join('-');
  const clock = [time.getHours(), time.getMinutes()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
  return date + 'T' + clock;
}

function MovementDateFilter({
  filters,
  onApply,
}: {
  filters: MovementFilters;
  onApply: (patch: Partial<MovementFilters>) => void;
}) {
  const [from, setFrom] = useState(() => localInput(filters.fromAt));
  const [to, setTo] = useState(() => localInput(filters.toAt));
  const [error, setError] = useState('');
  return (
    <Stack
      spacing={1.5}
      component="form"
      onSubmit={(event) => {
        event.preventDefault();
        try {
          const patch = { fromAt: localMovementTime(from), toAt: localMovementTime(to) };
          if (!movementFiltersSchema.safeParse({ ...filters, ...patch }).success)
            throw new Error('زمان پایان باید بعد از شروع باشد.');
          onApply(patch);
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : 'بازه معتبر نیست.');
        }
      }}
    >
      <PersianDateField
        label="از زمان (شامل)"
        encoding="local"
        precision="minute"
        value={from}
        onChange={setFrom}
      />
      <PersianDateField
        label="تا زمان (پیش از)"
        encoding="local"
        precision="minute"
        value={to}
        onChange={setTo}
      />
      {error && <small role="alert">{error}</small>}
      <small>زمان شمسی بر اساس منطقهٔ دستگاه شماست.</small>
      <Button type="submit" variant="contained">
        اعمال بازه
      </Button>
    </Stack>
  );
}

export function InventoryHistory({
  initialVariantId = null,
  initialSku,
}: {
  initialVariantId?: string | null;
  initialSku?: string;
}) {
  const [search, setSearch] = useState(initialVariantId ?? '');
  const [filters, setFilters] = useState<MovementFilters>({
    ...emptyMovementFilters,
    variantId: initialVariantId,
  });
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [hidden, setHidden] = useState<Set<MovementColumn>>(() => new Set(['actor']));
  const cursor = cursors.at(-1)!;
  const searchValid = !search.trim() || /^[A-Za-z0-9_-]{1,64}$/.test(search.trim());
  useEffect(() => {
    if (!searchValid) return;
    const variantId = search.trim() || null;
    if (filters.variantId === variantId) return;
    const timer = window.setTimeout(() => {
      setFilters((old) => ({ ...old, variantId }));
      setCursors([null]);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [search, searchValid, filters.variantId]);

  const query = useQuery({
    queryKey: ['admin', 'stock-movements', filters, cursor],
    queryFn: async ({ signal }) =>
      readMovementPage(await api<unknown>(movementPath(filters, cursor), { signal }), filters),
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });

  function update(patch: Partial<MovementFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setCursors([null]);
  }
  const chips: { key: MovementColumn; label: string }[] = [];
  if (filters.direction !== 'all')
    chips.push({
      key: 'direction',
      label: filters.direction === 'in' ? 'ورود فیزیکی' : 'خروج فیزیکی',
    });
  if (filters.fromAt || filters.toAt) {
    const from = filters.fromAt ? 'از ' + date.format(new Date(filters.fromAt)) : '';
    const to = filters.toAt ? 'تا پیش از ' + date.format(new Date(filters.toAt)) : '';
    chips.push({ key: 'at', label: [from, to].filter(Boolean).join(' · ') });
  }
  return (
    <section
      id="inventory-movements"
      tabIndex={-1}
      className="panel inventory-history"
      aria-labelledby="inventory-history-heading"
    >
      <div className="section-heading">
        <div>
          <h2 id="inventory-history-heading">تاریخچهٔ گردش فیزیکی انبار</h2>
          <p>ورود و خروج فیزیکی از تازه‌ترین رویداد؛ رزرو و آزادسازی در ماندهٔ آزاد اثر دارند.</p>
        </div>
        {initialSku && filters.variantId === initialVariantId && (
          <Chip
            label={<bdi>{initialSku}</bdi>}
            onDelete={() => {
              setSearch('');
              update({ variantId: null });
            }}
          />
        )}
      </div>
      <WorkspaceDataTable
        label="جدول گردش انبار"
        itemLabel="رویداد"
        columns={movementColumns}
        items={query.data?.items ?? []}
        getRowId={(row) => row.id}
        total={query.data?.items.length ?? 0}
        page={cursors.length - 1}
        pageSize={50}
        onPageSizeChange={() => {}}
        cursorPagination={{ hasNext: Boolean(query.data?.nextCursor) }}
        onPageChange={(page) => {
          if (page < cursors.length - 1) setCursors((old) => old.slice(0, -1));
          else if (query.data?.nextCursor) setCursors((old) => [...old, query.data!.nextCursor]);
        }}
        search={search}
        onSearchChange={setSearch}
        searchLabel="فیلتر شناسهٔ تنوع"
        searchPlaceholder="شناسهٔ دقیق یا انتخاب از جدول موجودی"
        searchError={
          searchValid ? undefined : 'شناسه باید حداکثر ۶۴ حرف انگلیسی، عدد یا خط تیره باشد.'
        }
        sort={{ key: 'event', direction: 'desc' }}
        onSortChange={() => {}}
        loading={query.isFetching && !query.data}
        error={query.isError ? 'گردش انبار دریافت نشد.' : undefined}
        onRetry={() => void query.refetch()}
        filterChips={chips}
        onRemoveFilter={(key) =>
          update(key === 'at' ? { fromAt: null, toAt: null } : { direction: 'all' })
        }
        onClearFilters={() => update({ direction: 'all', fromAt: null, toAt: null })}
        renderFilter={(column, close) =>
          column.key === 'at' ? (
            <MovementDateFilter
              filters={filters}
              onApply={(patch) => {
                update(patch);
                close();
              }}
            />
          ) : (
            <Stack spacing={1}>
              {directions.map(([direction, label]) => (
                <Button
                  key={direction}
                  aria-pressed={filters.direction === direction}
                  variant={filters.direction === direction ? 'contained' : 'outlined'}
                  onClick={() => {
                    update({ direction });
                    close();
                  }}
                >
                  {label}
                </Button>
              ))}
            </Stack>
          )
        }
        hiddenColumns={hidden}
        onHiddenColumnsChange={setHidden}
        toolbarActions={
          <Button
            startIcon={<RefreshCw size={17} />}
            disabled={query.isFetching}
            onClick={() => (cursor ? setCursors([null]) : void query.refetch())}
          >
            تازه‌سازی
          </Button>
        }
      />
    </section>
  );
}
