# وضعیت و نقطهٔ ادامه

2026-10-28 — **اصلی محلی۶۸، تأیید دریافت پیش‌پرداخت منتشر و پذیرفته است؛ کل پروژه کامل نیست و D34/D35 ادامه دارند.** [آرشیو پیش این برش](archive/STATUS-before-credit-upfront68-release.md)، PLAN/PRD/DECISIONS مرجع‌اند.

## اجرای اصلی۶۸

API5080 PID25743/session15412؛ `python3 tmp/credit-upfront68-release.py serve-api`؛ فروشگاه3000 PID25784/session87446، `python3 tmp/credit-upfront68-release.py serve-storefront`؛ پنل3173 PID25839/session87104، `node tmp/serve-credit-upfront68-main-admin.mjs`.

`tmp/{api,storefront,admin}-runtime-current.json` مرجع hash/session/restart؛ مجموعهٔ ثابت نهایی `tmp/credit-upfront68-session-runtime-set.json` با Next build `w-eCO47o07w6yYW4WpD_O` است. initial68 محفوظ و API/admin/proxy همان‌اند؛ فقط storefront پس اصلاح whitelist نشست مشتری دوباره ساخته شد. flagهای pending در runtime-set وضعیت انتشار نیستند؛ source-acceptance/main-release مرجع‌اند. current۶۸ و rollback۶۷/۶۶سایت‌مپ/۶۶HTTP/initial۶۶، helperdependency/key/backup/evidence محفوظ؛ tmp کامل حذف نشود.

۶۸migration/۱۸۴جدول/۱۲schema؛ فقط credit.UpfrontConfirmations/UpfrontEvents/UpfrontCommands اضافه و همه خالی‌اند. در توقف،۱۸۰جدول قبلی جز CreditHistory و۶۷migrationقبلی/schema/views دقیقاً حفظ؛ پس۱۷۹۶HTTP نیز۱۸۳جدول غیرنشست/schema/views/history ثابت. bookkeepingنشست جدا، بدونreset. همه۱۷۴۵HTTPقبلی و۱۰۱۵assetپنل+۳۳۲Next قبلی حفظ شدند.

Safety:stock101/0/0، Orders/Reservations/Settings/Policies/Sourcing/payments/Files/Support/Inbox وتمامcreditcases/terms/scopes/quotes/uses/links/schedules/cheques/ledger/upfront صفر. CMSsite3FAEN/auth1 محفوظ؛ pages/redirects خالی وsupport منتشر نشده. هیچpolicy/role/grant/seed/provider/CMSrule/indexاصلی فعال نشد. FilesDisabled؛D16درگاه/SMS/email وD30هلو اطلاعات واقعی ندارند و خاموش‌اند؛سؤالتکراری نشود. D32Redisپارسه روشن و دست‌نخورده است.

بکاپ متوقف COPY_ONLY/CHECKSUM/VERIFYONLY:23191552بایت،SHA `dff1670fd2780a6e6b5ad07e05a5f40a84189a4ac51756e84f5b2307d1e8a93a`،۱key بدونparsing؛ `main-pre-credit-upfront68-stopped-backup.json`. همان‌میزبان؛offsite/restore/nativeLinux هنوز پذیرفته نیست. D33 این برش cleanupساخت قدیمی نکرد.

## CREDIT-UPFRONT — پذیرش۶۸

[CREDIT-UPFRONT](CREDIT-UPFRONT.md)/A76/A77/API مرجع‌اند. FinanceMFA دریافت کاملِ مبلغ سرور از اصلquote/order و جمعچک‌ها را گواهی می‌کند؛ هزینه‌های خارجچک هم حساب می‌شوند. ConfirmReceiptمثبت، ConfirmNoUpfrontDueصریح برایصفر، RevokeConfirmationابطالگواهی با دلیل نهrefund، تأییدمجددrevisionتازه. یکheadهرorder؛ origin/event/receiptimmutable وDPمقید بهowner/order/actor/UUID،same-orderFK/noCascade/trusted،CAS+rootIdentitySalesCreditSerializable/auditاتمیک. تاریخچه۲۰تایی/سقف۲۰۰،همهchain+receiptهاهنگامخواندنتأییدمی‌شوند. اصلاحموجودپسcancel/expiryباackصریح؛دریافتتازهفقطopen+unexpired. calendarمبلغاصلراعوضنمی‌کند؛deadlineتمدید وScopeUseاحیانمی‌شود.

BankVerified/CanPay/CanFulfillهمیشهfalse؛Paidنقدی/VerifiedCashPayment/Inventoryallocation/ارسالایجادنشد. مجوزنهاییD35هنوزدرادامه است. مشتریفقطsummaryowned/read-only بدونمرجع/شرح/actor؛financehistoryخصوصی،query/originstrict/no-store/noindex/body8K/responsebounded،پراکسیبدونCookie/SetCookie. RAMjournalactorbound،unknownباGETهمانreceipt،auth/logoutپاکمی‌کند.

۱۰۷۶unit/کل۷۴۱SQL/۴۹۷front/۲۱۷admin/۱۹proxy پاس؛۱۰unit/۶SQL/۶front/۱proxy تازه. API/unit/SQL/harness/Nextisolated/admin build/typecheck وCreditmodelnopending؛۱۴DLLمحصولAPI/unit/SQL/harness/frozenبرابر. fullSQLاول۷۴۰پاس/۱fail آزمونقدیمیChequeLedgerکهlatestmigrationراLedgerفرضکرد؛فقطآزمونبهschemaLedgerپینوبعدlatestبرگشت،assertDown/محافظتتاریخچهومایگریشنمنتشرشدهضعیفنشد. fullrefined۷۴۱پاس/۰fail،۱۰دقیقه۲ثانیه؛productDLLثابت،لاگ/TRXاولمحفوظ.

۲۱SQLwireباdecoderنهایی:۱۳command/۵page/۱history/۱customer/۱receipt،صفرصریح/مثبت/revoke/replay پذیرفته. ۱۸browserwireواقعیSQL:۳POST/۳event/۳command/۳audit،۱cutپسcommit→۱GETهمانreceipt/۰duplicate؛بدونclientamount وreviewابتداfalse/actionخالی. دریافت۱۲۸۴۱۲۳۴۵ریال،ابطالگواهی/تأییدمجددقبلdeadlineنمونه؛هیچوجهواقعیوجودندارد. از۱۸۴جدولQA،فقط۳creditوUsers/Audit/Sessionsعوض؛۱۷۸دیگرexact،Paid0/ReceivedCheques0/ScopeUse1/stock101/reserved1بدونallocation. سفارشپسdeadlineطبیعیexpired،تمدیدنشد.

مرورگرواقعینقصwhitelistمسیرcustomerSessionرافاشکرد؛GETonlyاضافهوباآزمونخودSessionStore/logoutlateپوششدادهشد. storefrontنهاییجدافریز؛API/adminهمانartifact. مشتریFAdesktop1265=scroll1265،FA/ENmobile375=scroll375،مرجع/شرحخصوصیغایب؛adminmobile375/dialog330. cross-tablogoutفرمخصوصیذخیره‌نشدهراتب‌دومپاککرد؛JWTrevocationserverمعنایشعوضنشد؛سهconsole۰. همهmobile/actualdevice/WCAG/perfپذیرفتهنیستند.

QA_GUID7e7846f685aa45279c38173dccc926ed،key/credentials/native-session/tabs124–126/ports5181/5182/3105/3175جمع،viewportreset،هیچQA DBباقی‌نماند. شواهد artifacts/checks: `credit-upfront68-{source-acceptance,qa-cleanup,main-release}.json`، `credit-upfront-{sql-full-refined-wire,browser-wire}/acceptance.json`، `credit-upfront-browser-{ui,final-sql}.json`، mainbefore/after/post-smoke/public-smoke/backup.

## ادامهٔ آماده — D34/D35

**بعد: تأیید دستی تک‌تک چک‌های دریافت‌شده،مقید به نسخهٔ برنامه و وضعیت جاری سند؛سپس سیاست صریح مدت نگهداری برای سفارش جدید و مجوزنهایی مالی چکی/تعهدInventory/ارسال.** D35: «پس از دریافت پیش‌پرداخت و تأیید دستی همهٔ چک‌ها»؛منتظروصولهمهنباشد،humanreportبانک/Paidنقدی نیست. cancel/expiry/نسخه/گردشسند/authorityrace وaudit/idempotency لازم؛historicaldeadlineیاUsedScopeپنهانیاحیانشود. پاسخمالیداریم،سؤالتکراریلازم نیست.

قبول۶۷redirect و۶۶CMSpages/sitemap و۶۵ledger وسایربرش‌هادرآرشیو/اسنادخودمحفوظ‌اند. نقصقدیمیHTTP200محصولناموجودpreviewپسstreamباز؛gate404واقعیCMSمحفوظ. سپسblog/SEO،وصولواقعی/یادآوری/سازمانی،ارسالجزئی/دیجیتال/مرجوعی/refund،search/alerts/loyalty/EXT،SignalR/retention/restoreobject+keyring،mobile/WCAG/perf/CI/observability/DockerLinux/load/offsite/۱۲معیارPDF. پایانبرشپایانD34نیست.

### برش فعال بعد۶۸ — CHEQUE-APPROVALS/A78

source69 در ساخت، main۶۸ثابت: قرارداد/سهجدولappend-only/service/DP/rootAPI،جورنالپنل/فرمبازبینیوخلاصهFAENcustomer/BFF/SessionStoreGETonly ساختهشدند. modelnopending،۱۰unitهدفمند/۱۰۸۶unitکامل،۶SQLهدفمند،۲۵wireهدفمندباdecoderتولیدی،۵۰۳front،۲۱۷admin و۲۰proxy پاس‌اند. targetاول۵پاس/۱failنقصcanonicalownerدرخواندنcustomer؛VerifiedمالکراهمانقاعدهActorهمیشهcanonicalمی‌کند. targetrefinedبعداصلاحمحصول۵پاس/۱failفقطفرضسهقسطآزمون،برنامهواقعی۶خطداشت؛assertبهتعدادخطوطواقعیمقیدشد؛targetfinal۶پاس. proxyاول۱۸پاس/۲failبه‌دلیلتغییرمتنیزیادیفقطدرsource،محدودبهCreditاصلاحوباز۲۰پاس. لاگ/TRXهایقبلیمحفوظ،mainدست‌نخورده. API/unit/SQL/harness۱۴DLLیکسان؛fullSQL747درحالاجرا،محصولهنگامtesthostبازbuildنشود. NextbuildاولمتوقفوbuildنهاییباformatTomanاستاندارددرحالاجرا،adminبعدrefreshinvalidationدوبارهbuildمی‌شود. هنوزfreeze/مرورگر/QAcleanup/main69پذیرفتهنیست؛مجوزنهاییD35وholdpolicyصریحبعدازاینبرش‌اند. CHEQUE-APPROVALSمرجعطرح.
