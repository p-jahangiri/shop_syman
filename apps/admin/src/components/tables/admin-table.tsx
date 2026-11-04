import { cloneElement, useId, useMemo, useState, type TableHTMLAttributes } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  SlidersHorizontal,
  ListFilter,
  Search,
  X,
  RotateCcw,
  Info,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { TableMenu } from './admin-table-menu';
import { TableColumnFilter } from './admin-table-column-filter';
import { compareAdminListValues } from '../../utils/admin-list-text';
import {
  readTableMarkup,
  sortableTableHeader,
  tableCellMatches,
  tableCellText,
  tableCellValue,
  type TableRecord,
  type TableFilter,
} from './admin-table-model';

type TableProps = TableHTMLAttributes<HTMLTableElement> & {
  pageable?: boolean;
  searchable?: boolean;
};
export function AdminTable({
  children,
  pageable = false,
  searchable = true,
  ...props
}: TableProps) {
  const model = useMemo(() => readTableMarkup(children), [children]);
  return model ? (
    <RecordTable {...props} model={model} pageable={pageable} searchable={searchable} />
  ) : (
    <table {...props}>{children}</table>
  );
}

function RecordTable({
  model,
  pageable,
  searchable,
  ...props
}: TableProps & {
  model: NonNullable<ReturnType<typeof readTableMarkup>>;
}) {
  const id = useId();
  const [search, setSearch] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [compact, setCompact] = useState(false);
  const columns = useMemo<ColumnDef<TableRecord>[]>(
    () =>
      model.headers.map((header, index) => ({
        id: String(index),
        header: () => header.props.children,
        accessorFn: (row) => tableCellValue(row.cells[index]),
        cell: ({ row }) => row.original.cells[index].props.children,
        enableSorting: sortableTableHeader(header),
        enableHiding: sortableTableHeader(header),
        enableColumnFilter: sortableTableHeader(header),
        filterFn: (row, _column, value: TableFilter) =>
          tableCellMatches(row.original.cells[index], value),
        sortingFn: (left, right, column) =>
          compareAdminListValues(left.getValue(column), right.getValue(column)),
      })),
    [model.headers],
  );
  const table = useReactTable({
    data: model.rows,
    columns,
    state: { globalFilter: search, sorting, columnFilters, columnVisibility },
    onGlobalFilterChange: setSearch,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    getRowId: (row) => row.id,
    globalFilterFn: (row, _column, value: string) => {
      const words = value.trim().split(/\s+/).filter(Boolean);
      return words.every((word) =>
        row.original.cells.some(
          (cell, index) =>
            sortableTableHeader(model.headers[index]) && tableCellMatches(cell, word),
        ),
      );
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: pageable ? getPaginationRowModel() : undefined,
    initialState: { pagination: { pageSize: 10 } },
  });
  const rows = table.getRowModel().rows;
  const label =
    props['aria-label'] ??
    model.headers.map((header) => tableCellText(header.props.children)).join('، ');
  const filtered = !!search || columnFilters.length > 0;
  const count = table.getFilteredRowModel().rows.length;
  const modified =
    filtered ||
    sorting.length > 0 ||
    compact ||
    Object.values(columnVisibility).some((visible) => !visible);
  function reset() {
    setSearch('');
    setColumnFilters([]);
    setSorting([]);
    setColumnVisibility({});
    setCompact(false);
  }
  return (
    <div className={'admin-record-grid record-grid-v2' + (compact ? ' is-compact' : '')}>
      <div className="admin-record-toolbar">
        <div className="record-toolbar-main">
          {searchable ? (
            <label className="admin-record-search" htmlFor={id}>
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">جست‌وجوی زنده در ردیف‌های همین جدول</span>
              <input
                id={id}
                name={id}
                type="search"
                placeholder="جست‌وجو در جدول…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          ) : (
            <span className="record-result-summary" role="status">
              <strong>{count.toLocaleString('fa-IR')}</strong> ردیف در این بخش
            </span>
          )}
        </div>
        <div className="admin-record-tools">
          <TableMenu
            label="فیلتر ستون‌ها"
            icon={<ListFilter size={16} aria-hidden="true" />}
            badge={columnFilters.length}
          >
            <div className="record-menu-heading">
              <strong>محدودکردن ردیف‌ها</strong>
              <span>در همین بخش از فهرست</span>
            </div>
            <div className="record-filter-fields">
              {table
                .getAllLeafColumns()
                .map(
                  (column, index) =>
                    column.getCanFilter() && (
                      <TableColumnFilter
                        key={column.id}
                        column={column}
                        label={tableCellText(model.headers[index].props.children)}
                        rows={model.rows}
                        index={index}
                        name={id + '-filter-' + index}
                      />
                    ),
                )}
            </div>
            {columnFilters.length > 0 && (
              <button
                className="record-menu-clear"
                type="button"
                onClick={() => setColumnFilters([])}
              >
                پاک‌کردن فیلتر ستون‌ها
              </button>
            )}
          </TableMenu>
          <TableMenu label="نمایش" icon={<SlidersHorizontal size={16} aria-hidden="true" />}>
            <div className="record-menu-heading">
              <strong>تنظیم نمای جدول</strong>
              <span>ستون‌ها و فاصلهٔ ردیف‌ها</span>
            </div>
            <div className="record-density-control" role="group" aria-label="فاصلهٔ ردیف‌ها">
              <button type="button" aria-pressed={!compact} onClick={() => setCompact(false)}>
                معمولی
              </button>
              <button type="button" aria-pressed={compact} onClick={() => setCompact(true)}>
                فشرده
              </button>
            </div>
            <div className="admin-columns-options">
              {table.getAllLeafColumns().map(
                (column, index) =>
                  column.getCanHide() && (
                    <label key={column.id}>
                      <input
                        type="checkbox"
                        name={id + '-column-' + column.id}
                        checked={column.getIsVisible()}
                        disabled={
                          column.getIsVisible() &&
                          table.getVisibleLeafColumns().filter((item) => item.getCanHide())
                            .length === 1
                        }
                        onChange={column.getToggleVisibilityHandler()}
                      />
                      {tableCellText(model.headers[index].props.children)}
                    </label>
                  ),
              )}
            </div>
          </TableMenu>
          {modified && (
            <button
              type="button"
              className="record-reset icon"
              title="بازنشانی جدول"
              aria-label="بازنشانی جدول"
              onClick={reset}
            >
              <RotateCcw size={16} aria-hidden="true" />
            </button>
          )}
          <TableMenu
            label="دربارهٔ داده‌های جدول"
            iconOnly
            icon={<Info size={16} aria-hidden="true" />}
          >
            <div className="record-menu-heading">
              <strong>محدودهٔ نمایش</strong>
            </div>
            <p className="record-scope-description">
              جست‌وجو، فیلتر ستون و مرتب‌سازی این جدول فقط در ردیف‌های دریافت‌شده اعمال می‌شود. اگر
              جست‌وجوی اصلی بالای فهرست وجود دارد، برای جست‌وجوی همهٔ داده‌ها از آن استفاده کنید.
            </p>
          </TableMenu>
        </div>
      </div>
      {(columnFilters.length > 0 || sorting.length > 0) && (
        <div className="record-active-filters" aria-label="تنظیمات فعال جدول">
          {columnFilters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => table.getColumn(filter.id)?.setFilterValue(undefined)}
            >
              {tableCellText(model.headers[Number(filter.id)].props.children)}:{' '}
              {typeof filter.value === 'string'
                ? filter.value
                : (filter.value as { equals: string }).equals}
              <X size={12} aria-hidden="true" />
            </button>
          ))}
          {sorting.map((sort) => (
            <button
              key={'sort-' + sort.id}
              type="button"
              onClick={() => table.getColumn(sort.id)?.clearSorting()}
            >
              {tableCellText(model.headers[Number(sort.id)].props.children)}{' '}
              {sort.desc ? (
                <ArrowDown size={12} aria-hidden="true" />
              ) : (
                <ArrowUp size={12} aria-hidden="true" />
              )}
              <X size={12} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
      <div
        className="admin-record-viewport"
        role="region"
        aria-label={label + '; قابل پیمایش افقی'}
        tabIndex={0}
      >
        <table {...props}>
          <caption className="sr-only">{label}</caption>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th
                    key={header.id}
                    scope="col"
                    className={
                      !header.column.getCanSort() && header.index === group.headers.length - 1
                        ? 'record-action-column'
                        : undefined
                    }
                    aria-sort={
                      header.column.getIsSorted() === 'asc'
                        ? 'ascending'
                        : header.column.getIsSorted() === 'desc'
                          ? 'descending'
                          : undefined
                    }
                  >
                    <div className="admin-record-column-heading">
                      {header.column.getCanSort() ? (
                        <button
                          type="button"
                          className="admin-table-sort"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {header.column.getIsSorted() === 'asc' ? (
                            <ArrowUp size={14} aria-hidden="true" />
                          ) : header.column.getIsSorted() === 'desc' ? (
                            <ArrowDown size={14} aria-hidden="true" />
                          ) : (
                            <ArrowUpDown size={14} aria-hidden="true" />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((row) =>
              cloneElement(
                row.original.source,
                { key: row.id },
                row.getVisibleCells().map((cell) =>
                  cloneElement(
                    row.original.cells[Number(cell.column.id)],
                    {
                      key: cell.id,
                      className: [
                        row.original.cells[Number(cell.column.id)].props.className,
                        !cell.column.getCanSort() && cell.column.getIsLastColumn()
                          ? 'record-action-column'
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' '),
                    },
                    flexRender(cell.column.columnDef.cell, cell.getContext()),
                  ),
                ),
              ),
            )}
            {!rows.length && (
              <tr>
                <td colSpan={table.getVisibleLeafColumns().length} className="empty">
                  {filtered
                    ? 'ردیفی با این جست‌وجو یا فیلتر ستون پیدا نشد؛ فیلتر جدول را پاک کنید.'
                    : model.empty
                      ? tableCellText(model.empty.props.children)
                      : 'هنوز ردیفی ثبت نشده است.'}
                </td>
              </tr>
            )}
          </tbody>
          {model.footer}
        </table>
      </div>
      <div className="record-grid-footer">
        <span className="record-visible-range" role="status">
          {count
            ? (
                (pageable
                  ? table.getState().pagination.pageIndex * table.getState().pagination.pageSize
                  : 0) + 1
              ).toLocaleString('fa-IR')
            : '۰'}
          –
          {(pageable
            ? Math.min(
                (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
                count,
              )
            : count
          ).toLocaleString('fa-IR')}{' '}
          از {count.toLocaleString('fa-IR')} ردیف
        </span>
        {pageable && (
          <>
            <label className="record-page-size">
              در هر صفحه
              <select
                name={id + '-page-size'}
                value={table.getState().pagination.pageSize}
                onChange={(event) => table.setPageSize(Number(event.target.value))}
              >
                {[10, 25, 50].map((size) => (
                  <option key={size} value={size}>
                    {size.toLocaleString('fa-IR')}
                  </option>
                ))}
              </select>
            </label>
            <div className="record-page-navigation">
              <button
                className="icon"
                type="button"
                aria-label="صفحهٔ قبلی جدول"
                disabled={!table.getCanPreviousPage()}
                onClick={() => table.previousPage()}
              >
                <ChevronRight size={17} aria-hidden="true" />
              </button>
              <span>
                صفحهٔ {(table.getState().pagination.pageIndex + 1).toLocaleString('fa-IR')} از{' '}
                {Math.max(1, table.getPageCount()).toLocaleString('fa-IR')}
              </span>
              <button
                className="icon"
                type="button"
                aria-label="صفحهٔ بعدی جدول"
                disabled={!table.getCanNextPage()}
                onClick={() => table.nextPage()}
              >
                <ChevronLeft size={17} aria-hidden="true" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
