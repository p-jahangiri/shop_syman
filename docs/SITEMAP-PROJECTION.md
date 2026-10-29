# سایت‌مپ صفحه‌بندی‌شده

افزونهٔ صفحه‌های CMS در2026-10-27 به‌صورتcode-onlyرویschema۶۶ پذیرفته است؛ [CMS-PAGE-SITEMAP](CMS-PAGE-SITEMAP.md)/STATUS مرجع جاری‌اند. APIpreviewguard و عدم‌فعال‌سازیindexاصلی حفظ‌اند. متنD19/Redis/compile-onlyپایین تاریخی است؛ D32فعلیRedisروشن وD34فعال است.

پذیرش جدید 2026-10-23: D20 توقف فضا را رفع کرد؛ **۱۲۹/۱۲۹ SQL واقعی** شامل آزمون‌های این برش موفق شدند. اعداد compile-only و توقف D19 متن زیر تاریخی‌اند؛ QA مرورگر متصل، main migration۱۸–۲۱ و Linux x64/بار هنوز جدا باقی‌اند. وضعیت جاری در [STATUS](STATUS.md) است.

وضعیت 2026-10-23: سورس، build و آزمون مستقل آماده‌اند؛ SQL جدید و انتشار روی اجرای اصلی هنوز پذیرفته نشده‌اند. این برش پایان SEO یا پروژه نیست. A07 و محافظ preview همچنان برقرارند.

## مرز داده و URL

قبلاً sitemap و robots برای فهرست URLها snapshot کامل فروشگاه را می‌خواندند. اکنون Catalog از قرارداد مستقل، شمارش و صفحهٔ حداکثر۱۰۰۰ کلید عمومی می‌دهد؛ هیچ Include یا materialize شدن graph کالا، قیمت، موجودی، روش خرید، گارانتی، توضیح یا هویت در این مسیر وجود ندارد. فعال‌بودن تنوع فقط با EXISTS بررسی می‌شود. composition root برای manifest فقط اجازهٔ SEO منتشرشدهٔ همان زبان را از CMS می‌خواند؛ اگر غیرفعال باشد شمارش Catalog انجام نمی‌شود.

| مسیر native API | قرارداد |
|---|---|
| GET `/api/catalog/{fa|en}/sitemap` | version1، dataSource=api، locale، isPreview، allowIndexing، pageSize=1000 و productCount/categoryCount به شکل رشتهٔ رقم لاتین |
| GET `/api/catalog/{fa|en}/sitemap/{products|categories}?page=1` | version1، زبان/نوع/شمارهٔ صفحه، pageSize=1000 و items شامل key/fa/en |

همهٔ این خواندن‌ها ناشناس و no-store هستند. محصول باید Published، موعد انتشار رسیده، برند و دسته فعال و دارای تنوع فعال باشد؛ ترجمهٔ واقعی و نام غیرخالیِ محصول و دسته در زبان درخواستی لازم است. دسته باید فعال و دارای ترجمهٔ واقعی باشد. fallback فارسی جای ترجمهٔ انگلیسی در sitemap نمی‌نشیند. پرچم زبان دیگر نیز برای محصول، ترجمهٔ همان محصول و دسته را با هم بررسی می‌کند.

Next در `/sitemap.xml` یک index و در مسیرهای ریشه مانند `/sitemap-fa-site.xml`، `/sitemap-fa-products-1.xml` و `/sitemap-en-categories-1.xml` فایل XML تولید می‌کند. rewrite داخلیِ بدون redirect به handler مشترک `/sitemaps/{locale}/{file}` می‌رود؛ URLهای معرفی‌شده همگی در ریشهٔ دامنه‌اند. هر زبان دو URL ثابت خانه/کاتالوگ و تمام صفحه‌های محصول/دستهٔ آن زبان را دارد. نام فایل و صفحهٔ نامعتبر، زبان غیرفعال و صفحهٔ خارج از شمارش404 هستند.

هر loc و alternate فقط از SHOP_PUBLIC_URL معتبر ساخته می‌شود؛ Host ورودی مرجع دامنه نیست. دسته به `/catalog?category=...` و محصول به `/product/...` همان زبان اشاره می‌کند. alternateها فقط زبان مجاز دارای ترجمهٔ واقعی را شامل می‌شوند، خود زبان صفحه هم حضور دارد و XML escape می‌شود. lastmod، امتیاز و تاریخ ساختگی تولید نمی‌شوند. بلاگ/صفحهٔ CMS و redirect پیشرفته هنوز به این index اضافه نشده‌اند.

## حدود و رفتار خطا

- A17: صفحه۱–۵۰٬۰۰۰ و حداکثر۱۰۰۰ ردیف؛ هر شمارش حداکثر۵۰میلیون. index مجموع همهٔ زبان‌ها و نوع‌ها، همراه فایل ثابت، حداکثر۵۰٬۰۰۰ فایل دارد. عبور از ظرفیت خطاست؛ فهرست بی‌صدا بریده نمی‌شود. این‌ها سقف فنی‌اند، ظرفیت یا هدف تجاری تأییدشده نیستند.
- manifest حداکثر۸KiB و صفحه حداکثر۵۱۲KiB از stream خوانده می‌شود؛ مهلت۸ثانیه و cancellation درخواست رعایت می‌شود. schema strict، کلید امن، نبود تکرار و هویت زبان/نوع/صفحه کنترل می‌شوند. کلید دسته تا۶۴ و slug محصول تا۱۵۰ نویسه، origin تا۵۱۲ نویسه و حدود ردیف/فایل اندازهٔ XML را محدود نگه می‌دارند.
- cookie، Authorization و header مدیر به upstream ارسال نمی‌شوند؛ redirect دنبال نمی‌شود. هیچ fixture یا snapshot کامل در پاسخ خطای API جایگزین نمی‌شود. XML route در شکست503/no-store و Retry-After=60 می‌دهد؛ پاسخ ناقص منتشر نمی‌شود. robots در خطای manifest exception می‌دهد و Next پاسخ خطا می‌سازد؛ برای آن رفتار503 سفارشی ادعا نشده است.
- بدون flag محیط، origin عمومی HTTPS و API غیر preview دارای اجازهٔ منتشرشده، index خالی و robots منع کامل دارد. محیط غیرفعال حتی API را نمی‌خواند. API native فعلی همچنان isPreview=true دارد؛ این برش مجوز انتشار/ایندکس واقعی نیست.

ترتیب صفحه با Id و OFFSET/FETCH پایدار است، ولی شمارش و صفحه‌ها snapshot تراکنشی مشترک ندارند؛ تغییر همزمان انتشار می‌تواند جابه‌جایی موقت URL ایجاد کند. سقف ردیف، هزینهٔ پیمایش OFFSET عمیق یا COUNT را تضمین نمی‌کند. plan، index و بار روی SQL واقعی و راهبرد snapshot/continuation در مقیاس بالا هنوز باید بررسی شوند. اجرای HTTP مصنوعی شاهد کارایی SQL نیست.

## شواهد و ادامه

۱۶ تست تازهٔ بک‌اند (مجموع۲۲۸) ترجمهٔ query و مرز ورودی/ظرفیت را پوشش می‌دهند؛ ۹ تست تازهٔ فروشگاه (مجموع۱۰۷) قرارداد، گیت، XML و شکست را بررسی می‌کنند. API و Shop.SqlTests با صفر warning/error کامپایل و مدل Catalog بدون تغییر جامانده است؛ migration تازه لازم نیست. production build در `.next-qa` مستقل است و `.next` زنده جایگزین نشده.

`scripts/verify-sitemap.py` روی build واقعی Next و fixture صریح فقط کلید/شمارش، ۲۹ بررسی HTTP انجام می‌دهد: مرز۱۰۰۰/۱، فارسی/انگلیسی/ترجمهٔ ناقص، root URL بدون redirect، دامنهٔ جعلی، robots، ظرفیت، schema خصوصی، حجم/نوع غلط و خطا. خواندن snapshot کامل و عبور credential هر دو صفرند. دامنهٔ HTTPS نمونه فقط تنظیم canonical است؛ همهٔ درخواست‌ها loopback، بدون انتشار، SQL یا ورود موفق‌اند. گزارش‌ها `sitemap-http.json`، `sitemap-source.json` و logهای هم‌نام در artifacts/checks هستند.

دو SQL تازه برای۱۰۰۱ محصول و۱۰۰۱ دسته، زبان ناقص، انتشار آینده/غیرفعال، شمارش رشته‌ای، مرز صفحه و منع وابستگی Inventory/Purchasing نوشته و فقط compile شده‌اند. شاهد SQL پیشین۵۹ است؛ چهار سفارش، دو آفلاین، دو sitemap، دو history انبار، دو stock page و دو admin products تازه، اجرای بعدی را به۷۳ می‌رسانند؛ **۷۳ هنوز اجرا نشده است**. طبق D19 پس از اعلام پایان آزادسازی فضا، SQL و QA واقعی این مسیر و سفارش/MFA، سپس migration/update و smoke اصلی انجام می‌شوند. parseh-chat-redis خاموش می‌ماند.

حدود و محل فایل‌ها با [راهنمای ساخت sitemap گوگل](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)، ساختار index با [راهنمای sitemap بزرگ](https://developers.google.com/search/docs/crawling-indexing/sitemaps/large-sitemaps) و self/reciprocal alternate با [راهنمای نسخه‌های زبانی](https://developers.google.com/search/docs/specialty/international/localized-versions) تطبیق داده شد. پذیرش Search Console، دامنهٔ تولید و Rich Results هنوز انجام نشده است.

نقطهٔ ادامهٔ فعلی پس از برش STAFF-ADMINISTRATION: هدف SQL۸۴ با۲۵ مورد تازهٔ اجرا‌نشده است؛ شش مورد کارکنان به مجموعه افزوده شده و migration۱۹ Identity نیز کنار۱۸ Sales قبل از runtime تازه لازم است. اعداد discovery بالای این سند شاهد زمان همان برش‌اند؛ دستور اجرای جاری در [STATUS.md](STATUS.md) و [MFA-RECOVERY.md](MFA-RECOVERY.md) دنبال شود. تا اعلام مالک دربارهٔ فضا SQL/Docker تازه اجرا نشود.
