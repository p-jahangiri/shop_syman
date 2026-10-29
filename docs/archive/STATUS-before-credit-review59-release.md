# وضعیت و نقطهٔ ادامه

آخرین به‌روزرسانی: 2026-10-27. **اصلی محلی۵۸؛ ارسال صریح پروندهٔ چکی، snapshot خصوصی، صف خواندن بازبین و انصراف پذیرفته و منتشر است. کل پروژه/PDF هنوز کامل نیست.** D34 ادامه تا تکمیل همهٔ بخش‌هاست؛ پایان یک برش پایان هدف نیست. جزئیات۵۷ و قدیم در [آرشیو پیش۵۸](archive/STATUS-before-credit-submission58-release.md) محفوظ‌اند.

## اجرای اصلی محلی۵۸

- API http://127.0.0.1:5080 — PID60493/session50178؛ restart: `python3 tmp/credit-submission58-release.py serve-api`.
- فروشگاه http://127.0.0.1:3000 — PID60543/session19851؛ restart: `python3 tmp/credit-submission58-release.py serve-storefront`.
- پنل http://127.0.0.1:3173 — PID60570/session37348؛ restart: `node tmp/serve-credit-submission58-main-admin.mjs`.
- descriptorهای `tmp/{api,storefront,admin}-runtime-current.json` مرجع hash/path/restart هستند. build نهایی `1Q6y701ndg7vDX5ZeP7bj`، API mode، preview خاموش. snapshot نهایی `tmp/credit-submission58-ui-runtime-set.json`؛ snapshot نخست `tmp/credit-submission58-runtime-set.json` شاهد فرمان‌های مرورگر است. mainPublished تاریخی snapshot جای release/descriptor نیست.
- SQL۵۸ migration/۱۶۱ جدول/۱۲schema دارد. Submissions/SubmissionDocuments/SubmissionCommands خالی اضافه و CurrentSubmissionId nullable، FK/index همان پرونده، State=Submitted و eventهای Submitted/Withdrawn افزوده شدند. **۱۵۷ جدول پیشین به‌جز credit history در ارتقای متوقف دقیقاً برابر و تمام۵۷ migration قبلی محفوظ‌اند.** schemaهای دیگر و viewها برابرند. guard نخست نام metadata ستون را `name` فرض کرد؛ فقط‌خواندنی اثبات شد تنها ستون مجاز افزوده است و `column` اصلاح شد؛ هیچ داده برای عبور از guard تغییر نکرد. `credit-submission58-main-schema-investigation.json` محفوظ است.
- ۱۲۸۶HTTP شامل تمام۱۲۳۲ شاهد قبلی، حفظ۷۳۰asset پنل و۲۶۰Next و۱۶مرز خصوصی ارسال401 موفق است. پسHTTP **۱۶۰ جدول غیرنشست و تمامschema/view/history/safety برابرند**. نشست اصلیِ زنده جدا از دادهٔ تجاری مقایسه شده است؛ پنج refresh200 عادی پیش توقف در log نسخه۵۷ دیده شد. reset نشست برای رسیدن به hash قدیمی انجام نشد.
- Stock101/0/0؛ Orders/Reservations/Settings/Policies/SourcingRequests/paymenthistory/Support/Inbox/Files/CreditApplications و همهٔ historyهای شرایط/مدارک/ارسال صفرند. CMS site3FA/EN و auth1 محفوظ‌اند؛ supportCMS اصلی منتشر نشده/FAQ خالی پنهان است. seed، متن حقوقی، مدرک اجباری، نقش یا سیاست مالی واقعی اضافه نشد.
- **Files اصلی Disabled و providerهای D16/D30 ناشناخته/غیرفعال‌اند**. شرایط اصلی منتشر نشده و درخواست واقعی برای ارسال آماده نیست. Submitted فقط درخواست بررسی است؛ تأیید/رد/برگشت انسانی و checkout چکی هنوز ساخته/پذیرفته نشده‌اند. CREDIT-01/02 بازند.
- بکاپ پس توقف21,094,400بایت COPY_ONLY/CHECKSUM/VERIFYONLY، SHA `b45d4a8fa61e9af27d2dc41d5b5c0d48a0f330ba551d1be319afe4c9c38189c2` و۱key بدون parsing: `artifacts/checks/main-pre-credit-submission58-stopped-backup.json`. همان میزبان است؛ offsite/restore۵۸/nativeLinux اثبات نشده. current/rollback/restart/keys/backups/evidence در tmp حفظ شوند؛ tmp کامل پاک نشود. Redis پارسه طبق D32 روشن و دست‌نخورده است.

## ارسال و صف بررسی۵۸ پذیرفته

[CREDIT-SUBMISSION](CREDIT-SUBMISSION.md) و A57 مرجع‌اند. صاحب Draft باید نسخهٔ پرونده/شرایط، consent/revision جاری و درخواست صریح بررسی بدهد. طرح باید فعال و همان نسخهٔ snapshot باشد. همهٔ مدارک required باید فایل جاری همان رضایت باشند؛ replacement صریح/قدیمی immutable است، فایل رضایت قبلی منتقل نمی‌شود. صفر/اختیاری بودن مدارک باید صریحاً در شرایط منتشرشده تنظیم شده باشد؛ نبود storage بدون فایل لازم/انتخاب‌شده مدرک اجباری اختراع نمی‌کند. اگر فایلی دخیل باشد storage/scanner معتبر لازم است.

root Identity/Credit/Files Serializable، قفل شرایط سپس فرمان پرونده، state/pointer/snapshot/receipt/event/audit را اتمیک می‌کند؛ object/scanI/O داخلSQL نیست. یادداشت/رسید با purpose مجزا رمز، فایل‌ها با metadatahash و FKهای همان پرونده/رضایت/revision/key مقیدند. Submitted تغییر مدرک/رضایت نمی‌پذیرد. cancel همان نسخه در Submitted به Withdrawn و Cancelled تبدیل می‌شود؛ اصل ارسال/رضایت/فایل/رسید محفوظ است. سقف۲۰ پروندهٔ باز Draft+Submitted و۲۰snapshot فنی است، نه سیاست تجاری.

staff/MFA/credit.read فقط صف/تاریخچه می‌خواند؛ از طرف مشتری submit/consent/upload ندارد. متن «رضایت پذیرفته‌شده» در snapshot با زبان زمان پذیرش و lang/dir همان زبان نمایش داده می‌شود، حتی در رابط انگلیسی. legacy detail همچنان canSubmit=false است؛ endpoint `/submission` قابلیت واقعی ارسال را می‌دهد. رابط همهٔ enumها/فیلترها را می‌شناسد، journal فقط RAM/مقیدبه حساب، unknown→GETreceipt/retry همانUUID/body و logout بین تب‌ها→حذف فوری اطلاعات خصوصی است.

۹۷۶unit/کل۶۷۹SQLواقعی/۴۲۰storefront/۲۱۴admin/۱۱proxy موفق، build/typecheck موفق،۱۴API DLL در unit/SQL/harness/frozen برابر و مدل Credit بدون pending است. **Shop.sln شامل SqlTests/UiHarness نیست؛ آن‌ها صریحاً build/تطبیق شوند.** آزمون SQL نخست۳/۴ بود؛ چهارم به auth15/min محیط مشترک خورد. factory احراز همان آزمون جدا و MFA/limiter واقعی دست‌نخورده ماند؛ کل۶۷۹ موفق است. VSTest و SQL در sandbox بدون socket اجرا نشدند، با bind/localSQL مجاز اجرا شدند. بررسی مجوز شروع QA frontend یک‌بار timeout شد؛ retry مجاز موفق، مانع باقی نماند.

۱۱SQLwire و۱۱۳browserwire با decoder تولیدی و hash بایت خام پذیرفته‌اند. SQL: required/optional، latestreplacement، scope/FK، staleversion/plan/شرایط/رضایت، intent صریح، race submit/withdraw، replay تاریخی، رمز یادداشت و rollback کامل audit. مرورگر۵فرمان موفق یکتا: انتشار۱/پیش‌نویس۱/رضایت۱/ارسال۱/انصراف۱؛ یک پاسخ موفق ارسال قطع→یکGETreceipt، صفر فرمان موفق تکراری؛ صف Submitted سپس خالی بعدwithdraw، تاریخچهٔ مشتری/بازبین و FA/EN، logout تب دیگر و relogin پذیرفته‌اند. این QA **صریحاً صفر تعریف مدرک** منتشر کرد و FilesDisabled بود؛ actualS3/ClamAV این برش ادعا نمی‌شود. فایل‌های الزامی با SQL capture و زیرساخت واقعی۵۷ جدا شاهد دارند. فایل‌انتخاب‌گر CUA که در۵۷ بیش از۶ساعت معطل شد تکرار نشد.

از۱۶۱ جدول QA فقط۱۳ جدول مجاز تغییر و۱۴۸ جدول دیگر دقیقاً برابرند؛۱CancelledApplication با مبلغ9007199254740993ریال/currentSubmission،۴event شامل۱Withdrawn،۲appcommand،۱submission/command و۵audit اعتبار؛ صفرfile/order/reservation/settings/policy. UIviewport۳۹۰×۸۴۴ مشتریFA/EN و بازبینFA بدون overflow؛ دسکتاپ۱۲۸۰/client=scroll۱۲۶۵ و ستون‌ها هم‌تراز؛ console تمام۵تب خالی. physicaldevice/کلmobile/WCAG/performance پذیرفته نیست.

فرمان‌های functional روی snapshot نخست اجرا شدند؛ اصلاح نهایی فقط copy و زبان رضایت است.۱۴API DLL و proxy دو snapshot دقیقاً برابرند. رابط نهایی read/history/lang-dir/logout/relogin دوباره بررسی شد؛ **تکرار فرمان‌های نوشتن روی bundle نهایی ادعا نمی‌شود**. شواهد: `credit-submission58-source-acceptance.json`، `credit-submission-sql-full-wire/acceptance.json`، `credit-submission-browser-wire/acceptance.json`، `credit-submission-browser-{ui,final-sql}.json` و `credit-submission58-main-release.json`.

GUID `SaymanTest_Ui_fcf28c4addd24a2eb129643b5c7f012f`، keys/credentials، تب‌های۸۰–۸۴ و پورت‌های3105/3175/5181/5182 جمع شدند؛ Dockerresource تازه ساخته نشد. `credit-submission58-qa-cleanup.json` مرجع است. فقط runtimeهای اصلی۵۸ فعال‌اند؛ assetها/rollback/restart پیشین محفوظ‌اند.

## ادامهٔ آمادهٔ D34

1. بررسی انسانی مجوزدارِ همان submission: برگشت برای اصلاح/رد/تأیید صریح با مبلغ و انقضای واردشده توسط مدیر، تاریخچه/receipt/audit و همزمانی با withdrawal؛ هیچ تصمیم خودکار یا پیش‌فرض تجاری. سپس اتصال صریح checkout چکی و CREDIT-02 سررسید/وصول/برگشت/یادآوری. نقش موجود CreditReviewer از پیش credit.read/write دارد؛ finance جای دسترسی پرونده نیست. خواندن/تصمیم و policy باید جدا کنترل شوند.
2. ارسال جزئی/دیجیتال، مرجوعی/بازپرداخت، CMS پیشرفته/بلاگ/SEO، search/alert/loyalty و بقیهٔPRD ادامه دارند. هسته‌های قدیم بازار/هلو/دست‌دوم/review/compare/Support/Inbox/SignalR/Files/Payment/Fulfillment در آرشیو و اسناد ماژول محفوظ‌اند؛ اسکلت به معنی تکمیل نیست.
3. D16 درگاه/SMS/email و D30 هلوlive اطلاعات ندارند؛ سؤال تکرار/APIساختگی/موفقیت ساختگی ساخته نشود. هزینه/مالیات/گارانتی/مرجوعی/شرایط چک واقعی از پنل تعیین می‌شوند؛ اصلی Settings/Policy خاموش است.
4. mobile/WCAG/performance/CI/observability/nativeLinux/load/offsitebackup/restore object+keyring و معیارهای۱۲گانه شاهد مستقل می‌خواهند. D14 انتشار محلی، D21 نمونه فقطQA، D32 Redis روشن، D33 حفظtmp و D34 کلپروژه پابرجایند.

سورس پس۵۸: برش۵۹ بررسی انسانی طبق CREDIT-REVIEW/A58 در ساخت است؛ مدل/endpoint و فرم مشترک پنل/تاریخچهٔ مشتری نوشته و migration `20261027092224_ManualCreditReviews` تولید شده است. ۹۷۹unit/۴۲۷storefront/۲۱۴admin/۱۲proxy و build اولیه موفق؛۴SQL اختصاصی نخست موفق و پنجم permission/MFA به کلSQL افزوده شد که در حال اجراست. هنوز مرورگر/cleanup/ارتقای اصلی۵۹ پذیرفته نیست؛ main58 frozen فعال می‌ماند. STATUS اصلی بالا مرجع اجرای زنده است.
