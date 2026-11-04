import * as productColumnModel from '../src/features/catalog/product-column-filter-model.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  digitalUiHarness,
  uiElements,
  uiText,
  type TestElement,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
import * as contract from '../src/api/contracts/catalog/price-history-contract.ts';
import * as workspaceContract from '../src/api/contracts/catalog/product-workspace-contract.ts';
import type { PriceHistoryPage } from '../src/api/contracts/catalog/price-history-contract.ts';

const at = '2026-10-30T12:00:00.1234567Z';
function page(count = 1): PriceHistoryPage {
  return {
    schemaVersion: 1,
    productId: 'p1',
    pageSize: 50,
    asOfAt: at,
    variants: [
      {
        id: 'v1',
        sku: 'CURRENT-INACTIVE',
        isActive: false,
        currentPriceRial: '9223372036854775807',
      },
    ],
    items: Array.from({ length: count }, (_, i) => ({
      id: 'e' + String(100 - i).padStart(3, '0'),
      variantId: 'v1',
      oldPriceRial: '9223372036854775806',
      newPriceRial: '9223372036854775807',
      changedBy: 'staff-id-actual',
      changedAt: at,
    })),
    nextCursor: count === 50 ? 'page_2' : null,
  };
}
type QueryOptions = {
  queryKey: unknown[];
  queryFn: (context: { signal: AbortSignal }) => Promise<unknown>;
  gcTime: number;
  staleTime: number;
  retry: boolean;
  placeholderData?: unknown;
};
function setup() {
  let current: QueryOptions,
    revision = 0,
    calls = 0;
  const views = new Map<string, Record<string, unknown>>();
  let transport: (path: string, options: { signal: AbortSignal }) => Promise<unknown> = async () =>
    page();
  const h = digitalUiHarness(
    fileURLToPath(new URL('../src/pages/catalog/price-history.tsx', import.meta.url)),
    {
      '@tanstack/react-query': {
        useQuery: (options: QueryOptions) => {
          current = options;
          return (
            views.get(JSON.stringify(options.queryKey)) ?? {
              isPending: true,
              isFetching: true,
              refetch() {
                calls++;
              },
            }
          );
        },
      },
      '../../components/forms/persian-date-field': { PersianDateField: 'PersianDateField' },
      '../../api/api': {
        api: (path: string, options: { signal: AbortSignal }) => transport(path, options),
      },
      '../../auth/admin-view-authority': { adminViewRevision: () => revision },
      '../../api/contracts/catalog/price-history-contract': contract,
      '../../styles/catalog/price-history.css': {},
      '../../components/tables/admin-table': { AdminTable: 'AdminTable' },
      '../../components/filters/admin-filters': { AdminFilterForm: 'AdminFilterForm' },
      '../../components/ui': { Busy: 'Busy', ErrorBox: 'ErrorBox', Field: 'Field' },
    },
  );
  h.mount('PriceHistory', { productId: 'p1', productName: 'گوشی نمونه' });
  function accept(data: PriceHistoryPage | undefined, error?: Error) {
    views.set(JSON.stringify(current.queryKey), {
      isPending: false,
      isFetching: false,
      data,
      error,
      refetch() {
        calls++;
      },
    });
    h.rerender();
  }
  function element(type: string, label?: string): TestElement {
    const all = uiElements(h.tree());
    const form = all.find((v) => v.type === 'AdminFilterForm');
    const found = [
      ...all,
      ...uiElements(form?.props.primary),
      ...uiElements(form?.props.actions),
    ].find(
      (v) =>
        v.type === type &&
        (!label ||
          v.props.label === label ||
          v.props['aria-label'] === label ||
          uiText(v) === label),
    );
    assert.ok(found, type + ': ' + label);
    return found;
  }
  function control(label: string) {
    const form = uiElements(h.tree()).find((v) => v.type === 'AdminFilterForm');
    const picker = [...uiElements(h.tree()), ...uiElements(form?.props.primary)].find(
      (v) => v.type === 'PersianDateField' && v.props.label === label,
    );
    if (picker) return picker;
    const field = element('Field', label);
    const found = uiElements(field.props.children).find(
      (v) => v.type === 'input' || v.type === 'select',
    );
    assert.ok(found);
    return found;
  }
  return {
    h,
    accept,
    element,
    control,
    options: () => current,
    calls: () => calls,
    setRevision: (value: number) => {
      revision = value;
    },
    setTransport: (value: typeof transport) => {
      transport = value;
    },
    click: (label: string) => (element('button', label).props.onClick as () => void)(),
    change: (label: string, value: string) =>
      (control(label).props.onChange as (event: unknown) => void)(
        control(label).type === 'PersianDateField' ? value : { target: { value } },
      ),
    submit: () =>
      (element('AdminFilterForm').props.onSubmit as (event: unknown) => void)({
        preventDefault() {},
      }),
  };
}

test('real history view renders exact private event values, current inactive metadata, readable help and a scrollable table', async () => {
  const x = setup();
  await x.h.settle();
  x.accept(page());
  await x.h.settle();
  const text = uiText(x.h.tree());
  assert.match(text, /staff-id-actual/);
  assert.match(text, /CURRENT-INACTIVE/);
  assert.match(text, /غیرفعال/);
  assert.match(text, /تغییر قیمت فروش/);
  assert.ok(text.includes(contract.priceHistoryMoney('9223372036854775807')));
  assert.ok(text.includes(contract.priceHistoryMoney('9223372036854775806')));
  assert.match(text, /افزایش ۱ ریال/);
  assert.ok(!text.includes('NaN'));
  assert.ok(
    !uiElements(x.h.tree()).some(
      (v) => typeof v.type === 'function' && String(v.type).includes('function PriceHistoryChart'),
    ),
  );
  const region = uiElements(x.h.tree()).find((v) => v.props.role === 'region');
  assert.equal(region?.props.tabIndex, 0);
  assert.match(String(region?.props['aria-label']), /قابل پیمایش افقی/);
  assert.ok(uiElements(x.h.tree()).some((v) => v.type === 'details'));
  assert.equal(x.options().gcTime, 0);
  assert.equal(x.options().placeholderData, undefined);
  assert.equal(x.options().retry, false);
  x.h.unmount();
});

test('actual filter, paging and refresh handlers reset cursors and only enable a chart after explicit variant application', async () => {
  const x = setup();
  await x.h.settle();
  x.accept(page(50));
  await x.h.settle();
  x.click('۵۰ رویداد بعدی');
  await x.h.settle();
  assert.equal(x.options().queryKey.at(-1), 'page_2');
  assert.ok(
    !uiText(x.h.tree()).includes('staff-id-actual'),
    'new page must not display old private rows as current',
  );
  x.accept(page());
  await x.h.settle();
  x.change('تنوع / SKU', 'v1');
  await x.h.settle();
  assert.equal((x.options().queryKey.at(-2) as contract.PriceHistoryFilters).variantId, null);
  x.submit();
  await x.h.settle();
  assert.equal(x.options().queryKey.at(-1), null);
  assert.equal((x.options().queryKey.at(-2) as contract.PriceHistoryFilters).variantId, 'v1');
  x.accept(page());
  await x.h.settle();
  assert.ok(
    uiElements(x.h.tree()).some(
      (v) => typeof v.type === 'function' && String(v.type).includes('function PriceHistoryChart'),
    ),
  );
  assert.match(uiText(x.h.tree()), /قیمت فعلی/);
  const firstGeneration = x.options().queryKey[5];
  x.click('تازه‌سازی از ابتدا');
  await x.h.settle();
  assert.equal(x.options().queryKey.at(-1), null);
  assert.notEqual(x.options().queryKey[5], firstGeneration);
  x.accept(page());
  await x.h.settle();
  x.click('پاک‌کردن فیلتر');
  await x.h.settle();
  assert.deepEqual(x.options().queryKey.at(-2), contract.emptyPriceHistoryFilters);
  assert.equal(x.control('تنوع / SKU').props.value, '');
  x.h.unmount();
});

test('invalid range leaves current server query unchanged; equal half-open range is accepted and may be empty', async () => {
  const x = setup();
  await x.h.settle();
  x.accept(page());
  await x.h.settle();
  x.change('از زمان (شامل)', '2026-10-30T13:00');
  await x.h.settle();
  x.change('تا زمان (پیش از)', '2026-10-29T13:00');
  await x.h.settle();
  const previous = JSON.stringify(x.options().queryKey);
  x.submit();
  await x.h.settle();
  assert.equal(JSON.stringify(x.options().queryKey), previous);
  assert.ok(x.element('ErrorBox').props.error);
  x.change('تا زمان (پیش از)', '2026-10-30T13:00');
  await x.h.settle();
  x.submit();
  await x.h.settle();
  assert.notEqual(JSON.stringify(x.options().queryKey), previous);
  const filters = x.options().queryKey.at(-2) as contract.PriceHistoryFilters;
  assert.equal(filters.fromAt, filters.toAt);
  x.accept({ ...page(), items: [] });
  await x.h.settle();
  assert.match(uiText(x.h.tree()), /تغییر قیمتی با این فیلتر ثبت نشده است/);
  x.h.unmount();
});

test('query function passes abort signal and rejects old-filter, switched-authority and unmounted late responses', async () => {
  for (const scenario of ['filter', 'authority', 'unmount', 'abort'] as const) {
    const x = setup();
    await x.h.settle();
    let resolve: (raw: unknown) => void = () => {};
    const pending = new Promise<unknown>((yes) => {
      resolve = yes;
    });
    const abort = new AbortController();
    x.setTransport(async (path, options) => {
      assert.match(path, /^\/admin\/products\/p1\/price-history\?/);
      assert.equal(options.signal, abort.signal);
      return pending;
    });
    const request = x.options().queryFn({ signal: abort.signal });
    // Attach the assertion before resolving, so no rejected promise is left unhandled.
    const rejected = assert.rejects(request, /نمای فعلی/);
    if (scenario === 'filter') {
      x.accept(page());
      await x.h.settle();
      x.click('پاک‌کردن فیلتر');
      await x.h.settle();
    }
    if (scenario === 'authority') x.setRevision(1);
    if (scenario === 'unmount') x.h.unmount();
    if (scenario === 'abort') abort.abort();
    resolve(page());
    await rejected;
    if (scenario !== 'unmount') x.h.unmount();
  }
});

test('retry is explicit and a read-only catalogue viewer can open the dedicated product history dialog', async () => {
  const x = setup();
  await x.h.settle();
  x.accept(undefined, new Error('خطای شبکه'));
  await x.h.settle();
  assert.equal(x.calls(), 0);
  x.click('تلاش دوباره برای تاریخچه');
  assert.equal(x.calls(), 1);
  x.h.unmount();
  const row = {
    id: 'p1',
    nameFa: 'گوشی',
    nameEn: 'Phone',
    slug: 'phone',
    status: 'Published',
    archived: false,
    variantCount: 1,
  };
  const material = [
    'Box',
    'Stack',
    'Button',
    'IconButton',
    'Tooltip',
    'TextField',
    'MenuItem',
    'Chip',
    'Tabs',
    'Tab',
    'Typography',
    'Alert',
    'Dialog',
    'DialogTitle',
    'DialogContent',
    'DialogActions',
    'CircularProgress',
  ];
  const h = digitalUiHarness(
    fileURLToPath(new URL('../src/pages/catalog/products.tsx', import.meta.url)),
    {
      ...Object.fromEntries(material.map((name) => ['@mui/material/' + name, name])),
      '../../features/catalog/product-column-filter': {
        ProductColumnFilter: 'ProductColumnFilter',
      },
      '../../features/catalog/product-column-filter-model': productColumnModel,
      '../../components/tables/workspace-data-table': { WorkspaceDataTable: 'WorkspaceDataTable' },
      '@tanstack/react-query': {
        useQuery: () => ({
          isPending: false,
          isFetching: false,
          data: { items: [row], totalCount: '1' },
          refetch() {},
        }),
      },
      '../../api/api': {},
      '../../features/catalog/product-editor': { ProductEditor: 'ProductEditor' },
      '../../features/catalog/product-quick-prices': { ProductQuickPrices: 'ProductQuickPrices' },
      '../../features/catalog/product-form-settings': {
        ProductFormSettings: 'ProductFormSettings',
      },
      './price-history': { PriceHistory: 'PriceHistory' },
      '../../hooks/use-product-command': {
        useProductCommand: () => ({ blocked: false, attempt: null }),
      },
      '../../api/contracts/media/media-contract': { imagePreviewUrl: () => '' },
      '../../types/types': { nameOf: () => 'دسته' },
      '../../api/contracts/catalog/product-workspace-contract': workspaceContract,
    },
    { setTimeout, clearTimeout },
  );
  h.mount('ProductsPage', {
    data: { categories: [], brands: [] },
    methods: [],
    plans: [],
    writable: false,
    viewerId: 'readonly',
  });
  const grid = uiElements(h.tree()).find((v) => v.type === 'WorkspaceDataTable');
  assert.ok(grid);
  assert.equal((grid.props.renderRowActions as (item: typeof row) => unknown)(row), null);
  const actions = (
    grid.props.getRowActions as (item: typeof row) => { key: string; onClick: () => void }[]
  )(row);
  assert.deepEqual(
    Array.from(actions, (action) => action.key),
    ['history'],
  );
  actions[0].onClick();
  await h.settle();
  assert.ok(uiElements(h.tree()).some((v) => v.type === 'Dialog'));
  const history = uiElements(h.tree()).find((v) => v.type === 'PriceHistory');
  assert.equal(history?.props.productId, 'p1');
  h.unmount();
});

test('actual chart draws isolated per-event intervals with exact table-alternative text and no interpolated line', () => {
  const h = digitalUiHarness(
    fileURLToPath(new URL('../src/pages/catalog/price-history.tsx', import.meta.url)),
    {
      '@tanstack/react-query': {},
      '../../components/forms/persian-date-field': { PersianDateField: 'PersianDateField' },
      '../../api/api': {},
      '../../auth/admin-view-authority': {},
      '../../api/contracts/catalog/price-history-contract': contract,
      '../../styles/catalog/price-history.css': {},
      '../../components/tables/admin-table': {},
      '../../components/filters/admin-filters': {},
      '../../components/ui': {},
    },
  );
  const data = page();
  data.items.push({
    ...data.items[0],
    id: 'other',
    variantId: 'v2',
    oldPriceRial: '0',
    newPriceRial: '5',
  });
  h.mount('PriceHistoryChart', { page: data, variantId: 'v1' });
  assert.equal(uiElements(h.tree()).filter((v) => v.type === 'svg').length, 1);
  assert.equal(uiElements(h.tree()).filter((v) => v.type === 'circle').length, 2);
  assert.equal(
    uiElements(h.tree()).filter((v) => v.type === 'path' || v.type === 'polyline').length,
    0,
  );
  assert.match(uiText(h.tree()), /رویدادهای این صفحه/);
  assert.ok(uiText(h.tree()).includes(contract.priceHistoryMoney('9223372036854775806')));
  assert.ok(!uiText(h.tree()).includes('other'));
  h.unmount();
});

test('pagination keeps the exact first-page asOfAt; refresh explicitly starts a new snapshot', async () => {
  const x = setup();
  await x.h.settle();
  x.setTransport(async () => page(50));
  const first = (await x
    .options()
    .queryFn({ signal: new AbortController().signal })) as PriceHistoryPage;
  x.accept(first);
  await x.h.settle();
  x.click('۵۰ رویداد بعدی');
  await x.h.settle();
  const fresh = { ...page(), asOfAt: '2026-10-30T12:00:00.1234568Z' };
  x.setTransport(async () => fresh);
  await assert.rejects(
    x.options().queryFn({ signal: new AbortController().signal }),
    /زمان مبنای صفحه/,
  );
  x.accept(undefined, new Error('snapshot drift'));
  await x.h.settle();
  x.click('تازه‌سازی از ابتدا');
  await x.h.settle();
  assert.equal(x.options().queryKey.at(-1), null);
  const accepted = (await x
    .options()
    .queryFn({ signal: new AbortController().signal })) as PriceHistoryPage;
  assert.equal(accepted.asOfAt, fresh.asOfAt);
  x.h.unmount();
});
