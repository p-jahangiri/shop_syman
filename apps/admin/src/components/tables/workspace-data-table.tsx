import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Popover from '@mui/material/Popover';
import Skeleton from '@mui/material/Skeleton';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import useMediaQuery from '@mui/material/useMediaQuery';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Filter,
  MoreHorizontal,
  Search,
  SearchX,
  X,
} from 'lucide-react';
import './workspace-data-table.css';

export type WorkspaceColumn<Row, Key extends string = string> = {
  key: Key;
  label: string;
  type: 'text' | 'enum' | 'number' | 'money' | 'date' | 'status' | 'custom';
  sortable?: boolean;
  filter?: 'none' | 'multiselect' | 'numberRange' | 'dateRange' | 'text';
  sticky?: 'start' | 'end';
  mobilePriority?: 'primary' | 'secondary' | 'hidden';
  align?: 'start' | 'center' | 'end';
  width?: number;
  formatter: (row: Row) => ReactNode;
  tooltip?: (row: Row) => string;
  skeleton?: ReactNode;
};

export type WorkspaceSort<Key extends string = string> = { key: Key; direction: 'asc' | 'desc' };
export type WorkspaceRowAction = {
  key: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  icon?: ReactNode;
};

export type WorkspaceDataTableProps<Row, Key extends string = string> = {
  columns: readonly WorkspaceColumn<Row, Key>[];
  items: readonly Row[];
  getRowId: (row: Row) => string;
  total: number;
  page: number;
  pageSize: number;
  pageSizes?: readonly number[];
  cursorPagination?: { hasNext: boolean };
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  search: string;
  onSearchChange: (search: string) => void;
  searchLabel?: string;
  searchPlaceholder?: string;
  searchError?: string;
  sort: WorkspaceSort<Key>;
  onSortChange: (sort: WorkspaceSort<Key>) => void;
  filterChips?: readonly { key: Key; label: string }[];
  onRemoveFilter?: (key: Key) => void;
  onClearFilters?: () => void;
  renderFilter?: (column: WorkspaceColumn<Row, Key>, close: () => void) => ReactNode;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  selected?: ReadonlySet<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  canSelectRow?: (row: Row) => boolean;
  renderBulkActions?: (selected: ReadonlySet<string>) => ReactNode;
  renderRowActions?: (row: Row) => ReactNode;
  getRowActions?: (row: Row) => readonly WorkspaceRowAction[];
  toolbarActions?: ReactNode;
  hiddenColumns?: ReadonlySet<Key>;
  onHiddenColumnsChange?: (keys: Set<Key>) => void;
  itemLabel?: string;
  label: string;
};

const defaultPageSizes = [25, 50, 100] as const;
const numbers = new Intl.NumberFormat('fa-IR');
const selectWidth = 58;
const emptySelection: ReadonlySet<string> = new Set();
const emptyHiddenColumns: ReadonlySet<never> = new Set();

function widthOf(column: { width?: number; type: WorkspaceColumn<unknown>['type'] }) {
  return column.width ?? (column.type === 'text' ? 205 : 140);
}

function orderedColumns<Row, Key extends string>(columns: readonly WorkspaceColumn<Row, Key>[]) {
  return [
    ...columns.filter((column) => column.sticky === 'start'),
    ...columns.filter((column) => !column.sticky),
    ...columns.filter((column) => column.sticky === 'end'),
  ];
}

function cellClasses(column: {
  type: WorkspaceColumn<unknown>['type'];
  sticky?: 'start' | 'end';
  align?: 'start' | 'center' | 'end';
}) {
  const numeric = column.type === 'money' || column.type === 'number';
  return [
    'wdt-cell',
    numeric && 'wdt-numeric',
    'wdt-align-' + (column.align ?? (numeric ? 'end' : 'start')),
    column.sticky && 'wdt-sticky-' + column.sticky,
  ]
    .filter(Boolean)
    .join(' ');
}

function FilterChooser<Row, Key extends string>({
  columns,
  active,
  filterKeys,
  onPick,
  onBack,
  onClose,
  children,
  titleId,
}: {
  columns: readonly WorkspaceColumn<Row, Key>[];
  active?: WorkspaceColumn<Row, Key>;
  filterKeys: ReadonlySet<Key>;
  onPick: (key: Key) => void;
  onBack: () => void;
  onClose: () => void;
  children: ReactNode;
  titleId: string;
}) {
  return (
    <div className="wdt-filter-content" dir="rtl">
      <div className="wdt-filter-heading">
        <div>
          <h3 id={titleId}>{active ? 'فیلتر ' + active.label : 'فیلتر ستون‌ها'}</h3>
          {!active && <p>ستونی را برای تنظیم فیلتر انتخاب کنید.</p>}
        </div>
        <IconButton aria-label="بستن فیلترها" onClick={onClose} className="wdt-touch">
          <X size={18} />
        </IconButton>
      </div>
      {active ? (
        <>
          <Button onClick={onBack} startIcon={<ChevronRight size={16} />}>
            همهٔ فیلترها
          </Button>
          {children}
        </>
      ) : (
        <div className="wdt-filter-options">
          {columns.map((column) => (
            <Button
              key={column.key}
              onClick={() => onPick(column.key)}
              endIcon={<ChevronLeft size={16} />}
              className="wdt-filter-option"
              variant="outlined"
            >
              {column.label}
              {filterKeys.has(column.key) && <small>فعال</small>}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function TableState({
  label,
  search,
  filtered,
  onClearSearch,
  onClearFilters,
  error,
  onRetry,
}: {
  label: string;
  search: string;
  filtered: boolean;
  onClearSearch: () => void;
  onClearFilters?: () => void;
  error?: string;
  onRetry?: () => void;
}) {
  if (error)
    return (
      <div className="wdt-state">
        <Alert
          severity="error"
          action={onRetry && <Button onClick={onRetry}>تلاش دوباره</Button>}
          className="wdt-error"
        >
          {error}
        </Alert>
      </div>
    );
  return (
    <div className="wdt-state">
      <span className="wdt-state-icon" aria-hidden="true">
        <SearchX size={24} />
      </span>
      <strong>{search || filtered ? 'نتیجه‌ای پیدا نشد' : 'هنوز ردیفی ثبت نشده'}</strong>
      <p>
        {search || filtered
          ? 'عبارت جست‌وجو یا فیلترهای فعال را تغییر دهید.'
          : 'ردیف‌های تازه در «' + label + '» نشان داده می‌شوند.'}
      </p>
      <div className="wdt-actions">
        {filtered && onClearFilters && (
          <Button variant="outlined" onClick={onClearFilters}>
            پاک‌کردن فیلترها
          </Button>
        )}
        {search && (
          <Button onClick={onClearSearch} variant={filtered ? 'text' : 'outlined'}>
            پاک‌کردن جست‌وجو
          </Button>
        )}
      </div>
    </div>
  );
}

function CellValue<Row, Key extends string>({
  column,
  row,
}: {
  column: WorkspaceColumn<Row, Key>;
  row: Row;
}) {
  const value = column.formatter(row);
  const tooltip = column.tooltip?.(row);
  return tooltip ? (
    <Tooltip title={tooltip} enterTouchDelay={0} arrow>
      {/* The group is focusable so keyboard users can reveal the same full value as mouse users. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className="wdt-value-with-tip" role="group" tabIndex={0}>
        {value}
      </div>
    </Tooltip>
  ) : (
    <div className="wdt-value">{value}</div>
  );
}

/**
 * Controlled workspace table. The caller owns server querying, query state,
 * permissions, row rendering and what each filter means.
 */
export function WorkspaceDataTable<Row, Key extends string = string>({
  columns,
  items,
  getRowId,
  total,
  page,
  pageSize,
  pageSizes = defaultPageSizes,
  cursorPagination,
  onPageChange,
  onPageSizeChange,
  search,
  onSearchChange,
  searchLabel = 'جست‌وجو',
  searchPlaceholder,
  searchError,
  sort,
  onSortChange,
  filterChips = [],
  onRemoveFilter,
  onClearFilters,
  renderFilter,
  loading = false,
  error,
  onRetry,
  selected = emptySelection,
  onSelectionChange,
  canSelectRow,
  renderBulkActions,
  renderRowActions,
  getRowActions,
  toolbarActions,
  hiddenColumns = emptyHiddenColumns,
  onHiddenColumnsChange,
  itemLabel = 'ردیف',
  label,
}: WorkspaceDataTableProps<Row, Key>) {
  const smallViewport = useMediaQuery('(max-width: 740px)');
  const [narrow, setNarrow] = useState(false);
  const mobile = smallViewport || narrow;
  const containerRef = useRef<HTMLElement | null>(null);
  const [columnsAnchor, setColumnsAnchor] = useState<HTMLElement | null>(null);
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null);
  const [filterPanel, setFilterPanel] = useState<{ anchor: HTMLElement; key?: Key } | null>(null);
  const [rowMenu, setRowMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const [overflow, setOverflow] = useState({ start: false, end: false });
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollRegionId = useId();
  const filterTitleId = useId();
  const columnsMenuId = useId();
  const sortMenuId = useId();
  const rowMenuId = useId();

  const visible = useMemo(
    () =>
      orderedColumns(columns.filter((column) => !hiddenColumns.has(column.key) || column.sticky)),
    [columns, hiddenColumns],
  );
  const filterColumns = columns.filter((column) => column.filter && column.filter !== 'none');
  const filterKeys = new Set(filterChips.map(({ key }) => key));
  const sortable = columns.filter((column) => column.sortable);
  const activeFilter =
    filterPanel && filterColumns.find((column) => column.key === filterPanel.key);
  const menuRow = rowMenu ? items.find((row) => getRowId(row) === rowMenu.id) : undefined;
  const menuActions = menuRow !== undefined ? (getRowActions?.(menuRow) ?? []) : [];
  const actionColumn = visible.filter((column) => column.sticky === 'end').at(-1)?.key;
  const hasActions = Boolean(renderRowActions || getRowActions);
  const extraActionColumn = hasActions && actionColumn === undefined;
  const actionWidth = extraActionColumn ? 150 : 0;
  const isSelectable = Boolean(onSelectionChange);
  const leadingWidth = isSelectable ? selectWidth : 0;
  const totalWidth = visible.reduce(
    (sum, column) => sum + widthOf(column),
    leadingWidth + actionWidth,
  );
  const fluidColumn = visible.find((column) => !column.sticky)?.key;
  const mobilePrimary = visible.filter(
    (column) => column.mobilePriority === 'primary' && column.key !== actionColumn,
  );
  const mobileSecondary = visible.filter(
    (column) =>
      column.key !== actionColumn &&
      column.mobilePriority !== 'hidden' &&
      column.mobilePriority !== 'primary',
  );

  const stickyStart = new Map<Key, number>();
  const stickyEnd = new Map<Key, number>();
  let startOffset = leadingWidth;
  let endOffset = actionWidth;
  for (const column of visible) {
    if (column.sticky === 'start') {
      stickyStart.set(column.key, startOffset);
      startOffset += widthOf(column);
    }
  }
  for (const column of [...visible].reverse()) {
    if (column.sticky === 'end') {
      stickyEnd.set(column.key, endOffset);
      endOffset += widthOf(column);
    }
  }
  const startEdge = Array.from(stickyStart.keys()).at(-1);
  const endEdge = Array.from(stickyEnd.keys()).at(-1);
  const selectablePage = items.filter((row) => canSelectRow?.(row) ?? true).map(getRowId);
  const selectedPageCount = selectablePage.filter((id) => selected.has(id)).length;
  const allPageSelected = selectablePage.length > 0 && selectedPageCount === selectablePage.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const first = total > 0 ? Math.min(page * pageSize + 1, total) : 0;
  const last = Math.min((page + 1) * pageSize, total);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => setNarrow(container.clientWidth < 640);
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    measure();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    function update() {
      if (!scroller) return;
      const max = scroller.scrollWidth - scroller.clientWidth;
      const position = Math.abs(scroller.scrollLeft);
      const start = position > 2;
      const end = max - position > 2;
      setOverflow((old) => (old.start === start && old.end === end ? old : { start, end }));
    }
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    scroller.addEventListener('scroll', update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      scroller.removeEventListener('scroll', update);
    };
  }, [mobile]);

  function changeSelection(ids: readonly string[], checked: boolean) {
    const next = new Set(selected);
    ids.forEach((id) => {
      if (checked) next.add(id);
      else next.delete(id);
    });
    onSelectionChange?.(next);
  }

  function toggleSort(key: Key) {
    onSortChange({ key, direction: sort.key === key && sort.direction === 'asc' ? 'desc' : 'asc' });
  }

  function pinStyles(column: WorkspaceColumn<Row, Key>) {
    return column.sticky === 'start'
      ? { insetInlineStart: stickyStart.get(column.key) }
      : column.sticky === 'end'
        ? { insetInlineEnd: stickyEnd.get(column.key) }
        : {};
  }

  function cellClass(column: WorkspaceColumn<Row, Key>) {
    return (
      cellClasses(column) +
      (startEdge === column.key ? ' wdt-start-edge' : '') +
      (endEdge === column.key && !extraActionColumn ? ' wdt-end-edge' : '')
    );
  }

  function actions(row: Row) {
    const available = getRowActions?.(row) ?? [];
    return (
      <div className="wdt-actions wdt-row-actions">
        {renderRowActions?.(row)}
        {available.length > 0 && (
          <IconButton
            aria-label="عملیات بیشتر ردیف"
            aria-haspopup="menu"
            aria-controls={rowMenu?.id === getRowId(row) ? rowMenuId : undefined}
            aria-expanded={rowMenu?.id === getRowId(row)}
            className="wdt-touch"
            onClick={(event) => setRowMenu({ id: getRowId(row), anchor: event.currentTarget })}
          >
            <MoreHorizontal size={20} />
          </IconButton>
        )}
      </div>
    );
  }

  const message = (
    <TableState
      label={label}
      search={search}
      filtered={filterChips.length > 0}
      onClearSearch={() => onSearchChange('')}
      onClearFilters={onClearFilters}
      error={error}
      onRetry={onRetry}
    />
  );

  const filterContent = filterPanel && (
    <FilterChooser
      columns={filterColumns}
      active={activeFilter || undefined}
      filterKeys={filterKeys}
      onPick={(key) => setFilterPanel({ ...filterPanel, key })}
      onBack={() => setFilterPanel({ anchor: filterPanel.anchor })}
      onClose={() => setFilterPanel(null)}
      titleId={filterTitleId}
    >
      {activeFilter && renderFilter?.(activeFilter, () => setFilterPanel(null))}
    </FilterChooser>
  );

  return (
    <section
      ref={containerRef}
      className="workspace-data-table"
      data-layout={mobile ? 'cards' : 'grid'}
      aria-label={label}
      dir="rtl"
    >
      <div className="wdt-tools">
        <TextField
          label={searchLabel}
          placeholder={searchPlaceholder}
          value={search}
          error={Boolean(searchError)}
          helperText={searchError}
          onChange={(event) => onSearchChange(event.target.value)}
          className="wdt-search"
          slotProps={{
            htmlInput: { type: 'search' },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Search size={18} aria-hidden="true" />
                </InputAdornment>
              ),
              endAdornment: search ? (
                <InputAdornment position="end">
                  <IconButton
                    onClick={() => onSearchChange('')}
                    aria-label="پاک‌کردن جست‌وجو"
                    className="wdt-touch"
                    edge="end"
                  >
                    <X size={17} />
                  </IconButton>
                </InputAdornment>
              ) : undefined,
            },
          }}
        />
        <div className="wdt-actions wdt-tool-actions">
          {renderFilter && filterColumns.length > 0 && (
            <Button
              variant={filterChips.length ? 'contained' : 'outlined'}
              startIcon={<Filter size={17} />}
              aria-haspopup="dialog"
              aria-expanded={Boolean(filterPanel)}
              onClick={(event) => setFilterPanel({ anchor: event.currentTarget })}
            >
              فیلترها{filterChips.length > 0 && ' · ' + numbers.format(filterChips.length)}
            </Button>
          )}
          {mobile && sortable.length > 0 && (
            <Button
              variant="outlined"
              startIcon={<ArrowUpDown size={17} />}
              aria-haspopup="menu"
              aria-controls={sortAnchor ? sortMenuId : undefined}
              aria-expanded={Boolean(sortAnchor)}
              onClick={(event) => setSortAnchor(event.currentTarget)}
            >
              مرتب‌سازی
            </Button>
          )}
          {onHiddenColumnsChange && columns.some((column) => !column.sticky) && (
            <Button
              variant="outlined"
              startIcon={<Columns3 size={18} />}
              aria-haspopup="menu"
              aria-controls={columnsAnchor ? columnsMenuId : undefined}
              aria-expanded={Boolean(columnsAnchor)}
              onClick={(event) => setColumnsAnchor(event.currentTarget)}
            >
              ستون‌ها
            </Button>
          )}
          {toolbarActions}
        </div>
      </div>

      <div className="wdt-query-info">
        <div className="wdt-query-meta">
          <span className="wdt-result-count" aria-live="polite">
            {loading
              ? 'در حال دریافت…'
              : error
                ? 'فهرست در دسترس نیست'
                : cursorPagination
                  ? numbers.format(items.length) + ' ' + itemLabel + ' در این صفحه'
                  : numbers.format(total) + ' ' + itemLabel}
          </span>
          {!mobile && (overflow.start || overflow.end) && (
            <div className="wdt-scroll-hint" role="group" aria-label="پیمایش افقی ستون‌ها">
              <Tooltip title="ستون‌های قبلی">
                <span>
                  <IconButton
                    className="wdt-touch"
                    aria-label="ستون‌های قبلی"
                    aria-controls={scrollRegionId}
                    disabled={!overflow.start}
                    onClick={() => scrollRef.current?.scrollBy({ left: 260 })}
                  >
                    <ChevronRight size={18} />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="ستون‌های بعدی">
                <span>
                  <IconButton
                    className="wdt-touch"
                    aria-label="ستون‌های بعدی"
                    aria-controls={scrollRegionId}
                    disabled={!overflow.end}
                    onClick={() => scrollRef.current?.scrollBy({ left: -260 })}
                  >
                    <ChevronLeft size={18} />
                  </IconButton>
                </span>
              </Tooltip>
            </div>
          )}
        </div>
        {filterChips.length > 0 && (
          <div className="wdt-filters" aria-label="فیلترهای فعال">
            {filterChips.map((chip) => (
              <Chip
                key={chip.key}
                label={chip.label}
                title={chip.label}
                onDelete={onRemoveFilter ? () => onRemoveFilter(chip.key) : undefined}
              />
            ))}
            {onClearFilters && <Button onClick={onClearFilters}>پاک‌کردن همهٔ فیلترها</Button>}
          </div>
        )}
      </div>

      {isSelectable && selected.size > 0 && (
        <div className="wdt-selection">
          <strong>{numbers.format(selected.size)} ردیف انتخاب شده</strong>
          <div className="wdt-actions">
            {renderBulkActions?.(selected)}
            <Button onClick={() => onSelectionChange?.(new Set())}>لغو انتخاب</Button>
          </div>
        </div>
      )}

      {mobile ? (
        <div className="wdt-mobile-list" aria-busy={loading}>
          {loading
            ? Array.from({ length: 3 }, (_, index) => (
                <div className="wdt-mobile-card" key={index} aria-hidden="true">
                  <div className="wdt-card-main">
                    <Skeleton variant="text" width="54%" height={40} />
                    {hasActions && <Skeleton variant="rounded" width={76} height={36} />}
                  </div>
                  {mobilePrimary.length > 1 && (
                    <div className="wdt-card-facts">
                      {mobilePrimary.slice(1).map((column) => (
                        <div key={column.key}>
                          <Skeleton variant="text" width="68%" height={17} />
                          <Skeleton variant="text" width="53%" height={26} />
                        </div>
                      ))}
                    </div>
                  )}
                  {mobileSecondary.length > 0 && (
                    <Skeleton variant="text" width="30%" height={27} />
                  )}
                </div>
              ))
            : error || items.length === 0
              ? message
              : items.map((row) => {
                  const id = getRowId(row);
                  const primary =
                    mobilePrimary.length > 0 ? mobilePrimary : mobileSecondary.slice(0, 1);
                  const secondary = mobileSecondary.filter((column) => !primary.includes(column));
                  return (
                    <article key={id} className="wdt-mobile-card" data-selected={selected.has(id)}>
                      <div className="wdt-card-main">
                        <div className="wdt-card-title">
                          {isSelectable && (
                            <Checkbox
                              checked={selected.has(id)}
                              disabled={!(canSelectRow?.(row) ?? true)}
                              onChange={(_, checked) => changeSelection([id], checked)}
                              slotProps={{ input: { 'aria-label': 'انتخاب ردیف' } }}
                              className="wdt-touch"
                            />
                          )}
                          {primary[0] && <CellValue column={primary[0]} row={row} />}
                        </div>
                        {hasActions && actions(row)}
                      </div>
                      {primary.length > 1 && (
                        <dl className="wdt-card-facts">
                          {primary.slice(1).map((column) => (
                            <div key={column.key}>
                              <dt>{column.label}</dt>
                              <dd
                                className={
                                  column.type === 'number' || column.type === 'money'
                                    ? 'wdt-numeric'
                                    : undefined
                                }
                              >
                                <CellValue column={column} row={row} />
                              </dd>
                            </div>
                          ))}
                        </dl>
                      )}
                      {secondary.length > 0 && (
                        <details className="wdt-card-details">
                          <summary>جزئیات</summary>
                          <dl className="wdt-card-facts">
                            {secondary.map((column) => (
                              <div key={column.key}>
                                <dt>{column.label}</dt>
                                <dd>
                                  <CellValue column={column} row={row} />
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </details>
                      )}
                    </article>
                  );
                })}
        </div>
      ) : (
        <>
          <div
            id={scrollRegionId}
            className="wdt-scroll"
            ref={scrollRef}
            data-start-overflow={overflow.start}
            data-end-overflow={overflow.end}
            data-no-rows={!loading && Boolean(error || items.length === 0)}
            tabIndex={0}
            role="region"
            aria-label={'ناحیهٔ پیمایش ' + label}
            aria-busy={loading}
          >
            <Table
              aria-label={label}
              sx={{
                minWidth: totalWidth,
                width: fluidColumn === undefined ? totalWidth : '100%',
                tableLayout: 'fixed',
              }}
            >
              <colgroup>
                {isSelectable && <Box component="col" sx={{ width: selectWidth }} />}
                {visible.map((column) => (
                  <Box
                    component="col"
                    key={column.key}
                    sx={{ width: column.key === fluidColumn ? undefined : widthOf(column) }}
                  />
                ))}
                {extraActionColumn && <Box component="col" sx={{ width: actionWidth }} />}
              </colgroup>
              <TableHead>
                <TableRow>
                  {isSelectable && (
                    <TableCell
                      className={
                        'wdt-cell wdt-sticky-start wdt-select' +
                        (startEdge === undefined ? ' wdt-start-edge' : '')
                      }
                      sx={{ insetInlineStart: 0 }}
                    >
                      <Checkbox
                        className="wdt-touch"
                        checked={allPageSelected}
                        indeterminate={selectedPageCount > 0 && !allPageSelected}
                        disabled={loading || Boolean(error) || selectablePage.length === 0}
                        onChange={(_, checked) => changeSelection(selectablePage, checked)}
                        slotProps={{ input: { 'aria-label': 'انتخاب همهٔ ردیف‌های این صفحه' } }}
                      />
                    </TableCell>
                  )}
                  {visible.map((column) => {
                    const direction = sort.key === column.key ? sort.direction : undefined;
                    const SortIcon =
                      direction === 'asc'
                        ? ArrowUp
                        : direction === 'desc'
                          ? ArrowDown
                          : ArrowUpDown;
                    const active = filterKeys.has(column.key);
                    return (
                      <TableCell
                        key={column.key}
                        className={cellClass(column)}
                        sx={pinStyles(column)}
                        sortDirection={direction ?? false}
                      >
                        <div className="wdt-column-heading">
                          {column.sortable ? (
                            <button
                              type="button"
                              className="wdt-sort"
                              data-active={Boolean(direction)}
                              onClick={() => toggleSort(column.key)}
                              aria-label={
                                'مرتب‌سازی ' +
                                column.label +
                                (direction === 'asc' ? ' نزولی' : ' صعودی')
                              }
                            >
                              <span>{column.label}</span>
                              <SortIcon size={15} aria-hidden="true" />
                            </button>
                          ) : (
                            <span>{column.label}</span>
                          )}
                          {renderFilter && column.filter && column.filter !== 'none' && (
                            <Tooltip title={'فیلتر ' + column.label}>
                              <IconButton
                                className="wdt-touch wdt-header-filter"
                                data-active={active}
                                aria-label={'فیلتر ' + column.label + (active ? '، فعال' : '')}
                                aria-haspopup="dialog"
                                aria-expanded={filterPanel?.key === column.key}
                                onClick={(event) =>
                                  setFilterPanel({ key: column.key, anchor: event.currentTarget })
                                }
                              >
                                <Filter size={15} />
                              </IconButton>
                            </Tooltip>
                          )}
                        </div>
                      </TableCell>
                    );
                  })}
                  {extraActionColumn && (
                    <TableCell
                      className="wdt-cell wdt-sticky-end wdt-end-edge"
                      sx={{ insetInlineEnd: 0 }}
                    >
                      عملیات
                    </TableCell>
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {loading
                  ? Array.from({ length: Math.min(6, pageSize) }, (_, index) => (
                      <TableRow key={index} aria-hidden="true">
                        {isSelectable && (
                          <TableCell className="wdt-cell">
                            <Skeleton variant="rounded" width={18} height={18} />
                          </TableCell>
                        )}
                        {visible.map((column) => (
                          <TableCell
                            key={column.key}
                            className={cellClass(column)}
                            sx={pinStyles(column)}
                          >
                            {column.skeleton ??
                              (column.key === actionColumn && hasActions ? (
                                <Skeleton variant="rounded" width={76} height={34} />
                              ) : (
                                <Skeleton variant="text" width="75%" height={29} />
                              ))}
                          </TableCell>
                        ))}
                        {extraActionColumn && (
                          <TableCell className="wdt-cell">
                            <Skeleton variant="rounded" width={76} height={34} />
                          </TableCell>
                        )}
                      </TableRow>
                    ))
                  : error || items.length === 0
                    ? null
                    : items.map((row) => {
                        const id = getRowId(row);
                        const checked = selected.has(id);
                        return (
                          <TableRow key={id} hover data-selected={checked}>
                            {isSelectable && (
                              <TableCell
                                className={
                                  'wdt-cell wdt-sticky-start wdt-select' +
                                  (startEdge === undefined ? ' wdt-start-edge' : '')
                                }
                                sx={{ insetInlineStart: 0 }}
                              >
                                <Checkbox
                                  checked={checked}
                                  disabled={!(canSelectRow?.(row) ?? true)}
                                  onChange={(_, next) => changeSelection([id], next)}
                                  slotProps={{ input: { 'aria-label': 'انتخاب ردیف' } }}
                                  className="wdt-touch"
                                />
                              </TableCell>
                            )}
                            {visible.map((column) => (
                              <TableCell
                                key={column.key}
                                className={cellClass(column)}
                                sx={pinStyles(column)}
                              >
                                <CellValue column={column} row={row} />
                                {hasActions && column.key === actionColumn && actions(row)}
                              </TableCell>
                            ))}
                            {extraActionColumn && (
                              <TableCell
                                className="wdt-cell wdt-sticky-end wdt-end-edge"
                                sx={{ insetInlineEnd: 0 }}
                              >
                                {actions(row)}
                              </TableCell>
                            )}
                          </TableRow>
                        );
                      })}
              </TableBody>
            </Table>
          </div>
          {!loading && (error || items.length === 0) && (
            <div className="wdt-empty-results">{message}</div>
          )}
        </>
      )}

      <div className="wdt-pagination">
        {!cursorPagination && (
          <TextField
            select
            label="ردیف در صفحه"
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            disabled={loading}
            className="wdt-page-size"
          >
            {pageSizes.map((size) => (
              <MenuItem key={size} value={size}>
                {numbers.format(size)}
              </MenuItem>
            ))}
          </TextField>
        )}
        <span aria-live="polite" className="wdt-range">
          {error || loading
            ? '—'
            : cursorPagination
              ? 'صفحهٔ ' + numbers.format(page + 1)
              : total > 0
                ? `${numbers.format(first)} تا ${numbers.format(last)} از ${numbers.format(total)}`
                : 'بدون نتیجه'}
        </span>
        <div className="wdt-actions">
          <IconButton
            aria-label="صفحهٔ قبل"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 0 || loading || (Boolean(error) && !cursorPagination)}
            className="wdt-touch"
          >
            <ChevronRight size={20} />
          </IconButton>
          <span className="wdt-page-number" aria-label={'صفحهٔ ' + numbers.format(page + 1)}>
            {numbers.format(page + 1)}
          </span>
          <IconButton
            aria-label="صفحهٔ بعد"
            onClick={() => onPageChange(page + 1)}
            disabled={
              (cursorPagination ? !cursorPagination.hasNext : page >= pageCount - 1) ||
              loading ||
              Boolean(error)
            }
            className="wdt-touch"
          >
            <ChevronLeft size={20} />
          </IconButton>
        </div>
      </div>

      {mobile ? (
        <Drawer
          anchor="bottom"
          open={Boolean(filterPanel)}
          onClose={() => setFilterPanel(null)}
          slotProps={{
            paper: {
              role: 'dialog',
              'aria-modal': true,
              'aria-labelledby': filterTitleId,
              sx: { maxHeight: '88dvh', borderRadius: '20px 20px 0 0' },
            },
          }}
        >
          {filterContent}
        </Drawer>
      ) : (
        <Popover
          open={Boolean(filterPanel)}
          anchorEl={filterPanel?.anchor}
          onClose={() => setFilterPanel(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          slotProps={{
            paper: {
              role: 'dialog',
              'aria-labelledby': filterTitleId,
              sx: {
                width: 'min(390px, calc(100vw - 32px))',
                maxHeight: 'min(590px, calc(100dvh - 32px))',
              },
            },
          }}
        >
          {filterContent}
        </Popover>
      )}

      <Menu
        anchorEl={columnsAnchor}
        open={Boolean(columnsAnchor)}
        onClose={() => setColumnsAnchor(null)}
        slotProps={{
          list: {
            id: columnsMenuId,
            'aria-label': 'انتخاب ستون‌ها',
            sx: { '& .MuiMenuItem-root': { minHeight: 44 } },
          },
        }}
      >
        {columns.map((column) => {
          const checked = Boolean(column.sticky) || !hiddenColumns.has(column.key);
          return (
            <MenuItem
              key={column.key}
              role="menuitemcheckbox"
              aria-checked={checked}
              disabled={Boolean(column.sticky) || (checked && visible.length === 1)}
              onClick={() => {
                const next = new Set(hiddenColumns);
                if (checked) next.add(column.key);
                else next.delete(column.key);
                onHiddenColumnsChange?.(next);
              }}
            >
              <Checkbox
                tabIndex={-1}
                checked={checked}
                sx={{ pointerEvents: 'none' }}
                slotProps={{ input: { 'aria-hidden': true } }}
              />
              {column.label}
            </MenuItem>
          );
        })}
      </Menu>

      <Menu
        anchorEl={sortAnchor}
        open={Boolean(sortAnchor)}
        onClose={() => setSortAnchor(null)}
        slotProps={{
          list: {
            id: sortMenuId,
            'aria-label': 'مرتب‌سازی جدول',
            sx: { '& .MuiMenuItem-root': { minHeight: 44 } },
          },
        }}
      >
        {sortable.flatMap((column) =>
          (['asc', 'desc'] as const).map((direction) => (
            <MenuItem
              key={column.key + direction}
              selected={sort.key === column.key && sort.direction === direction}
              onClick={() => {
                onSortChange({ key: column.key, direction });
                setSortAnchor(null);
              }}
            >
              {column.label} · {direction === 'asc' ? 'صعودی' : 'نزولی'}
            </MenuItem>
          )),
        )}
      </Menu>

      <Menu
        anchorEl={rowMenu?.anchor}
        open={Boolean(rowMenu && menuActions.length && !error && !loading)}
        onClose={() => setRowMenu(null)}
        slotProps={{
          list: {
            id: rowMenuId,
            'aria-label': 'عملیات ردیف',
            sx: { '& .MuiMenuItem-root': { minHeight: 44 } },
          },
        }}
      >
        {menuActions.map((action) => (
          <MenuItem
            key={action.key}
            disabled={action.disabled}
            sx={{ color: action.danger ? 'error.main' : undefined, gap: 1 }}
            onClick={() => {
              setRowMenu(null);
              action.onClick();
            }}
          >
            {action.icon}
            {action.label}
          </MenuItem>
        ))}
      </Menu>
    </section>
  );
}
