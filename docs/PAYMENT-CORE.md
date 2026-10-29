# هستهٔ پرداخت نقدی و مرز تأیید سفارش

هسته و سوابق خصوصی با schema۵۰ محلی پذیرفته و منتشر شده‌اند؛ جریان شبکهٔ درگاه واقعی هنوز پیاده/پذیرفته نیست. D16 ارائه‌دهنده، قرارداد و sandbox ندارد. هیچ gateway فرضی، موفقیت ساختگی یا endpoint «پرداخت‌شده کن» وارد محصول نمی‌شود. ارائه‌دهندهٔ آزمایش فقط در executable آزمون و دیتابیس GUID مستقل قابل ثبت است.

مبلغ از snapshot معتبر سفارش به ریال صحیح خوانده می‌شود؛ مرورگر فقط شناسهٔ سفارش، نسخه و UUID می‌فرستد. قیمت امروز Catalog، مبلغ callback یا ادعای مرورگر مرجع نیستند. Payments مالک attempt، رویدادهای append-only و رسید فرمان است؛ Sales مالک اتصال تاریخی دقیقاً یک پرداخت به سفارش و Inventory مالک Allocate پس از تأیید است. context بین ماژول‌ها مصرف نشود؛ قرارداد داخلی تایپ‌دار و root transaction همان پایگاه لازم است.

مرحلهٔ اول، اثبات معتبر پرداخت و تسویهٔ اتمیک با سفارش است. یک fact داخلی تأییدشده، attempt/provider/account/authority/reference/مبلغ و زمان تأیید سرور را حمل می‌کند. فقط سرویس provider که واقعاً Verify سروری کرده می‌تواند آن را بسازد/اعمال کند؛ مسیر HTTP عمومی برای دریافت این fact وجود ندارد. همان attempt و همان proof پس از انقضا/ارسال، رسید تاریخی می‌دهند. reference پرداخت در provider/account یکتا و attempt به یک سفارش/مالک/مبلغ frozen متصل است. تغییر proof یا استفاده برای سفارش دیگر تعارض است.

سفارش AwaitingPayment و رزرو Activeِ منقضی‌نشده، با همان مبلغ و خطوط تاریخی، در root Serializable به Paid/Allocated تبدیل می‌شوند. OnHand کاهش نمی‌یابد؛ خروج انبار در ارسال۴۸ است. تخصیص serial/IMEI پیش از ارسال جداست. snapshot2 سهم خطوط و دستگاه‌های تأمین را حفظ می‌کند. ثبت Payments، اتصال Sales، تغییر Order/رزرو و رویدادها اتمیک‌اند؛ شکست هر مرحله همه را برمی‌گرداند. قفل مالک canonical همان Order/Cancel/Expiry و سپس attempt/reservation/Stock مرتب است.

موفقیت مالی دیررس، سفارش لغوشده/منقضی، مبلغ ناسازگار یا سفارش از قبل پرداخت‌شده با attempt دیگر، نباید خودکار کالا/رزرو بسازند یا دوباره Paid شوند. نتیجهٔ قابل بررسی مالی ثبت می‌شود و سفارش/انبار تجاری تغییر نمی‌کند. این مسیر refund فرضی نیست؛ بازپرداخت به قرارداد واقعی و سیاست تأییدشده وابسته است. provider pending/timeout نتیجهٔ نامشخص است؛ شبکه داخل transaction SQL منتظر نمی‌ماند. initiation/verification/reconcile مراحل پایدار و receipt/retry همان body دارند.

پیش از exposure جریان پرداخت، initiation پایدار با idempotency provider، timeout/recovery و verify واقعی باید پیاده و در sandbox همان vendor پذیرفته شود. callback signature/فیلد/URL حدس زده نشود. registry خالی یعنی unavailable؛ کاربر همچنان canPay=false می‌بیند. پنل مالی فقط خواندن وضعیت/پیگیری مجاز، MFA و audit دارد؛ دکمهٔ تبدیل دستی Paid ساخته نمی‌شود. مدارک کارت/کلید/credential و payload حساس در log یا پاسخ عمومی نیستند.

پذیرش: money بیش از2^53، ordinary/snapshot2، expiry/cancel/verify race، reference تکراری، proof متفاوت، rollback پس از Allocate و receipt، عدم تغییر OnHand، replay پس از ارسال، hide demo در Production، مالک/نقش، private no-store، migration افزایشی/Down حافظ تاریخچه، rawwire، مرورگر QA، cleanup و backup/حفظ اصلی. sandbox/live درگاه بدون قرارداد همچنان مسدود است؛ قبولی آزمون مصنوعی به‌معنای اتصال درگاه نیست.


## پیاده‌سازی و انتشار محلی۵۰

لینک Sales migration `20261025231229_CashOrderPaymentLinks` و ledger سه‌جدولی Payments `20261025231645_CashPaymentAttempts` افزایشی‌اند؛ اصلی اکنون۵۰migration/۱۳۷جدول است و هر چهار جدول تازه خالی‌اند. جدول موفقیت Sales و رویداد/verificationهای Payments append-only با همهٔ SaveChangesguard هستند. authority به AttemptId و purpose اختصاصی key ring رمز می‌شود؛ raw authority/reference در DTO عمومی نیستند. Hash دقیق UTF8 reference/authority case-sensitive است؛ canonicalization اختصاصی vendor حدس زده نمی‌شود. Provider/account فقط شناسهٔ تنظیمات canonical هستند، کلید اتصال نیستند.

آماده‌سازی با binding صریح method→provider/account، registry خالی پیش‌فرض، UUID/body پایدار، نسخه/مبلغ/fingerprint سروری، root Payments/Sales/Inventory و قفل مالک مشترک انجام می‌شود. attemptدوم تا تعیین تکلیف اول ساخته نمی‌شود؛ timeout آینده شکست فرض نمی‌شود. آماده‌سازی هیچ network یا Paid ثبت نمی‌کند. فعلاً endpoint جدیدی برای آن وجود ندارد.

سرویس ApplyServerVerification فقط فاز SQL است؛ نتیجه باید ابتدا با adapter واقعی خارج transaction تأیید شده باشد، نه از بدنهٔ HTTP مشتری. مقدار/authority/reference و attempt ثابت بررسی، سپس paid/allocated و لینک/verification/event اتمیک ثبت می‌شوند. replay رسید تاریخی قبل از state جاری، duplicateReference به review، rollback پس از SalesSave و عدم کاهش OnHand پوشش داده شده‌اند. initiationlease، فراخوانی واقعیVerify/Recovery، callbackقراردادvendor، APIشروع‌پرداخت/رابطدرگاه/پذیرش کامل و sandbox هنوز لازم‌اند؛ این کد به‌معنای اتصال درگاه نیست.


## پذیرش هسته و رابط خصوصی

۸۸۴واحد/۶۲۴SQL واقعی،۳۴۱فروشگاه/۲۱۲پنل/۳proxy و۶wireSQL+۲۱wireمرورگر با decoderمحصول موفق‌اند. GUIDQA سه نمونهٔ صریح pending/verified/review،moneyبیشاز2^53/اختلاف۱ریال را از مرز واقعی تسویه ساخت؛ gatewayفقط در executableآزمون بود و networkصفر. مرورگرFAEN/refresh/ناوبری/فیلتر و مجوزها پذیرفته،۱۲۶جدول غیرIdentity عینbaseline و QA/کلید/credential/tabها پاک‌اند؛ عرض۱۲۸۰،mobileپذیرفته‌نیست. متنawaiting دریافت احتمالی وجه را نفی نمی‌کند و adminشناسه‌ها را جدا نمایش می‌دهد.

پس از بکاپ COPY_ONLY/CHECKSUM/VERIFYONLY، دوmigration/چهارجدول خالی افزوده شد؛۱۳۱جدول قدیمی به‌جزSales/PaymentsEFhistory و همهschema/viewها حفظ‌اند.۸۴۸HTTP وassetهایقدیمی/جدید، سپس برابری۱۳۷جدول پذیرفته‌اند. `payment-core50-main-release.json`/`payment-core50-source-acceptance.json`/`payment-core-browser-acceptance.json` شواهدند؛ API5080/Next3000/admin3173 وdescriptorهایcurrentمرجع‌اند. provider/configنمونه یاQApolicy وارد اصلی نشده‌اند؛ این پذیرش، اتصالدرگاه/شروعپرداخت/تکمیلکلPDF نیست.
