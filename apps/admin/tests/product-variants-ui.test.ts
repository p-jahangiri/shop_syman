import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  digitalUiHarness,
  uiElements,
  uiText,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
import * as model from '../src/features/catalog/product-editor-model.ts';
import * as commerce from '@sayman/web-shared/lib/shared/commerce.ts';
const material = [
  'Box',
  'Stack',
  'Button',
  'TextField',
  'Checkbox',
  'Chip',
  'IconButton',
  'Tooltip',
  'Alert',
  'Typography',
  'MenuItem',
];
const fields = ['sku', 'axes', 'price', 'discount', 'warranty'].map((key, index) => ({
  key,
  label: key,
  help: 'راهنما',
  visible: true,
  sortOrder: index,
  visibilityLocked: true,
}));
function setup(compact = false, firstPrice = '900719925474099.1') {
  let rows = [
    { ...model.blankProductVariant('one'), sku: 'DEMO-1', price: firstPrice },
    { ...model.blankProductVariant('two'), sku: 'DEMO-2', price: '10' },
  ];
  const h = digitalUiHarness(
    fileURLToPath(new URL('../src/features/catalog/product-variants-table.tsx', import.meta.url)),
    {
      ...Object.fromEntries(material.map((name) => ['@mui/material/' + name, name])),
      '@mui/material/useMediaQuery': () => compact,
      '@mui/x-data-grid': { DataGrid: 'DataGrid' },
      '../../app/admin-style-nonce': { adminStyleNonce: () => 'document-bound-nonce' },
      '../../components/forms/field-help': { FieldHelp: 'FieldHelp' },
      './product-editor-fields': { ProductTextField: 'ProductTextField' },
      './product-editor-model': model,
      '@sayman/web-shared/lib/shared/commerce.ts': commerce,
      '../../styles/catalog/product-price-workspace.css': {},
    },
  );
  const props = {
    rows,
    fields,
    errors: {},
    disabled: false,
    onChange: (transform: (old: typeof rows) => typeof rows) => {
      rows = transform(rows);
      props.rows = rows;
      h.rerender(props);
    },
    onEdit() {},
    onGenerate() {},
  };
  h.mount('ProductVariantsTable', props);
  function node(type: string, label?: string) {
    const all = uiElements(h.tree());
    const result = [...all, ...all.flatMap((v) => uiElements(v.props.action))].find(
      (n) => n.type === type && (!label || n.props.label === label || uiText(n) === label),
    );
    assert.ok(result, type + ': ' + label);
    return result;
  }
  return {
    h,
    props,
    node,
    rows: () => rows,
    async select() {
      (node('DataGrid').props.onRowSelectionModelChange as (value: unknown) => void)({
        type: 'include',
        ids: new Set(['one', 'two']),
      });
      await h.settle();
    },
    async value(value: string) {
      (node('ProductTextField', 'مبلغ به تومان').props.onChange as (event: unknown) => void)({
        target: { value },
      });
      await h.settle();
    },
    async click(label: string) {
      (node('Button', label).props.onClick as () => void)();
      await h.settle();
    },
  };
}
test('bulk price preview is exact and cannot apply a negative fixed price', async () => {
  const x = setup();
  await x.select();
  await x.value('-10');
  await x.click('پیش‌نمایش');
  assert.equal(x.rows()[0].price, '900719925474099.1');
  assert.ok(uiText(x.h.tree()).includes('مبلغ معتبر'));
  assert.ok(
    !uiElements(x.h.tree()).some((v) => v.type === 'Button' && uiText(v) === 'اعمال در فرم'),
  );
  await x.value('۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹٫۲');
  await x.click('پیش‌نمایش');
  assert.equal(x.rows()[0].price, '900719925474099.1');
  await x.click('اعمال در فرم');
  assert.deepEqual(
    x.rows().map((r) => r.price),
    ['900719925474099.2', '900719925474099.2'],
  );
  x.h.unmount();
});
test('setting a bulk price fills empty variants while relative changes require an existing price', async () => {
  const x = setup(false, '');
  await x.select();
  await x.value('۱۲۳٫۴');
  const operation = x.node('ProductTextField', 'نوع تغییر');
  const setOperation = operation.props.onChange as (event: unknown) => void;
  setOperation({ target: { value: 'add' } });
  await x.h.settle();
  await x.click('پیش‌نمایش');
  assert.ok(uiText(x.h.tree()).includes('ابتدا قیمت نامعتبر'));
  assert.equal(x.rows()[0].price, '');
  setOperation({ target: { value: 'set' } });
  await x.h.settle();
  await x.click('پیش‌نمایش');
  await x.click('اعمال در فرم');
  assert.deepEqual(
    x.rows().map((row) => row.price),
    ['123.4', '123.4'],
  );
  x.h.unmount();
});
test('a stale preview cannot overwrite a subsequently edited row and columns stay stable while typing', async () => {
  const x = setup();
  await x.select();
  await x.value('100');
  await x.click('پیش‌نمایش');
  const grid = x.node('DataGrid');
  assert.equal(grid.props.nonce, 'document-bound-nonce');
  const before = grid.props.columns as { field: string; renderCell?: (p: unknown) => unknown }[];
  const price = before.find((c) => c.field === 'price')!.renderCell!({
    row: { ...x.rows()[0], errors: {} },
  });
  const input = uiElements(price).find((v) => v.type === 'TextField')!;
  (input.props.onChange as (event: unknown) => void)({ target: { value: '20' } });
  await x.h.settle();
  assert.equal(
    x.node('DataGrid').props.columns,
    before,
    'ordinary price edits retain stable DataGrid column definitions',
  );
  await x.click('اعمال در فرم');
  assert.equal(x.rows()[0].price, '20');
  assert.equal(x.rows()[1].price, '10');
  assert.ok(uiText(x.h.tree()).includes('پس از پیش‌نمایش تغییر کرده‌اند'));
  x.h.unmount();
});

test('compact variant cards select the same SKU and apply a group price change only to that SKU', async () => {
  const x = setup(true);
  assert.ok(!uiElements(x.h.tree()).some((node) => node.type === 'DataGrid'));
  (x.node('Checkbox').props.onChange as () => void)();
  await x.h.settle();
  await x.value('100');
  await x.click('پیش‌نمایش');
  await x.click('اعمال در فرم');
  assert.deepEqual(
    x.rows().map((row) => row.price),
    ['100', '10'],
  );
  x.h.unmount();
});

test('select all and caret movement stay inside a grid text field while Tab reaches the grid', () => {
  const x = setup();
  const columns = x.node('DataGrid').props.columns as {
    field: string;
    renderCell?: (p: unknown) => unknown;
  }[];
  for (const field of ['sku', 'price', 'referencePrice']) {
    const cell = columns.find((column) => column.field === field)!.renderCell!({
      row: { ...x.rows()[0], errors: {} },
    });
    const input = uiElements(cell).find((element) => element.type === 'TextField')!;
    const keyDown = input.props.onKeyDown as (event: unknown) => void;
    const stopped: string[] = [];
    for (const key of ['a', 'ArrowLeft', 'Tab', 'Escape']) {
      keyDown({ key, metaKey: key === 'a', stopPropagation: () => stopped.push(key) });
    }
    assert.deepEqual(stopped, ['a', 'ArrowLeft']);
  }
  x.h.unmount();
});

test('variant search limits the table and clears prior bulk selection', async () => {
  const x = setup();
  await x.select();
  const search = x.node('TextField', 'جست‌وجوی تنوع، رنگ یا SKU');
  (search.props.onChange as (event: unknown) => void)({ target: { value: 'demo-۲' } });
  await x.h.settle();
  assert.deepEqual(
    Array.from(x.node('DataGrid').props.rows as { sku: string }[], (row) => row.sku),
    ['DEMO-2'],
  );
  assert.equal((x.node('DataGrid').props.rowSelectionModel as { ids: Set<string> }).ids.size, 0);
  x.h.unmount();
});
