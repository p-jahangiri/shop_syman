# وضعیت و نقطهٔ ادامه

آخرین به‌روزرسانی: 2026-10-23. پروژهٔ کامل PDF هنوز تمام نشده و برای فروش واقعی آماده نیست. PRD/PLAN دامنهٔ کامل را حفظ می‌کنند؛ این سند فقط آخرین وضعیت قابل اتکا را خلاصه می‌کند. سابقهٔ برش‌ها و شواهد قدیمی در [آرشیو](archive/STATUS-before-orders-layout-qa.md) محفوظ است.

## تصمیم‌های جاری و محیط

- D14: ظاهر و جریان فروشگاه تأیید شده و ادامهٔ API، پنل مستقل و SQL مجاز است؛ تأیید دوباره لازم نیست. دادهٔ تجاری پویا، FA/EN، روش خرید هر کالا/تنوع، ورود موبایل و ایمیل/نام کاربری و Linux Docker همچنان الزامی‌اند.
- D19: مالک گفته «فضا را آزاد می‌کنم؛ بعد اعلام می‌کنم»؛ پایان کار هنوز اعلام نشده. این ادامه‌های اخیر هیچ SQL/Docker تازه، migration اصلی یا deployment اجرا نکردند. فقط سورس، compile، تست سبک و QA مستقل بدون SQL ادامه یافت. مسیرهای محدود آفلاین/sitemap و تاریخچهٔ صفحه‌بندی‌شدهٔ انبار نیز در سورس اضافه شدند. آخرین مشاهدهٔ read-only دیسک۸٫۰GiB است.
- D17: parseh-chat-redis خاموش بماند. اجازهٔ حذف فایل شخصی یا volume وجود ندارد؛ هیچ‌کدام حذف نشده‌اند.
- D16: اطلاعات provider درگاه، پیامک و ایمیل موجود نیست؛ فعال‌سازی واقعی تا مستندات/دسترسی/sandbox غیرفعال می‌ماند. هزینهٔ واقعی ارسال/مالیات، درصد/ماه چک و جزئیات ضمانت/مرجوعی هم تعیین نشده‌اند؛ مقدار صفر/رایگان فرض نشود.
- ثبت Authenticator حساب اصلی پنل به مالک واگذار شده؛ عامل کلید/کد مالک را نمی‌خواند، ثبت یا تأیید نمی‌کند. QA قبلی مالی با FinanceManager موقت و MFA مستقل انجام شد.
- آخرین بازیابی ثبت‌شدهٔ SQL: Sayman برابر ONLINE و DBCC CHECKDB بدون repair و بدون خطا. این ادامه سلامت SQL را دوباره query نکرد؛ باز بودن پورت به معنی سلامت DB نیست. SQL2022 CU22 روی MacARM/Rosetta جای پذیرش نهایی Linux x64 را نمی‌گیرد.
- ساخت Docker همچنان از builder مستقل `sayman-build` و wrapper `scripts/build-local-image.py ... --isolated` استفاده کند؛ حداقل۱۰GiB برای شروع و توقف همان build زیر۳GiB. cache پیش‌فرض آسیب‌دیده و volume کاربر دست‌نخورده‌اند. آخرین تست Linux پیش از audit/رزرو۹۶ موفق بود؛ runtime جدید هنوز پذیرفته نشده است.

## سورس جدید و نسخهٔ زنده

| بخش | وضعیت قابل اتکا |
|---|---|
| API5080، فروشگاه3000 و پنل3173 | آخرین نسخهٔ پذیرفته‌شدهٔ برش هزینه و quote2؛ در این ادامه جایگزین نشدند. هر سه listener در پایان همچنان فعال بودند: PIDهای۱۳۶۹۴/۱۳۷۱۹/۹۳۹۰؛ پیش از هر توقف دوباره PID/مالکیت بررسی شود |
| SQL اصلی | آخرین اعمال ثبت‌شده۱۷ migration هفت schema؛ migration۱۸ TemporaryOrders روی اصلی اعمال نشده است |
| سورس Sales/API | سفارش موقت/رزرو/لغو/انقضا، تنظیم مجوزدار و audit، quote3 آماده؛ پذیرش رابط متصل/انتشار باقی |
| فروشگاه جدید | build تولیدی ایزولهٔ تازه برای sitemap در `.next-qa` موفق؛ `.next` زنده و فایل‌های generated TS آن حفظ شدند. QA مهمان/خطا و BFF بدون هویت انجام شد؛ گردش واقعی سفارش هنوز پذیرفته نشده |
| پنل جدید | build ایزوله `tmp/inventory-history-admin-dist` موفق؛ entry۴۰۲٫۰۶kB/gzip۱۲۴٫۱۷؛ تاریخچهٔ انبار به صفحه‌بندی سروری متصل و dist زنده تغییر نکرد |
| storefront3100 | کانتینر قدیمی؛ مرجع سورس تازه نیست |
| محیط‌های QA۳۱۰۵/۳۱۷۵/۵۱۸۱ | بسته و سه handle اجرای آن‌ها terminal شدند؛ تب‌های۱۴/۱۵ بسته، viewport reset؛ fixture هیچ DB/credential یا ورود موفقی نساخت |

فرمان‌های معمول main: `python3 scripts/backend-local.py` و `python3 scripts/serve-storefront-api.py`. اجرای آن‌ها با سورس تازه پیش از migration لازم مجاز نیست. نسخهٔ زنده و سورس جلوتر را با هم یکی فرض نکنید.

## برش پیشین: فهرست آفلاین بدون graph مالی

[OFFLINE-PROJECTION.md](OFFLINE-PROJECTION.md) مرجع است. endpoint عمومی محدود Catalog و قرارداد strict Next اضافه شد؛ PWA در API mode دیگر snapshot کامل فروشگاه را نمی‌خواند. پیش‌فرض۲۰۰/حداکثر۵۰۰ محصول و۵۰۰ دسته با truncated صریح؛ نام/توضیح محدود در SQL و بدون قیمت/موجودی/گارانتی/روش خرید/هویت. CMS فقط name/tagline/رنگ عمومی را می‌دهد؛ تصویر خارجی/امضاشده حذف می‌شود. Service Worker و wire version عمومی سازگار مانده‌اند.

در برش آفلاین۲۱۲ بک‌اند و۹۸ فروشگاه، build/typecheck و۱۶ HTTP روی build مستقل موفق‌اند؛ خواندن snapshot کامل و عبور credential در harness هر دو صفر. دو SQL جدید فقط compile شده‌اند؛ در آن نقطه شاهد قبلی۵۹ و شش مورد تازه (چهار سفارش+دو projection) اجرا نشده بودند؛ مجموع جاری در بخش sitemap آمده است. مدل Catalog تغییر نکرده و migration تازه‌ای لازم نیست. این اعداد شاهد همان برش آفلاین‌اند؛ sitemap در برش بعد تکمیل فنی شده است. runtime اصلی عوض نشد؛ health/live و OpenAPI ثابت200 و نبود مسیرهای جدید در آن بدون query SQL تأیید شد.

## برش پیشین: سایت‌مپ صفحه‌بندی‌شده

[SITEMAP-PROJECTION.md](SITEMAP-PROJECTION.md) مرجع است. sitemap و robots دیگر snapshot کامل فروشگاه را نمی‌خوانند؛ Catalog فقط count و صفحهٔ۱۰۰۰ کلید/پرچم ترجمه می‌دهد. فایل‌های معرفی‌شده در ریشه مانند `/sitemap-fa-products-1.xml` با rewrite داخلیِ بدون redirect سرو می‌شوند. ترجمهٔ واقعی هر زبان، انتشار/فعال‌بودن و گیت محیط/CMS/preview کنترل می‌شوند. سقف index۵۰٬۰۰۰ فایل و schema/stream محدود، خطای503/no-store/Retry-After و نبود fallback حفظ شده‌اند؛ قیمت/موجودی/هویت در این مسیر نیست. Native API همچنان preview و اصلی همچنان نسخهٔ قبلی است.

**۲۲۸ بک‌اند،۱۰۷ فروشگاه،۲۹ HTTP روی build واقعی Next** موفق‌اند؛ خواندن snapshot کامل و عبور credential در harness صفر. API/SqlTests compile، مدل Catalog بدون تغییر و build تولیدی مستقل موفق‌اند. دو SQL۱۰۰۱محصول/۱۰۰۱دسته فقط compile شده‌اند؛ در آن نقطه همراه چهار سفارش و دو آفلاین، هشت مورد تازهٔ SQL و مجموع۶۷ اجرا نشده بودند؛ هدف جاری با دو history در برش زیر۶۹ است. سقف ردیف جای plan/بار COUNT و OFFSET عمیق نیست؛ شمارش/صفحه snapshot مشترک ندارند. فهرست URL عمومی به‌تنهایی پذیرش SEO تولید یا کل پروژه نیست.

## برش تازه: تاریخچهٔ فیزیکی انبار

[INVENTORY-HISTORY.md](INVENTORY-HISTORY.md) مرجع است. endpoint inventory.read کامل با صفحهٔ۵۰، seek Id نزولی، فیلتر تنوع/ورود/خروج و بازهٔ UTC اضافه شد؛ cursor به همهٔ فیلترها وابسته و شناسه‌های long رشته‌اند. پنل قبلی/بعدی، تازه‌سازی، خالی/خطا/retry و اعتبارسنجی strict دارد؛ snapshot موجودی با includeMovements=false دیگر۱۰۰ گردش تکراری را نمی‌خواند. Stock و کاتالوگ هنوز کامل‌اند؛ این برش جای صفحه‌بندی کامل مدیریت نیست. رزرو/adjust/schema تغییر نکردند.

**۲۴۶ بک‌اند و۵ contract پنل موفق**؛ typecheck/build ایزوله و مدل Inventory بدون تغییر، SqlTests compile موفق.۱۵ QA روی خود کامپوننت با fixture صریحِ بدون ورود/SQL، شامل۵۰/۵۰/۲۱، ساعت تهران/UTC و شمسی، خطا/retry، schema و موبایل۳۹۰×۸۴۴ بدون overflow، موفق‌اند. تصاویر desktop/mobile و `inventory-history-{source,layout-ui,layout-http}.json` ثبت شدند. دو SQL تاریخچه فقط compile؛ مجموع موارد تازه۱۰ و اجرای بعدی۶۹ هنوز اجرا نشده است. QA port۳۱۷۵/۵۱۸۱ و تب‌های۱۶/۱۷ بسته، viewport reset؛ هیچ حساب/credential/DB ساخته نشد. آخرین build فروشگاه همان sitemap و۱۰۷ تست آن است.

## برش سفارش موقت

مرجع کامل [TEMPORARY-ORDERS.md](TEMPORARY-ORDERS.md) است. Sales header/line/event و snapshot صحیح ریال دارد؛ سفارش، hold موجودی و مصرف سبد در transaction مشترک Serializable composition root اتمیک‌اند. idempotency مالک/UUID/hash و unique quote، مهلت ثابت، کنترل مالک/نسخه/fingerprint و آخرین موجودی حفظ می‌شوند. لغو و worker انقضا فقط رزرو را آزاد می‌کنند؛ OnHand/خروج فیزیکی تغییر نمی‌کند. context ماژول‌ها همچنان مستقل و دسترسی از قرارداد است.

سفارش موقت پیش‌فرض خاموش است. فقط cash online بدون نیاز به تأیید، مبلغ مثبت/معلوم و فعال‌سازی صریح مدیر مجاز است. A15 مهلت فنی۱۵دقیقه/یک سفارش باز و حدود۱–۶۰/۱–۱۰ و نشانی اولیه IR را تعیین می‌کند؛ سیاست تجاری تأییدشده نیست. canPay همیشه false و gateway_unconfigured است؛ چک، اقساط provider، مبلغ صفر و پرداخت نهایی هنوز گردش سفارش فعال ندارند.

فرم تماس/نشانی مشروط، رضایت سفارش پرداخت‌نشده، retry همان payload/UUID در نتیجهٔ نامعلوم، فهرست/جزئیات/لغو مشتری و پنل سفارش/تنظیم آماده‌اند. اطلاعات فرم و توکن فقط حافظه‌ای‌اند؛ پاسخ دیررس پس از خروج کنار می‌رود. فوتر API اکنون به `/orders` می‌رود؛ لینک قدیمی `/account?tab=orders` نیز مقصد امن پس از ورود دارد. preview مستقل است؛ هیچ موفقیت مالی/هویتی ساختگی به API اضافه نشده است.

## آخرین شواهد

| بررسی | نتیجه و دامنه |
|---|---|
| فروشگاه `npm test` | **۱۰۷ موفق**؛ قرارداد/محاسبه پول، BFF، فرم/ورود و sitemap/PWA |
| بک‌اند Shop.Tests | **۲۴۶ موفق**؛ تاریخچه/مجوز/MFA/cursor و query محدود SQL نیز پوشش داده شد |
| Shop.SqlTests | **۵۹ موفق در اجرای پیشین**، شامل۱۲ سفارش؛ ۱۰ مورد تازه فقط compile شده‌اند و SQL۶۹ اجرا نشده است |
| build SqlTests/UiHarness | صفر warning/error؛ compile فقط، بدون اتصال SQL. harness برای originهای قدیم و QA جدید allowlist صریح دارد؛ اجرای واقعی آن هنوز باقی |
| مدل Inventory | بدون تغییر جامانده، migration تازه برای history لازم نیست؛ بررسی بدون اتصال SQL |
| مدل/SQL Sales | migration۱۸ و SQL idempotent آماده؛ model check بدون تغییر جامانده؛ روی اصلی اعمال نشده |
| Next جدید | production build ایزولهٔ تازه برای sitemap و rewrite ریشه موفق؛ guard مستقل حداقل۲GiB شروع/توقف زیر۱GiB، فقط process خود build. اجرای sandbox محدود سوکت نداشت و متوقف شد؛ اجرای مجاز همان build موفق شد |
| TypeScript | فروشگاه و پنل موفق |
| Vite جدید | entry۴۰۲٫۰۶kB/gzip۱۲۴٫۱۷؛ Operations۳۲٫۹۰kB و بدون هشدار۵۰۰kB؛ dist اصلی تغییر نکرد؛ اندازهٔ bundle معیار Core Web Vitals نیست |
| contract پنل | **۵ موفق**؛ شناسهٔ بزرگ، schema/ترتیب/سقف، فیلتر و زمان |
| UI تاریخچه | **۱۵ بررسی محدود کامپوننت** با fixture فقط خواندنی؛ پذیرش SQL/مدیر احرازشده نیست |
| runtime پنل | **۲ تست تازه موفق**؛ `admin-server-tests.log` |
| HTTP سایت‌مپ | **۲۹ موفق**؛ build واقعی، root URL بدون redirect، مرز۱۰۰۰/۱، زبان/گیت/ظرفیت/خطا؛ fixture صریح بدون SQL/هویت، ports خود QA بسته شدند |
| HTTP جدید BFF سفارش | **۱۴ موفق** روی build واقعی Next با fixture صریح بدون هویت؛ فقط درخواست نامعتبر/بدون ورود و no-store/noindex؛ پذیرش SQL/ثبت سفارش نیست |
| مرورگر جدید | **۱۱ بررسی محدود مهمان/خطا/ناوبری**؛ FA/EN، returnTo، detail id، هویت503→retry→guest401، noindex و موبایل واقعی۳۹۰×۸۴۴ بدون overflow؛ ورود/سفارش/مدیر احرازشده آزموده نشد |
| QA قبلی متصل | پنل هزینه با MFA/SQL واقعی و۱۲ بررسی، سبد۱۱ بررسی و quote دو زبان؛ مرجع اسناد همان برش‌ها و آرشیو |

گزارش‌های تازه: `inventory-history-source.json`، `inventory-history-layout-ui.json`، `inventory-history-layout-http.json` و logهای inventory-history؛ گزارش‌های برش قبلی: `sitemap-source.json`، `sitemap-http.json`، `sitemap-storefront-build.log` و `offline-projection-source.json`؛ گزارش‌های پیشین: `temporary-orders-source.json`، `orders-layout-ui.json`، `orders-bff-unauthenticated-http.json`، `orders-storefront-build.log` و `admin-split-build.log` در artifacts/checks. تصاویر `sayman-orders-guest-mobile.png`، `sayman-orders-guest-en.png` و `sayman-admin-split-login.png` فقط شواهد QA محدود جدیدند. fixture فقط metadata عمومی نمونه و خطای هویت داشت؛ شمارنده‌ها تأیید می‌کنند درخواست password یا سفارش به upstream نرسید. فایل‌های کنترل آن پاک و فقط شمارندهٔ method/path حفظ شد؛ حساب/MFA مالک استفاده نشد.

جزئیات جداسازی ماژول‌های پنل و مرز پذیرش در [ADMIN-PERFORMANCE.md](ADMIN-PERFORMANCE.md). PageBoundary برای خطای یک بخش اضافه شد؛ navigation/فرم احرازشده و قطع واقعی chunk هنوز باید با SQL/MFA موقت آزموده شوند.

یک اجرای کامل پیشین SQL، native SIGSEGV در CoreCLR/GetThreadLocalStaticBase داشت؛ علت اثبات نشده. سپس۱۲ سفارش مستقل و۵۹ کامل بدون حذف همزمانی موفق شدند. احتمال orphan دیتابیس/key همان crash فقط با شواهد دقیق مالکیت بررسی شود؛ پاک‌سازی عمومی SaymanTest_* یا نسبت‌دادن علت به OOM مجاز نیست.

## مسیر ادامه

1. منتظر اعلام پایان آزادسازی فضا بمان؛ بدون آن SQL/Docker تازه اجرا نکن. کار مستقل سورس/QA بدون هویت می‌تواند ادامه یابد. D16/D17 و MFA مالک همچنان حفظ شوند.
2. پس از اعلام: فضا و سلامت محیط را بررسی کن، SQL۶۹ را واقعاً اجرا و شکست‌ها را رفع کن. موارد جدید: سفارش غیرفعال/quote منقضی، rollback لغو مدیر هنگام شکست audit، seek pagination بیست‌ویک سفارش، دو projection آفلاین (۲۰۵ محصول/۵۰۱ دسته و منع خواندن موجودی/خرید)، دو sitemap (۱۰۰۱ محصول/۱۰۰۱ دسته، ترجمه/انتشار/مرز صفحه) و دو history انبار (۱۲۱ رویداد، فیلتر/MFA/نقش و عدم تغییر Stock). discovery بدون اجرا نیز۶۹ مورد را نشان داد.
3. با `SHOP_UI_OPERATIONS_QA=1` و SQL جدا، QA کامل مدیر موقت دارای MFA و مشتری: هزینه/سفارش فعالِ آزمایشی، quote3، ثبت/خالی‌شدن سبد/رزرو، replay، جزئیات/فهرست/لغو، خطا/تعارض و FA/EN/موبایل؛ ناوبری lazy پنل و خطای chunk و projectionهای آفلاین/sitemap و history واقعی هم بررسی شوند. Finance QA محدود قبلی با `SHOP_UI_FINANCE_QA=1` حفظ است؛ owner enrollment استفاده نشود. اسکریپت metadata بدون هویت جای این harness نیست.
4. پس از پذیرش، migration۱۸ روی اصلی، build عادی Next/Vite و update runtimeهای خود پروژه با PID تأییدشده، smoke و حفظ پیش‌فرض سفارش خاموش/هزینهٔ تعیین‌نشده. build ایزوله محل `.next` را جایگزین نکرده است؛ wrapper فعلی main هنوز build قدیمی را سرو می‌کند.
5. Linux x64 تازه، runtimeهای کانتینری، ClamAV/S3 واقعی و QA upload، مدیریت کارکنان/بازیابی MFA، رسانهٔ Ready بدون ارجاع، query plan/بار و pagination کامل مدیریت باقی‌اند. مرجع‌ها: MEDIA، INVENTORY-RESERVATIONS، SERVER-CART، CHECKOUT-QUOTES، CHECKOUT-CHARGES، PWA-SEO.
6. ادامهٔ همهٔ فازهای PLAN/PRD/PDF: callback و پرداخت/refund واقعی، تأیید چک/مدارک، ارسال/تخفیف/سریال، CMS پیشرفته/SEO، نصب/Push و accessibility/performance دستگاه، support/review/market/قابلیت‌های تکمیلی، CI/پایش، backup/restore و تحویل نهایی. اسکلت یا adapter غیرفعال معیار پایان نیست؛ هدف کامل فعال می‌ماند.
