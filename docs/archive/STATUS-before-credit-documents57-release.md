# وضعیت و نقطهٔ ادامه

آخرین به‌روزرسانی: 2026-10-27. **اصلی محلی۵۶؛ شرایط نسخه‌دار و رضایت دقیق خرید چکی پذیرفته و منتشر است. کل PRD/PDF هنوز کامل نیست.** D34 ادامه تا تکمیل همهٔ بخش‌هاست. تاریخچه و شواهد پیشین در [آرشیو پیش۵۶](archive/STATUS-before-credit-requirements56-release.md) و آرشیوهای مرتبط محفوظ‌اند.

## اجرای اصلی محلی۵۶

- API http://127.0.0.1:5080 — PID57392/session37707؛ restart: `python3 tmp/credit-requirements56-release.py serve-api`.
- فروشگاه http://127.0.0.1:3000 — PID57385/session85001؛ restart: `python3 tmp/credit-requirements56-release.py serve-storefront`.
- پنل http://127.0.0.1:3173 — PID57386/session79039؛ restart: `node tmp/serve-credit-requirements56-main-admin.mjs`.
- descriptorهای `tmp/{api,storefront,admin}-runtime-current.json` مرجع مسیر/hash/restart هستند؛ build فروشگاه `bLOR41i9KZ9l6w2gxsjRs`، API mode و preview خاموش. snapshot ثابت `tmp/credit-requirements56-ui-runtime-set.json` است؛ نسخه‌های اصلی و rollback/keys/backups/evidence در tmp محفوظ و پاک‌کردن کلی آن ممنوع است.
- SQL۵۶ migration،۱۵۶ جدول و۱۲ schema دارد.۱۴۹ جدول قبلی به‌جز history اعتبار دقیقاً برابرند؛ تمام۵۵ migration تاریخی و viewها حفظ شدند. فقط شش جدول خالی شرایط/رضایت، CurrentConsentId nullable با FK همان پرونده/index و Consented در قید event اضافه شدند. پسHTTP هر۱۵۶ جدول و schema/view برابر است.
- Stock101/0/0؛ Orders/Reservations/Settings/Policies/SourcingRequests/paymenthistory/Support/Inbox/Files/CreditApplications صفرند؛ CMS site3 FA/EN و auth1 محفوظ‌اند. support CMS اصلی هنوز ثبت/منتشر نشده و FAQ خالی پنهان است. نقش، seed، متن حقوقی، مدرک اجباری یا سیاست مالی اصلی اضافه نشد.
- **Files اصلی Disabled است**؛ S3/bucket/ClamAV تولیدی پیکربندی نشده‌اند. موفقیت خدمات واقعی QA به معنی فعال‌بودن آپلود اصلی نیست. ثبت رضایت، سفارش/تأیید اعتبار/submit ایجاد نمی‌کند.
- بکاپ20,045,824بایت COPY_ONLY/CHECKSUM/VERIFYONLY و keyring خصوصی: `artifacts/checks/main-pre-credit-requirements56-backup.json`؛ SHA31930e1694667f8664ba767daf0ffdb2c2eadaf45da53004d011a0617af852ef. این بکاپ همان میزبان است؛ offsite/restore۵۶/nativeLinux اثبات نشده‌اند. Redis پارسه طبق D32 روشن و دست‌نخورده است.

## شرایط و رضایت۵۶ پذیرفته

[CREDIT-REQUIREMENTS](CREDIT-REQUIREMENTS.md)، [CREDIT-APPLICATIONS](CREDIT-APPLICATIONS.md) و A54: مدیر مجاز finance.read/write و staff/MFA متن FA/EN و تعریف مدارک هر نسخه را منتشر می‌کند؛ خصوصی‌بودن پرونده با credit.read/write مستقل است. مشتری در Draft خودش صریحاً نسخهٔ پرونده، revision/headversion شرایط و زبان را قبول می‌کند؛ تغییر شرایط رضایت قدیمی را بازنویسی نمی‌کند. متن دقیق رضایت ثبت‌شده حتی در زبان متفاوت رابط قابل مشاهده است. Consent و head/revision/docs/receipts و audit در root Serializable اتمیک، تاریخچه append-only، رسید actor+UUID/body و رمز‌شده‌اند. نسخهٔ نامعتبر/قدیمی/غیرفعال/بدنهٔ اضافی رد می‌شود. Down پیش از تغییر schema هر سابقهٔ پروندهٔ قدیم یا جدید را مسدود می‌کند.

فرم پنل نسخهٔ پایهٔ صریح دارد؛ refresh به‌طور پنهان فرم را rebase نمی‌کند. journal فقط RAM و مقید به حساب؛ unknown→GETreceipt/retry همان UUID/body، logout پاک‌سازی و full reload بدون ادعای حفظ RAM. ورودی انتشار۴۸KiB/consent۸KiB، خروجی۲۵۶KiB و private/no-store/noindex و BFF strict هستند. Consent سفارش/رزرو/تأیید اعتبار نیست؛ canSubmit همچنان false است. مدارک/submit/manualreview/order/سررسید کامل نشده‌اند.

۹۶۸واحد،کل۶۶۷ SQL واقعی،۴۰۰فروشگاه/۲۱۴پنل/۹proxy و typecheck/build موفق‌اند؛۱۴DLL unit/SQL/harness/frozen برابر و Credit model بدون pending است. **Shop.sln شامل SqlTests/UiHarness نیست؛ هر دو صریحاً build و اسمبلی‌ها تطبیق داده شوند.** نخست دو SQL429 ناشی از هفت login/MFA در factory مشترک بود؛ fixture نقش مستقل و محدودیت محصول حفظ شد، اجرای نهایی کامل موفق است. شواهد شکست محفوظ‌اند.

۱۰ پاسخ SQL و۶۱ پاسخ مرورگر با decoder تولیدی و hash خام،۶فرمان واقعی،۲قطع پاسخ موفق انتشار/رضایت→GETreceipt بدون mutation تکراری، مبلغ9007199254740993ریال، رضایت FA و EN و حفظ متن قبلی پس ویرایش، cancel و refresh خودکار مشتری/بازبین پذیرفته‌اند. فقط۱۲ جدول مجاز QA تغییر و۱۴۴ جدول دیگر برابرند؛ سفارش/رزرو/سیاست صفر. نسخهٔ نهایی UI اصلاح نمایشی متن/refresh دارد؛۱۴API DLL و Node proxy دقیقاً برابر نسخهٔ functionalwrites، helperهای mutation/receipt بدون تغییر و خواندن/cancel نهایی دوباره بررسی شدند. ادعای اجرای همهٔ writes روی bundle نهایی نمی‌شود.

desktop۱۲۸۰ و viewport۳۹۰×۸۴۴ برای فرم شرایط، رضایت/خواندن/لغو مشتری و navigation/MFA بازبین پذیرفته؛ console خطا/هشدار صفر و client=scroll است. دستگاه فیزیکی و کل mobile/WCAG پروژه پذیرفته نیستند. full-page screenshotهای دارای اشکال stitch RTL شاهد layout نیستند؛ تصویر عادی viewport و DOM metrics مرجع‌اند.

مرجع‌ها: `credit-requirements56-source-acceptance.json`، `credit-requirements-sql-full-wire/acceptance.json`، `credit-requirements-browser-wire/acceptance.json`، `credit-requirements-browser-{sql,ui}.json` و `credit-requirements-locale-display-correction.json` در artifacts/checks. QA GUID6c7b488fcc3d44b58f256238a13a5530، کلید/credentialها، تب‌های71–75 و پورت‌های3105/3175/5181/5182 جمع‌اند؛ `credit-requirements56-qa-cleanup.json` مرجع است.

پس backup/baseline تازه، migration `20261026223832_VersionedCreditRequirements` اعمال شد.۱۱۸۸HTTP، شامل۱۱۳۶ شاهد قبلی، حفظ۶۸۰asset پنل/۲۴۶Next و۲۰مرز خصوصی تازه401 موفق‌اند. `credit-requirements56-main-release.json` و before/after/post-smoke شواهدند. هیچ دادهٔ QA یا شرایط نمونه به اصلی منتقل نشد. کل CREDIT-01/02 و پروژه باز است.

## بخش‌های پیشین محفوظ

[PRIVATE-FILES](PRIVATE-FILES.md): AES-GCM/keywrap، S3 شرطی/ClamAV واقعی QA، پیوست تیکت/receipt/audit و دانلود دقیق پذیرفته‌اند؛ mainDisabled، نگهداری/حذف/restore باز. [PRIVATE-REALTIME](PRIVATE-REALTIME.md): SignalR هم‌مبدأ/pulse/lease/reconnect. [PRIVATE-NOTIFICATIONS](PRIVATE-NOTIFICATIONS.md): Inbox دائمی owner-only. [SUPPORT-CONTENT](SUPPORT-CONTENT.md): FAQ/انتشار/restore FA/EN. [SUPPORT-TICKETS](SUPPORT-TICKETS.md): تیکت رمز‌شده/MFA. [PAYMENT-CORE](PAYMENT-CORE.md): هسته۵۰ با provider خاموش. [ORDER-FULFILLMENT](ORDER-FULFILLMENT.md): ارسال کامل فیزیکی۴۸. پیش‌نویس چک۵۵، بازار/تأمین/هلو/دست‌دوم/review/compare/CMS و شواهد قدیمی در آرشیو محفوظ‌اند.

## ادامهٔ آماده برای D34

1. اتصال Files برای مدارک خصوصی پرونده+revision+کلید مدرک+رضایت، سپس submit و بررسی انسانی مجوزدار. پیش‌نویس/شرایط/رضایت۵۵–۵۶ دوباره ساخته نشوند. نبود شرایط/storage امن مسیر نهایی را مسدود نگه دارد؛ سپس پیوند checkout چکی و CREDIT-02 سررسید/وصول/برگشت.
2. ارسال جزئی/دیجیتال، مرجوعی/بازپرداخت، CMS پیشرفته/بلاگ/SEO، search/alert/loyalty و باقی PRD ادامه دارند.
3. D16 درگاه/SMS/email و D30 هلو live اطلاعات ندارند؛ سؤال تکرار یا vendor API/موفقیت ساختگی ساخته نشود. منابع مجاز خارجی بازند. هزینه/مالیات/گارانتی/مرجوعی/چک واقعی از پنل مالک تعیین می‌شوند؛ اصلیSettings/Policy خاموش.
4. mobile/WCAG/performance/CI/nativeLinux/load/offsitebackup و معیارهای۱۲گانه شاهد مستقل می‌خواهند. D14 انتشار محلی، D21 نمونه فقطQA، D32 Redis روشن، D33 حفظ tmp و D34 هدف کل پروژه حفظ‌اند.

سورس پس۵۶: برش۵۷ مدارک خصوصی طبق CREDIT-DOCUMENTS و A55 در ساخت است؛ هنوز build/SQL/wire/مرورگر و انتشار آن پذیرفته نیستند. اصلی۵۶ frozen فعال است.
