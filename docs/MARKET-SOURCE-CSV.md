# CSV گزارش منابع تکمیلی

سورس/اصلی محلی۴۵ پذیرفته و منتشر است. این فایل مکمل CSV مدل است و مدل، SKU، قیمت فروشگاهی، مشخصات یا ماندهٔ انبار را تغییر نمی‌دهد. مرجع انتشار `artifacts/checks/market-source-csv45-main-release.json` است.

قالب UTF-8 حداکثر۱۲۸KiB و۵۰ردیف دارد. ستون‌ها: listing_id، source_id، source_key، source_item_key، status، source_name_fa، source_name_en، source_url، availability، observed_at، valid_until، reference_price_rial و is_demo. همهٔ سرستون‌ها لازم‌اند؛ source_id می‌تواند خالی باشد. سایر خانه‌های خالی یعنی نداشتن مقدار؛ گزارش موجود/ناموجود و قیمت مرجع به زمان مشاهده و پایان اعتبار نیاز دارد. همان parser محدود CSV با کوتیشن/newline/BOM و قواعد ریال رشته‌ای و تاریخ ISO استفاده می‌شود؛ ستون مدل/Stock/SKU/ویژگی ناشناخته رد می‌شود.

listing_id شناسهٔ مدل در بازار است، نه model_id کاتالوگ؛ از پنل منابع کپی می‌شود. هویت منبع اضافی source_key+source_item_key ثابت است. source_id خالی، منبع اضافی همان هویت را پیدا می‌کند یا شناسهٔ پایدار از هویت و والد می‌سازد؛ هیچ تطبیق تقریبی یا اتصال خودکار به مدل دیگر انجام نمی‌شود. منبع اصلی با این قالب قابل ویرایش نیست و CSV مدل قبلی همچنان همان کار را انجام می‌دهد.

preview فقط خواندنی است و هر ردیف نسخهٔ والد/منبع/مدل و fingerprint متادیتا می‌گیرد. خطای هر ردیف مانع commit کل فایل است؛ تکرار منبع و سقف۱۵منبع اضافی برای هر مدل بررسی می‌شود. چند ردیف متمایز برای یک مدل مجاز است. commit تمام expectationها را پیش از نخستین نوشتن مقایسه می‌کند، سپس نسخهٔ والد را برای ردیف‌های متوالی داخل یک rootSerializable مصرف می‌کند. فرمان‌های منبع/گزارش‌ها، رسید هر ردیف، رسید actor+UUID/hash فایل و audit همگی اتمیک‌اند. CSV خام در رسید ذخیره نمی‌شود. replay همان UUID و فایل/expected، نتیجهٔ تاریخی را برمی‌گرداند و منبع/تاریخچه را دوباره ثبت نمی‌کند. Production نمونه را نمی‌خواند یا وارد نمی‌کند.

مسیرهای پنل: POST `/api/admin/market/source-import/preview` و `/commit`، GET `/receipts/{D-UUID}` و `/template`؛ preview/commit/receipt نیازمند catalog.write و MFA، template نیازمند catalog.read است. preview از success audit/transaction نوشتن معاف است. فقط جدول SourceImportReceipts افزوده می‌شود؛ Down با وجود رسید متوقف می‌شود.

پذیرش:۸۴۴unit/۵۲۶SQLواقعی/۱۹۵پنل/۲serverproxy و۹wireخام/hashدقیقUTF8 موفق‌اند. Storefrontهمانbuild۴۴/۳۲۵testاست. SQL چندردیفیکوالد،rollbackمیانی/رسید/audit،نسخه/metadata/race/replay/actor/role/Production/ظرفیت/پولدقیق وDownguard رامی‌آزماید.

مرورگرGUIDخودQA: filechooserواقعیinvalid/valid،منعduplicate،دوپاسخ200کاملقطع‌شده/همانUUID/bodyوbyteهایCRLF/hash،ناوبریوقفلRAM/GETرسید،۲منبعتازه+۱گزارشبه‌روزشدهوتاریخچهFA/EN موفق‌اند. SQL۶Observation/۳Command/۲ImportوتمامCatalog/Inventory/مالیثابت؛QAوکلیدهاپاک شدند. consoleخالی/actual1280بدونoverflow؛mobileبازاست. ابزارfilechooserباوجودtimeoutکندبود؛به‌عنوانایرادمحصولثبتنشد.

انتشار۴۵باbackupتازه/VERIFYONLY/کلیدها،یکجدولخالی،حفظ۱۲۳جدولقدیمیغیرhistory/schema/views،۳۷۶۷HTTPومرورگراصلی/حفظتمام۱۲۵جدولپسازهردو پذیرفتهشد. هیچنمونهQA/مالیبه‌اصلیمنتقلنشد. نسخه۴۴وbackupحفظ‌اند؛Downرسیددارممنوع‌است وrestore/oldwriterخودکارانجامنمی‌شود. STATUSمسیرrestartوPIDهایجاریرا دارد.

hashبهUTF8متندریافت‌شدهبسته‌است؛BOM/lineendingهمانمتنمحاسبه‌می‌شود،نهلزوماًباینریاصلیقبلdecodingمرورگر. CSVخامدرSQLرسیدنیست. شناسهٔوالدcanonicalرکوردواقعیوهویتsource_idاضافیlowercaseNاست. خطایEF1003تستباliteralرفعشد؛هشدارامنیتیخاموشنشد. نخستassertگزارشمرورگرحروفکوچکhashراانتظارداشتوباحروفبزرگcanonicalاصلاحشد؛محصولتغییرنکرد.
