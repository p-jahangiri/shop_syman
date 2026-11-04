import type { WorkspaceFilters } from '../../api/contracts/catalog/product-workspace-contract.ts';
import { rialToToman } from './product-editor-model.ts';
import {
  dateFieldValue,
  dateFieldWire,
  persianCivilDate,
} from '../../utils/persian-date-contract.ts';

export const productColumnLabels = {
  name: 'نام کالا',
  category: 'دسته‌بندی',
  brand: 'برند',
  status: 'وضعیت',
  price: 'قیمت پایه (تومان)',
  stock: 'موجودی آزاد',
  variants: 'تعداد تنوع',
  updated: 'آخرین تغییر',
} satisfies Record<WorkspaceFilters['sort'], string>;
export type ProductColumn = keyof typeof productColumnLabels;
export const productColumns = Object.keys(productColumnLabels) as ProductColumn[];

export const resetProductColumn = {
  name: { name: '' },
  category: { categoryId: null, categoryIds: [] },
  brand: { brandId: null, brandIds: [] },
  status: { status: 'all', statuses: [] },
  price: { minPriceRial: null, maxPriceRial: null },
  stock: { availability: 'all', minStock: null, maxStock: null },
  variants: { minVariants: null, maxVariants: null },
  updated: { updatedFrom: null, updatedBefore: null },
} satisfies Record<ProductColumn, Partial<WorkspaceFilters>>;
export function isProductColumnFiltered(column: ProductColumn, filters: WorkspaceFilters) {
  return Object.entries(resetProductColumn[column]).some(([key, reset]) => {
    const value = filters[key as keyof WorkspaceFilters];
    return Array.isArray(reset) ? Array.isArray(value) && value.length > 0 : value !== reset;
  });
}

// The visible date is local to the operator. Send exact UTC day boundaries;
// adding a calendar day, rather than 24 hours, handles clock changes.
export function productDayBoundary(value: string, nextDay = false) {
  if (!value) return null;
  const date = dateFieldValue(value, 'date');
  if (!date) throw new Error('تاریخ شمسی معتبر وارد کنید.');
  date.setHours(0, 0, 0, 0);
  if (nextDay) date.setDate(date.getDate() + 1);
  const wire = date.toISOString();
  if (wire.startsWith('+') || wire.startsWith('-') || wire.startsWith('0000'))
    throw new Error('تاریخ خارج از محدوده است.');
  return wire;
}
export function productDayInput(instant: string | null, previousDay = false) {
  return instant
    ? dateFieldWire(new Date(Date.parse(instant) - (previousDay ? 1 : 0)), 'date')
    : '';
}

export const productStatusLabels = {
  Published: 'منتشرشده',
  Draft: 'پیش‌نویس',
  Hidden: 'پنهان',
  archived: 'بایگانی‌شده',
} as const;
export type ProductStatusFilter = keyof typeof productStatusLabels;

const digits = (value: string) => value.replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
export function productToman(value: string) {
  const [whole, fraction] = rialToToman(value).split('.');
  return BigInt(whole).toLocaleString('fa-IR') + (fraction ? '٫' + digits(fraction) : '');
}
function bounds(min: string | null, max: string | null, format: (value: string) => string) {
  return [min === null ? '' : 'از ' + format(min), max === null ? '' : 'تا ' + format(max)]
    .filter(Boolean)
    .join(' ');
}
export function productFilterSummary(
  column: ProductColumn,
  filters: WorkspaceFilters,
  labels: { category: ReadonlyMap<string, string>; brand: ReadonlyMap<string, string> },
) {
  switch (column) {
    case 'name':
      return filters.name;
    case 'category':
      return (
        filters.categoryIds.length
          ? filters.categoryIds
          : filters.categoryId
            ? [filters.categoryId]
            : []
      )
        .map((id) => labels.category.get(id) ?? id)
        .join('، ');
    case 'brand':
      return (filters.brandIds.length ? filters.brandIds : filters.brandId ? [filters.brandId] : [])
        .map((id) => labels.brand.get(id) ?? id)
        .join('، ');
    case 'status':
      return (
        filters.statuses.length
          ? filters.statuses
          : filters.status === 'all'
            ? []
            : [filters.status]
      )
        .map((status) => productStatusLabels[status])
        .join('، ');
    case 'price':
      return bounds(filters.minPriceRial, filters.maxPriceRial, productToman) + ' تومان';
    case 'variants':
      return bounds(filters.minVariants, filters.maxVariants, (value) =>
        BigInt(value).toLocaleString('fa-IR'),
      );
    case 'stock':
      return [
        filters.availability === 'all'
          ? ''
          : filters.availability === 'available'
            ? 'دارای موجودی'
            : 'بدون موجودی',
        bounds(filters.minStock, filters.maxStock, (value) =>
          BigInt(value).toLocaleString('fa-IR'),
        ),
      ]
        .filter(Boolean)
        .join('، ');
    case 'updated':
      return bounds(
        filters.updatedFrom ? productDayInput(filters.updatedFrom) : null,
        filters.updatedBefore ? productDayInput(filters.updatedBefore, true) : null,
        persianCivilDate,
      );
  }
}
