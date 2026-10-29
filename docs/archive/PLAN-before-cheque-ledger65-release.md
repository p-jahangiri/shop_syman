# نقشهٔ راه تا تحویل — D34

اصلی محلی۶۴،2026-10-27؛ STATUS مرجع اجرا و شواهد، PRD مرجع کل PDF است. [آرشیو پیش۶۴](archive/PLAN-before-credit-schedule64-release.md) محفوظ. تکمیل کل پروژه ادامه دارد.

1. CREDIT-02: گردش دریافت چک/پیش‌پرداخت/وصول/برگشت/یادآوری/گزارش و اعتبار سازمانی. برنامهٔ۶۴ Planned و سفارش۶۳ AwaitingPayment پرداخت نیستند. اعتبار مالی معتبر برای Paid/ارسال لازم است؛ مبلغ از snapshot،finance.write+MFA/audit/idempotency/root contracts. بدون شبیه‌سازی بانک یا سرویس D16.
2. چرخهٔ فروش: ارسال جزئی/دیجیتال،مرجوعی/بازپرداخت،ردیابی موجودی/دستگاه؛ هسته‌های قبلی حفظ شوند.
3. CMS/pagebuilder/blog/redirect/SEO،سنجش جست‌وجوی فارسی،wishlist/alert،trade-in/bundle/compatibility/loyalty و EXT با معیار PRD.
4. ارتباطات/فایل: SignalR/اعلان/پشتیبانی،retention/delete/restoreobject+keyring؛ Files اصلی Disabled و providerتولیدی نیازمند تنظیم واقعی است.
5. پذیرش mobile/RTL/LTR/WCAG/performance،CI/observability،DockerLinuxواقعی،load،offsitebackup/restore و۱۲معیار/تحویل.

۶۴:۱۰۰۵unit/۷۱۶SQL/۴۶۲storefront/۲۱۴admin/۱۵proxy،۷۵SQLwire/۲۹browserwire؛۲revision/۲POST/۱قطع→۱GETreceipt/۰duplicate،تقویم صریح،upfront شامل هزینه خارج چک،تاریخچه پس cancel/reload/locale،globalunknown و خروج بین تب‌ها. FAEN/پنل عرض موبایل بدون overflow؛ actualdevice/WCAG/perf/کلC2 باز. یکmigration/۱۷۲جدول/۱۵۴۳HTTPmain با بکاپ و حفظ داده؛ هیچpolicy/role/provider اصلی فعال نشد.

هر برش با SQL/API/UI/پذیرش متناسب،QAcleanup،artifact ثابت،backup/ارتقای افزایشی/حفظ داده/HTTP محلی و اسناد؛ سپس برش بعدی. SQL/harness جدا build و۱۴DLL تطبیق. D16/D30 بدون اطلاعات‌اند؛ سؤال تکراری/API ساختگی/providerفعال/متنحقوقی/سیاست فرضی نسازید. نشست معمولی اصلی برای hash reset نشود. tmpکامل حذف نشود؛ D32Redis روشن بماند.
