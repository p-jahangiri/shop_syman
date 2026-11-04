import { Field } from '../../components/ui';
import type { PurchaseMethod } from '../../types/types';

export const purchaseDependencyNames: Record<PurchaseMethod['kind'], string> = {
  online: 'نقدی آنلاین',
  cheque: 'چکی',
  installment: 'اقساط ارائه‌دهنده',
};

export function CmsPurchaseDependencyField({
  value,
  onChange,
  label = 'وابستگی نمایش به نوع خرید (اختیاری)',
}: {
  value?: PurchaseMethod['kind'];
  onChange: (value: PurchaseMethod['kind'] | undefined) => void;
  label?: string;
}) {
  return (
    <Field
      label={label}
      hint="با غیرفعال‌شدن همهٔ روش‌های نوع انتخاب‌شده، این محتوا موقتاً پنهان می‌شود؛ متن و تاریخچه حذف نمی‌شوند. وضعیت نمایش و زمان‌بندی خود محتوا هم برقرار است."
    >
      <select
        value={value ?? ''}
        onChange={(event) =>
          onChange((event.target.value || undefined) as PurchaseMethod['kind'] | undefined)
        }
      >
        <option value="">بدون وابستگی به نوع خرید</option>
        {Object.entries(purchaseDependencyNames).map(([kind, name]) => (
          <option key={kind} value={kind}>
            {name}
          </option>
        ))}
      </select>
    </Field>
  );
}
