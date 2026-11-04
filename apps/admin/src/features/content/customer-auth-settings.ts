export const customerLoginContinuityMessage =
  'این تنظیم منتشر یا بازگردانی نشد، چون راه ورود بعضی مشتریان فعلی را می‌بندد. روش‌های لازم برای حساب‌های فعلی را فعال نگه دارید یا شناسه‌ها و شمارهٔ تأییدشدهٔ آن‌ها را پیش از انتشار بررسی کنید؛ پیش‌نویس خودکار تغییر نکرده است.';

export const customerLoginChoices = [
  { key: 'emailPassword', label: 'ورود با ایمیل و رمز' },
  { key: 'usernamePassword', label: 'ورود با نام کاربری و رمز' },
  { key: 'mobileOtp', label: 'ورود با کد پیامک' },
] as const;

export const unavailableAuthChoices = [
  { key: 'passwordReset', label: 'بازیابی رمز با تأیید هویت' },
] as const;

export function hasSupportedCustomerLogin(value: Record<string, boolean>) {
  return (
    value.emailPassword === true || value.usernamePassword === true || value.mobileOtp === true
  );
}

export function changeCustomerLogin(
  value: Record<string, boolean>,
  key: (typeof customerLoginChoices)[number]['key'],
  enabled: boolean,
): Record<string, boolean> | null {
  const next = { ...value, [key]: enabled };
  return hasSupportedCustomerLogin(next) ? next : null;
}
