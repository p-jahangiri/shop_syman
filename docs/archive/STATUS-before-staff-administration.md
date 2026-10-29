# وضعیت و نقطهٔ ادامه

آخرین به‌روزرسانی: 2026-10-23. پروژهٔ کامل PDF هنوز تمام نشده و برای فروش واقعی آماده نیست؛ تمام دامنهٔ PRD/PLAN حفظ شده است. سابقه در [آرشیو پیش از بازیابی MFA](../archive/STATUS-before-mfa-recovery.md)، [آرشیو پیش از صفحه‌بندی موجودی](../archive/STATUS-before-stock-pagination.md) و آرشیوهای قدیمی‌تر محفوظ است.

## تصمیم‌ها و محیط

- D14: ظاهر/جریان تأیید و ادامهٔ API، پنل مستقل و SQL مجاز است؛ تأیید دوباره لازم نیست. دادهٔ پویا، FA/EN، روش خرید هر تنوع، ورود موبایل/OTP و ایمیل یا نام کاربری/رمز و Linux Docker الزامی‌اند.
- D19: مالک گفته «فضا را آزاد می‌کنم؛ بعد اعلام می‌کنم»؛ پایان کار هنوز اعلام نشده. SQL/Docker تازه، migration اصلی یا deployment در ادامه‌های اخیر اجرا نشده‌اند؛ فقط source/build/unit و QA مستقل بدون SQL. آخرین مشاهدهٔ read-only فضا۷٫۷GiB است؛ فضا به‌تنهایی جای اعلام مالک را نمی‌گیرد.
- D17: parseh-chat-redis خاموش بماند. فایل شخصی/volume حذف یا تغییر داده نشده‌اند. فقط process/پوشهٔ موقت متعلق به QA همین پروژه پاک شدند.
- D16: providerهای درگاه، پیامک و ایمیل فعلاً اطلاعات ندارند و غیرفعال‌اند؛ هیچ موفقیت ساختگی auth/مالی در API نیست. سیاست واقعی هزینهٔ ارسال/مالیات، نرخ/ماه چک و جزئیات گارانتی/مرجوعی هنوز تعیین نشده؛ رایگان/صفر فرض نشود.
- ثبت MFA حساب اصلی پنل به مالک واگذار شده؛ عامل کلید/کد مالک را نمی‌خواند یا ثبت نمی‌کند. QA واقعی آینده فقط با حساب/کلید موقت و SQL ایزوله انجام شود.
- آخرین سلامت ثبت‌شدهٔ SQL: ONLINE و DBCC CHECKDB بدون repair/خطا، در بازیابی قبلی؛ بعد از D19 دوباره query نشده. SQL2022 CU22 روی MacARM/Rosetta جای پذیرش Linux x64 نیست.
- Docker: builder مستقل sayman-build و wrapper build-local-image.py --isolated؛ حداقل۱۰GiB برای شروع/توقف build خودش زیر۳GiB. cache آسیب‌دیدهٔ پیش‌فرض و volumeها دست‌نخورده‌اند. آخرین تست Linux پیش از audit/رزرو۹۶ موفق بود؛ runtimeهای تازه هنوز پذیرفته نشده‌اند.

## سورس و اجرای زنده

| بخش | وضعیت |
|---|---|
| API5080 / Next3000 / admin3173 | نسخهٔ پذیرفته‌شدهٔ هزینه/quote2؛ این ادامه جایگزین نشد. PIDهای آخر۱۳۶۹۴/۱۳۷۱۹/۹۳۹۰؛ پیش از توقف دوباره مالکیت بررسی شود |
| SQL اصلی | آخرین اعمال۱۷ migration در هفت schema؛ migration۱۸ TemporaryOrders و۱۹ IdentityMfaRecovery روی اصلی اعمال نشده‌اند |
| سورس فروش | سفارش موقت/رزرو/لغو/انقضا، audit و quote3؛ رابط/انتشار هنوز در انتظار پذیرش متصل |
| Next تازه | build ایزولهٔ .next-qa مربوط به sitemap موفق؛ .next زنده و generated TS آن حفظ شدند؛ سورس فروشگاه در این برش تغییر نکرد |
| پنل تازه | build ایزولهٔ tmp/mfa-recovery-admin-dist موفق؛ JS اولیه entry+preload۴۰۹٫۷۴/gzip۱۲۷٫۸۳kB؛ dist زنده عوض نشد |
| storefront3100 | کانتینر قدیمی؛ مرجع سورس جاری نیست |
| QA۳۱۷۵/۵۱۸۱ | parent/child terminal و listenerها بسته؛ control/پوشهٔ موقت حذف، viewport reset و تب آزمایشی بسته؛ هیچ credential/DB یا ورود موفقی ساخته نشد |

فرمان‌های main همچنان backend-local.py و serve-storefront-api.py هستند. اجرای آن‌ها با سورس تازه پیش از migration لازم مجاز نیست؛ build ایزوله جای build/انتشار عادی را نگرفته است.

## برش تازه: بازیابی MFA کارکنان

[MFA-RECOVERY.md](../MFA-RECOVERY.md) مرجع است. کارکنان از نشست کامل با رمز و TOTP تازه،۱۰ کد پشتیبان۱۲۸بیتی تولید می‌کنند؛ فقط hash وابسته به حساب ذخیره می‌شود. بازیابی با رمز و کد استفاده‌نشده، همهٔ نشست‌های قدیمی را باطل و فقط مجوز۵دقیقه‌ای ثبت دوباره می‌دهد. وضعیت ماندگار MfaRecoveryPending جلوی ثبت کلید با ورود صرفاً رمز را می‌گیرد؛ setup deadline را تمدید نمی‌کند و تا verify تازه permission/refresh صادر نمی‌شود.

همهٔ انتقال‌های MFA قفل/تراکنش همان کاربر، بررسی دوبارهٔ stamp و audit بدون credential دارند. ورود درست با رمز برای MFA شمارندهٔ شکست را صفر نمی‌کند؛ refresh با stamp منسوخ هم stamp جدید را دوباره نمی‌چرخاند. API فقط حساب خود، نقش کارکنان و Origin/client پنل را می‌پذیرد. پنل امنیت شمارنده، تولید/نمایش یک‌باره/دانلود صریح و فرم بازیابی دارد؛ کدها cache/storage/URL ندارند و ورودی‌ها پس از تلاش پاک می‌شوند.

۳۱۱ بک‌اند،۲۰ contract،۱۰ wire واقعی test host با سرویس مصنوعی و۱۴ QA محدود رابط با fixture رد همهٔ ورودها موفق‌اند. پنج SQL تازه فقط compile و discovery شده‌اند؛ کل SQL۷۸ و۱۹ مورد تازه اجرا نشده‌اند. مثبت MFA/همزمانی/قطع پاسخ/بازیابی backup پذیرفته نشده؛ حساب/کلید مالک دست‌نخورده و مدیریت کارکنان/بازیابی بدون کد پشتیبان باز است. Source۱۹ و main۱۷ هستند؛ Sales۱۸ و Identity۱۹ هر دو قبل از runtime تازه لازم‌اند. QA خود پروژه terminal و main عوض نشده است.

## برش پیشین: مدیریت کالا و انتخاب‌گر CMS

[ADMIN-PRODUCTS.md](../ADMIN-PRODUCTS.md) مرجع است. فهرست خلاصهٔ۵۰تایی با seek/TOP51 و فیلتر نام/SKU/وضعیت/دسته/برند از graph کامل جدا شد؛ جزئیات کامل فقط همان یک کالا هنگام ویرایش خوانده می‌شود. lookup حداکثر۲۴ شناسه در GET catalog/product-lookup با شناسهٔ معتبر lookup تداخل ندارد؛ تمام خواندن‌ها catalog.read کامل و بدون audit mutation هستند. پنل catalog را metadataOnly می‌خواند؛ endpoint قدیمی برای سازگاری حفظ است.

ProductsPage صفحه/خطا/retry و فرم تک‌کالا دارد. ProductPicker در بلوک‌های products/collection انتخاب‌های مفقود/خارج صفحه و ترتیب را نگه می‌دارد؛ حذف صریح، جابه‌جایی و سقف۲۴ دارد و تا بازشدن query نمی‌زند. nullableهای نهایی nextCursor در سه صفحه و version تنوع بدون Stock به‌طور صریح null serialize می‌شوند؛ تنظیم عمومی ASP.NET تغییر نکرد.

۲۸۸ بک‌اند،۱۶ contract پنل،۷ بررسی پاسخ واقعی ASP.NET با schema تولید TypeScript و۲۳ QA محدود کامپوننت موفق‌اند؛ build/typecheck/model check و compile SQL هم موفق‌اند. SQL۷۳ فقط discovery شده و۱۴ مورد تازه اجرا نشده‌اند. فرم ویرایش/انتشار، ذخیرهٔ CMS و مجوز واقعی با MFA هنوز پذیرفته نشده‌اند؛ fixture جای آن‌ها نیست. درخواست نوشتن و snapshot کامل در fixture صفر بود؛۴۹ درخواست cookie موجود مرورگر داشتند، فقط boolean حضور ثبت شد و fixture از آن برای هویت استفاده نکرد. کلید/حساب/دیتابیس ساخته نشد. QA خود پروژه بسته و main بدون تغییر است.

دسته‌ها/برندها/ویژگی‌ها/گزینه‌ها و فهرست طرح‌ها هنوز کامل خوانده می‌شوند؛ pagination/بار و حدود روابط یک کالای بسیار بزرگ باقی است. این برش Catalog/CMS یا پروژه را کامل نمی‌کند.

## برش پیشین: موجودی صفحه‌بندی‌شده

[INVENTORY-PAGING.md](../INVENTORY-PAGING.md) مرجع است. IAdminStockCatalog فقط متادیتای۵۰ تنوع با TOP51 و seek می‌دهد؛ composition root از IAdminStockReader موجودی همان شناسه‌ها را می‌گیرد. تنوع بدون Stock صفر/version=null و تنوع Draft/Hidden/غیرفعال هم قابل مدیریت است؛ خطای خواندن هرگز صفر نمی‌شود. جست‌وجوی نام/SKU با نرمال‌سازی فارسی و فیلتر فعالیت/cursor وابسته به فیلتر، خواندن تک‌تنوع و شمارنده‌های مستقل داشبورد اضافه شدند؛ هیچ قیمت/graph کامل در این مسیر نیست.

صفحهٔ موجودی و داشبورد دیگر snapshot کامل Catalog/Stock درخواست نمی‌کنند؛ queryهای دیگر هنگام نیاز فعال‌اند. جدول server-page، خالی/خطا/retry و میان‌بر گردش دارد. فرم اصلاح قبل از ارسال همان تنوع را تازه می‌گیرد، تعداد فارسی و payload نوع‌دار دارد و retry نامعلوم را با payload/UUID قبلی نگه می‌دارد؛ با بستن/refresh از دست می‌رود و پذیرش واقعی آن هنوز باقی است. تراکنش/رزرو/فرمان adjust سرور تغییر نکرد. Catalog/Finance/Content و فهرست طرح‌ها هنوز تکمیل pagination می‌خواهند؛ plan/بار و snapshot مشترک خواندن‌ها پذیرفته نشده‌اند.

۲۶۷ بک‌اند و۱۰ contract پنل، typecheck/build ایزوله و مدل‌های بدون تغییر موفق‌اند.۱۴ QA روی کامپوننت واقعی با fixture صریح فقط خواندنی، از جمله۵۰/۵۰/۱، SKU خارج صفحهٔ اول، فیلتر، صفرِ بدون Stock، خطا/retry/schema و موبایل۳۹۰×۸۴۴ بدون overflow، موفق‌اند. خواندن snapshot کامل در fixture صفر؛ گردش مدیر احرازشده/فرم اصلاح پذیرفته نشده. دو SQL تازه فقط compile و discovery بدون اجرا، تعداد۷۱ را نشان داد.

## برش‌های قبلی و مرز پذیرش

| مرجع | سورس/شاهد و کار باقی |
|---|---|
| TEMPORARY-ORDERS | سفارش نقدی موقتِ پیش‌فرض خاموش، transaction اتمیک سفارش/hold/مصرف سبد، idempotency و snapshot صحیح ریال؛ contact/address حافظه‌ای و فهرست/لغو FA/EN؛ SQL قبلی۱۲ سفارش موفق، QA کامل رابط/انتشار باقی؛ canPay همواره false/gateway_unconfigured |
| CHECKOUT-CHARGES / CHECKOUT-QUOTES | هزینه/quote2 و پنل مالی با SQL/MFA موقت در اجرای قبلی پذیرفته؛ سیاست اصلی همچنان تعیین‌نشده؛ quote3 source جلوتر است |
| INVENTORY-HISTORY | صفحهٔ۵۰ گردش فیزیکی با seek و فیلتر؛۱۵ QA تاریخی کامپوننت و پنج contract موفق؛ دو SQL تازه فقط compile؛ Native GET قدیمی همچنان سازگار است ولی پنل جاری مسیر PAGING را می‌خواند |
| OFFLINE-PROJECTION | DTO عمومی محدود بدون مالی/هویت؛۱۶ HTTP build واقعی و واحدها موفق؛ دو SQL تازه فقط compile؛ مدل بدون تغییر |
| SITEMAP-PROJECTION | count و کلیدهای صفحهٔ۱۰۰۰، فایل‌های root و robots بدون graph؛۲۹ HTTP build واقعی موفق؛ دو SQL تازه فقط compile؛ native API هنوز preview و ایندکس واقعی بسته است |
| ADMIN-PERFORMANCE | lazy صفحات و PageBoundary؛ runtime دو تست قبلی موفق؛ navigation/خطای chunk احرازشده و Core Web Vitals باقی |

A15 مهلت فنی۱۵دقیقه/یک سفارش باز با حدود۱–۶۰/۱–۱۰ است، نه سیاست تجاری. سفارش موقت فقط نقدی online مثبت/معلوم بدون نیاز به تأیید و با فعال‌سازی صریح مدیر مجاز است. چک/اقساط provider، پرداخت/refund قطعی و ارسال واقعی جدا باقی‌اند.

## آخرین شواهد

| بررسی | نتیجه |
|---|---|
| Shop.Tests | **۳۱۱ موفق**، شامل۲۳ تازهٔ recovery/مدل/فرمت/مجوز/Origin/قرارداد؛ no SQL |
| admin contract | **۲۰ موفق**، شامل۴ تازهٔ recovery؛ TypeScript و Vite build مستقل موفق؛ دو تست runtime هم موفق |
| storefront npm test | **۱۰۷ موفق در برش قبلی**؛ این برش سورس Next را تغییر نداد و دوباره اجرا نکرد |
| Shop.SqlTests | **۵۹ موفق در اجرای قبلی**؛۱۹ مورد تازه اجرا نشده‌اند، compile صفر warning/error و discovery فقط۷۸ مورد |
| مدل‌ها | Identity model check تازه بدون تغییر جامانده؛ Sales۱۸ و Identity۱۹ در سورس و اعمال‌نشده؛ Catalog/Inventory check قبلی محفوظ است |
| wire تازه | **۱۰ پاسخ HTTP واقعی test host با reader/service مصنوعی** در schema TypeScript تولید؛ شامل۳ recovery؛ بدون SQL/هویت واقعی |
| UI امنیت | **۱۴ بررسی محدود با fixture رد همهٔ authها**، بدون تولید کد/بازیابی واقعی؛ سه صفحهٔ موبایل بدون overflow؛ console صفر |
| UI کالا | **۲۳ بررسی محدود فقط خواندنی** و smoke مسیر نهایی lookup؛ فهرست/picker موبایل بدون overflow؛ console error/warning صفر |
| UI موجودی | **۱۴ بررسی محدود فقط خواندنی**؛ .jpg desktop/mobile و inventory-page-layout-ui/http.json؛ خطای console/warning گزارش‌شده صفر |
| UI/HTTP قبلی | history۱۵، مهمان سفارش۱۱، BFF بدون هویت۱۴، sitemap۲۹ و offline۱۶؛ هر کدام محدود به دامنهٔ گزارش خودش، جای SQL/MFA نیست |
| SQL/مرورگر قبلی متصل | سبد۱۱، quote دو زبان و پنل هزینه۱۲ بررسی با MFA/SQL موقت؛ مرجع اسناد همان برش‌ها |

گزارش تازه artifacts/checks/mfa-recovery-source.json و logهای mfa-recovery-* است؛ Vite entry۳۲۴٫۱۲ + schemas preload۸۵٫۶۲، جمع اولیه۴۰۹٫۷۴/gzip۱۲۷٫۸۳kB و امنیت lazy۳٫۹۷kB بدون هشدار۵۰۰kB؛ تفکیک chunk کاهش JS اولیه ادعا نمی‌شود. گزارش‌های product/stock قبلی محفوظ‌اند. سایر گزارش‌ها/تصاویر قبلی حفظ شده‌اند؛ خلاصهٔ جزئی در آرشیو وجود دارد.

یک اجرای SQL پیشین CoreCLR SIGSEGV/GetThreadLocalStaticBase داشت؛ علت اثبات نشده، سپس۱۲ سفارش و۵۹ کامل بدون حذف همزمانی پاس شدند. orphan احتمالی DB/key آن crash فقط با اثبات دقیق مالکیت بررسی شود؛ پاک‌سازی عمومی SaymanTest_* مجاز نیست.

## مسیر ادامه

1. تا اعلام پایان آزادسازی فضا SQL/Docker تازه اجرا نکن؛ کار مستقل source/QA بدون هویت ادامه یابد. D16/D17 و MFA مالک حفظ شوند.
2. پس از اعلام، فضا/سلامت محیط را بررسی و **SQL۷۸** را واقعاً اجرا کن.۱۹ مورد تازه: چهار سفارش (غیرفعال/مهلت/rollback audit/seek)، دو آفلاین، دو sitemap، دو history، دو stock page/lookup/summary/نقش واقعی و دو product page/detail/ویرایش نسخه‌دار/نقش واقعی و پنج MFA recovery/rotation/replay/rollback/lockout.
3. SHOP_UI_OPERATIONS_QA=1 و SQL جدا: مدیر موقت دارای MFA و مشتری؛ ساخت کد پشتیبان/بازیابی/ثبت کلید تازه/مهلت و قطع پاسخ/ابطال نشست؛ هزینه/سفارش/quote3/ثبت/خالی‌شدن سبد/رزرو/replay/لغو و FA/EN/موبایل؛ جدول موجودی/فرم اصلاح/تعارض/retry، history، product detail/ویرایش/انتشار و انتخاب/ذخیرهٔ CMS، projectionهای واقعی و navigation/chunk پنل. fixture فقط خواندنی جای این پذیرش نیست.
4. پس از پذیرش: migration۱۸ و۱۹ روی اصلی، build عادی Next/Vite و runtimeهای خود پروژه با PID تأییدشده، smoke و حفظ پیش‌فرض سفارش خاموش/هزینهٔ تعیین‌نشده. آخرین نسخهٔ زنده همچنان quote2 است.
5. Linux x64 و image/runtime تازه، ClamAV/S3 واقعی و upload/Ready بدون ارجاع، مدیریت کارکنان/بازیابی بدون کد پشتیبان و backup عملی، query plan/بار و pagination باقی مدیریت؛ اسناد MEDIA/INVENTORY-RESERVATIONS/SERVER-CART/CHECKOUT-QUOTES/CHECKOUT-CHARGES/PWA-SEO مرجع‌اند.
6. تمام فازهای PLAN/PRD/PDF حفظ شوند: callback/پرداخت/refund واقعی، تأیید چک/مدارک، ارسال/تخفیف/سریال، CMS پیشرفته/SEO، نصب/Push/accessibility/performance دستگاه، support/review/market و قابلیت‌های تکمیلی، CI/پایش و backup/restore و تحویل نهایی. اسکلت/adapter خاموش معیار پایان نیست؛ هدف کامل فعال می‌ماند.
