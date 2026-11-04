import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  digitalUiHarness,
  uiElements,
  uiText,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
import type {
  WorkspaceColumn,
  WorkspaceSort,
} from '../src/components/tables/workspace-data-table.tsx';

type Row = { id: string; name: string; stock: string };
type Column = 'name' | 'stock';
const rows: Row[] = [
  { id: 'r2', name: 'مدل دوم', stock: '10' },
  { id: 'r3', name: 'مدل سوم', stock: '5' },
];
const columns: WorkspaceColumn<Row, Column>[] = [
  {
    key: 'name',
    label: 'کالا',
    type: 'text',
    formatter: (row) => row.name,
    mobilePriority: 'primary',
    sortable: true,
  },
  {
    key: 'stock',
    label: 'موجودی',
    type: 'number',
    formatter: (row) => row.stock,
    mobilePriority: 'secondary',
    sortable: true,
    filter: 'numberRange',
  },
];

function mount(mobile = false, overrides: Record<string, unknown> = {}) {
  const selections: string[][] = [];
  const sorts: WorkspaceSort<Column>[] = [];
  const pages: number[] = [];
  const mocks = Object.fromEntries(
    [
      'Alert',
      'Box',
      'Button',
      'Checkbox',
      'Chip',
      'Drawer',
      'IconButton',
      'InputAdornment',
      'Menu',
      'MenuItem',
      'Popover',
      'Skeleton',
      'Table',
      'TableBody',
      'TableCell',
      'TableHead',
      'TableRow',
      'TextField',
      'Tooltip',
    ].map((name) => ['@mui/material/' + name, name]),
  );
  const h = digitalUiHarness(
    fileURLToPath(new URL('../src/components/tables/workspace-data-table.tsx', import.meta.url)),
    { ...mocks, '@mui/material/useMediaQuery': () => mobile, './workspace-data-table.css': {} },
  );
  h.mount('WorkspaceDataTable', {
    columns,
    items: rows,
    getRowId: (row: Row) => row.id,
    total: 52,
    page: 1,
    pageSize: 25,
    search: 'مدل',
    onSearchChange() {},
    onPageChange: (page: number) => pages.push(page),
    onPageSizeChange() {},
    sort: { key: 'stock', direction: 'asc' },
    onSortChange: (sort: WorkspaceSort<Column>) => sorts.push(sort),
    selected: new Set(['off-page', 'r2']),
    onSelectionChange: (ids: ReadonlySet<string>) => selections.push(Array.from(ids)),
    label: 'جدول آزمون',
    ...overrides,
  });
  return { h, selections, sorts, pages };
}

test('page selection preserves selections from other pages and sorting delegates without reordering server results', async () => {
  const { h, selections, sorts, pages } = mount();
  const elements = uiElements(h.tree());
  const selectPage = elements.find(
    (element) =>
      element.type === 'Checkbox' &&
      (element.props.slotProps as { input: Record<string, unknown> }).input['aria-label'] ===
        'انتخاب همهٔ ردیف‌های این صفحه',
  )!;
  assert.equal(selectPage.props.indeterminate, true);
  (selectPage.props.onChange as (event: unknown, checked: boolean) => void)({}, true);
  assert.deepEqual(selections, [['off-page', 'r2', 'r3']]);
  (selectPage.props.onChange as (event: unknown, checked: boolean) => void)({}, false);
  assert.deepEqual(selections[1], ['off-page']);

  const sort = elements.find(
    (element) => element.props['aria-label'] === 'مرتب‌سازی موجودی نزولی',
  )!;
  (sort.props.onClick as () => void)();
  assert.equal(sorts[0]?.key, 'stock');
  assert.equal(sorts[0]?.direction, 'desc');
  const cellRows = uiElements(h.tree()).filter(
    (element) => typeof element.type === 'function' && 'row' in element.props,
  );
  assert.deepEqual(
    cellRows.map((cell) => (cell.props.row as Row).id),
    ['r2', 'r2', 'r3', 'r3'],
  );
  const next = elements.find((element) => element.props['aria-label'] === 'صفحهٔ بعد')!;
  (next.props.onClick as () => void)();
  assert.deepEqual(pages, [2]);
  await h.settle();
  h.unmount();
});

test('mobile uses a bottom filter drawer and keeps secondary values in collapsible card details', async () => {
  const { h } = mount(true, { renderFilter: () => 'کنترل فیلتر بازه' });
  const initial = uiElements(h.tree());
  assert.equal(initial.filter((element) => element.type === 'Table').length, 0);
  assert.equal(initial.filter((element) => element.type === 'details').length, 2);
  const filter = initial.find(
    (element) => element.type === 'Button' && uiText(element) === 'فیلترها',
  )!;
  (filter.props.onClick as (event: unknown) => void)({ currentTarget: {} });
  await h.settle();
  const drawer = uiElements(h.tree()).find((element) => element.type === 'Drawer')!;
  assert.equal(drawer.props.anchor, 'bottom');
  assert.equal(drawer.props.open, true);
  const chooser = uiElements(drawer).find((element) => typeof element.props.onPick === 'function')!;
  (chooser.props.onPick as (key: Column) => void)('stock');
  await h.settle();
  assert.match(uiText(h.tree()), /کنترل فیلتر بازه/);
  h.unmount();
});
