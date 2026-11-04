import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  digitalUiHarness,
  uiElements,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
import * as dates from '../src/utils/persian-date-contract.ts';
function setup(encoding: 'utc' | 'date' | 'local' = 'utc') {
  const changes: string[] = [];
  const props = {
    label: 'زمان وقوع — UTC',
    value: encoding === 'date' ? '2026-03-21' : '2026-03-21T10:20:30',
    encoding,
    onChange: (value: string) => {
      changes.push(value);
      props.value = value;
      h.rerender(props);
    },
    form: 'unrelated-filter-owner',
  };
  const h = digitalUiHarness(
    fileURLToPath(new URL('../src/components/forms/persian-date-field.tsx', import.meta.url)),
    {
      '@mui/x-date-pickers/LocalizationProvider': { LocalizationProvider: 'LocalizationProvider' },
      '@mui/x-date-pickers/DatePicker': { DatePicker: 'DatePicker' },
      '@mui/x-date-pickers/DateTimePicker': { DateTimePicker: 'DateTimePicker' },
      '@mui/x-date-pickers/AdapterDateFnsJalali': { AdapterDateFnsJalali: 'AdapterDateFnsJalali' },
      'date-fns-jalali/locale/fa-IR': { faIR: {} },
      '../../utils/persian-date-contract': dates,
    },
  );
  h.mount('PersianDateField', props);
  const picker = () =>
    uiElements(h.tree()).find(
      (v) => v.type === (encoding === 'date' ? 'DatePicker' : 'DateTimePicker'),
    )!;
  return { h, props, picker, changes };
}
test('an incomplete Jalali edit invalidates the parent wire instead of silently keeping the old financial date', async () => {
  const x = setup();
  const invalid = new Date(NaN);
  (x.picker().props.onChange as (value: Date, context: unknown) => void)(invalid, {
    validationError: 'invalidDate',
  });
  await x.h.settle();
  assert.deepEqual(x.changes, ['invalid-date']);
  assert.ok(Number.isNaN((x.picker().props.value as Date).getTime()));
  const slot = x.picker().props.slotProps as { textField: { error: boolean; helperText: string } };
  assert.equal(slot.textField.error, true);
  assert.ok(slot.textField.helperText.includes('تاریخ شمسی معتبر'));
  x.h.unmount();
});
test('UTC wire is preserved as an instant, while the field explicitly labels its local display and retains form isolation', () => {
  const x = setup();
  assert.ok(String(x.picker().props.label).includes('وقت دستگاه'));
  const slot = x.picker().props.slotProps as {
    textField: { helperText: string; slotProps: { htmlInput: { form: string } } };
  };
  assert.ok(slot.textField.helperText.includes('به UTC تبدیل'));
  assert.equal(slot.textField.slotProps.htmlInput.form, 'unrelated-filter-owner');
  assert.equal((x.picker().props.value as Date).toISOString(), '2026-03-21T10:20:30.000Z');
  x.h.unmount();
});
test('a civil date has no invented midnight UTC shift and an empty choice clears only that date', async () => {
  const x = setup('date');
  assert.equal(x.picker().props.format, 'yyyy/MM/dd');
  (x.picker().props.onChange as (value: null, context: unknown) => void)(null, {
    validationError: null,
  });
  await x.h.settle();
  assert.deepEqual(x.changes, ['']);
  x.h.unmount();
});
