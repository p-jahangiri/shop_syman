import { useState } from 'react';
import { Check } from '../../components/ui';
import {
  changeCustomerLogin,
  hasSupportedCustomerLogin,
  customerLoginChoices,
  unavailableAuthChoices,
} from './customer-auth-settings';

export function CustomerAuthSettingsEditor({
  value,
  onChange,
}: {
  value: Record<string, boolean>;
  onChange: (value: Record<string, boolean>) => void;
}) {
  const [error, setError] = useState<string>();
  return (
    <div className="auth-settings">
      <p className="notice">
        تنظیم ورود مشتریان سراسری است و از سند فارسی مدیریت می‌شود. حداقل یکی از روش‌های ایمیل و
        رمز، نام کاربری و رمز یا کد پیامک را در پیش‌نویس فعال نگه دارید. ذخیره، پیش‌نویس است؛ آمادگی
        واقعی سرویس و راه ورود حساب‌های فعلی هنگام انتشار یا بازگردانی روی سرور بررسی می‌شوند. اگر
        انتشار پذیرفته نشود، پیش‌نویس حفظ می‌شود. رمز و Authenticator کارکنان مستقل‌اند.
      </p>
      <fieldset>
        <legend>روش‌های ورود درخواستی فروشگاه</legend>
        {customerLoginChoices.map(({ key, label }) => (
          <Check
            key={key}
            label={label}
            checked={value[key] === true}
            onChange={(event) => {
              const next = changeCustomerLogin(value, key, event.target.checked);
              if (!next) {
                setError(
                  'آخرین روش ورود را نمی‌توان خاموش کرد؛ حداقل ایمیل و رمز، نام کاربری و رمز یا کد پیامک را فعال نگه دارید.',
                );
                return;
              }
              setError(undefined);
              onChange(next);
            }}
          />
        ))}
        <p className="muted">
          سرویس SMS.ir، کلید و قالب تأییدشده را در بخش «پیامک و کد ورود» تنظیم کنید. روشن‌بودن این
          گزینه به‌تنهایی آمادگی ارسال نیست؛ حالت Sandbox هم هویت مشتری را تأیید نمی‌کند. پیش‌نویس
          فقط پیامکی مجاز است، ولی انتشار آن به آمادگی واقعی سرویس و تداوم ورود مشتریان فعلی نیاز
          دارد.
        </p>
      </fieldset>
      {(error || !hasSupportedCustomerLogin(value)) && (
        <p className="error" role="alert">
          {error ??
            'این پیش‌نویس روش ورود ندارد؛ پیش از ذخیره، حداقل یکی از سه روش بالا را فعال کنید.'}
        </p>
      )}
      <fieldset>
        <legend>ساخت حساب مشتری</legend>
        <Check
          label="ثبت‌نام پس از تأیید شماره با کد پیامک"
          checked={value.registration === true}
          onChange={(event) => onChange({ ...value, registration: event.target.checked })}
        />
        <p className="muted">
          حساب جدید فقط پس از تأیید موفق شماره با کد پیامک ساخته می‌شود. این گزینه مستقل از روش ورود
          درخواستی ذخیره می‌شود؛ ثبت‌نام در فروشگاه به فعال‌بودن ورود پیامکی و آمادگی سرویس واقعی هم
          نیاز دارد. روشن‌کردن ثبت‌نام، ورود پیامکی را خودکار روشن نمی‌کند.
        </p>
      </fieldset>
      <fieldset>
        <legend>بازیابی رمز</legend>
        {unavailableAuthChoices.map(({ key, label }) => (
          <div key={key}>
            <Check label={label} checked={false} disabled />
            {value[key] === true && (
              <small>
                در سند قبلی روشن ثبت شده است؛ در فروشگاه مؤثر نیست و با ویرایش سایر گزینه‌ها خودکار
                حذف نمی‌شود.
              </small>
            )}
          </div>
        ))}
        <p className="muted">
          بازیابی رمز فعلاً غیرفعال است. روشن‌بودن مقدار قدیمی در سند آن را در فروشگاه فعال نمی‌کند
          و ویرایش گزینه‌های دیگر، این مقدار قدیمی را خودکار حذف نمی‌کند.
        </p>
      </fieldset>
    </div>
  );
}
