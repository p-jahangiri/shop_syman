import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import {
  Archive,
  ArchiveRestore,
  Banknote,
  Download,
  History,
  Pencil,
  Plus,
  RefreshCw,
  Rows3,
  Settings2,
  Warehouse,
} from 'lucide-react';
import { api } from '../../api/api';
import { PriceHistory } from './price-history';
import { ProductColumnFilter } from '../../features/catalog/product-column-filter';
import {
  isProductColumnFiltered,
  productColumns,
  productColumnLabels,
  productFilterSummary,
  productStatusLabels,
  productToman,
  resetProductColumn,
  type ProductColumn,
  type ProductStatusFilter,
} from '../../features/catalog/product-column-filter-model';
import { useProductCommand } from '../../hooks/use-product-command';
import { imagePreviewUrl } from '../../api/contracts/media/media-contract';
import { nameOf, type Catalog, type PurchaseMethod, type ChequePlan } from '../../types/types';
import {
  WorkspaceDataTable,
  type WorkspaceColumn,
} from '../../components/tables/workspace-data-table';
import {
  initialWorkspaceFilters,
  workspaceFiltersSchema,
  workspaceProductsPath,
  readWorkspaceProducts,
  readWorkspaceDetail,
  productWorkspaceBase,
  type WorkspaceFilters,
  type WorkspaceProductRow,
} from '../../api/contracts/catalog/product-workspace-contract';

const ProductEditor = lazy(() =>
  import('../../features/catalog/product-editor').then((module) => ({
    default: module.ProductEditor,
  })),
);
const ProductQuickPrices = lazy(() =>
  import('../../features/catalog/product-quick-prices').then((module) => ({
    default: module.ProductQuickPrices,
  })),
);
const ProductFormSettings = lazy(() =>
  import('../../features/catalog/product-form-settings').then((module) => ({
    default: module.ProductFormSettings,
  })),
);

type CatalogColumn = ProductColumn | 'actions';
const tabs = ['Published', 'Draft', 'Hidden', 'archived'] as const;
const lastChange = new Intl.DateTimeFormat('fa-IR', {
  calendar: 'persian',
  dateStyle: 'medium',
  timeStyle: 'short',
});
const numberFa = new Intl.NumberFormat('fa-IR');
const numericStyle = {
  fontVariantNumeric: 'tabular-nums',
  fontWeight: 700,
  whiteSpace: 'nowrap',
} as const;
const nameOfRow = (row: WorkspaceProductRow) => row.nameFa || row.nameEn || row.slug;
const statusOf = (row: WorkspaceProductRow) => (row.archived ? 'archived' : row.status);
const rowId = (row: WorkspaceProductRow) => row.id;
const catalogViewKey = (viewerId: string) => 'sayman.admin.catalog-view.v1.' + viewerId;
function readCatalogView(viewerId: string) {
  try {
    const value = JSON.parse(localStorage.getItem(catalogViewKey(viewerId)) ?? '{}');
    return {
      compact: value?.compact === true,
      hidden: new Set<CatalogColumn>(
        catalogColumns
          .filter(
            (column) =>
              !column.sticky && Array.isArray(value?.hidden) && value.hidden.includes(column.key),
          )
          .map((column) => column.key),
      ),
    };
  } catch {
    return { compact: false, hidden: new Set<CatalogColumn>() };
  }
}

const catalogColumns: readonly WorkspaceColumn<WorkspaceProductRow, CatalogColumn>[] = [
  {
    key: 'name',
    label: 'کالا',
    type: 'text',
    sortable: true,
    filter: 'text',
    sticky: 'start',
    mobilePriority: 'primary',
    width: 246,
    tooltip: nameOfRow,
    formatter: (row) => (
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1.25, minWidth: 0 }}>
        <Box
          component="img"
          src={imagePreviewUrl(row.imageUrl ?? '') || '/products/sayman-mark-olive-v1.png'}
          alt=""
          loading="lazy"
          sx={{
            width: 42,
            height: 42,
            objectFit: 'contain',
            flexShrink: 0,
            borderRadius: 2,
            bgcolor: 'var(--surface-soft)',
          }}
        />
        <Box sx={{ minWidth: 0 }}>
          <Typography
            variant="body2"
            sx={{
              fontWeight: 700,
              lineHeight: 1.5,
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 2,
              overflow: 'hidden',
              overflowWrap: 'anywhere',
            }}
          >
            {nameOfRow(row)}
          </Typography>
          <Typography variant="caption" component="div" color="text.secondary" noWrap>
            <bdi>{row.slug}</bdi>
          </Typography>
        </Box>
      </Stack>
    ),
  },
  {
    key: 'category',
    label: 'دسته‌بندی',
    type: 'enum',
    sortable: true,
    filter: 'multiselect',
    mobilePriority: 'secondary',
    width: 148,
    formatter: (row) => row.categoryName,
  },
  {
    key: 'brand',
    label: 'برند',
    type: 'enum',
    sortable: true,
    filter: 'multiselect',
    mobilePriority: 'secondary',
    width: 126,
    formatter: (row) => <bdi>{row.brandName}</bdi>,
  },
  {
    key: 'status',
    label: 'وضعیت',
    type: 'status',
    sortable: true,
    filter: 'multiselect',
    mobilePriority: 'primary',
    width: 133,
    formatter: (row) => (
      <Chip
        size="small"
        variant={statusOf(row) === 'Published' ? 'filled' : 'outlined'}
        color={
          statusOf(row) === 'Published'
            ? 'success'
            : statusOf(row) === 'Draft'
              ? 'info'
              : statusOf(row) === 'Hidden'
                ? 'warning'
                : 'default'
        }
        label={productStatusLabels[statusOf(row)]}
      />
    ),
  },
  {
    key: 'variants',
    label: 'تعداد تنوع',
    type: 'number',
    sortable: true,
    filter: 'numberRange',
    mobilePriority: 'secondary',
    align: 'end',
    width: 122,
    formatter: (row) => (
      <Box component="span" sx={numericStyle}>
        {numberFa.format(row.variantCount)}
      </Box>
    ),
  },
  {
    key: 'price',
    label: productColumnLabels.price,
    type: 'money',
    sortable: true,
    filter: 'numberRange',
    mobilePriority: 'primary',
    align: 'end',
    width: 168,
    formatter: (row) => (
      <Box component="span" sx={numericStyle}>
        {row.minPriceRial === null ? '—' : productToman(row.minPriceRial)}
      </Box>
    ),
  },
  {
    key: 'stock',
    label: 'موجودی آزاد',
    type: 'number',
    sortable: true,
    filter: 'numberRange',
    mobilePriority: 'primary',
    align: 'end',
    width: 132,
    formatter: (row) => {
      const amount = BigInt(row.availableQuantity);
      return amount === 0n ? (
        <Chip size="small" label="ناموجود · ۰" color="error" variant="outlined" />
      ) : amount <= 3n ? (
        <Chip
          size="small"
          label={'کم · ' + numberFa.format(amount)}
          color="warning"
          variant="outlined"
          title="یک تا سه عدد موجودی آزاد"
        />
      ) : (
        <Box component="span" sx={numericStyle}>
          {numberFa.format(amount)}
        </Box>
      );
    },
  },
  {
    key: 'updated',
    label: 'آخرین تغییر',
    type: 'date',
    sortable: true,
    filter: 'dateRange',
    mobilePriority: 'secondary',
    width: 180,
    formatter: (row) => lastChange.format(new Date(row.updatedAt)),
  },
  {
    key: 'actions',
    label: 'عملیات',
    type: 'custom',
    filter: 'none',
    sticky: 'end',
    mobilePriority: 'hidden',
    width: 148,
    formatter: () => null,
  },
];

async function fetchCatalogWorkspace(filters: WorkspaceFilters, signal: AbortSignal) {
  return readWorkspaceProducts(
    await api<unknown>(workspaceProductsPath(filters), { signal }),
    filters,
  );
}

function exportCatalogRows(rows: readonly WorkspaceProductRow[]) {
  const csvCell = (value: string) =>
    '"' + (/^[\s]*[=+@-]/.test(value) ? "'" : '') + value.replace(/"/g, '""') + '"';
  const lines = [
    [
      'شناسه',
      'کالا',
      'دسته‌بندی',
      'برند',
      'وضعیت',
      'تعداد تنوع',
      'قیمت پایه (تومان)',
      'موجودی آزاد',
      'آخرین تغییر',
    ],
    ...rows.map((row) => [
      row.slug,
      nameOfRow(row),
      row.categoryName,
      row.brandName,
      productStatusLabels[statusOf(row)],
      String(row.variantCount),
      row.minPriceRial === null ? '' : productToman(row.minPriceRial),
      row.availableQuantity,
      row.updatedAt,
    ]),
  ];
  const url = URL.createObjectURL(
    new Blob(['\uFEFF' + lines.map((line) => line.map(csvCell).join(',')).join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'sayman-selected-products.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ProductsPage({
  data,
  methods,
  plans,
  writable,
  viewerId,
  onInventory,
}: {
  data: Catalog;
  methods: PurchaseMethod[];
  plans: ChequePlan[];
  writable: boolean;
  viewerId: string;
  onInventory?: () => void;
}) {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(initialWorkspaceFilters);
  const [searchError, setSearchError] = useState('');
  const [editing, setEditing] = useState<string | null | undefined>();
  const [history, setHistory] = useState<{ id: string; name: string } | null>(null);
  const [archive, setArchive] = useState<WorkspaceProductRow | null>(null);
  const [settings, setSettings] = useState(false);
  const [pricing, setPricing] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [view, setView] = useState(() => readCatalogView(viewerId));
  useEffect(() => {
    try {
      localStorage.setItem(
        catalogViewKey(viewerId),
        JSON.stringify({ compact: view.compact, hidden: [...view.hidden] }),
      );
    } catch {
      // Preferences can remain local to the open view when storage is unavailable.
    }
  }, [viewerId, view]);
  const command = useProductCommand(viewerId);
  const labels = useMemo(
    () => ({
      category: new Map(data.categories.map((category) => [category.id, nameOf(category)])),
      brand: new Map(data.brands.map((brand) => [brand.id, brand.name])),
    }),
    [data.categories, data.brands],
  );
  const filterChips = productColumns
    .filter((column) => isProductColumnFiltered(column, filters))
    .map((column) => ({
      key: column,
      label:
        (column === 'price' ? 'قیمت' : productColumnLabels[column]) +
        ': ' +
        productFilterSummary(column, filters, labels),
    }));
  const selectedStatuses = filters.statuses.length
    ? filters.statuses
    : filters.status === 'all'
      ? []
      : [filters.status];
  const statusTab = selectedStatuses.length > 1 ? false : (selectedStatuses[0] ?? 'all');
  function filter(patch: Partial<WorkspaceFilters>) {
    setSelected(new Set());
    setFilters((old) => ({ ...old, ...patch, page: 0 }));
  }
  function selectStatus(status: ProductStatusFilter | 'all') {
    filter({ status: 'all', statuses: status === 'all' ? [] : [status] });
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      const parsed = workspaceFiltersSchema.safeParse({ ...filters, search, page: 0 });
      if (parsed.success) {
        setSearchError('');
        if (parsed.data.search !== filters.search) {
          setSelected(new Set());
          setFilters((old) => ({ ...old, search: parsed.data.search, page: 0 }));
        }
      } else setSearchError('جست‌وجو حداکثر ۱۲۰ نویسه و ۸ واژه است.');
    }, 250);
    return () => clearTimeout(timer);
  }, [search, filters]);
  const query = useQuery({
    queryKey: ['admin', 'product-workspace', filters],
    queryFn: ({ signal }) => fetchCatalogWorkspace(filters, signal),
    placeholderData: (previous) => previous,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const items = query.isPlaceholderData ? [] : (query.data?.items ?? []);
  const total = Math.min(Number.MAX_SAFE_INTEGER, Number(query.data?.totalCount ?? 0));
  const openHistory = (row: WorkspaceProductRow) =>
    setHistory({ id: row.id, name: nameOfRow(row) });
  async function archiveProduct() {
    if (!archive) return;
    try {
      await command.send(
        archive.archived ? 'restore' : 'archive',
        archive.id,
        { productId: archive.id, version: archive.version, restore: archive.archived },
        'archive',
      );
      setArchive(null);
      setSelected(new Set());
    } catch {
      /* Keep the confirmation and its recoverable command. */
    }
  }

  return (
    <Stack
      component="section"
      className="catalog-products"
      data-density={view.compact ? 'compact' : 'comfortable'}
      spacing={2}
      sx={{ minWidth: 0 }}
    >
      <Stack
        direction="row"
        sx={{
          gap: 1.5,
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          bgcolor: 'background.paper',
          border: 1,
          borderColor: 'divider',
          borderRadius: 4,
          p: 1.5,
        }}
      >
        <Typography
          component="h2"
          variant="subtitle1"
          sx={{ fontWeight: 800, display: { xs: 'none', md: 'block' } }}
        >
          کاتالوگ کالا
        </Typography>
        <Stack
          direction="row"
          useFlexGap
          sx={{ gap: 1, flexWrap: 'wrap', '& button': { minHeight: 44 } }}
        >
          {writable && (
            <Button
              startIcon={<Plus size={18} />}
              variant="contained"
              disabled={command.blocked}
              onClick={() => setEditing(null)}
            >
              افزودن کالا
            </Button>
          )}
          {writable && (
            <Button
              startIcon={<Settings2 size={17} />}
              variant="outlined"
              color="info"
              disabled={command.blocked}
              onClick={() => setSettings(true)}
            >
              مدیریت فیلدها
            </Button>
          )}
          {onInventory && (
            <Button
              startIcon={<Warehouse size={17} />}
              variant="outlined"
              color="success"
              onClick={onInventory}
            >
              مدیریت موجودی
            </Button>
          )}
        </Stack>
      </Stack>
      {command.error instanceof Error && <Alert severity="error">{command.error.message}</Alert>}
      {command.attempt?.phase === 'unknown' && (
        <Alert
          severity="warning"
          action={
            <Stack direction="row">
              <Button
                disabled={command.reading}
                onClick={() =>
                  void command.recover().then((result) => {
                    if (result) setArchive(null);
                  })
                }
              >
                بررسی رسید
              </Button>
              <Button
                onClick={() =>
                  void command
                    .retrySame()
                    .then((result) => {
                      if (result) setArchive(null);
                    })
                    .catch(() => {})
                }
              >
                تکرار همان تلاش
              </Button>
            </Stack>
          }
        >
          نتیجهٔ تغییر قبلی نامشخص است؛ پیش از تغییر تازه، رسید را بررسی کنید.
        </Alert>
      )}
      <Box
        sx={{
          bgcolor: 'background.paper',
          border: 1,
          borderColor: 'divider',
          borderRadius: 3,
          minWidth: 0,
        }}
      >
        <Tabs
          value={statusTab}
          onChange={(_, status: ProductStatusFilter | 'all') => selectStatus(status)}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          aria-label="فیلتر سریع وضعیت کالا"
          sx={{ px: 1, '& .MuiTab-root': { minHeight: 48 } }}
        >
          <Tab value="all" label="همهٔ کالاها" />
          {tabs.map((status) => (
            <Tab key={status} value={status} label={productStatusLabels[status]} />
          ))}
        </Tabs>
      </Box>
      <WorkspaceDataTable<WorkspaceProductRow, CatalogColumn>
        label="جدول کالاها"
        itemLabel="کالا"
        columns={catalogColumns}
        items={items}
        getRowId={rowId}
        total={total}
        page={filters.page}
        pageSize={filters.pageSize}
        pageSizes={[25, 50, 100]}
        onPageChange={(page) => {
          setSelected(new Set());
          setFilters((old) => ({ ...old, page }));
        }}
        onPageSizeChange={(size) => {
          if (size === 25 || size === 50 || size === 100) filter({ pageSize: size });
        }}
        search={search}
        onSearchChange={setSearch}
        searchLabel="جست‌وجوی کالا"
        searchPlaceholder="نام، مدل یا SKU"
        searchError={searchError}
        sort={{ key: filters.sort, direction: filters.direction }}
        onSortChange={({ key, direction }) => {
          if (key !== 'actions') filter({ sort: key, direction });
        }}
        filterChips={filterChips}
        onRemoveFilter={(key) => {
          if (key !== 'actions') filter(resetProductColumn[key]);
        }}
        onClearFilters={() => filter(Object.assign({}, ...Object.values(resetProductColumn)))}
        renderFilter={(column, close) =>
          column.key !== 'actions' && (
            <ProductColumnFilter
              key={column.key}
              embedded
              column={column.key}
              filters={filters}
              data={data}
              onApply={(patch) => {
                filter(patch);
                close();
              }}
              onSort={(direction) => {
                if (column.key !== 'actions') filter({ sort: column.key, direction });
                close();
              }}
              onClose={close}
            />
          )
        }
        loading={query.isPending || query.isPlaceholderData}
        error={query.error?.message}
        onRetry={() => void query.refetch()}
        selected={selected}
        onSelectionChange={setSelected}
        renderBulkActions={(ids) => (
          <Button
            size="small"
            startIcon={<Download size={16} />}
            onClick={() => exportCatalogRows(items.filter((row) => ids.has(row.id)))}
          >
            خروجی CSV انتخاب‌شده‌ها
          </Button>
        )}
        hiddenColumns={view.hidden}
        onHiddenColumnsChange={(hidden) => setView((old) => ({ ...old, hidden }))}
        toolbarActions={
          <>
            <Button
              size="small"
              startIcon={<Rows3 size={16} />}
              aria-pressed={view.compact}
              variant={view.compact ? 'contained' : 'text'}
              onClick={() => setView((old) => ({ ...old, compact: !old.compact }))}
            >
              نمای فشرده
            </Button>
            <Button
              size="small"
              startIcon={<RefreshCw size={16} />}
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              تازه‌سازی
            </Button>
          </>
        }
        renderRowActions={(row) =>
          writable && !row.archived ? (
            <Button
              size="small"
              startIcon={<Pencil size={15} />}
              disabled={command.blocked}
              aria-label={'ویرایش ' + nameOfRow(row)}
              onClick={() => setEditing(row.id)}
            >
              ویرایش
            </Button>
          ) : null
        }
        getRowActions={(row) => [
          ...(writable && !row.archived
            ? [
                {
                  key: 'price',
                  label: 'تغییر سریع قیمت',
                  icon: <Banknote size={17} />,
                  disabled: command.blocked,
                  onClick: () => setPricing(row.id),
                },
              ]
            : []),
          {
            key: 'history',
            label: 'تاریخچهٔ قیمت',
            icon: <History size={17} />,
            onClick: () => openHistory(row),
          },
          ...(writable
            ? [
                {
                  key: 'archive',
                  label: row.archived ? 'بازگردانی به پیش‌نویس' : 'بایگانی کالا',
                  icon: row.archived ? <ArchiveRestore size={17} /> : <Archive size={17} />,
                  danger: !row.archived,
                  disabled: command.blocked,
                  onClick: () => setArchive(row),
                },
              ]
            : []),
        ]}
      />
      <Suspense
        fallback={
          <Dialog open maxWidth="sm" aria-label="باز کردن ویرایشگر کالا">
            <DialogContent>
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                <CircularProgress size={22} />
                <span>در حال بازکردن ویرایشگر…</span>
              </Stack>
            </DialogContent>
          </Dialog>
        }
      >
        {editing !== undefined && writable && (
          <WorkspaceEditor
            key={editing ?? 'new'}
            id={editing}
            data={data}
            methods={methods}
            plans={plans}
            viewerId={viewerId}
            onClose={() => setEditing(undefined)}
            onSaved={() => {
              setEditing(undefined);
              void query.refetch();
            }}
          />
        )}
        {pricing && writable && (
          <ProductQuickPrices id={pricing} viewerId={viewerId} onClose={() => setPricing(null)} />
        )}
        {settings && writable && (
          <ProductFormSettings data={data} viewerId={viewerId} onClose={() => setSettings(false)} />
        )}
      </Suspense>
      {history && (
        <Dialog open fullWidth maxWidth="lg" onClose={() => setHistory(null)}>
          <DialogTitle>تاریخچهٔ قیمت کالا</DialogTitle>
          <DialogContent>
            <PriceHistory key={history.id} productId={history.id} productName={history.name} />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setHistory(null)}>بستن</Button>
          </DialogActions>
        </Dialog>
      )}
      {archive && (
        <Dialog
          open
          maxWidth="sm"
          onClose={() => {
            if (!command.blocked) setArchive(null);
          }}
        >
          <DialogTitle>
            {archive.archived ? 'بازگردانی کالا' : 'حذف از فروشگاه و بایگانی'}
          </DialogTitle>
          <DialogContent>
            <Typography>{archive.nameFa}</Typography>
            <Alert severity="info" sx={{ mt: 2 }}>
              {archive.archived
                ? 'کالا به پیش‌نویس برمی‌گردد؛ انتشار دوباره نیاز به ذخیره و بررسی شرایط دارد.'
                : 'کالا از نمایش عمومی حذف می‌شود. سابقهٔ سفارش، قیمت و موجودی نگهداری می‌شود و دریافت/خروج موجودی همچنان از انبار انجام می‌شود.'}
            </Alert>
            {command.error instanceof Error && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {command.error.message}
              </Alert>
            )}
          </DialogContent>
          <DialogActions>
            <Button disabled={command.blocked} onClick={() => setArchive(null)}>
              انصراف
            </Button>
            <Button
              variant="contained"
              color={archive.archived ? 'primary' : 'error'}
              disabled={command.blocked}
              onClick={() => void archiveProduct()}
            >
              {archive.archived ? 'بازگردانی به پیش‌نویس' : 'بایگانی و حذف از نمایش'}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Stack>
  );
}
function WorkspaceEditor({
  id,
  ...props
}: {
  id: string | null;
  data: Catalog;
  methods: PurchaseMethod[];
  plans: ChequePlan[];
  viewerId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const detail = useQuery({
    queryKey: ['admin', 'product-workspace-detail', id],
    queryFn: async ({ signal }) =>
      readWorkspaceDetail(
        await api<unknown>(productWorkspaceBase + '/products/' + id, { signal }),
        id!,
      ),
    enabled: id !== null,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
  if (id !== null && (detail.isPending || detail.error || detail.data?.archived))
    return (
      <Dialog open maxWidth="sm" onClose={props.onClose}>
        <DialogTitle>دریافت جزئیات کالا</DialogTitle>
        <DialogContent>
          {detail.isPending ? (
            <CircularProgress aria-label="دریافت کالا" />
          ) : (
            <Alert severity="error">
              {detail.error?.message ?? 'ابتدا کالا را از بایگانی بازگردانید.'}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={props.onClose}>بازگشت</Button>
          {detail.error && <Button onClick={() => void detail.refetch()}>تلاش دوباره</Button>}
        </DialogActions>
      </Dialog>
    );
  return <ProductEditor {...props} item={detail.data?.product} videos={detail.data?.videos} />;
}
