import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  digitalUiHarness,
  uiElements,
  uiText,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
import * as contract from '../src/api/contracts/accounting/accounting-import-contract.ts';

const header = 'externalItemId,externalCode,externalName,externalUnitKey,quantityRaw,priceRaw';
test('an unreadable replacement file cannot stage the previously reviewed report', async () => {
  const staged: contract.AccountingImportInput[] = [];
  class ApiError extends Error {}
  const h = digitalUiHarness(
    fileURLToPath(new URL('../src/pages/accounting/accounting-imports.tsx', import.meta.url)),
    {
      '../../components/forms/persian-date-field': { PersianDateField: 'PersianDateField' },
      '../../components/tables/admin-table': { AdminTable: 'AdminTable' },
      '../../components/filters/admin-filters': { AdminFilterForm: 'AdminFilterForm' },
      '@tanstack/react-query': {},
      '../../api/api': {
        ApiError,
        save: async (path: string, input: contract.AccountingImportInput) => {
          staged.push(input);
          return {
            schemaVersion: 1,
            id: path.split('/').at(-1),
            payloadHash: 'A'.repeat(64),
            replayed: false,
            applied: false,
          };
        },
      },
      '../../auth/admin-view-authority': { adminViewRevision: () => 1 },
      '../../components/ui': { Field: 'Field', Check: 'Check', ErrorBox: 'ErrorBox' },
      '../../components/forms/forms': { Text: 'Text' },
      './accounting-reconciliation': {},
      '../../api/contracts/accounting/accounting-import-contract': contract,
    },
    { TextDecoder, window: { addEventListener() {}, removeEventListener() {} } },
    'export { ImportForm };',
  );
  h.mount('ImportForm', {
    source: { companyKey: 'company', externalWarehouseKey: 'WH-001' },
    onClose() {},
    onSaved() {},
    onLock() {},
  });
  await h.settle();
  const nodes = () => uiElements(h.tree());
  const textarea = () => nodes().find((node) => node.type === 'textarea')!;
  const review = () =>
    nodes().find(
      (node) => node.type === 'button' && uiText(node).includes('بررسی فایل پیش از ذخیره'),
    )!;
  const submit = () =>
    nodes().find(
      (node) => node.type === 'button' && uiText(node).includes('ذخیره فقط در پیش‌نمایش'),
    )!;
  const choose = (name: string, bytes: Uint8Array) => {
    const upload = nodes().find((node) => node.type === 'input' && node.props.type === 'file')!;
    return (upload.props.onChange as (event: unknown) => Promise<void>)({
      currentTarget: {
        files: [{ name, size: bytes.byteLength, arrayBuffer: async () => bytes.buffer }],
        value: name,
      },
    });
  };
  const post = () =>
    (nodes().find((node) => node.type === 'form')!.props.onSubmit as (event: unknown) => void)({
      preventDefault() {},
    });

  (
    nodes().find((node) => node.type === 'PersianDateField')!.props.onChange as (
      value: string,
    ) => void
  )('2026-01-01T10:00');
  (textarea().props.onChange as (event: unknown) => void)({
    target: { value: header + '\nold,,,EA,1,5' },
  });
  await h.settle();
  (review().props.onClick as () => void)();
  await h.settle();
  assert.equal(submit().props.disabled, false);

  await choose('unreadable.csv', new Uint8Array([0xff]));
  await h.settle();
  assert.equal(textarea().props.value, '');
  assert.equal(submit().props.disabled, true);
  post();
  assert.equal(staged.length, 0);

  await choose('correct.csv', new TextEncoder().encode(header + '\nnew,,,EA,2,15'));
  await h.settle();
  assert.equal(submit().props.disabled, true);
  (review().props.onClick as () => void)();
  await h.settle();
  post();
  await h.settle();
  assert.equal(staged.length, 1);
  assert.equal(staged[0].rows[0].externalItemId, 'new');
  h.unmount();
});
