# سازگاری فیلترهای پویا و مرز نگه‌داری جست‌وجو

پذیرش جدید 2026-10-23: D20 توقف فضا را رفع کرد؛ **۱۲۹/۱۲۹ SQL واقعی** شامل آزمون‌های این برش موفق شدند. اعداد compile-only و توقف D19 متن زیر تاریخی‌اند؛ QA مرورگر متصل، main migration۱۸–۲۱ و Linux x64/بار هنوز جدا باقی‌اند. وضعیت جاری در [STATUS](STATUS.md) است.

به‌روزرسانی 2026-10-23؛ این برش source/build/unit است. D19 همچنان منتظر اعلام پایان آزادسازی است؛ هیچ SQL/Docker/main یا credential مالک استفاده/تغییر نکرده است. source migration۲۰ و آخرین اعمال اصلی۱۷ حفظ‌اند؛ پذیرش واقعی SQL و انتشار انجام نشده‌اند.

## یافته و تغییر

FacetValues تعریف ویژگی شامل نوع/واحد را پیش از queryهای count، page و selectedValues می‌خواند. Filters ترجمه/نام/واحد هر تعریف را پیش از خواندن مقادیر آن می‌خواند. این مسیرها کنترل نسخهٔ مستقل نداشتند؛ ویرایش مجاز گزینه/عنوان/واحد یا قانون دسته می‌توانست بخش‌های دو ویرایش را ترکیب کند. مسئله از سورس این مسیرها مشخص شد؛ نقص quote/order از آن استنتاج نمی‌شود.

اکنون هر عملیات در بودجهٔ read-only حداکثر دو تلاش CatalogReadRetry اجرا می‌شود. دسته‌های فعال و نسبت والد/فرزند همراه نسخه ثبت می‌شوند؛ بعد از count/page/selected، نسخهٔ تعریف‌های مورد استفاده و دسته‌های scope دوباره با query فقط Id/Version و batch۵۰۰ بررسی می‌شود. در Filters کنترل پس از تمام facetهاست؛ تلاش مجدد، کل فهرست را از ابتدا می‌خواند. ReadFacetPage بودجهٔ تو در تو ندارد. در حالت بدون دسته هم scope دسته‌ها تأیید می‌شود.

اگر تعریف پیدا نشد، نسخهٔ scope قبل از unknown_catalog_filter بررسی می‌شود تا حذف/تغییر قانون میان دو query، بی‌بررسی نماند. بعد از تغییر پایدارِ قانون، همان خطای400ِ فیلتر نامعتبر حفظ می‌شود. تغییر مداوم نسخه در هر دو تلاش catalog_unavailable/503 می‌دهد؛ validation، لغو و catalog_reindex_required دوباره خودکار اجرا نمی‌شوند. no-store و شکل DTO/endpoint/مجوزها تغییر نکرده‌اند. مقدار حداکثر قیمت همچنان long ریال و JSON رشته‌ای یا null است؛ Number ویژگی همچنان decimal دقیق با واحد نمایشی است و به float تبدیل نمی‌شود.

رفتار پنج نوع ویژگی، override تنوع، ترتیب و سقف page/selected، مقدار انتخاب‌شدهٔ بیرون صفحه و fallback زبان عوض نشده‌اند. readiness قبلی facet-values و search حفظ است؛ Filters با query اولیهٔ بدون عبارت جست‌وجو همان رفتار قبلی را دارد. شکست به sample یا فهرست خالی موفق تبدیل نمی‌شود؛ Next/Vite این برش تغییر نکردند.

## نگه‌داری داده‌های مشتق

RepairSearchFieldsAsync از قبل pending write را رد و در batch۲۵۰/RepeatableRead، normalization مشترک NFKC/فارسی را با SaveChanges انجام می‌داد. این رفتار حفظ شد؛ reader retry برای این فرمان نوشتن استفاده نمی‌شود. اکنون cancellation پیش از هر تغییر tracker بررسی می‌شود و transaction موجود EF یا ambient transaction قبل از Clear رد می‌شود. ابزار باید context و تراکنش‌های خودش را داشته باشد؛ نمی‌تواند تراکنش فراخواننده را commit، detach یا به آن وارد شود.

بازسازی فقط فیلد مشتق را اصلاح می‌کند؛ از آن سیاست تجاری یا ویرایش عنوان/قیمت ایجاد نمی‌شود. batchهای قبلیِ commit‌شده باقی می‌مانند؛ batch شکست‌خورده rollback می‌شود و اجرای مجدد با context تازه رکوردهای باقی‌مانده را می‌خواند. مقدار متنِ نرمال‌شدهٔ خالی، رشتهٔ خالی است و با null تعمیرنشده تفاوت دارد؛ این تفاوت جلوی حلقهٔ بی‌پایان را می‌گیرد. کارایی/همزمانی واقعی و شکست میان batchها هنوز به اجرای SQL نیاز دارند.

## مرز تضمین و شواهد

کنترل optimistic به چرخش نسخه توسط writer مجاز وابسته است؛ SQL دستیِ تغییر فرزند بدون bump پوشش ندارد. این snapshot سراسری داده‌های محصول، قیمت حداکثر، برندها، count/page/selected یا موجودی نیست. تغییر مقادیر محصول و insertion phantom می‌تواند میان queryها رخ دهد؛ صفحه‌بندی live است و رزرو/تضمین قیمت نیست. pagination تعریف‌های ویژگی/تمام metadata، query plan/بار و QA متصل باقی‌اند.

- **۴۰۷ Shop.Tests موفق**:۸ تازه +۳۹۹ رگرسیون، بدون SQL. ورودی نامعتبر/لغوشده بدون اتصال؛ حفظ write در حال انتظار؛ حفظ tracker در cancellation/ambient transaction؛ دو endpoint واقعی test host با سرویس مصنوعی و پاسخ503/no-store بدون نتیجهٔ خالی موفق. تست‌های query/ریال/مجوز/retry پیشین هم در suite هستند.
- build واحد و SQL صفر warning/error؛ Catalog has-pending-model-changes با startup API و design factory بدون تغییر جامانده. schema تازه لازم نیست؛ source۲۰/main۱۷ حفظ‌اند.
- **هشت SQL تازه فقط compile/discovery**: تغییر همزمان تعداد/صفحه/selected بیرون صفحهٔ گزینه؛ عنوان/واحد/label فهرست؛ حذف rule دسته؛ دو تلاش ناپایدار؛ واحد ویژگی عددی؛ رد transaction SQL والد بدون detach/commit؛ commit batch۲۵۰ و شکست batch بعد/ادامه با context تازه؛ متنِ whitespace و پایان repair/readiness. هیچ‌کدام اجرا نشده‌اند.
- کل SQL کشف‌شده **۱۲۰** است:۵۹ شاهد اجرای قبلی و **۶۱ تازه اجرا نشده**. fixture بعداً فقط DB/key/account موقت خودش را می‌سازد؛ MFA مالک استفاده نمی‌شود.
- سورس Next/Vite تغییر نکرد؛ تست‌ها/build/QA پیشین آن‌ها این بار تکرار نشدند. هیچ fixture ارائه‌شدهٔ مرورگر/تب/viewport ساخته نشد؛ فقط test host داخلیِ بدون SQL اجرا شد و تمام commandهای این برش terminal‌اند.

گزارش artifacts/checks/catalog-facets-source.json و logهای catalog-facets-* مرجع‌اند. بعد از اعلام پایان آزادسازی باید SQL۱۲۰، concurrency/rollback/repair، UI متصل با MFA موقت و plan/بار واقعاً بررسی شوند؛ سپس migrationهای۱۸/۱۹/۲۰ و runtime تازه طبق پذیرش. گام مستقل بعدی INV-01 سریال/IMEI است: سورس Inventory فعلاً فقط stock/ledger/reservation دارد و نباید آن الزام PDF کامل شمرده شود. کل هدف PDF، providerهای واقعی، Linux x64 و تمرین restore همچنان بازند.
