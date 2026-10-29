import type { ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { save } from './api';
import { Field } from './ui';
import type { Translation } from './types';
export function Text({
  label,
  value,
  onChange,
  required = false,
  type = 'text',
  dir,
  hint,
  disabled = false,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
  dir?: 'ltr' | 'rtl';
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        type={type}
        dir={dir}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        disabled={disabled}
      />
    </Field>
  );
}
export function Area({
  label,
  value,
  onChange,
  dir,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  dir?: 'ltr' | 'rtl';
}) {
  return (
    <Field label={label}>
      <textarea dir={dir} value={value} onChange={(e) => onChange(e.target.value)} rows={3} />
    </Field>
  );
}
export function Translations({
  value,
  onChange,
}: {
  value: Translation[];
  onChange: (v: Translation[]) => void;
}) {
  return (
    <div className="translations">
      {(['fa', 'en'] as const).map((locale) => {
        const tr = value.find((t) => t.locale === locale) ?? { locale, name: '', description: '' };
        const change = (p: Partial<Translation>) =>
          onChange(value.map((t) => (t.locale === locale ? { ...t, ...p } : t)));
        return (
          <fieldset key={locale} dir={locale === 'en' ? 'ltr' : 'rtl'}>
            <legend>{locale === 'fa' ? 'محتوای فارسی' : 'English content'}</legend>
            <Text
              label={locale === 'fa' ? 'عنوان فارسی' : 'English title'}
              value={tr.name}
              onChange={(name) => change({ name })}
              required
            />
            <Area
              label={locale === 'fa' ? 'توضیحات فارسی' : 'English description'}
              value={tr.description ?? ''}
              onChange={(description) => change({ description })}
            />
          </fieldset>
        );
      })}
    </div>
  );
}
export function useSave(path: string, onDone: () => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (value: unknown) => save(path, value, path.split('/').length > 3 ? 'PUT' : 'POST'),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['admin'] });
      onDone();
    },
  });
}
export function FormActions({
  pending,
  onClose,
  children,
}: {
  pending: boolean;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="form-actions">
      <button className="primary" disabled={pending} type="submit">
        {pending ? 'در حال ذخیره…' : 'ذخیره تغییرات'}
      </button>
      <button onClick={onClose} type="button" disabled={pending}>
        انصراف
      </button>
      {children}
    </div>
  );
}
