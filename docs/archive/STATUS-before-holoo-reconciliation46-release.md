# وضعیت و نقطهٔ ادامه

آخرین به‌روزرسانی: 2026-10-25. **CSV منابع تکمیلی روی اصلی محلی۴۵ منتشر است؛ کل پروژه/PDF کامل نیست.** هدف D34 تمام بخش‌هاست؛ کار با پایان این برش متوقف نمی‌شود. مرجع `artifacts/checks/market-source-csv45-main-release.json` و [MARKET-SOURCE-CSV](MARKET-SOURCE-CSV.md) است. وضعیت۴۴ در [آرشیو](archive/STATUS-before-market-source-csv45-release.md) محفوظ است.

## کار جاری پس از انتشار۴۵

سورس۴۶ هنوز منتشر نشده: Inventory دو جدول نگاشت انبار و رسید actor+UUID می‌افزاید؛ هویت ثابت BIN2/rowversion/فقط یک منبع فعال با تأیید صریح whole_store_physical و rootSerializable/audit. واحدها از نگاشت دریافت موجود استفاده می‌کنند. پیش‌نمایش تطبیق در تراکنش فقط‌خواندنی root بین Catalog/Inventory، تبدیل دقیق decimal/ratio شامل صفر، Stock/رزرو سفارش و تأمین/گردش جدید/رهگیری و دستگاه کارکرده را گزارش می‌دهد؛ canApplyManual/canSyncLive=false. UI/ناوبری واحدها و journalمالک ساخته شده؛۸۶۱واحد/۲۰۱پنل وbuild/typecheck موفق. ۱۹SQLهدفمند/کل۵۴۳SQLواقعی و۵wireخامباdecoderتولیدی موفق‌اند؛بستهimmutable۴۶ با۱۳DLLهمسانunit/SQL/harness ساخته‌شد. مرورگر/cleanup/backup/انتشار هنوز بازند. فایل‌های holoo-reconciliation-* شواهد جاری‌اند. VSTestداخلsandboxبهپورتخودشاجازهنداشت؛خارجsandbox۸۶۱موفقشد. اصلی۴۵ دست‌نخورده بالا است.

## اجرای اصلی محلی۴۵

- SQL:۴۵migration/۱۲۵جدول/۹schema. فقط market.SourceImportReceipts خالی افزوده شد؛۱۲۳جدول قدیمی غیر از historyخودMarket و همهschema/viewها دقیقاً محفوظ‌اند. پس از HTTP و مرورگر هر۱۲۵جدول برابر پس ازmigration است. Stock101/0/0؛ Order/Reservation/SourcingRequest/CheckoutSettings/ChargePolicy/UsedInspection و SourceImportReceipt صفر. seed/سیاست مالی/دادهQA وارد اصلی نشد.
- API5080: `tmp/api-runtime-market-source-csv45-98507446df8b4a72876f8caa9517f937`؛ PID55331/session90327. restart: `python3 tmp/market-source-csv45-release.py serve-api`. ContentRoot/keyring قبلی،۱۳DLLهمسان unit/SQL/harness.
- Next3000: `tmp/storefront-runtime-market-source-csv45-main-a18f4c043f47416a9595af9750a32af4`؛ PID55383/session57067؛build `5IuIFFIFlBqpFOCP-uTzn` همانbuildآزموده۴۴ است،کد/بیلدتازه ادعا نمی‌شود. restart: `python3 tmp/market-source-csv45-release.py serve-storefront`؛API5080/previewخاموش،۱۸۳assetقبلی محفوظ.
- پنل3173: `tmp/admin-runtime-market-source-csv45-main-211e200dacb44e46957d80b0962894e5`؛PID55436/session94238؛restart:`node tmp/serve-market-source-csv45-main-admin.mjs`؛۴۰۰assetقبلی محفوظ. پنل دائمی http://127.0.0.1:3173/ است؛3175QAبسته و پاک شد.
- `tmp/{api,storefront,admin}-runtime-current.json` مرجع‌اند. بکاپ تازه۱۷٬۹۴۴٬۵۷۶بایت COPY_ONLY/CHECKSUM/VERIFYONLY و کپی خصوصی کلیدها محفوظ؛`main-pre45-release-backup.json` مرجع است. Down رسیددار متوقف می‌شود؛ Down/restore/اجرایwriterقدیمی علیه۴۵ خودکار انجام نشود. کلtmpپاک نشود.
- Redisپارسه طبقD32 running و دست‌نخورده. صفرSaymanTest،حذفکلیدخصوصیQA،بسته‌بودن3105/3175/5181/5182 و بستن فقط تب‌هایخودQA36/37 و اصلی38 تأیید شد.

## پذیرش CSV منابع تکمیلی

previewبدوننوشتن،۵۰گزارش/۱۲۸KiB،چندمنبعیکوالد،هویتثابتوقیمتریالرشته‌ای؛commit با نسخهٔوالد/منبع/مدل/metadata،rootSerializable،actor+UUID/hashمتنUTF8/رسید/audit اتمیک است. منبع اصلی همچنانCSVمدل دارد؛SKU/Stock/قیمتقابلپرداختتغییرنمی‌کند. RawCSVداخلSQLرسید ذخیره نمی‌شود. فایل تکراریمنبعردوکلثبتقفل‌می‌شود؛source_idخالیهویتِهمانمنبعراپیدامی‌کند.

۸۴۴unit/کل۵۲۶SQLواقعی/۱۹۵پنل/۲serverproxy،typecheck/build و۹wireخامباdecoderتولیدی/hashUTF8 موفق‌اند؛۳۲۵فروشگاه متعلق بهbuild۴۴ بدونتغییر است. CSV50/race/replay/actor/نقش/Production/metadata/rollbackمیانی/رسید/audit/guardDown پذیرفته‌اند. خطایاولEF1003باDDLliteralآزمونرفعشد؛هشدارخاموشنشد.

مرورگر: دو بار filechooserواقعی (فایلinvalidوvalid)،duplicateخطا/منعcommit،دو200کاملقطع‌شده/همانbyteهایbody+UUID+CRLF/hash،ناوبریبرندها→بازاروقفلRAM،GETرسیدبدونmutation،ایجاد۲منبعوupdate۱گزارشبدونduplicate؛تاریخچهFA/EN باقیمتدقیق۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۳→۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۴ریال پذیرفته‌اند. SQL:۲Source/۶Observation/۳Command/۲Import وتمامCatalog/Inventory/مالیثابت. consoleخالی/actual1280/client=scroll1265بدونoverflow؛**mobileپذیرفتهنیست**. ابزارfilechooser باوجودtimeoutدوبار۲۸۸/۴۳۷ثانیهکندبود؛updateازtextareaواقعی انجامشد. نخستassertشواهدhashحروفکوچکمنتظربودوباحروفبزرگcanonicalسروراصلاحشد؛کدمحصولتغییرنکرد.

انتشار: بکاپتازه/۴۴→۴۵/CHECKDB/۳۷۶۷HTTPشامل۳۱۰۹قبلی/رد401مسیرهایCSV/assetبرابر/مرورگراصلیوحفظتمام۱۲۵جدولپسازهردو پذیرفته‌اند. دادهQAوpolicyبه‌اصلیمنتقلنشد. `market-source-csv-browser-{acceptance,observations,sql-before,sql-post-preview,sql-after,fault-acceptance}.json` و `market-source-csv45-main-{before,after,post-smoke,public-smoke,browser,release}.json` و تصاویردرartifacts/checksمرجع‌اند.

## کار بعدی برای D34 — اکنون ادامه بده

۱. هلو: نگاشت warehouse/unit و reconciliation/applyصریح فایل مجاز با حفظرزروها و root/idempotency؛نسخه/ماژولD30نامعلوم،دوبارهپرسیده‌نشود،vendorendpointجعل‌نشود،liveخاموش. [HOLOO-INTEGRATION](HOLOO-INTEGRATION.md) و PLANمرجع‌اند.
۲. دسترسی بازار از منویCMSفعلی هنوزپیوندندارد؛قابلیتCMS/جریانpreview/publishرا بررسی‌وباحفظمحتوا تکمیل کن. سپس ارسال/تحویل/مالکیتدستگاه/مرجوعی،پروندهچک/مدارک،CMSپیشرفته/support/notification وکلPDF.
۳. mobile/accessibility/SEO/performance/CI/nativeLinux/load/backupومعیار۱۲گانهبازند؛scaffoldکاملنیست. D14انتشارمحلی/API/adminمجاز؛D16providerموجودنیست؛D21سیاستنمونهفقطQA؛D32Redisروشن؛D33۱٫۶۷GiBپاک‌سازی؛D34کلپروژه. هزینه/مالیات/گارانتی/مرجوعی/درصدچکواقعی نامعلوم. منابعخارجی/نظرDigiKala/ترب/هلوواقعیبهقراردادومجوزنیازدارند؛scrape/جعلانجامنشود.
