# فهرست عمومی محدود برای مرور آفلاین

پذیرش جدید 2026-10-23: D20 توقف فضا را رفع کرد؛ **۱۲۹/۱۲۹ SQL واقعی** شامل آزمون‌های این برش موفق شدند. اعداد compile-only و توقف D19 متن زیر تاریخی‌اند؛ QA مرورگر متصل، main migration۱۸–۲۱ و Linux x64/بار هنوز جدا باقی‌اند. وضعیت جاری در [STATUS](STATUS.md) است.

وضعیت 2026-10-23: سورس، ترجمهٔ query، تست سبک و HTTP روی build مستقل موفق‌اند؛ اجرای مثبت SQL و انتشار اصلی هنوز انجام نشده‌اند. این تغییر مدل EF یا migration تازه ندارد؛ migration۱۸ سفارش همچنان روی اصلی اعمال نشده است.

## جریان داده

قبلاً `/pwa/catalog/fa.json` و `en.json` در API mode، snapshot کامل فروشگاه را می‌گرفتند؛ قیمت/موجودی و graph کاتالوگ در API و Next خوانده می‌شد و سپس از DTO آفلاین حذف می‌شد. اکنون Next فقط GET `/api/catalog/{locale}/offline?limit=200` را می‌خواند. مسیر snapshot کامل آفلاین فقط در preview صریح باقی مانده؛ sitemap هم اکنون قرارداد مستقل دارد؛ مرجع SITEMAP-PROJECTION است.

Catalog مالک projection عمومی است: دستهٔ فعال، کالای Published با زمان انتشار رسیده، برند فعال و حداقل یک تنوع فعال. موجودی شرط نمایش آفلاین نیست و هیچ مقدار مالی/موجودی/گارانتی/روش خرید یا اطلاعات هویت در DTO نیست. query محصول فقط برای EXISTS فعال‌بودن تنوع به جدول Variants مراجعه می‌کند؛ ستون قیمت/SKU/گارانتی و view انبار انتخاب نمی‌شوند. Stock و PurchaseConfiguration خوانده نمی‌شوند. CMS فقط در composition root برای name/tagline/primaryLight منتشرشده استفاده می‌شود؛ auth و contact به DTO وارد نمی‌شوند.

endpoint ناشناس و native پاسخ آن no-store است؛ `limit` صحیح۱–۵۰۰ با پیش‌فرض۲۰۰ و سقف مستقل۵۰۰ دسته دارد. کد حداکثر۵۰۱ دسته و limit+1 محصول می‌خواند؛ overflow با `truncated:true` مشخص می‌شود. محصولات فقط به دسته‌های داخل خروجی اشاره می‌کنند. ترتیب دسته sortOrder/Id و محصول featured/newest/Id است؛ کلید دسته از مقدار ذخیره‌شدهٔ خود دسته گرفته می‌شود تا FK با مقایسهٔ غیرحساس به حروف کلید ناهماهنگ نسازد.

projection از Include/graph استفاده نمی‌کند. نام/برند تا۲۵۰ و توضیح تا۸۰۰ نویسه در SQL بریده می‌شوند؛ تست ToQueryString وجود TOP/SUBSTRING و نبود ستون‌های مالی را بررسی می‌کند. این شاهد ترجمه است؛ اجرای query و plan هنوز به SQL واقعی نیاز دارد. در کد دو query محدود Catalog و یک خواندن CMS وجود دارد؛ تعداد و زمان واقعی فرمان‌ها در دیتابیس هنوز پذیرفته نشده است.

تصویر فقط SVG عمومی بسته‌بندی‌شدهٔ `/products/…svg` یا thumbnail پردازش‌شدهٔ `/media/catalog/{id}/thumb.webp` است. URL خارجی/امضاشده، query/hash، data URI و traversal حذف می‌شوند. endpoint تصویر همچنان Ready/hash را مستقل بررسی می‌کند؛ وجود مسیر در DTO به معنی پذیرش S3/ClamAV نیست.

## مرز Next و cache

نسخهٔ wire همان `offline-catalog-v1` باقی است. قرارداد Zod مستقل و strict در همهٔ لایه‌ها، سقف آرایه/متن، یکتایی شناسه/slug، تطابق زبان و وجود دستهٔ هر محصول را بررسی می‌کند. اضافه‌شدن priceRial، stock، variants، contact، user یا دادهٔ تجاری دیگر پاسخ را رد می‌کند. دریافت از API فقط anonymous GET، no-store و بدون دنبال‌کردن redirect است؛ cookie، Authorization، Origin یا header مدیریت درخواست ورودی عبور نمی‌کنند.

مهلت۸ثانیه همراه cancellation درخواست است. stream upstream تا۶MiB محدود است، چون JSON escape‌شدهٔ Unicode در .NET از JSON decodeشده بزرگ‌تر است. خروجی نهایی حداکثر۲۰۰ محصول و یک‌میلیون واحد متن JSON دارد؛ HTML، زبان ناهماهنگ، دادهٔ بیش‌ازحد یا پاسخ سرویس ناموفق503 می‌شوند. بدنهٔ upstream لغو و خطای عمومی no-store برگردانده می‌شود؛ هیچ fallback به snapshot کامل یا fixture در API mode وجود ندارد.

فقط پاسخ معتبر header `X-Shop-Public-Resource: offline-catalog-v1` و تاریخ generatedAt یکسان در body/header می‌گیرد. Service Worker همان allowlist و انقضای هفت‌روزه را نگه می‌دارد؛ خطای503 می‌تواند صرفاً نسخهٔ عمومی معتبر قبلی را طبق همان سیاست استفاده کند. پاسخ خراب جدید منتشر یا cache نمی‌شود. preview فقط در mode صریح و در production با flag قبلی مجاز است؛ credential یا موفقیت هویتی/مالی نمونه به API اضافه نشده است.

## شاهد و موارد باز

- **۲۱۲ تست بک‌اند و۹۸ فروشگاه** موفق؛ شامل دو زبان query تولیدی بدون ستون مالی، حدود، تصاویر، انتشار سایت بدون contact/auth، خطای ورودی قبل از SQL، قرارداد و transport/cancellation. گزارش `offline-projection-source.json` شاهد شمارش همان برش است؛ logهای جاری backend/storefront اکنون برش sitemap را هم شامل می‌شوند.
- build API و SqlTests با صفر warning/error، typecheck و build تولیدی ایزولهٔ Next موفق؛ model check Catalog بدون تغییر جامانده. `.next` و runtime اصلی جایگزین نشدند.
- **۱۶ HTTP** روی build واقعی Next با upstream عمومی مصنوعی موفق: FA/EN، Unicode/offset، نتیجهٔ خالی/ناقص، رد مالی/خصوصی/تصویر امضاشده/زبان/تکرار/دستهٔ نامعلوم/تعداد زیاد/HTML/حجم زیاد/خطای سرویس و فایل نامعتبر. تعداد خواندن snapshot کامل و هدر credential عبوری هر دو صفر بودند. `offline-projection-http.json` و `scripts/verify-offline-projection.py`؛ processهای خود QA terminal و پورت‌های۳۱۰۵/۵۱۸۱ بسته شدند. این آزمون backend SQL نیست.
- دو SQL تازه برای۲۰۵ محصول، حالت‌های انتشار، fallback فارسی، حذف دادهٔ مالی و سقف۵۰۱ دسته نوشته و compile شدند. در factory این تست‌ها، خواندن موجودی/روش خرید/چک عمداً خطا می‌دهد تا بازگشت به graph کامل آشکار شود. **هنوز اجرا نشده‌اند**. شاهد SQL پیشین۵۹ است؛ چهار سفارش، دو projection آفلاین، دو sitemap، دو history، دو stock page و دو admin products تازه، مجموع اجرای بعدی را به۷۳ می‌رسانند؛۷۳ هنوز اجرا نشده است.
- API اصلی با health/live و OpenAPI ثابت (بدون query دیتابیس) بررسی شد:200 و مسیرهای تازهٔ سفارش/offline هنوز در آن نیستند. `main-static-surface.json` این تفاوت سورس و runtime را ثبت می‌کند.

طبق D19 تا اعلام پایان آزادسازی فضا SQL/Docker تازه اجرا نشود. پس از آن SQL۷۳ و گردش واقعی سفارش/MFA و این projection، build عادی، migration/update لازم و smoke روی اصلی ادامه یابد. پذیرش SQL sitemap و محدودسازی snapshotهای مدیریتی، سنجش بار/plan، نصب/Push دستگاه واقعی و معیارهای accessibility/performance همچنان بازند؛ این برش پایان PWA یا پروژه نیست.

نقطهٔ ادامهٔ فعلی پس از برش STAFF-ADMINISTRATION: هدف SQL۸۴ با۲۵ مورد تازهٔ اجرا‌نشده است؛ شش مورد کارکنان به مجموعه افزوده شده و migration۱۹ Identity نیز کنار۱۸ Sales قبل از runtime تازه لازم است. اعداد discovery بالای این سند شاهد زمان همان برش‌اند؛ دستور اجرای جاری در [STATUS.md](STATUS.md) و [MFA-RECOVERY.md](MFA-RECOVERY.md) دنبال شود. تا اعلام مالک دربارهٔ فضا SQL/Docker تازه اجرا نشود.
