# وضعیت و نقطهٔ ادامه

آخرین به‌روزرسانی: 2026-10-25. **فیلتر ویژگی‌های تایپ‌دار بازار روی اصلی محلی۴۳ منتشر است؛ کل پروژه/PDF کامل نیست.** مرجع `artifacts/checks/market-attributes43-main-release.json` و [MARKET-ATTRIBUTES](MARKET-ATTRIBUTES.md) است. وضعیت۴۲ در [آرشیو](archive/STATUS-before-market-attributes43-release.md) محفوظ است. هدف D34 ادامه تا همهٔ بخش‌هاست؛ پایان این برش پایان هدف نیست.

## کار جاری پس از انتشار۴۳

سورس۴۴ در حال پذیرش است؛ هنوز روی اصلی۴۳ منتشر نشده. چندمنبع/تاریخچه با سه جدول Market و baseline صادقانه از منبع قدیمی، فرمان actor+UUID/رسید/نسخه، guard حفظ داده در Down، API عمومی و پنل و FA/EN ساخته‌اند. ده SQL تازه و یک guard تاریخی هدفمند موفق‌اند؛۳۲۵فروشگاه/۱۹۲پنل و build هر دو رابط موفق. رگرسیون SQL کامل نخست۵۱۴/۵۱۵ بود؛ تنها تست guard تاریخی Market به migration خودش مقید شد و اجرای کامل تازه جاری است. بسته‌بندی immutable،wire،مرورگر و انتشار هنوز بازند. CSV مدل قبلی فقط منبع اصلی را پوشش می‌دهد؛ CSV منابع اضافی آمادهٔ بعدی این دامنه است. [MARKET-SOURCES](MARKET-SOURCES.md) پیش‌نویس قرارداد است؛ کامل معرفی نشود.

## اجرای محلی جاری — ۴۳

- SQL اصلی: ۴۳ migration، همان۱۲۱ جدول/۹schema؛ تنها سه view فقط‌خواندنی Catalog اضافه شدند. تمام۱۲۰جدول غیر از history خود Catalog و schema/تعریف viewهای قبلی دقیقاً محفوظ‌اند؛ history فقط یک رکورد افزوده است. پس از HTTP و مرورگر تمام۱۲۱جدول با پس از migration برابرند. Stock101/0/0 و صفر Order/Reservation/SourcingRequest/CheckoutSettings/ChargePolicy/UsedInspection؛ هیچ seed یا تنظیم مالی اجرا نشد.
- API5080: `tmp/api-runtime-market-attributes43-label-fix-8fdb17627d204aaca4dfb08708991314`؛ PID64933/session59634. restart: `python3 tmp/market-attributes43-release.py serve-api`. ContentRoot و keyring قبلی، ۱۳DLL مطابق unit/SQL/harness.
- Next3000: `tmp/storefront-runtime-market-attributes43-main-ff6079c6325246ebb467530660c1cbdd`؛ build=`DV7MyRO--j0KWMJVQ627U`؛ PID64984/session13621. restart: `python3 tmp/market-attributes43-release.py serve-storefront`. API5080، preview خاموش و هر۱۶۹asset قبلی hash برابر محفوظ.
- پنل3173: `tmp/admin-runtime-market-attributes43-main-f0174fb8279142709b9f7e72cb4a3d68`؛ PID65014/session29348. restart: `node tmp/serve-market-attributes43-main-admin.mjs`؛ هر۳۴۷asset قبلی محفوظ. پنل دائمی http://127.0.0.1:3173/ است؛3175QA موقت پاک شده.
- descriptorهای `tmp/{api,storefront,admin}-runtime-current.json` مرجع‌اند. نسخه۴۲، candidateهای immutable و بکاپ۱۶٬۸۹۶٬۰۰۰بایتی COPY_ONLY/CHECKSUM/VERIFYONLY با کپی خصوصی کلیدها محفوظ‌اند؛ `main-pre43-release-backup.json`. Down/restore خودکار انجام نشد. Redis پارسه طبقD32 running و دست‌نخورده است. صفر SaymanTest و بسته‌بودن3105/3175/5181/5182 تأیید شد؛ فقط تب‌های QA30/31 و بررسی اصلی32 بسته شدند.

## پذیرش ویژگی‌های بازار

۸۳۵ واحد، کل۵۰۵SQL واقعی،۳۲۲فروشگاه/۱۹۰پنل و typecheck/build،۱۳DLL و۲۰پاسخ خام SQL با decoder تولیدی موفق‌اند. AND/OR، پنج نوع، precision28/8، صفر/false/unknown، شمارش distinct، پین صفر،۶۴تعریف، interleaving از writer واقعی و migrationDown/reapply آزموده‌اند. QA مرورگر با مدیر/MFA خودش تغییر عنوان/واحد از پنل→SQL→FA/EN بدون deploy، انتخاب‌ها/زبان/تغییر دسته، حالت خالی/clear و ORچندانتخابی را پذیرفت؛ فقط یک audit، صفر اثر تجاری و Stock101/0/0. GUID/کلیدهای خودش پاک شدند. consoleها خالی، عرض واقعی۱۲۸۰ بدون overflow بود؛ **موبایل هنوز پذیرفته نیست**.

انتشار اصلی: بکاپ تازه،۴۲→۴۳،CHECKDB،۲۴۸۴بررسی HTTP شامل بازاجرای۱۸۹۵قبلی،۱۶پاسخ خام واقعی metadata/values/search/facets در API/BFFدو زبان، hash assetها/private401/no-store و مرورگر اصلی پذیرفته‌اند. نمونه QA/سیاست/provider وارد اصلی نشد. `market-attributes43-main-{before,after,post-smoke,post-browser,public-smoke,browser,release}.json` و `market-attributes-main-wire/acceptance.json` مرجع‌اند. candidate پیش از اصلاح SSRlabel و fixture اولیه با کلید underscore ردشده و تاریخی‌اند؛ فقط label-fix runtime-set منتشر است.

## ادامهٔ جاری برای D34

۱. بعدی: **چند منبع و تاریخچهٔ مشاهدهٔ بازار**؛ سپس هلو warehouse/unit/reconciliation/apply فایل مجاز. ابتدا قرارداد فعلی و راه مهاجرت/تاریخچه دقیق شود. نسخه/ماژول هلو طبقD30 نامعلوم؛ دوباره پرسیده نشود و vendor endpoint جعل نشود؛ live خاموش.
۲. سپس عملیات ارسال/تحویل/مالکیت دستگاه/مرجوعی، پرونده چک/مدارک، CMSپیشرفته/support/notification، معیارهایPDF و پذیرشLinux/mobile/load/backup طبق PLAN ادامه دارند. scaffold کامل معرفی نشود.
۳. D14 انتشار محلی/API/admin مجاز؛D16providerاطلاعات ندارد،D21سیاست نمونه فقطQA،D32Redisروشن،D33پاک‌سازی۱٫۶۷GiB ثبت،D34هدفکلپروژه. هزینه/مالیات/گارانتی/مرجوعی/درصد واقعی چک هنوز سیاست تأییدشده ندارند. مجوز نظر دیجی‌کالا/APIبازار/ترب و قرارداد هلو لازم‌اند؛ بدون scrape/جعل. کلtmp حذف نشود؛ live/rollback/key/backup/restart وابستگی دارند.
