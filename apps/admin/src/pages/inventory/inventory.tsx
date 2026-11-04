import { lazy, Suspense, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { ClipboardList, History, RefreshCw, ScanLine } from 'lucide-react';
import { api, ApiError, save } from '../../api/api';
import { Busy, ErrorBox, Modal } from '../../components/ui';
import { InventoryHistory } from './inventory-history';
import {
  emptyInventoryWorkspace,
  inventoryCount,
  inventoryDetailPath,
  inventoryRowSchema,
  inventoryWorkspaceFiltersSchema,
  inventoryWorkspacePath,
  readInventoryWorkspace,
  stockAdjustment,
  stockAdjustmentPreview,
  type InventoryRow,
  type InventoryWorkspaceFilters,
} from '../../api/contracts/inventory/inventory-contract';
import {
  WorkspaceDataTable,
  type WorkspaceColumn,
} from '../../components/tables/workspace-data-table';
import '../../styles/inventory/inventory-workspace.css';

const number = new Intl.NumberFormat('fa-IR');
const signed = new Intl.NumberFormat('fa-IR', { signDisplay: 'exceptZero' });
const pageSizes = [25, 50] as const;
const stockViews = [
  { name: 'همهٔ مانده‌ها', min: null, max: null },
  { name: 'ناموجود', min: 0, max: 0 },
  { name: 'کم‌موجود', min: 1, max: 3 },
  { name: '۴ واحد یا بیشتر', min: 4, max: null },
] as const;
const SerialInventoryPanel = lazy(() =>
  import('./serial-inventory').then((m) => ({ default: m.SerialInventoryPanel })),
);
type StockColumn =
  'name' | 'sku' | 'status' | 'onHand' | 'reserved' | 'sourcingReserved' | 'available' | 'actions';
const stockColumns: readonly WorkspaceColumn<InventoryRow, StockColumn>[] = [
  {
    key: 'name',
    label: 'کالا',
    type: 'text',
    sortable: true,
    sticky: 'start',
    width: 228,
    mobilePriority: 'primary',
    tooltip: (r) => r.nameFa || r.nameEn || r.sku,
    formatter: (r) => <strong>{r.nameFa || r.nameEn || r.sku}</strong>,
  },
  {
    key: 'sku',
    label: 'SKU',
    type: 'text',
    sortable: true,
    width: 170,
    mobilePriority: 'primary',
    tooltip: (r) => r.sku,
    formatter: (r) => <bdi>{r.sku}</bdi>,
  },
  {
    key: 'status',
    label: 'وضعیت تنوع',
    type: 'status',
    filter: 'multiselect',
    width: 154,
    formatter: (r) => (
      <Chip
        size="small"
        label={r.isActive ? 'فعال' : 'غیرفعال'}
        color={r.isActive ? 'success' : 'default'}
        variant="outlined"
      />
    ),
  },
  {
    key: 'available',
    label: 'ماندهٔ آزاد',
    type: 'number',
    sortable: true,
    filter: 'numberRange',
    width: 145,
    mobilePriority: 'primary',
    formatter: (r) => (
      <Chip
        size="small"
        label={number.format(r.available)}
        color={r.available === 0 ? 'error' : r.available <= 3 ? 'warning' : 'success'}
        variant="outlined"
      />
    ),
  },
  {
    key: 'onHand',
    label: 'فیزیکی',
    type: 'number',
    width: 125,
    formatter: (r) => (
      <span className="inventory-row-details">
        {number.format(r.onHand)}
        {r.version === null && <small>بدون سابقه</small>}
      </span>
    ),
  },
  {
    key: 'reserved',
    label: 'رزرو سفارش',
    type: 'number',
    width: 120,
    formatter: (r) => number.format(r.reserved),
  },
  {
    key: 'sourcingReserved',
    label: 'رزرو تأمین',
    type: 'number',
    width: 120,
    formatter: (r) => number.format(r.sourcingReserved),
  },
  {
    key: 'actions',
    label: 'عملیات',
    type: 'custom',
    sticky: 'end',
    width: 165,
    formatter: () => null,
  },
];

function StockFilter({
  column,
  filters,
  onApply,
}: {
  column: StockColumn;
  filters: InventoryWorkspaceFilters;
  onApply: (patch: Partial<InventoryWorkspaceFilters>) => void;
}) {
  const [min, setMin] = useState(String(filters.minAvailable ?? ''));
  const [max, setMax] = useState(String(filters.maxAvailable ?? ''));
  const [error, setError] = useState('');
  if (column === 'status')
    return (
      <Stack spacing={1}>
        {(
          [
            ['all', 'همهٔ تنوع‌ها'],
            ['true', 'فقط فعال'],
            ['false', 'فقط غیرفعال'],
          ] as const
        ).map(([active, label]) => (
          <Button
            key={active}
            aria-pressed={filters.active === active}
            variant={filters.active === active ? 'contained' : 'outlined'}
            onClick={() => onApply({ active })}
          >
            {label}
          </Button>
        ))}
      </Stack>
    );
  return (
    <Stack
      spacing={1.5}
      component="form"
      onSubmit={(event) => {
        event.preventDefault();
        try {
          const minAvailable = min.trim() ? inventoryCount(min) : null;
          const maxAvailable = max.trim() ? inventoryCount(max) : null;
          if (minAvailable !== null && maxAvailable !== null && minAvailable > maxAvailable)
            throw new Error('حداکثر باید برابر یا بزرگ‌تر از حداقل باشد.');
          onApply({ minAvailable, maxAvailable });
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : 'بازه معتبر نیست.');
        }
      }}
    >
      <TextField
        label="حداقل مانده"
        value={min}
        onChange={(event) => {
          setMin(event.target.value);
          setError('');
        }}
        error={Boolean(error)}
        slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 10 } }}
      />
      <TextField
        label="حداکثر مانده"
        value={max}
        onChange={(event) => {
          setMax(event.target.value);
          setError('');
        }}
        error={Boolean(error)}
        helperText={error}
        slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 10 } }}
      />
      <Button type="submit" variant="contained">
        اعمال بازه
      </Button>
    </Stack>
  );
}

export function InventoryPage({ writable }: { writable: boolean }) {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(emptyInventoryWorkspace);
  const [hidden, setHidden] = useState<Set<StockColumn>>(() => new Set());
  const [selected, setSelected] = useState<InventoryRow | null>(null);
  const [history, setHistory] = useState<{ row: InventoryRow | null; key: number }>({
    row: null,
    key: 0,
  });
  const [serial, setSerial] = useState<InventoryRow | null>(null);
  const [serialPending, setSerialPending] = useState(false);
  const [receipt, setReceipt] = useState('');
  const searchValid = inventoryWorkspaceFiltersSchema.safeParse({
    ...filters,
    query: search,
  }).success;
  useEffect(() => {
    if (!searchValid) return;
    const timer = window.setTimeout(() => {
      setFilters((current) =>
        current.query === search.trim() ? current : { ...current, query: search.trim(), page: 0 },
      );
    }, 280);
    return () => window.clearTimeout(timer);
  }, [search, searchValid]);

  const query = useQuery({
    queryKey: ['admin', 'stock-workspace', filters],
    queryFn: async ({ signal }) =>
      readInventoryWorkspace(
        await api<unknown>(inventoryWorkspacePath(filters), { signal }),
        filters,
      ),
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const total = query.data?.total;
  useEffect(() => {
    if (total === undefined) return;
    const lastPage = Math.max(0, Math.ceil(total / filters.pageSize) - 1);
    if (filters.page > lastPage) setFilters((current) => ({ ...current, page: lastPage }));
  }, [total, filters.page, filters.pageSize]);

  function update(patch: Partial<InventoryWorkspaceFilters>) {
    setFilters((current) => ({ ...current, ...patch, page: 0 }));
  }
  function openHistory(row: InventoryRow) {
    setHistory((old) => ({ row, key: old.key + 1 }));
    requestAnimationFrame(() => {
      const target = document.getElementById('inventory-movements');
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'start' });
    });
  }
  const chips: { key: StockColumn; label: string }[] = [];
  if (filters.active !== 'all')
    chips.push({ key: 'status', label: filters.active === 'true' ? 'تنوع فعال' : 'تنوع غیرفعال' });
  if (filters.minAvailable !== null || filters.maxAvailable !== null) {
    const named = stockViews.find(
      (view) => view.min === filters.minAvailable && view.max === filters.maxAvailable,
    );
    const min = filters.minAvailable === null ? '' : 'از ' + number.format(filters.minAvailable);
    const max = filters.maxAvailable === null ? '' : 'تا ' + number.format(filters.maxAvailable);
    chips.push({ key: 'available', label: named?.name ?? `ماندهٔ آزاد ${min} ${max}`.trim() });
  }
  return (
    <>
      <section className="panel inventory-workspace">
        <div className="section-heading">
          <div>
            <h2>موجودی تنوع‌ها</h2>
            <p>ماندهٔ آزاد از کسر رزرو سفارش و تأمین از موجودی فیزیکی به دست می‌آید.</p>
          </div>
        </div>
        <Stack
          direction="row"
          useFlexGap
          spacing={1}
          sx={{ flexWrap: 'wrap', mb: 2 }}
          role="group"
          aria-label="نماهای سریع موجودی"
        >
          {stockViews.map((view) => {
            const active = view.min === filters.minAvailable && view.max === filters.maxAvailable;
            return (
              <Button
                key={view.name}
                aria-pressed={active}
                variant={active ? 'contained' : 'outlined'}
                onClick={() => update({ minAvailable: view.min, maxAvailable: view.max })}
              >
                {view.name}
              </Button>
            );
          })}
        </Stack>
        <WorkspaceDataTable
          label="جدول موجودی انبار"
          itemLabel="تنوع"
          columns={stockColumns}
          items={query.data?.items ?? []}
          getRowId={(row) => row.variantId}
          total={total ?? 0}
          page={filters.page}
          pageSize={filters.pageSize}
          pageSizes={pageSizes}
          onPageChange={(page) => setFilters((old) => ({ ...old, page }))}
          onPageSizeChange={(size) => update({ pageSize: size === 50 ? 50 : 25 })}
          search={search}
          onSearchChange={setSearch}
          searchLabel="جست‌وجوی موجودی"
          searchPlaceholder="نام کالا یا SKU"
          searchError={searchValid ? undefined : 'حداکثر ۱۲۰ نویسه و ۸ واژه وارد کنید.'}
          sort={{ key: filters.sort, direction: filters.direction }}
          onSortChange={({ key, direction }) => {
            if (key === 'name' || key === 'sku' || key === 'available')
              update({ sort: key, direction });
          }}
          loading={query.isFetching && !query.data}
          error={query.isError ? 'موجودی دریافت نشد.' : undefined}
          onRetry={() => void query.refetch()}
          filterChips={chips}
          onRemoveFilter={(key) =>
            update(
              key === 'status' ? { active: 'all' } : { minAvailable: null, maxAvailable: null },
            )
          }
          onClearFilters={() => update({ active: 'all', minAvailable: null, maxAvailable: null })}
          renderFilter={(column, close) => (
            <StockFilter
              key={column.key}
              column={column.key}
              filters={filters}
              onApply={(patch) => {
                update(patch);
                close();
              }}
            />
          )}
          hiddenColumns={hidden}
          onHiddenColumnsChange={setHidden}
          toolbarActions={
            <Button
              startIcon={<RefreshCw size={17} />}
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              تازه‌سازی
            </Button>
          }
          renderRowActions={
            writable
              ? (row) => (
                  <Button
                    onClick={() => setSelected(row)}
                    size="small"
                    aria-label={'شمارش یا اصلاح ' + row.sku}
                  >
                    شمارش / اصلاح
                  </Button>
                )
              : undefined
          }
          getRowActions={(row) => [
            {
              key: 'history',
              label: 'گردش این تنوع',
              icon: <History size={17} />,
              onClick: () => openHistory(row),
            },
            {
              key: 'serial',
              label: 'سریال / IMEI',
              icon: <ScanLine size={17} />,
              onClick: () => {
                setSerial(row);
                setSerialPending(false);
              },
            },
          ]}
        />
      </section>
      <InventoryHistory
        key={history.key}
        initialVariantId={history.row?.variantId}
        initialSku={history.row?.sku}
      />
      {selected && writable && (
        <StockForm
          row={selected}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setReceipt('گردش موجودی ' + selected.sku + ' ثبت شد.');
            setSelected(null);
          }}
        />
      )}
      <Snackbar open={Boolean(receipt)} autoHideDuration={5500} onClose={() => setReceipt('')}>
        <Alert severity="success" onClose={() => setReceipt('')}>
          {receipt}
        </Alert>
      </Snackbar>
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

function StockForm({
  row,
  onClose,
  onSaved,
}: {
  row: InventoryRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const client = useQueryClient();
  const variantId = row.variantId;
  const [mode, setMode] = useState<'count' | 'delta'>('count');
  const [input, setInput] = useState('');
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [attempt, setAttempt] = useState<ReturnType<typeof stockAdjustment> | null>(null);
  const stock = useQuery({
    queryKey: ['admin', 'stock-one', 2, variantId],
    queryFn: async ({ signal }) => {
      const current = inventoryRowSchema.parse(
        await api<unknown>(inventoryDetailPath(variantId), { signal }),
      );
      if (current.variantId.toLowerCase() !== variantId.toLowerCase())
        throw new Error('تنوع دریافت‌شده معتبر نیست.');
      return current;
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
      onSaved();
    },
    onError: (failure) => {
      if (
        failure instanceof ApiError &&
        [
          'version_conflict',
          'invalid_adjustment',
          'insufficient_stock',
          'serial_tracking_required',
          'not_found',
        ].includes(failure.code)
      )
        setAttempt(null);
    },
  });
  let preview: ReturnType<typeof stockAdjustmentPreview> | undefined;
  let inputError = '';
  if (stock.data && input.trim()) {
    try {
      preview = stockAdjustmentPreview(mode, input, stock.data);
    } catch (failure) {
      inputError = failure instanceof Error ? failure.message : 'تعداد معتبر نیست.';
    }
  }
  const conflict = mutation.error instanceof ApiError && mutation.error.code === 'version_conflict';
  const needsReason = submitted && !reason.trim();
  const unchanged = preview?.delta === 0;
  return (
    <Dialog
      open
      fullWidth
      maxWidth="sm"
      aria-labelledby="stock-count-title"
      onClose={() => {
        if (!mutation.isPending) onClose();
      }}
    >
      <DialogTitle id="stock-count-title">
        شمارش و اصلاح موجودی · <bdi>{row.sku}</bdi>
      </DialogTitle>
      <DialogContent dividers>
        {stock.isPending ? (
          <Busy />
        ) : !stock.data || stock.isError ? (
          <Stack spacing={1.5}>
            <ErrorBox error={stock.error} />
            <Button disabled={stock.isFetching} onClick={() => void stock.refetch()}>
              دریافت دوبارهٔ موجودی
            </Button>
          </Stack>
        ) : (
          <Stack
            component="form"
            spacing={2}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (mutation.isPending || stock.isFetching || conflict) return;
              setSubmitted(true);
              if (attempt) {
                mutation.mutate(attempt);
                return;
              }
              if (!preview?.delta || !reason.trim()) return;
              const payload = stockAdjustment(
                String(preview.delta),
                reason,
                stock.data.version,
                crypto.randomUUID(),
              );
              setAttempt(payload);
              mutation.mutate(payload);
            }}
          >
            <strong>{row.nameFa || row.nameEn || row.sku}</strong>
            <div className="inventory-balance-grid">
              {(
                [
                  ['فیزیکی', stock.data.onHand],
                  ['رزرو سفارش', stock.data.reserved],
                  ['رزرو تأمین', stock.data.sourcingReserved],
                  ['آزاد', stock.data.available],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{number.format(value)}</strong>
                </div>
              ))}
            </div>
            <TextField
              select
              label="روش ثبت"
              value={mode}
              disabled={Boolean(attempt)}
              onChange={(event) => {
                setMode(event.target.value === 'count' ? 'count' : 'delta');
                setInput('');
                setSubmitted(false);
              }}
            >
              <MenuItem value="count">ثبت تعداد شمارش‌شده</MenuItem>
              <MenuItem value="delta">ثبت افزایش یا کاهش</MenuItem>
            </TextField>
            <TextField
              label={mode === 'count' ? 'تعداد فیزیکی شمارش‌شده' : 'تعداد افزایش یا کاهش'}
              value={input}
              required
              disabled={Boolean(attempt)}
              onChange={(event) => setInput(event.target.value)}
              error={Boolean(inputError || (submitted && !input.trim()))}
              helperText={
                inputError ||
                (submitted && !input.trim()
                  ? 'تعداد را وارد کنید.'
                  : mode === 'count'
                    ? 'تعداد کل واحدهای فیزیکی، شامل واحدهای رزروشده.'
                    : 'برای کاهش، علامت منفی وارد کنید.')
              }
              slotProps={{
                htmlInput: { inputMode: mode === 'count' ? 'numeric' : 'text', maxLength: 12 },
              }}
            />
            <TextField
              label="دلیل ثبت در گردش انبار"
              value={reason}
              required
              multiline
              minRows={2}
              disabled={Boolean(attempt)}
              onChange={(event) => setReason(event.target.value)}
              error={needsReason}
              helperText={needsReason ? 'دلیل ثبت را وارد کنید.' : undefined}
              slotProps={{ htmlInput: { maxLength: 500 } }}
            />
            {preview && (
              <Alert
                severity={unchanged ? 'info' : preview.delta < 0 ? 'warning' : 'success'}
                icon={<ClipboardList size={20} />}
              >
                {unchanged
                  ? 'شمارش با موجودی فیزیکی برابر است.'
                  : `اختلاف ${signed.format(preview.delta)} · فیزیکی پس از ثبت ${number.format(preview.onHand)} · آزاد پس از ثبت ${number.format(preview.available)}`}
              </Alert>
            )}
            <ErrorBox error={mutation.error} />
            {attempt && mutation.error && (
              <Alert severity="warning">
                نتیجه هنوز قطعی نیست. «تلاش دوباره» همین ثبت را پیگیری می‌کند؛ اگر پنجره را بستید،
                پیش از ثبت تازه گردش این تنوع را بررسی کنید.
              </Alert>
            )}
            {conflict && (
              <Alert severity="warning">
                موجودی در این فاصله تغییر کرده است. مانده را تازه کنید و اختلاف جدید را دوباره بررسی
                کنید.
              </Alert>
            )}
            <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }}>
              <Button
                variant="contained"
                type="submit"
                disabled={mutation.isPending || stock.isFetching || conflict || unchanged}
              >
                {mutation.isPending ? 'در حال ثبت…' : attempt ? 'تلاش دوباره' : 'ثبت گردش موجودی'}
              </Button>
              <Button
                disabled={Boolean(attempt) || stock.isFetching}
                onClick={async () => {
                  const next = await stock.refetch();
                  if (!next.isError) mutation.reset();
                }}
              >
                دریافت ماندهٔ تازه
              </Button>
              <Button disabled={mutation.isPending} onClick={onClose}>
                بستن
              </Button>
            </Stack>
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  );
}
