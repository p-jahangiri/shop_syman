import { readAdminFieldErrors } from '../features/catalog/product-field-errors';
import { adminRequestHeaders } from './request-headers';
import { customerLoginContinuityMessage } from '../features/content/customer-auth-settings';
import { SessionAccess, SessionChanged, type RenewedAccess } from '../auth/session-access';
import { currentAdminAuthFailure } from '../auth/admin-auth-boundary';
import { AdminAuthTransport, adminAuthLockName } from './auth-transport';
import { adminViewReadSignal } from '../auth/admin-view-authority';
const access = new SessionAccess();
const authTransport = new AdminAuthTransport({
  withLock:
    typeof navigator !== 'undefined' && navigator.locks
      ? <T>(signal: AbortSignal, operation: () => Promise<T>) =>
          navigator.locks.request(adminAuthLockName, { mode: 'exclusive', signal }, operation)
      : undefined,
});
export function setToken(value: string, expiresIn?: number) {
  access.setToken(value, expiresIn);
}
export function setAccessRenewal(value: (() => Promise<RenewedAccess>) | null) {
  access.setRenewal(value);
}
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
  }
}
const messages: Record<string, string> = {
  invalid_product_answer: 'سؤال و پاسخ عمومی را بازبینی کنید.',
  product_not_published: 'این کالا دیگر در فروشگاه منتشر نیست.',
  product_answer_conflict: 'این انتشار با متن دیگری ثبت شده است. گفت‌وگو را تازه‌سازی کنید.',
  product_answers_full: 'تعداد پاسخ‌های عمومی این کالا به سقف رسیده است.',
  invalid_slug: 'نشانی یا کلید باید فقط از حروف کوچک انگلیسی، عدد و خط تیره ساخته شود.',
  invalid_brand: 'نام برند را با حداکثر ۱۲۰ نویسه وارد کنید.',
  invalid_category_tree: 'والد انتخاب‌شده وجود ندارد یا ساختار دسته‌ها را حلقه‌ای می‌کند.',
  invalid_translations: 'عنوان و محتوای فارسی و انگلیسی را بررسی کنید.',
  invalid_options: 'مقدار، برچسب و یکتایی گزینه‌ها را بررسی کنید.',
  attribute_in_use: 'این ویژگی در کالاها مقدار دارد و تغییر نوع آن نیاز به انتقال مقادیر دارد.',
  attribute_option_in_use:
    'این گزینه در کالاها استفاده شده و قابل حذف نیست؛ ابتدا مقدار کالاهای مرتبط را اصلاح کنید.',
  invalid_variant_axis: 'ویژگی چندگزینه‌ای نمی‌تواند محور یک تنوع مستقل باشد.',
  invalid_video: 'فایل MP4/WebM معتبر با کدک پشتیبانی‌شده، حداکثر۳۲مگابایت و۱۰دقیقه انتخاب کنید.',
  video_too_large: 'حجم ویدیو باید حداکثر۳۲مگابایت باشد.',
  invalid_product_videos: 'لینک مستقیم ویدیو و ارتباط آن با تنوع همین کالا را بررسی کنید.',
  video_not_ready: 'پردازش ویدیو کامل نشده است؛ فایل آماده را انتخاب کنید.',
  invalid_product_fields: 'فیلدهای مشخص‌شده را اصلاح کنید.',
  product_command_conflict:
    'شناسهٔ این تلاش قبلاً برای تغییر دیگری استفاده شده؛ رسید همان تلاش را بررسی کنید.',
  product_command_unavailable:
    'نتیجهٔ تغییر کالا هنوز قابل تأیید نیست؛ رسید همان تلاش را بررسی کنید.',
  product_archived: 'کالا بایگانی شده است؛ پیش از ویرایش آن را بازگردانید.',
  product_archive_conflict: 'وضعیت بایگانی تغییر کرده است؛ جدول را تازه کنید.',
  invalid_product_form_fields: 'عنوان، راهنما، ترتیب و نمایش فیلدهای فرم را بررسی کنید.',
  invalid_product_prices: 'قیمت و نسخهٔ تنوع‌های انتخاب‌شده را بررسی کنید.',
  invalid_sms_workspace: 'اتصال‌ها، قالب، نام و دادهٔ متغیرها، کلید و سقف‌های ارسال را بررسی کنید.',
  sms_workspace_conflict:
    'تنظیمات پیامک تغییر کرده است؛ بازخوانی کنید و تغییرهای تازه را روی نسخهٔ جاری اعمال کنید.',
  sms_workspace_upgrade_required: 'تنظیمات پیامک به مرکز پیامک منتقل شده است؛ صفحه را تازه کنید.',
  sms_template_unavailable: 'قالب باید تأییدشده و اتصال آن روشن و دارای کلید معتبر باشد.',
  invalid_staff_confirmation:
    'رمز فعلی یا کد تازهٔ Authenticator صحیح نیست؛ از تکرار تلاش حدسی خودداری کنید.',
  invalid_current_password: 'رمز فعلی صحیح نیست.',
  password_unchanged: 'رمز تازه باید با رمز فعلی متفاوت باشد.',
  password_policy: 'رمز باید حداقل ۱۲ نویسه و شامل حرف بزرگ و کوچک انگلیسی، عدد و نشانه باشد.',
  invalid_sms_settings: 'قالب پیامک، پارامترها و عملیات کلید را بررسی کنید.',
  sms_settings_conflict: 'نسخهٔ تنظیمات پیامک تغییر کرده است؛ تنظیمات جاری را بازخوانی کنید.',
  otp_configuration_conflict:
    'تنظیمات یا وضعیت کد ورود تغییر کرده است؛ وضعیت جاری را بازخوانی کنید.',
  otp_unavailable: 'سرویس کد ورود در دسترس نیست؛ وضعیت ارسال یا تنظیمات را بررسی کنید.',
  customer_login_continuity_conflict: customerLoginContinuityMessage,
  no_supported_login_method:
    'حداقل یک روش ورود را انتخاب کنید: ایمیل و رمز، نام کاربری و رمز یا کد پیامکی.',
  invalid_staff_account: 'نام کاربری، نام، رمز، ایمیل و نقش‌های انتخابی را بررسی کنید.',
  staff_username_conflict: 'این نام کاربری قبلاً ثبت شده است.',
  staff_creation_idempotency_conflict:
    'این شناسه با ورودی دیگری ثبت شده است؛ رسید همان تلاش را پیگیری کنید.',
  staff_creation_unavailable: 'رسید ساخت حساب قابل تأیید نیست؛ بررسی فنی لازم است.',
  staff_password_reused: 'رمز جدید باید با رمز اولیه متفاوت باشد.',
  invalid_parcel: 'عملیات، نسخه، تعداد، دستگاه‌ها و تأیید صریح مرسوله را بررسی کنید.',
  parcel_unavailable: 'تاریخچهٔ مرسوله با اطمینان خوانده نشد؛ رسید همان شناسه را حفظ کنید.',
  parcel_inventory_conflict: 'اطلاعات انبار یا بسته تغییر کرده است؛ بازبسته‌بندی آگاهانه لازم است.',
  parcel_quantity_conflict: 'بخشی از این تعداد در بستهٔ دیگری قرار دارد.',
  parcel_device_conflict: 'این دستگاه در بستهٔ دیگری قرار دارد.',
  parcel_time_conflict: 'زمان واقعی خروج باید پس از بسته‌بندی و مجوز مالی معتبر باشد.',
  parcel_stage_conflict: 'مرحلهٔ بسته تغییر کرده است؛ وضعیت تازه را بازبینی کنید.',
  parcel_capacity_conflict: 'ظرفیت این گردش تکمیل است؛ بسته‌های ارسال‌نشده را بازبینی کنید.',
  shipment_contract_upgrade_required: 'این سفارش از گردش چندبسته‌ای استفاده می‌کند.',

  invalid_cms_blog: 'محتوای دو زبان، نویسندهٔ عمومی، تصویر و برچسب‌های مقاله را بررسی کنید.',
  cms_blog_changed_conflict: 'مقاله تغییر کرده است؛ نسخهٔ تازه را بازبینی کنید.',
  cms_blog_idempotency_conflict: 'این شناسه برای فرمان دیگری از مقاله استفاده شده است.',
  cms_blog_slug_conflict: 'این نشانی مقاله قبلاً ساخته شده است.',
  cms_blog_unavailable: 'نسخهٔ مقاله قابل تأیید نیست؛ بررسی فنی لازم است.',
  cms_blog_busy: 'فرمان دیگری در حال ثبت است؛ همان شناسه را پیگیری کنید.',
  cms_blog_cursor_expired_conflict: 'فهرست مقاله‌ها را از ابتدا تازه کنید.',
  invalid_credit_reminder_policy:
    'روزهای متمایز، ساعت تهران، نسخه و تأیید صریح برنامه را بررسی کنید.',
  credit_reminder_policy_changed_conflict: 'زمان‌بندی تغییر کرده است؛ نسخهٔ تازه را بازبینی کنید.',
  credit_reminder_policy_idempotency_conflict: 'این شناسهٔ تنظیم با ورودی دیگری استفاده شده است.',
  credit_reminder_policy_unavailable: 'تاریخچهٔ تنظیم یادآوری قابل تأیید نیست؛ بررسی فنی لازم است.',
  credit_reminder_policy_busy: 'تنظیم دیگری در حال ثبت است؛ همان شناسه را پیگیری کنید.',
  invalid_credit_reminder: 'نسخه‌ها، تأیید و یادداشت خصوصی همین چک را بررسی کنید.',
  credit_reminder_changed_conflict:
    'وضعیت چک، سفارش یا روز تهران تغییر کرد؛ وضعیت تازه را دریافت کنید.',
  credit_reminder_daily_conflict:
    'برای این چک در روز جاری تهران یادآوری ثبت شده است؛ همان رسید را بررسی کنید.',
  credit_reminder_idempotency_conflict: 'این شناسهٔ یادآوری با ورودی دیگری استفاده شده است.',
  credit_reminder_unavailable: 'تاریخچهٔ یادآوری قابل تأیید نیست؛ بررسی فنی لازم است.',
  invalid_cheque_report: 'بازهٔ تاریخ تهران، وضعیت و صفحهٔ گزارش معتبر نیست؛ گزارش تازه بگیرید.',
  cheque_report_unavailable: 'تمام اسناد این صفحه قابل تأیید نیستند؛ بررسی فنی لازم است.',
  cheque_report_changed_conflict: 'وضعیت یک چک هنگام خواندن تغییر کرد؛ گزارش تازه بگیرید.',
  cheque_report_expired_conflict: 'مهلت فنی صفحه‌بندی تمام شده است؛ گزارش تازه بگیرید.',
  invalid_credit_clearance: 'عملیات، نسخه‌ها، توضیح و بازبینی مالی همین سفارش را صریح تأیید کنید.',
  credit_clearance_changed_conflict:
    'سفارش، شواهد مالی یا وضعیت ارسال تغییر کرده است؛ بازبینی تازه لازم است.',
  credit_clearance_idempotency_conflict:
    'این شناسه ورودی متفاوتی دارد؛ رسید همان تلاش را پیگیری کنید.',
  credit_clearance_unavailable: 'مجوز مالی با اطمینان خوانده نشد؛ همان شناسه را حفظ کنید.',
  credit_clearance_busy: 'ثبت مالی در جریان است؛ همان فرمان را پیگیری کنید.',
  credit_commitment_changed_conflict: 'وضعیت سفارش یا تعهد موجودی تغییر کرده است.',
  shipment_credit_clearance_conflict:
    'مجوز مالی چکی معتبر نیست؛ مالی باید شواهد جاری را دوباره بررسی کند.',
  invalid_credit_upfront: 'عملیات، نسخه‌ها، مرجع، زمان UTC و تأیید دریافت کامل را بررسی کنید.',
  credit_upfront_changed_conflict:
    'سفارش، مهلت، برنامه یا گواهی پیش‌پرداخت تغییر کرده است؛ وضعیت تازه را بازبینی کنید.',
  credit_upfront_idempotency_conflict:
    'این شناسه متعلق به ورودی یا سفارش دیگری است؛ رسید همان تلاش را بررسی کنید.',
  credit_upfront_unavailable: 'اطلاعات پیش‌پرداخت با اطمینان خوانده نشد؛ همان شناسه را نگه دارید.',
  credit_upfront_busy: 'ثبت پیش‌پرداخت در حال انجام است؛ همان فرمان را پیگیری کنید.',
  invalid_cms_redirect: 'نشانی عمومی هم‌زبان، نوع انتقال و تأیید را بررسی کنید.',
  cms_redirect_changed_conflict: 'نسخهٔ انتقال تغییر کرده؛ بازخوانی کنید.',
  cms_redirect_source_conflict: 'این نشانی مبدأ قبلاً ثبت شده است.',
  cms_redirect_graph_conflict: 'این انتشار حلقه یا زنجیره‌ای بیش از پنج انتقال می‌سازد.',
  cms_redirect_incomplete_conflict: 'مقصد و نوع انتقال را صریح ذخیره کنید.',
  cms_redirect_idempotency_conflict: 'شناسهٔ انتقال متعلق به ورودی دیگری است.',
  cms_redirect_unavailable: 'اطلاعات انتقال قابل تأیید نیست؛ همان فرمان را پیگیری کنید.',
  cms_redirect_busy: 'ثبت انتقال در حال انجام است؛ همان شناسه را پیگیری کنید.',
  invalid_cms_page: 'فیلدهای صفحه، بلوک‌ها و تأیید انتشار را بررسی کنید.',
  cms_page_changed_conflict: 'نسخهٔ صفحه تغییر کرده است؛ از سرور بازخوانی کنید.',
  cms_page_idempotency_conflict: 'شناسهٔ فرمان برای ورودی دیگری استفاده شده است.',
  cms_page_slug_conflict: 'این نشانی صفحه قبلاً ثبت شده است.',
  cms_page_unavailable: 'اطلاعات صفحه قابل تأیید نیست؛ سابقه تغییر نکرد.',
  cms_page_busy: 'ثبت صفحه در حال انجام است؛ همان فرمان را پیگیری کنید.',
  invalid_cheque_ledger:
    'مرجع، زمان وقوع UTC، عملیات و تأییدها را بررسی کنید؛ زمان نباید آینده یا زودتر از رویداد قبلی باشد.',
  cheque_ledger_changed_conflict:
    'سفارش، برنامه یا آخرین وضعیت چک تغییر کرده است؛ وضعیت تازه لازم است.',
  cheque_ledger_idempotency_conflict:
    'این شناسه قبلاً برای ورودی دیگری استفاده شده؛ رسید همان فرمان را بررسی کنید.',
  cheque_ledger_unavailable: 'اطلاعات چک با اطمینان خوانده نشد؛ سابقه بازنویسی نشد.',
  cheque_ledger_busy: 'ثبت گردش چک در حال انجام است؛ همان شناسه را پیگیری کنید.',
  credit_schedule_instruments_recorded_conflict:
    'برای این برنامه چک دریافت شده و تاریخ‌های آن ثابت‌اند.',

  invalid_credit_schedule: 'تقویم، تاریخ مبنا، نسخه‌ها و تأیید پیش‌نمایش را بررسی کنید.',
  credit_schedule_changed_conflict:
    'سفارش، مهلت یا نسخهٔ برنامه تغییر کرده است؛ وضعیت تازه و پیش‌نمایش تازه لازم است.',
  credit_schedule_idempotency_conflict:
    'این شناسهٔ پیگیری برای اطلاعات دیگری ثبت شده است؛ رسید همان تلاش را بررسی کنید.',
  credit_schedule_unavailable: 'اطلاعات برنامه با اطمینان خوانده نشد؛ نسخهٔ قدیمی بازنویسی نشد.',
  credit_schedule_busy: 'ثبت برنامه در حال انجام است؛ همان شناسه را پیگیری کنید.',
  invalid_accounting_warehouse:
    'کلیدهای شرکت و انبار، نام‌ها و تأیید محدودهٔ کل ماندهٔ فیزیکی را بررسی کنید.',
  accounting_warehouse_identity_conflict:
    'این هویت قبلاً نگاشت شده است یا هویت نگاشت موجود تغییر کرده؛ همان نگاشت را از فهرست بازخوانی کنید.',
  accounting_warehouse_scope_conflict:
    'فقط یک منبع می‌تواند کل ماندهٔ فیزیکی فروشگاه را نمایندگی کند؛ ابتدا نگاشت فعال قبلی را بررسی کنید.',
  accounting_receipt_unavailable:
    'رسید کامل نگاشت قابل خواندن نیست؛ همان شناسه را برای پیگیری نگه دارید.',
  invalid_accounting_stock_command:
    'ردیف‌های صریح، دلیل اصلاح و هر دو تأیید ماندهٔ فیزیکی و عملیات ثبت‌نشده را بررسی کنید.',
  accounting_stock_version_conflict:
    'فایل، نگاشت، کالا، مانده یا سابقهٔ اعمال تغییر کرده است؛ پیش‌نمایش تازه را دریافت و دوباره بررسی کنید.',
  accounting_stock_conflict:
    'همهٔ ردیف‌های انتخاب‌شده باید قابل اصلاح باشند؛ تعهدات، منبع فیزیکی، رهگیری و سابقهٔ همان ردیف را بررسی کنید.',
  accounting_stock_receipt_unavailable:
    'رسید کامل و تاریخی موجودی قابل تأیید نیست؛ شناسهٔ همان فایل و فرمان را نگه دارید.',
  invalid_review: 'امتیاز، متن، نسخه، رضایت انتشار یا شناسهٔ درخواست را بررسی کنید.',
  review_version_conflict: 'دیدگاه یا نسخهٔ آن تغییر کرده است؛ صف تازه را دریافت کنید.',
  review_idempotency_conflict:
    'این شناسه قبلاً با بدنهٔ دیگری استفاده شده است؛ نتیجهٔ قبلی را بررسی کنید.',
  reviews_unavailable: 'اطلاعات دیدگاه در حال تغییر است؛ دوباره دریافت کنید.',
  invalid_sourcing_allocation:
    'تمام خطوط پذیرش، دستگاه‌های انتخابی، نسخه‌ها، دلیل و مهلت صریح UTC را بررسی کنید.',
  invalid_sourcing_allocation_cursor: 'تاریخچهٔ همین تخصیص را از ابتدا دریافت کنید.',
  sourcing_allocation_deadline_conflict:
    'مهلت نگه‌داری باید در آینده و حداکثر تا پایان اعتبار همان پذیرش باشد؛ وضعیت تازه را دریافت کنید.',
  sourcing_allocation_tracking_conflict:
    'روش رهگیری این SKU تغییر کرده است؛ موجودی و دستگاه‌ها را دوباره دریافت کنید.',
  sourcing_allocation_unit_conflict:
    'دستگاه انتخابی اکنون برای این تخصیص آزاد نیست؛ انتخاب را از فهرست تازه بازبینی کنید.',
  sourcing_allocation_stock_conflict:
    'خطوط مشترک یک SKU باید از همان نسخه و روش رهگیری موجودی استفاده کنند.',
  sourcing_allocation_plan_conflict:
    'تخصیص باید تمام تعداد و دستگاه‌های همان خطوط پذیرفته‌شده را پوشش دهد.',
  sourcing_allocation_line_conflict:
    'خطوط انتخابی با تمام اقلام پذیرفته‌شده یکسان نیستند؛ اطلاعات تازه را دریافت کنید.',
  sourcing_allocation_active_conflict:
    'برای این پذیرش تخصیص فعال وجود دارد؛ ابتدا وضعیت همان تخصیص را بررسی کنید.',
  sourcing_allocation_resource_conflict:
    'این شناسهٔ تخصیص سابقه دارد؛ رسید همان فرمان را پیگیری کنید.',
  sourcing_allocation_transferred_conflict:
    'این سهم به سفارش منتقل شده است؛ ادامهٔ عملیات از مسیر همان سفارش انجام می‌شود.',
  sourcing_allocation_claim_conflict:
    'دستگاه دارای سهم محفوظ است؛ وضعیت تخصیص و سفارش مرتبط باید بررسی شود.',
  used_item_stock_conflict:
    'برای هر دستگاه یک SKU با موجودی حداکثر یک و بدون رزرو فعال لازم است؛ مانده تغییر نکرد.',
  invalid_used_condition: 'گزارش سلامت یا درصد باتری یا زمان بررسی معتبر نیست.',
  used_item_digital_conflict: 'گزارش دستگاه کارکرده برای کالای فیزیکی است.',
  used_item_inspection_conflict: 'هر بررسی به شناسهٔ تازه نیاز دارد؛ گزارش را دوباره دریافت کنید.',
  used_item_idempotency_conflict: 'شناسهٔ فرمان قبلاً با بدنهٔ دیگری استفاده شده است.',
  sourcing_allocation_busy_conflict:
    'تخصیص همزمان در حال تغییر است؛ نتیجه را با همان شناسهٔ فرمان پیگیری کنید.',
  sourcing_allocation_capacity_unavailable:
    'حجم اطلاعات تخصیص از ظرفیت پشتیبانی‌شده بیشتر است؛ بررسی فنی لازم است.',
  invalid_sourcing_agreement: 'شرایط و مبالغ صحیح ریالِ همان پذیرش باید از سرور تأیید شوند.',
  sourcing_agreement_consumed_conflict:
    'این توافق مصرف یا بسته شده است؛ وضعیت خرید مرتبط یا نیاز به پیشنهاد تازه را بررسی کنید.',
  sourcing_agreement_terms_conflict:
    'اطلاعات با شرایط ثابت پذیرفته‌شده یکسان نیست؛ وضعیت همان پیشنهاد را بررسی کنید.',
  sourcing_agreement_expired_conflict:
    'مهلت قیمت پذیرفته‌شده گذشته است؛ پیشنهاد و رضایت تازه لازم است.',
  sourcing_agreement_busy_conflict:
    'توافق خرید همزمان در حال تغییر است؛ همان شناسهٔ فرمان را پیگیری کنید.',
  sourcing_agreement_amount_limit: 'جمع یا حاصل تعداد در قیمت از سقف ریال صحیح بیشتر است.',
  sourcing_agreement_capacity_unavailable:
    'حجم اطلاعات توافق از ظرفیت پشتیبانی‌شده بیشتر است؛ بررسی فنی لازم است.',
  serial_contract_upgrade_required:
    'این کالا سهم محفوظ دارد؛ صفحه را برای دریافت نسخهٔ تازهٔ فهرست دستگاه‌ها بازخوانی کنید.',
  inventory_contract_upgrade_required:
    'این موجودی سهم تأمین دارد؛ صفحه را برای دریافت نسخهٔ تازهٔ موجودی بازخوانی کنید.',
  sourcing_supply_contract_upgrade_required:
    'این پیگیری تخصیص موجودی دارد؛ صفحه را برای نمایش وضعیت تازهٔ آن بازخوانی کنید.',
  invalid_sourcing_supply:
    'اطلاعات پیگیری، نسخه\u200cها، پیام دو زبان و زمان واقعی UTC را بررسی کنید.',
  invalid_sourcing_receipt:
    'هویت سند، مقدار واقعی، نگاشت واحد، نسخه\u200cها و زمان UTC را بررسی کنید.',
  invalid_receiving_cursor: 'نگاشت\u200cها را با همان فیلتر از ابتدای فهرست دریافت کنید.',
  sourcing_supply_state_conflict:
    'وضعیت پیگیری تغییر کرده است؛ اطلاعات تازه را دریافت و دوباره بررسی کنید.',
  sourcing_supply_reoffer_conflict:
    'پذیرش معتبر یا شرایط جاری برای این اقدام وجود ندارد؛ پیشنهاد و رضایت تازه لازم است.',
  sourcing_supply_historical_ack_conflict:
    'این دریافت مربوط به پذیرش تاریخی یا شرایط تغییرکرده است؛ وضعیت تازه را دریافت و تأیید دریافت تاریخی را بررسی کنید.',
  sourcing_supply_line_conflict: 'فقط SKU و ردیف همان پذیرش را می\u200cتوان دریافت کرد.',
  sourcing_supply_quantity_conflict:
    'جمع دریافت از تعداد باقی\u200cماندهٔ همان ردیف پذیرش بیشتر است.',
  sourcing_supply_capacity_unavailable:
    'حجم پیگیری از ظرفیت پشتیبانی\u200cشده بیشتر است؛ بررسی فنی لازم است.',
  sourcing_supply_note_unavailable:
    'یادداشت داخلی با کلیدهای فعلی قابل خواندن نیست؛ وضعیت کلیدهای حفاظت سرور باید بررسی شود.',
  receiving_catalog_conflict:
    'هویت فیزیکی SKU برای ثبت دریافت قابل تأیید نیست؛ کاتالوگ واقعی را بررسی کنید.',
  receiving_mapping_identity_conflict:
    'هویت منبع، واحد و SKU نگاشت موجود قابل جابه\u200cجایی نیست؛ نگاشت همان هویت را ویرایش یا برای هویت تازه نگاشت مستقل بسازید.',
  receiving_mapping_conflict:
    'نگاشت تغییر کرده، غیرفعال است یا با منبع و SKU سند یکسان نیست؛ وضعیت تازه را دریافت کنید.',
  receiving_unit_conversion_conflict:
    'مقدار مبدأ و نسبت نگاشت باید دقیقاً تعداد صحیح واحد فروش بسازند؛ گردکردن مجاز نیست.',
  receiving_external_identity_conflict:
    'این خط از سند واقعی قبلاً ثبت شده است؛ سند قبلی را پیگیری کنید و کلید آن را برای ورود دوباره تغییر ندهید.',
  receiving_historical_acknowledgement_conflict:
    'دریافت تاریخی به تأیید صریح نیاز دارد؛ اعتبار خرید با ثبت دریافت دوباره فعال نمی\u200cشود.',
  receiving_line_conflict: 'خط دریافت باید به همان ردیف پذیرفته\u200cشده و SKU واقعی مربوط باشد.',
  receiving_quantity_conflict:
    'تعداد دریافت از باقی\u200cماندهٔ مجاز بیشتر است؛ مقدار و دریافت\u200cهای قبلی را بررسی کنید.',
  receiving_receipt_conflict:
    'این سند دریافت قبلاً استفاده شده است؛ همان شناسهٔ فرمان و سند را پیگیری کنید.',
  receiving_serial_quantity_conflict:
    'تعداد سریال یا IMEI دستگاه\u200cها باید دقیقاً با تعداد واحد فروش برابر باشد.',
  receiving_stock_capacity_conflict: 'افزایش موجودی از سقف فنی پشتیبانی\u200cشده بیشتر است.',
  receiving_stock_conflict:
    'مانده یا نسخهٔ انبار تغییر کرده است؛ وضعیت تازه را دریافت و بازبینی کنید.',
  receiving_tracking_conflict:
    'روش رهگیری SKU تغییر کرده یا شناسه\u200cهای لازم کامل نیستند؛ وضعیت تازه را بررسی کنید.',
  receiving_capacity_unavailable:
    'حجم سند یا شناسه\u200cهای دریافت از ظرفیت پشتیبانی\u200cشده بیشتر است؛ بررسی فنی لازم است.',
  invalid_sourcing_offer: 'قیمت صحیح ریال، شرایط دو زبانه، تعداد و مهلت‌های UTC را بررسی کنید.',
  invalid_offer_catalog: 'حداکثر ۶۴ SKU واقعی و جست‌وجوی محدود همان مدل را انتخاب کنید.',
  invalid_offer_cursor: 'فهرست SKUها را برای همان مدل از ابتدا دریافت کنید.',
  sourcing_offer_catalog_conflict:
    'SKU یا مشخصات جاری آن تغییر کرده است؛ مشخصات تازه را بازبینی و پیش‌نویس را دوباره ذخیره کنید.',
  sourcing_offer_mapping_conflict:
    'SKUهای انتخابی باید تعداد تمام مدل‌های درخواست را دقیقاً پوشش دهند.',
  sourcing_offer_purchase_conflict:
    'روش خرید مشترک فعال با محدودیت دسته، مبلغ یا طرح چک وجود ندارد.',
  sourcing_offer_supersession_conflict:
    'شناسه و نسخهٔ پیشنهاد منتشرشدهٔ فعلی را برای جایگزینی صریح وارد کنید.',
  sourcing_offer_accepted_conflict:
    'پیشنهاد پذیرفته‌شده هنوز معتبر است؛ انتشار جایگزین یا بستن سادهٔ درخواست مجاز نیست.',
  sourcing_offer_state_conflict:
    'وضعیت پیشنهاد یا درخواست تغییر کرده است؛ اطلاعات تازه را دریافت کنید.',
  sourcing_offer_terms_conflict: 'شرایط پیشنهاد تغییر کرده است؛ نسخهٔ جاری را دوباره بررسی کنید.',
  sourcing_offer_expired_conflict: 'مهلت پیشنهاد گذشته است؛ پیشنهاد تازه با مهلت صریح لازم است.',
  sourcing_offer_amount_limit: 'جمع یا حاصل تعداد در قیمت از سقف ریال صحیح بیشتر است.',
  sourcing_offer_capacity_unavailable:
    'حجم مشخصات یا شرایط از ظرفیت این پیشنهاد بیشتر است؛ بررسی فنی لازم است.',
  invalid_sourcing_input:
    'اطلاعات درخواست تأمین، نسخه یا شناسهٔ فرمان معتبر نیست؛ اطلاعات تازه را دریافت کنید.',
  sourcing_version_conflict:
    'این درخواست یا سبد تغییر کرده است؛ وضعیت تازه را دریافت و دوباره بررسی کنید.',
  sourcing_state_conflict:
    'وضعیت درخواست اجازهٔ این تغییر را نمی‌دهد؛ اطلاعات تازه را دریافت کنید.',
  sourcing_busy_conflict: 'درخواست هم‌زمان در حال تغییر است؛ با همان شناسه دوباره تلاش کنید.',
  sourcing_limit:
    'تعداد درخواست‌های باز به سقف فنی رسیده است؛ ابتدا موارد قبلی را تعیین تکلیف کنید.',
  sourcing_note_unavailable:
    'یادداشت خصوصی با کلیدهای فعلی قابل بازکردن نیست؛ وضعیت key ring سرور باید بررسی شود.',
  sourcing_capacity_unavailable:
    'حجم مشخصات این درخواست از ظرفیت فعلی بیشتر است؛ بررسی فنی لازم است.',
  invalid_accounting_link:
    'شناسهٔ شرکت، شناسهٔ ثابت کالا و SKU فیزیکی را بررسی کنید. شناسه‌ها نباید فاصلهٔ ابتدا/انتها داشته باشند؛ نگاشت فعال به SKU فعال نیاز دارد.',
  accounting_target_conflict:
    'این کالا نگاشت فعال هلو دارد؛ پیش از تبدیل به کالای دیجیتال، نگاشت آن را غیرفعال کنید.',
  accounting_identity_conflict:
    'شرکت یا شناسهٔ ثابت نگاشت موجود قابل جابه‌جایی نیست؛ آن را غیرفعال و نگاشت دیگری بسازید.',
  invalid_market_csv:
    'ساختار CSV، نام ستون‌ها و مقدار ردیف‌ها را بررسی کنید؛ حداکثر ۵۰ ردیف و ۱۲۸ کیلوبایت مجاز است.',
  invalid_market_input:
    'منبع، وضعیت و تاریخ‌های گزارش بازار را بررسی کنید؛ مبلغ مرجع باید ریال صحیحِ مثبت و همراه زمان مشاهده و پایان اعتبار باشد.',
  invalid_market_model: 'برای بازار، یک مدل کالای فیزیکی انتخاب کنید.',
  incomplete_market_model:
    'انتشار بازار به عنوان فارسی و انگلیسی، تصویر، دسته و برند فعال و ویژگی‌های اجباری مدل نیاز دارد.',
  market_source_conflict:
    'این منبع و شناسهٔ کالا قبلاً ثبت شده یا هویت منبع تکمیلی تغییر کرده است. اطلاعات تازه را دریافت کنید.',
  market_source_capacity_conflict:
    'حداکثر ۱۶ منبع برای هر مدل پشتیبانی می‌شود؛ گزارش منبع موجود را ویرایش کنید.',
  market_model_conflict: 'این مدل به منبع دیگری متصل است؛ اطلاعات تازه را از فهرست دریافت کنید.',
  model_slug_conflict:
    'این اسلاگ متعلق به مدل دیگری است؛ برای اتصال صریح در CSV، model_id را وارد کنید.',
  duplicate_market_csv_row: 'این منبع یا مدل در فایل تکرار شده است.',
  demo_unavailable: 'دادهٔ نمونه در این محیط مجاز نیست.',
  market_unavailable: 'اطلاعات بازار در حال تغییر است؛ کمی بعد دوباره دریافت کنید.',
  invalid_serial_input: 'قالب سریال، رقم کنترل IMEI، دلیل و تعداد دستگاه‌ها را بررسی کنید.',
  invalid_serial_cursor: 'فهرست سریال‌ها را با فیلتر فعلی از ابتدا دریافت کنید.',
  serial_tracking_required: 'برای این تنوع، روش رهگیری و دریافت یا خروج سریال را بررسی کنید.',
  serial_mode_conflict: 'تغییر روش فقط با موجودی خالی، بدون رزرو و بدون واحد باز ممکن است.',
  serial_digital_conflict: 'کالای دیجیتال نمی‌تواند رهگیری فیزیکی سریال داشته باشد.',
  serial_identifier_conflict: 'یکی از شناسه‌ها قبلاً ثبت شده است؛ فهرست و تاریخچه را بررسی کنید.',
  serial_state_conflict: 'وضعیت واحد یا ظرفیت رزرو تغییر کرده است؛ اطلاعات تازه را بازبینی کنید.',
  serial_assignment_required: 'پیش از تحویل، همهٔ واحدهای رهگیری‌شده باید به سفارش تخصیص یابند.',
  invalid_purchase_filter: 'جست‌وجو، شناسه یا فیلتر شرایط خرید معتبر نیست.',
  invalid_purchase_cursor: 'این صفحه با فیلتر فعلی معتبر نیست؛ از ابتدای فهرست دریافت کنید.',
  purchase_detail_capacity_unavailable:
    'تعداد محدودیت‌های این شرایط خارج از حد قابل ویرایش است؛ بررسی مدیریتی لازم است.',
  invalid_staff_filter: 'جست‌وجو، نقش یا شناسهٔ کارمند معتبر نیست.',
  invalid_audit_filters: 'فیلتر یا شمارهٔ صفحهٔ رویدادها معتبر نیست. فیلتر را دوباره اعمال کنید.',
  invalid_staff_cursor: 'صفحهٔ کارکنان با این فیلتر معتبر نیست؛ از ابتدا دریافت کنید.',
  invalid_staff_input: 'نقش‌ها، وضعیت و نسخهٔ حساب را بررسی کنید.',
  staff_self_change: 'تغییر دسترسی حساب خودتان باید توسط مدیر دیگری انجام شود.',
  staff_candidate_unavailable:
    'حساب باید فعال، دارای تماس تأییدشده و رمز ورود باشد و هنوز کارمند نباشد.',
  staff_activation_unavailable: 'حساب کارمند برای فعال‌شدن به تماس تأییدشده و رمز ورود نیاز دارد.',
  last_administrator: 'حداقل یک مدیر کل فعال باید باقی بماند.',
  invalid_origin: 'مبدأ درخواست برای پنل مجاز نیست؛ از نشانی تعیین‌شدهٔ پنل وارد شوید.',
  mfa_already_enabled:
    'Authenticator این حساب فعال است؛ به مرحلهٔ ورود برگردید یا کد پشتیبان را به کار ببرید.',
  identity_validation: 'عملیات حساب تکمیل نشد؛ وضعیت را بررسی و دوباره تلاش کنید.',
  invalid_product_filter: 'جست‌وجو یا فیلتر کالا معتبر نیست.',
  invalid_product_cursor: 'صفحهٔ کالاها معتبر نیست؛ جست‌وجو را از ابتدا انجام دهید.',
  invalid_product_lookup: 'حداکثر ۲۴ کالای متفاوت را انتخاب کنید.',
  not_found: 'رکورد پیدا نشد؛ اطلاعات را تازه کنید.',
  invalid_stock_filter: 'جست‌وجو یا فیلتر موجودی معتبر نیست.',
  invalid_stock_cursor: 'صفحهٔ موجودی معتبر نیست؛ جست‌وجو را از ابتدا انجام دهید.',
  catalog_reindex_required:
    'آماده‌سازی جست‌وجوی کاتالوگ کامل نشده است؛ بعد از آماده‌شدن سرویس دوباره تلاش کنید.',
  idempotency_conflict:
    'شناسهٔ این درخواست قبلاً با مقادیر دیگری استفاده شده است؛ پیش از اصلاح تازه، گردش انبار را بررسی کنید.',
  invalid_order_settings: 'مهلت رزرو باید ۱ تا ۶۰ دقیقه و حداکثر سفارش باز ۱ تا ۱۰ باشد.',
  order_state_conflict: 'وضعیت سفارش اجازهٔ لغو از مسیر سفارش پرداخت‌نشده را نمی‌دهد.',
  reservation_state_conflict: 'وضعیت رزرو تغییر کرده است؛ وضعیت سفارش را دوباره دریافت کنید.',
  invalid_order: 'اطلاعات درخواست سفارش معتبر نیست.',
  invalid_charge_policy:
    'سیاست ارسال یا مالیات معتبر نیست؛ مبلغ، نام دو زبانه، نرخ و مبنای محاسبه را بررسی کنید.',
  invalid_credentials: 'اطلاعات ورود یا کد تأیید صحیح نیست.',
  version_conflict: 'این رکورد تغییر کرده است. صفحه را تازه کنید و دوباره ویرایش کنید.',
  data_constraint: 'مقدار تکراری است یا رکورد وابسته هنوز استفاده می‌شود.',
  invalid_money: 'مبلغ باید عدد صحیح و نامنفی به ریال باشد.',
  required_attribute: 'ویژگی اجباری دسته تکمیل نشده است.',
  invalid_purchase_rules: 'روش خرید یا طرح انتخاب‌شده معتبر نیست.',
  insufficient_stock:
    'موجودی آزاد برای این اقدام کافی نیست؛ موجودی فیزیکی و سهم‌های محفوظ را دوباره بررسی کنید.',
  attribute_type_mismatch: 'مقدار ویژگی با نوع یا گزینه‌های آن سازگار نیست.',
  invalid_image:
    'تصویر JPEG، PNG یا WebP معتبر انتخاب کنید؛ نام، نوع و محتوای فایل باید سازگار باشند.',
  image_too_large: 'حجم تصویر بیش از حد مجاز است.',
  image_dimensions:
    'ابعاد تصویر باید حداقل ۱۶ پیکسل، حداکثر ۸۱۹۲ پیکسل در هر ضلع و ۱۲ میلیون پیکسل باشند.',
  image_rejected: 'تصویر بررسی امنیتی را نگذرانده و ذخیره نشده است.',
  media_unavailable:
    'دریافت یا آماده‌سازی تصویر انجام نشد؛ اطلاعات تصویر و سلامت سرویس‌های رسانه را بررسی کنید.',
  invalid_image_library_filter: 'شناسهٔ تصویر یا بازهٔ زمانی کتابخانه معتبر نیست.',
  invalid_image_library_cursor:
    'این صفحه با فیلتر فعلی معتبر نیست؛ کتابخانه را از ابتدا تازه‌سازی کنید.',
  media_busy: 'پردازش تصویر مشغول است؛ کمی بعد دوباره تلاش کنید.',
  image_not_ready: 'بررسی تصویر هنوز کامل نشده است.',
  incomplete_product: 'انتشار به تصویر، تنوع فعال و روش خرید نیاز دارد.',
};
export async function api<T>(
  path: string,
  init: RequestInit = {},
  responseType: 'json' | 'blob' | 'response' = 'json',
): Promise<T> {
  const privateRead =
    !path.startsWith('/auth/') && ['GET', 'HEAD'].includes((init.method ?? 'GET').toUpperCase());
  const readSignal = privateRead ? adminViewReadSignal() : null;
  const previousGeneration = access.generation;
  try {
    await access.beforeRequest(path);
  } catch (error) {
    const kind = currentAdminAuthFailure(error, previousGeneration, access.generation);
    if (!(error instanceof SessionChanged) && kind)
      window.dispatchEvent(new CustomEvent('session-expired', { detail: { kind } }));
    throw error;
  }
  const sentGeneration = access.generation;
  const request = async (signal?: AbortSignal) => {
    let response: Response;
    try {
      response = await fetch(`/api${path}`, {
        ...init,
        ...(signal ? { signal } : {}),
        credentials: 'include',
        headers: adminRequestHeaders(init.body, access.token, init.headers),
      });
    } catch {
      throw new ApiError(0, 'unavailable', 'ارتباط با API برقرار نشد. وضعیت سرویس را بررسی کنید.');
    }
    // A protected access-token 401 can mean expiry. Only refresh's own 401
    // confirms an invalid session; keep the journal while re-verifying it.
    if (!response.ok) {
      const problem = await response.json().catch(() => ({}));
      const kind = currentAdminAuthFailure(
        { status: response.status },
        sentGeneration,
        access.generation,
        'access',
      );
      if (response.status === 401 && !path.startsWith('/auth/') && kind)
        window.dispatchEvent(new CustomEvent('session-expired', { detail: { kind } }));
      throw new ApiError(
        response.status,
        problem.title ?? 'request_failed',
        messages[problem.title] ??
          (response.status === 429
            ? 'تعداد تلاش‌ها زیاد است؛ کمی بعد دوباره تلاش کنید.'
            : response.status === 403
              ? 'شما مجوز این عملیات را ندارید.'
              : response.status >= 500
                ? 'سرویس یا دیتابیس آماده نیست. دوباره تلاش کنید.'
                : (problem.detail ?? `خطای درخواست (${response.status})`)),
        path.startsWith('/admin/catalog/workspace/')
          ? readAdminFieldErrors(problem.errors)
          : undefined,
      );
    }
    if (responseType === 'response') {
      if (sentGeneration !== access.generation) {
        await response.body?.cancel();
        throw new SessionChanged();
      }
      return response as T;
    }
    return response.status === 204
      ? (undefined as T)
      : responseType === 'blob'
        ? ((await response.blob()) as T)
        : response.json();
  };
  // Keep the lock through headers AND body decoding. Abort the actual fetch,
  // then await its settlement; never race a live request and release its lock.
  if (
    path.startsWith('/auth/') &&
    !['GET', 'HEAD', 'OPTIONS'].includes((init.method ?? 'GET').toUpperCase())
  )
    return authTransport.run(
      (signal) => request(signal),
      () => sentGeneration === access.generation,
      init.signal,
    );
  if (readSignal) {
    const signal = init.signal ? AbortSignal.any([init.signal, readSignal]) : readSignal;
    return request(signal);
  }
  return request();
}
export const save = <T>(path: string, value: unknown, method = 'POST') =>
  api<T>(path, { method, body: JSON.stringify(value) });
