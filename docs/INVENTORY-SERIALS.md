# سریال و IMEI انبار

وضعیت 2026-10-23: بک‌اند و پنل mode/receipt/retire/list/history در سورس آماده‌اند؛۴۳۱ واحد،۵۲ تست پنل (۴۴ contract +۸ نشست)،۳ wire و۱۸ UI نمونه موفق‌اند. **۱۲۹ SQL واقعی شامل۹ سریال موفق شدند** و D20 توقف D19 را رفع کرد. ۱۷ QA محدود مرورگر متصل با حساب/MFA و دیتابیس مستقل خودش موفق شده؛ main۱۷/source۲۱ و۱۸–۲۱ روی اصلی اعمال نشده‌اند. Sales/ارسال واقعی و باقی PDF هنوز کامل نیستند.

## مرجع و تصمیم فنی

PDF بخش۴٫۲، SerialNumber با VariantId، Serial/IMEI، OrderItemId و WarrantyUntil می‌خواهد؛ بخش۸ ثبت دستگاه/گارانتی حساب، یادآوری و QR را هم می‌خواهد. متن خوانده‌شده tmp/pdfs/source.txt خطوط۹۵–۹۹ و۲۱۷–۲۱۹ است؛ PDF اصلی ریشه محفوظ است. ثبت مالک/QR/یادآوری و استعلام واقعی هنوز جدا باقی‌اند.

A28: رهگیری none/serial/imei برای هر تنوع و پیش‌فرض none برای دادهٔ فعلی است. تغییر mode فقط در ماندهٔ صفر، بدون رزرو و بدون واحد available/assigned انجام می‌شود؛ تغییر همان mode نسخه را می‌چرخاند. از موجودی عددی قبلی هیچ نگاشت سریال حدس زده نمی‌شود و کاربر به اصلاح ساختگی موجودی برای فعال‌سازی هدایت نشود؛ تبدیل ماندهٔ قدیمی با نگاشت صریح، گردش جدا و هنوز پیاده نشده است. ظرفیت هر فرمان۱۰۰ واحد و هر صفحه۵۰ است؛ سقف کل انبار نیست. هندسهٔ فعلی Stock بر VariantId حفظ شده؛ WarehouseId/چندانباری PDF هنوز کامل نیست و INV-01 کامل محسوب نمی‌شود.

IMEI روی برچسب دستگاه۱۵رقم با Luhn است. مرجع رسمی [GSMA TS.06](https://www.gsma.com/newsroom/wp-content/uploads/TS.06-v25.0-IMEI-Allocation-and-Approval-Process.pdf) بخش۵٫۱٫۵ و [GSMA device identifier](https://open-gateway.gsma.com/docs/device-identifier/api-reference) است. این فقط اعتبارسنجی ورود است؛ استعلام اصالت/سرقت/رجیستری یا تخصیص TAC نیست. IMEISV۱۶رقمی در این فیلد پذیرفته نمی‌شود. NFKC، ارقام فارسی/عربی، trim و حروف ASCII بزرگ canonical می‌شوند؛ سریال حداکثر۱۰۰ نویسهٔ ASCII حرف/رقم و . _ / - دارد و جداکننده‌ها حذف نمی‌شوند.

## داده و دریافت/خروج

Stock.TrackingMode همراه همان rowversion است. SerialUnits یک ردیف برای هر دستگاه دارد؛ IMEI دوم alias همان واحد است و دو دستگاه شمرده نمی‌شود. SerialIdentifiers با کلید یکتای سراسری، IMEI را در همهٔ تنوع‌ها یکتا می‌کند؛ سریال در همان تنوع بی‌حساسیت به بزرگی حروف یکتاست. Unit، alias و event FK داخل Inventory و حذف Restrict دارند. شناسهٔ تاریخیِ retired/delivered آزاد نمی‌شود؛ مرجوعی آینده باید همان واحد را به گردش برگرداند، نه واحد تازه با همان IMEI بسازد.

دریافت۱–۱۰۰ واحد، شمارش OnHand، aliasها، رویداد و ledger مثبت را با هم ذخیره می‌کند. mode فعال لازم است؛ digital پذیرفته نمی‌شود. خروج/اسقاط فقط available و با ظرفیت آزاد OnHand-Reserved و نسخهٔ stock/unit مجاز است؛ ledger منفی و رویداد همان تراکنش‌اند. اصلاح عددی معمول برای tracking فعال رد می‌شود. guard قرارداد Inventory در Catalog، تبدیل کالای دارای tracking به دیجیتال را رد می‌کند؛ modules DbContext هم را مصرف نمی‌کنند و root transaction/audit قبلی حفظ است.

فرمان mode/receipt/retire و assignment، UUID مستقل از actor دارد؛ snapshot و hash canonical در SerialCommands با کلید actor/request نگه داشته می‌شوند. ترتیب receipt/picks canonical است؛ درخواست تکراری همان snapshot قبلی را قبل از بررسی نسخهٔ فعلی برمی‌گرداند و side effect تازه ندارد. payload متفاوت با همان کلید409 است. snapshot پاسخ، وضعیت تازهٔ موجودی نیست؛ رابط باید بعد از موفقیت دوباره بخواند. actor/request در همهٔ عملیات سریال مشترک است تا استفادهٔ همان کلید در action یا تنوع دیگر تعارض بدهد. فرمان نوشتن خودکار retry نمی‌شود.

## رزرو، تخصیص و تحویل

رزرو مشتری همچنان تعداد است و تضمین موجودی قبلی را حفظ می‌کند. IStockSerialAssignments فقط قرارداد داخلی است: caller باید سفارش واقعی/پرداخت معتبر و رزرو آن را تأیید کرده باشد. endpoint عمومی/مدیریتی برای ایجاد paid/fulfillment یا دورزدن درگاه اضافه نشده است. fixture SQL مستقیم Allocate را فقط برای تست قرارداد داخلی به کار می‌برد؛ این شاهد verify پرداخت یا سفارش واقعی نیست.

تخصیص در batch۱۰۰، فقط به رزرو Allocated، واحد available همان تنوع و تا تعداد همان line مجاز است. قفل reservation سپس command و stock با قفل‌های موجود مشترک است؛ دو سفارش نمی‌توانند یک واحد را تحویل بگیرند. تحویلِ tracking بدون تعداد کامل سریال‌های assigned همان رزرو رد می‌شود. release واحد را available و مرجع جاری سفارش/گارانتی را خالی می‌کند؛ event مرجع قبلی را نگه می‌دارد. fulfill واحد را delivered می‌کند و مرجع را حفظ می‌کند؛ decrement موجودی، ledger و event هم‌تراکنش‌اند. replay fulfillment اثر تکراری ندارد.

OrderItem فعلی کلید ترکیبی OrderId/VariantId دارد و همین مرجع از رزرو نگه داشته می‌شود؛ FK بین Inventory و Sales اضافه نشده است. WarrantyUntil nullable و فقط مقدار صریح caller به UTC است؛ دوره، شروع خودکار یا تأیید گارانتی فرض نمی‌شود. تغییر واقعی SalesOrder به Fulfilled و ارسال/مرجوعی باید در گردش معتبر Sales با coordinator انجام شود و در این برش endpoint آن ساخته نشده است.

## API فعلی و کار پنل

همگی admin و no-store با access کامل/MFA و policyهای قبلی‌اند:

| مسیر | مجوز / نتیجه |
|---|---|
| GET inventory/variants/{id}/serials?state=all&query=prefix&cursor=... | inventory.read؛ schemaVersion1، صفحه۵۰+seek، Stock و nullable cursor صریح |
| GET .../serials/{unitId}/history?before=... | inventory.read؛ تاریخچه۵۰، Id/nextBefore دهدهی رشته‌ای و بررسی تعلق unit به variant |
| PUT .../{id}/serial-mode | inventory.write؛ mode/version/requestId |
| POST .../{id}/serials | inventory.write؛ units/reason/version/requestId |
| POST .../{id}/serials/{unitId}/retire | inventory.write؛ unitVersion/reason/version/requestId |

cursor صفحه به تنوع، state و عبارت canonical وابسته است. صفحهٔ واحدها یک query محدود است؛ stock قبل/بعد آن بررسی و تغییر به409 تبدیل می‌شود. snapshot مشترک بین صفحات یا history/count ادعا نمی‌شود. nullهای سریال/IMEI دوم/گارانتی/سفارش و version بدون stock در DTO صریح حفظ‌اند. این پاسخ‌ها عمومی یا cacheable نیستند و هیچ‌یک دادهٔ مالی/مبلغ جدید ندارند.

پنل موجودی با lazy modal به قرارداد strict متصل است: فهرست۵۰/پیشوند canonical/وضعیت و history، تنظیم mode با انتخاب صریح روی ماندهٔ خالی، دریافت۱–۱۰۰ خط و خروج available با دلیل/نسخه. IMEI اول، IMEI دوم و سریال اختیاری در هر خط با ویرگول جدا می‌شوند؛ دو alias همان یک دستگاه‌اند. نقش فقط‌خواندنی write نمی‌بیند. مبلغ یا نرخ پیش‌فرض تازه‌ای اضافه نشده است.

نتیجهٔ نامشخص/5xx/408/قطع ارتباط یا200 نامعتبر، snapshot همان UUID/body/version را در حافظه نگه می‌دارد، write تازه و refresh را قفل می‌کند و فقط retry دستی همان تلاش دارد؛ هیچ فرمانی خودکار retry نمی‌شود. 4xx قطعی تلاش را می‌بندد و پیش از write تازه، بازخوانی صریح لازم دارد. پس از پاسخ معتبر، ورودی‌ها پاک و لیست/مانده دوباره دریافت می‌شود؛ snapshot فرمان جای ماندهٔ تازه نیست. بستن/بارگیری مجدد حافظه را پاک می‌کند و هشدار روشن دارد؛ journal دائمی سمت مرورگر نیست. بستن dialog فقط حین pending قفل است.

schemaهای TS حالت/تعلق تنوع/فیلتر/ترتیب شناسه/alias/count/نسخه، nullهای صریح و پاسخ فرمان نسبت به snapshot تلاش را بررسی می‌کنند. تاریخچه long رشته‌ای با مقایسه BigInt می‌ماند. پاسخ خراب فرم فعال یا دادهٔ نمونه نمی‌سازد. جدول روی موبایل در ناحیهٔ scroll داخلی است و تاریخچه هنگام بازشدن focus می‌گیرد.

## شواهد و ریسک‌های باز

- **۴۳۱ Shop.Tests موفق**؛ تمام رگرسیون‌ها، قواعد سریال، SQL translation، مدل/nullable wire/policy. آخرین build صفر warning/error است؛ handler مصنوعی unit جای JWT/MFA مثبت نیست.
- **۴۴ contract پنل موفق**،۱۳ تازه: null/پول یا identity اضافی، counts/نسخه، state/order/warranty، alias/ترتیب/overflow، history بزرگ، format/ارقام/Luhn/دو IMEI، frozen snapshot و پاسخ فرمان. TypeScript و build مستقل Vite موفق‌اند؛ dist اصلی تغییر نکرد.
- **۳ wire ASP.NET→TS**: دو GET واقعی در test host با reader مصنوعی و یک command DTO با HttpJsonOptions واقعی. native serializer/null/long بررسی شد؛ command HTTP/SQL/MFA از این شاهد نتیجه نمی‌شود. `serial-wire/report.json`.
- **۱۸ بررسی UI نمونه**:۵۰+۳ واحد/history، prefix/reset/خالی، read-only، wrong variant، unknown/retry، conflict/fresh، malformed200، mode/دریافت/خروج مصنوعی، IMEI و390px.۴۹ درخواست، هشت write، سه موفقیت فقط در حافظه، صفر Cookie/Authorization و تغییر SQL؛ دو تلاش اول body hash و مسیر یکسان داشتند. console error/warn صفر، screenshot دسکتاپ/موبایل و overflow داخلی ثبت است. fixture/process/tab/control موقت بسته/حذف شدند.
- **۱۲۹ از۱۲۹ SQL واقعی با صفر skip/شکست**؛ main۱۷ حفظ و دیتابیس‌های آزمون پاک شدند.۹ سریال: دریافت/خروج/ledger/alias/history/replay؛ برخورد دو IMEI در تنوع/slot؛ mode روی ماندهٔ پر و digital/count bypass؛ audit rollback؛ تخصیص/release/fulfill/warranty؛ دو سفارش و یک واحد؛ خروج در حضور رزرو؛۵۳ واحد/seek/search/cursor؛ rollback caller و replay. این قرارداد داخلی، verify پرداخت/ارسال واقعی نیست. migration۲۱ فقط روی آزمون اجرا شد؛ database/sqlserver/snapshots/inventory.sql برای اصلی هنوز اعمال نشده است.
- اجرای اول SQL سه شکست قدیمی نمایان کرد: search نام staff/finance اعراب را حذف نمی‌کرد؛ REPLACE صریح U+064B–065F/U+0670 با BIN2 پیش از مقایسهٔ CI_AI اضافه و Credit نیز آزموده شد. این نرمال‌سازی SQL تمام NFKC/همهٔ markهای Unicode نیست. [Microsoft REPLACE](https://learn.microsoft.com/en-us/sql/t-sql/functions/replace-transact-sql?view=sql-server-ver16) وابستگی مقایسه به collation را توضیح می‌دهد؛ SELECT literal محلی هم نشان داد CI_AI به‌تنهایی اعراب نمونه را حذف نمی‌کند. آزمون Published با تنها تنوع غیرفعال نیز ورودی نامعتبر داشت و به Hidden تغییر کرد؛ قانون انتشار حفظ شد. اجرای کامل دوم موفق است.

گزارش جاری `artifacts/checks/serial-admin-source.json`، فایل‌های serial-final-*، serial-sql-results/serial-sql-fixed.trx و serial-layout-* هستند. QA مرورگر SQL واقعی با۱۷ بررسی محصول/سریال، history/audit، منع bypass/digital و نمایش قیمت/نام FA/EN موفق شد؛ operations-serial-ui.json مرجع است. UI متصل همهٔ گردش Sales/ارسال/نشانی/کارکنان را نمی‌پذیرد. harness/دیتابیس/credential/keys/تب‌های خودش پاک شدند؛ main۱۷ و Redis خاموش حفظ‌اند. اصلاح تمدید نشست و منوی کم‌ارتفاع با۸ unit و بررسی desktop اضافه شد؛ وقفهٔ طولانی واقعی بعد از اصلاح و mobile متصل هنوز شاهد ندارند. نگاشت صریح ماندهٔ قدیمی/چندانباری، بار/plan و دقت قفل زیر بار، انتقال/مرجوعی، گردش معتبر Sales/ارسال و دستگاه/گارانتی حساب/QR، Linux x64 و backup/restore باقی‌اند. ثبت فیزیکی IMEI رجیستری قانونی نیست؛ هدف PDF فعال و ناتمام است.
