# نقشهٔ راه تا تحویل — D34

وضعیت جاری: **اصلی محلی۵۷، 2026-10-27**. STATUS مرجع runtime/restart و حدود پذیرش است؛ PRD همهٔ الزامات PDF و درخواست‌های مالک را نگه می‌دارد. تاریخچهٔ برنامه در [آرشیو پیش۵۷](archive/PLAN-before-credit-documents57-release.md) محفوظ است. پایان یک برش، پایان هدف نیست.

## آمادهٔ اجرا

1. CREDIT-01: submit صریح به بررسی انسانی، snapshot immutable رضایت/نسخه/فایل‌های جاری، کنترل required و plan/version، receipt/audit اتمیک، صف خصوصی بازبین و withdrawal امن. سپس review/return/decision مجوزدار و اتصال صریح checkout چکی؛ CREDIT-02 برنامهٔ سررسید/وصول/برگشت/یادآوری. پیش‌نویس۵۵، شرایط/رضایت۵۶ و هستهٔ مدارک۵۷ پذیرفته‌اند و دوباره ساخته نشوند.
2. تکمیل چرخهٔ فروش: ارسال جزئی و دیجیتال، مرجوعی/بازپرداخت، تخصیص دستگاه و گزارش‌های مرتبط با حفظ snapshots/idempotency. ارسال کامل فیزیکی۴۸ و هستهٔ پرداخت۵۰ محفوظ‌اند؛ gateway واقعی تا قرارداد D16 خاموش است.
3. باقی CMS/page builder/blog/redirect/SEO، سنجش جست‌وجوی فارسی و انتخاب موتور، wishlist/alert، trade-in/bundle/compatibility/loyalty و باقی EXT با معیار مستقل PRD.
4. تکمیل ارتباطات/فایل: چرخهٔ SignalR/اعلان/پشتیبانی و نگهداری/حذف/restore objectها و keyring. Files اصلی Disabled؛ سرویس واقعی تولیدی باید مستقل آماده شود.
5. پذیرش نهایی: mobile/RTL/LTR/WCAG/performance، CI/observability، Docker روی Linux واقعی، load، offsite backup و restore عملی، تمام معیارهای۱۲گانهٔ skill و اسناد تحویل.

بازار/CSV/منابع/درخواست/پیشنهاد/تأمین/تخصیص و سفارش، هلو staging/reconciliation/manualapply، دستگاه کارکرده، نظر/مقایسه و CMS پایه در برش‌های قبلی پذیرفته‌اند؛ دامنهٔ دقیق هرکدام در PRD و اسناد ماژول/آرشیو STATUS است. آن‌ها به معنی تکمیل کل چرخه یا اتصال live هلو نیستند.

## اجرای هر برش

backend/API و storefront/admin را به‌صورت قابل بازبینی تکمیل و به قدر ریسک با SQL واقعی/قرارداد/BFF/مرورگر بررسی کن. محیط GUID QA خودش جمع، artifact ثابت ساخته، بکاپ/ارتقای افزایشی/حفظ داده و HTTP محلی انجام و STATUS/DECISIONS/API به‌روز شوند. Shop.sln برای SqlTests/UiHarness کافی نیست؛ صریحاً build و۱۴ اسمبلی با آزمون/فریز تطبیق داده شوند. بعد از تغییر صرفاً رابط، آزمون backend بدون علت تکرار نشود.

در۵۷:۹۷۳unit/۶۷۳SQL/۴۱۱storefront/۲۱۴admin/۱۰proxy،۹SQLwire/۸۰browserwire،۷فرمان/۱lost-success/۱receipt/۳download HTTP دقیق، cleanup/backup و۱۲۳۲HTTP پذیرفته‌اند. جایگزینی SQL پذیرفته ولی انتخاب فایل دوم مرورگر اجرا نشده؛ CUA filechooser باوجودtimeout بیش از۶ساعت معطل ماند. مرز این شاهد صریح بماند. تغییر عادی نشست در API زنده جدا از جدول‌های تجاری ثبت شود؛ داده برای رسیدن به hash قبلی پاک/بازنویسی نشود.

D16 وD30 وابستگی بیرونی بازند، نه بخش کامل‌شده؛ اطلاعات نداریم و سؤال تکرار نشود. شروط تجاری/متن حقوقی/provider endpoint/درصد از درخواست ادامه استنباط نشوند. D14 انتشار محلی، D21 نمونه صرفاًQA، D32 روشن‌ماندن Redis پارسه، D33 حفظ current/rollback/restart/keys/backups/evidence در tmp و D34 ادامه تا کل پروژه پابرجایند.
