import { useState, type Ref } from 'react';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import { AdapterDateFnsJalali } from '@mui/x-date-pickers/AdapterDateFnsJalali';
import { faIR } from 'date-fns-jalali/locale/fa-IR';
import {
  dateFieldValue,
  dateFieldWire,
  type DateEncoding,
} from '../../utils/persian-date-contract';

export function PersianDateField({
  label,
  value,
  onChange,
  encoding = 'local',
  precision = 'second',
  required = false,
  disabled = false,
  error,
  helperText,
  name,
  id,
  onBlur,
  inputRef,
  form,
  onKeyDown,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  encoding?: DateEncoding;
  precision?: 'minute' | 'second';
  required?: boolean;
  disabled?: boolean;
  error?: string;
  helperText?: string;
  name?: string;
  id?: string;
  onBlur?: () => void;
  inputRef?: Ref<HTMLInputElement>;
  form?: string;
  onKeyDown?: (event: {
    key: string;
    preventDefault: () => void;
    stopPropagation: () => void;
    nativeEvent: { isComposing: boolean };
  }) => void;
}) {
  const [invalid, setInvalid] = useState(false);
  const [draft, setDraft] = useState(() => ({
    wire: value,
    picker: dateFieldValue(value, encoding),
  }));
  const message =
    error ||
    (invalid
      ? 'تاریخ شمسی معتبر را کامل وارد کنید یا از تقویم انتخاب کنید.'
      : value && !dateFieldValue(value, encoding)
        ? 'تاریخ فعلی معتبر نیست؛ دوباره انتخاب کنید.'
        : undefined);
  const localLabel =
    encoding === 'utc'
      ? label.replace(/میلادی/g, 'شمسی').replace(/(?:با مبنای |به |— )?UTC/g, 'وقت دستگاه')
      : label;
  const clockHint =
    encoding === 'utc'
      ? 'نمایش شمسی و ساعت به وقت دستگاه شماست؛ هنگام ذخیره به UTC تبدیل می‌شود.'
      : encoding === 'local'
        ? 'نمایش شمسی و ساعت به وقت دستگاه شماست.'
        : undefined;
  const common = {
    label: localLabel,
    value: draft.wire === value ? draft.picker : dateFieldValue(value, encoding),
    disabled,
    name,
    inputRef,
    onChange: (next: Date | null, context: { validationError: unknown }) => {
      const failed = context.validationError != null;
      setInvalid(failed);
      // Retain the incomplete picker draft, while invalidating the parent's
      // wire value. Optional date filters must not silently submit as empty.
      const full = dateFieldWire(next, encoding);
      const wire = failed
        ? 'invalid-date'
        : encoding !== 'date' && precision === 'minute'
          ? full.slice(0, 16)
          : full;
      setDraft({ wire, picker: next });
      onChange(wire);
    },
    onError: (reason: unknown) => setInvalid(reason != null),
    slotProps: {
      textField: {
        id,
        slotProps: { htmlInput: { form } },
        onKeyDown,
        required,
        onBlur,
        error: Boolean(message),
        helperText: message || [helperText, clockHint].filter(Boolean).join(' '),
        fullWidth: true,
        size: 'small' as const,
      },
    },
  };
  return (
    <LocalizationProvider dateAdapter={AdapterDateFnsJalali} adapterLocale={faIR}>
      {encoding === 'date' ? (
        <DatePicker {...common} format="yyyy/MM/dd" />
      ) : (
        <DateTimePicker
          {...common}
          ampm={false}
          format={precision === 'minute' ? 'yyyy/MM/dd HH:mm' : 'yyyy/MM/dd HH:mm:ss'}
          views={
            precision === 'minute'
              ? ['year', 'month', 'day', 'hours', 'minutes']
              : ['year', 'month', 'day', 'hours', 'minutes', 'seconds']
          }
        />
      )}
    </LocalizationProvider>
  );
}
