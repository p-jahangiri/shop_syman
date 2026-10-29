import type { StaffRole } from './staff-contract';
const permissions: Record<string, string> = {
  'catalog.read': 'مشاهدهٔ کالا و کاتالوگ',
  'catalog.write': 'ساخت و ویرایش کالا و ویژگی‌ها',
  'inventory.read': 'مشاهدهٔ موجودی و گردش انبار',
  'inventory.write': 'ثبت عملیات انبار و دستگاه‌ها',
  'cms.read': 'مشاهدهٔ محتوا و دیدگاه‌ها',
  'cms.write': 'ویرایش و انتشار محتوا و بررسی دیدگاه',
  'finance.read': 'مشاهدهٔ اطلاعات مالی',
  'finance.write': 'ثبت عملیات و تنظیمات مالی',
  'sales.read': 'مشاهدهٔ سفارش و درخواست تأمین',
  'sales.write': 'مدیریت سفارش و تأمین',
  'customers.read': 'مشاهدهٔ پرونده و اطلاعات تماس مشتریان',
  'staff.read': 'مشاهدهٔ کارکنان و سابقهٔ دسترسی',
  'staff.write': 'ساخت همکار و تغییر نقش یا دسترسی کارکنان',
  'audit.read': 'مشاهدهٔ رویدادهای مدیریتی',
  'support.read': 'مشاهدهٔ تیکت و گفت‌وگو',
  'support.write': 'پاسخ و رسیدگی به تیکت‌ها',
  'credit.read': 'مشاهدهٔ پرونده‌های خرید چکی',
  'credit.write': 'رسیدگی به درخواست و مدارک خرید چکی',
};
export function StaffRoleChoices({
  roles,
  value,
  onChange,
  disabled = false,
}: {
  roles: StaffRole[];
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="staff-role-fieldset">
      <legend>نقش‌های دسترسی</legend>
      <div className="staff-role-card-grid">
        {roles.map((role) => (
          <div
            className={'staff-role-card' + (value.includes(role.id) ? ' is-selected' : '')}
            key={role.id}
          >
            <label className="check">
              <input
                type="checkbox"
                checked={value.includes(role.id)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...value, role.id]
                      : value.filter((id) => id !== role.id),
                  )
                }
              />
              <strong>{role.nameFa}</strong>
            </label>
            <p>
              {role.id === 'Administrator'
                ? 'مدیریت کامل فروشگاه، امور مالی و دسترسی کارکنان'
                : role.permissions.length.toLocaleString('fa-IR') + ' مجوز در محدودهٔ این نقش'}
            </p>
            <details>
              <summary>مشاهدهٔ مجوزهای این نقش</summary>
              <ul>
                {role.permissions.map((permission) => (
                  <li key={permission}>
                    {permissions[permission] ?? 'مجوز تعریف‌شده: ' + permission}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        ))}
      </div>
      <small>
        فقط نقش‌های لازم برای کار همکار را انتخاب کنید. قطع دسترسی از وضعیت حساب انجام می‌شود.
      </small>
    </fieldset>
  );
}
