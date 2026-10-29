# ارسال پرونده برای بررسی انسانی — هستهٔ پذیرفتهٔ۵۸

ادامهٔ CREDIT-01 پس اصلی۵۷. این برش submit صریح، snapshot تغییرناپذیر همان رضایت و فایل‌های جاری، صف خواندن خصوصی بازبین و انصراف از درخواست بررسی را اضافه می‌کند. تأیید/رد اعتبار، تصمیم انسانی، checkout چکی و سررسید مرحله‌های بعدند؛ Submitted تأیید اعتبار یا سفارش نیست.

مشتری باید Draft خودش، نسخهٔ پرونده/شرایط، شناسهٔ رضایت و revision و خواست صریح ارسال را ارائه کند. طرح باید فعال و همان نسخهٔ snapshot پیش‌نویس باشد؛ شرایط و رضایت باید جاری باشند. هر تعریف required باید فایل جاریِ همان consent/revision/key با MIME/اندازهٔ معتبر داشته باشد. فایل اختیاری قبلی به رضایت تازه منتقل نمی‌شود. فقط انتخاب‌های فعلی همان رضایت snapshot می‌شوند؛ تغییر فایل یا رضایت، نسخهٔ پرونده را عوض می‌کند و درخواست قدیمی رد می‌شود.

اگر هیچ فایلی لازم/انتخاب نشده باشد و مدیر صریحاً شرایطی با مدارک اختیاری یا صفر مدرک منتشر کرده باشد، نبود storage، شرط تجاری تازه‌ای برای اجبار مدرک نمی‌سازد. اگر فایلی در ارسال دخیل باشد، storage/scanner معتبر و metadata متصل Files لازم است. هیچ متن حقوقی، مدرک هویتی پیش‌فرض یا سیاست مالی از طرف عامل ساخته نمی‌شود.

Credit مالک Submissions/SubmissionDocuments/SubmissionCommands است. FKها submission را به همان application/consent/revision و هر attachment را به همان key و پرونده مقید می‌کنند. یادداشت اختیاری و رسیدها purpose مجزا و رمز دارند؛ رضایت/طرح/file facts از رکوردهای immutable و hash متادیتا خوانده می‌شوند، نه نسخهٔ تازه. root Serializable با قفل شرایط سپس فرمان پرونده و Identity/Credit/Files، snapshot/State=Submitted/currentSubmission/event/receipt/audit را اتمیک می‌کند. I/O object/scanner داخل SQL انجام نمی‌شود.

Submitted قابل تغییر مدرک/رضایت نیست؛ مشتری می‌تواند با نسخهٔ دقیق و همان فرمان cancel از بررسی منصرف شود، event Withdrawn و سابقهٔ immutable محفوظ می‌ماند. صف staff/MFA/credit.read و جزئیات فقط read است؛ در این برش تصمیم اعتبار یا سفارش نمی‌سازد. سقف۲۰ پروندهٔ باز Draft+Submitted و۲۰snapshot در پرونده فنی‌اند، نه سیاست اعتبار.

قرارداد legacy detail همچنان canSubmit=false دارد؛ قابلیت ارسال از endpoint مستقل با blockers واقعی خوانده می‌شود. state مشترک Submitted را صریحاً می‌شناسد و UI آن را با Cancelled اشتباه نمی‌گیرد. receiptهای تاریخی create/cancel/consent/file تغییر نمی‌کنند. UI/BFF دوزبانه، private/no-store/noindex، DTO strict، money رشتهٔ ریال و journal فقط RAM/مقید به حساب است. ارسال ناشناخته با GET receipt و retry همان UUID/body بازیابی می‌شود.

پذیرش لازم: model/immutability/DP، SQL مالک/نقش/MFA/required و optional/currentfiles/غیرفعال‌شدن طرح یا شرایط/نسخه/همزمانی/cancel/auditrollback/replay/FK، decoder/BFF/journal، مرورگر مشتری/صف بازبین/withdraw/lost-response/FAEN/mobile و privacy، cleanup/backup/حفظداده/انتشار محلی. اصلی محلی۵۸ پذیرفته و منتشر است؛ STATUS و credit-submission58-main-release.json حدود شواهد را ثبت می‌کنند. تصمیم انسانی و checkout چکی هنوز بازند.

پذیرش:۹۷۶unit/۶۷۹SQL/۴۲۰storefront/۲۱۴admin/۱۱proxy؛۱۱SQLwire/۱۱۳browserwire،۵فرمان/۱قطعپاسخ→۱رسید/۰duplicate و QAcleanup/backup/۱۲۸۶HTTPمحلی. اصلاح نهایی فقط متن/زبان رضایت بود؛ API/proxy برابرند و finalwrite retest ادعا نمی‌شود.

ادامهٔ پذیرفته در اصلی۵۹: submit/withdraw۵۸ و بررسی انسانیReturn/resubmit/Approve/Decline۵۹ تکمیل‌اند؛ CREDIT-SUBMISSION/CREDIT-REVIEW/STATUS آخرینمرجع‌اند و محدودیت‌های قدیمی این سند تاریخی‌اند. Files اصلیDisabled؛ اتصالبهquote/checkout وچرخهٔCREDIT-02 همچنانبازاست.
