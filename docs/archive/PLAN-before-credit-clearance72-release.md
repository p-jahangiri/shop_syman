# نقشهٔ راه تا تحویل — D34

نسخهٔ اصلی محلی۷۰، 2026-10-28. STATUS مرجع اجرا/شواهد، PRD مرجع PDF، DECISIONS پاسخ‌های مالک است.

1. **CREDIT-02/D35: مجوز مالی مستقل چکی و تعهد موجودی/ارسال.** پیش‌پرداخت۶۸، تأیید هر چک۶۹ و مدت نگهداری صریح۷۰ پذیرفته‌اند. شرط مالک دریافت پیش‌پرداخت و تأیید همهٔ چک‌هاست؛ وصول همه لازم نیست. proof داخلی مستقل از cash، root transaction/audit، CAS/idempotency و کنترل انقضا/لغو/گردش لازم است. قبل از pack/dispatch اعتبار مالی تازه بررسی شود؛ historical receipt/deadline/ScopeUse حفظ شوند.
2. وصول/برگشت/یادآوری/گزارش/اعتبار سازمانی با FinanceMFA؛ باقی CREDIT-02.
3. blog/SEO تکمیلی CMS-03 و رفع HTTP200 محصول ناموجود preview پس streaming؛ CMS pages/sitemap/redirect پذیرفته‌اند.
4. ارسال جزئی/دیجیتال/مرجوعی/refund/ردیابی؛ search فارسی/wishlist/alert/trade-in/bundle/compatibility/loyalty و EXT.
5. SignalR/اعلان/پشتیبانی/retention/delete/restore object+keyring؛ Files اصلی Disabled و provider واقعی لازم.
6. mobile/RTL/LTR/WCAG/performance؛ CI/observability/Docker Linux/load/offsite backup/restore و۱۲معیارتحویل.

۷۰:۱۰۹۵unit/۷۵۳SQL/۵۰۷front/۲۱۷admin/۲۱proxy،۳۰SQLwire/۲۵browserwire؛۳policyPOST+۱customerOrderPOST،۱cut→۱GET/۰duplicate؛ لغو واقعی UI+SQL جدا. QA جمع. main۴جدولخالی/۱۹۱جدول،۱۸۶قبلیجزSalesHistory و۶۹migration/schema/views محفوظ؛۱۸۸۱HTTPتمام۱۸۴۰قبلی،۱۹۰non-session پسHTTP exact،۱۰۷۶admin+۳۴۴Next priorassets،backup تأیید. هیچ main policy/provider/role/seed/index فعال نشد.

هر برش با پذیرش متناسب، cleanup QA، artifact ثابت، backup، حفظ داده، HTTP محلی و اسناد، سپس برش بعد. Full SQL با heap۳GiB و۱۴DLL ثابت؛ هنگام testhost محصول rebuild نشود. D16/D30 اطلاعات ندارند، سؤال تکراری و provider جعلی نباشد. D21 فقطQA، mainactivation با تنظیم صریح. نشست برای hash reset نشود. D32 Redis پارسه روشن بماند. D33 tmp کامل پاک نشود؛ current۷۰/rollback۶۹/۶۸/۶۷/۶۶ و key/backups/helperdependencies/evidence محفوظ‌اند. D34 تا همهٔ PRD ادامه دارد.
