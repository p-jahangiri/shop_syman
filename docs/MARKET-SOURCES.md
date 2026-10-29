# چند منبع و تاریخچهٔ بازار

سورس/اصلی۴۴ محلی با پذیرش دسکتاپ منتشر است؛ موبایل و CSVمنابع تکمیلی و کلPDFبازند. این برش ادامهٔ D34 است و API زندهٔ تأمین‌کننده یا مجوز scrape نمی‌سازد.

هویت فعلی Listing و مدل و سبد درخواست تأمین ثابت می‌ماند. منبع اصلی همچنان در Listing است؛ حداکثر۱۵منبع اضافی، هرکدام با شناسهٔ مستقل، به همان Listing متصل می‌شوند. فهرست/شمارندهٔ بازار مدل را یک بار می‌شمارد. منبع اضافی، SKU، موجودی، قیمت پرداختنی یا تعهد تأمین نیست و انتخاب خودکار ارزان‌ترین منبع در سفارش انجام نمی‌شود.

هر منبع وضعیت انتشار، نام دو زبان، پیوند مجاز، گزارش unknown/available/unavailable، زمان مشاهده/پایان اعتبار و مبلغ مرجع ریال رشته‌ای دارد. گذشت زمان گزارش را stale می‌کند. منبع پنهان و تاریخچه‌اش عمومی نیستند؛ منبع نمونه در Production خوانده یا نوشته نمی‌شود. مدل دارای پیشنهاد فروشگاهی با ماندهٔ آزاد یا مدل نامعتبر همچنان از بازار بیرون است.

تاریخچه append-only در مالک Market است. هر ذخیرهٔ منبع اصلی از پنل/CSV و هر فرمان منبع اضافی، snapshot تازه ثبت می‌کند؛ خواندن دوباره تاریخچهٔ قبلی را با قیمت یا نام جاری جایگزین نمی‌کند. زمان ثبت سیستم از زمان مشاهدهٔ اعلام‌شده جداست. migration فقط یک snapshot از دادهٔ موجود با origin=migrationBaseline و زمان واقعی ارتقا می‌سازد؛ این رکورد، تاریخچهٔ ازدست‌رفته یا اتصال زنده را اثبات نمی‌کند. تاریخچهٔ عمومی فقط snapshotهای Published مجاز منبعی را می‌دهد که اکنون هم منتشر است؛ پنل نقش‌دار می‌تواند حالت‌های غیرعمومی را بخواند. هر صفحه۲۰رکورد، sequence و cursor به صورت decimalstring.

فرمان منبع اضافی با rootSerializable، catalog.write/MFA، نسخهٔ Listing و Source، actor+UUID/hash/رسید پایدار و audit اتمیک انجام می‌شود. تغییر هر منبع نسخهٔ والد را bump می‌کند تا رقابت/سقف۱۶ و خواندن مجموعه کنترل شوند. هویت sourceKey/itemKey منبع اضافی پس از ایجاد ثابت است. یکتایی میان منبع اصلی و اضافی در writerهای مجاز تحت همان تراکنش و ایندکس‌های SQL کنترل می‌شود؛ نوشتن مستقیم SQL مسیر مجاز نیست. history از API و EF قابل ویرایش/حذف نیست؛ سطح دسترسی SQL مستقل همچنان موضوع استقرار است.

مرزهای جدید: GET عمومی `/api/market/{locale}/{listingId}/sources` و `/{listingId}/sources/{sourceId}/history?before=`؛ GET پنل `/api/admin/market/{listingId}/sources` و history؛ PUT `/api/admin/market/{listingId}/sources/{sourceId}/commands/{requestId}`؛ GET actor-scoped `/api/admin/market/source-commands/{requestId}`. منبع اصلی از فرم قدیمی ویرایش می‌شود. CSV مدل قدیمی همچنان یک ردیف برای هر مدل/منبع اصلی است؛ CSV گزارش منابع اضافی به پذیرش مستقل نیاز دارد.

پذیرش لازم: SQLواقعی برای چندمنبع بدون تکثیر مدل/موجودی، تاریخچهٔ قدیمی/مهاجرت، idempotency/replay/قطع پاسخ و rollback audit/receipt، staleversion/رقابت سقف و duplicate، نقش/MFA/actor/Production/hidden/no-stockeligibility، پولبزرگ و paging؛ قراردادهای strict FA/EN/BFF، پنل متصل، مرورگر و بکاپ/حفظداده پیش از انتشار. شواهد پذیرش پایین ثبت‌اند؛ موارد بیرونی و mobile/CSVتکمیلی کامل معرفی نمی‌شوند.


## شواهد پذیرش۴۴

۸۳۵واحد/۵۱۵SQLکامل/۳۲۵فروشگاه/۱۹۲پنل،typecheck/build،۱۳DLL و۱۱wireواقعی پذیرفته‌اند. مرورگر GUID QA با MFAخودش create/edit،دوقطع200،sameUUID/body در ناوبری وGETreceipt،دوگزارشFA/EN/ریال بزرگ را پذیرفت؛ دوCommand/یکSource/دوObservationتازه،تمامداده‌هایCatalog/انبار/مالی ثابت وcleanupموفق. consoleخالی وdesktop1280بدونoverflow؛mobileباز. `market-sources44-runtime-set.json` immutable و `market-sources-browser-acceptance.json` شاهدند.

بکاپpre44/VERIFYONLY۱۷٬۹۴۴٬۵۷۶بایت،افزودن۳جدول ویکmigration،حفظتمامlegacy/table-schema/views،سهbaselineمطابققدیمی و صفرتست‌داده،CHECKDB،۳۱۰۹HTTP/۸wireاصلی/۶private401/no-store ومرورگرbaselineصادقانه پذیرفته‌اند. `market-sources44-main-release.json` مرجع است. Downباوجودهرhistoryیاreceiptمتوقفمی‌شود؛ نسخهقدیمیwriterعلیه44 یاrestoreخودکار انجام نشود. پشتیبان وکلیدها محفوظ‌اند.

شکست‌ها: امضای Description/JsonSerializerOptions وanalyzerدرکدآزمون اصلاح شد. نقشContentManager واقعاًcatalog.readدارد؛ تست خواندن راOK و نوشتن را403 کنترل کرد. تستHTTP رشتهٔregexبهassert.match داده بود وschemaVersionدرTSliteralنبود؛ فقطتست اصلاحشد. guardتاریخیMarketدررگرسیون نخست۵۱۴/۵۱۵ بهآخرینschemaوابسته بود؛ دقیقاًمانندguardInventory بهmigrationخودش مقید و کل۵۱۵موفق شد. بیلدsandboxبدونخروجیفقطباPIDخودشمتوقفوبدونbuildserverموفقشد. ابزارnative datetime fillمقدارظاهریبدونstateمی‌داد؛400محافظسرور وورودی واقعی کیبورد درمرورگر ثبت‌اند؛ محصولبرای ابزارضعیف‌نشد.
