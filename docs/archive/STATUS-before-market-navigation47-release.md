# وضعیت و نقطهٔ ادامه

آخرین به‌روزرسانی: 2026-10-26. **اصلاح دستی موجودی از فایل هلو در اصلی محلی۴۷ منتشر و پذیرفته است؛ کل پروژه/PDF هنوز کامل نیست.** هدف D34 تکمیل همهٔ بخش‌هاست. پایان یک برش، پایان هدف نیست.

## اجرای اصلی محلی۴۷

- API: http://127.0.0.1:5080، PID21112/session24462؛ runtime `tmp/api-runtime-holoo-stock-apply47-253f578fdab84171a719fd9aa1ed74c3`؛ restart: `python3 tmp/holoo-stock-apply47-release.py serve-api`.
- فروشگاه: http://127.0.0.1:3000، PID27655/session87322؛ runtime `tmp/storefront-runtime-variant-url47-2137766931fe4c79a4ee688577c7f041`؛ اصلاح URL تنوع با build تازه `NcvNZSXg_HQa1OMuogYo1` و۳۲۵ تست تازه روی همین schema۴۷ منتشر شد؛۲۲۵ HTTP storefront موفق‌اند. restart: `python3 tmp/serve-variant-url47.py 3000`.
- پنل: http://127.0.0.1:3173، PID21167/session63443؛ runtime از `tmp/admin-runtime-current.json`؛ restart: `node tmp/serve-holoo-stock-apply47-main-admin.mjs`. proxy آزموده‌شده در `tmp/admin-server-source47.mjs` محفوظ است.
- `tmp/{api,storefront,admin}-runtime-current.json` مرجع دقیق مسیر/PID/hash هستند. preview خاموش و API mode فعال است. نسخه۴۶ و وابستگی restart آن محفوظ‌اند؛ writer قدیمی علیه schema۴۷ خودکار اجرا نشود.
- SQL:۴۷ migration/۱۲۹ جدول/۹ schema. فقط دو جدول خالی Inventory.AccountingStockApplications وAccountingStockApplicationLines اضافه شدند.۱۲۶ جدول قدیمی به‌جز history خود Inventory و تمام تعریف‌های قدیمی/schema/viewها دقیقاً محفوظ‌اند؛ پس از HTTP هر۱۲۹ جدول برابرند.
- Stock اصلی101/0/0؛ Orders/Reservations/SourcingRequests/CheckoutSettings/ChargePolicies و دادهٔ هلو/کارکرده صفرند. seed یا سیاست نمونه وارد اصلی نشده است. Redis پارسه طبق D32 running و دست‌نخورده است.
- بکاپ تازه۱۷٬۹۴۴٬۵۷۶بایت COPY_ONLY/CHECKSUM/VERIFYONLY با کپی خصوصی کلید؛ `main-pre47-release-backup.json`. tmp شامل runtime جاری/بازگشت/کلید/بکاپ است و نباید کامل پاک شود.

## پذیرش۴۷

[HOLOO-STOCK-APPLY](HOLOO-STOCK-APPLY.md) قرارداد را ثبت می‌کند. مدیر فقط ردیف‌های معتبر انتخاب‌شده را پس از دو تأیید صریح به ماندهٔ فیزیکی تبدیل می‌کند. رزرو سفارش/تأمین محفوظ‌اند؛ قیمت و محتوا تغییر نمی‌کنند. فایل قدیمی، گردش پس از مشاهده، SKU سریال‌دار/کارکرده، واحد یا نگاشت نامعلوم و نسخهٔ قدیمی مسدودند. header/line/ledger/audit در rootSerializable اتمیک‌اند؛ actor+UUID/hash و رسید تاریخی حتی پس از تغییر موجودی حفظ می‌شوند. این قابلیت اتصال زنده یا نوشتن در هلو نیست؛ قرارداد D30 همچنان نامعلوم است.

۸۶۶ واحد، کل۵۶۷ SQL واقعی (۲۴ هدفمند)،۲۰۸ پنل،۳ proxy شامل تأخیر واقعی۱۳ثانیه، typecheck/build و۶ پاسخ خام SQL با decoder تولیدی و بدنهٔ فرمان واقعی موفق‌اند. بستهٔ immutable۴۷ شامل۱۳ DLL برابر unit/SQL/harness است.

مرورگر دیتابیس GUID مستقل: انتخاب/دو تأیید الزامی، ردیف نامعلوم غیرفعال؛ اصلاح3→6، دو پاسخ200 قطع‌شده، retry با byte/UUID یکسان، ناوبری و GET رسید؛ فایل قبلی مسدود؛ فایل تازه6→2؛ رسید تاریخی3→6 پس از تغییر دوم محفوظ. سه پاسخ واقعی browser با decoder تولیدی پذیرفته‌اند. خواندن عمومی و فروشگاه FA/EN موجودی2 و قیمت769000000ریال را نشان دادند. بازسازی فقط‌خواندنی fingerprint ماندهٔ اولیه ثابت کرد همهٔ ردیف‌های دیگر Stock و تعهدات دقیقاً محفوظ‌اند؛ همهٔ جداول دیگر کاتالوگ/مالی نیز برابرند. QA/کلید/credential خودش حذف، پورت‌ها بسته و تب‌های خود40/41 بسته شدند. عرض واقعی1280/client=scroll1265؛ **mobile پذیرفته نیست**. screenshotهای `holoo-stock-apply-browser-{admin,storefront-fa}.jpg` محفوظ‌اند.

انتشار۴۶→۴۷ پس از بکاپ تازه، CHECKDB،۱۴۶۷ HTTP شامل۷۳۷ درخواست یکتای پوشاننده۱۳۹۵ رکورد قبلی، تمام assetهای قدیم/جدید و401/no-store موفق شد.۱۸۳ asset قدیمی Next و۴۵۳ پنل محفوظ‌اند. فروشگاه همان build۴۴ است؛ مرورگر اصلی بی‌دلیل تکرار نشد، پنل عین artifact در QA پذیرفته شد. مرجع: `artifacts/checks/holoo-stock-apply47-main-release.json` و before/after/post-smoke/public-smoke، browser-acceptance و sql-after.

## کار بعدی برای D34 — ادامه بده

1. اصلاح URL تنوع در کلاینت و حفظ query/hash با build مستقل/۳۲۵ تست/مرورگر تغییر زبان و reload و۲۲۵ HTTP منتشر شد. QA3105 خارج از allowlist اصلی بود؛ cart پذیرش دوباره نشد و allowlist ضعیف نشد. exact clipboard به‌دلیل خروجی خالی ابزار پذیرفته نشد؛ toast کپی دیده شد. مرورگر اصلی3000 نیز حفظ انتخاب FA→EN، query/hash و سبد مهمان بدون خطای اتصال را تأیید کرد؛ انتخاب‌های قبلی مرورگر منتقل نشدند و محفوظ ماندند. variant-url47-main-release وvariant-url-main-browser مرجع‌اند.
2. پیوند بازار هنوز در CMS منوی جاری نیست؛ ابزار CLI فقط Development/dry-run و حفظ draft/published و لینک سفارشی در هر سطح ساخته شد؛ دو SQL هدفمند و build موفق‌اند. رگرسیون کامل و پذیرش مرورگر/backup/انتشار بازند. MARKET-NAVIGATION مرجع است. سپس ارسال/تحویل/مالکیت دستگاه/مرجوعی، پروندهٔ چک/مدارک، CMS پیشرفته، support/notification و کل PDF طبق PLAN.
3. mobile/accessibility/SEO/performance/CI/native Linux/load/offsite backup و معیار۱۲گانه بازند؛ scaffold کامل نیست. D14 انتشار محلی/API/admin مجاز؛ D16 provider نداریم؛ D21 سیاست نمونه فقط QA؛ D32 Redis روشن؛ D33 پاک‌سازی۱٫۶۷GiB؛ D34 کل پروژه. هزینه/مالیات/شرایط واقعی گارانتی و مرجوعی و درصد چک نامعلوم‌اند. داده/نظر خارجی و هلو زنده قرارداد معتبر می‌خواهند؛ scrape/جعل نشوند.

وضعیت۴۶ و برش‌های قبلی در [آرشیو](archive/STATUS-before-holoo-stock-apply47-release.md) و اسناد هر قابلیت محفوظ‌اند.
