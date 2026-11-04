import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  digitalUiHarness,
  uiElements,
  uiText,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
import * as contract from '../src/api/contracts/catalog/product-workspace-contract.ts';
import * as model from '../src/features/catalog/product-column-filter-model.ts';
import * as editor from '../src/features/catalog/product-editor-model.ts';

test('price column applies exact Persian toman input to the server query and rejects inverted ranges', async () => {
  const applied: Partial<contract.WorkspaceFilters>[] = [];
  const h = digitalUiHarness(
    fileURLToPath(new URL('../src/features/catalog/product-column-filter.tsx', import.meta.url)),
    {
      ...Object.fromEntries(
        ['Autocomplete', 'Box', 'Button', 'MenuItem', 'Stack', 'TextField', 'Typography'].map(
          (name) => ['@mui/material/' + name, name],
        ),
      ),
      './product-column-filter-model': model,
      './product-editor-model': editor,
      '../../api/contracts/catalog/product-workspace-contract': contract,
      '../../components/forms/persian-date-field': { PersianDateField: 'DateField' },
      '../../types/types': { nameOf: () => '' },
    },
  );
  h.mount('ProductColumnFilter', {
    column: 'price',
    filters: { ...contract.initialWorkspaceFilters, search: 'SKU' },
    data: { categories: [], brands: [] },
    onApply: (patch: Partial<contract.WorkspaceFilters>) => applied.push(patch),
    onSort() {},
    onClose() {},
  });
  async function change(label: string, value: string) {
    const field = uiElements(h.tree()).find((node) => node.props.label === label)!;
    (field.props.onChange as (event: unknown) => void)({ target: { value } });
    await h.settle();
  }
  async function submit() {
    const form = uiElements(h.tree()).find((node) => node.props.component === 'form')!;
    (form.props.onSubmit as (event: unknown) => void)({ preventDefault() {} });
    await h.settle();
  }
  await change('حداقل (تومان)', '۹۰۰٬۷۱۹٬۹۲۵٬۴۷۴٬۰۹۹٫۳');
  await change('حداکثر (تومان)', '۱');
  await submit();
  assert.equal(applied.length, 0);
  assert.ok(uiText(h.tree()).includes('بازه معتبر نیست'));
  for (const label of ['حداقل (تومان)', 'حداکثر (تومان)']) {
    assert.equal(
      uiElements(h.tree()).find((node) => node.props.label === label)?.props.error,
      true,
    );
  }
  await change('حداکثر (تومان)', '');
  assert.equal(
    uiElements(h.tree()).find((node) => node.props.label === 'حداکثر (تومان)')?.props.error,
    false,
  );
  await submit();
  const path = contract.workspaceProductsPath({
    ...contract.initialWorkspaceFilters,
    search: 'SKU',
    ...applied[0],
  });
  const query = new URL(path, 'http://localhost').searchParams;
  assert.equal(query.get('minPriceRial'), '9007199254740993');
  assert.equal(query.get('maxPriceRial'), null);
  assert.equal(query.get('search'), 'SKU');
  h.unmount();
});

test('a selected calendar day is sent as a local-day interval and opens back as the same day', () => {
  const day = '2026-10-30';
  const lower = model.productDayBoundary(day)!;
  const upper = model.productDayBoundary(day, true)!;
  assert.ok(lower < upper);
  assert.equal(new Date(lower).getHours(), 0);
  assert.equal(new Date(upper).getHours(), 0);
  assert.equal(model.productDayInput(lower), day);
  assert.equal(model.productDayInput(upper, true), day);
  assert.throws(() => model.productDayBoundary('2026-02-29'));
});
