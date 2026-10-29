# وضعیت و نقطهٔ ادامه

2026-10-27 — **اصلی محلی۶۳، سفارش موقت چکی با مجوز یک خرید پذیرفته/منتشر است. کل PDF/پروژه کامل نیست؛ D34 ادامه دارد.** [آرشیو پیش۶۳](archive/STATUS-before-credit-order63-release.md) جزئیات۶۱ و تاریخچهٔ قبل را حفظ می‌کند. PRD/PLAN/DECISIONS مرجع دامنه‌اند.

## اجرای اصلی۶۳

- API http://127.0.0.1:5080 — PID61178/session48239؛ `python3 tmp/credit-order63-release.py serve-api`.
- فروشگاه http://127.0.0.1:3000 — PID61209/session58295؛ `python3 tmp/credit-order63-release.py serve-storefront`.
- پنل http://127.0.0.1:3173 — PID61262/session80528؛ `node tmp/serve-credit-order63-main-admin.mjs`.
- `tmp/{api,storefront,admin}-runtime-current.json` مرجعhash/path/session/restart؛ `tmp/credit-order63-runtime-set.json` candidateثابت،Next build `6I6EhxY2JYGugbFH4N86t`. sourcecandidateپیش‌پذیرشعمداًimmutableمانده؛source-acceptance/main-releaseوcurrentdescriptorمرجعوضعیتنهایی‌اند.
- SQL۶۳migration/۱۶۹جدول/۱۲schema؛دوجدولخالیcredit.PurchaseScopeUses/sales.CreditOrderLinks،ستونChequeOrdersEnabledbitdefaultfalse،افزودنScopeUsedبهgrammarموجود. **۱۶۵جدولقبلیجز۲historyexact؛تمام۶۱migrationقدیمی/schemaجز۲تغییرصریح/viewمحفوظ.** پس۱۴۸۵HTTP،۱۶۸جدولغیرنشست/schema/view/history/safetyexact؛نشستعادیزندهجداوبدونresetحفظشد. تمام۱۴۲۷HTTPقبلی/۸۴۲assetپنل/۲۸۷Nextحفظ‌اند.
- safety: onHand101/reserved0/sourcingReserved0؛Orders/Reservations/Settings/Policies/SourcingRequests/paymenthistory/Support/Inbox/Files/همهٔCreditcase/شرایط/رضایت/مدرک/ارسال/review/scope/creditquote/use/linkاصلیصفر. CMSsite3FAEN/auth1محفوظ،supportCMSمنتشرنشده/FAQپنهان. seed/role/grant/policy/متنحقوقی/providerفعال‌نشد.
- FilesاصلیDisabled؛D16درگاه/SMS/email وD30هلو ناشناخته/خاموش‌اند؛سؤالتکرارینشود. شرایطواقعیبایدازپنلتعیینشوند. RedisپارسهD32روشن/دست‌نخورده.
- بکاپمتوقفCOPY_ONLY/CHECKSUM/VERIFYONLY:۲۲٬۱۴۲٬۹۷۶بایت،SHA `ea14bb889fda954e293dfdacf00c9f0f7d380f304899a04e637a68b21dca0b2c`،۱keyبدونparsing؛ `main-pre-credit-order63-stopped-backup.json`. همان‌میزبان؛offsite/restore۶۳/nativeLinuxپذیرفتهنیست. current/rollback/restart/keys/backups/evidenceدرtmpحفظ؛حذفکاملtmpممنوع.

## سفارش موقت چکی۶۳ پذیرفته

[CREDIT-ORDERS](CREDIT-ORDERS.md)،A64/A65 وAPIمرجع‌اند. مشتریهمانquote/fingerprintراصریحبااطلاعاتتماس/آدرسودوتأییدبازبینیمی‌پذیرد؛بدونclientmoney/owner/scope/expiry. SharedKernelCreditدوبارهمالک/نسخه/currentreview/submission/طرح/expiry/عدمابطال/عدمUseراکنترل،rootIdentity/Sales/Catalog/Inventory/Payments/CreditSerializable/auditباowner→Credit→cart/allocation→Stockهمهرااتمیکمی‌کند. deadlineعادیabsولوتlegacyوacceptedخط‌محورV2است؛maxopen/stock/charges/settingscurrent/priceنسخهکنترل. Quote3/5/قیمتتوافقی/usedreportقدیمیحفظ‌اند.

Useimmutableیکscope→یکorder/creditquote/fingerprint؛Usedدیگرquote/revokeنمی‌شود،grant/reviewreceiptتاریخیتغییرمعناندارند. لغویاexpiryفقطstockراآزادمی‌کند،مجوزهرگزاحیانمی‌شود. receiptاولیهٔرمزشدهپسcancel/expiryreplayهماناست؛currentorderجدا. **AwaitingPayment/credit_settlement_pending/CanPayfalse؛وصول/پیش‌پرداخت/Paid/سررسیدقطعیپیاده‌سازی‌نشده.** Quote۶۱canPlaceOrderfalse/blockerتاریخیهمان؛consumerجداسفارشمی‌سازد. ChequeOrdersEnabledمستقلdefaultfalse،cashflagقبلیهمان؛legacyinputکهفیلدتازهنداردمقدارجاریراپنهانیعوضنمی‌کند. اصلیSettingsنداردوبه‌صورتضمنیسفارشیفعالنیست.

حساب `/fa|en/credit/purchases` تاریخچه۲۰تاییownedSQL+originalquote+orderrelatedدارد؛reload/localeSwitchحفظ،resultRAMدرrefreshپاکولیSQLدرحسابدردسترس. unknown→همانcommandreceipt/retry؛logoutخصوصیراازتب‌دیگرپاکمی‌کند. پنلreadonlyاطلاعاتمجوز/اقساط باMFA+sales.write،بدونتأییدوصول/اسنادحساسReviewer؛هرروشflagجدا.

۹۹۳unit/کل۷۰۷SQLواقعی/۴۵۳storefront/۲۱۴admin/۱۴proxy،build/typecheck/modelnopending/۱۴DLLبرابرپذیرفته. Shop.slnشاملSQL/harnessنیست؛صریحbuild/tطبیق. ۱۱SQLتازه ordinary/mixed/accepted-only،lastunit،raceorder/revoke/replay،auditrollback،expiry،owner/MFA،strictinput/SQLbudget/FK/Downوflagمستقل. ۴۳SQLwireباdecoderتولیدیوبindingعینquote؛۱۶orderreceiptشامل۴accepted/۶replay. تستاولfull۷۰۲/۱failureتستقدیمیShipmentباschemaقدیمیبود؛تستmigrationخودشpin/پیشHTTPوپسguardreupgradeکلsourceشد؛migrationمنتشرشدهضعیفنشد. fullنهایی۷۰۷/۰.

مرورگر۱quote/۱POSTموفقپسcommitقطع→۱GETreceipt/۰POSTتکراری،۱order/use/audit؛مبلغ۴۴۵٬۹۸۸٬۳۴۵ریال/scope۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۰،cancel→stock0/Used. **مرورگراینبرشفقطordinary؛mixed/accepted-onlySQLپذیرفته.** ۲۱wire/۱GETخطایموقتی→reselectهمانردیفبعداصلاحبازیابی. reload/FA→EN/historyپسquoteexpiry،adminstaffMFA/flagSave2بار،FAENmobile390×844client=scroll375 وdesktop1280client=scroll1265،پنلموبایل375/375،۰console/خروجacrosstabsپذیرفته. actualdevice/WCAG/perf/کلmobileادعانیست.

از۱۶۹QAجدول،۳۲مجازتغییر/۱۳۷دیگرexact؛chargepolicyD21ثابت،Settingsپایانcashfalse/chequetrue/60min/max2،stock101/0/0،Files0. شرایط/رضایت/reviewفقطساختگیصفرمدرکوغیرحقوقی؛شخصواقعیارزیابینشد. QA_GUID `SaymanTest_Ui_89b6c9fe0d9c4e8ca44acae11f56675f`/keys/credential/tab102–105/ports3105/3175/5181/5182جمعوviewportresetشد؛Dockerresourceجدیدنساخت.

guardانتشاراولdefaultرا((0))فرضکرد؛SQLواقعی(CONVERT([bit],(0)))بود. فقطguardباfalseواقعیتطبیق/afterدوبارهخواندهشد،migrationتکرارنشد. همهٔقبل/بعد/شواهدخطاحفظ. نمونهQAبهmainمنتقلنشد. sourceUI2اصلاح(عنواننوعاقلامپنل/reselectتاریخچه)باcandidateقبلیحفظ/بیلدنهایی/بازبینیمرورگرپذیرفته؛API/SQLدراین۲اصلاحعوضنشد.

شواهددرartifacts/checks: `credit-order63-{source-acceptance,main-release}.json`، `credit-order-browser-{ui,final-sql}.json`،`credit-order-browser-wire/acceptance.json`،`credit-order-sql-full-accepted-wire/acceptance.json`و`credit-order63-qa-cleanup.json`.

## ادامهٔ آماده — D34

1. CREDIT-02: سررسیدصریح/چک/پیش‌پرداخت/وصول/برگشت/یادآوری/گزارشمالی/اعتبارسازمانی،بدونتفسیرخودکارPendingیاشبیه‌سازیبانک. طرحابتدااسنادوقراردادماژولی،مبالغازsnapshot،finance.write+MFA/audit/idempotency؛CanPay/Paid/ارسالبدونتأییدمالیمعتبرایجادنشود.
2. ارسالجزئی/دیجیتال/مرجوعی/بازپرداخت،CMSپیشرفته/blog/SEO،search/alert/loyaltyودیگرPRD. هسته‌هایبازار/هلو/کارکرده/review/compare/Support/Inbox/SignalR/Files/Payment/Fulfillmentدراسناستقلالی/آرشیومحفوظ؛اسکلت/adapterخاموشکاملنیست.
3. mobile/WCAG/perf/CI/observability/nativeLinux/load/offsitebackup/restoreobject+keyringو۱۲معیارPDFشواهدجدامی‌خواهند. D14/D21/D32/D33/D34پابرجا؛انتهایبرشانتهایهدفنیست.

## برنامهٔ سررسید پس۶۳ در ساخت

A66/CREDIT-SCHEDULES طراحی نسخهٔ بعدی را ثبت می‌کنند: انتخاب صریح تقویم/تاریخ مبنا، مبلغ و فاصلهٔ ماه از snapshot، تفکیک پرداخت اولیه از downpayment، revision/receipt/audit و قرارداد SharedKernel. هنوز پذیرش/انتشار ندارد؛ main63 ثابت است.

### پیشرفت سورس۶۴، برنامهٔ سررسید (پذیرش نهایی ندارد)

SharedKernelCreditOrderScheduleSource/Salesreader+queueفقطCreditOrder،CreditScheduleContracts/Calculator/Facts/Model/Service،APIrootIdentityCreditSales/finance.read-writeMFA/customerowned/DPprotectorpurposeجداافزوده‌اند. تقویمصریحوتاریخمبنایبدونdefault،DateOnlyGregorianروزمدنیAsiaTehran،کلپرداختاولیهشاملdown+هزینهٔخارجچک. Revision/Line/Commandimmutable+MACreceipt،expectedOrderVersion/expectedScheduleVersion/previewFP،raceowner-firstوaudit،CanPay/CanFulfillfalse. Migrationمنتشرنشده `20261027135258_ChequeSchedules` سهجدولcredit.ChequeScheduleRevisions/Lines/CommandsوAKرویUse(OrderId,ScopeId)،Downفقطnonemptyخودشانguardاست. Schemaموردانتظار۶۴/۱۷۲جدول؛main63تغییرنکرده.

۸تستمحاسبات/تقویمپاس،۴SQLاولیهSave/amend/history/cancel/replay/auditrollback/role/strictinput/FK/Downپاس؛پسآنDTOpreviewبهPlanName/Locale/QuoteId/FPوPage/QueueبهOrderVersionتکمیلشدندو۲SQLrace/edit/expiry/tamperو۲unitDP/immutableافزوده‌اند؛اینآخرینتغییراتهیچتسترنجدیدنگرفته‌اند. build6/APIunitوSQLbuild3موفق؛CreditmodelnopendingقبلتکمیلDTO(بدونEFتغییر)بود. `credit-schedule-sql-targeted-wire` مربوطبهDTOقبلتکمیل/۴SQLاستوفاینالنیست. sourceZod `apps/storefront/lib/credit-schedule-contract.ts` تازهساخته/هنوزtypecheckوتستندارد. UI/BFF/journal/adminproxy/harness/مرورگر/sourceacceptance/release۶۴هنوزنساخته‌اند.

ادامه:Productiondecoders/journal/BFFوپنلمالیجدا(نیازبهqueueفقطCreditOrder؛FinanceManagerبدونsales.writeبهcontactدسترسینگیرد)،نمایشبرنامهٔownedدرOrderمشتری،تست‌هایSQL/مدل/۱۴DLL/full وactualwire/مرورگرQA/cleanup/backup/preservation/mainrelease. هنوزوصول/بانک/یادآوری/اعتبارسازمانیپیاده‌سازی‌نشده. Source64دارایمحاسبهفقطبرنامهPlannedاستنهتعهدوصول.
