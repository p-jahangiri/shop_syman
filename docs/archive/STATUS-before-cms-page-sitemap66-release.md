# وضعیت و نقطهٔ ادامه

2026-10-27 — **اصلی محلی۶۶: صفحه‌های محتوایی دوزبانه و اصلاح HTTP404 پذیرفته و منتشرند. کل PRD/PDF کامل نیست؛ D34 ادامه دارد.** [آرشیو پیش۶۶](archive/STATUS-before-cms-pages66-release.md)، PRD/PLAN/DECISIONS و اسناد هر قابلیت مرجع‌اند.

## اجرای اصلی۶۶

- API: http://127.0.0.1:5080؛ PID23405/session1663؛ `python3 tmp/cms-pages66-http-release.py serve-api`.
- فروشگاه: http://127.0.0.1:3000؛ PID34728/session80875؛ `python3 tmp/cms-pages66-http-release.py serve-storefront`.
- پنل: http://127.0.0.1:3173؛ PID23377/session75125؛ `node tmp/serve-cms-pages66-main-admin.mjs`.

`tmp/{api,storefront,admin}-runtime-current.json` مرجع مسیر/hash/session/restart؛ `tmp/cms-pages66-http-runtime-set.json` artifact نهایی ثابت است. Next build `iZi7R9W2PBoYYx5zOXJZ2`. API و پنل همان bytes پذیرفتهٔ اولیه۶۶ دارند؛ برای اصلاح HTTP فقط Next عوض شد. مجموعه و source-acceptance اولیه۶۶ دست‌نخورده‌اند؛ `cms-pages66-source-acceptance-http-refined.json` و main-release مرجع پذیرش نهایی‌اند. flagهای پیش‌پذیرش در runtime-set، وضعیت انتشار نهایی نیستند.

SQL:۶۶migration/۱۷۸جدول/۱۲schema. cms.Pages/PageRevisions/PageCommands خالی اضافه شدند؛۱۷۴جدول قبلی جز cms migration history و تمام۶۵migration قبلی/schema/view دقیقاً حفظ شدند. پس۱۶۶۸HTTP،۱۷۷جدول غیرنشست/schema/view/history/safety ثابت؛ نشست معمولی زنده جدا و بدون reset محفوظ است. تمام۱۵۹۸HTTP قبلی و۹۴۰assetپنل/۳۲۳Next پیشین حفظ شده‌اند؛ دارایی‌های نامزد اولیه۶۶ هم در فروشگاه جدید موجودند.

Safety اصلی: onHand101/reserved0/sourcingReserved0؛ Orders/Reservations/Settings/Policies/Sourcing/payments/Files/Support/Inbox و تمام پرونده/شرایط/مجوز/quote/use/link/schedule/cheque/ledger چکی صفر. CMSsite3FAEN/auth1 محفوظ، support منتشر نشده و صفحهٔ CMS تازه‌ای در اصلی ساخته/منتشر نشد. هیچ policy/seed/role/grant/provider اصلی فعال نشد؛ QA به اصلی منتقل نشده است. Files اصلی Disabled؛ D16 درگاه/SMS/email و D30 هلو هنوز اطلاعات واقعی ندارند و خاموش‌اند؛ سؤال تکراری نشود. D32 Redis پارسه روشن و دست‌نخورده است.

بکاپ متوقف COPY_ONLY/CHECKSUM/VERIFYONLY:22142976بایت، SHA `4ac212191ba13f5b0fd139cf8ce69ea57f051d0223b92fb54194c3877f25a810`،۱key بدون parsing؛ `artifacts/checks/main-pre-cms-pages66-stopped-backup.json`. همان میزبان؛ offsite/restore۶۶/nativeLinux پذیرفته نیست. D33: tmpکامل حذف نشود؛ current66/rollback65 و مجموعهٔ اولیه۶۶/HTTPrefinement/کلید/بکاپ/شواهد و وابستگی restart محفوظ‌اند. پاک‌سازی قدیمی۶۵ و شواهد آن در آرشیو محفوظ است؛ این برش پاک‌سازی تازهٔ buildهای قدیمی انجام نداد.

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

## قابلیت‌های قبلی و ادامهٔ آماده — D34

[CHEQUE-LEDGER](CHEQUE-LEDGER.md)/[CREDIT-SCHEDULES](CREDIT-SCHEDULES.md)/CREDIT-ORDERS و آرشیو۶۵ همچنان پذیرفته‌اند. برنامه و گزارش داخلی دریافت/وصول چک، پیش‌پرداخت یا bankVerified/Paid/تسویه/ارسال نیستند. Cash VerifiedCashPayment فقط از verify واقعی provider؛ main ChequeOrdersEnabled مستقلdefaultfalse و Settings ندارد. ledger دریافت اولیه برنامه را ثابت و گردش سند موجود بعد بسته‌شدن سفارش با تأیید صریح حفظ می‌کند؛ cancel/expiry نهScopeUse را احیا می‌کند نه سند را پاک می‌کند.

1. برش مستقل بعد: CMS-03،SEOمدیریت‌شده/redirect/blog/sitemapصفحات؛ سپس باقی چرخه فروش/EXT با معیارPRD.
2. CREDIT-02: سؤال باز زمان اجازهٔ ارسال چکی (پس دریافت پیش‌پرداخت+تأیید دستی همهٔ چک‌ها یا فقط وصول همه) هنوز پاسخ ندارد؛ قواعد مالی/تعهد موجودی وابسته تا پاسخ تعیین نشود. کار مستقل ادامه یابد. پیش‌پرداخت/پذیرشمالی/وصولواقعی/یادآوری/گزارش/سازمانی بازند؛ deadline تاریخی تمدید پنهانی وScopeUse احیا نشود.
3. ارسال جزئی/دیجیتال/مرجوعی/بازپرداخت،search/alert/loyalty و سایرPRD؛ mobile/WCAG/perf/CI/observability/nativeLinux/load/offsitebackup/restoreobject+keyring و۱۲معیارPDF جدا باقی‌اند. D14/D21/D32/D33/D34 برقرار؛ انتهای برش انتهای هدف نیست.

### برش فعال پس۶۶

CMS-PAGE-SITEMAP/A72 در ساخت: اضافه‌کردن projection صفحه‌های منتشرشده به indexXML با حفظ محافظ preview/SEO و قراردادCatalog؛code-only وبدونmigration. هنوزپذیرش یا انتشار تازه ندارد؛ currentاصلی۶۶ مرجع است. بلاگ/redirect وکلD34بازند.
