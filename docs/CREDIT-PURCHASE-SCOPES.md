# مجوز استفادهٔ تأیید در یک خرید — برش۶۰ در ساخت

ادامهٔ۵۹ و مقدمهٔ اتصال quote/checkout چکی؛ هنوز پذیرفته یا منتشر نیست. main59 frozen فعال است. تأیید بررسیِ۵۹ به‌تنهایی معنیِ سقف مصرف در سفارش یا مجوز خرید نداشت؛ هیچ approval قدیمی خودکار قابل مصرف نمی‌شود.

بازبین staff/MFA/credit.write باید برای همان پروندهٔ Approved و review/version جاری صریحاً مجوز استفادهٔ یک خرید بسازد. مبلغ و انقضا عین approval هستند و در این فرمان قابل افزایش/تغییر نیستند. **مبنای سقف صریح و بدون default:** PayableTotalRial یعنی جمع کل تعهد خرید شامل پیش‌پرداخت/چک/هزینه‌های سروری؛ InstallmentsTotalRial یعنی مجموع مبلغ چک‌ها شامل افزوده و بدون پیش‌پرداخت. این انتخاب، معنای مقایسهٔ فنی مبلغ است؛ درصد، هزینه، مالیات یا شرط حقوقی واقعی را عامل نمی‌سازد. ارقام از review و قیمت/هزینه از quote سرور می‌آیند؛ درخواست مشتری قیمت کالا نیست.

Grant immutable و حداکثر یک‌بار برایهرreview، با snapshot مبلغ/انقضا/مبنای منتخب/طرح/پرونده/submission است. ابطال مصرف‌نشده رکورد immutable مستقل دارد؛ grant حذف/بازنویسی نمی‌شود. مشتری صاحب پرونده یا staff دارای write می‌تواند صریحاً مجوز مصرف‌نشده را با نسخهٔ دقیق باطل کند؛ دلیل و زبان ابطال و receipt/audit خصوصی‌اند. انقضا در read از ساعت سرور محاسبه می‌شود و GET داده نمی‌نویسد. journal فقط RAM، فرمان actor/UUID/body ثابت و unknown→receipt/retry است.

Case pointer/rowversion/event، grant/revocation/command/receipt/audit در root Serializable و gate موجود پرونده اتمیک‌اند؛ rolegrant یا provider اصلی فعال نمی‌شود. طرح باید فعال و همان نسخهٔ snapshot باشد. receipt تاریخی حتی پس ابطال/انقضا حقیقت همان فرمان است و قابلیت جاری مصرف از read مستقل می‌آید.

خروجی قرارداد ماژول برای quote فقط شناسه‌ها، owner-bound version، مبنا، مبلغ ریالی، انقضا و snapshot طرح است؛ یادداشت/مدرک شخصی به Sales منتقل نمی‌شود. این برش هنوز رزرو موجودی، مصرف بودجه، order یا پرداخت نمی‌سازد. مرحلهٔ بعد باید قیمت/روش/طرح/موجودی/هزینهٔ جاری و همین scope/expiry/version را در quote و سپس transaction ثبت سفارش دوباره بررسی کند؛ claim یک‌بارمصرف و race ابطال/checkout پیش‌نیاز فعال‌کردن سفارش چکی است. تا آن مرحله canPlaceOrder/canPay چکی false می‌مانند.

پذیرش لازم: SQLواقعی grant/revoke/expiry/مالک/نقش/MFA/ریال بزرگ/planchange/replay/همزمانی/auditrollback/FK/guardedDown، قرارداد/BFF/journal و مرورگر ساختگی، cleanup/backup/حفظداده/ارتقای محلی. عدد یا تصمیم واقعی دربارهٔ شخص در QA ساخته نمی‌شود.

## پذیرش و انتشار۶۰ — 2026-10-27

طراحی بالا با API/SQL/رابطFAEN/مرورگر و ارتقای محلی پذیرفته شد؛ STATUS و A61 شواهد/محدودیت‌ها را ثبت می‌کنند. ۹۸۳unit/۶۸۹SQL/۴۳۴storefront/۲۱۴admin/۱۳proxy،۱۶SQLwire/۳۱۶browserwire/۱۳فرمان/۱قطعGrant→۱رسید/۰duplicate؛۱۴۸جدولغیرمجازQAexact و۱۳۸۳HTTPمحلی. CurrentScope pointer CHECK به Approved/currentReview/currentSubmission نیاز دارد، ابطال حتیclockثابتrowversionپروندهرا می‌چرخاند. فرم فعالdesktopoverflow باCSSمحدود رفع و رویfinal دوباره آزموده شد. ۲GET429خواندنی درشواهد محفوظ وپسازمحدودیتازUIبازیابی شدند؛ rate-limitتضعیف نشد. اصلیscope/revoke/command وکلپرونده‌هاخالی،FilesDisabled وproviderخاموشاست. ForQuote قراردادowner-boundآماده است ولی consumerquote/order،claimمصرف وracecheckoutهنوز بازند؛canPlaceOrder/canPayهمچنانfalse.
