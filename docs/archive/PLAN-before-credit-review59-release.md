# نقشهٔ راه تا تحویل — D34

وضعیت جاری: **اصلی محلی۵۸، 2026-10-27**. STATUS مرجع runtime/restart/شواهد و PRD مرجع کلPDF است. برنامهٔ پیشین در [آرشیو پیش۵۸](archive/PLAN-before-credit-submission58-release.md) محفوظ است. پایان یک برش پایان هدف نیست.

1. CREDIT-01 بعدی: تصمیم انسانی دارای credit.write/MFA بر همان submission/version؛ Return برای اصلاح، Decline، Approve با مبلغ/انقضای صریح مدیر؛ snapshot/receipt/audit/ownerread و race با withdrawal. سپس checkout چکی با رضایت صریح و authorization بدون مصرف تکراری؛ CREDIT-02 سررسید/وصول/برگشت/یادآوری و اعتبار سازمانی. Draft۵۵/شرایط‌ورضایت۵۶/مدارک۵۷/submit+صفread+withdraw۵۸ تکرار نشوند.
2. چرخهٔ فروش: ارسال جزئی/دیجیتال، مرجوعی/بازپرداخت، تخصیص دستگاه و گزارش‌ها با snapshot/idempotency. ارسال کامل فیزیکی۴۸ و پرداخت۵۰ محفوظ‌اند؛ livegateway تا قراردادD16 خاموش است.
3. CMS/pagebuilder/blog/redirect/SEO، سنجش موتور جست‌وجوی فارسی، wishlist/alert، trade-in/bundle/compatibility/loyalty و بقیهٔEXT با معیار مستقلPRD.
4. چرخهٔ ارتباطات/فایل: SignalR/اعلان/پشتیبانی، retention/delete/restore object+keyring. Files اصلیDisabled؛ سرویس تولیدی مستقل آماده شود.
5. پذیرش نهایی: mobile/RTL/LTR/WCAG/performance، CI/observability، Docker رویLinuxواقعی، load، offsitebackup/restore عملی و معیارهای۱۲گانه و اسناد تحویل.

هر برش را backend/API+storefront/admin قابل بازبینی، SQLواقعی/قرارداد/BFF/مرورگر متناسب با ریسک تکمیل کن؛ QA GUID جمع، artifact ثابت، بکاپ/ارتقای افزایشی/حفظ داده و HTTPمحلی، سپس STATUS/DECISIONS/API به‌روز و برش بعدی ادامه یابد. Shop.sln برای SqlTests/UiHarness کافی نیست؛ صریحاً build و۱۴DLL تطبیق داده شوند. صرفاً تغییر copy/نمایش UI دلیل تکرار آزمون backend نیست.

۵۸:۹۷۶unit/۶۷۹SQL/۴۲۰storefront/۲۱۴admin/۱۱proxy،۱۱SQLwire/۱۱۳browserwire،۵فرمان/۱lost-success/۱receipt/۰duplicate،۱۶۱ جدولQA/۱۴۸جدولدیگر exact و۱۲۸۶HTTPمحلی پذیرفته‌اند. FilesDisabled و صفرمدرک فقط صریحاً در QA منتشر شد؛ liveFiles یا اعتباری واقعی نتیجه نمی‌شود. اصلاح زبان رضایت فقطUI بود؛ finalwrites retest ادعا نشود. CUAfilechooser بیش از۶ساعت در۵۷ معطل شد، تکرار نشد.

D16/D30 وابستگی خارجی بازند، سؤال تکرار نشود. هیچ متن حقوقی، درصد، providerendpoint، هزینه/مالیات یا تصمیم اعتبار از دستور ادامه استنباط نشود. تغییر عادی نشست APIزنده جدا از دادهٔ تجاری ثبت شود؛ داده برای رسیدن به hashقبلی پاک/بازنویسی نشود. D14 محلی، D21 نمونهQA، D32 Redisروشن، D33 حفظcurrent/rollback/restart/keys/backups/evidence وD34 کلپروژه پابرجایند.
