# وضعیت و نقطهٔ ادامه

آخرین به‌روزرسانی: 2026-10-23. **پروژهٔ کامل PDF هنوز تمام نشده و برای فروش واقعی آماده نیست.** دامنهٔ کامل PRD/PLAN حفظ شده است. تاریخچهٔ دقیق در [آرشیو پیش از سریال انبار](archive/STATUS-before-serial-inventory.md)، [آرشیو پیش از فیلترها](archive/STATUS-before-catalog-facets.md)، [آرشیو پیش از خواندن عمومی کاتالوگ](archive/STATUS-before-public-catalog-reads.md)، [آرشیو پیش از نسخه‌گذاری کاتالوگ](archive/STATUS-before-catalog-versions.md)، [آرشیو پیش از فهرست شرایط خرید](archive/STATUS-before-finance-pagination.md)، [آرشیو پیش از دفتر نشانی](archive/STATUS-before-address-book.md)، [پیش از کارکنان](archive/STATUS-before-staff-administration.md) و آرشیوهای قبلی باقی است.

## تصمیم‌ها و محدودیت محیط

- D14: ظاهر و جریان تأیید و ادامهٔ API، پنل مستقل و SQL مجاز است؛ تأیید دوباره لازم نیست. دادهٔ پویا، FA/EN، روش خرید مستقل تنوع، ورود موبایل/OTP و ایمیل یا نام کاربری/رمز و Linux Docker الزامی‌اند.
- D20: مالک اعلام کرد «بله، آزادسازی تمام شده است»؛ توقف محیطی D19 رفع شد. بررسی سلامت دیسک/Docker و SQL ایزوله از این نقطه مجاز و در حال پیگیری است؛ SQL جدید هنوز اجرا/پذیرفته نشده و main۱۷ مانده است. فایل شخصی/volume حذف نشود و Redis چت خاموش بماند.
- D17: `parseh-chat-redis` خاموش بماند. فایل شخصی/volume حذف یا تغییر نکرده‌اند؛ فقط process و کنترل/پوشهٔ موقت متعلق به QA خود پروژه پاک شده‌اند.
- D16: نام/مستندات درگاه، پیامک و ایمیل فعلاً موجود نیست؛ providerها غیرفعال‌اند و هیچ موفقیت ساختگی auth/مالی در API وجود ندارد. هزینهٔ ارسال/مالیات واقعی، درصد/ماه/پیش‌پرداخت چک و جزئیات گارانتی/مرجوعی تعیین نشده‌اند؛ صفر/رایگان فرض نشوند.
- MFA حساب اصلی پنل در اختیار مالک است؛ عامل کلید/کد مالک را نمی‌خواند یا ثبت نمی‌کند. QA مثبت فقط با حساب/کلید موقت خودش و SQL ایزوله انجام شود.
- آخرین سلامت ثبت‌شدهٔ SQL در بازیابی قبلی ONLINE و DBCC بدون repair/خطا بود؛ پس از D19 query تازه نشده. SQL2022 CU22 روی MacARM/Rosetta جای پذیرش Linux x64 نیست. builder مستقل sayman-build و guard شروع۱۰GiB/توقف زیر۳GiB حفظ است؛ Docker تازه اجرا نشد.

## سورس و اجرای زنده

| بخش | وضعیت |
|---|---|
| API5080 / Next3000 / admin3173 | اجرای پذیرفته‌شدهٔ هزینه/quote2؛ در این ادامه restart/جایگزین نشد؛ PIDهای آخر۱۳۶۹۴/۱۳۷۱۹/۹۳۹۰، پیش از هر توقف مالکیت دوباره بررسی شود |
| SQL اصلی | آخرین اعمال۱۷ migration در هفت schema |
| سورس migration | **۲۱**؛ Sales۱۸ TemporaryOrders، Identity۱۹ MfaRecovery، Sales۲۰ CustomerAddressBook و Inventory۲۱ SerialUnits اعمال نشده‌اند |
| Next | build پیشین `.next-qa` دفتر نشانی محفوظ؛ سورس Next این برش تغییر نکرد/دوباره build نشد و اجرای اصلی حفظ شد |
| پنل | build پیشین مستقل `tmp/finance-admin-dist` موفق؛ entry+schemas۴۱۶٫۸۶/gzip۱۲۹٫۴۷kB، finance lazy۱۶٫۳۴kB؛ dist اصلی تغییر نکرد |
| storefront3100 | کانتینر قدیمی؛ مرجع سورس جاری نیست |
| QA این برش | فقط build/unit/model/discovery؛ fixture/تب/viewport تازه ساخته نشد؛ همهٔ commandهای خود برش terminal؛ هیچ SQL/credential ساخته نشد |

فرمان‌های main همچنان backend-local.py و serve-storefront-api.py هستند. اجرای آن‌ها با سورس تازه پیش از migration و پذیرش لازم انجام نشود؛ build مستقل انتشار اصلی نیست.

## برش تازه: بک‌اند سریال/IMEI انبار — پنل و پذیرش باز

[INVENTORY-SERIALS.md](INVENTORY-SERIALS.md) مرجع است. mode پویا برای تنوع، دریافت/خروج نسخه‌دار با ledger/alias/event و replay پایدار، صفحه۵۰/history و قرارداد داخلی assignment اضافه شد. IMEI دوم یک دستگاه دیگر نیست؛ IMEI سراسری و سریال در تنوع یکتاست. تغییر mode فقط روی ماندهٔ خالی است؛ tracking اصلاح عددی و تبدیل به دیجیتال را می‌بندد. تخصیص فقط از رزرو Allocated، release/fulfill هم‌تراکنش و تحویل نیازمند تمام سریال‌هاست. WarrantyUntil صریح/nullable و مرجع line همان OrderId/VariantId است؛ هیچ paid/provider/رجیستری موفقِ ساختگی اضافه نشده است.

**۴۳۰ واحد بدون SQL موفق**،۲۳ تازه +۴۰۷ رگرسیون؛۹ SQL تازه فقط compile/discovery، کل۱۲۹ با۷۰ اجرا‌نشده و۵۹ شاهد پیشین. build صفر warning/error، Inventory/Catalog مدل بدون تغییر جامانده؛ migration۲۱ و inventory.sql فقط سورس، main۱۷ و۱۸–۲۱ معوق‌اند. SQL/Docker/main و سورس رابط تغییر نکردند. پنل این کنترل‌ها را هنوز ندارد؛ گام بعدی همین UI/contract/fixture است. SQL مثبت/MFA/همزمانی و گردش Sales/ارسال، نگاشت ماندهٔ قدیمی/چندانباری، مرجوعی و دستگاه/گارانتی حساب/QR باقی‌اند؛ INV-01 کامل نیست.

## برش پیشین: فیلترهای پویا و نگه‌داری جست‌وجو

[CATALOG-FACETS.md](CATALOG-FACETS.md) مرجع است. Filters/FacetValues پس از خواندن نام/نوع/واحد، count/page/selected و گزینه‌ها، نسخهٔ تعریف و scope دسته را تأیید می‌کنند؛ حداکثر دو تلاشِ کل read و سپس503 است. حذف پایدار rule همچنان400 می‌دهد. pending write قبلاً در maintenance رد می‌شد؛ اکنون cancellation و transaction موجود EF/ambient نیز پیش از Clear بررسی می‌شوند. batch۲۵۰/RepeatableRead/normalization و فرمان بدون retry حفظ‌اند.

**۴۰۷ واحد بدون SQL موفق**،۸ تازه +۳۹۹ رگرسیون؛ هشت SQL تازه فقط compile/discovery، کل۱۲۰ با۶۱ اجرا‌نشده و۵۹ شاهد پیشین. build صفر warning/error و Catalog model بدون تغییر جامانده؛ source۲۰/main۱۷ حفظ‌اند. SQL/Docker/main و سورس رابط تغییر نکردند؛ دو endpoint با سرویس مصنوعی،503/no-store داشتند. این کنترل snapshot مشترک count/page/محصول/قیمت/موجودی نیست و به writer نسخه‌دار وابسته است؛ مثبت SQL/repair/rollback/همزمانی/plan/بار و UI متصل باقی‌اند.

## برش پیشین: خواندن عمومی و اطلاعات خرید

[PUBLIC-CATALOG-READS.md](PUBLIC-CATALOG-READS.md) مرجع است. ReadCart از قبل یک projection و quote/order از قبل transaction مشترک Serializable داشتند؛ این حفاظت‌ها حفظ‌اند. reader خرید اکنون قیمت/جزئیات/نسخه را یکجا و روابط را با تأیید نسخه می‌خواند. graph عمومی، انتخاب winner جست‌وجو و lookup تا hydration نسخه را کنترل می‌کنند؛ read-only حداکثر دو تلاش و سپس catalog_unavailable/503 است. مدیریت۴۰۹/فرمان بدون retry و DTO/پول/no-store/مجوزها حفظ‌اند؛ شکست به sample یا صفر تبدیل نمی‌شود.

**۳۹۹ واحد موفق**،۱۷ تازه +۳۸۲ رگرسیون؛۹ SQL تازه فقط compile/discovery، کل۱۱۲ با۵۳ اجرا‌نشده و۵۹ شاهد پیشین. build صفر warning/error؛ Catalog model بدون تغییر جامانده و source۲۰/main۱۷ حفظ‌اند. SQL/Docker/main و سورس رابط تغییر نکردند؛ test host داخلی خطای503 بدون SQL آزموده شد. این کنترل snapshot سراسری/رزرو نیست؛ count/page/stock مشترک، writer بدون bump، plan/بار و UI متصل پوشش ندارند. Filters/FacetValues و maintenance مشتق‌ها کار مستقل بعدی‌اند.

## برش پیشین: نسخه و خواندن سازگار کاتالوگ

[CATALOG-VERSIONS.md](CATALOG-VERSIONS.md) مرجع است. Catalog قبلاً UpdatedAt را تغییر می‌داد و همان نقص معمول Finance فرض نشد؛ اکنون modified صریح parent/variant، چرخش rowversion را از برابرشدن زمان مستقل می‌کند. زمان فرمان از TimeProvider موجود است؛ ایجاد رکورد/تغییر رسانه/history و soft-disable تنوع stamp مناسب دارند. مقدار مالی/تایپ ویژگی و transaction/audit قبلی عوض نشده‌اند.

بعد از split-read مدیریت، فقط Id/Version در batchهای۵۰۰تایی دوباره خوانده می‌شوند؛ محصول/تنوع و header دسته/تعریف ویژگی با قواعد/گزینه‌ها بررسی می‌شوند. تغییر/حذف/ناسازگاری به version_conflict/409 می‌انجامد، نه DTO مختلط. snapshot سراسری یا حفاظت در برابر writer بدون bump نیست؛ خواندن عمومی/Cart/Checkout هنوز در این برش تغییر نکرد. مدل/قرارداد endpoint و schema تغییری ندارند.

**۳۸۲ واحد موفق**؛۱۰ تازه +۳۷۲ رگرسیون، بدون SQL. هفت SQL ساعت ثابت/دو writer/read race/rollback فقط compile/discovery؛ کل۱۰۳ و۴۴ مورد تازه اجرا نشده‌اند. Catalog model بدون تغییر جامانده؛ Source۲۰/main۱۷ حفظ است. UI/Next/Vite و اجرای اصلی این برش تغییر نکردند و شواهد رابط قبلی دوباره اجرا نشدند.

## برش پیشین: فهرست و ویرایش شرایط خرید

[FINANCE-PAGING.md](FINANCE-PAGING.md) مرجع است. Payments/Credit صفحهٔ۵۰ خلاصه با seek/TOP51، جست‌وجوی نام/شناسه و فیلتر فعالیت/نوع/قابل‌استفاده‌بودن برای دسته می‌دهند؛ جزئیات همان مورد حداکثر۵۰۰ دسته و نسخهٔ دوباره‌بررسی‌شده دارد. summary مستقل داشبورد جای دریافت تمام طرح‌ها را گرفت. عمومی مشتری و assignment کالا هنوز مسیر کامل قبلی را دارند؛ pagination کل مدیریت ادعا نمی‌شود.

نقص نسخهٔ تغییر صرفاً دسته‌ها اصلاح شد: هر ویرایش parent را modified می‌کند تا rowversion بچرخد؛ reader پس از قواعد، نسخه را دوباره بررسی می‌کند تا header قدیمی با قواعد تازه به فرم نرسد. فرم نرخ/مدت فرضی ندارد، دستهٔ غایب را حفظ می‌کند، در نبود metadata ذخیره را می‌بندد و پس از unknown/conflict دوباره خودکار ارسال نمی‌کند. ساخت تنظیمات idempotency دائمی ندارد؛ پذیرش SQL/همزمانی و قطع پاسخ باقی است.

۳۷۲ بک‌اند،۳۱ contract،پنج wire مصنوعی و۳۰ UI محدود موفق‌اند. دو fixture/۳۲ درخواست/سه ذخیرهٔ ردشده و صفر Cookie/Authorization یا خواندن legacy کامل؛ console صفر. bug اشتراک dictionary در حالت پاسخ خراب خود fixture اصلاح شد و فقط fixture خود پروژه restart شد؛ UI دادهٔ خراب را درست رد می‌کرد. پنج SQL تازه فقط compile/discovery؛ **کل۹۶ با۳۷ مورد تازهٔ اجرا‌نشده**. Payments/Credit مدل بدون تغییر جامانده دارند، schema جدیدی لازم نیست، source۲۰/main۱۷ حفظ است.

## برش پیشین: دفتر نشانی و مقصد سفارش

[ADDRESS-BOOK.md](ADDRESS-BOOK.md) مرجع قرارداد و محدودیت‌هاست. مشتری از مسیر FA/EN حساب، دفتر حداکثر۲۰ نشانی دارد؛ ساخت/ویرایش/پیش‌فرض/حذف با rowversion، قفل حساب و transaction Serializable پیاده شده است. اطلاعات گیرنده/تحویل و fingerprint ساخت با Data Protection و binding حساب+نشانی حفاظت می‌شوند؛ بدون جدول plaintext تماس یا دسترسی DbContext دیگر. شمارهٔ گیرنده شمارهٔ ورود را تأیید نمی‌کند.

انتخاب‌گر فقط برای سفارش فیزیکی و با کپی صریح است؛ note/رضایت و درخواست frozen سفارش را تغییر نمی‌دهد. سفارش snapshot مستقل قبلی خودش را دارد. خطا به دفتر خالی/fixture تبدیل نمی‌شود؛ قطع پاسخ، فرم را قفل و retry همان id/body/version را نگه می‌دارد. ورودی/پاسخ BFF strict و bounded، private/no-store و بدون عبور cookie هستند. addresses به گیت حساس PWA/activation اضافه شد. A23 ظرفیت/قواعد پیش‌فرض فنی است؛ سیاست تجاری تازه‌ای فرض نشده.

۳۵۳ بک‌اند،۱۱۶ فروشگاه،۲ wire مصنوعی ASP.NET→TS،۱۹ UI محدود و۱۲ HTTP build واقعی Next موفق‌اند. UI همهٔ writeها را رد می‌کرد؛۲۰ درخواست/پنج write/دو retry دقیق و صفر Cookie/Authorization، بدون مقدار ورودی در log. overflow خروجی debug مخصوص fixture اصلاح شد؛ دو console error HMR آن ثبت است و تب fresh نهایی خطا/هشدار صفر داشت. مثبت SQL/مشتری/سفارش پذیرفته نشده است. هفت SQL تازه فقط compile؛ کل۹۱ و۳۲ تازه اجرا نشده‌اند. migration۲۰ و SQL idempotent آماده‌اند و روی اصلی اعمال نشده‌اند.

## برش‌های دیگر و مرز پذیرش

| مرجع | شاهد سورس/اجرای پیشین و کار باقی |
|---|---|
| [STAFF-ADMINISTRATION](STAFF-ADMINISTRATION.md) | Administrator، lookup حساب معتبر دارای رمز/تماس تأییدشده، نقش/فعالیت/ابطال نشست/audit اتمیک و منع خود/آخرین مدیر؛۳۳۵ واحد/۲۶ contract/۱۴ wire/۲۴ UI نمونه پیشین؛ شش SQL تازه فقط compile، مثبت MFA/نقش/race/rollback باقی |
| [MFA-RECOVERY](MFA-RECOVERY.md) |۱۰ کد۱۲۸بیتی hash‌شده، بازیابی با رمز+کد و grant محدود۵دقیقه‌ای، ثبت دوبارهٔ اجباری و ابطال نشست؛ پنج SQL تازه فقط compile؛ رمز/کلید مالک دست‌نخورده |
| [ADMIN-PRODUCTS](ADMIN-PRODUCTS.md) | صفحهٔ۵۰ کالا/seek، جزئیات تک‌کالا و lookup۲۴ CMS؛۲۳ UI فقط خواندنی و دو SQL تازه فقط compile؛ ویرایش/انتشار/MFA و ذخیرهٔ واقعی CMS باقی |
| [INVENTORY-PAGING](INVENTORY-PAGING.md) | صفحهٔ۵۰ تنوع و lookup موجودی بدون graph مالی؛۱۴ UI فقط خواندنی و دو SQL تازه فقط compile؛ فرم اصلاح/race و بار باقی |
| [INVENTORY-HISTORY](INVENTORY-HISTORY.md) | تاریخچهٔ۵۰ با seek/فیلتر؛۱۵ UI محدود و دو SQL تازه فقط compile؛ plan/بار باقی |
| [TEMPORARY-ORDERS](TEMPORARY-ORDERS.md) | quote3، سفارش/رزرو/لغو/انقضا و audit اتمیک، snapshot صحیح ریال و UI FA/EN؛ SQL۱۲ سفارش در اجرای قبلی موفق و چهار SQL تازه اجرا نشده؛ پذیرش UI متصل/انتشار باقی؛ پیش‌فرض خاموش و canPay=false/gateway_unconfigured |
| [CHECKOUT-CHARGES](CHECKOUT-CHARGES.md) / [CHECKOUT-QUOTES](CHECKOUT-QUOTES.md) | quote2/پنل هزینه و SQL/MFA موقت در اجرای پیشین پذیرفته؛ سیاست اصلی هزینه همچنان تعیین‌نشده |
| [OFFLINE-PROJECTION](OFFLINE-PROJECTION.md) / [SITEMAP-PROJECTION](SITEMAP-PROJECTION.md) | projection عمومی محدود بدون مالی/هویت،۱۶/۲۹ HTTP پیشین موفق؛ هر کدام دو SQL تازه فقط compile؛ native API هنوز preview و index بسته |
| [ADMIN-PERFORMANCE](ADMIN-PERFORMANCE.md) | lazy صفحات/PageBoundary، دو runtime قبلی؛ اندازهٔ chunk شاهد CWV نیست؛ navigation احرازشده/عملکرد دستگاه باقی |

A15 رزرو فنی۱۵دقیقه/یک سفارش باز با حدود۱–۶۰/۱–۱۰ است، نه سیاست تجاری. سفارش موقت فقط نقدی online با مبلغ مثبت/معلوم، بدون تأیید و با فعال‌سازی صریح مدیر مجاز است. چک، provider، پرداخت/refund قطعی و ارسال واقعی جدا باقی‌اند. دفتر نشانی هم tombstone دائمی فرمان ندارد؛ تضمین replay ساخت تا وجود همان resource است. key ring باید با DB حفاظت و بازیابی شود؛ تمرین restore هنوز باقی است.

## آخرین شواهد

| بررسی | نتیجه |
|---|---|
| Shop.Tests | **۴۳۰ موفق**؛۲۳ تازهٔ سریال +۴۰۷ رگرسیون؛ no SQL، serial-inventory-unit.log |
| storefront |۱۱۶ موفق و typecheck/Next build پیشین محفوظ؛ سورس این برش تغییر نکرد و دوباره اجرا نشد |
| admin |۳۱ contract و TypeScript/Vite build مستقل پیشین محفوظ؛ این برش تغییر/اجرای تازه نداشت |
| Shop.SqlTests | **۵۹ شاهد اجرای قبلی**؛۷۰ تازه اجرا نشده‌اند؛ compile صفر warning/error، discovery فقط۱۲۹ مورد |
| model/migration | Inventory/Catalog بدون تغییر جامانده؛ migration۲۱/SQL idempotent سورس؛ source۲۱/main۱۷ و۱۸/۱۹/۲۰/۲۱ معوق |
| wire مالی |پنج پاسخ native test HTTP با reader مصنوعی، schema TS، null و long دقیق؛ no SQL/auth acceptance |
| UI مالی |۳۰ بررسی محدود نمونه؛۳۲ درخواست/سه write ردشده، legacy کامل صفر، بدون header احراز؛ console صفر |
| wire نشانی |۲ پاسخ واقعی test HTTP با سرویس مصنوعی در schema TS؛ no SQL/auth acceptance |
| UI نشانی |۱۹ بررسی محدود نمونه و سه تصویر؛ هیچ ذخیره/حذف واقعی موفق نشد |
| HTTP Next نشانی |۱۲ بررسی build واقعی با metadata fixture بدون auth؛۱۰ BFF و دو صفحهٔ FA/EN با private/no-store و noindex |
| cleanup | fixtureها/NextQA terminal و پورت‌ها بسته؛ main/SQL/Docker/Redis تغییر نکردند |

گزارش جاری `artifacts/checks/serial-inventory-source.json` و INVENTORY-SERIALS است؛ تصاویر/UI مالی پیشین محفوظ‌اند و این برش تصویر تازه ندارد. گزارش/تصاویر دفتر نشانی پیشین محفوظ‌اند. شواهد پیشین با دامنهٔ دقیق در آرشیو/سند هر برش محفوظ است. یک اجرای SQL پیشین CoreCLR SIGSEGV داشت؛ علت اثبات نشده، سپس۱۲ سفارش و۵۹ کامل بدون حذف همزمانی پاس شدند. orphan احتمالی فقط با اثبات دقیق مالکیت بررسی شود؛ پاک‌سازی عمومی SaymanTest_* مجاز نیست.

## مسیر ادامه

1. تا اعلام پایان آزادسازی فضا، SQL/Docker تازه اجرا نکن؛ کار مستقل source/QA بدون هویت ادامه یابد. D16/D17 و MFA مالک حفظ شوند؛ پرسش اعلام پایان قبلاً ارسال شده است. برش آمادهٔ بعدی همان سریال انبار است: schema strict و پنل mode/receipt/retire/list/history، حالت read-only و unknown/retry، wire/fixture و UI بدون SQL. جزئیات در INVENTORY-SERIALS است؛ source بک‌اند به پایان پذیرش/تحویل نرسیده و SQL/انتشار منتظر D19 است.
2. پس از اعلام، فضا/سلامت محیط و **SQL۱۲۹** را واقعاً اجرا کن.۷۰ تازه: چهار سفارش، دو offline، دو sitemap، دو history، دو stock، دو product، پنج MFA recovery، شش staff و هفت address و پنج finance paging/نسخه/دو writer/جزئیات میان تغییر/نقش واقعی و هفت catalog clock/split read/روابط/variant/rollback و۹ خواندن عمومی/checkout/winner/lookup/503/replay و هشت facet/واحد/rule/repair/batch/transaction و۹ سریال/alias/replay/تخصیص/تحویل/rollback؛ جزئیات در اسناد مربوط است.
3. با SHOP_UI_OPERATIONS_QA=1 و SQL ایزوله: مدیر موقت با MFA و مشتری؛ گردش staff/recovery/نسخه/audit/ابطال نشست، finance صفحه/فرم/دسته‌تنها/قطع پاسخ، Catalog رابطه‌تنها/نسخهٔ خواندن/دو writer و خواندن عمومی/checkout/facet در تغییر همزمان و repair، سریال/digital/ledger/دو سفارش و یک واحد، دفتر نشانی دو حساب/پیش‌فرض/نسخه/قطع پاسخ، کپی در فرم فیزیکی و سفارش دیجیتال، quote3/ثبت/خالی‌شدن سبد/رزرو/replay/لغو و snapshot مستقل، موجودی/کالا/CMS در دو زبان و موبایل. هیچ کلید مالک استفاده نشود.
4. پس از پذیرش، main migration۱۸/۱۹/۲۰/۲۱، build/runtime تازه و smoke؛ imageهای تازه با guard ظرفیت، Linux x64، query plan/load و backup/restore DB+keys. نسخهٔ اصلی پیش از این گام جلو نرفته است.
5. کل PDF ادامه دارد: ثبت‌نام/تأیید/بازیابی واقعی و OTP/provider، checkout نهایی/پرداخت/چک/مدارک/ارسال/تخفیف/سریال، رسانهٔ S3/ClamAV، CMS پیشرفته/SEO، PWA/Push/accessibility/CWV، support/review/market و قابلیت‌های تکمیلی، CI/پایش و تحویل. اسکلت یا adapter خاموش معیار پایان نیست؛ هدف کامل فعال می‌ماند.
