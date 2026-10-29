# نقشهٔ راه تا تحویل — D34

وضعیت جاری **اصلی محلی۵۹، 2026-10-27**. STATUS مرجع runtime/restart/شواهد و PRD مرجع کلPDF است؛ [آرشیو پیش۵۹](archive/PLAN-before-credit-review59-release.md) محفوظ است. پایان یک برش پایان هدف نیست.

1. CREDIT-01 آمادهٔبعد: approval با سقف/مبنای صریح و انقضا به quote و checkout چکی وصل شود؛ قیمت و روش/طرح/موجودی از سرور، consent دقیق quote، link/order/reservation/authorization/audit اتمیک، replay و منع مصرف دوباره و race با expiry/revoke/cancel. approval۵۹ هنوز سفارش نیست؛ quoteچکیV5 همچنانblocked است. ابتدا قرارداد/محاسبهٔ مقید به تأیید و UIانتخاب آن، سپس ثبت سفارش و چرخهٔ اعتبار با پذیرش مستقل. CREDIT-02 سررسید/وصول/برگشت/یادآوری و سازمانی ادامه دارد. هسته‌های۵۵–۵۹ دوباره ساخته نشوند.
2. چرخهٔفروش: ارسال جزئی/دیجیتال، مرجوعی/بازپرداخت، تخصیص دستگاه/گزارش با snapshot/idempotency؛ ارسال کامل فیزیکی۴۸ و پرداخت۵۰ محفوظ‌اند. gatewayواقعیD16 خاموش است.
3. CMS/pagebuilder/blog/redirect/SEO، سنجش موتور جست‌وجوی فارسی، wishlist/alert، trade-in/bundle/compatibility/loyalty و دیگرEXT با معیار مستقلPRD.
4. ارتباطات/فایل: SignalR/اعلان/پشتیبانی، retention/delete/restore object+keyring؛ FilesاصلیDisabled و سرویس تولیدی مستقل آماده شود.
5. پذیرش نهایی: mobile/RTL/LTR/WCAG/performance، CI/observability، DockerرویLinuxواقعی، load، offsitebackup/restore عملی، معیارهای۱۲گانه و اسنادتحویل.

هر برش backend/API+storefront/admin قابل بازبینی و SQLواقعی/قرارداد/BFF/مرورگر متناسب با ریسک، QA_GUIDcleanup، artifact ثابت، بکاپ/ارتقای افزایشی/حفظداده/HTTPمحلی و STATUS/DECISIONS/API؛ بعد برش بعدی را ادامه بده. Shop.sln برای SqlTests/UiHarness کافی نیست؛ آن‌ها صریحاً build و۱۴DLL تطبیق داده شوند. تغییر صرفاًcopy دلیل تکرار backendtests نیست.

۵۹:۹۷۹unit/۶۸۴SQL/۴۲۷storefront/۲۱۴admin/۱۲proxy،۱۱SQLwire/۱۷۰browserwire،۷فرمان/۱lostReturn→۱receipt/۰duplicate،۱۶۳جدولQA/۱۴۸دیگر exact و۱۳۳۱HTTPمحلی پذیرفته‌اند. Return/resubmit/Approve در مرورگر؛ Decline وrole/MFA/readonlyclaims/expiry/race/FK/nullCHECK/rollback درSQL پوشش دارند. انتخاب snapshot تاریخی حتی با فرم کامل تصمیم را می‌بندد. FilesDisabled و صفرمدرک فقط صریحاًدرQA، تصمیم‌ها کاملاً ساختگی بودند. آخرینcopy فقط جملهٔ تاریخچه را اصلاح کرد؛ finalCopyWritesRetested=false صریح بماند.

D16/D30 خارجی بازند؛ سؤال تکرار نشود. متن حقوقی، درصد، endpointprovider، هزینه/مالیات یا تصمیم واقعی از ادامه استنباط نشود؛ مقادیر تجاری از پنل می‌آیند. نشست عادی APIزنده جدا از دادهٔ تجاری ثبت شود؛ داده برایرسیدن بهhashقدیمی پاک/بازنویسی نشود. D14محلی/D21نمونهQA/D32Redisروشن/D33حفظcurrent/rollback/restart/keys/backups/evidence/D34کلپروژه پابرجایند.
