export const physicalOrderCapacityCode = 'fulfillment_order_capacity_conflict';
export function isPhysicalOrderCapacityError(error: unknown) {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === physicalOrderCapacityCode
  );
}
export function physicalOrderCapacityMessage(locale: 'fa' | 'en') {
  return locale === 'fa'
    ? 'مجموع دستگاه‌های دارای سریال یا IMEI در هر سفارش حداکثر ۱۰۰ عدد است. تعداد را کاهش دهید یا اقلام را در سفارش‌های جدا ثبت کنید. درخواست ردشده رزرو تازه‌ای ایجاد نمی‌کند.'
    : 'Each order supports at most 100 devices tracked by serial number or IMEI. Reduce their quantities or split them into separate orders. A rejected request creates no new stock hold.';
}
export const digitalOrderCapacityCode = 'digital_delivery_order_capacity_conflict';
export const digitalMetadataCapacityCode = 'digital_delivery_metadata_capacity_conflict';
export function isDigitalMetadataCapacityError(error: unknown) {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === digitalMetadataCapacityCode
  );
}
export function isDigitalOrderCapacityError(error: unknown) {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === digitalOrderCapacityCode
  );
}
export function digitalOrderCapacityMessage(
  locale: 'fa' | 'en',
  failure: 'capacity' | 'metadata' = 'capacity',
) {
  if (failure === 'metadata')
    return locale === 'fa'
      ? 'حجم مشخصات یکی از کالاهای دیجیتال برای تحویل امن بیش از حد مجاز است. برای اصلاح مشخصات کالا با پشتیبانی تماس بگیرید؛ کاهش تعداد به‌تنهایی این مورد را حل نمی‌کند.'
      : 'A digital item’s metadata exceeds the secure delivery limit. Contact support to correct its product details; reducing quantity alone will not resolve this.';
  return locale === 'fa'
    ? 'تعداد کالای دیجیتال سبد از ظرفیت تحویل بیشتر است. تعداد را به حداکثر ۱۰۲۴ واحد برای سفارش فقط دیجیتال یا ۱۰۰۸ واحد برای سفارش همراه کالای فیزیکی کاهش دهید و دوباره محاسبه کنید.'
    : 'The cart exceeds digital delivery capacity. Reduce digital items to at most 1,024 units for a digital-only order, or 1,008 units when physical items are included, then calculate again.';
}
