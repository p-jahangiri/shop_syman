import { useId, useState, type FormEvent } from 'react';
import Box from '@mui/material/Box';
import Autocomplete from '@mui/material/Autocomplete';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import {
  productColumnLabels,
  productDayBoundary,
  productDayInput,
  productStatusLabels,
  type ProductStatusFilter,
  resetProductColumn,
  type ProductColumn,
} from './product-column-filter-model';
import { normalizedDigits, rialToToman, tomanToRial } from './product-editor-model';
import {
  workspaceFiltersSchema,
  type WorkspaceFilters,
} from '../../api/contracts/catalog/product-workspace-contract';
import { PersianDateField } from '../../components/forms/persian-date-field';
import { nameOf, type Catalog } from '../../types/types';

const availability = [
  ['all', 'همهٔ مقادیر'],
  ['available', 'دارای موجودی'],
  ['empty', 'بدون موجودی'],
] as const;

function asCount(value: string) {
  const input = normalizedDigits(value.trim());
  if (!input) return null;
  if (!/^\d{1,19}$/.test(input)) throw new Error('تعداد را با عدد صحیح و غیرمنفی وارد کنید.');
  return BigInt(input).toString();
}
function asPrice(value: string) {
  if (!value.trim()) return null;
  const price = tomanToRial(value);
  if (price === null) throw new Error('قیمت معتبر را به تومان، با حداکثر یک رقم اعشار وارد کنید.');
  return price;
}

export function ProductColumnFilter({
  column,
  filters,
  data,
  onApply,
  onSort,
  onClose,
  embedded = false,
}: {
  column: ProductColumn;
  filters: WorkspaceFilters;
  data: Catalog;
  onApply: (patch: Partial<WorkspaceFilters>) => void;
  onSort: (direction: WorkspaceFilters['direction']) => void;
  onClose: () => void;
  embedded?: boolean;
}) {
  const id = useId();
  const [error, setError] = useState('');
  const [value, setValue] = useState(column === 'name' ? filters.name : filters.availability);
  const [selection, setSelection] = useState<string[]>(
    column === 'category'
      ? filters.categoryIds.length
        ? filters.categoryIds
        : filters.categoryId
          ? [filters.categoryId]
          : []
      : column === 'brand'
        ? filters.brandIds.length
          ? filters.brandIds
          : filters.brandId
            ? [filters.brandId]
            : []
        : filters.statuses.length
          ? filters.statuses
          : filters.status === 'all'
            ? []
            : [filters.status],
  );
  const [min, setMin] = useState(
    column === 'price'
      ? filters.minPriceRial === null
        ? ''
        : rialToToman(filters.minPriceRial)
      : column === 'stock'
        ? (filters.minStock ?? '')
        : column === 'variants'
          ? (filters.minVariants ?? '')
          : productDayInput(filters.updatedFrom),
  );
  const [max, setMax] = useState(
    column === 'price'
      ? filters.maxPriceRial === null
        ? ''
        : rialToToman(filters.maxPriceRial)
      : column === 'stock'
        ? (filters.maxStock ?? '')
        : column === 'variants'
          ? (filters.maxVariants ?? '')
          : productDayInput(filters.updatedBefore, true),
  );
  function apply(event: FormEvent) {
    event.preventDefault();
    try {
      const patch: Partial<WorkspaceFilters> =
        column === 'name'
          ? { name: value.trim() }
          : column === 'category'
            ? { categoryId: null, categoryIds: selection }
            : column === 'brand'
              ? { brandId: null, brandIds: selection }
              : column === 'status'
                ? { status: 'all', statuses: selection as ProductStatusFilter[] }
                : column === 'price'
                  ? { minPriceRial: asPrice(min), maxPriceRial: asPrice(max) }
                  : column === 'stock'
                    ? {
                        availability: value as WorkspaceFilters['availability'],
                        minStock: asCount(min),
                        maxStock: asCount(max),
                      }
                    : column === 'variants'
                      ? { minVariants: asCount(min), maxVariants: asCount(max) }
                      : {
                          updatedFrom: productDayBoundary(min),
                          updatedBefore: productDayBoundary(max, true),
                        };
      if (!workspaceFiltersSchema.safeParse({ ...filters, ...patch, page: 0 }).success)
        throw new Error(
          column === 'name'
            ? 'نام را با حداکثر ۱۲۰ نویسه و ۸ واژه وارد کنید.'
            : 'بازه معتبر نیست؛ مقدار شروع، پایان و حد مجاز را بررسی کنید.',
        );
      onApply(patch);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'فیلتر معتبر نیست.');
    }
  }
  const options: { id: string; label: string }[] =
    column === 'category'
      ? data.categories.map((category) => ({ id: category.id, label: nameOf(category) }))
      : column === 'brand'
        ? data.brands.map((brand) => ({ id: brand.id, label: brand.name }))
        : column === 'status'
          ? Object.entries(productStatusLabels).map(([id, label]) => ({ id, label }))
          : [];
  const multi = column === 'category' || column === 'brand' || column === 'status';
  const range = column === 'price' || column === 'stock' || column === 'variants';
  return (
    <Stack
      component="form"
      aria-labelledby={embedded ? undefined : id}
      aria-label={embedded ? 'شرط ' + productColumnLabels[column] : undefined}
      aria-describedby={error ? id + '-error' : undefined}
      onSubmit={apply}
      spacing={1.5}
      sx={{
        p: embedded ? 0 : { xs: 2, sm: 2.5 },
        width: embedded ? '100%' : { xs: '100%', sm: 'min(390px, calc(100vw - 40px))' },
        boxSizing: 'border-box',
        '& button': { minHeight: 44 },
      }}
    >
      {!embedded && (
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography component="h3" id={id} variant="subtitle1" sx={{ m: 0, fontWeight: 750 }}>
            {productColumnLabels[column]}
          </Typography>
          <Button size="small" onClick={onClose} aria-label="بستن فیلتر ستون">
            <X size={17} />
          </Button>
        </Stack>
      )}
      <Stack direction="row" spacing={0.75} role="group" aria-label="ترتیب نمایش ستون">
        <Button
          size="small"
          variant={
            filters.sort === column && filters.direction === 'asc' ? 'contained' : 'outlined'
          }
          startIcon={<ArrowUp size={14} />}
          aria-pressed={filters.sort === column && filters.direction === 'asc'}
          onClick={() => onSort('asc')}
        >
          صعودی
        </Button>
        <Button
          size="small"
          variant={
            filters.sort === column && filters.direction === 'desc' ? 'contained' : 'outlined'
          }
          startIcon={<ArrowDown size={14} />}
          aria-pressed={filters.sort === column && filters.direction === 'desc'}
          onClick={() => onSort('desc')}
        >
          نزولی
        </Button>
      </Stack>
      {column === 'name' && (
        <TextField
          label="نام شامل…"
          value={value}
          error={Boolean(error)}
          onChange={(event) => {
            setValue(event.target.value);
            setError('');
          }}
          slotProps={{ htmlInput: { maxLength: 120 } }}
        />
      )}
      {multi && (
        <Autocomplete
          multiple
          disableCloseOnSelect
          options={options}
          value={selection.map(
            (id) => options.find((option) => option.id === id) ?? { id, label: id },
          )}
          getOptionLabel={(option) => option.label}
          isOptionEqualToValue={(left, right) => left.id === right.id}
          getOptionKey={(option) => option.id}
          getOptionDisabled={(option) => selection.length >= 32 && !selection.includes(option.id)}
          onChange={(_, selected) => {
            setSelection(selected.map((option) => option.id));
            setError('');
          }}
          noOptionsText="گزینه‌ای پیدا نشد"
          limitTags={3}
          renderInput={(params) => (
            <TextField
              {...params}
              label={productColumnLabels[column]}
              error={Boolean(error)}
              placeholder={selection.length ? '' : 'جست‌وجو و انتخاب چند گزینه'}
            />
          )}
        />
      )}
      {column === 'stock' && (
        <TextField
          select
          label={column === 'stock' ? 'وضعیت موجودی' : productColumnLabels[column]}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}
        >
          {availability.map(([key, label]) => (
            <MenuItem key={key} value={key}>
              {label}
            </MenuItem>
          ))}
        </TextField>
      )}
      {range && (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 1 }}>
          <TextField
            label={column === 'price' ? 'حداقل (تومان)' : 'حداقل تعداد'}
            value={min}
            error={Boolean(error)}
            onChange={(event) => {
              setMin(event.target.value);
              setError('');
            }}
            slotProps={{
              htmlInput: {
                inputMode: column === 'price' ? 'decimal' : 'numeric',
                dir: 'ltr',
                maxLength: 26,
              },
            }}
          />
          <TextField
            label={column === 'price' ? 'حداکثر (تومان)' : 'حداکثر تعداد'}
            value={max}
            error={Boolean(error)}
            onChange={(event) => {
              setMax(event.target.value);
              setError('');
            }}
            slotProps={{
              htmlInput: {
                inputMode: column === 'price' ? 'decimal' : 'numeric',
                dir: 'ltr',
                maxLength: 26,
              },
            }}
          />
        </Box>
      )}
      {column === 'updated' && (
        <>
          <PersianDateField encoding="date" label="از تاریخ" value={min} onChange={setMin} />
          <PersianDateField
            encoding="date"
            label="تا تاریخ (با احتساب همان روز)"
            value={max}
            onChange={setMax}
          />
        </>
      )}
      {error && (
        <Typography id={id + '-error'} variant="body2" color="error" role="alert">
          {error}
        </Typography>
      )}
      <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1 }}>
        <Button size="small" onClick={() => onApply(resetProductColumn[column])}>
          پاک‌کردن این فیلتر
        </Button>
        <Button type="submit" size="small" variant="contained">
          اعمال فیلتر
        </Button>
      </Stack>
    </Stack>
  );
}
