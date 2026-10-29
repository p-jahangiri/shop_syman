# وضعیت و نقطهٔ ادامه

آخرین به‌روزرسانی: 2026-10-23. **پروژهٔ کامل PDF هنوز تمام نشده و برای فروش واقعی آماده نیست.** دامنهٔ کامل PRD/PLAN حفظ شده است. تاریخچهٔ دقیق در [آرشیو پیش از دفتر نشانی](STATUS-before-address-book.md)، [پیش از کارکنان](STATUS-before-staff-administration.md) و آرشیوهای قبلی باقی است.

## تصمیم‌ها و محدودیت محیط

- D14: ظاهر و جریان تأیید و ادامهٔ API، پنل مستقل و SQL مجاز است؛ تأیید دوباره لازم نیست. دادهٔ پویا، FA/EN، روش خرید مستقل تنوع، ورود موبایل/OTP و ایمیل یا نام کاربری/رمز و Linux Docker الزامی‌اند.
- D19: مالک گفته «فضا را آزاد می‌کنم؛ بعد اعلام می‌کنم»؛ **هنوز پایان کار اعلام نشده**. SQL/Docker تازه، migration اصلی و deployment اجرا نشده‌اند. آخرین مشاهدهٔ read-only حدود۳۲GiB بود؛ پرسش تکمیل آزادسازی قبلاً ارسال و بی‌پاسخ مانده؛ فضا جای پاسخ را نمی‌گیرد. کار مستقل source/build/unit/fixture بدون SQL ادامه یافته است.
- D17: `parseh-chat-redis` خاموش بماند. فایل شخصی/volume حذف یا تغییر نکرده‌اند؛ فقط process و کنترل/پوشهٔ موقت متعلق به QA خود پروژه پاک شده‌اند.
- D16: نام/مستندات درگاه، پیامک و ایمیل فعلاً موجود نیست؛ providerها غیرفعال‌اند و هیچ موفقیت ساختگی auth/مالی در API وجود ندارد. هزینهٔ ارسال/مالیات واقعی، درصد/ماه/پیش‌پرداخت چک و جزئیات گارانتی/مرجوعی تعیین نشده‌اند؛ صفر/رایگان فرض نشوند.
- MFA حساب اصلی پنل در اختیار مالک است؛ عامل کلید/کد مالک را نمی‌خواند یا ثبت نمی‌کند. QA مثبت فقط با حساب/کلید موقت خودش و SQL ایزوله انجام شود.
- آخرین سلامت ثبت‌شدهٔ SQL در بازیابی قبلی ONLINE و DBCC بدون repair/خطا بود؛ پس از D19 query تازه نشده. SQL2022 CU22 روی MacARM/Rosetta جای پذیرش Linux x64 نیست. builder مستقل sayman-build و guard شروع۱۰GiB/توقف زیر۳GiB حفظ است؛ Docker تازه اجرا نشد.

## سورس و اجرای زنده

| بخش | وضعیت |
|---|---|
| API5080 / Next3000 / admin3173 | اجرای پذیرفته‌شدهٔ هزینه/quote2؛ در این ادامه restart/جایگزین نشد؛ PIDهای آخر۱۳۶۹۴/۱۳۷۱۹/۹۳۹۰، پیش از هر توقف مالکیت دوباره بررسی شود |
| SQL اصلی | آخرین اعمال۱۷ migration در هفت schema |
| سورس migration | **۲۰**؛ Sales۱۸ TemporaryOrders، Identity۱۹ MfaRecovery و Sales۲۰ CustomerAddressBook اعمال نشده‌اند |
| Next تازه | build نهایی `.next-qa` موفق، شامل دفتر نشانی و picker/PWA؛ `.next` اصلی و generated TS زنده با wrapper حفظ شدند |
| پنل | build پیشین مستقل tmp/staff-admin-dist؛ این برش Vite را تغییر نداد/دوباره build نکرد |
| storefront3100 | کانتینر قدیمی؛ مرجع سورس جاری نیست |
| QA همین برش | پورت‌های۳۱۰۵/۳۱۷۵/۵۱۸۱ بسته؛ parent/child terminal، تب۲۵/۲۶ بسته و viewport reset؛ هیچ credential/DB یا ورود موفقی ساخته نشد |

فرمان‌های main همچنان backend-local.py و serve-storefront-api.py هستند. اجرای آن‌ها با سورس تازه پیش از migration و پذیرش لازم انجام نشود؛ build مستقل انتشار اصلی نیست.

## برش تازه: دفتر نشانی و مقصد سفارش

[ADDRESS-BOOK.md](../ADDRESS-BOOK.md) مرجع قرارداد و محدودیت‌هاست. مشتری از مسیر FA/EN حساب، دفتر حداکثر۲۰ نشانی دارد؛ ساخت/ویرایش/پیش‌فرض/حذف با rowversion، قفل حساب و transaction Serializable پیاده شده است. اطلاعات گیرنده/تحویل و fingerprint ساخت با Data Protection و binding حساب+نشانی حفاظت می‌شوند؛ بدون جدول plaintext تماس یا دسترسی DbContext دیگر. شمارهٔ گیرنده شمارهٔ ورود را تأیید نمی‌کند.

انتخاب‌گر فقط برای سفارش فیزیکی و با کپی صریح است؛ note/رضایت و درخواست frozen سفارش را تغییر نمی‌دهد. سفارش snapshot مستقل قبلی خودش را دارد. خطا به دفتر خالی/fixture تبدیل نمی‌شود؛ قطع پاسخ، فرم را قفل و retry همان id/body/version را نگه می‌دارد. ورودی/پاسخ BFF strict و bounded، private/no-store و بدون عبور cookie هستند. addresses به گیت حساس PWA/activation اضافه شد. A23 ظرفیت/قواعد پیش‌فرض فنی است؛ سیاست تجاری تازه‌ای فرض نشده.

۳۵۳ بک‌اند،۱۱۶ فروشگاه،۲ wire مصنوعی ASP.NET→TS،۱۹ UI محدود و۱۲ HTTP build واقعی Next موفق‌اند. UI همهٔ writeها را رد می‌کرد؛۲۰ درخواست/پنج write/دو retry دقیق و صفر Cookie/Authorization، بدون مقدار ورودی در log. overflow خروجی debug مخصوص fixture اصلاح شد؛ دو console error HMR آن ثبت است و تب fresh نهایی خطا/هشدار صفر داشت. مثبت SQL/مشتری/سفارش پذیرفته نشده است. هفت SQL تازه فقط compile؛ کل۹۱ و۳۲ تازه اجرا نشده‌اند. migration۲۰ و SQL idempotent آماده‌اند و روی اصلی اعمال نشده‌اند.

## برش‌های پیشین و مرز پذیرش

| مرجع | شاهد سورس/اجرای پیشین و کار باقی |
|---|---|
| [STAFF-ADMINISTRATION](../STAFF-ADMINISTRATION.md) | Administrator، lookup حساب معتبر دارای رمز/تماس تأییدشده، نقش/فعالیت/ابطال نشست/audit اتمیک و منع خود/آخرین مدیر؛۳۳۵ واحد/۲۶ contract/۱۴ wire/۲۴ UI نمونه پیشین؛ شش SQL تازه فقط compile، مثبت MFA/نقش/race/rollback باقی |
| [MFA-RECOVERY](../MFA-RECOVERY.md) |۱۰ کد۱۲۸بیتی hash‌شده، بازیابی با رمز+کد و grant محدود۵دقیقه‌ای، ثبت دوبارهٔ اجباری و ابطال نشست؛ پنج SQL تازه فقط compile؛ رمز/کلید مالک دست‌نخورده |
| [ADMIN-PRODUCTS](../ADMIN-PRODUCTS.md) | صفحهٔ۵۰ کالا/seek، جزئیات تک‌کالا و lookup۲۴ CMS؛۲۳ UI فقط خواندنی و دو SQL تازه فقط compile؛ ویرایش/انتشار/MFA و ذخیرهٔ واقعی CMS باقی |
| [INVENTORY-PAGING](../INVENTORY-PAGING.md) | صفحهٔ۵۰ تنوع و lookup موجودی بدون graph مالی؛۱۴ UI فقط خواندنی و دو SQL تازه فقط compile؛ فرم اصلاح/race و بار باقی |
| [INVENTORY-HISTORY](../INVENTORY-HISTORY.md) | تاریخچهٔ۵۰ با seek/فیلتر؛۱۵ UI محدود و دو SQL تازه فقط compile؛ plan/بار باقی |
| [TEMPORARY-ORDERS](../TEMPORARY-ORDERS.md) | quote3، سفارش/رزرو/لغو/انقضا و audit اتمیک، snapshot صحیح ریال و UI FA/EN؛ SQL۱۲ سفارش در اجرای قبلی موفق و چهار SQL تازه اجرا نشده؛ پذیرش UI متصل/انتشار باقی؛ پیش‌فرض خاموش و canPay=false/gateway_unconfigured |
| [CHECKOUT-CHARGES](../CHECKOUT-CHARGES.md) / [CHECKOUT-QUOTES](../CHECKOUT-QUOTES.md) | quote2/پنل هزینه و SQL/MFA موقت در اجرای پیشین پذیرفته؛ سیاست اصلی هزینه همچنان تعیین‌نشده |
| [OFFLINE-PROJECTION](../OFFLINE-PROJECTION.md) / [SITEMAP-PROJECTION](../SITEMAP-PROJECTION.md) | projection عمومی محدود بدون مالی/هویت،۱۶/۲۹ HTTP پیشین موفق؛ هر کدام دو SQL تازه فقط compile؛ native API هنوز preview و index بسته |
| [ADMIN-PERFORMANCE](../ADMIN-PERFORMANCE.md) | lazy صفحات/PageBoundary، دو runtime قبلی؛ اندازهٔ chunk شاهد CWV نیست؛ navigation احرازشده/عملکرد دستگاه باقی |

A15 رزرو فنی۱۵دقیقه/یک سفارش باز با حدود۱–۶۰/۱–۱۰ است، نه سیاست تجاری. سفارش موقت فقط نقدی online با مبلغ مثبت/معلوم، بدون تأیید و با فعال‌سازی صریح مدیر مجاز است. چک، provider، پرداخت/refund قطعی و ارسال واقعی جدا باقی‌اند. دفتر نشانی هم tombstone دائمی فرمان ندارد؛ تضمین replay ساخت تا وجود همان resource است. key ring باید با DB حفاظت و بازیابی شود؛ تمرین restore هنوز باقی است.

## آخرین شواهد

| بررسی | نتیجه |
|---|---|
| Shop.Tests | **۳۵۳ موفق**؛۱۸ تازهٔ نشانی +۳۳۵ رگرسیون؛ no SQL، log نهایی address-book-unit-final.log |
| storefront npm test | **۱۱۶ موفق**؛۹ تازه و تست PWA توسعه‌یافته؛ typecheck و Next build ایزوله موفق |
| admin |۲۶ contract و دو runtime پیشین محفوظ؛ سورس این برش تغییر نکرد و دوباره اجرا نشد |
| Shop.SqlTests | **۵۹ شاهد اجرای قبلی**؛۳۲ تازه اجرا نشده‌اند؛ compile نهایی صفر warning/error، discovery فقط۹۱ مورد |
| model/migration | Sales بدون تغییر جامانده، migration۲۰/SQL idempotent تولید؛ اصلی۱۷ مانده |
| wire نشانی |۲ پاسخ واقعی test HTTP با سرویس مصنوعی در schema TS؛ no SQL/auth acceptance |
| UI نشانی |۱۹ بررسی محدود نمونه و سه تصویر؛ هیچ ذخیره/حذف واقعی موفق نشد |
| HTTP Next نشانی |۱۲ بررسی build واقعی با metadata fixture بدون auth؛۱۰ BFF و دو صفحهٔ FA/EN با private/no-store و noindex |
| cleanup | fixtureها/NextQA terminal و پورت‌ها بسته؛ main/SQL/Docker/Redis تغییر نکردند |

گزارش جمع `artifacts/checks/address-book-source.json` و اسناد ADDRESS-BOOK؛ تصاویر `artifacts/screenshots/sayman-addresses-*` هستند. شواهد پیشین با دامنهٔ دقیق در آرشیو/سند هر برش محفوظ است. یک اجرای SQL پیشین CoreCLR SIGSEGV داشت؛ علت اثبات نشده، سپس۱۲ سفارش و۵۹ کامل بدون حذف همزمانی پاس شدند. orphan احتمالی فقط با اثبات دقیق مالکیت بررسی شود؛ پاک‌سازی عمومی SaymanTest_* مجاز نیست.

## مسیر ادامه

1. تا اعلام پایان آزادسازی فضا، SQL/Docker تازه اجرا نکن؛ کار مستقل source/QA بدون هویت ادامه یابد. D16/D17 و MFA مالک حفظ شوند؛ پرسش اعلام پایان قبلاً ارسال شده است.
2. پس از اعلام، فضا/سلامت محیط و **SQL۹۱** را واقعاً اجرا کن.۳۲ تازه: چهار سفارش، دو offline، دو sitemap، دو history، دو stock، دو product، پنج MFA recovery، شش staff و هفت address؛ جزئیات در اسناد مربوط است.
3. با SHOP_UI_OPERATIONS_QA=1 و SQL ایزوله: مدیر موقت با MFA و مشتری؛ گردش staff/recovery/نسخه/audit/ابطال نشست، دفتر نشانی دو حساب/پیش‌فرض/نسخه/قطع پاسخ، کپی در فرم فیزیکی و سفارش دیجیتال، quote3/ثبت/خالی‌شدن سبد/رزرو/replay/لغو و snapshot مستقل، موجودی/کالا/CMS در دو زبان و موبایل. هیچ کلید مالک استفاده نشود.
4. پس از پذیرش، main migration۱۸/۱۹/۲۰، build/runtime تازه و smoke؛ imageهای تازه با guard ظرفیت، Linux x64، query plan/load و backup/restore DB+keys. نسخهٔ اصلی پیش از این گام جلو نرفته است.
5. کل PDF ادامه دارد: ثبت‌نام/تأیید/بازیابی واقعی و OTP/provider، checkout نهایی/پرداخت/چک/مدارک/ارسال/تخفیف/سریال، رسانهٔ S3/ClamAV، CMS پیشرفته/SEO، PWA/Push/accessibility/CWV، support/review/market و قابلیت‌های تکمیلی، CI/پایش و تحویل. اسکلت یا adapter خاموش معیار پایان نیست؛ هدف کامل فعال می‌ماند.
