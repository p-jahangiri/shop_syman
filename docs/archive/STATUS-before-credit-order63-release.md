# وضعیت و نقطهٔ ادامه

2026-10-27 — **اصلی محلی۶۱، محاسبهٔ خرید چکی مقید به مجوز پذیرفته/منتشر است. کل PDF/پروژه کامل نیست؛ D34 ادامه دارد.** [آرشیو پیش۶۱](archive/STATUS-before-credit-checkout-quote61-release.md) پذیرش۶۰ و تاریخچهٔ قبل را نگه می‌دارد. PRD، PLAN و DECISIONS مرجع دامنه‌اند.

## اجرای اصلی۶۱

- API http://127.0.0.1:5080 — PID85645/session41714؛ `python3 tmp/credit-checkout-quote61-release.py serve-api`.
- فروشگاه http://127.0.0.1:3000 — PID85697/session59098؛ `python3 tmp/credit-checkout-quote61-release.py serve-storefront`.
- پنل http://127.0.0.1:3173 — PID85748/session94892؛ `node tmp/serve-credit-checkout-quote61-main-admin.mjs`.
- `tmp/{api,storefront,admin}-runtime-current.json` مرجع path/hash/session/restart؛ candidate ثابت `tmp/credit-checkout-quote61-runtime-set.json`، Next build `0ICaOj4wDOz4BiWEJu75V`، API mode وpreviewخاموش است. پنل در۶۱ UIتازه‌ای برایquoteمشتری ندارد؛ فرم‌هایشرایط/review/scopeپذیرفتهٔ۶۰ محفوظ‌اند.
- SQL۶۱migration/۱۶۷جدول/۱۲schema؛ فقط sales.CreditCheckoutQuotes خالی افزوده شد. **۱۶۵جدول قبلی جزSalesHistory در ارتقای متوقف exact؛ تمام۶۰migration و تمامschema/viewقبلی محفوظ‌اند.** پس۱۴۲۷HTTP تمام۱۶۶جدول غیرنشست/schema/view/history/safety exact؛ نشست عادی زنده جدا/بدونreset حفظ شد. تمام۱۳۸۳HTTP قبلی و۱۲مرزخصوصی جدید401 و۸۱۸assetپنل/۲۷۹Next قبلی محفوظ‌اند.
- safety: onHand101/reserved0/sourcingReserved0؛ Orders/Reservations/Settings/Policies/SourcingRequests/paymenthistory/Support/Inbox/Files/همهٔCreditcase/شرایط/رضایت/مدرک/ارسال/review/scope/creditquote اصلی صفرند. CMS site3FAEN/auth1 محفوظ، supportCMSمنتشرنشده/FAQپنهان. seed،role/grant،policy/متنحقوقی/provider فعال نشد.
- **Files اصلی Disabled، ارائه‌دهندگان D16/D30 ناشناخته/خاموش‌اند**؛ اطلاعات آن‌ها سؤال تکراری نشود. شرایط واقعی هنوز ازپنل بایدتعیین‌شوند. Redis پارسه طبقD32 روشن/دست‌نخورده است.
- بکاپ متوقفCOPY_ONLY/CHECKSUM/VERIFYONLY:21,094,400بایت،SHA `4c0efdb7cbe093a01452be89821ace2ebac0b36d0b0d0e7a48fba038cd9a71db`،۱keyبدونparsing؛ `main-pre-credit-checkout-quote61-stopped-backup.json`. همان‌میزبان؛ offsite/restore۶۱/nativeLinux پذیرفته نیست. current/rollback/restart/keys/backups/evidence درtmpحفظ‌شوند؛ حذفکاملtmpممنوع است.

## محاسبهٔ چکی۶۱ پذیرفته

[CREDIT-CHECKOUT-QUOTES](CREDIT-CHECKOUT-QUOTES.md)، A62/A63 و API مرجع‌اند. مشتری همان حساب/طرح، پروندهٔApprovedوscope را **بدون انتخاب پیش‌فرض** مشخص می‌کند؛ فقط cartVersion/methodId/planId/applicationId/scopeId/applicationVersion/scopeVersion+UUID، بدونمبلغ/قیمت/expiry. root Identity/Sales/Catalog/Inventory/Payments/Credit Serializable وgateReq→App→cart/allocations/stock، همانمالک/نسخه/currentReview/sub/scope/طرحفعال/expiry/عدمابطال را ازقراردادCredit دوباره کنترل می‌کند.

سبدعادی ازهستهQuote3 وaccepted/mixed ازQuote5است؛ snapshotقدیمی تغییر معنا ندارد، قیمتتوافقی باقیمتروز عوضنمی‌شود وusedreportحفظاست. UUIDهستهdomain-separatedاست. sidecarimmutable با protectedreceipt وhash/fingerprint/metadataمقید،auditاتمیک وFKبهquoteاصلی دارد. رسیدپسexpiry/revoke/pricechange عینقبلیاست. مبناPayableTotalیاجمعcheckedچک‌هابدونdownpayment؛ ریالlong/string/BigInt، سقف/expiryعینscope وValidUntil=min(scope,base). هزینهٔunknownحتیدرbasisقسطblockerمی‌ماند. طرح100٪پیش‌پرداخت،صفرچک ومبلغقسط۰ درdecoderQuote5باcalculatorموجودهمراستاشد؛BackendQuote5قدیمیعوضنشد.

**canPlaceOrder/canPay=false؛ credit_order_not_configured**. محاسبه مصرفscope/بودجهگردان/order/reservation نیست. CREDIT-01/02 وclaimیک‌بارمصرف/رضایتquote/سررسید/وصول/برگشت/یادآوری بازند. scope۶۰ فعلاًاصلاًUsedندارد؛ قبلorder بایدUsedguard/raceRevokeهمراهclaimاتمیک افزودهشود.

۹۸۹unit/کل۶۹۶SQLواقعی/۴۴۴storefront/۲۱۴admin/۱۳proxy،build/typecheck/modelnopending و۱۴DLLواحد/API/SQL/harness/frozenبرابر پذیرفته‌اند. Shop.slnشاملSQL/harnessنیست؛صریحbuild/tطبیق شوند. ۷SQLجدید ordinary/mixed/accepted-only،مالک/Finance/strictbody/بزرگریال/۲basis/unknowncharges/limit/planchange/expiryclip/historicalreceipt/auditrollback/concurrentreplay/racequote-revoke/FK-CHECK/immutableDownرا پوشش دادند. ۱۸SQLwireباdecoderتولیدی:۱۴ordinary/۴accepted/۶replayed/۳expiryclip.

آزموناولfullSQL۱۲failureداشت: Downجدولجدیدبی‌دلیلoldQuotes/Ordersرامانعمی‌شد؛ فقطجدولجدیدnonemptyguardشد. آزمونقدیمیCashLinkفرضlatestداشت؛وجودmigrationقدیمیراصریحبررسیوguardرا مانندOrder2/Quote4درنقطهٔmigrationخودشآزمود وreupgradeتمامhistory/modelراثابتکرد. fullبعدی۱failureهمینpinبود؛fullنهایی۶۹۶/۰است. خطایاولFKnvarchar/varcharوlegacyexpectFinance403→404اصلاحشد؛هیچداده/مجوزمحصولبرایعبورضعیفنشد. اجرایunit/proxyدرsandboxبهsocketEPERMخورد؛باloopbackمجوزدارموفقشد. شاهدهایابتداییحفظ‌اند.

مرورگر۳quoteساختگی(۲FA/۱EN)،۱قطعپاسخموفق→۱GETreceipt/۰duplicate؛۴wireدقیقبارشتهریال. مبلغسرور۴۴۵٬۹۸۸٬۳۴۵ریال،shipping۱۲۳۴۵/exemptفقطD21QA،scope۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۳،۳auditو۰order/reservation/settings/files. یکcase→consent→submit→Approve→Grant→ownerRevokeکاملاًساختگی،صفرمدرکصریحدرشرایطغیرحقوقیQA. **accepted-offerدرSQLپذیرفته؛UIمرورگراینبرش فقطسبدعادیبود**. از۱۶۷جدولQA،۲۴مجازتغییر/۱۴۳دیگرexact؛stock/policyنمونهپسbaseline/settings/filesمحفوظ.

فرمفعالFAموبایل ونتیجهFA/ENدر۳۹۰×۸۴۴client=scroll۳۷۵،desktop۱۲۸۰client=scroll۱۲۶۵؛۰overflowو۰consoleدر۵تب. quoteجدیدپسrevokeرد،پسrefreshدکمهبسته/ابطالصریح؛نتیجهقدیمیرویصفحهقبلیمحفوظ. logoutدرENنتیجهخصوصیFAراازتب‌دیگرهمبلافاصلهحذفکرد. **تغییرزبانwindow.location.assignبارگذاری‌کامل‌است وRAMreceiptراپاکمی‌کند؛بازیابیپسreload/localeSwitchپذیرفتهنیست؛SQLreceiptتاریخیحفظاست.** actualdevice/کلmobile/WCAG/performanceپذیرفتهنیست.

بررسیخودکاراولgatewayوسیعQAرابه‌دلیلاحتمالثبتاطلاعاتخصوصیردکرد. نسخهٔمحدودفقطمسیرcreditquote،schemaسخت‌گیرقبلذخیره،بدونهدرAuth/Cookie/login/MFA/شرایط/یادداشتاجراشد؛اینراهامنپذیرفتهشدوبلاکیباقینماند. auth-rate-limitمحصولتغییرنکرد. actualS3/ClamAVاینبرشاجرانشد؛شاهد۵۷جداست.

شواهد: `credit-checkout-quote61-{source-acceptance,main-release}.json`، `credit-checkout-quote-sql-full-accepted-wire/acceptance.json`، `credit-checkout-quote-browser-{ui,final-sql}.json`، `credit-checkout-quote-browser-wire/acceptance.json` و `credit-checkout-quote61-qa-cleanup.json` درartifacts/checks. QA_GUID `SaymanTest_Ui_ec4a5480b5dc4eb4b326df6d970a3eec`/keys/credentialsحذف،تب۹۷–۱۰۱/پورت3105/3175/5181/5182جمعوviewportresetشد؛Dockerresourceتازهنداشت.

## ادامهٔ آماده

1. سفارشچکی: رضایتدقیقquote/نسخه/expiry،claimیک‌بارمصرفCreditازقراردادSharedKernel،order/reservation/auditاتمیک وraceexpiry/revoke/cancel/replay؛ currentplan/price/stock/charges/settingsدوبارهکنترل،ordinary/accepted/usedsnapshotمحفوظ. پنل/مالکبایدبدانندscopeمصرف‌شدهدیگرقابلquote/revokeنیست؛سفارشثبت‌شدهپرداختیاوصولچکنیست. دسترسیرسیدهایquoteپسreloadنیزدرهمینجریانکاملشود. بعدCREDIT-02.
2. ارسالجزئی/دیجیتال/مرجوعی/بازپرداخت،CMSپیشرفته/blog/SEO،search/alert/loyaltyوبقیهPRD. هسته‌هایبازار/هلو/دست‌دوم/review/compare/Support/Inbox/SignalR/Files/Payment/Fulfillmentدرآرشیو/اسنادمستقل‌اند؛اسکلت/adapterخاموشکاملنیست.
3. mobile/WCAG/perf/CI/observability/nativeLinux/load/offsitebackup/restoreobject+keyringو۱۲معیارPDFشواهدجدامی‌خواهند. D14/D21/D32/D33/D34پابرجاست؛انتهایبرشانتهایهدفنیست.

## سفارش چکی پس۶۱ در ساخت

A64 و CREDIT-ORDERS طراحی claimیک‌بارمصرف/rootorder/reservation/receipt و دسترسی پسreload را ثبت می‌کنند. هنوز سورس/SQL/UI/مرورگر سفارش چکی پذیرش ندارند؛ main61 فعال و بدون تغییر است. شمارهٔ schema بعدی با دو migration ماژولی Credit/Sales از شمارش واقعی ثبت می‌شود.

### پیشرفت سورس۶۳ (هنوز منتشر نشده)

دوmigrationمنتشرنشده PurchaseScopeUses/CreditOrderLinks وflagمستقلchequeOrdersEnabled(defaultfalse)؛claim/order/reservation/auditاتمیک،Usedguard/revoke،ordinarylegacy/acceptedV2محفوظ. تاریخچهٔ۲۰تاییownedازSQL،currentorder+originalcalculation،RAMsamecommandrecovery و پنلreadonlysales.write/MFA افزوده‌اند. ۶SQLهدفمندordinary/mixed/accepted-only/race/auditrollback/history،۲۷wireباdecoderتولیدی،۹۹۳unit/۴۵۳storefront/۲۱۴admin/۱۴proxy موفق؛بیلدUI/Backend/modelnopendingموفق. آزمونfullSQLاول درحال‌اجرا یکmigrationtestقدیمیShipmentرا بافرضschemaقدیمی/مدلجدیدشکست؛تستدرنقطهٔmigrationخودشpinوپیشازHTTPمدلجاریreupgradeشد. خودmigrationمنتشرشدهضعیفنشد. آزمون‌هایlastunit/expiry/staff/guard/flagمستقل تازه افزوده/هنوزbuildوراننشده‌اند. main61بدونتغییر؛پذیرشمرورگر/QAcleanup/backup/mainrelease۶۳ انجام‌نشده‌اند.
