# نقشهٔ راه تا تحویل — D34

اصلی محلی۶۵،2026-10-27؛ STATUS مرجع اجرا و شواهد، PRD مرجع کل PDF. [آرشیو پیش۶۵](archive/PLAN-before-cheque-ledger65-release.md) محفوظ؛ تکمیل همهٔ بخش‌ها ادامه دارد.

1. CREDIT-02: ثبت/تطبیق پیش‌پرداخت، پذیرش مالی معتبر/تعهد موجودی/مهلت خرید چکی، وصول واقعی/یادآوری/گزارش/اعتبار سازمانی. دفتر۶۵ گزارش داخلی است؛ Planned۶۴ و AwaitingPayment۶۳ پرداخت نیستند. Cash VerifiedCashPayment فقط از verify واقعی provider؛ input یا گزارش دستی جای آن نمی‌آید. معنی credit approval، receivable و مجوز fulfillment مستقل و با SharedKernel/rootMFA/audit/idempotency طراحی شود. مهلت تاریخی پنهانی تمدید/ScopeUse احیا نشود.
2. چرخهٔ فروش: ارسال جزئی/دیجیتال،مرجوعی/بازپرداخت،ردیابی موجودی/دستگاه؛ هسته‌های قبلی حفظ شوند.
3. CMS/pagebuilder/blog/redirect/SEO،سنجش جست‌وجوی فارسی،wishlist/alert،trade-in/bundle/compatibility/loyalty و EXT با معیار PRD.
4. ارتباطات/فایل:SignalR/اعلان/پشتیبانی،retention/delete/restoreobject+keyring؛ Files اصلی Disabled و providerتولیدی نیازمند تنظیم واقعی است.
5. پذیرش mobile/RTL/LTR/WCAG/performance،CI/observability،DockerLinuxواقعی،load،offsitebackup/restore و۱۲معیار/تحویل.

۶۵:۱۰۱۸unit/۷۲۳SQL/۴۷۱storefront/۲۱۴admin/۱۶proxy،۴۹SQLwire/۱۲۱browserwire؛۱۲ثبت/۲قطع→۲GETreceipt/۰duplicate،۳سند/۱۲رویداد و گزارش وصول/اصلاح/برگشت/بازگرداندن،برنامه ثابت/پیگیری سند بعدcancel و خلاصهٔ خصوصی مشتری. دو اصلاح UI با سفارش دوم نهایی پذیرفته،۵console خالی/FAENوپنل خواندن موبایل بدونoverflow/logoutacrosstabs؛ activeMobileForm/device/WCAG/perf/کلC2 باز. SQLfullاول فقط۳OOMازheap۲GiB؛rerunهمانcode/assertionدر۳GiB۷۲۳پاس وQAناموفق پاک شد. یکmigration/۱۷۵جدول/۱۵۹۸HTTPmain باbackup/حفظداده؛ هیچpolicy/role/provider اصلی فعال نشد.

هر برش با SQL/API/UI/پذیرش متناسب،QAcleanup،artifact ثابت،backup/ارتقای افزایشی/حفظ داده/HTTP محلی و اسناد؛ سپس برش بعدی. SQL/harness جداbuild و۱۴DLLتطبیق. برای fullSQL فعلی۳GiBheap کافی شد؛ host و فضا پیش آزمون کنترل شوند. D16/D30 بدون اطلاعات‌اند؛ سؤال تکراری/API ساختگی/providerفعال/متنحقوقی/سیاست فرضی نسازید. نشست اصلی برایhash reset نشود. tmpکامل حذف نشود؛ current65/rollback64/keys/backups/restartdependencies/evidence محفوظ،D32Redis روشن بماند.

برش فعال بعد۶۵: CMS-PAGES/A70 (CMS-02)، مستقل از پاسخ بازِ اجازهٔ ارسال چکی؛ پس پذیرش آن بقیهٔ D34 ادامه یابد.
