# الگوی جدول پنل

[کامپوننت WorkspaceDataTable](../apps/admin/src/components/tables/workspace-data-table.tsx) نمایش و رویدادهای جدول را از دریافت داده جدا می‌کند. کاتالوگ از API زنده استفاده می‌کند. این کامپوننت خودش جست‌وجو، فیلتر، مرتب‌سازی یا صفحه‌بندی را روی ردیف‌های دریافتی اجرا نمی‌کند.

- ستون را با کلید، عنوان، نوع، قابلیت مرتب‌سازی، نوع فیلتر، جایگاه چسبیده، اولویت موبایل، تراز و تابع نمایش تعریف کنید. `tooltip` برای عنوان‌های بلند و `skeleton` برای شکل خاص ستون اختیاری‌اند.
- فیلتر با تابع `renderFilter` به جدول تزریق می‌شود. خود جدول پنجرهٔ سرستون یا پنل پایین موبایل، برچسب فیلترهای اعمال‌شده و رویداد پاک‌کردن را مدیریت می‌کند.
- نمایش صفحهٔ باریک، ستون‌های اصلی را روی کارت و ستون‌های فرعی را در جزئیات می‌آورد. نام/شناسه و عملیات در دسکتاپ می‌توانند به ابتدا و انتهای جدول بچسبند.
- انتخاب ردیف کنترل‌شده است. «انتخاب همه» فقط روی صفحهٔ فعلی اعمال می‌شود. تعیین محدودهٔ نگهداری انتخاب و مجازبودن عملیات گروهی با صفحهٔ مصرف‌کننده است.
- تابع دریافت داده ورودی‌های جست‌وجو، فیلتر، مرتب‌سازی، صفحه و اندازه را یکجا دریافت می‌کند و `items` و `total` را از سرور برمی‌گرداند. کلید مرتب‌سازی را در API با فهرست مجاز اعتبارسنجی کنید. رشته‌های مبلغ یا تعداد بزرگ را پیش از نمایش به `Number` تبدیل نکنید.

نمونهٔ کوتاه برای تعریف ستون‌های انبار:

```tsx
import {
  WorkspaceDataTable,
  type WorkspaceColumn,
} from '../apps/admin/src/components/tables/workspace-data-table';

type InventoryRow = {
  id: string;
  sku: string;
  warehouse: string;
  available: string;
  reserved: string;
};
type InventoryColumn = 'sku' | 'warehouse' | 'available' | 'reserved';
const fa = new Intl.NumberFormat('fa-IR');
const inventoryColumns: WorkspaceColumn<InventoryRow, InventoryColumn>[] = [
  {
    key: 'sku', label: 'SKU', type: 'text', sortable: true, filter: 'text',
    sticky: 'start', mobilePriority: 'primary',
    formatter: (row) => <bdi>{row.sku}</bdi>, tooltip: (row) => row.sku,
  },
  {
    key: 'warehouse', label: 'انبار', type: 'enum', sortable: true,
    filter: 'multiselect', mobilePriority: 'secondary', formatter: (row) => row.warehouse,
  },
  {
    key: 'available', label: 'موجودی آزاد', type: 'number', sortable: true,
    filter: 'numberRange', mobilePriority: 'primary',
    formatter: (row) => fa.format(BigInt(row.available)),
  },
  {
    key: 'reserved', label: 'رزروشده', type: 'number', sortable: true,
    filter: 'numberRange', mobilePriority: 'secondary',
    formatter: (row) => fa.format(BigInt(row.reserved)),
  },
];

// در صفحهٔ مصرف‌کننده، تغییر کنترل‌ها query را به‌روز می‌کند.
// fetchInventory(query, signal) پاسخ { items, total, page, pageSize } را می‌گیرد.
<WorkspaceDataTable
  label="جدول انبار"
  columns={inventoryColumns}
  items={result.items}
  total={result.total}
  page={query.page}
  pageSize={query.pageSize}
  getRowId={(row) => row.id}
  search={query.search}
  onSearchChange={(search) => update({ search, page: 0 })}
  sort={query.sort}
  onSortChange={(sort) => update({ sort, page: 0 })}
  onPageChange={(page) => update({ page })}
  onPageSizeChange={(pageSize) => update({ pageSize, page: 0 })}
  renderFilter={renderInventoryFilter}
  filterChips={appliedInventoryFilters}
  onRemoveFilter={removeInventoryFilter}
  onClearFilters={() => update({ filters: {}, page: 0 })}
/>;
```
