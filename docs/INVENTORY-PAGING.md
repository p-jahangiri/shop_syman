# صفحه‌بندی موجودی و خلاصهٔ داشبورد

پذیرش جدید 2026-10-23: D20 توقف فضا را رفع کرد؛ **۱۲۹/۱۲۹ SQL واقعی** شامل آزمون‌های این برش موفق شدند. اعداد compile-only و توقف D19 متن زیر تاریخی‌اند؛ QA مرورگر متصل، main migration۱۸–۲۱ و Linux x64/بار هنوز جدا باقی‌اند. وضعیت جاری در [STATUS](STATUS.md) است.

وضعیت 2026-10-23: سورس، unit/contract و QA فقط خواندنی آماده‌اند؛ SQL جدید، گردش اصلاح موجودی احرازشده و انتشار روی اجرای اصلی هنوز باقی‌اند. این برش پایان pagination تمام مدیریت نیست.

قبلاً پنل پس از ورود snapshot کامل کاتالوگ و Stock را می‌گرفت و جدول موجودی همهٔ تنوع‌ها را در مرورگر می‌ساخت. اکنون صفحهٔ موجودی مستقل و lazy است؛ Catalog فقط۵۱ شناسه/متادیتای مختصر برای تشخیص صفحهٔ بعد می‌خواند،۵۰ مورد را برمی‌گرداند و composition root موجودی همان۵۰ شناسه را از قرارداد Inventory می‌گیرد. DbContextها مستقل مانده‌اند؛ هیچ ماژولی context ماژول دیگر را مصرف نمی‌کند.

## قرارداد

| مسیر | مجوز و پاسخ |
|---|---|
| GET `/api/admin/inventory/variants?query=...&active=all&cursor=...` | inventory.read کامل؛ version1/pageSize50/items/nextCursor |
| GET `/api/admin/inventory/variants/{id}` | inventory.read کامل؛ متادیتا و موجودی تازهٔ همان تنوع یا404 |
| GET `/api/admin/inventory/summary` | inventory.read کامل؛ stockRecords/availableVariants/reservedVariants به شکل رشتهٔ رقم لاتین |
| GET `/api/admin/catalog/summary` | catalog.read کامل؛ products/categories به شکل رشتهٔ رقم لاتین |

ردیف شامل variantId، productId، sku، nameFa/nameEn، isActive، productStatus، onHand، reserved، available و version است. قیمت، گارانتی، روش خرید، تصویر، توضیح و graph کامل خوانده نمی‌شوند. ماندهٔ آزاد onHand−reserved است؛ آمادهٔ فروش‌بودن کالا یا اعتبار روش خرید از این عدد استنتاج نمی‌شود. شمارندهٔ داشبورد صرفاً ردیف‌های Stock با ماندهٔ آزاد مثبت را می‌شمارد؛ فیلتر انتشار/فعال‌بودن کاتالوگ ندارد.

صفحه از **تنوع‌های Catalog** شروع می‌شود؛ نبود رکورد Stock، برای تنوع موجود، صفر/صفر و version=null می‌دهد. رکورد موجودیِ صفر version واقعی دارد. تنوع Draft/Hidden یا غیرفعال هم برای عملیات انبار قابل مشاهده است؛ حذف Stock به معنی حذف تنوع از جدول نیست. فقط فقدان خود تنوع404 است؛ خطای دیتابیس یا سرویس به موجودی صفر تبدیل نمی‌شود.

query حداکثر۱۲۰ نویسه و۸ واژه، با یکسان‌سازی ی/ک/ارقام/فاصله و AND واژه‌ها در SKU یا نام دو زبان است. active فقط all/true/false است. فیلتر قیمت/برند یا ماندهٔ آزاد در این مسیر اضافه نشده. جست‌وجو با SearchSku/SearchName تعمیرنشده503 می‌دهد؛ فرمان repair موجود طبق CATALOG-QUERY باید قبل از پذیرش deployment انجام شود. حالت بدون جست‌وجو به این فیلدها وابسته نیست.

ترتیب شناسهٔ تنوع صعودی و seek با همان collation دیتابیس است؛ cursor حداکثر۳۰۰ نویسه، وابسته به query نرمال‌شده و active و نامعتبر/ناسازگار400 است. binding cursor مجوز یا امضای امنیتی نیست؛ اجازه از policy نشست کامل می‌آید. query صفحه TOP51 دارد، COUNT/OFFSET یا Include ندارد. Inventory فقط شناسه‌های صفحه را با no-tracking می‌خواند؛ ورودی قرارداد حداکثر۵۰ شناسهٔ یکتا و امن است. مسیر بدون جست‌وجو دو خواندن Catalog/Inventory، و جست‌وجو حداکثر دو EXISTS آمادگی اضافه دارد؛ شمارنده‌های داشبورد queryهای جدا هستند. زمان/plan/بار این فرمان‌ها هنوز روی SQL واقعی پذیرفته نشده است.

صفحه، متادیتا و Stock خواندن‌های مستقل‌اند و snapshot مشترک تراکنشی ندارند؛ تغییر همزمان موجودی یا ساخت تنوع ممکن است نتیجهٔ نمایش را تغییر دهد. درج/ویرایش در طول پیمایش snapshot کامل ثابت نمی‌دهد. فرمان اصلاح موجودی همچنان نسخه و تراکنش/idempotency سرور را دوباره می‌سنجد؛ این خواندن جای آن را نمی‌گیرد. شناسهٔ lookup قبل از ساخت DTO در query فیلتر می‌شود؛ بررسی ToQueryString همین مسیر ایراد ترجمهٔ اولیه را آشکار کرد و پس از اصلاح، بدون client filtering ترجمه می‌شود. schema تغییر نکرده و مدل Catalog/Inventory بدون تغییر جامانده است.

## پنل

جدول موجودی جست‌وجوی سرور، فیلتر فعالیت، قبلی/بعدی، تازه‌سازی، خالی و خطا/retry دارد. هر تغییرِ اعمال‌شده از cursor اول شروع می‌شود؛ cache صفحهٔ ترک‌شده gcTime=0 و request قابل لغو است. پاسخ strict، سقف/تکرار، فعالیت و رابطهٔ فیزیکی/رزرو/آزاد و version را بررسی می‌کند. میان‌بر گردش، تاریخچهٔ همان تنوع را انتخاب می‌کند. جدول در region قابل تمرکزِ افقی قرار دارد؛ نتیجهٔ فقط خواندنی فرم اصلاح نشان نمی‌دهد.

فرم اصلاح قبل از submit، رکورد همان تنوع را تازه دریافت می‌کند؛ GET ناموفق فرم قابل ارسال یا صفر فرضی ایجاد نمی‌کند. ورودی تعداد ارقام فارسی را می‌پذیرد؛ payload نوع‌دار و غیرصفر/حداکثر یک میلیون، دلیل تا۵۰۰ و UUID دارد. درخواست با نتیجهٔ نامعلوم همان payload/UUID را برای retry نگه می‌دارد و ویرایش موقتاً قفل می‌شود؛ خطای قطعی4xx به‌جز408 اجازهٔ اصلاح می‌دهد. این تلاش فقط حافظه‌ای است؛ بستن پنجره/refresh آن را از دست می‌دهد و متن فرم بررسی گردش پیش از اصلاح دوباره را توضیح می‌دهد. پذیرش واقعی این فرم و خطا/همزمانی با SQL/MFA هنوز باقی است.

App دیگر برای موجودی یا داشبورد snapshot کاتالوگ/Stock نمی‌خواند؛ شمارنده‌های مختصر جایگزین شدند. queryهای کاتالوگ، CMS و روش خرید فقط در صفحهٔ نیازمند فعال‌اند. صفحات Catalog/Finance/Content هنوز snapshot کامل کاتالوگ دارند و فهرست طرح‌ها برای شمارندهٔ چک باقی است؛ این برش ادعای پایان کارایی مدیریت یا آزمون runtime کامل App پس از MFA نیست.

## شواهد

- **۲۶۷ بک‌اند موفق**، شامل۲۱ مورد تازه: قرارداد ورودی، cursor، lookup محدود، صفرِ بدون Stock، SQL TOP/seek بدون graph و مجوز/MFA. پاسخ موفق unit از reader صریح test assembly است و شاهد SQL نیست.
- **۱۰ contract پنل موفق**؛ پنج مورد قبلی history و پنج مورد تازهٔ مقادیر/نسخه/سقف/دادهٔ خصوصی، شمارندهٔ بزرگ BigInt، فیلتر و تعداد فارسی. TypeScript و Vite build ایزوله در `tmp/inventory-page-admin-dist` موفق‌اند؛ entry۴۰۵٫۲۳kB/gzip۱۲۵٫۳۰، inventory۱۴٫۸۳kB و operations۲۲٫۸۳kB، بدون هشدار۵۰۰kB. dist زنده تغییر نکرد.
- **۱۴ QA روی InventoryPage/History واقعی با fixture صریح فقط خواندنی**:۵۰/۵۰/۱، قبلی، غیرفعال، SKU خارج صفحهٔ اول، تنوع بدون Stock، گردش، خالی، محدودیت واژه،503/retry و رد پاسخ خصوصی، موبایل۳۹۰×۸۴۴ بدون overflow سند. console error/warning گزارش‌شده صفر. هیچ ورود موفق، credential، SQL یا mutation در این fixture وجود ندارد؛ مسیرهای GET همان دادهٔ نمونهٔ واضح‌اند.
- فرمان `scripts/serve-inventory-history-layout.py --explicit-stock-page-fixture`؛ گزارش‌ها `inventory-page-{source,layout-ui,layout-http}.json` و logهای build/SQL compile/model/discovery؛ تصاویر `sayman-inventory-page-{desktop,mobile}.jpg` در artifacts/checks. process خود QA terminal، پورت۳۱۷۵/۵۱۸۱ بسته، control/پوشهٔ موقت حذف، viewport reset و تب آزمایشی بسته شده است.

دو SQL تازه برای۱۰۱ تنوع Draft/غیرفعال و بدون Stock،۵۰/۵۰/۱، نام فارسی/SKU، rowversion/lookup و نقش‌های موقت با MFA واقعی و summary نوشته و **فقط compile شده‌اند**. discovery بدون اجرا۷۱ مورد را نشان داد. شاهد SQL قبلی۵۹ است؛ در برش بعدِ ADMIN-PRODUCTS دو SQL دیگر اضافه شد؛ اکنون discovery۷۳ و۱۴ مورد تازه (چهار سفارش، دو آفلاین، دو sitemap، دو history، دو stock page و دو admin products) هنوز اجرا نشده‌اند. طبق D19 پس از اعلام پایان آزادسازی فضا، SQL۷۳ و QA واقعی پنل/فرم/همزمانی، plan/بار، سپس migration۱۸/build/update اصلی و smoke ادامه یابد؛ providerها غیرفعال و parseh-chat-redis خاموش بمانند.

اصلاح پسین قرارداد در ADMIN-PRODUCTS: serializer واقعی ASP.NET null را به‌طور پیش‌فرض حذف می‌کند؛ nextCursor نهایی و version تنوع بدون Stock صریحاً null می‌مانند. تست‌های HTTP native و۷ بررسی schema تولید TypeScript این شکل wire را تأیید کردند؛ تست source جای اجرای SQL/پنل واقعی نیست. مرجع [ADMIN-PRODUCTS.md](ADMIN-PRODUCTS.md).

نقطهٔ ادامهٔ فعلی پس از برش STAFF-ADMINISTRATION: هدف SQL۸۴ با۲۵ مورد تازهٔ اجرا‌نشده است؛ شش مورد کارکنان به مجموعه افزوده شده و migration۱۹ Identity نیز کنار۱۸ Sales قبل از runtime تازه لازم است. اعداد discovery بالای این سند شاهد زمان همان برش‌اند؛ دستور اجرای جاری در [STATUS.md](STATUS.md) و [MFA-RECOVERY.md](MFA-RECOVERY.md) دنبال شود. تا اعلام مالک دربارهٔ فضا SQL/Docker تازه اجرا نشود.
