# وضعیت و نقطهٔ ادامه

2026-10-27 — اصلی محلی۶۴: برنامهٔ سررسید چک‌ها پذیرفته و منتشر است. کل PRD/PDF کامل نیست و D34 ادامه دارد. [آرشیو پیش۶۴](archive/STATUS-before-credit-schedule64-release.md) و اسناد هر قابلیت، شواهد گذشته را حفظ می‌کنند.

## اجرای اصلی

- API: http://127.0.0.1:5080؛ PID31672/session4009؛ `python3 tmp/credit-schedule64-release.py serve-api`.
- فروشگاه: http://127.0.0.1:3000؛ PID31673/session91399؛ `python3 tmp/credit-schedule64-release.py serve-storefront`.
- پنل: http://127.0.0.1:3173؛ PID31669/session65925؛ `node tmp/serve-credit-schedule64-main-admin.mjs`.

`tmp/{api,storefront,admin}-runtime-current.json` مرجع مسیر/hash/session/restart است. `tmp/credit-schedule64-runtime-set.json` نامزد ثابت پیش از پذیرش است؛ source-acceptance/main-release و descriptor مرجع وضعیت نهایی‌اند. Next build `pQ5AWGZ45FL1um95RvTE8`.

SQL:۶۴migration/۱۷۲جدول/۱۲schema. سه جدول خالی credit.ChequeScheduleRevisions/Lines/Commands و AK روی PurchaseScopeUses(OrderId,ScopeId) اضافه شدند. ۱۶۸جدول قبلی جز credit migration history، همهٔ۶۳ migration قبلی و schema جز AK صریح و تمام viewها دقیقاً حفظ شدند. پس از۱۵۴۳HTTP،۱۷۱جدول غیرنشست/schema/view/history/safety ثابت؛ نشست زنده جدا و بدون reset حفظ شد. همهٔ۱۴۸۵HTTP و۸۶۹assetپنل/۳۰۴Next قبلی پوشش دارند.

Safety اصلی: onHand101/reserved0/sourcingReserved0؛ Orders/Reservations/Settings/Policies/Sourcing/paymenthistory/Files/Support/Inbox و تمام پرونده‌ها/شرایط/مجوز/quote/use/link/schedule چکی صفر. CMSsite3FAEN/auth1 ثابت؛support منتشر نشده. نمونهٔQA به اصلی منتقل نشده؛ policy/seed/role/grant/provider فعال نشده. Files اصلی Disabled، D16 درگاه/SMS/email و D30 هلو بدون اطلاعات واقعی خاموش‌اند؛ سؤال تکراری نشود. D32 Redis پارسه روشن و دست‌نخورده.

بکاپ متوقف COPY_ONLY/CHECKSUM/VERIFYONLY: 22142976بایت، SHA `553572a728233240a710597ffdb1ad00fe7ce4442aefacee83cb5598c8798fa9` و۱key بدون parsing؛ `artifacts/checks/main-pre-credit-schedule64-stopped-backup.json`. همان میزبان، بدون ادعای offsite/restore۶۴/nativeLinux. پاک‌سازی مجاز ۵۴buildقدیمی۵۵–۶۰،۱٫۶۸GiBواقعی آزاد کرد؛ هش اصلی۶۳/بازگشت۶۱/نامزد۶۴ محفوظ (`tmp-credit64-cleanup-applied.json`). اکنون current۶۴ و rollback۶۳ و تمام restart dependencies/keys/backups/evidence حفظ شوند؛ tmp کامل حذف نشود.

## برنامهٔ سررسید پذیرفته

[CREDIT-SCHEDULES](CREDIT-SCHEDULES.md)، A66/A67 و API مرجع‌اند. مدیر finance.write+MFA تقویم شمسی/میلادی و تاریخ مبنا را صریح و بدون default انتخاب می‌کند. مبالغ/MonthOffset از quote محفوظ Sales با قرارداد SharedKernel؛ DateOnly روز مدنی تهران و eventها UTC. پیش‌پرداخت طرح، هزینهٔ خارج چک، کل پرداخت اولیه، جمع چک‌ها و مبلغ نهایی جدا هستند. جمع و overflow checkedlong، JSON رشتهٔ ریال/JSBigInt.

root Identity/Sales/Credit Serializable با owner gate و actor+command idempotency/audit، کنترل نسخه‌های سفارش و برنامه و fingerprint پیش‌نمایش دارد. revision/line/command immutable با رسید purposeجدا و FK به Use همان سفارش؛ اصلاح نسخهٔ تازه می‌سازد، گذشته بازنویسی نمی‌شود. cancel/expiry با ثبت سری می‌شوند؛ replay تاریخی بعد از بسته‌شدن ثابت است. مشتری فقط برنامهٔ سفارش خودش و تاریخچه۲۰تایی را می‌خواند. صف مالی فقط سفارش‌های چکی و بدون contact؛ finance مستقل از sales.write/Reviewer. BFF/private/no-store/noindex/strict body/query و RAMjournal actorbound، unknown recovery و guard بین صفحه‌ها پذیرفته‌اند.

**Planned سررسید است؛ دریافت فیزیکی چک، وصول بانکی، پیش‌پرداخت، Paid یا اجازهٔ ارسال نیست.** canPay/canFulfill false؛ C2 وصول/برگشت/یادآوری/اعتبار سازمانی همچنان باز است. سفارش موقت۶۳/Use غیرقابل احیا/quote3و5/usedوaccepted/cashflagقدیمی حفظ‌اند؛ ChequeOrdersEnabled مستقل defaultfalse و اصلی Settings ندارد.

۱۰۰۵unit/کل۷۱۶SQL/۴۶۲storefront/۲۱۴admin/۱۵proxy موفق؛۱۴DLL API/unit/SQL/harness/frozen برابر، Credit/Salesmodelnopending. SQL: ماه‌شماری/آخرماه/کبیسه/بزرگ‌ریال/صفر/overflow، revision/history21paging/role/MFA/owner، stale/racecancel-amend/replay/auditrollback، expiry/tamper/FK/immutable/Down. تست قدیمی تغییر کلید Use با AK تازه توسط EF زودتر رد می‌شد؛ تست nonkey برای۴Saveguard و key برایEF تفکیک شد؛ guard محصول ضعیف نشد. ۷۵SQLwire با decoder تولیدی و binding واقعی،۲بزرگ‌ریال و تاریخچه ثابت؛ ordinary/mixed/accepted-onlySQL.

مرورگر۲preview/۲POST/۱قطع پاسخ بعد commit→۱GETreceipt و۰POSTتکراری؛ guard پس تغییر صفحه،۲revision با تقویم متفاوت و مبلغ برابر؛ upfront128412345/cheques317576000/payable445988345ریال. cancel→stock0/Useمحفوظ و ویرایش بسته، تاریخچه پس reload/FA→EN و خروج بین تب‌ها پاک؛۵console خالی. عرض۳۹۰×۸۴۴ فارسی/انگلیسی/پنل client=scroll375، desktop1265. مرورگر فقط ordinary؛ mixed/accepted-onlySQL. actualdevice/WCAG/perf/کلmobile پذیرفته نیست.

از۱۷۲جدولQA،۳۴تغییر مجاز و۱۳۸دیگر دقیقاً ثابت؛ policy و settings QA همان D21،۱order/use/cancel و۲schedule/command/audit و۶line. QA_GUID a4099985defd48578bbbf15f4556d99a،keys/credentials/تب۱۰۶–۱۱۰/ports3105/3175/5181/5182 جمع و viewportreset؛ Dockerresource جدید نساخت. شخص/مدرک/وام/پرداخت واقعی بررسی نشد.

شواهد artifacts/checks: `credit-schedule64-{source-acceptance,main-release}.json`، `credit-schedule-browser-{ui,final-sql}.json`، `credit-schedule-browser-wire/acceptance.json`، `credit-schedule-sql-full-wire/acceptance.json`، `credit-schedule64-qa-cleanup.json`.

## ادامهٔ آماده — D34

1. CREDIT-02: دریافت و گردش چک، ثبت/تطبیق پیش‌پرداخت، وصول/برگشت/یادآوری/گزارش مالی و اعتبار سازمانی؛ فقط واقعیت ثبت‌شده با MFA/audit/receipt و مالکیت ماژول. دریافت دستی یا برنامهٔ Planned به معنی bank verification/Paid نیست. چرخهٔ رزرو کوتاه سفارش چکی باید پیش از نگهداری بلندمدت چک به تصمیم معتبر مالی/قرارداد تحویل متصل شود؛ بدون احیای scope یا ازدست‌رفتن تعهد موجودی.
2. ارسال جزئی/دیجیتال/مرجوعی/بازپرداخت،CMSپیشرفته/blog/SEO،search/alert/loyalty و باقیPRD.
3. پذیرش mobile/WCAG/perf/CI/observability/nativeLinux/load/offsitebackup/restoreobject+keyring و۱۲معیارPDF جدا باقی‌اند. D14/D21/D32/D33/D34 برقرار؛ انتهای برش انتهای هدف نیست.

## سورس۶۵ — گردش داخلی چک در آزمون، منتشر نشده

A68/CHEQUE-LEDGER طرح است؛ اصلی۶۴ ثابت. Header/Events/Commands immutable با سه purpose رمزگذاری، FK خط/سفارش برنامه، root Identity/Sales/Credit Serializable و owner gate/actorcommand/audit/expectedheadVersion ساخته شدند. دریافت اولیه از خط snapshot فقط سفارش باز، ثبت اول برنامه را ثابت می‌کند. گردش دستی Received/Deposited/CollectedReported/BouncedReported/Withdrawn/ReturnedToCustomer و اصلاح صریح گزارش وصول؛ بعد بسته‌شدن فقط سند موجود با تأیید صریح. Paid/تأیید بانک/ارسال/تسویه/پیش‌پرداخت هنوز ساخته نمی‌شوند. خلاصهٔ مشتری بدون مرجع/یادداشت؛ جزئیات مالی MFA/finance.read و نوشتن finance.write. Migration منتشرنشده `20261027151329_ChequeLedger`:۳جدول و AKرویSchedule(Id,OrderId)،انتظار۶۵/۱۷۵جدول؛Downguardفقط۳جدول خودش. Schedule64Downمنتشرشده عوض نشد؛ تست قدیمی پیش guardبهschemaخودشpin و پس آن همهٔsourceراreupgradeمی‌کند.

۱۳unit تازه و۵SQL نخست موفق؛۷SQL نهایی شاملraceدریافت/اصلاح وpaging۲۲/auditmove اضافه شد. ۱۰۱۸unitکامل/۴۷۱storefront/۲۱۴admin/۱۶proxy وbuildAPI/unit/SQL/harness/Nextisolated/admin موفق،Creditmodelnopending و۱۴DLLمطابق. SQLکامل درحال اجراست،هنوز قبول نشده. قراردادTS/journal/privateBFF/نمایشownedFAEN و فرم دریافت/گردش/تاریخچه/unknownreceipt/globalguardپنل ساخته/typechecked‌اند؛۹TS تازه موفق. اولین تستproxyباHTTPغیرlocalhostبه‌درستی۵۰۳شد؛mockoriginبهHTTPSاصلاح شد،guardتولیدضیعفنشد. sandboxunitاولسوکتtesthostنداشت؛loopbackrerun۱۳پاس.

نامزد ثابت `tmp/cheque-ledger65-runtime-set.json`،Nextbuild jK2iH3V3bqG9SLRExBpVY؛sourceacceptance/mainrelease ندارد. QA_GUID `SaymanTest_Ui_37c93c3e4ca64f579fc609d925f7c7d5` با baseline۱۷۵جدول وmainhashها در `tmp/cheque-ledger-browser-run.json`؛هارنسsession60194/API5181،gateway76115/5182،front45837/3105،admin68743/3175 فعال. فقطpolicyD21وحساب‌هایساختگیازfixtureقدیمی؛هیچنمونه‌ایدرmainنیست. تب‌هایQA۱۱۱مدیرمالی و۱۱۲بازبین اکنونloggedMFA؛publishconditions/ساختorder/plan/گردش هنوز انجام نشده‌اند. پایانQA بایدDB/کلید/credential/ports/تب‌هایخودمان جمع،viewportreset/mainhash/Redis بررسی شود.

ادامه:مرورگرactualreceive+collectionresponsecut→sameGETreceipt/۰duplicate،history/cancel/FAEN/mobile/logout؛SQLکامل وwiredecoder،QAcleanup وsourceacceptance؛سپسbackup/preservation/additivemainrelease۶۵. هنوز برش۶۵ یا کلC2/پروژه کامل نیست. تمامhelpers/runtime/current64/rollback63/keys/backups/evidenceحفظ شوند.
