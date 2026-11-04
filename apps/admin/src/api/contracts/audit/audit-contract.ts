import { z } from 'zod';

const auditId = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .refine((value) => BigInt(value) <= 9223372036854775807n);

const auditEvent = z.object({
  id: auditId,
  at: z.iso.datetime({ offset: true }),
  action: z.string().max(100),
  resource: z.string().max(500),
  actorId: z.string().max(450),
  traceId: z.string().max(100),
  staffDisplayName: z.string().max(200).nullish(),
  staffTargetId: z.string().max(450).nullish(),
  staffTargetDisplayName: z.string().max(200).nullish(),
});

export const auditPage = z
  .object({
    schemaVersion: z.literal(1),
    nextCursor: auditId.nullish(),
    items: z.array(auditEvent).max(50),
  })
  .refine(
    ({ items, nextCursor }) =>
      (!nextCursor || (items.length === 50 && items.at(-1)?.id === nextCursor)) &&
      items.every((item, index) => index === 0 || BigInt(items[index - 1].id) > BigInt(item.id)),
  );

export type AuditEvent = z.infer<typeof auditEvent>;

export const emptyAuditFilters = {
  q: '',
  actor: '',
  action: '',
  resource: '',
  trace: '',
  from: '',
  before: '',
};
export type AuditFilters = typeof emptyAuditFilters;

const names: Record<string, string> = {
  POST: 'ثبت عملیات',
  PUT: 'به‌روزرسانی',
  PATCH: 'ویرایش',
  DELETE: 'درخواست حذف',
  GET: 'مشاهده',
  STAFF_CREATED: 'ایجاد حساب همکار',
  STAFF_GRANTED: 'اعطای دسترسی همکار',
  STAFF_ENABLED: 'فعال‌کردن حساب همکار',
  STAFF_DISABLED: 'غیرفعال‌کردن حساب همکار',
  STAFF_SESSIONS_REVOKED: 'ابطال نشست‌های همکار',
  STAFF_INITIAL_PASSWORD_CHANGED: 'تغییر رمز اولیهٔ همکار',
  STAFF_PASSWORD_CHANGED: 'تغییر رمز شخصی همکار',
  STAFF_PASSWORD_FAILED: 'تلاش ناموفق برای تغییر رمز',
  MFA_CODES_GENERATED: 'ایجاد کدهای پشتیبان',
  MFA_RECOVERY_STARTED: 'شروع بازیابی ورود دومرحله‌ای',
  MFA_RECOVERY_COMPLETED: 'تکمیل بازیابی ورود دومرحله‌ای',
  CUSTOMER_SMS_SETTINGS_SAVED: 'ذخیرهٔ تنظیمات پیامک مشتری',
  CUSTOMER_OTP_VERIFY_FAILED: 'تأیید ناموفق کد ورود مشتری',
  CMS_PAGE_PUBLISH: 'انتشار صفحه',
  CMS_BLOG_POST_PUBLISH: 'انتشار مقاله',
  ORDER_PARCEL_PACK: 'بسته‌بندی سفارش',
  ORDER_PARCEL_REPACK: 'اصلاح بسته‌بندی',
  ORDER_PARCEL_VOID: 'ابطال بسته',
  ORDER_PARCEL_DISPATCH: 'ارسال بسته',
  ORDER_PARCEL_DELIVER: 'ثبت تحویل بسته',
  ORDER_DIGITAL_DELIVERY: 'تحویل کالای دیجیتال',
  RMA_SUBMIT: 'ثبت درخواست مرجوعی',
  RMA_WITHDRAW: 'انصراف از مرجوعی',
  RMA_REVIEW_START: 'شروع بررسی مرجوعی',
  RMA_REVIEW_COMPLETE: 'ثبت نتیجهٔ بررسی مرجوعی',
  PRIVATE_FILE_READ: 'مشاهدهٔ فایل خصوصی',
  PRIVATE_FILE_ATTACH: 'پیوست فایل خصوصی',
};

export function auditActionLabel(action: string) {
  if (action.startsWith('STAFF_ROLE_ADDED:')) return 'افزودن نقش';
  if (action.startsWith('STAFF_ROLE_REMOVED:')) return 'برداشتن نقش';
  return names[action] ?? 'رویداد ثبت‌شده';
}

export function auditResourceLabel(path: string) {
  const scope = path
    .replace(/^\/api\/(?:admin\/)?/, '')
    .replace(/^\//, '')
    .split('/')[0];
  return (
    (
      {
        staff: 'کارکنان',
        auth: 'امنیت و ورود',
        orders: 'سفارش',
        returns: 'مرجوعی',
        reviews: 'دیدگاه‌ها',
        tickets: 'تیکت',
        support: 'پشتیبانی',
        customers: 'مشتریان',
        inventory: 'انبار',
        'inventory-history': 'انبار',
        catalog: 'کاتالوگ',
        brands: 'برندها',
        categories: 'دسته‌ها',
        payments: 'پرداخت',
        'credit-orders': 'خرید چکی',
        credit: 'اعتبار',
        content: 'تنظیمات محتوا',
        cms: 'محتوا',
        'blog-posts': 'مقاله‌ها',
        pages: 'صفحه‌ها',
        sms: 'پیامک',
      } as Record<string, string>
    )[scope] ?? 'سایر'
  );
}
