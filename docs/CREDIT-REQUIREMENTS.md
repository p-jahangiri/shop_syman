# شرایط و رضایت نسخه‌دار خرید چکی — اصلی۵۶ پذیرفته

اصلی۵۶ پیش‌نویس و شرایط/رضایت چک را دارد؛ این سند ادامهٔ CREDIT-01 است، نه اعلام تکمیل مدارک/ارسال/بررسی/سفارش. هیچ متن حقوقی، مدرک اجباری، درصد یا تعهد واقعی از طرف عامل ساخته و در اصلی منتشر نمی‌شود. مدیر متن و تعاریف واقعی را در پنل وارد می‌کند؛ پیش‌فرض اصلی فاقد شرایط است. نمونهٔ غیرالزام‌آور فقط در SQL موقت آزمون استفاده می‌شود.

Credit مالک یک head دارای rowversion و revisionهای تغییرناپذیر است. هر انتشار، revision تازه و تعریف رابطه‌ای مدارک همان revision را می‌سازد: کلید پایدار، نام/راهنمای FA/EN، ترتیب، required، MIMEهای مجاز و سقف بایت. انواع فنی PDF/JPEG/PNG/WebP و حداکثر۸MiB/۱۲تعریف سقف‌اند؛ مدرک هویتی پیش‌فرض یا الزام تجاری خودکار وجود ندارد. تاریخچه فقط خلاصهٔ۵۰تایی seek می‌دهد و متن کامل از مسیر تک‌نسخه خوانده می‌شود. انتشار مجدد متن تاریخی نیز revision تازه می‌سازد؛ سابقه حذف/بازنویسی نمی‌شود.

پیکربندی شرایط staff/MFA و finance.read/write می‌خواهد. این مجوز به پروندهٔ خصوصی دسترسی نمی‌دهد. CreditReviewer با credit.read/write پرونده را می‌بیند اما بدون finance.read/write شرایط منتشر نمی‌کند. مشتری فقط در Draft متعلق به خودش، با تأیید صریح، نسخهٔ پرونده، شناسه و نسخهٔ جاری شرایط و زبان انتخابی رضایت می‌دهد. رضایت سفارش یا تأیید اعتبار نیست. شرایط غیرفعال، نسخهٔ کهنه، رضایت به همان revision با UUID تازه و پروندهٔ لغوشده رد می‌شوند؛ retry همان UUID رسید تاریخی را می‌خواند، حتی پس تغییر شرایط یا لغو پرونده.

شش جدول RequirementsHead/RequirementsRevisions/RequirementDocuments/RequirementsPublishCommands/RequirementsConsents/RequirementsConsentCommands و CurrentConsentId nullable در Applications افزایشی‌اند. FK مرکب consentId+applicationId مانع اشارهٔ پرونده به رضایت پروندهٔ دیگر است. رضایت، revision و زبان و hash متن ثابت را نگه می‌دارد؛ متن با FK به revision تغییرناپذیر و تاریخچهٔ انتشار حفظ می‌شود. receiptهای خصوصی Data Protection با purpose مجزا و actor+UUID هستند. consent، اشارهٔ جاری پرونده، event و audit در root Serializable ثبت می‌شوند؛ publish نیز head/revision/docs/receipt/audit اتمیک است. قفل شرایط پیش از قفل مشترک create/cancel پرونده گرفته می‌شود.

متن در رابط plain text است. هر دو زبان، label رضایت و تعریف مدارک صریح و bounded‌اند؛ MIME دلخواه/HTML upload/SVG مجاز نیست. head و سابقه حذف نمی‌شوند. Down پیش از هر تغییر schema، هر سابقهٔ جدید یا قدیمی پرونده را رد می‌کند؛ downgrade نباید ابتدا schema جدید خالی را حذف و سپس در migration قبلی روی history متوقف شود.

فرم پنل نسخهٔ پایه را در حافظه نگه می‌دارد؛ refresh متادیتا تغییرات فرم را به نسخهٔ جدید متصل نمی‌کند. استفاده از متن جاری یا تاریخی در فرم صریح است. journal ناشناخته UUID/بدنه/متن اصلی را فقط در RAM نگه می‌دارد؛ GET receipt و retry همان ورودی، بدون تغییر خودکار شرایط دارند. خروج معتبر journal و دادهٔ خصوصی را پاک می‌کند؛ حفظ RAM پس full reload ادعا نمی‌شود. مشتری متن دقیق نسخه و مدارک را به FA/EN می‌بیند؛ پس تغییر نسخه، رضایت قبلی و متن آن محفوظ و تأیید تازه لازم است.

مرزها: API/BFF/پنل private/no-store/noindex، bearer بدون cookie، ورودی consent۸KiB و انتشار۴۸KiB، خروجی۲۵۶KiB. اعتبارسنجی دامنه بودجهٔ متن canonical محدودتر دارد. Files اصلی همچنان Disabled است؛ تعریف مدرک با آپلود امن مدرک یکی نیست. اتصال فایل به پرونده+revision+کلید مدرک، submit، بررسی دستی و checkout/سررسید بعد از این پذیرش ادامه دارند.

پذیرش:۹۶۸واحد/۶۶۷SQL واقعی/۴۰۰فروشگاه/۲۱۴پنل/۹proxy،۱۰SQLwire/۶۱browserwire و۶فرمان، دو قطع پاسخ موفق و بازیابی رسید بدون mutation تکراری؛ responsive۳۹۰×۸۴۴ برای این UI پذیرفته و دستگاه فیزیکی/کل موبایل پروژه باز است. QA، کلیدها و credentialها جمع‌اند. پس backup معتبر و حفظ داده، migration روی اصلی اعمال و۱۱۸۸HTTP/حفظ۱۵۶جدول پسHTTP موفق شد؛ شرایط و رضایت اصلی خالی‌اند. `credit-requirements56-source-acceptance.json` و `credit-requirements56-main-release.json` در artifacts/checks و STATUS مرجع دقیق‌اند. اتصال مدارک خصوصی، submit، بررسی و سفارش هنوز تکمیل نشده‌اند.


اصلی۵۷ هستهٔ مدارک خصوصی این تعاریف را اضافه کرده است؛ CREDIT-DOCUMENTS/STATUS مرجع‌اند. فایل قبلی به رضایت تازه منتقل نمی‌شود و اصل شرایط/رضایت immutable تغییر نکرده است.

ادامهٔ پذیرفته در اصلی۵۹: submit/withdraw۵۸ و بررسی انسانیReturn/resubmit/Approve/Decline۵۹ تکمیل‌اند؛ CREDIT-SUBMISSION/CREDIT-REVIEW/STATUS آخرینمرجع‌اند و محدودیت‌های قدیمی این سند تاریخی‌اند. Files اصلیDisabled؛ اتصالبهquote/checkout وچرخهٔCREDIT-02 همچنانبازاست.
