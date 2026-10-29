# وضعیت و نقطهٔ ادامه

آخرین به‌روزرسانی: 2026-10-26. **اصلی محلی۵۱، تیکت خصوصی مشتری/پنل پذیرفته و منتشر است؛ کل PRD/PDF هنوز کامل نیست.** D34 ادامه تا تکمیل تمام بخش‌هاست؛ پایان یک برش پایان هدف نیست.

## کار جاری — محتوای پشتیبانی از CMS (هنوز منتشر نشده)

سند مستقل `support` برای FA/EN در همان CMS، ویرایشگر پرسش/پاسخ، ترتیب و فعال‌بودن، پیش‌نمایش انتشار و بازگردانی نسخهٔ تاریخی، و خواندن فقط محتوای منتشرشده پیاده شده است. پیش‌نویس، سؤال غیرفعال و نمونهٔ توسعه در Production عمومی نمی‌شوند؛ نبود محتوا FAQ ساختگی ایجاد نمی‌کند و تیکت در دسترس می‌ماند. اتصال SSR فروشگاه، لینک پشتیبانی از حساب و متن مخصوص کارمند در سورس آماده‌اند. ۱۱ واحد و ۵ SQL هدفمند موفق‌اند؛ typecheck دو رابط موفق است. رگرسیون کامل، wire با decoder تولیدی، مرورگر QA، freeze و انتشار محلی هنوز باقی است. اصلی۵۱ دست‌نخورده و فعال است؛ migration تازه‌ای برای این برش لازم نیست. [SUPPORT-CONTENT](SUPPORT-CONTENT.md).

## اجرای اصلی محلی۵۱

- API: http://127.0.0.1:5080، PID8899/session31724؛ restart: `python3 tmp/support-ticket51-release.py serve-api`.
- فروشگاه: http://127.0.0.1:3000، PID8975/session53014؛ restart: `python3 tmp/support-ticket51-release.py serve-storefront`.
- پنل: http://127.0.0.1:3173، PID9028/session13534؛ restart: `node tmp/serve-support-ticket51-main-admin.mjs`.
- `tmp/{api,storefront,admin}-runtime-current.json` مسیر/PID/hash دقیق را دارند. build فروشگاه `QHArOBvbrUVoCC3OlmOVs`،API mode/previewخاموش؛ set ثابت `tmp/support-ticket51-runtime-set.json` snapshotپیش‌انتشار و hashشاهد مرورگر است و عمداً mainPublished=false تاریخی می‌ماند. descriptorهایcurrent/release مرجع انتشارند.
- SQL۵۱migration/۱۴۲جدول/۱۰schema؛ Supportچهار جدول خالی +یکhistory دارد. همه۱۳۷جدول قبلی،حتیEFhistoryها عینbaselineتازه محفوظ‌اند. Stock101/0/0، Orders/Reservations/Settings/Policies/SourcingRequests وpaymenthistoryصفر؛ CMSsite3FAEN/auth1، هویت/نقش‌های قبلی محفوظ‌اند. هیچseed/RoleGrant/QApolicy/provider وارد اصلی نشد. RedisپارسهطبقD32 runningو دست‌نخورده است.
- بکاپ پیش۵۱: 18,993,152بایت COPY_ONLY/CHECKSUM/VERIFYONLY و keyring خصوصی؛ `main-pre51-release-backup.json`. محلی/همانمیزبان است،offsite/restore۵۱/nativeLinuxرااثباتنمی‌کند. runtime۵۰/۴۸وrollback/restart/key/backupمحفوظ؛ tmp کامل پاک نشود و writerقدیمیخودکارعلیه۵۱اجرانشود.

## تیکت خصوصی۵۱ پذیرفته

[SUPPORT-TICKETS](SUPPORT-TICKETS.md)، API و A48 مرز را ثبت می‌کنند. عنوان/پیام/رسید با purposeمختصticket/kind/record درSQLرمزند؛ owner/actor/rawcipher درDTOنیست. پیامplain textFAEN وUTC/نمایشتهران،صفحه۵۰تایی وcursorمقید،rowversion،actor+UUID/hash/رسیدتاریخی وrootSerializable/auditهستند. message/event/receipt append-only ومالک/عنواناولیهimmutable است؛Closedفقطبابازگشاییصریحقابلپاسخمی‌شود. replyمشتریOpen،replyپشتیبانWaitingCustomer وclose/reopenصریح‌اند؛ هیچاثرOrder/Stock/Payment/Refund/Credit ندارند. سقففنی۲۰درخواستباز/مالک وgateSQLمختصSupportهمزمانیظرفیتراایمنمی‌کند؛بار/partitioningهنوزپذیرفته‌نیست.

نقشSupportAgentفقطsupport.read/write دارد؛admin/MFAوoriginصریح،تغییر/رسیدباwriteهملازم‌اند. دیگرنقش‌هایفروش/مالی/محتوا/انبارصرفاًبه‌خاطرنقشدیگرمکالمهنمی‌خوانند. نبودنردیفنقشجدیددردیتابیسقدیمیفقطدرgrantصریحمجازAdministratorوبهمراهعضویت/stamp/auditدرهمانtransactionرفعمی‌شود؛startup/migrationکسیراپشتیباننمی‌کنند. SQLشکستauditساختنقشهمرابرگرداند.

مشتری از `/fa/support/tickets` یاEN،پنل ازصفحه«پشتیبانیوتیکت‌ها»استفادهمی‌کند. BFFstrict/حد۳۲KiB/۱MiBresponse/bearerبدونCookie،no-store/noindex،PWAprivateوjournalفقطRAMمقیدبهحسابپیاده‌اند. unknownفقطهمانUUID/bodyretryیاGETreceipt؛4xxبعدازunknownآنراشکستفرضنمی‌کند. signout/تغییرحسابپاکمی‌کند،unavailableفقطپنهانومحفوظمی‌گذارد. beforeunloadدرتلاشunresolved ازfullnavigationمحافظتمی‌کند؛حفظRAMدرfullreloadادعانشود. پسازackتغییرزبانهمانticketرابازمی‌کند. FAQدرAPImodeدیگرادعایپیش‌نمایش/نبودپشتیبانندارد؛FAQمدیریت‌شدهCMSهنوزبازاست.

۸۹۶واحد،کل۶۳۴SQLواقعی،۳۵۲فروشگاه/۲۱۲پنل/typecheck/build،۳proxyبدونتغییر/شاهدتأخیر۱۳ثانیه،۱۱wireSQL+۶۱پاسخمرورگر/۸ورودیباdecoderمحصولموفق‌اند.۱۳DLLدرواحد/SQL/harness/runtimeبرابرند؛modelSupportبدونpendingاست. رگرسیوننخستفقطفرضثابت۶نقشراردکرد؛آزمونبافهرستصریح۷نقشاصلاحوguardمحصولحفظشد. buildنخستنامhelperمتنFAQباstateتداخلداشت؛copyاصلاحوbuildنهاییAPI/previewخاموشموفقاست. NuGetauditنخستدرsandboxدسترسینداشت؛restore/buildرسمیبیرونsandboxبدونخاموش‌کردنauditموفقشد.

مرورگرGUIDباSupportAgentواقعی/MFAومشتریساختگی،دوپاسخ200createودوپاسخ200staffreplyقطع‌شده،sameUUID/body/receipt/ناوبری،ردstale409،پیامFA/EN/متنHTMLبه‌صورتplain،customerclose/staffreopenوClosedfilterخالیموفقاست. یکticket/۳message/۵event/۵command و۳auditپشتیبانی؛ردشدههیچپیامیندارد. همه۱۴۲جدولسنجیده،۱۲۶جدولسایردامنه‌هادقیقاًبرابر،تغیرفقطSupportوIdentityUser/Session/Auditمجازبود. GUID/کلید/credentialوتب‌های50/51پاک،QAportsبسته‌اند. عرض۱۲۸۰/client=scroll۱۲۶۵ وconsolelogثبت‌شدهصفر؛mobileپذیرفته‌نیست. `support-ticket-browser-acceptance.json`،wire/observations وscreenshotهای`support-ticket-browser-{admin-overview,customer-fa-overview,customer-en}.png`مرجع‌اند.

پسازبکاپتازه،migration`20261026003519_PrivateSupportTickets`فقطschemaSupport/چهارجدولخالی/یکEFhistoryافزود؛۱۳۷جدولقدیمیوتعریف‌ها/viewهاعینbaseline.۹۰۹HTTPباپوشش۸۴۸شاهدقبلی،۵۲۷assetقدیمیپنل/۱۹۷Nextوتمامجدیدهاو401/no-storeموفق؛پسHTTPهمه۱۴۲جدولبرابرند. `support-ticket51-main-release.json` وsource/before/after/post-smokeشواهدند. اینپذیرشچتزندهSignalR/اعلان/فایلیااتصالSMS/Emailنیست.

## پیشرفت پیشین

پرداختهسته/سوابقخصوصی۵۰باregistryخالی/canPay=falseپذیرفتهومحفوظاست؛هیچendpointعمومیproof/Paidکننداریم. [PAYMENT-CORE](PAYMENT-CORE.md)،[ORDER-FULFILLMENT](ORDER-FULFILLMENT.md)ومراجعهرقابلیتحدودرا نگهمی‌دارند. جزئیات۵۰/۴۸/قبل در[آرشیوپیش۵۱](archive/STATUS-before-support-ticket51-release.md)محفوظ‌اند.

## کار بعدی برای D34 — ادامه بده

1. محتوای پشتیبانی/FAQازCMSبدونdeploy،ورودپشتیبانیازحساب وشفاف‌بودنمتنکارمند،سپساعلاندایمیخصوصی/SUPPORT-01. FAQفعلیفرانتهنوزثابتاست؛آنازپنلقابلمدیریتکن،سیاستتجاریاپاسخفرضیجایگزیننکن. بعدSignalR/fileخصوصیوسایرمراحلپشتیبانیباپذیرشمستقل.
2. پرداختزنده: initiationlease/Start/Verifyشبکه/callback/reconcile/sandbox/refundقراردادD16می‌خواهد؛نام/پروتکل/موفقیتجعلیساختهنشودوسؤالقبلیتکرارنشود. هلوliveD30ومنابعمجازبازار/نظرخارجینیزبازند.
3. ارسالجزئی/دیجیتال،مرجوعی/بازپرداخت،پروندهچک/مدارکخصوصی/سررسید،CMSپیشرفته/بلاگ،search/alert/loyaltyوباقیPRDلازم‌اند. ارسالکاملصرفاًفیزیکی۴۸پذیرفتهاست؛کلچرخهفروش/PDFکاملنیست.
4. mobile/WCAG/SEO/performance/CI/nativeLinux/load/offsitebackupومعیار۱۲گانهشاهدلازمدارند. Dockerfileپنلکدlib/componentsمشترکرامی‌آوردولیتستnativeLinuxآنپذیرفتنشدهاست. هزینه/مالیات/شرایطواقعیگارانتی/مرجوعی/چکنامعلوم؛mainSettings/Policyخاموش/providerغیرفعالاند. D14انتشارمحلی،D21نمونهفقطQA،D32Redisروشن،D33پاک‌سازی۱٫۶۷GiB،D34هدفکلپروژهحفظ‌اند.
