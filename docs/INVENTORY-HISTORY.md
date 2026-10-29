# تاریخچهٔ گردش فیزیکی انبار

پذیرش جدید 2026-10-23: D20 توقف فضا را رفع کرد؛ **۱۲۹/۱۲۹ SQL واقعی** شامل آزمون‌های این برش موفق شدند. اعداد compile-only و توقف D19 متن زیر تاریخی‌اند؛ QA مرورگر متصل، main migration۱۸–۲۱ و Linux x64/بار هنوز جدا باقی‌اند. وضعیت جاری در [STATUS](STATUS.md) است.

وضعیت 2026-10-23: سورس API و پنل، unit/contract و QA مستقل کامپوننت آماده‌اند؛ اجرای SQL جدید و پذیرش پنل احرازشده هنوز باقی‌اند. نسخهٔ زنده جایگزین نشده است.

قبلاً GET موجودی، تمام Stock و فقط۱۰۰ Movement آخر را می‌داد؛ جدول مرورگر فقط میان همان۱۰۰ مورد جست‌وجو می‌کرد. اکنون پنل برای تاریخچه endpoint سروری جدا دارد و می‌تواند صفحه‌های قدیمی‌تر را دریافت کند. snapshot کاتالوگ و Stock هنوز کامل‌اند؛ این برش ادعای صفحه‌بندی کامل مدیریت را ندارد.

## قرارداد و مالکیت

GET `/api/admin/inventory/movements?variantId=...&direction=all&fromAt=...&toAt=...&cursor=...` فقط با نشست کامل و `inventory.read` مجاز است؛ `mfa_pending` و مجوز نوشتنِ تنها کافی نیستند. InventoryManager و Administrator نقش‌های فعلی دارای این مجوزند. خروجی و خطا no-store هستند؛ endpoint عمومی/PWA یا خروجی CSV اضافه نشده است.

| مقدار | قاعده |
|---|---|
| variantId | اختیاری؛ شناسهٔ ASCII حرف/رقم/خط‌تیره/زیرخط تا۶۴، trim و canonical uppercase مشابه قاعدهٔ شناسهٔ موجودی |
| direction | all، in برای Delta>0 یا out برای Delta<0 |
| fromAt / toAt | DateTimeOffset اختیاری، تبدیل به UTC؛ شروع شامل و پایان انحصاری؛ پایان باید بعد از شروع باشد |
| cursor | opaque و اختیاری، Base64url حداکثر۲۵۶ نویسه؛ کلید قبل از آخرین Id و binding همهٔ فیلترهای نرمال‌شده |
| نتیجه | version1، pageSize=50، items حداکثر۵۰، nextCursor یا null |
| هر رویداد | id رشتهٔ رقم لاتین، variantId، delta، balance، reason، actorId، requestId و at |

`IStockMovementHistory` قرارداد خواندنیِ مالک Inventory است؛ query بدون tracking فقط Movements را با فیلترها، `Id < before`، ترتیب Id نزولی و TOP51 می‌خواند. رکورد۵۱ فقط وجود صفحهٔ بعد را مشخص می‌کند؛ COUNT و OFFSET ندارد. هیچ Catalog/Identity graph یا mutation/رزرو/adjust در این مسیر اجرا نمی‌شود. ترتیب بر اساس شناسه است؛ تاریخ ثبت می‌تواند متفاوت باشد. balance ماندهٔ فیزیکی ثبت‌شده در همان رویداد است و ماندهٔ قابل فروش یا رزرو تاریخی نیست.

cursor فیلترِ تغییرکرده/نامعتبر قبل از اتصال SQL با400 رد می‌شود. binding برای جلوگیری از استفادهٔ اشتباه cursor است؛ امضا، احراز هویت یا مجوز دسترسی نیست. id در DTO و در cursor رشته است و مرورگر برای مقایسه BigInt دارد؛ شناسهٔ بالاتر از محدودهٔ امن Number گرد نمی‌شود. صفحه‌ها snapshot تراکنشی مشترک ندارند؛ رویدادِ با Id بالاتر پس از صفحهٔ اول در ادامهٔ همان cursor دیده نمی‌شود، ولی درج دیرهنگام با Id قدیمی تضمین snapshot ندارد. سنجش plan/index و بار واقعی هنوز باقی است.

GET قدیمی `/api/admin/inventory` سازگار باقی است. پنل جدید `?includeMovements=false` می‌فرستد؛ پاسخ movements خالی و query تاریخچهٔ۱۰۰تایی اجرا نمی‌شود. omission یا true رفتار قبلی را حفظ می‌کند. همهٔ Stock هنوز خوانده می‌شود؛ محدودسازی آن و انتخاب‌گرهای کاتالوگ، کار بعدی مستقل‌اند. schema تغییر نکرد و migration تازه لازم نیست.

## پنل و شواهد

کامپوننت InventoryHistory به جای جدول تاریخچهٔ محلی در Operations نصب شده است. میان‌بر «گردش» هر ردیف موجودی، تنوع همان SKU را انتخاب و cursor/فیلتر را از ابتدا تنظیم می‌کند؛ انتخاب دوبارهٔ همان تنوع پس از پاک‌کردن فیلتر نیز درخواست تازه دارد. فیلتر، قبلی/بعدی، تازه‌سازی از ابتدا، حالت خالی، retry و بازگشت از خطای صفحهٔ بعد دارد. هر apply، clear و refresh از cursor اول و درخواست تازه شروع می‌شود؛ درخواست قبلی با signal قابل لغو و پاسخ‌ها بر اساس کلید فیلتر/صفحه جدا هستند. دادهٔ صفحهٔ ترک‌شده با gcTime=0 از Query cache حذف و نشست در خروج پاک می‌شود؛ PWA/storage اضافه نشده است. schema strict ترتیب نزولی/بی‌تکرار، سقف۵۰، شناسه و تطابق فیلتر را می‌سنجد؛ پاسخ ناسازگار کامل رد می‌شود.

نمایش زمان جدول شمسی است. ورودی datetime-local فعلاً میلادی و بر اساس منطقهٔ دستگاه، با توضیح صریح، سپس تبدیل UTC است؛ picker شمسیِ ورودی هنوز ساخته نشده. دلیل/عامل/درخواست با React escape می‌شوند و جدول موبایل در محفظهٔ خودش افقی پیمایش می‌شود.

- **۱۸ تست تازهٔ بک‌اند، مجموع۲۴۶ موفق**: فیلتر/offset، cursor و binding هر فیلتر، شناسه‌های بزرگ، خطا پیش از SQL، ترجمهٔ TOP/seek و مرز مجوز/MFA؛ پاسخ موفق API در تست از reader صریحِ داخل test assembly می‌آید و شاهد SQL نیست.
- **۵ تست contract پنل موفق**: شناسهٔ bigint، رد مالی/خصوصی/تکرار/ترتیب/تعداد، تطابق فیلتر، query encoding و زمان نامعتبر. `npm run test:admin-contract`؛ TypeScript و build ایزولهٔ پنل نیز موفق‌اند.
- build پنل در `tmp/inventory-history-admin-dist` است؛ entry۴۰۲٫۰۶kB/gzip۱۲۴٫۱۷، Operations۳۲٫۹۰kB؛ dist زنده تغییر نکرد. مدل Inventory بدون تغییر جامانده است؛ API و SqlTests کامپایل شدند.
- **۱۵ بررسی مرورگر روی خود کامپوننت با fixture صریحِ فقط خواندنی**: صفحه‌های۵۰/۵۰/۲۱، قبلی، reset فیلتر، حالت خالی، بازهٔ ساعت تهران/UTC و شمسی، خطای بازه،503/retry، رد schema خصوصی و موبایل۳۹۰×۸۴۴ بدون overflow سند. این صفحه برچسب دادهٔ نمونه/بدون ورود و SQL دارد و در اجرای نخست فقط history و در اجرای دوم InventoryPage بدون مجوز نوشتن mount شد؛ ورود در هر دو وجود ندارد و دکمهٔ اصلاح غیرفعال ماند. console error/warning گزارش‌شده صفر بود؛ هیچ credential، DB یا ورود موفقی ساخته نشد.
- `scripts/serve-inventory-history-layout.py --explicit-readonly-fixture` فقط روی loopback۳۱۷۵/۵۱۸۱ و directory موقت خودش کار می‌کند. processهای خود QA terminal، control و هر دو پوشهٔ موقت حذف، viewport reset و تب‌های۱۶/۱۷ بسته شدند. شمارنده‌های method/path بدون مقدار header در `inventory-history-layout-http.json`؛ UI و تصاویر در `inventory-history-layout-ui.json`، `sayman-inventory-history-{desktop,mobile}.jpg` هستند.

دو SQL جدید برای۱۲۱ رویداد با زمان‌های تکراری، درج بین صفحه‌ها و عدم تغییر Stock/rowversion، مرز تاریخ/جهت/تنوع، نقش InventoryManager/ContentManager با MFA واقعی موقت و سازگاری snapshot قدیمی نوشته و **فقط compile شده‌اند**. شاهد SQL پیشین۵۹ است؛ چهار سفارش، دو آفلاین، دو sitemap، دو history، دو stock page و دو admin products تازه، اجرای بعدی را به۷۳ می‌رسانند؛ discovery بدون اجرا۷۳ مورد را تأیید کرد، ولی۷۳ هنوز اجرا نشده است.

طبق D19 تا اعلام پایان آزادسازی فضا SQL/Docker تازه اجرا نشود. سپس SQL۷۳، QA کامل پنل با حساب موقت/MFA و SQL ایزوله، plan/بار، migration۱۸ و build/update/smoke اصلی طبق STATUS انجام شوند. parseh-chat-redis خاموش و providerها غیرفعال بمانند. این برش پایان Inventory، سریال/IMEI یا تحویل پروژه نیست.

به‌روزرسانی: پنل جاری دیگر snapshot Stock را نمی‌خواند؛ صفحه‌بندی و شمارنده‌ها در [INVENTORY-PAGING.md](INVENTORY-PAGING.md) هستند. رفتار includeMovements=false و QA۱۵ این سند متعلق به برش تاریخچه است؛ GET قدیمی همچنان برای سازگاری حفظ شده است.

اصلاح پسین قرارداد در ADMIN-PRODUCTS: serializer واقعی ASP.NET null را به‌طور پیش‌فرض حذف می‌کند؛ nextCursor نهایی و version تنوع بدون Stock صریحاً null می‌مانند. تست‌های HTTP native و۷ بررسی schema تولید TypeScript این شکل wire را تأیید کردند؛ تست source جای اجرای SQL/پنل واقعی نیست. مرجع [ADMIN-PRODUCTS.md](ADMIN-PRODUCTS.md).

نقطهٔ ادامهٔ فعلی پس از برش STAFF-ADMINISTRATION: هدف SQL۸۴ با۲۵ مورد تازهٔ اجرا‌نشده است؛ شش مورد کارکنان به مجموعه افزوده شده و migration۱۹ Identity نیز کنار۱۸ Sales قبل از runtime تازه لازم است. اعداد discovery بالای این سند شاهد زمان همان برش‌اند؛ دستور اجرای جاری در [STATUS.md](STATUS.md) و [MFA-RECOVERY.md](MFA-RECOVERY.md) دنبال شود. تا اعلام مالک دربارهٔ فضا SQL/Docker تازه اجرا نشود.
