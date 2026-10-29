# وضعیت و نقطهٔ ادامه

آخرین به‌روزرسانی: 2026-10-23. **پروژهٔ کامل PDF ناتمام است و برای فروش واقعی آماده نیست.** هدف کامل PRD/PLAN فعال می‌ماند. [آرشیو پیش از پنل سریال و پذیرش SQL](archive/STATUS-before-serial-admin-sql.md) تاریخچهٔ برش‌ها و شاهدهای پیشین را حفظ می‌کند؛ اعداد و توقف D19 آن، وضعیت تاریخی‌اند.

## تصمیم‌ها و محیط

- D14: ظاهر و جریان تأیید شده و ادامهٔ API، پنل و SQL مجاز است؛ تأیید دوباره لازم نیست. دادهٔ پویا، FA/EN، روش خرید مستقل تنوع، ورود موبایل/OTP و ایمیل یا نام کاربری/رمز و Linux Docker الزامی‌اند.
- **D20**: مالک پایان آزادسازی را اعلام کرد؛ توقف D19 رفع شد. حدود۳۱GiB آزاد، Docker28.3.2 پاسخ‌گو، کانتینر SQL healthy است. Sayman ONLINE، DBCC PHYSICAL_ONLY بدون repair/خطا، main۱۷ و پس از مجموعهٔ SQL هیچ SaymanTest باقی نماند. این پذیرش روی SQL2022/MacARM/Rosetta است؛ Linux x64/بار/restore جدا باقی‌اند.
- D17: `parseh-chat-redis` خاموش بماند. فایل شخصی/volume حذف نشود؛ فقط منابع موقت خود QA پاک شوند.
- D16: نام/مستندات درگاه، پیامک و ایمیل موجود نیست؛ providerها غیرفعال و بدون موفقیت ساختگی‌اند. سیاست واقعی ارسال/مالیات، درصد/ماه/پیش‌پرداخت چک و جزئیات گارانتی/مرجوعی هنوز تعیین نشده‌اند.
- حساب، کد و کلید MFA مالک خوانده/ثبت نشوند. QA مثبت فقط با حساب/کلید موقت و SQL ایزولهٔ خودش.
- **D21**: فقط در دیتابیس موقت QA، ارسال۱۲۳۴۵ریال/بدون مالیات جداگانه/رزرو۶۰دقیقه/سقف۲ سفارش مجاز شد؛ سیاست اصلی تعیین نشده است.
- **وضعیت تازهٔ محیط پس از وقفه**: پردازش‌های اصلی و QA متوقف/handleهای قبلی مفقودند. Docker با مجوز پیشین از CLI رسمی بازگردانده شد؛ فقط SQL فروشگاه روشن و healthy شد. اصلی/QA ONLINE و main۱۷ دوباره خوانده شد؛ Redis چت خاموش است. گزارش customer-operations-interruption.json مرجع جاری است؛ جدول اجراهای قبلی پایین، سابقهٔ آخرین اجرای پذیرفته‌شده است.
- **ادامهٔ تازه پس از بازیابی**: همان QA بدون seed/migration/هویت/نقش تازه resume شد؛ API5181/PID14700، Vite3175/PID15420 و Next3105/PID15437 زنده و HTTP200 هستند. main5080/3000/3173 هنوز خاموش است؛ SQL اصلی۱۷، DBCC PHYSICAL_ONLY تازه صفر خطا، SQL healthy و Redis چت exited تأیید شدند. حدود۳۳٫۵GiB آزاد. customer-operations-handoff.json و qa-resume-state.json وضعیت جاری‌اند؛ interruption بالا تاریخچه است.

## سورس و اجرا

| بخش | وضعیت |
|---|---|
| API5080 / Next3000 / admin3173 | آخرین اجرای پذیرفته‌شده هزینه/quote2؛ اکنون پس از وقفه خاموش‌اند؛ PIDهای قبلی زنده نیستند. سورس تازه بدون migration لازم اجرا نشود |
| SQL اصلی / سورس | **main۱۷ / source۲۱**؛ Sales۱۸ TemporaryOrders، Identity۱۹ MfaRecovery، Sales۲۰ CustomerAddressBook و Inventory۲۱ SerialUnits روی اصلی اعمال نشده‌اند |
| پنل تازه | سریال/نشست و اصلاح فاصله‌های CMS موبایل؛ typecheck و build تازه tmp/cms-mobile-admin-dist موفق، dist اصلی تغییر نکرد؛ تصویر پس از اصلاح CMS باقی |
| Next | سورس این برش تغییر نکرد؛ build قبلی .next-qa دفتر نشانی محفوظ؛ اجرای اصلی حفظ شده |
| storefront3100 | کانتینر قدیمی؛ مرجع سورس جاری نیست |
| QA متصل پیشین |۱۷ بررسی محصول/سریال موفق و منابع همان run پاک شدند |
| QA متصل تازه |۴۷ بررسی مشتری/دفتر نشانی/سفارش موفق +۷ CMS draft؛ همان DB/key/credential با resume امن و سه process بالا فعال‌اند؛ cleanup مبدأ منتظر تصمیم CMS است |

اجرای backend-local.py/serve-storefront-api.py با سورس تازه پیش از پذیرش و migration لازم انجام نشود. build مستقل انتشار اصلی نیست.

## سریال/IMEI و پنل

[INVENTORY-SERIALS.md](INVENTORY-SERIALS.md) مرجع است. mode پویا در تنوع، دریافت/خروج نسخه‌دار، ledger/alias/event و replay پایدار، صفحه۵۰/history و تخصیص داخلی از رزرو Allocated پیاده شده‌اند. IMEI دوم alias همان یک دستگاه است؛ یکتایی تاریخی سراسری حفظ می‌شود. mode فقط روی ماندهٔ خالی؛ bypass عددی و تبدیل tracking به digital بسته‌اند. release/fulfill با رزرو و موجودی هم‌تراکنش و تحویل نیازمند تمام سریال‌هاست؛ WarrantyUntil صریح/nullable است.

پنل موجودی اکنون فهرست/پیشوند/وضعیت/history، تغییر mode، دریافت batch و خروج را دارد؛ نقش فقط‌خواندنی write نمی‌بیند. نتیجهٔ نامشخص همان UUID/body/version را در حافظه قفل می‌کند و retry دستی دارد؛ 4xx قطعی تازه‌خوانی لازم دارد. پاسخ malformed حتی200 موفق محسوب نمی‌شود. state/variant/alias/count/نسخه و nullها strict هستند؛ تاریخچه long رشته‌ای می‌ماند. این حافظه با بستن فرم/صفحه از بین می‌رود و هشدار روشن دارد؛ journal دائمی مرورگر اضافه نشده است.

**۴۳۱ واحد بک‌اند،۵۲ تست پنل (۴۴ contract +۸ نشست)،۳ wire و۱۸ UI محدود نمونه موفق**؛ دو wire GET native HTTP با reader مصنوعی و یک command با serializer واقعی‌اند، پذیرش command HTTP/SQL نیستند. fixture مرورگر۴۹ درخواست/هشت write/سه موفقیت فقط حافظه‌ای داشت؛ هیچ تغییر SQL/حساب و header احراز نداشت. دو retry اول body hash یکسان دارند؛ console صفر. موبایل390 و جدول با scroll داخلی بدون overflow صفحه بررسی شد. fixture/تب/پورت3175/5181 آن بسته شدند؛ سپس همان پورت‌ها برای QA SQL مستقل جدید استفاده شده‌اند.

## پذیرش SQL تازه

**۱۲۹ از۱۲۹ SQL واقعی، صفر skip/شکست** روی دیتابیس‌های GUID مستقل موفق شدند؛ شامل۷۰ موردی که در توقف D19 فقط compile شده بودند و هر۹ مورد سریال. اجرای اول۱۲۶ موفق/سه شکست داشت: جست‌وجوی نام فارسی در staff/finance اعراب را حذف نمی‌کرد و با REPLACE صریح اعراب پایه، BIN2 برای جایگزینی دقیق و CI_AI برای contains اصلاح شد؛ Credit نیز همان اصلاح و آزمون مثبت دارد. آزمون غیرفعال‌کردن تنها تنوع Published ورودی نامعتبر داشت و اکنون هم‌زمان کالا را Hidden می‌کند؛ قاعدهٔ انتشار تضعیف نشد. اجرای کامل دوم۱۲۹ موفق است.

این مجموعه migrationهای۱۸–۲۱ را فقط روی دیتابیس‌های آزمون اجرا کرد. پذیرش JWT/MFA/audit/rowversion/rollback/همزمانی API در دامنهٔ آزمون‌ها واقعی است؛ جای E2E مرورگر، query plan/load، paid/provider واقعی یا پذیرش Linux x64 نیست. source مدل Catalog/Inventory پیشین بدون تغییر مانده؛ در این ادامه schema تازه‌ای اضافه نشد. آزمون پس از اصلاح‌ها۴۳۱ واحد هم موفق است.

## مرورگر متصل پیشین و اصلاح نشست/منو

**۱۷ بررسی متصل** با مدیر/MFA تولیدشدهٔ خود harness و SQL مستقل موفق: ساخت/ویرایش/انتشار کالای FA/EN، قیمت9007199254740993 ریال و بازخوانی دقیق، تنوع بدون Stock، فعال‌سازی IMEI، دریافت یک دستگاه با دو alias/ارقام فارسی، ممنوعیت mode روی ماندهٔ پر، history و خروج/ماندهٔ صفر، رد IMEI تاریخی، رد bypass عددی/تبدیل digital، نمایش کالای منتشرشده در Next فارسی/انگلیسی و audit موفق‌ها. این گردش پرداخت/ارسال واقعی نیست. نقش/رِیس/rollback کامل در SQL۱۲۹ آزموده شده؛ browser همهٔ گردش‌های کارکنان/بازیابی/دفتر نشانی/سفارش را پوشش نمی‌دهد. گزارش operations-serial-ui.json و دو تصویر operations-* مرجع‌اند؛ logout204 و cleanup graceful پذیرفته شدند.

در وقفهٔ طولانی مرورگر، تایمر تمدید اجرا نشد و GET با access منقضی401 شد؛ اصلاح SessionAccess پیش از ارسال، با deadline مطلق/حاشیه۶۰ثانیه و یک promise مشترک، refresh قبلی و قفل navigator را استفاده می‌کند. refresh خودش و grant محدود MFA در این حلقه نمی‌افتند؛ شکست، فرمانِ هنوزارسال‌نشده را می‌بندد؛ فرمان ارسال‌شده/401 خودکار replay نمی‌شود. پاسخ دیرهنگام پس از logout/ورود دیگر پذیرفته نمی‌شود و تایمر cleanup هم محافظ دارد. **۸ آزمون clock/همزمانی/لغو موفق**؛ وقفهٔ۲۱دقیقه‌ای واقعی بعد از اصلاح دوباره تکرار نشد. sidebar در ارتفاع کم گزینه‌های آخر/خروج را پنهان می‌کرد؛ nav اکنون scroll داخلی دارد و audit/خروج دسکتاپ واقعاً قابل دسترسی‌اند. تلاش viewport پنل متصل همچنان1280px بود؛ mobile connected پذیرفته اعلام نمی‌شود؛ تنها fixture390px این برش شاهد موبایل است.

build مستقل نهایی: entry333.94/gzip105.92kB، schemas85.66/gzip24.44 و lazy سریال20.67/gzip6.57؛ این اعداد CWV نیستند. Catalog/Inventory model check بدون تغییر جامانده و wire۳ پس از آخرین تغییر دوباره موفق است. فایل‌های اصلی/volume و حساب مالک تغییر نکردند. final-cleanup صفر دیتابیس آزمون، main۱۷، Redis exited و حدود۳۱GiB آزاد را تأیید می‌کند.

## شواهد

**Linux و resume**:۴۳۱/۴۳۱ واحد بک‌اند با صفر skip/شکست در کانتینر Linux/amd64 موفق شد؛ Docker روی MacARM/emulation بود، نه میزبان native مستقل. build target=test/cacheonly است و runtime جدید منتشر نشده؛ backend-linux-amd64-current.json/log شاهدند. helper build پنج guard resume و ادامهٔ مثبت همان SQL را پذیرفت؛ اجرای دوم روی پورت مشغول رد شد و SQL حفظ۲ سفارش لغوشده/یک نشانی/CMS revision1 با draft جدید و published قبلی را تأیید کرد. `--resume-run` هیچ migrate/seed/role grant ندارد؛ خطای پیش از readiness مبدأ را حفظ می‌کند، SIGTERM پس از readiness همان DB/private dir را جمع می‌کند. نشست‌های فعلی API57174/admin85613/Next34464 هستند؛ پیش از هر توقف/اتصال دوباره مالکیت بررسی شود. صفر clone restore باقی است. build نهایی CSS/typecheck نیز موفق است؛ بازبینی تصویری هنوز باقی.

**تمرین بازیابی جدید**: [BACKUP-RESTORE](BACKUP-RESTORE.md) و qa-restore-report.json:۶ مرحلهٔ COPY_ONLY/CHECKSUM/VERIFYONLY/restore GUID/CheckDB/migration و۱۷ verifier مشتری/نشانی رمز‌شده/سفارش/MFA مدیر و CMS بدون انتشار موفق‌اند؛۵ guard هدف اصلی/مسیر نامعتبر نیز موفق‌اند. key ring کپی‌شده در فرایند تازه و HTTP واقعی TestServer مصرف شد؛ نبود/owner/app ناسازگار بسته ماند. کپی restore/BAK/credential/key کامل پاک شد؛ مبدأ CMS جدا محفوظ است. اصلی۱۷/source۲۱ باقی است. تولید، offsite/زمان‌بندی، certificate خصوصی و میزبان مستقل پذیرفته نشده‌اند. نخستین verifier به‌دلیل ContentRoot شکست داشت و پس از cleanup/اصلاح، کامل پاس شد؛ شاهد شکست جدا محفوظ است.

**پذیرش تازهٔ مشتری و CMS**: [CUSTOMER-OPERATIONS-QA](CUSTOMER-OPERATIONS-QA.md) حدود کامل را شرح می‌دهد. دفتر نشانی CRUD/default/ارقام فارسی و FA/EN، کپی صریح، note/رضایت، سفارش فیزیکی quote3 با جمع۶۸۹۰۱۲۳۴۵ریال، snapshot مستقل از ویرایش دفتر، لغو مشتری و آزادسازی۵/۱/۴→۵/۰/۵، دیجیتال بدون delivery/ارسال و لغو مدیر۱۵/۱/۱۴→۱۵/۰/۱۵ موفق‌اند. دو سفارش پرداخت‌نشده لغوشده و audit مربوط در مرورگر واقعی پذیرفته شدند؛ provider/paid/ارسال واقعی نیست. customer-operations-ui.json شامل۴۷ پاس و console صفر است. مالکیت دو مشتری/قطع پاسخ/worker/mobile مشتری در این run آزموده نشدند.

CMS هفت پاس draft/picker/SQL دارد؛ انتشار و rollback را auto-review حتی پس از اثبات isolation رد کرد و سؤال اجازهٔ محدود مالک هنوز باز است. اصل CMS تغییر نکرد. نمای پنل390 فقط برای منو/CMS مشاهده شد. CSS فشردگی picker163px اصلاح و build/typecheck مستقل موفق شد؛ visual پس از اصلاح باقی است. browser skill تازه در مسیر اعلام‌شده موجود نیست و CUA قبلی از ابزارها حذف شده؛ بازبینی از کانال دیگری دور زده نشود.

| بررسی | مرجع |
|---|---|
| SQL۱۲۹ | artifacts/checks/serial-sql-results/serial-sql-fixed.trx و serial-sql-fixed.log؛ اجرای اول شکست‌دار جدا محفوظ |
| Shop.Tests۴۳۱ | serial-final-unit.log، build صفر warning/error |
| پنل۵۲ / typecheck / build | serial-session-admin-tests.log / serial-session-typecheck.log / serial-session-admin-build.log |
| wire۳ | serial-wire/report.json؛ no SQL/auth acceptance |
| UI نمونه۱۸ | serial-layout-ui.json / serial-layout-http.json؛ serial-desktop.png / serial-mobile.png |
| سلامت پس از SQL | serial-post-sql-health.log و serial-final-cleanup.json؛ main۱۷، ONLINE، صفر دیتابیس آزمون پس از cleanup |
| فروشگاه |۱۱۶ واحد و typecheck/Next build پیشین؛ این ادامه تغییری نداشت/دوباره اجرا نشد |

## مسیر ادامه

1. برش مستقل آماده: بکاپ خصوصی و قابل بررسیِ اصلی و پیش‌نیازهای کلیدها بدون خواندن/ثبت MFA مالک، preflight migration۱۸–۲۱، سپس اعمال/ارتقای اجرای محلی و smoke برای برگرداندن app اصلیِ فعلاً خاموش. SQL۱۲۹ و پذیرش متصل هستهٔ مشتری۴۷/محصول‌سریال۱۷ موجودند؛ انتشار مصنوعی CMS که اجازه‌اش باز است مانع این آماده‌سازی مستقل نشود. سیاست واقعی هزینه/سفارش اصلی تعیین نشده و providerها غیرفعال بمانند؛ runtime تازه بدون schema لازم شروع نشود.
2. CMS publication/rollback فقط پس از پاسخ سؤال محدود QA و بازگشت browser skill/ابزار؛ draft و همان run اکنون آماده و زنده‌اند. API57174/admin85613/Next34464/PIDهای جدول را اول بررسی کنید؛ run تازه نسازید و مبدأ معلق را زود SIGTERM نکنید، چون cleanup آن را حذف می‌کند. در صورت وقفه، `scripts/ui-cart-harness.py --resume-run SaymanTest_Ui_98e08e9bc6c941d3a7acdca5ff5c6db0` فقط با private files/همان هویت‌ها و schema کامل قابل استفاده است؛ setup failure مبدأ را حفظ می‌کند. هیچ حذف wildcard مجاز نیست.
3. کارکنان/بازیابی، finance فقط دسته/دو writer، نقش محدود، mobile مشتری/visual CSS/قطع پاسخ/وقفهٔ واقعی نشست و query plan/load هنوز شاهد مستقل لازم دارند. واحد Linux/amd64۴۳۱ و تمرین restore QA۲۳ موفق‌اند؛ native Linux مستقل، image/runtime نهایی و OPS-02 تولید باقی‌اند. guard ظرفیت۱۰/۳GiB و D17 حفظ شوند.
4. INV-01 هنوز کامل نیست: نگاشت صریح ماندهٔ قدیمی، چندانبار، گردش معتبر Sales/ارسال/مرجوعی و دستگاه/گارانتی حساب/QR باقی‌اند. endpoint fake paid/fulfillment ساخته نشود.
5. کل PDF ادامه دارد: providerهای ثبت‌نام/OTP/تأیید/بازیابی، پرداخت/refund و چک/مدارک/ارسال/تخفیف، رسانهٔ S3/ClamAV، CMS پیشرفته/SEO، PWA/Push/accessibility/CWV، support/review/market و قابلیت‌های تکمیلی، CI/پایش و تحویل. adapter خاموش معیار پایان نیست.
