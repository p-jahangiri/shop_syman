# وضعیت و نقطهٔ ادامه

آخرین به‌روزرسانی: 2026-10-25. **چند منبع و تاریخچهٔ بازار روی اصلی محلی۴۴ منتشر است؛ کل پروژه/PDF کامل نیست.** مرجع `artifacts/checks/market-sources44-main-release.json` و [MARKET-SOURCES](MARKET-SOURCES.md) است. وضعیت۴۳ در [آرشیو](archive/STATUS-before-market-sources44-release.md) و [MARKET-ATTRIBUTES](MARKET-ATTRIBUTES.md) محفوظ است. هدف D34 تمام بخش‌هاست؛ پایان این برش پایان هدف نیست.

## کار جاری پس از انتشار۴۴

سورس۴۵ (هنوز منتشر نشده): CSVگزارش منابع تکمیلی با preview فقط‌خواندنی، چند ردیف یک والد، parent/source/model/metadata expectations و batchSerializable/actor+UUID/رسید/hashUTF8 فایل ساخته شده؛ یک جدول رسید تازه و guardDown دارد. API/پنل و۸تستparser/۱۹۵پنل/بیلدپنل/دوserverproxy موفق‌اند.۱۲SQLهدفمند شاملbatch50/rollback و guardتاریخی موفق؛ رگرسیون۵۲۶ پیش از اصلاح canonicalشناسه و پیوند منبع موفق و اجرای نهایی همان۵۲۶ جاری است.۸۴۴واحد نهایی و۹wireخام واقعی/decoder/hashمتنUTF8 موفق‌اند. بسته‌بندی immutable،filechooser/مرورگر/قطع پاسخ/cleanup و انتشار باقی است. storefrontکدجدید ندارد؛ همانbuildآزموده۴۴باAPIسازگار خواهد ماند. [MARKET-SOURCE-CSV](MARKET-SOURCE-CSV.md) پیش‌نویس و log/TRXهای `market-source-csv-*` مرجع‌اند.

## اجرای محلی جاری — ۴۴

- SQL اصلی: ۴۴ migration،۱۲۴ جدول/۹schema. سه جدول Sources/SourceObservations/SourceCommands اضافه شده‌اند؛ همهٔ۱۲۰جدول غیر از history خود Market و تمام schema/viewهای قدیمی دقیقاً محفوظ‌اند؛ history فقط یک رکورد افزوده دارد. سه baseline دقیقاً مطابق سه منبع قبلی با زمان واقعی ارتقا ساخته شد؛ صفر منبع تکمیلی/فرمان QA به اصلی منتقل شد. پس از HTTP و مرورگر هر۱۲۴جدول با پس از migration برابرند. Stock101/0/0 و صفر Order/Reservation/SourcingRequest/CheckoutSettings/ChargePolicy/UsedInspection؛ seed/سیاست مالی اجرا نشد.
- API5080: `tmp/api-runtime-market-sources44-a345d2b13be243358fdab7695f265178`؛ PID99058/session18258. restart: `python3 tmp/market-sources44-release.py serve-api`. ContentRoot/keyring قبلی و۱۳DLL مطابق unit/SQL/harness.
- Next3000: `tmp/storefront-runtime-market-sources44-main-7241797dfdf64a088ab23602a89f8d4f`؛ build=`5IuIFFIFlBqpFOCP-uTzn`؛ PID99085/session90724. restart: `python3 tmp/market-sources44-release.py serve-storefront`. API5080، preview خاموش و هر۱۷۶asset قبلی با hash برابر محفوظ.
- پنل3173: `tmp/admin-runtime-market-sources44-main-aa430c23ba2f4cfa94f043bc87bbe3d7`؛ PID99136/session34139. restart: `node tmp/serve-market-sources44-main-admin.mjs`؛ هر۳۷۱asset قبلی محفوظ. پنل دائمی http://127.0.0.1:3173/؛3175QA موقت پاک شده.
- `tmp/{api,storefront,admin}-runtime-current.json` مرجع‌اند. بکاپ تازه۱۷٬۹۴۴٬۵۷۶بایت COPY_ONLY/CHECKSUM/VERIFYONLY و کپی خصوصی کلیدها، candidate ثابت و نسخه۴۳ محفوظ‌اند. `main-pre44-release-backup.json` مرجع است. Down با وجود هر گزارش/رسید، حتی baseline، داده را حذف نمی‌کند و51000 می‌دهد. restore/Down یا اجرای writerقدیمی علیه44 خودکار انجام نشود؛ مسیر بازگشت باید داده و کلیدها را حفظ کند.
- Redis پارسه طبقD32 running و دست‌نخورده؛ صفرSaymanTest و بسته‌بودن3105/3175/5181/5182 تأیید شد. فقط تب‌هایQA33/34 و بررسی اصلی35 بسته شدند. فایل‌های شخصی/بکاپ/کلید حذف نشدند.

## پذیرش چندمنبع و تاریخچه

شناسهٔ مدل/Listing/سبد تأمین ثابت است؛ حداکثر۱۵منبع تکمیلی کنار منبع اصلی می‌ماند و مدل یک بار شمرده می‌شود. هر منبع زمان، قیمت مرجع و وضعیت خودش را دارد. API/EFتاریخچه را فقط append می‌کنند؛ baseline مهاجرت سابقهٔ قبل از ارتقا را جعل نمی‌کند. فرمان اضافی نسخهٔ والد/منبع،rootSerializable،actor+UUID/hash،رسید و audit اتمیک دارد؛ هویت اضافی پس از ثبت ثابت است. فقط گزارش‌های Published منبع اکنون منتشر، با eligibility بازار عمومی‌اند؛ Productionنمونه را حذف می‌کند. انتخاب خودکار قیمت/تأمین‌کننده و سفارش قابل پرداخت تازه ایجاد نمی‌شود.

۸۳۵واحد،کل۵۱۵SQLواقعی،۳۲۵فروشگاه/۱۹۲پنل،typecheck/build و۱۳DLLهمسان موفق‌اند. دهSQLجدید چندمنبع/قیمت‌بزرگ/تاریخچه/صفحه۲۰تایی/نقش/رقابتUUID/سقف/duplicate/rollbackreceiptوaudit/appendonly/migrationbaselineوguardDown را پوشش دارند. guardقدیمیOrder2بهmigrationخودش مقید شد؛ guardضعیف‌نشد. یازده پاسخ خام واقعی با decoderتولیدی بدونnormalization پذیرفته‌اند.

مرورگر GUIDخودQA/مدیر+MFAخودش: create و edit یک منبع، دو پاسخ200کامل قطع‌شده، همانbyteهایUUID/body در ناوبری برندها→بازار،قفل فرم و GETرسیدبدونmutation، دو نام/قیمت تاریخی دقیق درFA/EN پذیرفته‌اند. یک منبع/دوگزارش جدید/دورسید، تمامCatalog/Inventory/مالی ثابت؛ cleanupموفق. consoleخالی،actual1280/client=scroll1265بدونoverflow؛ **موبایل پذیرفته نیست**. نخست ابزار fill تاریخ را بهstate نرساند وAPIدرخواست ناقص را400ردکرد؛ کلید طبیعیArrowDown/Up تاریخ را ثبت کرد، کدمحصول تغییرنکرد. شواهد `market-sources-browser-{acceptance,observations,sql-before,sql-after,fault-acceptance}.json` و تصاویراند.

انتشار: بکاپ تازه،۴۳→۴۴،CHECKDB،حفظlegacy/baselineصادقانه،۳۱۰۹HTTPشامل۲۴۸۴قبلی،هشتwireاصلیAPI/BFFدو زبان و ششprivate401/no-store،مرورگر اصلی با توضیح شروع تاریخچه و انتخاب‌های قدیمیِ دست‌نخورده پذیرفته‌اند. `market-sources44-main-{before,after,post-smoke,public-smoke,browser,release}.json` و `market-sources-main-wire/acceptance.json` مرجع‌اند. post-smoke پس از هردوHTTPومرورگر گرفته شد؛ تکرار بی‌دلیل دیگری انجام نشد.

## ادامهٔ جاری برای D34

۱. بعدی همین دامنه: **CSVگزارش منابع تکمیلی** با preview بی‌نوشتن و commitفایل اتمیک/نسخه/رسید؛ CSVمدل قبلی فقط منبع اصلی را ویرایش می‌کند و جای آن نمی‌آید. سپس هلو warehouse/unit/reconciliation/apply فایل مجاز. D30نسخه/ماژول هلو نامعلوم، دوباره پرسیده نشود،vendorendpointجعل نشود و liveخاموش بماند.
۲. سپس ارسال/تحویل/مالکیت دستگاه/مرجوعی،پرونده چک/مدارک،CMSپیشرفته/support/notification،mobile/accessibility/SEO/performance/CI/nativeLinux/load/backup و همهٔPDF طبقPLAN ادامه دارند. scaffoldکامل معرفی نشود. مهارت وPRD stack ثابت‌اند.
۳. D14API/admin/انتشار محلی مجاز؛D16providerاطلاعات ندارد؛D21سیاست نمونه فقطQA؛D32Redisروشن؛D33پاک‌سازی۱٫۶۷GiB؛D34هدفکلپروژه. سیاست واقعی هزینه/مالیات/گارانتی/مرجوعی/درصد چک تعیین نشده. منابع بازار/نظر دیجی‌کالا/ترب و قرارداد هلو مجوز لازم دارند؛ بدونscrape/جعل. کلtmpحذف نشود؛ live/rollback/key/backup/restart وابستگی دارند.
