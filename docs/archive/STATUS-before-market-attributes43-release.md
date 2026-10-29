# وضعیت و نقطهٔ ادامه

آخرین به‌روزرسانی: 2026-10-25. **فیلتر دسته و برند بازار و فیلتر برند پنل روی اصلی محلی منتشرند. سورس و SQL همچنان ۴۲ migration دارند؛ کل پروژه/PDF کامل نیست.** مرجع انتشار `artifacts/checks/market-facets42-main-release.json` است. وضعیت قبلی و شواهد دست‌دوم در [آرشیو](archive/STATUS-before-market-facets42-release.md) و [USED-DEVICES](USED-DEVICES.md) محفوظ‌اند.

## کار جاری پس از درخواست D34

سورس۴۳ (هنوز منتشر نشده): فیلتر ویژگی‌های مدل بازار در حال تکمیل است. سه view فقط‌خواندنی متعلق به Catalog، query تایپ‌دار/metadata و values در Market و رابط FA/EN ساخته شده‌اند. چهار SQL هدفمند و ۱۵ پاسخ خام واقعی با decoder تولیدی پذیرفته‌اند؛ typecheck اولیه موفق است. رگرسیون کامل، مرورگر، بکاپ/انتشار و ثبت پذیرش هنوز انجام نشده‌اند. migration تازه `20261025171736_MarketAttributeReadViews` است؛ اصلی۴۲ و runtimeهای زیر هنوز دست‌نخورده‌اند. PLAN مسیر D34 تا پایان کل پروژه را دارد؛ هدف به یک برش محدود نیست.

## اجرای محلی جاری

- SQL اصلی Sayman: ۴۲ migration، ۱۲۱ جدول و ۹ schema. این انتشار migration یا seed ندارد. fingerprint تمام ۱۲۱ جدول، schema و history پیش از انتشار، پس از HTTP و پس از مرورگر دقیقاً برابرند. Stock101/0/0 و صفر Order، Reservation، SourcingRequest، CheckoutSettings، ChargePolicy و UsedInspection باقی‌اند. نمونهٔ تغییر برند QA به اصلی منتقل نشد.
- API5080: `tmp/api-runtime-market-facets42-f0e4d704d7b746e481e85a2ca2a11cd8`؛ PID9536/session29624. restart: `python3 tmp/market-facets42-release.py serve-api`. همان keyring=`tmp/identity-keys` و ContentRoot=`backend/src/Shop.Api`؛ ۱۳DLL مطابق unit/SQL/harness.
- Next3000: `tmp/storefront-runtime-market-facets42-main-1732d9d1556b45848b03b63f4f031de4`؛ build=`Naxro_EjX_1ZIPuaWwrVp`؛ PID9563/session17992؛ API5080 و fixture خاموش. restart: `python3 tmp/market-facets42-release.py serve-storefront`. هر ۱۶۲ فایل static قبلی با hash یکسان محفوظ است.
- پنل3173: `tmp/admin-runtime-market-facets42-main-06065903049f4ec182a21f09c595451f`؛ PID9621/session59963. restart: `node tmp/serve-market-facets42-main-admin.mjs`. هر ۳۲۳ asset قبلی با hash یکسان محفوظ است. پنل دائمی `http://127.0.0.1:3173/` است؛ ۳۱۷۵ فقط QA موقت بود.
- `tmp/{api,storefront,admin}-runtime-current.json` مرجع جاری‌اند؛ مسیر/PID/hash را پیش از توقف بررسی کنید. runtime-setهای تاریخی immutable و نسخهٔ دست‌دوم۴۲ برای بازگشت به کد قبلی محفوظ‌اند. Down/restore انجام نشد و برای این انتشار کد لازم نیست. بکاپ تازه یا پذیرش Linux ادعا نشده؛ بکاپ تأییدشدهٔ قبلی، کلیدها و PDF محفوظ‌اند.
- D32: Redis چت Parseh عمداً running و دست‌نخورده است. صفر SaymanTest؛ پورت‌های ۳۱۰۵/۳۱۷۵/۵۱۸۱/۵۱۸۲ بسته‌اند. دیتابیس، credential و key مربوط به GUID تازهٔ QA حذف شدند. فقط تب‌های خود ۲۵/۲۶ و تب بررسی اصلی۲۷ بسته شدند.

## برش پذیرفتهٔ بازار

[MARKET-FACETS](MARKET-FACETS.md) قرارداد، رفتار و شواهد کامل را دارد. `POST /api/market/{fa|en}/facets` دسته و برند را از تمام مدل‌های مجاز بازار می‌شمارد، مستقل از صفحه. هر گروه فیلتر خودش را کنار می‌گذارد و جست‌وجو و گروه دیگر را نگه می‌دارد. Count تعداد مدل است، نه موجودی یا تضمین تأمین. هر فهرست تا ۲۰۰ گزینه، اعلام محدودیت و حفظ انتخاب معتبر دارد. search و facets predicate مشترک دارند؛ قرارداد search قدیمی تغییر نکرد. مدل پنهان/نامعتبر، دسته یا برند غیرفعال، دیجیتال، مدل دارای ماندهٔ فروشگاهی و demo خارج Development وارد شمارنده نمی‌شوند.

فروشگاه FA/EN انتخاب، زبان و سایز را حفظ می‌کند؛ انتخاب بدون نتیجه صفر می‌ماند و submit به صفحهٔ اول برمی‌گردد. BFF ناشناس، strict/bounded/no-store و مقید به scope و locale است. پنل brandId را کنار فیلترهای قبلی می‌پذیرد و cursor به برند هم مقید است؛ catalog.read/MFA تغییر نکرده. search و facets دو خواندن تازهٔ مستقل‌اند؛ snapshot تراکنشی مشترک ادعا نمی‌شود.

**۸۲۶ واحد، ۴۹۷ SQL واقعی، ۳۱۶ فروشگاه و ۱۹۰ پنل**، typecheck/build هر دو رابط و تطبیق ۱۳DLL موفق‌اند. چهار SQL تازه، count کل/فیلتر متقابل/فارسی، عدم نشت، ۲۰۵ گزینه و حفظ انتخاب آخر، صفحه‌بندی ۵۲ مدل یک برند، cursor و مجوزها را می‌پوشانند. ۱۱ پاسخ خام SQL با hash و decoder تولیدی بدون normalization پذیرفته‌اند؛ `market-facets-sql-wire/acceptance.json` و log/TRXهای `market-facets-*` شاهدند.

مرورگر روی GUID تازه و مدیر/password/MFA خودش: مدل A از پنل Samsung→Apple شد؛ Apple از صفر به یک و Samsung به دو نتیجه رسید. همان SQL در فروشگاه با size1 دو برند۱/۲ و دسته۳، صفحهٔ دوم، تعویض برند→صفحهٔ اول، تغییر زبان با حفظ فیلتر، حالت خالی/clear و Tab جست‌وجو→دسته→برند پذیرفته شد. فقط یک audit ویرایش، صفر تنظیم مالی/سفارش/رزرو/درخواست و Stock101/0/0 ثبت شد؛ سپس cleanup خود GUID موفق بود. console هر دو رابط خالی و عرض واقعی ۱۲۸۰/client=scroll=۱۲۶۵ بدون overflow بود. **پذیرش موبایل هنوز باز است.** `market-facets-browser-{acceptance,observations,sql}.json` و تصاویر viewport شاهدند.

انتشار اصلی: ۱۸۹۵ خواندن HTTP شامل ۱۸۹۱ GET و چهار POST فقط facets، بازاجرای ۱۳۳۷ بررسی قبلی، hash assetهای قدیم/جدید و private401/no-store موفق‌اند. چهار پاسخ خام FA/EN از API/BFF با decoder تولیدی پذیرفته‌اند. مرورگر اصلی سه مدل قدیمی Samsung و فیلتر کارا را نشان داد؛ انتخاب‌های قبلی مرورگر منتقل یا پاک نشدند. SQL پس از آن هم دقیقاً برابر ماند. مرجع‌ها: `market-facets42-main-{before,post-smoke,post-browser,public-smoke,release}.json`، `market-facets-main-wire/acceptance.json` و `market-facets42-main-browser.json`. حساب مالک و فرمان تجاری استفاده نشد؛ providerها خاموش ماندند.

شکست‌های محیط و ابزار پذیرش در MARKET-FACETS ثبت‌اند: اتصال sandbox به SQL، توقف بیلد ایزولهٔ بدون پیشرفت و بیلد موفق خارج sandbox، فرض اولیهٔ ۱۲ پاسخ به‌جای ۱۱، quote نام رزروشدهٔ schema در helper گزارش QA و اصلاح locator بر اساس role/dialog واقعی. این‌ها با تغییر داده یا ضعیف‌کردن محصول رفع نشدند.

## ادامه و وابستگی‌های باز

۱. بعدی: **facet ویژگی‌های تایپ‌دار بازار، چند منبع و تاریخچهٔ مشاهده**؛ سپس هلو warehouse/unit/reconciliation/apply با حفظ staging فعلی. D29/30 نسخه و ماژول هلو نامعلوم است؛ دوباره پرسیده نشود و endpoint vendor حدس زده نشود. canApply/canSyncLive=false تا قرارداد واقعی و گردش امن پذیرفته شوند.
۲. mobile دست‌دوم/comparison/reviews و این برش باز است؛ viewport.set پیشین واقعاً ۱۲۸۰ می‌ماند. سؤال محدود باریک‌کردن پنل قبلاً بی‌پاسخ مانده؛ desktop جای mobile نیست. SSR link fallback زبان پیش از hydration بهبود مستقل بعدی است.
۳. D14 ادامهٔ API/پنل/SQL را مجاز کرده؛ تأیید ظاهر دوباره لازم نیست. D16 درگاه/SMS/ایمیل مشخص نیست؛ فعال نکنید. D21 سیاست نمونه فقط QA؛ D32 Redis روشن؛ D33 پاک‌سازی ۸۵ بیلد و ۱٫۶۷GiB ثبت است. فضای آزاد اکنون حدود ۲۲GiB است. کل tmp شامل live/rollback/key/backup است و یکجا پاک نشود؛ `tmp/README.md` و ابزار cleanup مرجع‌اند.
۴. هزینه/مالیات/ماه‌درصد چک/گارانتی و مرجوعی واقعی تعیین نشده؛ فرض نشوند. نظر دیجی‌کالا و API بازار بدون مجوز/قرارداد و scrape ترب انجام نشود. چندانبار، ماندهٔ قبلی، ارسال/مرجوعی/مالکیت دستگاه، گردش چک و مدارک، provider/refund/reconciliation، support/files/S3/ClamAV، SEO/CWV/Push/accessibility، CI/پایش/nativeLinux/offsitebackup/حجم واقعی و ۱۲ معیار PDF بازند. پذیرش این برش پایان پروژه نیست.
