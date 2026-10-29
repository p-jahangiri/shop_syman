# وضعیت و نقطهٔ ادامه

2026-10-27 — **اصلی محلی۶۶، به‌روزرسانی code-only نقشهٔ سایت صفحه‌های CMS پذیرفته و منتشر است. کل PRD/PDF کامل نیست؛ D34 ادامه دارد.** [آرشیو پیش sitemap](archive/STATUS-before-cms-page-sitemap66-release.md)، PRD/PLAN/DECISIONS و اسناد هر قابلیت مرجع‌اند.

## اجرای اصلی۶۶

- API: http://127.0.0.1:5080؛ PID65386/session76920؛ `python3 tmp/cms-page-sitemap66-release.py serve-api`.
- فروشگاه: http://127.0.0.1:3000؛ PID65412/session25010؛ `python3 tmp/cms-page-sitemap66-release.py serve-storefront`.
- پنل بدون تغییر: http://127.0.0.1:3173؛ PID23377/session75125؛ `node tmp/serve-cms-pages66-main-admin.mjs`.

`tmp/{api,storefront,admin}-runtime-current.json` مرجع مسیر/hash/session/restart؛ artifact فعلی `tmp/cms-page-sitemap66-runtime-set.json` و Next build `RShJC3twfXe3qykwaFe9-` است. `cms-page-sitemap66-source-acceptance.json`/`cms-page-sitemap66-main-release.json` مرجع پذیرش نهایی‌اند. مجموعهٔ۶۶HTTP قبلی و پذیرش آن و نسخهٔ اولیهٔ۶۶ دست‌نخورده‌اند؛ flagهای پیش‌پذیرش runtime-set وضعیت انتشار نهایی نیستند.

SQL همچنان۶۶migration/۱۷۸جدول/۱۲schema است؛ این برش migration ندارد. هر۱۷۸جدول در توقف و تمامschema/view/۶۶history دقیقاً ثابت، پس۱۶۸۲HTTP نیز۱۷۷جدول غیرنشست ثابت ماندند؛ bookkeepingنشست‌های زنده جدا و بدونreset مقایسه شد. تمام۱۶۶۸HTTP قبلی و۹۴۰assetپنل/۳۲۶Next قبلی حفظ شدند. فقط Shop.Api.dll/Shop.Modules.Cms.dll عوض،۱۲DLL دیگر و پنل دقیقاً ثابت‌اند.

Safety:stock101/0/0؛Orders/Reservations/Settings/Policies/Sourcing/payments/Files/Support/Inbox وتمامcreditcase/terms/scope/quote/use/orderlink/schedule/cheque/ledger صفر. cms.Pages/PageRevisions/PageCommands نیز خالی؛CMSsite3FAEN/auth1 محفوظ،support منتشر نشده. هیچ صفحه/منو/سیاست/seed/role/grant/provider یا indexواقعی فعال نشد. Files اصلی Disabled؛D16درگاه/SMS/email وD30هلو هنوز اطلاعات واقعی ندارند و خاموش‌اند؛سؤال تکراری نشود. D32Redisپارسه روشن و دست‌نخورده است.

بکاپ متوقف COPY_ONLY/CHECKSUM/VERIFYONLY جدید:23191552بایت،SHA `1bf83e26a5a180b9c0fe968fed18a78cde485f695ce2e6b2ad8614a1c45c10a2`،۱key بدونparsing؛`artifacts/checks/main-pre-cms-page-sitemap66-stopped-backup.json`. همان‌میزبان؛offsite/restore/nativeLinux پذیرفته نیست. بکاپ ارتقای اولیه۶۶ و شواهد آن هم محفوظ‌اند. D33:tmpکامل حذف نشود؛currentسایت‌مپ۶۶/rollback۶۶HTTP وinitial66/keys/backups/evidence/restartdependencies محفوظ‌اند؛ این برش cleanupساخت قدیمی انجام نداد.

## صفحه‌های محتوایی پذیرفته

[CMS-PAGES](CMS-PAGES.md)، A70/A71 و API مرجع‌اند. نشانی ثابت `/{locale}/pages/{slug}`، سند دوزبانه، Text/Callout/Image/Links باID/ترتیب و All/Mobile/Desktop؛ متن ساده، تصویر عمومیCatalog و پیوند داخلی محدود، بدون HTML اجرایی. پیش‌نویس مستقل و preview از همان renderer فروشگاه؛ انتشار به عنوان و بلوک معتبر هر دو زبان نیاز دارد. restore نسخهٔ تازه از revision همان صفحه می‌سازد و draft را نگه می‌دارد؛ unpublish تاریخچه را حذف نمی‌کند. نمونه از زمان ایجاد ثابت و خارج Development مخفی است.

CMS مالک سه جدول با FKانتشار همان صفحه، unique slug/publication، CHECK/Saveguards/Downمحافظ history است. create/save/publish/restore/unpublish با staff/MFA/cms.read+write، expectedVersion، actor+UUID/hash، قفل فرمان/صفحه و root Identity/Cms Serializable/audit اتمیک‌اند. رسید تاریخی commandId/pageId/action را مقید و replay پیش از نسخهٔ جاری بررسی می‌کند؛ private/no-store/noindex و بدون Cookie در proxy. تاریخچه seek۲۰،فهرست۵۰ و bodyدوزبانه≤۶۴KiB/۲۰بلوک هرزبان است. مبالغ پروژه همچنان ریالString/BigInt و بدون تغییرند.

بخش مستقل URL قبل از شروع streaming، وجود عمومی را از API محدود/anonymous/no-store بررسی می‌کند؛ ناموجود/draft/unpublished به صفحهٔ محلی۴۰۴ با HTTP404 واقعی rewrite می‌شوند و API قطع503/no-store می‌دهد. canonical/hreflang فقط SHOP_PUBLIC_URL معتبر و gateهای موجود SEO؛ نمونه noindex. CMS-03/blog/redirect/sitemapصفحات هنوز تکمیل نشده‌اند.

در مرورگر نقص قبلی پنل کشف/رفع شد: خروج صریح، authority/query/privateviews و RAMjournal تب‌های دیگر همان origin را با BroadcastChannel دو فیلدی بدون شناسه یا token پاک می‌کند؛ پیام فقط می‌تواند خروج محلی ایجاد کند. **معنای ابطال JWT سرور تغییر نکرده است.** مرورگر فاقد BroadcastChannel ادعای syncفوری ندارد؛ خروج محلی برقرار است. فرم ذخیره‌نشده نیز در تب دوم بلافاصله پاک شد.

## پذیرش و شواهد۶۶

۱۰۳۳unit/کل۷۲۸SQL/۴۷۹storefront/۲۱۷admin/۱۷proxy، buildهای API/unit/SQL/harness/Nextisolated/admin و typecheck موفق؛۱۴DLL محصول بین API/unit/SQL/harness/frozen برابر و Cms modelnopending است. ۱۵unit/۵SQL تازهٔ CMS و۳آزمون logout: اعتبارسنجی/Unicode/URL/blocks، private draft/publish/restore/unpublish/roles/origin/stale/replay/race/auditrollback/FK/immutable/Down/tamper/history۲۲. targetSQL اول۳پاس/۲fail صرفاً429 ورود host مشترک بود؛ authhost مستقل هر آزمون درست شد، limiter محصول تغییر نکرد. decoder پاسخ واقعی ابتدا حذف nullهای قراردادی توسط JSONglobal را یافت؛ DTO با JsonIgnoreNever اصلاح و decoder ضعیف نشد.

۵۴SQLwire با decoder تولیدی و۶۸browserwire پذیرفته:۸POST،۷فرمان موفق و۱تعارض نسخهٔ تب دیگر،۱قطع پاسخ پسcommit→۱GETreceipt و۰POSTتکراری. دو صفحهٔ ساختگی،چهارrevision و۷receipt/۷audit دقیق؛ draft خصوصی، previewFAEN،چهاربلوک/ترتیب، ذخیره و ساخت فعال موبایل،نشر۲زبان،restoreنسخه۳ با حفظdraft،unpublishنسخه۴→404هر۲زبان و ناقص‌بودنdraftمانعpublish. از۱۷۸جدولQA،۶تغییرمجاز(سهCMS وUsers/Audit/Sessions مربوط MFA)/۱۷۲دیگر exact،هیچpolicy/order/stockتغییرنکرد. چهارconsole خالی؛desktop1265=scroll،mobileFAEN/admin375=scroll،visibilityتصویرموبایل و فراخواندسکتاپ صحیح. actualdevice/WCAG/perf/کلmobile پذیرفته نیست. QA_GUID `a86e5e30a9184fb1ab254c43cd375be5`،credential/key/tab116–119/ports جمع شدند.

smoke اولیه اصلی، بعد ارتقای SQL، HTML404 با HTTP200 را در streaming Next آشکار کرد. انتشار نهایی تا اصلاح متوقف ماند؛ artifact/source-acceptance اولیه دست‌نخورده و جفت artifact جدا برای اصلاح Next ساخته شد. QA دوم GUID `7629d877c66444fa826ac0625137082f` با۱۰HTTP دقیق: missing404/draft404/published200/unpublished404/APIقطع503 برایFAEN؛۳پاسخ واقعی فرمان/۳audit/۲revision/۱صفحه و۱۷۲جدول دیگر exact. مرورگر FA→EN/375بدونoverflow/404پسunpublish/پیام503،consoleخالی پذیرفته؛ نمونه/credential/token خصوصی/key/tab120/ports جمع شدند. helper ابتداorigin5173نامجاز داشت و400به‌درستی گرفت؛ بهoriginمجاز خودharness3175 اصلاح شد، guardمحصول تغییر نکرد. SQL/API/admin bytes و تمام پذیرش قبلی محفوظ؛ فقط فروشگاه اصلی جایگزین و۱۶۶۸HTTP+حفظداده دوباره پذیرفته شد.

شواهد artifacts/checks: `cms-pages66-{source-acceptance,source-acceptance-http-refined,main-release}.json`،`cms-pages-{browser-ui,browser-final-sql}.json`،`cms-pages-browser-wire/acceptance.json`،`cms-pages-sql-full-wire/acceptance.json`،`cms-pages66-qa-cleanup.json`؛ اصلاحHTTP: `cms-pages-http-qa-{http,sql-acceptance}.json`،`cms-pages-http-qa-api/acceptance.json`،`cms-pages-http-browser-ui.json` و`cms-pages66-http-qa-cleanup.json`.

## نقشهٔ سایت صفحه‌ها — پذیرش code-only پس۶۶

[CMS-PAGE-SITEMAP](CMS-PAGE-SITEMAP.md)/A72/A73/API مرجع‌اند. projection مستقل از Cms،فقط slug و زمان واقعی revisionمنتشر وflagsFAEN دارد؛draft/demo/unpublished خارج‌اند و BodyJson/DraftJson/actor/commerce خوانده نمی‌شوند. شمارش String و seekفعلیOFFSET/۱۰۰۰ردیف،مرز۱۰۰۱با۱۰۰۰/۱،زمان restore از revisionتازه و عدم‌برخوردslug`sitemap` باendpointمستقل پذیرفته است. SEOخاموش اصلاًPagesنمی‌خواند. APIpreviewمحافظ قبلی همچنانtrue است؛ frontendاشتراک gateمحیط/Catalog/CMS و اجازهٔزبان را می‌خواهد وmainindex فعال نشده است.

فایل‌های root`/sitemap-fa-pages-1.xml`وEN باcanonicaltrusted/alternateواقعی/lastmodUTC،سقف مشترک۵۰هزارفایل/۱۰۰۰URL،strict/bounded/fatalUTF8/no-store/503بدونpartialXML اضافه شدند. Catalogmanifest/schema/فایل‌ها مستقل و محفوظ‌اند؛خطایCMSفایلCatalogراازکارنمی‌اندازد. شمارش/صفحه snapshotتراکنشی مشترک نیست؛تغییرهمزمان انتشار جابه‌جایی موقت/صفحهٔخالی404 می‌دهد. عمقOFFSET/بار/SearchConsole/productionindex پذیرفته نیست.

۱۰۴۵unit/کل۷۳۱SQL/۴۸۶front موفق؛۱۲unit/۳SQL/۷front تازه. admin۲۱۷/proxy۱۷ ازartifact بدونتغییرپذیرفتهٔ۶۶ دوباره‌استفاده شدند. API/unit/SQL/harness۱۴DLLیکسان،Cmsmodelnopending وNextisolated/typecheck موفق.۱۲پاسخ واقعیSQL باdecoderتولیدی:۷manifest/۴partition/۱publicPageباslug`sitemap`،ردیف۱۰۰۰/۱/۱/۰،previewtrueحفظ وmetadataبدونمتن/هویت/commerce. SQLfixtures/keyهایشان جمع شدند.

۵۱NativeNext/XML باfixtureصریح مصنوعی: Catalogقبلی،CMS۱۰۰۰/۱/دو‌زبان/optout/preview/UTC،حدمشترک،originجعلی/credential/UTF8/بدنه/خطا/partial وdeployoff پذیرفته؛fullStorefrontReads=0 وcredentialHeadersForwarded=0. اینfixture تاریخ‌های مصنوعی صادرکننده دارد و شاهدSQL یاایندکس واقعی نیست؛SQLپذیرش بالا جداست. فقطloopback،بدونورودموفق/اتصالبیرونی/ارسالبهSearchConsole؛پردازه‌ها/portsجمع وD32Redisمحفوظ‌اند.

شواهد artifacts/checks: `cms-page-sitemap66-{source-acceptance,main-release,qa-cleanup}.json`،`cms-page-sitemap-sql-full-wire/acceptance.json`،`cms-page-sitemap-native-http.json`؛قبل/بعد/پسHTTPاصلی وbackupهم‌نام. schemaهمچنان۶۶؛CMS-03/blog/redirect وکلپروژه بازند.

## قابلیت‌های قبلی و ادامهٔ آماده — D34

[CHEQUE-LEDGER](CHEQUE-LEDGER.md)/[CREDIT-SCHEDULES](CREDIT-SCHEDULES.md)/CREDIT-ORDERS و آرشیو۶۵ همچنان پذیرفته‌اند. برنامه و گزارش داخلی دریافت/وصول چک، پیش‌پرداخت یا bankVerified/Paid/تسویه/ارسال نیستند. Cash VerifiedCashPayment فقط از verify واقعی provider؛ main ChequeOrdersEnabled مستقلdefaultfalse و Settings ندارد. ledger دریافت اولیه برنامه را ثابت و گردش سند موجود بعد بسته‌شدن سفارش با تأیید صریح حفظ می‌کند؛ cancel/expiry نهScopeUse را احیا می‌کند نه سند را پاک می‌کند.

1. برش مستقل بعد: CMS-03،مدیریتredirect وblog/SEOتکمیلی؛sitemapصفحات اکنون پذیرفته است. سپس باقی چرخه فروش/EXT با معیارPRD.
2. CREDIT-02: D35 پاسخ مستقیم مالک است: «پس از دریافت پیش‌پرداخت و تأیید دستی همهٔ چک‌ها». پس برش جاری CMS-REDIRECTS، مسیر مالی/تعهد موجودی بر این مبنا ادامه یابد؛ تا وصول همهٔ چک‌ها انتظار لازم نیست و reportدستی، bankVerified/Paidنقدی نیست. پیش‌پرداخت/پذیرشمالی/وصولواقعی/یادآوری/گزارش/سازمانی بازند؛ deadline تاریخی تمدید پنهانی وScopeUse احیا نشود.
3. ارسال جزئی/دیجیتال/مرجوعی/بازپرداخت،search/alert/loyalty و سایرPRD؛ mobile/WCAG/perf/CI/observability/nativeLinux/load/offsitebackup/restoreobject+keyring و۱۲معیارPDF جدا باقی‌اند. D14/D21/D32/D33/D34 برقرار؛ انتهای برش انتهای هدف نیست.

### برش فعال بعد sitemap۶۶

CMS-REDIRECTS/A74 در ساخت: انتقال پاکِ نشانی عمومی با301/302صریح،draft/preview/history/rootaudit/idempotency وguardچرخه/۵hop. هنوز پذیرفته/منتشر نیست؛ source67 در آینده نیازمند migrationسه‌جدول CMS است،اصلی همچنان schema۶۶/۱۷۸جدول. پاسخ مالی اکنون درD35ثبت است؛پس این برش،CREDIT-02با دریافت پیش‌پرداخت+تأیید دستی همهٔ چک‌ها ادامه یابد.

پیشرفت source67/CMS-REDIRECTS (پذیرش نهایی هنوز باز): backend/API/سه‌جدول migration `20261027195126_CmsRedirects` باDownمحافظ، پنل/پراکسی/جورنال RAM وNextlookupساخته شدند.۲۱unitهدفمند/۴SQLهدفمند،۱۰۶۶unitکامل،۴۹۱front/۲۱۷admin/۱۸proxy و۲۱NativeHTTPsyntheticگذشته‌اند؛۴۲SQLwireباdecoderتولیدی. build/typecheck/مدلnopendingو۱۴DLLمیانAPI/unit/SQL/harnessیکسان‌اند. fullSQL ومرورگر/cleanup/freeze/backup/mainmigrationهنوزپذیرفته‌نیستند. خطایrefineمسیرکوتاهZodرفع وکل۴۹۱تکرارشد؛Nativeدوexpectationنامتناسبcacheexact/محصولpreviewناموجوداصلاحشد،لاگ‌هایقبلیمحفوظ‌اند. previewمحصولناموجودHTTP200پسstreamنقصقدیمیبازUXاست؛آزمونموفقعدمlookupباiphone-16موجوداست. اصلی۶۶بدونتغییر/D35بعداینبرشاولویتدارد.
