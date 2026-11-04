import { useMemo, useState, type KeyboardEvent } from 'react';
import { DataGrid, type GridColDef, type GridRowSelectionModel } from '@mui/x-data-grid';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import MenuItem from '@mui/material/MenuItem';
import { Plus, Copy, SlidersHorizontal, Trash2, WandSparkles } from 'lucide-react';
import { FieldHelp } from '../../components/forms/field-help';
import { normalizePersian } from '@sayman/web-shared/lib/shared/commerce.ts';
import { adminStyleNonce } from '../../app/admin-style-nonce';
import { ProductTextField } from './product-editor-fields';
import {
  blankProductVariant,
  normalizedDigits,
  tomanToRial,
  rialToToman,
  moneyLabel,
  type ProductFieldErrors,
  type ProductVariantDraft,
} from './product-editor-model';
import type { FormFieldsConfiguration } from '../../api/contracts/catalog/product-workspace-contract';
import '../../styles/catalog/product-price-workspace.css';
interface Row extends ProductVariantDraft {
  errors: ProductFieldErrors;
}
function copyVariant(rows: ProductVariantDraft[], key: string): ProductVariantDraft[] {
  const source = rows.find((row) => row.key === key);
  return source && rows.length < 500
    ? [
        ...rows,
        {
          ...source,
          key: crypto.randomUUID(),
          id: undefined,
          version: undefined,
          sku: '',
          attributes: source.attributes.map((attribute) => ({ ...attribute })),
        },
      ]
    : rows;
}
function compareAmounts(left: string, right: string) {
  const a = tomanToRial(left);
  const b = tomanToRial(right);
  if (a === null || b === null) return a === b ? 0 : a === null ? -1 : 1;
  const x = BigInt(a),
    y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
function rowHeight() {
  return 'auto' as const;
}
function keepEditingKeysInField(event: KeyboardEvent) {
  // The grid otherwise consumes Select All and movement keys before the input can use them.
  if (event.key !== 'Tab' && event.key !== 'Enter' && event.key !== 'Escape') {
    event.stopPropagation();
  }
}
const formatCount = new Intl.NumberFormat('fa-IR').format;
const pageSizes = [10, 25, 50, 100].map((value) => ({ value, label: formatCount(value) }));
export function ProductVariantsTable({
  rows,
  errors,
  fields,
  disabled,
  onChange,
  onEdit,
  onGenerate,
  pricingOnly = false,
  active = true,
}: {
  rows: ProductVariantDraft[];
  errors: ProductFieldErrors;
  fields: FormFieldsConfiguration['fields'];
  disabled: boolean;
  onChange: (transform: (old: ProductVariantDraft[]) => ProductVariantDraft[]) => void;
  onEdit: (key: string) => void;
  onGenerate: () => void;
  pricingOnly?: boolean;
  active?: boolean;
}) {
  const compact = useMediaQuery('(max-width:760px)');
  const [cardPage, setCardPage] = useState(0);
  const [selection, setSelection] = useState<GridRowSelectionModel>({
    type: 'include',
    ids: new Set(),
  });
  const [bulk, setBulk] = useState(''),
    [operation, setOperation] = useState<'set' | 'add' | 'percent'>('set'),
    [bulkError, setBulkError] = useState('');
  const [preview, setPreview] = useState<{ key: string; before: string; after: string }[] | null>(
    null,
  );
  const [search, setSearch] = useState('');
  const hasFieldErrors = Object.keys(errors).some((path) => path.startsWith('variants.'));
  const term = pricingOnly || hasFieldErrors ? '' : normalizePersian(search);
  const visibleRows = useMemo(
    () =>
      rows
        .filter((row) =>
          normalizePersian(row.sku + ' ' + row.labelFa + ' ' + row.colorNameFa).includes(term),
        )
        .map((row) => ({
          ...row,
          errors: Object.fromEntries(
            Object.entries(errors)
              .filter(([path]) => path.startsWith('variants.' + row.key + '.'))
              .map(([path, message]) => [
                path.slice(('variants.' + row.key + '.').length),
                message,
              ]),
          ),
        })),
    [rows, errors, term],
  );
  const selected = rows.filter((row) =>
    selection.type === 'include' ? selection.ids.has(row.key) : !selection.ids.has(row.key),
  );
  function bulkPreview() {
    setBulkError('');
    if (!selected.length) {
      setBulkError('ابتدا ردیف‌های موردنظر را انتخاب کنید.');
      return;
    }
    const percent = normalizedDigits(bulk).trim();
    const value =
      operation === 'percent'
        ? /^[+-]?\d{1,4}$/.test(percent)
          ? Number(percent)
          : NaN
        : tomanToRial(operation === 'add' ? bulk.trim().replace(/^[-+]/, '') : bulk);
    if (
      value === null ||
      (operation === 'percent' &&
        (!Number.isInteger(value) || Number(value) < -100 || Number(value) > 1000))
    ) {
      setBulkError('مبلغ معتبر یا درصد صحیح بین منفی ۱۰۰ و ۱٬۰۰۰ وارد کنید.');
      return;
    }
    const sign = bulk.trim().startsWith('-') ? -1n : 1n;
    const changes: { key: string; before: string; after: string }[] = [];
    for (const row of selected) {
      const before = tomanToRial(row.price);
      if (before === null) {
        setBulkError('ابتدا قیمت نامعتبر ردیف‌های انتخابی را اصلاح کنید.');
        return;
      }
      const after =
        operation === 'set'
          ? BigInt(String(value))
          : operation === 'add'
            ? BigInt(before) + BigInt(String(value)) * sign
            : (BigInt(before) * (100n + BigInt(String(value)))) / 100n;
      if (after < 0n || after > 9223372036854775807n) {
        setBulkError('نتیجهٔ یکی از قیمت‌ها خارج از محدوده است.');
        return;
      }
      changes.push({ key: row.key, before: row.price, after: rialToToman(after.toString()) });
    }
    setPreview(changes);
  }
  const full = rows.length >= 500,
    hasReference = rows.some((row) => row.referencePrice.trim());
  const columns = useMemo<GridColDef<Row>[]>(() => {
    const description = (key: string) => fields.find((f) => f.key === key)?.help ?? '';
    const heading = (key: string, label: string) => (
      <Stack direction="row" sx={{ alignItems: 'center' }}>
        {label}
        <FieldHelp label={label} description={description(key)} />
      </Stack>
    );
    function update(key: string, patch: Partial<ProductVariantDraft>) {
      onChange((old) => old.map((v) => (v.key === key ? { ...v, ...patch } : v)));
    }
    const result: GridColDef<Row>[] = [
      {
        field: 'sku',
        headerName: 'کد تنوع',
        ...(pricingOnly ? { flex: 1, minWidth: 148 } : { width: 177 }),
        renderHeader: () => heading('sku', 'کد تنوع / SKU'),
        renderCell: (p) =>
          pricingOnly ? (
            <bdi className="variant-grid-sku">{p.row.sku || '—'}</bdi>
          ) : (
            <Box data-field-path={'variants.' + p.row.key + '.sku'} className="variant-grid-input">
              <TextField
                disabled={disabled}
                variant="outlined"
                value={p.row.sku}
                onKeyDown={keepEditingKeysInField}
                error={Boolean(p.row.errors.sku)}
                helperText={p.row.errors.sku}
                onChange={(e) => update(p.row.key, { sku: e.target.value })}
                slotProps={{
                  htmlInput: {
                    'aria-label': 'کد تنوع ' + (p.row.labelFa || p.row.key),
                    dir: 'ltr',
                    maxLength: 80,
                  },
                }}
              />
            </Box>
          ),
      },
      {
        field: 'labelFa',
        headerName: 'رنگ و ویژگی‌ها',
        ...(pricingOnly ? { flex: 1.35, minWidth: 165 } : { width: 190 }),
        renderCell: (p) =>
          pricingOnly ? (
            <Stack direction="row" className="variant-grid-identity">
              <Box
                component="span"
                aria-hidden="true"
                className="variant-grid-swatch"
                sx={{ bgcolor: p.row.color }}
              />
              <Typography variant="body2">
                {p.row.labelFa || p.row.colorNameFa || 'تنوع پیش‌فرض'}
              </Typography>
            </Stack>
          ) : (
            <Button
              disabled={disabled}
              onClick={() => onEdit(p.row.key)}
              sx={{
                whiteSpace: 'normal',
                textAlign: 'start',
                justifyContent: 'flex-start',
                lineHeight: 1.8,
              }}
            >
              <Box
                component="span"
                sx={{
                  width: 14,
                  height: 14,
                  bgcolor: p.row.color,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                  flexShrink: 0,
                  mr: 1,
                }}
              />
              {p.row.labelFa || p.row.colorNameFa || 'تنوع پیش‌فرض'}
            </Button>
          ),
      },
      {
        field: 'price',
        headerName: 'قیمت فروش (تومان)',
        ...(pricingOnly ? { flex: 1, minWidth: 156 } : { width: 182 }),
        sortComparator: compareAmounts,
        renderHeader: () => heading('price', 'قیمت فروش · تومان'),
        renderCell: (p) => (
          <Box
            data-field-path={'variants.' + p.row.key + '.price'}
            className="variant-grid-input variant-grid-money"
          >
            <TextField
              disabled={disabled}
              value={p.row.price}
              onKeyDown={keepEditingKeysInField}
              error={Boolean(p.row.errors.price)}
              helperText={p.row.errors.price}
              onChange={(e) => update(p.row.key, { price: e.target.value })}
              slotProps={{
                htmlInput: {
                  'aria-label': 'قیمت فروش ' + p.row.sku,
                  inputMode: 'decimal',
                  dir: 'ltr',
                },
              }}
            />
          </Box>
        ),
      },
      {
        field: 'referencePrice',
        headerName: 'پیش از تخفیف (تومان)',
        ...(pricingOnly ? { flex: 1, minWidth: 174 } : { width: 182 }),
        sortComparator: compareAmounts,
        renderHeader: () => heading('discount', 'پیش از تخفیف · تومان'),
        renderCell: (p) => (
          <Box
            data-field-path={'variants.' + p.row.key + '.referencePrice'}
            className="variant-grid-input variant-grid-money"
          >
            <TextField
              disabled={disabled}
              value={p.row.referencePrice}
              onKeyDown={keepEditingKeysInField}
              placeholder="بدون تخفیف"
              error={Boolean(p.row.errors.referencePrice)}
              helperText={p.row.errors.referencePrice}
              onChange={(e) => update(p.row.key, { referencePrice: e.target.value })}
              slotProps={{
                htmlInput: {
                  'aria-label': 'قیمت پیش از تخفیف ' + p.row.sku,
                  inputMode: 'decimal',
                  dir: 'ltr',
                },
              }}
            />
          </Box>
        ),
      },
      {
        field: 'warrantyFa',
        headerName: 'گارانتی',
        width: 150,
        renderCell: (p) => (
          <Tooltip title={p.row.warrantyFa || 'تعیین نشده'}>
            <Button
              disabled={disabled || pricingOnly}
              onClick={() => onEdit(p.row.key)}
              sx={{
                display: 'block',
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {p.row.warrantyFa || 'تعیین گارانتی'}
            </Button>
          </Tooltip>
        ),
      },
      {
        field: 'isActive',
        headerName: 'نمایش',
        width: 90,
        renderCell: (p) => (
          <Checkbox
            disabled={disabled}
            checked={p.row.isActive}
            onChange={(e) => update(p.row.key, { isActive: e.target.checked })}
            slotProps={{ input: { 'aria-label': 'نمایش تنوع ' + p.row.sku } }}
          />
        ),
      },
      {
        field: 'actions',
        headerName: 'عملیات',
        width: 130,
        sortable: false,
        filterable: false,
        disableColumnMenu: true,
        renderCell: (p) => (
          <Stack direction="row">
            <Tooltip title="ویژگی‌ها، رنگ، گارانتی و روش خرید">
              <IconButton
                disabled={disabled}
                aria-label={'جزئیات تنوع ' + p.row.sku}
                onClick={() => onEdit(p.row.key)}
              >
                <SlidersHorizontal size={18} />
              </IconButton>
            </Tooltip>
            <Tooltip title="کپی به تنوع جدید">
              <IconButton
                disabled={disabled || full}
                aria-label={'کپی تنوع ' + p.row.sku}
                onClick={() => onChange((old) => copyVariant(old, p.row.key))}
              >
                <Copy size={17} />
              </IconButton>
            </Tooltip>
            {!p.row.id && (
              <Tooltip title="حذف ردیف جدید">
                <IconButton
                  disabled={disabled}
                  aria-label={'حذف ردیف ' + p.row.sku}
                  onClick={() => onChange((old) => old.filter((v) => v.key !== p.row.key))}
                >
                  <Trash2 size={17} />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        ),
      },
    ];
    const keys: Record<string, string> = {
      sku: 'sku',
      labelFa: 'axes',
      price: 'price',
      referencePrice: 'discount',
      warrantyFa: 'warranty',
    };
    const configured = result
      .filter((column) => {
        if (pricingOnly && ['actions', 'warrantyFa', 'isActive'].includes(column.field))
          return false;
        const config = fields.find((f) => f.key === keys[column.field]);
        return !config || config.visible || (column.field === 'referencePrice' && hasReference);
      })
      .map((column) => {
        const config = fields.find((f) => f.key === keys[column.field]);
        return config
          ? {
              ...column,
              headerName:
                config.label +
                (column.field === 'price' || column.field === 'referencePrice' ? ' · تومان' : ''),
              renderHeader: () => heading(config.key, config.label),
            }
          : column;
      });
    return configured.sort(
      (a, b) =>
        (fields.find((f) => f.key === keys[a.field])?.sortOrder ?? 1001) -
        (fields.find((f) => f.key === keys[b.field])?.sortOrder ?? 1001),
    );
  }, [fields, disabled, onChange, onEdit, pricingOnly, full, hasReference]);
  const pageSize = 8;
  const lastCardPage = Math.max(0, Math.ceil(visibleRows.length / pageSize) - 1);
  const page = Math.min(cardPage, lastCardPage);
  const firstInvalidIndex = visibleRows.findIndex((row) => Object.keys(row.errors).length > 0);
  const configOf = (key: string) => fields.find((f) => f.key === key);
  function changeRow(key: string, patch: Partial<ProductVariantDraft>) {
    onChange((old) => old.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }
  function toggleRow(key: string) {
    setSelection((old) => {
      const ids = new Set(old.ids);
      if (ids.has(key)) ids.delete(key);
      else ids.add(key);
      return { ...old, ids };
    });
    setPreview(null);
  }
  return (
    <Stack spacing={1.75} data-field-path="variants" className="variant-workspace">
      {!pricingOnly && (
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Button
            variant="contained"
            startIcon={<WandSparkles size={17} />}
            disabled={disabled}
            onClick={() => {
              setSearch('');
              onGenerate();
            }}
          >
            ساخت ترکیب رنگ و ویژگی
          </Button>
          <Button
            variant="outlined"
            startIcon={<Plus size={17} />}
            disabled={disabled || full}
            onClick={() => {
              setSearch('');
              if (compact) setCardPage(Math.floor(rows.length / pageSize));
              onChange((old) =>
                old.length < 500 ? [...old, blankProductVariant(crypto.randomUUID())] : old,
              );
            }}
          >
            افزودن یک تنوع
          </Button>
        </Stack>
      )}
      {errors.variants && <Alert severity="error">{errors.variants}</Alert>}
      {pricingOnly && firstInvalidIndex >= 0 && (
        <Alert
          severity="error"
          action={
            compact ? (
              <Button
                size="small"
                onClick={() => setCardPage(Math.floor(firstInvalidIndex / pageSize))}
              >
                نمایش اولین خطا
              </Button>
            ) : undefined
          }
        >
          ابتدا قیمت‌های مشخص‌شده را اصلاح کنید.
        </Alert>
      )}
      <div className="variant-workspace-caption">
        <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Chip
            size="small"
            color="info"
            variant="outlined"
            label={formatCount(rows.length) + ' تنوع'}
          />
          {!pricingOnly && (
            <Chip
              size="small"
              color="success"
              variant="outlined"
              label={formatCount(rows.filter((row) => row.isActive).length) + ' فعال'}
            />
          )}
        </Stack>
        <Typography variant="body2" color="text.secondary">
          قیمت‌ها به تومان‌اند. برای تغییر گروهی، تنوع‌ها را انتخاب کنید.
          {!pricingOnly && ' موجودی در انبار مدیریت می‌شود.'}
        </Typography>
      </div>
      {!pricingOnly && rows.length > 0 && (
        <TextField
          label="جست‌وجوی تنوع، رنگ یا SKU"
          value={search}
          disabled={hasFieldErrors}
          helperText={
            hasFieldErrors ? 'برای اصلاح خطاها، همهٔ تنوع‌ها نمایش داده شده‌اند.' : undefined
          }
          onChange={(event) => {
            setSearch(event.target.value);
            setCardPage(0);
            setSelection({ type: 'include', ids: new Set() });
            setPreview(null);
            setBulkError('');
          }}
          slotProps={{ htmlInput: { type: 'search', maxLength: 100 } }}
        />
      )}
      {active &&
        (rows.length === 0 ? (
          <Box
            sx={{
              p: 3,
              textAlign: 'center',
              border: '1px dashed',
              borderColor: 'divider',
              borderRadius: 2,
              bgcolor: 'var(--surface-soft)',
            }}
          >
            <Typography sx={{ fontWeight: 750 }}>هنوز تنوعی اضافه نشده</Typography>
            {!pricingOnly && (
              <Typography variant="body2" color="text.secondary">
                برای یک رنگ یا ظرفیت، یک تنوع اضافه کنید؛ برای چند ترکیب، از ترکیب‌ساز استفاده کنید.
              </Typography>
            )}
          </Box>
        ) : visibleRows.length === 0 ? (
          <Alert severity="info">تنوعی با این عبارت پیدا نشد.</Alert>
        ) : compact ? (
          <Stack spacing={1.25}>
            {visibleRows.slice(page * pageSize, (page + 1) * pageSize).map((row) => {
              const checked =
                selection.type === 'include'
                  ? selection.ids.has(row.key)
                  : !selection.ids.has(row.key);
              const name = row.labelFa || row.colorNameFa || 'تنوع جدید';
              const root = 'variants.' + row.key + '.';
              return (
                <Box
                  key={row.key}
                  component="article"
                  className="variant-workspace-card"
                  sx={{
                    p: 1.5,
                    border: '1px solid',
                    borderColor: Object.keys(row.errors).length
                      ? 'error.main'
                      : checked
                        ? 'primary.main'
                        : 'divider',
                    borderRadius: 2.5,
                    minWidth: 0,
                    bgcolor: checked ? 'action.selected' : 'background.paper',
                  }}
                >
                  <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 1 }}>
                    <Checkbox
                      size="small"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleRow(row.key)}
                      slotProps={{ input: { 'aria-label': 'انتخاب ' + (row.sku || name) } }}
                      sx={{ width: 44, height: 44, flexShrink: 0 }}
                    />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography
                        variant="body2"
                        sx={{ fontWeight: 750, overflowWrap: 'anywhere' }}
                      >
                        {name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {row.sku ? (
                          <bdi className="variant-grid-sku">{row.sku}</bdi>
                        ) : (
                          'بدون کد تنوع'
                        )}
                      </Typography>
                    </Box>
                    {!pricingOnly && (
                      <Button size="small" disabled={disabled} onClick={() => onEdit(row.key)}>
                        جزئیات
                      </Button>
                    )}
                    {!pricingOnly && (
                      <IconButton
                        size="small"
                        disabled={disabled || full}
                        aria-label={'کپی تنوع ' + (row.sku || name)}
                        onClick={() => {
                          setCardPage(Math.floor(rows.length / pageSize));
                          onChange((old) => copyVariant(old, row.key));
                        }}
                      >
                        <Copy size={17} />
                      </IconButton>
                    )}
                    {!pricingOnly && !row.id && (
                      <IconButton
                        size="small"
                        disabled={disabled}
                        aria-label={'حذف ردیف ' + (row.sku || name)}
                        onClick={() =>
                          onChange((old) => old.filter((entry) => entry.key !== row.key))
                        }
                      >
                        <Trash2 size={17} />
                      </IconButton>
                    )}
                  </Stack>
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,150px),1fr))',
                      gap: 1.5,
                    }}
                  >
                    {!pricingOnly && (
                      <ProductTextField
                        label={configOf('sku')?.label || 'کد تنوع'}
                        path={root + 'sku'}
                        value={row.sku}
                        error={row.errors.sku}
                        disabled={disabled}
                        onChange={(e) => changeRow(row.key, { sku: e.target.value })}
                        slotProps={{ htmlInput: { dir: 'ltr', maxLength: 80 } }}
                      />
                    )}
                    <ProductTextField
                      label={(configOf('price')?.label || 'قیمت فروش') + ' (تومان)'}
                      path={root + 'price'}
                      value={row.price}
                      error={row.errors.price}
                      disabled={disabled}
                      onChange={(e) => changeRow(row.key, { price: e.target.value })}
                      slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'decimal' } }}
                    />
                    {(configOf('discount')?.visible !== false ||
                      Boolean(row.referencePrice) ||
                      Boolean(row.errors.referencePrice)) && (
                      <ProductTextField
                        label={(configOf('discount')?.label || 'پیش از تخفیف') + ' (تومان)'}
                        path={root + 'referencePrice'}
                        value={row.referencePrice}
                        error={row.errors.referencePrice}
                        disabled={disabled}
                        placeholder="بدون تخفیف"
                        onChange={(e) => changeRow(row.key, { referencePrice: e.target.value })}
                        slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'decimal' } }}
                      />
                    )}
                  </Box>
                </Box>
              );
            })}
            {lastCardPage > 0 && (
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Button size="small" disabled={page === 0} onClick={() => setCardPage(page - 1)}>
                  قبلی
                </Button>
                <Typography variant="caption">
                  صفحهٔ {(page + 1).toLocaleString('fa-IR')} از{' '}
                  {(lastCardPage + 1).toLocaleString('fa-IR')}
                </Typography>
                <Button
                  size="small"
                  disabled={page === lastCardPage}
                  onClick={() => setCardPage(page + 1)}
                >
                  بعدی
                </Button>
              </Stack>
            )}
          </Stack>
        ) : (
          <Box className="variant-grid-frame">
            <DataGrid
              nonce={adminStyleNonce()}
              rows={visibleRows}
              getRowId={(row) => row.key}
              columns={columns}
              aria-label="جدول تنوع‌ها و قیمت‌ها"
              columnHeaderHeight={52}
              localeText={{
                checkboxSelectionSelectAllRows: 'انتخاب همهٔ تنوع‌ها',
                checkboxSelectionUnselectAllRows: 'لغو انتخاب همهٔ تنوع‌ها',
                checkboxSelectionSelectRow: 'انتخاب تنوع',
                checkboxSelectionUnselectRow: 'لغو انتخاب تنوع',
                paginationRowsPerPage: 'ردیف در هر صفحه',
                paginationItemAriaLabel: (type) =>
                  ({
                    first: 'صفحهٔ اول',
                    last: 'صفحهٔ آخر',
                    previous: 'صفحهٔ قبلی',
                    next: 'صفحهٔ بعدی',
                  })[type],
                paginationDisplayedRows: ({ from, to, count }) =>
                  count === 0
                    ? '۰ تنوع'
                    : from.toLocaleString('fa-IR') +
                      ' تا ' +
                      to.toLocaleString('fa-IR') +
                      ' از ' +
                      count.toLocaleString('fa-IR'),
              }}
              checkboxSelection
              disableRowSelectionExcludeModel
              disableRowSelectionOnClick
              disableColumnFilter
              getRowHeight={rowHeight}
              rowSelectionModel={selection}
              onRowSelectionModelChange={(next) => {
                setSelection(next);
                setPreview(null);
              }}
              isRowSelectable={() => !disabled}
              pageSizeOptions={pageSizes}
              initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
              hideFooterSelectedRowCount
              hideFooter={rows.length <= 10}
            />
          </Box>
        ))}
      {selected.length > 0 && (
        <Box className="variant-bulk-prices">
          <Stack spacing={2}>
            <Typography variant="subtitle2">
              تغییر قیمت {selected.length.toLocaleString('fa-IR')} تنوع انتخاب‌شده
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr auto' },
                gap: 2,
                alignItems: 'end',
              }}
            >
              <ProductTextField
                label="نوع تغییر"
                path="variants.bulk.kind"
                select
                value={operation}
                onChange={(e) => {
                  setOperation(e.target.value as typeof operation);
                  setPreview(null);
                }}
                disabled={disabled}
              >
                <MenuItem value="set">قیمت یکسان</MenuItem>
                <MenuItem value="add">افزایش / کاهش مبلغ</MenuItem>
                <MenuItem value="percent">افزایش / کاهش درصدی</MenuItem>
              </ProductTextField>
              <ProductTextField
                label={operation === 'percent' ? 'درصد (مثلاً ۱۰ یا ‎−۱۰)' : 'مبلغ به تومان'}
                help={
                  operation === 'percent'
                    ? 'درصد صحیح؛ حاصل تا ریال صحیح رو به پایین گرد می‌شود و پیش از اعمال نمایش داده می‌شود.'
                    : 'برای کاهش مبلغ علامت منفی وارد کنید.'
                }
                path="variants.bulk.value"
                value={bulk}
                disabled={disabled}
                onChange={(e) => {
                  setBulk(e.target.value);
                  setPreview(null);
                }}
              />
              <Button disabled={disabled} variant="outlined" onClick={bulkPreview}>
                پیش‌نمایش
              </Button>
            </Box>
            {bulkError && <Alert severity="error">{bulkError}</Alert>}
            {preview && (
              <Alert
                severity="info"
                action={
                  <Button
                    disabled={disabled}
                    onClick={() => {
                      if (
                        preview.some(
                          (item) => rows.find((row) => row.key === item.key)?.price !== item.before,
                        )
                      ) {
                        setBulkError(
                          'قیمت‌ها پس از پیش‌نمایش تغییر کرده‌اند؛ دوباره پیش‌نمایش بگیرید.',
                        );
                        setPreview(null);
                        return;
                      }
                      const changes = new Map(preview.map((r) => [r.key, r.after]));
                      onChange((old) =>
                        old.map((row) =>
                          changes.has(row.key) ? { ...row, price: changes.get(row.key)! } : row,
                        ),
                      );
                      setPreview(null);
                    }}
                  >
                    اعمال در فرم
                  </Button>
                }
              >
                {preview.slice(0, 3).map((r) => (
                  <Box key={r.key}>
                    <bdi>
                      {moneyLabel(tomanToRial(r.before))} ← {moneyLabel(tomanToRial(r.after))}
                    </bdi>
                  </Box>
                ))}
                {preview.length > 3
                  ? ' و ' + (preview.length - 3).toLocaleString('fa-IR') + ' ردیف دیگر'
                  : ''}{' '}
                · قیمت مرجع هر ردیف جدا بررسی می‌شود؛ ذخیرهٔ نهایی هنوز لازم است.
              </Alert>
            )}
          </Stack>
        </Box>
      )}
    </Stack>
  );
}
