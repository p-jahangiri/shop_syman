# وضعیت و نقطهٔ ادامه

آخرین به‌روزرسانی: 2026-10-26. **اصلی محلی۴۷، اصلاح لینک تنوع و منوی بازار CMS منتشر و پذیرفته‌اند؛ کل پروژه/PDF هنوز کامل نیست.** هدف D34 تکمیل همهٔ بخش‌هاست. پایان یک برش، پایان هدف نیست.

## اجرای اصلی محلی۴۷

- API: http://127.0.0.1:5080، PID34617/session48472؛ runtime `tmp/api-runtime-holoo-stock-apply47-253f578fdab84171a719fd9aa1ed74c3`؛ restart: `python3 tmp/holoo-stock-apply47-release.py serve-api`.
- فروشگاه: http://127.0.0.1:3000، PID27655/session87322؛ runtime `tmp/storefront-runtime-variant-url47-2137766931fe4c79a4ee688577c7f041`؛ اصلاح URL تنوع با build تازه `NcvNZSXg_HQa1OMuogYo1` و۳۲۵ تست تازه روی همین schema۴۷ منتشر شد؛۲۲۵ HTTP storefront موفق‌اند. restart: `python3 tmp/serve-variant-url47.py 3000`.
- پنل: http://127.0.0.1:3173، PID21167/session63443؛ runtime از `tmp/admin-runtime-current.json`؛ restart: `node tmp/serve-holoo-stock-apply47-main-admin.mjs`. proxy آزموده‌شده در `tmp/admin-server-source47.mjs` محفوظ است.
- `tmp/{api,storefront,admin}-runtime-current.json` مرجع دقیق مسیر/PID/hash هستند. preview خاموش و API mode فعال است. نسخه۴۶ و وابستگی restart آن محفوظ‌اند؛ writer قدیمی علیه schema۴۷ خودکار اجرا نشود.
- SQL:۴۷ migration/۱۲۹ جدول/۹ schema. فقط دو جدول خالی Inventory.AccountingStockApplications وAccountingStockApplicationLines اضافه شدند.۱۲۶ جدول قدیمی به‌جز history خود Inventory و تمام تعریف‌های قدیمی/schema/viewها دقیقاً محفوظ‌اند؛ پس از HTTP هر۱۲۹ جدول برابرند.
- Stock اصلی101/0/0؛ Orders/Reservations/SourcingRequests/CheckoutSettings/ChargePolicies و دادهٔ هلو/کارکرده صفرند. seed یا سیاست نمونه وارد اصلی نشده است. Redis پارسه طبق D32 running و دست‌نخورده است.
- بکاپ پیش از۴۷:۱۷٬۹۴۴٬۵۷۶بایت COPY_ONLY/CHECKSUM/VERIFYONLY با کپی خصوصی کلید؛ `main-pre47-release-backup.json`. tmp شامل runtime جاری/بازگشت/کلید/بکاپ است و نباید کامل پاک شود.

## پذیرش۴۷

[HOLOO-STOCK-APPLY](HOLOO-STOCK-APPLY.md) قرارداد را ثبت می‌کند. مدیر فقط ردیف‌های معتبر انتخاب‌شده را پس از دو تأیید صریح به ماندهٔ فیزیکی تبدیل می‌کند. رزرو سفارش/تأمین محفوظ‌اند؛ قیمت و محتوا تغییر نمی‌کنند. فایل قدیمی، گردش پس از مشاهده، SKU سریال‌دار/کارکرده، واحد یا نگاشت نامعلوم و نسخهٔ قدیمی مسدودند. header/line/ledger/audit در rootSerializable اتمیک‌اند؛ actor+UUID/hash و رسید تاریخی حتی پس از تغییر موجودی حفظ می‌شوند. این قابلیت اتصال زنده یا نوشتن در هلو نیست؛ قرارداد D30 همچنان نامعلوم است.

۸۶۶ واحد، کل۵۶۷ SQL واقعی (۲۴ هدفمند)،۲۰۸ پنل،۳ proxy شامل تأخیر واقعی۱۳ثانیه، typecheck/build و۶ پاسخ خام SQL با decoder تولیدی و بدنهٔ فرمان واقعی موفق‌اند. بستهٔ immutable۴۷ شامل۱۳ DLL برابر unit/SQL/harness است.

مرورگر دیتابیس GUID مستقل: انتخاب/دو تأیید الزامی، ردیف نامعلوم غیرفعال؛ اصلاح3→6، دو پاسخ200 قطع‌شده، retry با byte/UUID یکسان، ناوبری و GET رسید؛ فایل قبلی مسدود؛ فایل تازه6→2؛ رسید تاریخی3→6 پس از تغییر دوم محفوظ. سه پاسخ واقعی browser با decoder تولیدی پذیرفته‌اند. خواندن عمومی و فروشگاه FA/EN موجودی2 و قیمت769000000ریال را نشان دادند. بازسازی فقط‌خواندنی fingerprint ماندهٔ اولیه ثابت کرد همهٔ ردیف‌های دیگر Stock و تعهدات دقیقاً محفوظ‌اند؛ همهٔ جداول دیگر کاتالوگ/مالی نیز برابرند. QA/کلید/credential خودش حذف، پورت‌ها بسته و تب‌های خود40/41 بسته شدند. عرض واقعی1280/client=scroll1265؛ **mobile پذیرفته نیست**. screenshotهای `holoo-stock-apply-browser-{admin,storefront-fa}.jpg` محفوظ‌اند.

انتشار۴۶→۴۷ پس از بکاپ تازه، CHECKDB،۱۴۶۷ HTTP شامل۷۳۷ درخواست یکتای پوشاننده۱۳۹۵ رکورد قبلی، تمام assetهای قدیم/جدید و401/no-store موفق شد.۱۸۳ asset قدیمی Next و۴۵۳ پنل محفوظ‌اند. فروشگاه همان build۴۴ است؛ مرورگر اصلی بی‌دلیل تکرار نشد، پنل عین artifact در QA پذیرفته شد. مرجع: `artifacts/checks/holoo-stock-apply47-main-release.json` و before/after/post-smoke/public-smoke، browser-acceptance و sql-after.

## اصلاح لینک تنوع و منوی بازار، بدون migration تازه

انتخاب تنوع اکنون URL جاری را با حفظ query/hash جایگزین می‌کند؛ تغییر زبان، reload و لینک صفحه همان SKU را حفظ می‌کنند. build تازه `NcvNZSXg_HQa1OMuogYo1`،۳۲۵ تست تازه،۲۲۵ HTTP و مرورگر اصلی FA→EN بدون خطای سبد پذیرفته‌اند. داده‌های قبلی مرورگر منتقل یا پاک نشدند. clipboard ابزار خالی بود؛ exact clipboard پذیرفته نیست، فقط toast کپی و URL صحیح مشاهده شدند. QA3105 خارج allowlist اصلی بود و محدودیت Origin ضعیف نشد. هر۱۲۹ جدول پس از بررسی اصلی دقیقاً برابر بود. `variant-url47-main-release.json`، `variant-url-main-browser.json` و `variant-url-main-sql-preservation.json` مرجع‌اند.

منوی CMS فارسی/انگلیسی اکنون لینک «کاتالوگ بازار / Market catalogue» دارد؛ header، footer و ویرایشگر پنل آن را از SQL می‌خوانند. ابزار Development-only با dry-run پیش‌فرض و `--apply` صریح، draft منتشرنشده/منوی پُر/سند غایب را متوقف و لینک تو در تو/عنوان سفارشی را حفظ می‌کند؛ تکرار بی‌نوشتن است.۸۶۶ واحد/کل۵۶۹ SQL واقعی (دو تازه)، دو پاسخ خام تولیدی، مرورگر GUID مستقل و cleanup پذیرفته‌اند. بکاپ تازه۱۸٬۹۹۳٬۱۵۲بایت COPY_ONLY/CHECKSUM/VERIFYONLY و کلید خصوصی گرفته شد؛ فقط دو ردیف site و دو revision تازه CMS ایجاد شدند. revision هر زبان3، auth1، تمام۱۲۷ جدول دیگر و تمام فیلدهای قبلی CMS/ترتیب قدیمی دقیقاً محفوظ‌اند. پس از۲۲۵ HTTP هر۱۲۹ جدول برابرند. schema/API HTTP/پنل/build فروشگاه تغییر نکردند؛ API فقط برای backup/CMS متوقف و همان artifact۴۷ باPID جدید بالا آمد.

مرجع `artifacts/checks/market-navigation47-main-release.json`، `main-pre-market-navigation-release-backup.json` و [MARKET-NAVIGATION](MARKET-NAVIGATION.md). ابزار CLI ثابت در `tmp/api-runtime-market-navigation47-afd022d81bca43d2a36d7c491e27f05d` با۱۳ DLL یکسان unit/SQL/harness محفوظ است؛ HTTP همچنان artifact هلو۴۷ است. دادهٔ بازار اصلی همان سه نمونهٔ مشخص قبلی است؛ نمونهٔ QA کپی نشد. QA/کلید/credential خودش حذف، تب‌های44/45 و پورت‌هایش بسته‌اند. desktop۱۲۸۰ پذیرفته، mobile باز است؛ Redis running دست‌نخورده.

## کار جاری: ارسال سفارش، سورس۴۸ منتشرنشده

[ORDER-FULFILLMENT](ORDER-FULFILLMENT.md) طراحی مرحله‌های packed/dispatched/delivered را ثبت می‌کند. قرارداد خصوصی Inventory و reader قفل‌شدهٔ رزرو/خطوط/دستگاه، سرویس Sales با نسخه/actor+UUID/hash/رسید تاریخی، root audit و endpointهای private مدیر/مالک نوشته شدند. فقط Paid/Allocated و تخصیص کامل دستگاه مجازند؛ هیچ endpoint پرداخت مصنوعی وجود ندارد. خروج از Stock در dispatch یک‌بار و ثبت تحویل مشتری بدون تکرار ledger است. دادهٔ دستگاه برای مشتری پیش از dispatch مخفی است. مدل چهار جدول Sales و migration اولیهٔ منتشرنشده `20261025214810_OrderShipments` (نسخهٔ اولیه در artifacts/checks/order-shipment-unpublished-original-migration بایگانی و نسخهٔ پاکِ دارای revision دوباره scaffold شد؛ نام جاری در Migrations/Sales است) با Down guard حافظ تاریخچه ساخته شد؛ schema اصلی همچنان۴۷/۱۲۹ جدول است.

دو build اولیه API بدون هشدار موفق‌اند. اولین۴ SQL واقعی برای معمولی/serial/IMEI، حفظ Stock در pack، خروج یک‌بار، تاریخچه، حریم مالک و منع Paid فرضی/تأیید غایب/نسخه قدیمی/زمان آینده موفق‌اند؛ build SQL بدون هشدار است. این پذیرش کل برش نیست. SerialReceiptUnit نام اشتباه type در تست بود و به SerialUnitData واقعی اصلاح شد؛ کد محصول برای آن تغییر نکرد؛ نوع بازگشت fixture نیز صریح شد تا inference کامپایلر حل شود. ۹ SQL معمولی/رقابت/rollback ledger→header/receipt/audit/رسید خراب و سپس SQL snapshot2 هم موفق‌اند (مجموع۱۰).۱۰ wire خام و۳ بدنهٔ واقعی فرمان با decoder تولیدی پیش از افزودن revision پذیرفته شدند و به‌عنوان شواهد تاریخی حفظ‌اند؛ wire artifact نهایی باید جدا تولید شود. تغییر mode خالی پس از خروج نباید تحویل را بشکند؛ reader status مستقل اضافه شد. بازبینی دوبارهٔ بسته با revision/خطوط و دستگاه‌های append-only در حال تکمیل است. رابط پنل/فروشگاه و journal و BFF GET-only نوشته شده، typecheck پنل و۳۲۵ تست قبلی فروشگاه موفق‌اند؛ آزمون‌های تازه/Production/migration/wire نهایی و مرورگر/cleanup/backup/انتشار۴۸ بازند. fixture Paid فقط در SaymanTest ساخته می‌شود؛ provider اصلی همچنان خاموش است.

## کار بعدی برای D34 — ادامه بده

1. عملیات فروش: آماده‌سازی، خروج از انبار و ارسال/تحویل واقعی سفارش، پیوند دستگاه‌های تخصیص‌یافته و تاریخچهٔ قابل پیگیری. فقط سفارش واقعاً Paid و رزرو Allocated مجاز باشد؛ مسیر پرداخت/درگاه هنوز ساخته/متصل کامل نیست و این وضعیت نباید با فرمان ادمین ساختگی فعال شود. fixture پرداخت‌شده فقط در دیتابیس QA مشخص مجاز است. سپس مرجوعی/بازپرداخت، پروندهٔ چک/مدارک، CMS پیشرفته، support/notification و کل PDF طبق PLAN.
2. mobile/accessibility/SEO/performance/CI/native Linux/load/offsite backup و معیار۱۲گانه بازند؛ scaffold کامل نیست. D14 انتشار محلی/API/admin مجاز؛ D16 provider نداریم؛ D21 سیاست نمونه فقط QA؛ D32 Redis روشن؛ D33 پاک‌سازی۱٫۶۷GiB؛ D34 کل پروژه. هزینه/مالیات/شرایط واقعی گارانتی و مرجوعی و درصد چک نامعلوم‌اند. داده/نظر خارجی و هلو زنده قرارداد معتبر می‌خواهند؛ scrape/جعل نشوند.

سوابق۴۶/۴۷ و شواهد هر برش در [آرشیو](archive/STATUS-before-market-navigation47-release.md) و اسناد هر قابلیت محفوظ‌اند.
