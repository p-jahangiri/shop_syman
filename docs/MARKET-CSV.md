# ورود CSV و پنل بازار

وضعیت 2026-10-23: برش CSV/مدیریت متصل پذیرفته و در API5080/پنل3173/SQL اصلی۲۴ اجرا می‌شود. MARKET-02 هنوز صفحهٔ عمومی فروشگاه، سبد درخواست و پیشنهاد/قبول/تبدیل می‌خواهد. [STATUS](STATUS.md) runtime و مانع‌های جاری را دارد.

CSV UTF-8 حداکثر۱۲۸KiB/۵۰ ردیف/۱۶۰ ستون/۸۰۰۰ کاراکتر هر خانه و۶۴ کلید ویژگی است؛ BOM، ویرگول/newline کوتیشن‌دار و کوتیشن دوتایی پذیرفته می‌شوند. رکورد خالی کنار گذاشته می‌شود؛ rowNumber شمارهٔ رکورد منطقی است. سرستون ناشناخته/تکراری، تعداد ستون متفاوت و UTF-8 خراب رد می‌شوند. همهٔ ستون‌های snapshot منبع/قیمت/تاریخ در template اجباری‌اند؛ خانهٔ خالی در این ستون‌ها حذف صریح/نداشتن مقدار است. description غایب حفظ و description خالی پاک می‌شود.

source_key+source_item_key مبنای upsert و model_id اتصال صریح مدل موجود است. slug موجود بدون اتصال صریح خطاست. این برش برای هر مدل یک منبع دارد. مقدار غایب/خالی attr.<key>.<part> ویژگی قبلی را حفظ و attr.<key>.clear=true حذف صریح است؛ ترکیب حذف و مقدار خطاست. partها fa/en/number/bool/option_id/option_ids هستند؛ فهرست تصویر/گزینه با | جدا می‌شود. ارقام فارسی/عربی نرمال و صفر/false حفظ می‌شوند. تاریخ ISO با Z/offset، مبلغ ریال مثبتِ integer/string و ویژگی decimal بدون grouping/exponent است. JSON decimal مدل نیز رشته است تا JS دقت را از دست ندهد. قالب مختص سایمان است؛ خروجی native سرویس ثالث فرض نمی‌شود.

## مرز HTTP

همه زیر /api/admin، دارای MFA و catalog.write (template و خواندن مدل catalog.read) هستند:

| روش/مسیر | رفتار |
|---|---|
| POST /market/import/preview | {csv}؛ فقط خواندن، schemaVersion1، خطا/عملیات هر ردیف و expected نسخه‌ها؛ هیچ مدل/receipt/audit موفقی ثبت نمی‌کند |
| POST /market/import/commit | {csv,requestId,expected}؛ UUID و نسخهٔ listing/model و fingerprint دسته/برند/تعریف ویژگی از preview |
| GET /market/import/receipts/{requestId} | رسید فقط متعلق به همان actor؛404 پایان فرمان در حال اجرا را ثابت نمی‌کند |
| GET /market/import/template | CSV UTF-8/BOM فقط سرستون، authenticated download |
| GET /market/models/{id} | مشخصات مشترک قابل ویرایش +StorefrontStatus/HasOffers، بدون قیمت/SKU خصوصی |
| PUT /market/{id}/edit | {model,details,listingVersion}؛ ویرایش اتمیک مدل و منبع، حفظ قیمت/گارانتی/Stock/قواعد پیشنهادهای موجود |

commit کل فایل را دوباره اعتبارسنجی می‌کند و expected دقیق را مقایسه می‌کند؛ تغییر متادیتا/نسخه409 و خطای هر ردیف مانع ثبت کل فایل است. receipt actor+UUID و hash CSV/expected همراه Catalog+Market+audit زیر transaction ریشهٔ Serializable ذخیره می‌شود. خرابی receipt یا audit، همهٔ ردیف‌ها را rollback می‌کند. retry همان body/UUID پاسخ ذخیره‌شده با replayed=true، بدنهٔ متفاوت409 است. CSV خام، token و credential در receipt ثبت نمی‌شود؛ فقط hash، پاسخ، شمار/زمان/actor و ContainsDemo. نمونه در Production نه وارد و نه بازخوانی می‌شود. syntax CSV پیش از receipt lookup بررسی می‌شود؛ GET receipt راه مستقل پیگیری است.

## پنل و پذیرش

پنل فهرست۵۰تایی/seek/جست‌وجو/وضعیت/دسته، فرم مدل بدون SKU، ویرایش مشترک و راهنمای شناسهٔ دسته/برند/گزینه‌ها از metadata دارد. preview، خطای ردیف، مبلغ BigInt، commit صریح، UUID و unknown/retry/receipt پیاده‌اند. فرمان frozen فقط RAM و owner-scoped است؛ جابه‌جایی بین صفحات حفظ و logout/بستن تب پاک می‌کند. reload به نگه‌داشتن کد برای GET receipt نیاز دارد. فرایند ارسال خودکار retry دامنه‌ای ندارد؛ مرورگر ممکن است اتصال HTTP قطع‌شده را خودش retry کند، که receipt پایدار آن را پوشش می‌دهد.

- ۴۶۲ واحد، کل۱۵۲ SQL واقعی (صفر fail/skip)،۵۷ تست پنل،۲ proxy و۷ strict decoder روی پاسخ واقعی SQL موفق‌اند.۹ SQL تازه stale metadata/نسخه، نقش/MFA، صفر/false/پول بزرگ، حفظ پیشنهادهای قبلی، actor isolation، رقابت UUID، rollback خرابی receipt و ویرایش مشترک را پوشش می‌دهند. شواهد market-csv-final-*،market-csv-full-*،market-panel-final3-* و market-csv-wire موجودند.
- مرورگر SQL واقعی با حساب/MFA تولیدشدهٔ خودش: ساخت/ویرایش، preview بدون write در SQL، ایجاد/به‌روزرسانی و رسید، عدد9007199254740993، خطای ترجمه‌شده، راهنمای پویا و موبایل پذیرفته‌اند. gate فقط QA پاسخ200 واقعی را قطع کرد؛ unknown/قفل فایل/همان body و UUID در ناوبری و retry دستی/replayed با یک receipt ثابت شدند. report:market-csv-ui-acceptance.json، تصاویر market-csv-ui-*.jpg. این آزمون از textarea استفاده کرد؛ file chooser واقعی/تمام نوع‌ها و نقش محدود در مرورگر هنوز جداست.
- پس از main-pre24 COPY_ONLY/CHECKSUM/VERIFYONLY و کپی خصوصی key ring، migration۲۴ فقط ImportReceipts را افزود. main/source۲۴،۳ نمونهٔ قبلی و صفر receipt اصلی، حفظ حساب/قیمت/Stock/CMS و DBCC فیزیکی صفر خطا پذیرفته شدند. QA/کلیدهایش پاک، صفر SaymanTest و Redis چت exited است. market-csv-main-state.json. restore عملی schema۲۴/native Linux/بار هنوز پذیرفته نیستند.
