# وضعیت و نقطهٔ ادامه

2026-10-27 — **اصلی محلی۶۵: دفتر دریافت و گردش داخلی چک پذیرفته و منتشر است. کل PRD/PDF کامل نیست؛ D34 ادامه دارد.** [آرشیو پیش۶۵](archive/STATUS-before-cheque-ledger65-release.md)، PRD/PLAN/DECISIONS و اسناد هر قابلیت مرجع‌اند.

## اجرای اصلی۶۵

- API: http://127.0.0.1:5080؛ PID79763/session81956؛ `python3 tmp/cheque-ledger65-release.py serve-api`.
- فروشگاه: http://127.0.0.1:3000؛ PID79764/session17222؛ `python3 tmp/cheque-ledger65-release.py serve-storefront`.
- پنل: http://127.0.0.1:3173؛ PID79734/session82779؛ `node tmp/serve-cheque-ledger65-main-admin.mjs`.

`tmp/{api,storefront,admin}-runtime-current.json` مرجع مسیر/hash/session/restart؛ `tmp/cheque-ledger65-runtime-set.json` نامزد ثابت پیش از پذیرش و source-acceptance/main-release/descriptor مرجع وضعیت نهایی‌اند. Next build `jK2iH3V3bqG9SLRExBpVY`. نسخهٔ اولیهٔ پنل پیش از دو اصلاح UI با `uiRefinement.initialRuntimeSet` نگه داشته شده است.

SQL:۶۵migration/۱۷۵جدول/۱۲schema. سه جدول خالی credit.ReceivedCheques/ChequeLedgerEvents/ChequeLedgerCommands و AK روی ChequeScheduleRevisions(Id,OrderId) اضافه شدند. ۱۷۱جدول قبلی جز credit migration history، تمام۶۴ migration قبلی و schema جز AK صریح و همهٔ viewها دقیقاً حفظ شدند. پس۱۵۹۸HTTP،۱۷۴جدول غیرنشست/schema/view/history/safety ثابت؛ نشست معمولی زنده جدا و بدون reset حفظ شد. تمام۱۵۴۳HTTP و۹۰۵assetپنل/۳۱۰Next قبلی پوشش دارند.

Safety اصلی: onHand101/reserved0/sourcingReserved0؛ Orders/Reservations/Settings/Policies/Sourcing/paymenthistory/Files/Support/Inbox و تمام پرونده‌ها/شرایط/مجوز/quote/use/link/schedule/cheque/ledger چکی صفر. CMSsite3FAEN/auth1 ثابت؛support منتشر نشده. هیچ policy/seed/role/grant/provider اصلی فعال نشد و QA به اصلی منتقل نشد. Files اصلی Disabled؛ D16 درگاه/SMS/email و D30 هلو اطلاعات واقعی ندارند و خاموش‌اند؛ سؤال تکراری نشود. D32 Redis پارسه روشن و دست‌نخورده است.

بکاپ متوقف COPY_ONLY/CHECKSUM/VERIFYONLY: 22142976بایت، SHA `6a1b18521f5a71e1ada0e4e4e72fb7b2a6f7913c1d0ab18501f59bf6ea3f16cd`،۱key بدون parsing؛ `artifacts/checks/main-pre-cheque-ledger65-stopped-backup.json`. همان میزبان؛ offsite/restore۶۵/nativeLinux پذیرفته نیست. پاک‌سازی مجاز این مرحله۹۶buildقدیمی،۲٫۶۷GiBواقعی آزاد کرد و هش current64/rollback63/candidate65/initial65/live دقیقاً حفظ شد (`tmp-credit65-cleanup-applied.json`). کش build مستقل هم۲۱۲٫۸۶MiB آزاد کرد؛ فایل‌های runtime/کلید/بکاپ/شواهد حذف نشدند. اکنون current65/rollback64 و وابستگی restartها حفظ شوند؛ tmp کامل حذف نشود.

## دفتر گردش چک پذیرفته

[CHEQUE-LEDGER](CHEQUE-LEDGER.md)، A68/A69 و API مرجع‌اند. دریافت به خط آخرین برنامهٔ سررسید همان سفارش وصل است؛ مبلغ/سررسید/scope/order از snapshot، نه input. دریافت اولیه فقط سفارش باز/دارای مهلت با نسخهٔ دقیق و تأیید صریح؛ پس اولین دریافت، تاریخ‌های برنامه ثابت می‌شوند. مرجع توصیفی چک و یادداشت دریافت رمز می‌شوند و مرجع بانکی تأییدشده یا ادعای تطبیق بانکی نیستند.

Credit مالک Header/Event/Command immutable، با FK برنامه/سفارش و خط، unique order+sequence و CHECK/Saveguards/Down است. ثبت/حرکت با root Identity/Sales/Credit Serializable، owner gate و actor+UUID/hash/expectedheadVersion/audit/رسید رمز‌شده اتمیک است. ثبت/اصلاح برنامه/لغو سری می‌شوند؛ replay پس از بسته‌شدن همان رسید اولیه می‌ماند. جزئیات مالی finance.read+MFA و نوشتن finance.write دارد؛ customer فقط خلاصهٔ owned بدون مرجع، یادداشت یا عامل می‌خواند. registration/event/receipt سه purpose و principal/order/id مقید دارند؛ tamper failclosed است. صف خلاصه با batch خواندن آخرین رویدادها و رسیدها؛ history۲۰تایی و سقف۲۰۰رویداد/چک،۶۰چک/سفارش.

گردش Received→Deposited/ReturnedToCustomer؛ Deposited→CollectedReported/BouncedReported/Withdrawn؛ BouncedReported/Withdrawn→Deposited/ReturnedToCustomer. CorrectCollectionReport از CollectedReported به Deposited با دلیل و حفظ سابقه است؛ برگشت وجه بانکی نیست. ReturnedToCustomer پایان گردش است. زمان وقوع UTC صریح/غیرآینده و نامتناقض، زمان ثبت سرور جدا؛ بعد cancel/expiry فقط سند موجود با تأیید صریح بسته‌بودن سفارش پیگیری می‌شود. سند تازه/موجودی/مجوز احیا نمی‌شود.

**گزارش داخلی وصول، تأیید مستقیم بانک، پیش‌پرداخت، Paid، تسویه یا اجازهٔ ارسال نیست.** تمام bankVerified/canPay/canFulfill این قرارداد false است. پرداخت نقدی واقعی همچنان به provider مستقل واقعی نیاز دارد؛ استفاده از VerifiedCashPayment با input/گزارش دستی ممنوع است. سفارش۶۳ و برنامه۶۴ و quote3/5/used/accepted قدیمی حفظ‌اند؛ ChequeOrdersEnabled مستقل defaultfalse و اصلی Settings ندارد.

## پذیرش و شواهد

۱۰۱۸unit/کل۷۲۳SQL/۴۷۱storefront/۲۱۴admin/۱۶proxy، buildهای API/unit/SQL/harness/Nextisolated/admin و typecheck موفق؛۱۴DLL محصول بین همه برابر و Credit/Sales modelnopending است. ۱۳unit تازه و۷SQL تازه: state/time/money/crypto/immutable، receive/move/replay/race/amend/cancel/rollback/audit/role/owner/strictinput، history۲۲paging/SQLFK/Down/tamper. SQL اولیه۷۲۰/۳ با سه OutOfMemoryException از سقف۲GiB testhost بود؛ همان محصول و assertions با سقف۳GiB،۷۲۳/۰ در۶دقیقه۲۲ثانیه پذیرفته شدند. دیتابیس و کلید دقیقاً متعلق به run ناموفق با تطبیق زمان SQL/پوشه/TRX و بدون اتصال فعال پاک شد (`cheque-ledger-oom-qa-cleanup.json`).

۴۹SQLwire با decoder تولیدی:۳۷ثبت/۴replay/۷چک/۳history وpaging؛ facts و history ثابت، متن خصوصی به customer نرسید. verifier ابتدا حد شمارش detail را۳فرض کرده بود؛ دو سناریوی واقعی detail داریم و حد به۲ مطابق تست‌ها تصحیح شد؛ decoder/محصول/آزمون ضعیف نشد. مقدار actor یا authentication در wire نیست. آزمون‌های این ledger تازه ordinary هستند؛ accepted/mixed برای quote/order/schedule در برش‌های قبلی SQL پذیرفته‌اند، پذیرش اختصاصی ledger آن‌ها ادعا نمی‌شود.

مرورگر۱۲POST/۲GETreceipt/۲قطع پاسخ بعد commit و۰duplicatePOST؛۳چک با۱۲رویداد،۲سفارش/۲برنامه. برنامه پس دریافت ثابت، تاریخچه۸رویدادی اول با وصول/اصلاح/برگشت/تحویل مجدد/برداشت/بازگرداندن حفظ؛ دو سفارش لغو و سه سند با تأیید بسته‌بودن بازگردانده شدند، stock101/0/0 و۲Use محفوظ. دو اصلاح صرفاً UI (تازه‌شدن خودکار readiness دریافت بعد save برنامه و صف سفارش بعد گردش) با سفارش دوم در نامزد نهایی مرورگر پذیرفته؛ API/SQL/proxy/front bytes تغییر نکردند. guard نامعلوم بعد جابه‌جایی صفحه و same-command receipt، FAEN/reload/customer private projection/logoutacrosstabs،۵console خالی؛ عرض۳۹۰×۸۴۴ خواندن فارسی/انگلیسی/پنل client=scroll375،desktop1265. ارسال فرم فعال موبایل، actualdevice/WCAG/perf/کلmobile ادعا نیست.

از۱۷۵جدولQA،۳۷تغییر مجاز/۱۳۸دیگر دقیقاً ثابت؛ policy/settings D21 ثابت،۱۲command/۱۲event/۱۲audit گردش (۳receive/۹move) و۳binding دقیق به خط برنامه/سفارش. QA_GUID `37c93c3e4ca64f579fc609d925f7c7d5`،کلید/credential/تب۱۱۱–۱۱۵/ports3105/3175/5181/5182 جمع و viewportreset؛Dockerresourceجدید نساخت. شخص/چک/بانک/وجه واقعی استفاده نشد. اولین contractproxy mock با HTTP غیرlocalhost به‌درستی۵۰۳شد و mock بهHTTPS اصلاح شد؛ guard تولیدی تغییر نکرد. testhost واحد sandbox سوکت نداشت و rerunمجاز loopback پذیرفته شد.

شواهد artifacts/checks: `cheque-ledger65-{source-acceptance,main-release}.json`،`cheque-ledger-browser-{ui,final-sql,transport-state}.json`،`cheque-ledger-browser-wire/acceptance.json`(۱۲۱response)،`cheque-ledger-sql-full-accepted-wire/acceptance.json`،`cheque-ledger65-qa-cleanup.json`.

## ادامهٔ آماده — D34

1. CREDIT-02: ثبت/تطبیق پیش‌پرداخت، پذیرش مالی معتبر خرید چکی و تعهد موجودی/مهلت، وصول واقعی/یادآوری/گزارش مالی/اعتبار سازمانی. گزارش دستی یا برنامهٔ Planned به bankVerified/Paid تبدیل نشود؛ cash provider proof موجود فقط مسیر verify واقعی سرور است. قرارداد moduleها و معنی مستقل credit approval/receivable/fulfillment ابتدا دقیق شود؛ deadline مطلق تاریخی تغییر پنهانی نکند، scope هرگز احیا نشود.
2. ارسال جزئی/دیجیتال/مرجوعی/بازپرداخت،CMSپیشرفته/blog/SEO،search/alert/loyalty و باقیPRD.
3. پذیرش mobile/WCAG/perf/CI/observability/nativeLinux/load/offsitebackup/restoreobject+keyring و۱۲معیارPDF جدا باقی‌اند. D14/D21/D32/D33/D34 برقرار؛ انتهای برش انتهای هدف نیست.

### برش فعال پس۶۵: CMS-02

صفحه‌های محتوایی دوزبانه با draft/preview/publish/rollback/unpublish و بلوک مصوب در ساخت؛ CMS-PAGES/A70 مرجع. هنوز build/SQL/UI/انتشار تازه پذیرفته نیست و اصلی۶۵ اجرا می‌شود. پاسخ سؤال زمان مجاز ارسال خرید چکی منتظر است؛ ادامهٔ کار مستقل CMS مجاز است.

### ارتقای۶۶ در حال نهایی‌سازی — پاسخ HTTP صفحهٔ ناموجود

SQL اصلی اکنون۶۶migration/۱۷۸جدول دارد؛ backup و before/after موفق و همهٔ۱۷۴جدول قبلی جز cms history و تمامschema/view/safety محفوظ‌اند. اجرای موقت API۵۰۸۰ session1663،فروشگاه۳۰۰۰ session28511،پنل۳۱۷۳ session75125 از نامزد۶۶ فعال است؛ descriptorهای current هنوز۶۵ و تا seal نهایی مرجع restart این اجرای موقت نیستند. `cms-pages66-release.py`/`serve-cms-pages66-main-admin.mjs` اجرا را می‌شناسند.

source پذیرش اولیه۶۶ با۱۰۳۳unit/۷۲۸SQL/۴۷۹front/۲۱۷admin/۱۷proxy،۵۴SQLwire/۶۸browserwire وQAcleanup ثبت است. اما smoke اصلی یک نقص streaming Next پیدا کرد: URL عمومیِ ناموجود، HTML404 با HTTP200 می‌دهد. انتشار نهایی/main-release هنوز انجام نشده و این وضعیت کامل اعلام نشود. artifact و پذیرش اولیه تغییر نکنند؛ اصلاح frontend و پذیرش/جفت artifact تازه با ارجاع به نسخهٔ اولیه ثبت شوند. migration جدید یا seed لازم نیست؛ main-pre-cms-pages66-stopped backup و before/after مرجع حفظ داده‌اند. هدفD34ادامه دارد؛ سؤال زمان اجازهٔ ارسال چکی هنوز باز است.
