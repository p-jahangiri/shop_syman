import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import * as dates from '../src/utils/persian-date-contract.ts';
import * as contract from '../src/api/contracts/catalog/used-items-contract.ts';
import * as photoContract from '@sayman/web-shared/lib/catalog/used-condition-contract.ts';
import {
  digitalUiHarness,
  uiElements,
  uiText,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';

test('actual inspection editor locks save/edit/retry while uploading and preserves bilingual photos in the exact uncertain command', async () => {
  const file = fileURLToPath(new URL('../src/pages/catalog/used-items.tsx', import.meta.url)),
    issued = '/media/catalog/' + 'a'.repeat(32) + '/card.webp';
  let uploading = false,
    fail = true;
  const calls: { path: string; input: unknown }[] = [],
    detail = {
      schemaVersion: 1,
      variantId: 'USED-1',
      productId: 'PHONE',
      sku: 'USED-1',
      variantVersion: 'AAAAAAAAAAE=',
      inspection: null,
    };
  const h = digitalUiHarness(
    file,
    {
      '../../components/filters/admin-filters': { AdminFilterForm: 'AdminFilterForm' },
      '../../components/tables/admin-table': { AdminTable: 'AdminTable' },
      '@tanstack/react-query': {},
      '../../utils/persian-date-contract': dates,
      '../../components/forms/persian-date-field': { PersianDateField: 'PersianDateField' },
      '../../api/api': {
        api() {},
        ApiError: class ApiError extends Error {},
        async save(path: string, input: unknown) {
          calls.push({ path, input: structuredClone(input) });
          if (fail) throw Error('lost response');
          return {
            schemaVersion: 1,
            replayed: true,
            detail: {
              ...detail,
              variantVersion: 'AAAAAAAAAAI=',
              inspection: (input as { inspection: unknown }).inspection,
            },
          };
        },
      },
      '../../components/ui': { Busy: 'Busy', ErrorBox: 'ErrorBox', Field: 'Field' },
      '../../features/media/media': { ImageEditor: 'ImageEditor' },
      '../../features/content/cms-image-uploads': {
        useCmsImageUploads: () => ({
          busy: uploading,
          isBusy: () => uploading,
          setBusy: (_field: string, value: boolean) => {
            uploading = value;
          },
        }),
      },
      '../../api/contracts/catalog/used-items-contract': contract,
      '@sayman/web-shared/lib/catalog/used-condition-contract.ts': photoContract,
      '@sayman/web-shared/components/catalog/used-condition': {
        UsedConditionReport: 'UsedConditionReport',
      },
      '../../auth/admin-view-authority': { adminViewRevision: () => 0 },
    },
    {},
    'export { InspectionEditor };',
  );
  h.mount('InspectionEditor', { detail, writable: true, onReload() {} });
  await h.settle();
  const node = (match: (n: ReturnType<typeof uiElements>[number]) => boolean) => {
    const value = uiElements(h.tree()).find(match);
    assert.ok(value);
    return value;
  };
  const image = () => node((n) => n.type === 'ImageEditor'),
    save = () => node((n) => n.type === 'button' && /ثبت نسخهٔ تازه/.test(uiText(n)));
  const alt = (label: string) =>
    uiElements(node((n) => n.type === 'Field' && n.props.label === label).props.children).find(
      (n) => n.type === 'input',
    )!;
  assert.equal(image().props.max, 12);
  assert.equal(image().props.allowExternal, false);
  (image().props.onChange as (urls: string[]) => void)(
    Array.from(
      { length: 13 },
      (_, index) => `/media/catalog/${(index + 1).toString(16).padStart(32, '0')}/card.webp`,
    ),
  );
  await h.settle();
  assert.equal((image().props.value as string[]).length, 0);
  (image().props.onChange as (urls: string[]) => void)(['/products/model.webp']);
  await h.settle();
  assert.equal((image().props.value as string[]).length, 0);
  (image().props.onBusy as (v: boolean) => void)(true);
  h.rerender();
  await h.settle();
  (save().props.onClick as () => void)();
  await h.settle();
  assert.equal(calls.length, 0);
  (image().props.onChange as (urls: string[]) => void)([issued]);
  await h.settle();
  (alt('متن جایگزین فارسی').props.onChange as (e: unknown) => void)({
    target: { value: 'در زمان آپلود نباید ثبت شود' },
  });
  await h.settle();
  assert.equal(alt('متن جایگزین فارسی').props.value, '');
  (image().props.onBusy as (v: boolean) => void)(false);
  h.rerender();
  await h.settle();
  (alt('متن جایگزین فارسی').props.onChange as (e: unknown) => void)({
    target: { value: 'خط روی همین دستگاه' },
  });
  (alt('English image alternative').props.onChange as (e: unknown) => void)({
    target: { value: 'Scratch on this unit' },
  });
  await h.settle();
  const submit = save().props.onClick as () => void;
  submit();
  submit();
  await h.settle();
  assert.equal(calls.length, 1);
  assert.equal(image().props.disabled, true);
  const bytes = JSON.stringify(calls[0]);
  uploading = true;
  h.rerender();
  await h.settle();
  (
    node((n) => n.type === 'button' && /پیگیری همان ثبت/.test(uiText(n))).props
      .onClick as () => void
  )();
  await h.settle();
  assert.equal(calls.length, 1);
  uploading = false;
  fail = false;
  h.rerender();
  await h.settle();
  (
    node((n) => n.type === 'button' && /پیگیری همان ثبت/.test(uiText(n))).props
      .onClick as () => void
  )();
  await h.settle();
  assert.equal(calls.length, 2);
  assert.equal(JSON.stringify(calls[1]), bytes);
  h.unmount();
});
