# دادهٔ توسعهٔ گوشی‌های سامسونگ برای D41

این سند و بخش `provenance` فایل داده، شواهد داخلی آماده‌سازی کاتالوگ‌اند و نباید به DTO عمومی، HTML فروشگاه، تاریخچهٔ عمومی یا اعلان مشتری وارد شوند. درخواست مالک در D41 نمایش گوشی، انتخاب رنگ/حافظه و درخواست اطلاع‌رسانی یا تأمین است؛ نام وب‌سایت منبع و قیمت مرجع در تجربهٔ مشتری جایی ندارند.

فایل نسخه‌دار `backend/data/development/samsung-iran-market.v1.json` در 2026-10-28 برای **Development** آماده شد. هشت خانوادهٔ واقعی سامسونگ، ۶۷ پیکربندی منطقه‌ای و ۲۸ عکس رسمی رنگی دارد. مشخصات مدل واقعی‌اند؛ وجود ردیف در seed، موجودی فروشگاه، امکان قطعی تأمین، رجیستری، گارانتی یا قیمت قابل پرداخت را ثابت نمی‌کند. تمام مدل‌ها و پیکربندی‌ها `isDemo=true`، وضعیت تأمین `unknown`، مبلغ مرجع `null` و اتصال به SKU انبار `null` دارند. این کار seed، migration یا انتشار روی پایگاه اصلی انجام نداده است.

## شواهد انتخاب مدل

مشخصات و عکس‌ها از صفحهٔ محصول/خرید خود سامسونگ استخراج شدند؛ عنوان کالا در کاتالوگ یک فروشگاه ایرانی فقط شاهد حضور این خانواده در بازار ایران است. قیمت، موجودی جاری، نقد و بررسی و نظر مشتری فروشگاه ثالث وارد داده نشده است. هیچ scraping از ترب انجام نشد.

| مدل | شاهد مشخصات/تصویر رسمی | شاهد کاتالوگ ایرانی | پیکربندی / رنگ |
|---|---|---|---|
| Galaxy A16 4G، SM-A165 | [Samsung DE](https://www.samsung.com/de/smartphones/galaxy-a/galaxy-a16-black-128gb-sm-a165fzkbeub/) | [تکنولایف، ۴/۱۲۸](https://www.technolife.com/product-69494/گوشی-موبایل-سامسونگ-مدل-galaxy-a16-4g-ظرفیت-128-گیگابایت-رم-4-گیگابایت) | ۱ / ۱ |
| Galaxy A26 5G، SM-A266 | [Samsung Gulf](https://www.samsung.com/ae/smartphones/galaxy-a/galaxy-a26-5g-white-256gb-sm-a266bzwjmea/) | [تکنولایف، ۸/۲۵۶](https://www.technolife.com/product-99217/گوشی-موبايل-سامسونگ-galaxy-a26-5g-ظرفیت-256-گیگابایت-رم-8-گیگابایت---ویتنام) | ۶ / ۳ |
| Galaxy A36 5G، SM-A366 | [Samsung Gulf](https://www.samsung.com/ae/smartphones/galaxy-a/galaxy-a36-5g-awesome-black-256gb-sm-a366bzkvmea/) | [تکنولایف، ۸/۲۵۶](https://www.technolife.com/product-99347/گوشی-موبايل-سامسونگ-galaxy-a36-5g-ظرفیت-256-گیگابایت-رم-8-گیگابایت---ویتنام) | ۱۲ / ۴ |
| Galaxy A56 5G، SM-A566 | [Samsung Gulf](https://www.samsung.com/ae/smartphones/galaxy-a/galaxy-a56-5g-awesome-graphite-256gb-sm-a566bzkwmea/) | [تکنولایف، ۸/۱۲۸](https://www.technolife.com/product-74385/گوشی-موبايل-سامسونگ-galaxy-a56-5g-ظرفیت-128-گیگابایت-رم-8-گیگابایت) | ۱۲ / ۴ |
| Galaxy S24 FE، SM-S721B | [Samsung Gulf](https://www.samsung.com/ae/business/smartphones/galaxy-s/galaxy-s24-fe-blue-256gb-sm-s721blbcmea/buy/)، [مشخصات رسمی](https://news.samsung.com/global/galaxy-s24-series-expands-with-s24-fe-a-premium-experience-that-makes-full-galaxy-ai-capabilities-attainable-for-more-users) | [تکنولایف، ۸/۲۵۶](https://www.technolife.com/product-60419/گوشی-موبايل-سامسونگ-مدل-galaxy-s24-fe-ظرفیت-256-گیگابایت-رم-8-گیگابایت) | ۴ / ۴ |
| Galaxy S25 FE، SM-S731B | [Samsung Gulf](https://www.samsung.com/ae/smartphones/galaxy-s/galaxy-s25-fe-jetblack-256gb-sm-s731bzkvmea/)، [مشخصات رسمی](https://news.samsung.com/global/meet-samsung-galaxy-s25-fe-the-gateway-to-the-galaxy-ai-and-flagship-essentials) | [کاتالوگ سری S25 تکنولایف](https://www.technolife.com/category/mobile/mobile-phone/brand-samsung/series-s25) | ۸ / ۴ |
| Galaxy S25، SM-S931B | [Samsung Gulf](https://www.samsung.com/ae/smartphones/galaxy-s/galaxy-s25-mint-256gb-sm-s931blgomea/buy/)، [مشخصات خانواده](https://www.samsung.com/ae/mobile-phone-buying-guide/introducing-samsung-galaxy-s25/) | [تکنولایف، ۱۲/۲۵۶](https://www.technolife.com/product-73382/گوشی-موبايل-سامسونگ-مدل-galaxy-s25-5g-ظرفیت-256-گیگابایت-رم-12-گیگابایت) | ۱۲ / ۴ |
| Galaxy S25 Ultra، SM-S938B | [Samsung Gulf](https://www.samsung.com/ae/smartphones/galaxy-s25-ultra/specs/)، [گزینه‌های رسمی](https://www.samsung.com/ae/smartphones/galaxy-s25-ultra/buy/) | [تکنولایف، ۱۲/۲۵۶](https://www.technolife.com/product-69015/گوشی-موبایل-سامسونگ-galaxy-s25-ultra-5g-ظرفیت-256-گیگابایت-رم-12-گیگابایت---ویتنام) | ۱۲ / ۴ |

[کاتالوگ رسمی سامسونگ ایران، ژوئیهٔ ۲۰۲۵](https://images.samsung.com/is/content/samsung/assets/iran/smartphones/mobile-catalogue/07-2025/general-catalog-july-2025.pdf) نیز هفت خانوادهٔ بالا به‌جز S25 FE را نام می‌برد. برای A16 4G، شناسهٔ SM-A165، پردازندهٔ Helio G99 و نرخ نمایش ۹۰ هرتز از همین مرجع تأیید شدند؛ مدل 5G با SM-A166 با آن مخلوط نشده است. این سند تاریخی، مدرک موجودی روز نیست.

## قواعد ساخت داده

- پیکربندی‌ها از نگاشت واقعی `BV-buyingOptionData` یا `products.optionMappings` صفحهٔ خرید سامسونگ آمده‌اند. حافظه و رنگ‌های مستقل در هم ضرب نشده‌اند. `regionalModelCode` کد محصول منطقه‌ای شاهد است؛ ادعای پک ایران یا SKU موجود سایمان نیست.
- A16 فعلاً فقط مشکی ۴/۱۲۸ دارد؛ S24 FE فقط ۸/۲۵۶ با چهار رنگ. S25 FE تنها ردیف‌های ۸/۱۲۸ و ۸/۲۵۶ موجود در نگاشت خرید خانواده را دارد؛ ردیف ۵۱۲ از فهرست دیگری به این نگاشت حدس زده نشد. رنگ‌های انحصاری Samsung.com در S25 و Ultra وارد این نسخه نشده‌اند.
- `defaultConfigurationKey` تنها انتخاب اولیهٔ نمایش است. مشخصات پایهٔ خانواده RAM/storage ندارد؛ فیلتر این دو باید روی پیکربندی‌ها و با شمارش مدل متمایز انجام شود. نمایش مقدار پیش‌فرض به‌عنوان تنها حافظهٔ مدل نادرست است.
- شناسهٔ پیکربندی نخستین ۳۲ نویسهٔ hex کوچک SHA256 متن UTF-8 زیر است: `market-phone-config:v1:<model.key>:<configuration.key>`. کلید پیکربندی `<ramGb>-<storageGb>-<colorKey>` است و seed دوباره باید هویت را حفظ کند.
- هر `configuration.imageUrl` عضو `model.imageUrls` است. تصویر یک رنگ برای حافظه‌های مختلف همان رنگ دوباره استفاده می‌شود؛ این کار هیچ موجودی یا ترکیب تأمین‌شدنی را تضمین نمی‌کند.
- نام رنگ‌ها رسمی و عکس‌ها متعلق به همان رنگ‌اند. hexهای استخراج‌شده از CSS سامسونگ دقیقاً نگه داشته شدند؛ برای رنگ‌هایی که سامسونگ به‌جای hex تصویر swatch می‌دهد، `hexIsApproximate=true` است. آن hex فقط نشانهٔ رابط است، معیار رنگ‌سنجی سازنده نیست.
- اندازهٔ نمایشگر قطر مستطیل کامل و باتری ظرفیت معمول است؛ IP مجوز استفاده در آب یا تعهد گارانتی ایجاد نمی‌کند. هیچ وضعیت سیستم‌عامل جاری از زمان عرضه حدس زده نشده است.

## تصویرها و بازتولیدپذیری

URLهای عکس در JSON مستقیماً به `images.samsung.com` و gallery رسمی اشاره دارند. queryهای preset برای سازگاری با قرارداد موجود تصویر عمومی حذف شده‌اند؛ فایل اصلی همان asset رسمی است. نمونهٔ اولیهٔ thumbnail در بررسی داخلی به gallery اصلی همان SKU تعویض شد. آدرس و hash HTML شاهد در provenance نگه داشته شده‌اند؛ داده‌های قیمت/نظر/وضعیت فروش HTML به seed منتقل نمی‌شوند.

نسخهٔ خام رسمی عکس‌ها برای واردکردن آتی از مسیر رسانهٔ پروژه در `artifacts/development/samsung-market/<model>/<color>.<format>` قرار می‌گیرد؛ این پوشه endpoint عمومی یا جایگزین مخفی Media نیست. `artifacts/checks/samsung-iran-market-photo-validation.json` شاهد MIME، حجم، hash و ابعاد است. دریافت فقط از host رسمی و با بررسی گواهی استاندارد سیستم انجام می‌شود. تصاویر تولیدی AI یا عکس فروشگاه ثالث استفاده نشده‌اند. ثبت منبع رسمی به معنی ثبت مجوز جداگانهٔ بازتوزیع تجاری نیست؛ این نسخه همچنان Development است.

فایل داده باید فقط با مسیر صریح توسعه خوانده شود و provenance آن خصوصی بماند. ادغام با خواندن/نوشتن واقعی SQL، انتشار عمومی گوشی، ثبت اطلاع‌رسانی و درخواست تأمین به برش D41 و آزمون‌های مستقل آن تعلق دارد؛ آماده‌شدن این فایل، پذیرش آن جریان‌ها نیست.

## واردکنندهٔ صریح Development

`DevelopmentPhoneDiscoverySeed.RunAsync(services, environment, contentRoot, ct)` فقط در Development و برای نسخه و SHA256 ثبت‌شده اجرا می‌شود. پرچم CLI پیشنهادی `--seed-phone-discovery-dev` است؛ این عملیات migration خودکار ندارد. فایل داده در خروجی build محلی کپی می‌شود و از publish عادی کنار گذاشته شده است.

واردکننده در یک transaction از نوع Serializable، از مرزهای Catalog و Market برای ساخت مدل بدون SKU، انتشار نمونهٔ Market و ایجاد انتخاب‌های دقیق رنگ/حافظه استفاده می‌کند. source داخلی `development-samsung-phones-v1` و کلید هر مدل برای تشخیص تکرار استفاده می‌شود. ردیف موجود به‌طور کامل حفظ می‌شود؛ مدل، وضعیت، متن، تصویر و پیکربندی تنظیم‌شدهٔ مدیر دوباره‌نویسی یا دوباره فعال نمی‌شوند. slug متعلق به مدل دیگری، دسته/برند غیرفعال، تعریف ناسازگار یا ویژگی اجباری با مقدار نامعلوم باعث rollback کل import می‌شود.

مشخصات گوشی در تعریف‌ها و مقدارهای رابطه‌ای Catalog نگه داشته می‌شوند؛ کلیدهای `phone-*` برای اندازه/فناوری/وضوح/نرخ نمایشگر، تراشه، دوربین‌ها، ظرفیت معمول باتری، وزن، شارژ، درجهٔ حفاظت، شبکه، ابعاد و کد خانواده‌اند. مشخصات عددی از نوع Number و دارای واحد هستند. تعریف و قواعد موجود مدیر حفظ و فقط اتصال‌های اختیاری مفقود به دسته افزوده می‌شوند. RAM/storage پایه ساخته نمی‌شود؛ این دو ویژگی از انتخاب واقعی پیکربندی خوانده می‌شوند. provenance خصوصیِ JSON به ستون‌های عمومی یا متن مدل منتقل نمی‌شود.

برای مسیر SKU واقعی در ادمین، ظرفیت‌های تأییدشدهٔ رم ۴ و ۶ گیگابایت فقط در صورت نبود گزینهٔ معادل به تعریف انتخابیِ موجود `ram` افزوده می‌شوند. سایر گزینه‌ها، شناسه‌ها، نام‌ها، ترتیب، واحدهای محلی و سیاست محور تنوع مدیر حفظ می‌شوند. شناسهٔ گزینهٔ تازه را Catalog در نخستین ثبت می‌سازد و اجرای تکراری همان گزینه و شناسه را نگه می‌دارد؛ کلید مقدار ثابت `development-phone-ram-4gb` یا `development-phone-ram-6gb` است. تعریف Number/Text به Select تبدیل نمی‌شود. تکمیل این گزینه‌ها حتی وقتی تمام مدل‌ها از import پیشین وجود دارند انجام می‌شود، اما هیچ تنوع فروش یا موجودی نمی‌سازد. تشخیص ظرفیت گزینه با همان parser تطبیق SKU انجام می‌شود؛ برچسب ۱ ترابایت معادل ۱۰۲۴ گیگابایت است.

آزمون‌های `DevelopmentPhoneSeedTests` محدودیت محیط و hash را پیش از دسترسی به سرویس پایگاه بررسی می‌کنند. `DevelopmentPhoneSeedSqlTests` ساخت ۸ مدل/۶۷ انتخاب بدون SKU، نوع مشخصات و حفظ ویرایش‌های مدیر در اجرای دوباره را در پایگاه GUID موقت بررسی می‌کند. نتیجهٔ اجرای پذیرفته‌شده باید جداگانه در STATUS ثبت شود؛ وجود کد آزمون یا این توضیح به معنی اجرای seed روی پایگاه اصلی نیست.


## توسعهٔ D48 — نسخهٔ دوم، 2026-10-29

فایل مستقل `backend/data/development/samsung-iran-market.v2.json` چهار خانوادهٔ S25+،S25Edge،ZFlip7 وZFold7،28ترکیب و13تصویر رسمی اضافه می‌کند؛ v1 دست‌نخورده است. روی اصلی اکنون12مدل/95ترکیب و41عکس رسمی رنگی وجود دارد. SHA256 نسخهٔ دوم `f402a97bd1e98f90d72b4722ae26e2be0e0dbf66e5462fcdd2d0ce256cce2267` است. provenanceخصوصی در فایل هم‌نام `.provenance.json` شامل SKUهرترکیب وURL/hashچهارصفحهٔ رسمی است؛ به DTOعمومی منتقل نمی‌شود.

ترکیب‌ها از `BC_GROUP.products.optionMappings` صفحات رسمی Gulf استخراج و فقط SKUخانوادهٔ درست انتخاب شد؛ صفحهٔS25 شاملS25/S25+/FE وEdge شاملUltraهم هست. محصول‌های SM-S936B/SM-S937B/SM-F766B/SM-F966B به‌ترتیب انتخاب شدند. رنگonlineexclusive حذف شد؛ برایFold7 نقره‌ای1TB دراینمنطقهثبتنبود و ساختهنشد.16GBفقط با1024GB/آبی‌سایه‌داریاjetblack وارد شد. رنگ‌های نمودار تقریبی‌اند و عکس رسمی ملاک ظاهر است. هر ترکیب عکس واقعی متصل به همان SKUرا دارد؛ تمامی13URLباHTTP200/MIMEتصویر بررسی شدند.

منابع اصلی مشخصات و تصویر (صرفاً داخلی):

- [S25/S25+ رسمی](https://www.samsung.com/ae/smartphones/galaxy-s25/buy/) و [جدول عرضهٔ رسمی](https://news.samsung.com/global/samsung-galaxy-s25-series-sets-the-standard-of-ai-phone-as-a-true-ai-companion).
- [S25Edge رسمی](https://www.samsung.com/ae/smartphones/galaxy-s25-edge/buy/) و [جدول مشخصات سامسونگ](https://news.samsung.com/sg/meet-the-samsung-galaxy-s25-edge-an-engineering-marvel-of-new-slim-hardware-innovation).
- [ZFlip7 رسمی](https://www.samsung.com/ae/smartphones/galaxy-z-flip7/buy/) و [جدول مشخصات SamsungMobilePress](https://www.samsungmobilepress.com/articles/samsung-galaxy-z-flip7-a-pocket-sized-ai-powerhouse-with-a-new-edge-to-edge-flexwindow).
- [ZFold7 رسمی](https://www.samsung.com/ae/smartphones/galaxy-z-fold7/buy/) و [جدول مشخصات SamsungMobilePress](https://www.samsungmobilepress.com/articles/samsung-galaxy-z-fold7-raising-the-bar-for-smartphones).

ابعاد Fold/Flip مربوط به حالت باز و باتری مقدار typical است. متن بررسی یا قیمت فروشنده کپی نشده، منبع Torob استفاده نشده و هیچ قیمت یا موجودی خارجی وارد نشده است. شواهد حضور مدل در کاتالوگ ایران فقط وجود خانواده را نشان می‌دهد؛ وجود همهٔ ترکیب‌های منطقه‌ای در ایران تضمین نشده است.

فرمان صریح `python3 scripts/import-phone-data-extension.py --apply-main-development` ابزار یک‌باره است: پروژهٔ `tools/development/phone-data-extension` فقط به14DLLپذیرفته‌شدهٔ runtimeجاری83 ارجاع دارد و backendنیمه‌تمام را buildنمی‌کند. Development/localSayman/port11433،hashداده،exactdescriptor وDLLها کنترل می‌شوند. هیچ host اجرا نمی‌شود. سرویس‌های واقعی Catalog/Market و CAS/receipt/transactionSerializable/auditکار را انجام می‌دهند؛ slugیاتعریفناسازگار rollbackمی‌دهد. اجرای دوباره هیچ مدل یا پیکربندی قبلی را بازنویسی نمی‌کند. این فرمان برای schema83پذیرفته‌شده pinشده؛ در نسخهٔ بعد باید صریحاً بازبینی شود.

گزارش `phone-extension-main-applied.json`:4created،28configuration،0definition/option/categoryrule،repeat0created/4preserved. محتوای123جدولaccount/order/payment/credit/inventory پیش/پس hashیکسان داشت؛ هیچ SKU،قیمت،انبار یا حسابی ساخته نشد. `phone-extension-main-api.json` هفت حالت فیلتر،FAEN،exact28ترکیب و نبودمنبع/قیمتعمومی را تأییدمی‌کند. این کاتالوگ نمونهٔ توسعه از مدل واقعی است، feedزندهٔ بازار نیست.

شاهد حضور خانواده‌های Fold7/Flip7 در [فهرست سریZتکنولایف](https://www.technolife.com/category/mobile/mobile-phone/brand-samsung/series-z) وS25+/Edgeدرصفحات73370/77820 ثبت شد؛ قیمت،موجودی،توضیح فروشنده یا وعدهٔ رجیستری ازاینمنابع منتقل نشده است. مدل‌های منطقه‌ای معرفی‌اند و همهٔ رنگ/حافظه‌ها الزاماً درایران موجود نیستند.
