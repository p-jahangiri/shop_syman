# وضعیت و نقطهٔ ادامه

آخرین به‌روزرسانی: 2026-10-27. **اصلی محلی۵۵؛ پیش‌نویس خصوصی خرید چکی پذیرفته و منتشر است. کل PRD/PDF هنوز کامل نیست.** D34 ادامه تا تکمیل همهٔ بخش‌هاست؛ پایان یک برش پایان هدف نیست. وضعیت پیش۵۵ در [آرشیو](archive/STATUS-before-credit-applications55-release.md)، تاریخچهٔ قدیمی‌تر در آرشیوهای همان سند محفوظ است.

## اجرای اصلی محلی۵۵

- API: http://127.0.0.1:5080 — PID83191/session9732؛ restart: `python3 tmp/credit-applications55-release.py serve-api`.
- فروشگاه: http://127.0.0.1:3000 — PID83183/session60609؛ restart: `python3 tmp/credit-applications55-release.py serve-storefront`.
- پنل: http://127.0.0.1:3173 — PID83182/session92951؛ restart: `node tmp/serve-credit-applications55-main-admin.mjs`.
- descriptorهای `tmp/{api,storefront,admin}-runtime-current.json` مرجع مسیر/hash/restart هستند. build فروشگاه `V5uxd1uSy8h0vAFtBk07W`، API mode و preview خاموش است. `tmp/credit-applications55-v2-runtime-set.json` snapshot ثابت پیش‌انتشار است؛ mainPublished تاریخی آن جای release/current نیست.
- SQL۵۵ migration،۱۵۰ جدول و۱۲ schema دارد. هر۱۴۶ جدول قبلی به‌جز history اعتبار دقیقاً برابر است؛ تمام۵۴ migration تاریخی و schema/viewهای قبلی حفظ و فقط history اعتبار+۱ و سه جدول خالی Applications/ApplicationEvents/ApplicationCommands اضافه شدند. پسHTTP هر۱۵۰ جدول/schema/view برابر است.
- Stock101/0/0؛ Orders/Reservations/Settings/Policies/SourcingRequests/paymenthistory/Support/Inbox/Files/CreditApplications صفرند. CMS site3 FA/EN و auth1 محفوظ‌اند؛ support CMS اصلی هنوز ثبت/منتشر نشده و FAQ خالی پنهان است. هیچ کاربر اصلی نقش تازه نگرفت؛ seed/سیاست مالی/provider اضافه نشد.
- **Files اصلی Disabled است**؛ S3/bucket/ClamAV تولیدی پیکربندی نشده‌اند. S3/ClamAV واقعی فقط در QA مستقل پذیرفته و آن سرویس‌ها جمع شدند. پیام متنی تیکت و پیش‌نویس چک مستقل‌اند؛ موفقیت QA فعال‌بودن آپلود اصلی نیست.
- بکاپ تازه20,045,824بایت COPY_ONLY/CHECKSUM/VERIFYONLY و keyring خصوصی: `artifacts/checks/main-pre-credit-applications55-backup.json`. همان میزبان است؛ offsite/restore۵۵/nativeLinux را اثبات نمی‌کند. current/rollback/restart/keys/backups/evidence در tmp محفوظ‌اند؛ tmp کامل پاک نشود. writer قدیمی خودکار علیه۵۵ اجرا نشود. Redis پارسه طبق D32 روشن و دست‌نخورده است.

## پیش‌نویس چک۵۵ پذیرفته

[CREDIT-APPLICATIONS](CREDIT-APPLICATIONS.md) و A53: مشتری طرح فعال/نسخه و مبلغ درخواستی صحیح ریال را انتخاب می‌کند؛ create/cancel/list/detail/receipt و snapshot رمز‌شدهٔ طرح در Credit هستند. ایجاد پیش‌نویس قیمت/موجودی/رزرو/سفارش/اعتبار ایجاد نمی‌کند. فقط Draft/Cancelled، canSubmit همیشه false است؛ رضایت/مدارک/submit/manualreview/checkout/سررسید هنوز پیاده/پذیرفته نیستند. پنل فعلاً خواندن پرونده دارد، نه تأیید اعتبار.

CreditReviewer با credit.read/write از finance.read عمومی جداست چون مدیر کالا finance.read دارد. مشتری فقط خود، کارمند staff/MFA/credit.read؛ FinanceManager/CatalogManager/SupportAgent دسترسی خصوصی نمی‌گیرند. تخصیص نقش فقط با grant صریح مدیر است، نه startup/migration. root Serializable، قفل فرمان، actor+UUID/بدنه/نسخه، history append-only، receipt تاریخی رمز‌شده و audit اتمیک‌اند. سقف۲۰Draft و seek۵۰ فنی است. تمام مبالغ JSON، حتی roundingUnitRial، رشته‌اند؛ UI با BigInt و ورودی ارقام فارسی/عربی و اعشار تومان کار می‌کند.

۹۶۳واحد،کل۶۶۲ SQL واقعی،۳۹۵فروشگاه/۲۱۴پنل/۸proxy و typecheck/build موفق‌اند؛۱۴DLL unit/SQL/harness/frozen برابر و Credit model بدون pending است. اجرای نخست QA به علت roundingUnitRial عددی پذیرفته نشد و دقیقاً پاک شد؛ قرارداد رشته‌ای اصلاح و QA تازه ساخته شد. یک اجرای SQL no-build از اسمبلی قدیمی استفاده کرده بود؛ نتیجهٔ آن صریحاً رد شد و پس build صریح UiHarness و تطبیق۱۴DLL، کل۶۶۲ و۸wire تازه تکرار شد. **Shop.sln شامل SqlTests/UiHarness نیست؛ build solution جای build صریح آن‌ها نیست.** خطای نام تکراری formatter در build اصلاح شد؛ آزمون proxy بدون مجوز bind، EPERM داشت و با bind مجاز هر۸ موفق شد. شواهد شکست‌ها محفوظ‌اند.

۸ پاسخ SQL و۲۳ پاسخ مرورگر با decoder تولیدی و hash خام پذیرفته‌اند. مشتری و CreditReviewer/MFA ساختگی، مبلغ9007199254740993 ریال با ورودی فارسی، create وcancel با قطع پاسخ موفق→unknown→GETreceipt بدون mutation تکراری، خواندن همان یک پرونده از پنل، FA/EN مشتری، خروج در تب دیگر→پنهان‌شدن و login→بازیابی تاریخچهٔ Cancelled موفق‌اند. از۱۵۰ جدول QA فقط۶ جدول مجاز تغییر و۱۴۴ جدول دیگر برابرند؛۱CancelledApplication/۲event/۲command/۲audit و سیاست/سفارش/رزرو صفر. دو پنل هم‌تراز، width۱۲۸۰/client=scroll۱۲۶۵، console خطا/هشدار صفر؛ mobile پذیرفته نیست.

QA GUID `1e82cd52a2a2419dbbed47a64101c05f`، کلید/credentialها، تب‌های68–70 و پورت‌های3105/3175/5181/5182 جمع‌اند؛ اصلی۵۴ تا rollout دست‌نخورده بود. `credit-applications55-source-acceptance.json`، `credit-applications-sql-wire/acceptance.json`، `credit-applications-browser-wire/acceptance.json`، `credit-applications-browser-sql.json` و `credit-applications55-qa-cleanup.json` مرجع‌اند. QA قبلیِ ردشده، credential/کلید/DB/تب‌های65–67 آن نیز پاک است؛ شواهد با before-rial-unit-fix محفوظ‌اند.

پس از backup و baseline تازه، فقط migration `20261026212840_PrivateCreditDraftApplications` روی اصلی اعمال شد.۱۱۳۶ HTTP شامل۱۰۸۶ شاهد قبلی و حفظ۶۵۷asset پنل/۲۳۷Next و۱۶ مرز اعتبار401 موفق است. `credit-applications55-main-release.json` و before/after/post-smoke شواهدند. دادهٔ QA یا نقش/شرایط نمونه به اصلی کپی نشد. کل پروژه و کل CREDIT-01/02 بازند.

## بخش‌های پیشین محفوظ

[PRIVATE-FILES](PRIVATE-FILES.md): فایل خصوصی AES-256-GCM/keywrap، S3 شرطی و ClamAV واقعی QA، upload/download bounded، پیوست تیکت/receipt/audit اتمیک و دانلود دقیق مرورگر در۵۴ پذیرفته‌اند؛ نگهداری/حذف/restore objectها و فعال‌سازی اصلی بازند. [PRIVATE-REALTIME](PRIVATE-REALTIME.md): SignalR هم‌مبدأ/pulse بی‌محتوا/lease و reconnect. [PRIVATE-NOTIFICATIONS](PRIVATE-NOTIFICATIONS.md): Inbox دائمی/owner-only. [SUPPORT-CONTENT](SUPPORT-CONTENT.md): FAQ و انتشار/restore نسخه‌دار FA/EN. [SUPPORT-TICKETS](SUPPORT-TICKETS.md): تیکت رمز‌شده/MFA. [PAYMENT-CORE](PAYMENT-CORE.md): هسته۵۰ با provider خاموش. [ORDER-FULFILLMENT](ORDER-FULFILLMENT.md): ارسال کامل صرفاً فیزیکی۴۸. بازار/تأمین/هلو/دست‌دوم/review/compare/CMS و شواهد قدیمی در آرشیو محفوظ‌اند.

سورس جاری پس۵۵: شرایط و تعریف مدارک نسخه‌دار و رضایت دقیق CREDIT-01 در حال پذیرش است. شش جدول افزایشی و CurrentConsentId nullable با FK مقید به همان پرونده، consent event، publish/receipt و consent/receipt/audit root Serializable اضافه شده‌اند؛ migration `20261026223832_VersionedCreditRequirements` فقط سورس است. پنج واحد و پنج SQL هدف موفق‌اند؛ اجرای SQL نخست به علت تجمیع هفت login/MFA در یک factory دو429 داشت؛ factory دسترسی جدا و محدودیت محصول حفظ شد. فرم پنل/مشتری و strict BFF/journal ساخته شده و پنج قرارداد فروشگاه/typecheck پنل موفق‌اند. body bounds تازه، build/typecheck کامل، full SQL/واحد، wire/مرورگر/cleanup و انتشار۵۶ هنوز باقی‌اند. اصلی۵۵ frozen محفوظ است؛ هیچ شرایط واقعی منتشر نشده و submit/مدارک/review/order هنوز کامل نیستند.

## ادامهٔ آماده برای D34

1. CREDIT-01 بعدی: شرایط و تعاریف مدارک قابل تنظیم و نسخه‌دار از پنل، رضایت به همان نسخه، اتصال Files برای مدارک خصوصی و ارسال/بررسی انسانی مجوزدار. پیش‌نویس۵۵ دوباره ساخته نشود. درصد/ماه/متن حقوقی/سیاست واقعی ساخته نشود؛ نبود شرایط یا storage امن مسیر نهایی را مسدود نگه دارد. بعد پیوند به checkout چکی و CREDIT-02 سررسید/وصول/برگشت.
2. ارسال جزئی/دیجیتال، مرجوعی/بازپرداخت، CMS پیشرفته/بلاگ/SEO، search/alert/loyalty و باقی PRD لازم‌اند؛ کل چرخهٔ فروش/PDF کامل نیست.
3. پرداخت زنده initiation/verify/callback/reconcile/sandbox/refund وابسته D16 است؛ اطلاعات provider فعلاً نداریم و سؤال تکرار نشود. هلو live D30 و منابع مجاز بازار/نظر خارجی بازند؛ vendor API یا موفقیت ساختگی ساخته نشود.
4. mobile/WCAG/performance/CI/nativeLinux/load/offsitebackup و معیارهای۱۲گانه شاهد مستقل می‌خواهند. هزینه/مالیات/گارانتی/مرجوعی/چک واقعی نامعلوم‌اند؛ mainSettings/Policy خاموش‌اند. D14 انتشار محلی،D21 نمونه فقطGUIDQA،D32 Redis روشن،D33 نگه‌داری tmp وD34 هدف کل پروژه حفظ‌اند.
