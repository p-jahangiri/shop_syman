import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h, Fragment } from 'react';
import {
  readTableMarkup,
  tableCellText,
  tableCellValue,
  tableCellMatches,
} from './admin-table-model.ts';
import { compareAdminListValues } from './admin-list-text.ts';

test('record search excludes input secrets and actions but supports Persian rich cells', () => {
  const cell = h(
    'td',
    null,
    h('strong', null, 'گوشی كارا'),
    h('bdi', null, 'SKU-۱۲۸'),
    h('input', { value: 'private-password', type: 'password', readOnly: true }),
    h('button', null, 'ویرایش'),
  );
  assert.equal(tableCellMatches(cell, 'کارا 128'), true);
  assert.equal(tableCellMatches(cell, 'private-password'), false);
  assert.equal(tableCellMatches(cell, 'ویرایش'), false);
  assert.equal(tableCellMatches(h('td', null, 'غیرفعال'), { equals: 'فعال' }), false);
  assert.equal(tableCellMatches(h('td', null, 'فعال'), { equals: 'فعال' }), true);
  assert.equal(tableCellText(h('select', null, h('option', null, 'unused option'))), '');
});
test('raw date and exact amount values sort without localized labels or Number coercion', () => {
  const cell = h('td', { 'data-sort-value': '9007199254740993' }, '۹٬۰۰۷٬۱۹۹٬۲۵۴٬۷۴۰٬۹۹۳ ریال');
  assert.equal(tableCellValue(cell), '9007199254740993');
  assert.ok(compareAdminListValues(tableCellValue(cell), '9007199254740992') > 0);
  assert.ok(compareAdminListValues('۱٬۰۰۰ ریال', '۹۰۰ ریال') > 0);
  assert.ok(compareAdminListValues('-12', '-3') < 0);
  assert.ok(compareAdminListValues(1.5, 1.05) > 0);
});
test('fragment rows keep actual operation handlers; spanning financial totals fall back intact', () => {
  const action = () => undefined;
  const head = h('thead', null, h('tr', null, h('th', null, 'کالا'), h('th', null, 'عملیات')));
  const row = h(
    'tr',
    { key: 'sku-1' },
    h('td', null, 'سامسونگ'),
    h('td', null, h('button', { onClick: action }, 'ویرایش')),
  );
  const body = h('tbody', null, h(Fragment, null, row));
  const model = readTableMarkup([head, body]);
  assert.equal(model?.rows.length, 1);
  const button = model?.rows[0].cells[1].props.children;
  assert.ok(button && typeof button === 'object' && 'props' in button);
  assert.equal((button.props as { onClick: unknown }).onClick, action);
  assert.equal(
    readTableMarkup([
      head,
      h('tbody', null, row, h('tr', null, h('td', { colSpan: 2 }, 'جمع مالی'))),
    ]),
    null,
  );
});
test('empty state does not become a sortable data record', () => {
  const model = readTableMarkup([
    h('thead', null, h('tr', null, h('th', null, 'کالا'), h('th', null, 'عملیات'))),
    h('tbody', null, h('tr', null, h('td', { colSpan: 2 }, 'داده‌ای ندارید'))),
  ]);
  assert.equal(model?.rows.length, 0);
  assert.equal(tableCellText(model?.empty?.props.children), 'داده‌ای ندارید');
});
