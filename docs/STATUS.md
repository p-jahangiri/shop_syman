# وضعیت و نقطهٔ ادامه — 2026-10-29

D34 ادامه دارد؛ **کل پروژه کامل نیست**. از skill پروژه و این نقطهٔ ادامه به PLAN بروید. شرح تاریخی و شواهد جزئی در [آرشیو پیش از تحویل دیجیتال](archive/STATUS-before-digital84.md) محفوظ است؛ محدودیت‌های قدیمی انتشار محلی با D44 جایگزین‌اند.

## D52 — آماده‌سازی Git و انتشار tag روی Linux/Vercel

درخواست مالک برای مخزن `p-jahangiri/shop_syman`، Docker، CI/CD مبتنی برtag و راهنما درDECISIONS/D52 ثبت شد؛ سپس میزبانی موقت رابط‌ها رویVercel انتخاب شد. [راهنمای انتشار](DEPLOYMENT.md) هر دو مسیر و API-only برای اتصالVercelرا شرح می‌دهد. Gitمحلی رویmainوoriginمعرفی‌شده ساخته شد؛ فایل.env،کلیدها،دیتابیس،tmp/artifactsوخروجیQAازGit/Dockerکنارگذاشته‌اند.212URLدرlockازmirrorبهregistryرسمیnpmبا حفظversion/integrityتغییرکردند.

Dockerهایسه‌پروژه،ComposeProductionمستقل،API-only،NginxTLS،digest-pinnedGHCRbundle،SSHhost-keypin،backupپیشmigrationوhealth/HTTPS آماده‌اند. شروععادیAPIseed/migrateنمی‌کند؛ فرمانصریح `--bootstrap-admin` بدوننمونهDevelopment،بدونreset/ارتقایحسابموجود،باtransaction/applockو تغییررمزاولیه+MFAاضافهشد. envحسابmigrationازruntimeجداست. شکستmigration/healthبدونdowngradeخودکاردرmaintenanceمی‌ماند.مدارک/تصویرProductionتاS3/scannerواقعیDisabledهستند.

شواهد محلی این برش:12تستvalidator/orchestration،YAML/Bash/هر دوComposeconfig،BuildKitcheckدوDockerفرانتlinux/amd64بدونهشدار؛backendrestorelockedآفلاین/buildReleaseبدونwarning/error؛1273unit/0fail/0skipو3SQLواقعیbootstrap/0fail/cleanupصفر باsource906فایلثابت. `artifacts/checks/deploy-backend/result.json` وlogهای `tmp/deployment-*` مرجع‌اند. خطایقدیمیOTP503/MFA200بهعلتfixtureOriginsدیرهنگامTestingبود؛تنظیمtestزودهنگاماصلاحشد،حفاظتProductionتضعیفنشد.628تستفروشگاه،270contractپنل،TSهردوپاس‌اند؛proxy/Verceladapterپسازاصلاحپیکربندیجاریبازبررسی‌می‌شوند.

**مرز تحویل:** APIعمومیHTTPSیاSQLProductionازمالکداده‌نشده؛Vercelدات‌نت/SQLاینمعماریرامیزبانی‌نمی‌کند. اتصالGitHubدرChromeمخزنرادید؛دسترسیابزارVercelبهتیممجوزجداخواستهشد. ساخت/انتشارواقعیLinuxیاپذیرشعملیاتیVercelدراینمرحلههنوزادعانیست؛تأییدحساب/مقصد،APIقابل‌دسترسی،secretهایActionsوسیاست/providerواقعیلازم‌اند.روشن‌کردنpreview/DevelopmentجایاتصالواقعیProductionنیست.مرزفایلVercel4MiBدرadapterوحدود4.5MBپلتفرم؛آپلودبزرگ/LongPolling/نشستنیازمندپذیرشهمانمیزبان‌اند.هیچسرویس3000/5080/3173،Sayman،RedisیاParsehدراینبرشrestart/migrateنشد؛D44محفوظاست. نتیجهGitpush/CIومقصددرادامههمینبخشثبت‌می‌شود.

## یک نسخهٔ اصلی — D44

تنها فروشگاه روی `http://127.0.0.1:3000`، API روی5080، ادمین3173 و SQL Sayman است. مالک تغییرات مستقیم، migration لازم و restart محلی در دامنهٔ پروژه را مجاز کرده و نسخهٔ بازبینی ماندگار نمی‌خواهد. fixture خودکار کوتاه‌عمر مجاز است؛ offlinebuild/backup نسخهٔ اجرایی دوم نیست. پیش هر restart، `tmp/{api,storefront,admin}-runtime-current.json` و PID/port/cwd/hash را تازه تطبیق دهید. helperهای قدیمی73/D39/D40 را برای برگرداندن سرویس‌های فعلی اجرا نکنید.

گفت‌وگوی «Find account login credentials» انتقال D44 را تمام کرده و idle شد؛ schema73→83 با۱۰migration/۲۵جدول و seedصریح8گوشی/67ترکیب روی اصلی انجام شد. `artifacts/checks/d44-main-release.json` و `phone83-main-applied.json` مرجع‌اند. هیچ دادهٔ QAمالی/انبار/حساب وارد اصلی نشد؛ دادهٔ قبلی محفوظ است. این شرح انتقال اولیهٔD44 است؛ storefrontاکنونD48 (با طراحیD46 و پاک‌سازیD45) وadminاکنونD50 است و descriptorها مرجع مسیر/PID جاری‌اند. previewهای ماندگار و DBهای متعلق به بررسی‌ها جمع شده‌اند؛ آن‌ها را دوباره اجرا نکنید.

## D50 — بازطراحی دوبارهٔ جدول‌ها روی3173 فعال است

مالک ظاهر D49 را نپسندید. ظاهر مشترک در `admin-table-design.css` بازطراحی شد: رنگ خنثی، سرستون ساده، فیلترها در منوی مستقل، انتخاب ستون/تراکم در «نمایش»، تنظیمات فعال قابل‌پاک‌کردن، راهنمای محدودهٔ داده، footer با بازهٔ ردیف/صفحه و عملیات ثابت در پیمایش افقی. ساختار کالا شامل تب وضعیت، جست‌وجو و دسته/برند جمع‌وجور، ستون برند، نماد عمومی کالا و وضعیت/منتخب واقعی است؛ تصویر جعلی یا عملیات بی‌قرارداد اضافه نشده است. راهنما مطابق ابزار تازه اصلاح شد. الگوی مشترک قبلی مصرف‌کنندگان را پوشش می‌دهد؛ بازدید همهٔ گردش‌ها از تعمیم component نتیجه نمی‌شود.

نسخهٔ نهایی `tmp/admin-runtime-quality-e6ae126f364542cfb05044ef6f19b7e6` باPIDانتشار53345 روی همان3173 فعال است. [شواهد انتشار](../artifacts/checks/admin-d50-main-release.json) و [مرورگر](../artifacts/checks/admin-d50-browser.json) مرجع‌اند. API5080/schema85 و storefront3000/D48 با SHA descriptor پیش و پس دقیقاً حفظ شدند؛ migration، تغییر SQL، سرویس دوم یا تغییر Parseh انجام نشد.9بررسی HTTP شامل assetهای دقیق و401مسیرهای خصوصی پاس شد. فایل‌های `admin-d50-*-final.log` نتیجهٔ۲۵۶تست/۰شکست/۰skip،TS،ESLint۰خطا/هشدار،Prettier وbuild را ثبت می‌کنند. backendتغییر نکرد؛ آزمونSQL تازه لازم نبود و ادعا نمی‌شود.

درChrome با نشست واقعی روی بستهٔ نخستD50، جست‌وجوی «آیفون» بدونsubmit→۱/clear→۲۷، facetلپ‌تاپ→۳، Escape→فوکوس summary، صفحهٔ۲ با بازهٔ۱۱–۲۰از۲۷، پنهان‌کردن برند، تراکم/بازنشانی و تب منتشرشده→۱۲ بررسی شدند. روی بستهٔ نهایی، نمایiPhoneSE۳۷۵×۶۶۷، جست‌وجوی اصلاح‌شده، پیمایش افقی/عملیات ثابت/footer و منوی فیلتر ثابت پایین صفحه مشاهده شدند. تصاویر درشواهد ثبت‌اند؛ تأیید مالک یا دستگاه واقعی/WCAGکامل ادعا نیست.

هشدارCSP وابستگیschema در مرورگر دیده شد: importایستایApp قبل از side-effect تنظیمjitless، schemaمی‌ساخت. Appاکنون پس از تنظیم باimportپویا بارگذاری می‌شود؛ آزمونFunctionهمapplyوهمconstructرا منع می‌کند و پاس است. حفاظتCSP دست‌نخورده است. مالک مک را باز کرد و بازبینی نهایی ادامه یافت: کنسول۰پیام/۰خطا وIssues۰pageerror/۰breakingchange/۰improvement، با پیامNo issues detected ثبت شد. پس از بازکردن دسته‌ها،CRM،جدول تیکت داخل پرونده،کارکنان و فرم خالی ساخت همکار نیز همین نتیجه تکرار شد؛ تصاویر `admin-d50-final-browser-issues*.png` مرجع‌اند. emulationخاموش،DevToolsبسته و مرورگر به دسکتاپ/همهٔ۲۷کالا با جست‌وجوی منوی خالی برگشت. برای دورزدن قفل یاMFA اقدامی نشده است.

بازبینی مستقل بستهٔ نهایی: دسته‌ها۵ردیف/جست‌وجوی زندهٔ گوشی→۱؛ مشتریان۴ردیف/پروندهٔ نمونهٔ صریح توسعه/جدول۱تیکت با۲پیام؛ کارکنان۱ردیف/راهنمای به‌روز/فرم ساخت خالی بدون ورود رمز،انتخاب نقش یاثبت. Escapeدرمنوی جدول تیکت،منو را بست و خودپرونده باز ماند. تصاویر `admin-d50-final-{desktop-all,categories,customers,staff}.png` و گزارشbrowserثبت‌اند. این پذیرش خواندنی همین نماهاست، نه همهٔ۴۵گردش یا تأیید ظاهر توسط مالک.

ادامه: بررسی سایر حوزه‌ها و گردش‌های واقعی طبقPLAN. A102 و وابستگی‌هایD16/D30 و سیاست‌های اصلی همچنان بازند. D49پایین، سابقهٔ پیاده‌سازی است و ظاهرش تأیید مالک نیست.

## D49 — جدول‌های مدیریتی و جست‌وجوی زنده روی اصلی فعال‌اند

درخواست تازهٔ مالک برای بررسی هر بخش، کسب‌وکار و UI در DECISIONS/D49 و [ADMIN-TABLES](ADMIN-TABLES.md) ثبت است. TanStack موجود گسترش یافت؛ stack/دیتابیس عوض نشد. اتصال۴۵نمای جدول در۳۴فایل source و راهنمای۲۵بخش بررسی شد (`admin-d49-table-source-audit.json` و `...guides-coverage.json`)؛ تعداد اتصال component معادل پذیرش کامل۴۵گردش نیست.

پنل3173 اکنون `tmp/admin-runtime-quality-4b0799be74d94aa08670d329c021f796`، PID22917 در زمان ثبت، run4b0799be74d94aa08670d329c021f796 را اجرا می‌کند. restart همان `node scripts/serve-main-admin.mjs` است. `admin-d49-main-release.json` و `frontend-quality-4b0799be74d94aa08670d329c021f796-main-release.json` مرجع‌اند. descriptorهای API85 و storefrontD48 byte-exact ماندند؛۰migration/seed/Dockerrestart. هشتHTTP نهایی و۱۰HTTP/دارایی byte-exact درpublisher پاس‌اند. runtime میانیffb176 پس اصلاح بازنشانی با بستهٔ نهایی جایگزین شد؛ preview یا listener تازه ساخته نشد.

قابلیت‌های فعال: مرتب‌سازی صعودی/نزولی وShiftچندستونی؛ فیلتر دقیق مقادیر کوتاه ستون و جست‌وجوی متن بلند؛ انتخاب ستون‌های نمایان؛ نمای فشرده؛ بازنشانی search/filter/sort/visibility/density؛ شمار دادهٔ دریافت‌شده و pagination10/25/50 برای metadata کامل. صفحه‌بندی سروری و همهٔhandlerها/قفل فرمان نامشخص/مجوزها محفوظ‌اند. جدول پیچیدهٔ دارایspan باmarkup اصلی می‌ماند تا جمع مالی/ردیف از دست نرود. ستون تاریخ/مبلغ اصلی rawvalue می‌گیرد؛ عدد بزرگ/منفی/هزارگان بدون Number مرتب می‌شود. ورودی/رمز/دکمه در متن جست‌وجو وارد نمی‌شود.

جست‌وجوی خواندنی `AdminFilterForm` باdebounce350ms،IME،لغوunmount وcheckValidity خودکار است؛ فرم ثبت/امنیتی/مالی به auto-submit تبدیل نشد. کالا/انبار/کارکنان/مشتریان/شرایط خرید جست‌وجوی اصلی سروری دارند و نوار تکراری محلی‌شان مخفی است. sort/facetجدول فقط رویصفحهٔدریافت‌شده است؛ **مرتب‌سازی سراسری سرور پیاده نشده**. ثبت فیلتر گزارش cutoffدار مستقل است؛ این بخش‌ها دکمهٔ اعمال خود را دارند. فهرست صفحه/مقاله/redirect/دیدگاه و گزارش چک از کارت/دکمه‌های متراکم به جدول تبدیل شدند. افزودن/ویرایش/refreshهای قبلی حفظ شدند؛ حذف قطعی بی‌قرارداد یا حذف سابقهٔ مالی ساخته نشد و پنهان/غیرفعال‌کردن از فرم معتبر در راهنما آمده است.

Field اکنونid/name وارتباطhint می‌گیرد و نامRHF را حفظ می‌کند. Zod با side-effect نخستینimport پیش از ساخت schema بهjitless تنظیم می‌شود؛ freshNode باFunction ممنوع حتی یکprobeنداشت. CSP ضعیف نشد؛ قبولی browserIssues تازه هنوز ادعا نیست. راهنمای برند که برخلافAPI نامدو‌زبان می‌خواست اصلاح شد؛ راهنمای هر۲۵بخش علاوه برقواعدهمانحوزه ابزارجدول/مرزserver/clientراشرحمی‌دهد.

۲۵۶admincontract/۰fail/۰skip،rootESLint۰error/۰warning،Prettier،strictTS وbuild نهایی sourceStable پاس‌اند (`admin-d49-*-corrected.*` وbuild-corrected).۷تست تازه منطقmoney/secretsearch/handler/span/debounce/IME/unmount/CSPراپوششمی‌دهند. شکست اولیه۶caseفقط بهimportجدید ظاهری درharnessCSV بود؛ mockنمایجدول افزودهشد و assertionهای handler/replay/403/409 حفظشدند. یک خطایcompile میانیcaptionدرfallback اصلاحشد؛ rawlogها محفوظ‌اند. Backendsource/SQL/BFFتغییر نکرد؛ fullSQL تازه اجرا و ادعا نشده است. `admin-d49-final-source.json` hashهایsourceپنل نهایی را نگه می‌دارد.

درChrome با نشست واقعی، نمایش۲۷کالا، تایپ«آیفون»بدونsubmit→۱نتیجه/پاک‌کردن→۲۷، sortتعدادتنوع نزولی وfacetدستهٔلپ‌تاپ→۳از۲۷ بررسیشدند؛ AXدسته‌بندی‌ها۵ردیفواقعی وpagesizeرانشان‌داد. پیمایش سریع۲۵بخش به‌دلیل نرسیدن snapshotبهheadingموردنظر و سپس اختلافAX/frame **پذیرشصفحه‌به‌صفحهنیست**؛ راهنمایهمه فقط درsource بررسیشد. `admin-d49-browser.json` مرز دقیق مشاهدات را ثبت می‌کند. IABtab4وروداست؛ credential/OTPخواندهیامنتقلنشد. نشستChromeحفظشدهوMFAدورزده نشده؛ screenshot/موبایل نهایی/ثبتفرمان تعاملی جدید ادعانیست.

**ادامهٔ آماده:** بازبینی خواندنی مستقل هرصفحه باheadingقطعی، reset/ستون‌ها/IME درمرورگر وmobile؛ سپس نقص‌های خاص جدول/جریان همانحوزه طبقADMIN-TABLES. گفت‌وگو،امنیت،policyوworkspaceمدارک باجدولCRUDعمومی جایگزین نشوند. راهنمای۲۵بخش/اتصالcomponent به‌معنی نهایی‌شدن همهٔکسب‌وکارها نیست. A102،پذیرشعملیاتی ارسال و وابستگی‌هایD16/D30/سیاست‌هایاصلی هنوز بازند؛ کلپروژه کامل نیست.

## فیلترها و دادهٔ واقعی گوشی D48 — روی اصلی فعال است

دسته‌بندی محصولات دیگر فلش ندارد و با نشان انتخاب نمایش داده می‌شود. فقط بخش‌های بازشدنی آکاردئون‌اند؛ ویژگی‌های بی‌گزینهٔ مدل‌های market-only در فیلتر محصولات مخفی می‌شوند، مگر انتخاب فعالی برای پاک‌کردن داشته باشند. فهرست کوتاه دسته‌ها اسکرول تو‌در‌تو ندارد؛ پنل موبایل تمام‌عرض، اسکرول مستقل، footer ثابت و بازگشت فوکوس دارد. رم/حافظهٔ کاتالوگ گوشی با کاشی انتخاب و تعداد واقعی مدل نمایش داده می‌شود؛ جست‌وجو فقط برای فهرست بلند است.

انتخاب دوبارهٔ دسته برند/ویژگی‌ها را پاک نمی‌کند. دکمهٔ حالت بدون نتیجه اکنون دسته و جست‌وجو را هم پاک می‌کند و به همهٔ محصولات برمی‌گردد. قیمت فارسی با debounce خودکار اعمال می‌شود؛ مبلغ همچنان ریال دقیق است. کارت‌های کهنه هنگام انتظار یا قیمت نامعتبر inert می‌شوند. کارت گوشی فقط رنگ/حافظه‌های سازگار با تمام فیلترهای جاری را نشان می‌دهد. اگر انتخاب رنگ حافظه را تغییر دهد، پیام زنده و روشن همان‌جا ظاهر می‌شود.

دادهٔ افزایشی واقعی: S25+، S25 Edge، Z Flip7 و Z Fold7 با ۲۸ ترکیب ثبت‌شدهٔ منطقه‌ای و ۱۳ عکس رسمی سامسونگ اضافه شدند؛ مجموع اکنون **۱۲ مدل / ۹۵ ترکیب / ۴۱ عکس رنگی رسمی** است. هیچ قیمت، موجودی یا منبع عمومی اضافه نشد و این ردیف‌های Development تضمین تأمین/رجیستری/گارانتی نیستند. [منشأ خصوصی و محدودیت‌ها](SAMSUNG-IRAN-MARKET-DATA.md) مرجع است؛ ترکیب فرضی یا رنگ آنلاین انحصاری وارد نشد.

فرمان یک‌بارهٔ `scripts/import-phone-data-extension.py --apply-main-development` با همان ۱۴ DLL پذیرفته‌شدهٔ API83 و سرویس‌های واقعی Catalog/Market اجرا شد؛ backend نیمه‌تمام A102/D47 ساخته یا migrate نشد. نتیجه: ۴ مدل / ۲۸ ترکیب، ۰ تعریف/قاعده/گزینهٔ تازه؛ تکرار ۰ created / ۴ preserved. hash محتوای ۱۲۳ جدول حساب/سفارش/پرداخت/اعتبار/انبار پیش و پس برابر بود. هیچ حساب، SKU، قیمت یا انبار تازه ساخته نشد؛ API descriptor و DLLها دقیقاً ثابت ماندند. [گزارش ورود](../artifacts/checks/phone-extension-main-applied.json) و [۷ بررسی واقعی API](../artifacts/checks/phone-extension-main-api.json) ثبت‌اند.

runtime جاری `tmp/storefront-runtime-design-main-8cd59a1790ef4830ab189fddbe092e88`، PID78235 در زمان ثبت؛ restart همان `python3 scripts/serve-main-storefront.py` است و descriptor current مرجع زنده است. بسته از کد یکپارچهٔ D45/D46 ساخته شد؛ هیچ کار هم‌زمان پنل یا backend برگردانده نشد. manifest جدید ۲۴۱۳ فایل دارد؛ ۴۷۱ URL دارایی قبلی حفظ شده‌اند. [گزارش انتشار](../artifacts/checks/storefront-filters-main-release.json) مرجع است.

۶۲۳ تست / ۰ شکست، lint هفت فایل تغییرکرده ۰ error/۰ warning، strict TypeScript و Next build پاس‌اند. ۱۰۲ HTTP شامل ۸ صفحه، همهٔ ۸۸ دارایی جدید byte-exact و ۶ URL قدیمی نمونه پاس شدند؛ ۴۵۷ ورودی source در build ثابت ماندند. ۱۳ عکس رسمی HTTP200/MIME تصویر داشتند. build میانی فقط به‌علت نبود فیلد unit در fixture تست رد شد؛ اصلاح و بستهٔ نهایی دوباره ساخته و بررسی شد. پروژهٔ importer نیز ۰ warning/۰ error ساخت شد.

مرورگر ۲۱ مشاهده/بررسی ثبت کرد: FA/EN و RTL/LTR، روشن/تاریک، عرض‌های۳۲۰/۳۷۵/۷۶۸/۱۲۸۰ بدون overflow صفحه، پنل۳۲۰/۳۷۵ با x=0 و تمام‌عرض، footer ثابت، Escape/focus، حفظ برند، حداقل/حداکثر فارسی، وضعیت inert/busy و سپس ۱ نتیجه، قیمت نامعتبر و بازیابی دستهٔ خالی به۱۲ محصول. رم۱۶ فقط Fold7 با۱ترابایت/۲رنگ نشان داد و تغییر به نقره‌ای پیام رم۱۲/۲۵۶ را اعلام کرد. console error=0؛ viewport reset، FA/light و query آزمون پاک شد؛ سبد۱قلم و مقایسه۲قلم کاربر حفظ شدند. [گزارش مرورگر](../artifacts/checks/storefront-filters-browser.json) و عکس‌های real-phones-desktop/phone-mobile/mobile-price/en-dark-mobile مرجع‌اند.

هیچ server یا DB بازبینی ساخته نشد؛ API/ادمین/Docker/Redis/Parseh restart نشدند. آزمون کامل backend SQL تازه اجرا نشد؛ این برش دادهٔ افزایشی از runtime پذیرفته‌شده و UI است. دستگاه فیزیکی، WCAG کامل و سنجش عملکرد ادعا نیست. ادامهٔ D47 و A102 و وابستگی‌های D16/D30 همچنان بازند؛ تکمیل این درخواست به‌معنی پایان کل پروژه نیست.

## بازطراحی فروشگاه D46 — پایهٔ طراحی فعلی

هدر،hero،دسته‌ها وکارت‌های محصول/گوشی،سطح‌ها و رنگ‌های مکمل با حفظ رنگ برندCMS و light/dark یکدست شدند. railبومیلمسی/صفحه‌کلید با scrollbarنمایان و کنترل فقطهنگامoverflow، منوی واقعی دسته‌ها باEscape/outside/focus،منوی موبایل باscrollمستقل وfooterثابت،bottomnavباactivepill وsafearea وحرکت‌های کوتاه باreduced-motion اضافه شد. درphonecatalogنوارمقایسهٔکالاهایعادی مخفی است تا باcomparisonگوشی هم‌پوشانی نکند؛ انتخاب‌های کاربر حذف نشده‌اند. محتوا/رنگبرند/داده وپول/جریانخرید حفظ شدند.

runtime اولیهٔ D46 `tmp/storefront-runtime-design-main-732a7ba87d8a41b59327429fa3a1c199`،PID43779 وrestart `python3 scripts/serve-main-storefront.py`؛ descriptorcurrentمرجع زنده است. [گزارش انتشار](../artifacts/checks/storefront-design-main-release.json) و [مرورگر](../artifacts/checks/storefront-design-browser.json) مرجع‌اند.621تست/0fail،lintفایل‌های تغییرکرده0error/0warning،NextbuildوstrictTypeScript و104HTTPپاس؛88دارایی جدیدHTTPbyteexact و429URLقبلی محفوظ‌اند.457ورودیsourceپیش/پسbuildثابت ماندند.

مرورگرFA/EN وRTL/LTR،روشن/تاریک،عرض320/375/768/1280 بدونoverflowکلصفحه،منوی375×640 باscrollداخلی،فوکوسEscape،railبههرجهت،جست‌وجویواقعی۲نتیجه و فیلتررم8 از۸به۵مدل را تأیید کرد. تداخلارتفاعهدر،متن/عکسدسته وbadge/ابزارکارت دربازبینیاصلاح شدند. consoleerror0؛viewportreset وFA/light وqueryهایآزمونپاک‌شده‌اند. عکس‌هایdesktop/final-mobile-menu/final-mobile-cards وmobile-filters درartifactها ثبت‌اند. دستگاهفیزیکی/WCAGکامل/perfادعا نیست؛ reduced-motionدرsourceبازبینی،OSmediaemulationدردسترسنبود.

این کارAPI/DB/migration/seed/ادمین/Redis/Parsehرادست نزد؛APIdescriptorexactماند. ادمین هم‌زمان درگفت‌وگوی مستقلD45رویهمان3173به‌روزرسانی شد و حفظ شد. هیچpreviewlistenerیاDBجدا ساخته نشد؛buildابتداییsandboxمتوقفماندوفقطPIDاحرازشدهٔهمانbuildآفلاینمتوقفوشناخته‌شدهٔمجازNextساختهشد. بسته‌ها وrestartآفلاین قبلی محفوظ‌اند؛این‌ها نسخهٔدرحال‌اجرای دوم نیستند.

## اصلاح سلامت نسخهٔ۸۳ — تاریخچهٔ پیش از D47

در این اصلاح، `tmp/api-runtime-current.json` بستهٔ مستقل readiness83 را انتخاب کرد؛ restart `python3 scripts/serve-main-api.py`، session89311/PID98964 در زمان ثبت. این runtime اکنون rollback پیش از D47 است؛ نسخهٔ فعال۸۵ در بخش D47 شرح داده شده است. فایل محیط و DataProtection keyring قبلی محفوظ‌اند؛ privateFiles همچنانDisabled و workerاعلان داخلی گوشی طبق D44 روشن است. 0migration/seed یاDockerrestart در این اصلاح سلامت انجام شد و descriptorهای storefront/admin دقیقاً ثابت ماندند.

فقط healthroutes درProgram نسبت به frozenintegrated2 تغییر کردند: تطبیق exacthistory هر12ماژول،503 قطعSQL،no-store/noindex.25SQL واقعی و1172unit همان14DLL پاس؛ 881آزمونSQL کشف شده ولی full881تازه اجرا نشده است.12HTTP اصلی شامل live/ready باheaderدقیق،401سه‌مسیر خصوصی،FA/ENmarket/account/moments وادمین پاس. `readiness-schema-source-acceptance.json`، `readiness-main-release.json` و [READINESS](READINESS.md) مرجع‌اند. شواهد856SQL زیر مربوط به coreقبلی است، نه full881 تازه. اصلاح عملیاتی Linux/تمرینrestore هنوز پذیرفته نیست.

## پذیرش بستهٔ یکپارچهٔ اصلی83

- Backendcore:1172unit،856SQL متمایز/0fail/0skip در449+407؛14DLL exact درAPI/unit/SQL/حوزهٔ مرورگر. `parcel-shipping82-final-backend-verification.json` وfinalbatchplan/log/TRX مرجع‌اند. fixtureهای migration پس Down ناموفق بهlatest برمی‌گردند؛ خطاهای تاریخی rawمحفوظ‌اند.
- Frontend621/admin236/proxy27، strictTS و buildهای Next/Admin پاس. D41finalUI سه‌فایل به sourcemap runtime تطبیق داده شده؛ `phone-d41-source-acceptance.json` و `phone-d41-final-runtime-parity.json` مرجع‌اند.
- Wireواقعی:مرسوله30پاسخ/9فرمان/5عمل وclearance100پاسخ decodeشدند. مرورگر مرسوله دوpack/یکrepack/دوdispatch/دوdeliver،7POST/7UUID/0duplicate،قطعپسcommit→GETreceipt،IMEIپسخروج وlogoutچندتب را تأیید کرد؛ تماماًFulfilled شد. FA/ENمشتریactual360=scroll360 پاس؛ adminmobileکامل82 هنوز پذیرفته نیست.
- D41:8مدل/67ترکیب،فیلترهای سریع/back،guest→loginmerge،ترکیبimmutable،interest،درخواستSR-1،پیشنهاد رسمی/رضایت مشتری،workerاعلانstockواقعی+1 باmovementواحد/اعلان یکتا و65sمشاهده،دو مالک/logoutچندتب،FAEN/RTL-LTR/lightdark/mobile/keyboard/focusreturn بررسی شدند. نمونهٔ قیمت/انبار فقط GUIDfixture بود؛ از آن به اصلی importنشد. مسیر receiving/allocation/convert مرورگرپذیرفته نیست؛SQL دارد.

QA اختصاصی run b292a63685bd4f3c976edb906dbf2bd9 کامل retireشد:4listener،2تب162/163،GUID وcredentials حذف و masterعدموجودDBرا تأیید کرد؛ `parcel82-exclusive-phone-retired-d44.json` مرجع است. علاقه‌مندی پس قطع باreceiptGET بازیابی شد؛ درخواست تأمین موقع outage هرگز commitنشد/COUNT0 پس بازیابی. QA قدیمی مرسوله و7orphanاثبات‌شده نیزجمع شدند؛0unknownDBحذفشد. هیچ preview جدید نسازید.

## D47 — حساب همکار و پروندهٔ مشتری روی اصلی فعال است

مالک ظاهر قبلی جدول‌ها و فیلترها را رد کرده است؛ تأیید بصری نهایی ادمین نداریم. جریان قطعی حساب‌سازی: مدیر نام کاربری و رمز اولیه را تعیین می‌کند؛ همکار پیش از دسترسی عملیاتی، رمز را عوض و MFA را تکمیل می‌کند. DECISIONS و ADMIN-BUSINESS مرجع نیازها هستند؛ نسخهٔ واحد D44 پابرجاست.

**نسخهٔ اجرایی به‌روز شد:** API/Sayman روی۸۵migration و۲۲۲جدول است. API5080 بستهٔ `api-runtime-admin-business85-ff8859c17acf4dbf99679e31bcd52a27` را اجرا می‌کند. پنل در انتشارD47 بستهٔ `admin-runtime-quality-eefa8ba7cb5749b09634a786c6b9bd8f` بود؛ اکنونD49درابتدایSTATUS مرجعپنلجاری است. PIDزمانانتشارD47به‌ترتیب83156و83501بود. فرم ساخت همکار، CRM، راهنمای۲۵بخش و الگوی جدید فهرست‌ها فعال‌اند. storefrontD48 روی3000 با همان runtime وPID78235 حفظ شد. descriptorهای current مرجع زنده‌اند.

### قابلیت‌های فعال

- ساخت حساب و receipt حفاظت‌شدهٔ actor/UUID، grant محدود `staff_password_change`، تغییر رمز سپس Authenticator، بدون refresh یا مجوز عملیاتی تا پایان. تأیید ایمیل/موبایل جعل نمی‌شود؛ رمز در مرورگر یا receipt ذخیره نمی‌شود. journal فقط UUID دارد و پس از قطع پاسخ همان رسید را پیگیری می‌کند. نتیجهٔ نامشخص تغییر رمز، ورود دوباره می‌خواهد. نقش‌ها کارت و توضیح مجوزهای واقعی دارند.
- پروندهٔ مستقل مشتری، اطلاعات تماس در جزئیات، تعداد خرید قطعی جدا از کل سفارش، تاریخچهٔ سفارش/تیکت/پیام و cursor وابسته به فیلتر/مشتری/بخش. ظرفیت‌ها: فهرست۵۰، سفارش۲۰ و تیکت/پیام۵۰. root قراردادهای Identity/Sales/Support را ترکیب می‌کند؛ سرویس دامنه context ماژول دیگر را نمی‌خواند. `customers.read` فعلاً فقط Administrator است؛ `sales.read` و `support.read` علاوه بر آن لازم‌اند. بخش بدون مجوز null است، نه صفر ساختگی.
- راهنمای۲۵بخش و الگوی جست‌وجو/فیلتر بازشدنی/شرایط اعمال‌شده در گوشی، تأمین، دریافت، پرداخت، هلو، دیدگاه و گزارش چک. تاریخ‌های مالی همیشه نمایان‌اند. جدول عمومی کاتالوگ/CMS جست‌وجوی فارسی/عربی/اعراب/اعداد، مرتب‌سازی متن عددی بدون Number پول، محدودهٔ بارگذاری‌شدهٔ روشن و صفحه‌بندی دارد. کد CRM به فهرست، پروفایل، تاریخچه و UI مشترک تقسیم شده است.

### شواهد نهایی

۱۲۰۵ unit کامل، ۸۹۲ SQL متمایز، ۲۴۹ admin contract و ۲۹ proxy پاس‌اند. root ESLint بدون خطا/هشدار، Prettier، strict TypeScript پنل و build پاس‌اند (`admin-business85-publish-*`). هر۱۶پاسخ واقعی SQL/HTTP با decoder اصلی JS پذیرفته شد؛ cleanup صفر است.

SQL نهایی از ۴۴۳ قبولی حفظ‌شده + بازاجرای کل کلاس CRM با۳case + بستهٔ دوم۴۴۶ تشکیل شده است؛ **همان۱۴DLL و source محصول** در همه برابرند. revision۲ فقط helper capture را عوض کرد؛ همهٔ۸۹۲نام با discovery تطبیق داده شدند. `admin-business85-final-sql-summary.json`، `admin-business85-final-source.json` و `admin-business85-final-dll-parity.json` مرجع‌اند. هیچ testhost فعال backend باقی نمانده؛ قبل از build بعدی وضعیت فرایند را تازه بررسی کنید.

raw شکست‌های اولیه محفوظ‌اند: مسیر seed در build خصوصی؛ ترتیب projection در SQL و canonical owner پشتیبانی در CRM؛ خطای503 آخرین مرسولهٔ ناقص که با PhysicalPlan به409/parcel_capacity_conflict برگشت؛ و مسیر capture خود آزمون. summary اولیهٔ capture برای decoder اجرا‌نشده پیش‌فرض0 داشت: اصل در `...summary-original.json` و توضیح صادقانهٔ Ran=false/null محفوظ است؛ قبولی decoder فقط از گزارش final نتیجه می‌شود. شش fixture اولیه با تطبیق دقیق زمان TRX/SQL/پوشهٔ۷۰۰ و صفر حساب/نقش/receipt جمع شدند؛ اتصال فعال یا DB ناشناخته قطع/حذف نشد. `admin-business85-failed-fixtures-retired.json` مرجع است؛ fixture اکنون در شکست initialization هم cleanup می‌کند.

بستهٔ API خصوصی `tmp/api-runtime-admin-business85-ff8859c17acf4dbf99679e31bcd52a27` با manifest کامل و۱۴DLL برابر روی اصلی فعال است؛ `tmp/admin-business85-backend-prepared.json` مرجع بسته است. build خصوصی admin با run `eefa8ba7cb5749b09634a786c6b9bd8f` و sourceStable پاس و فعال شد؛ `tmp/frontend-quality-build.json` مرجع است. listener یا DB بازبینی ماندگار ساخته نشد.

### انتشار محلی با اجازهٔ صریح انجام شد

رد اولیهٔ بررسی خودکار، پیش از هر تغییر، در تاریخچه محفوظ است. مالک سپس صریحاً بکاپ و اعمال همان دو migration را مجاز کرد (DECISIONS/D47). نخستین پیش‌بررسی اجرای مجاز نشان داد API از قبل listener ندارد؛ پیش از هر توقف یا migration متوقف شد. همان runtime۸۳ با launcher معمول و config/keyring ثابت بالا آمد وreadyشد؛ فقطPID پیشین آماده‌سازی با اثبات برابری بقیهٔdescriptor تازه شد (`admin-business85-preflight-restart83.json`، `...prepared-api-rebind.json`). سپس ابزار apply با موفقیت اجرا شد.

دو migration `AdministratorProvisionedStaff` و `PrivateDigitalFulfillment` دقیقاً روی Sayman اعمال شدند: دو flag حساب، یک جدول receipt و سه جدول خالی سازگاری Sales. بکاپ COPY_ONLY/CHECKSUM با RESTORE VERIFYONLY وSHA کپی برابر تأیید شد؛ فایل خصوصی در `tmp/local-backups/pre-admin-business85-972a1e85a89448a1a102c2f83d5b1a43` محفوظ است (۴۴۵۶۴۴۸بایت). `admin-business85-main-backup.json` و `...main-release.json` مرجع‌اند؛ hash دادهٔ تمام جدول‌های قبلی با کنارگذاشتن فقط دو ستون افزوده برابر ماند. محافظ Down سابقه و حدود SQL با دو آزمون واقعی پاس شده‌اند. A102 هنوز endpoint/UI/پذیرش کامل تحویل دیجیتال ندارد و فعال نیست؛ سازگاری مسیرهای فیزیکی در رگرسیون بالا پذیرفته شده است. VERIFYONLY را تمرین restore کامل یا offsite معرفی نکنید.

ابزارهای پایدار `scripts/local_shop_ops.py` و `publish-local-business-backend.py` آماده و py_compile پاس‌اند: snapshot SHA همهٔ جدول‌های قبلی با کنارگذاشتن فقط دو ستون تازه، backup با COPY_ONLY/CHECKSUM/VERIFY و copy دقیق، تطبیق PID/port/cwd/manifest، دو migration دقیق و HTTP تازه. launcher API اکنون manifest کامل اختیاری را در restart می‌سنجد؛ descriptor83 فاقد manifest همچنان همان۱۴DLL قبلی را می‌سنجد. publisher فرانت‌اند schema را از API جاری می‌گیرد و metadata تجمیعی را تازه می‌کند.

پس ازAPI85ready، frontendprepare/apply فقطadmin را روی3173 فعال کرد. ۱۰بررسی HTTP شامل۷دارایی byte-exact و۴۰۱خصوصی پاس شدند؛ APIdescriptor ثابت ماند. `frontend-quality-eefa8ba7cb5749b09634a786c6b9bd8f-main-release.json` مرجع است؛ storefront/Docker/Parseh/Redis restart نشدند. قبولی LinuxDocker، restore یا offsite از این شواهد نتیجه گرفته نشود.

وابستگی انتشار پنل نیز صریح شد: builder گزینهٔ `--min-api-migrations` دارد و بستهٔ فعلی حداقل۸۵ می‌خواهد. آزمون منفی `admin-business85-frontend-dependency-guard.json` تأیید کرد prepare روی API۸۳ پیش از کپی artifact یا restart متوقف می‌شود؛ descriptor آمادهٔ قبلی و نسخهٔ اصلی عوض نشدند. `admin-business85-frontend-api-dependency.json` hash اشاره‌گر قبل/بعد را نگه می‌دارد؛ فقط metadata وابستگی افزوده شده و artifact/source بسته ثابت است. این محافظ جای اجازهٔ انتشار اصلی را نمی‌گیرد.

مک هنگام انتشار باز بود؛ با همان نشست واقعی مدیر درChrome و تب تازهٔ3173 بازبینی خواندنی انجام شد. فهرست کارکنان، فرم ساخت همکار بدون ورود رمز/ثبت، توضیح مجوز نقش، راهنما وEscape→فوکوس، فهرست۴مشتری شامل۳نمونه، جست‌وجوی واقعی۱نتیجه، پرونده/تیکت/دوپیام ازSQL بررسی شدند. نمای375×667 باiPhoneSE، فیلتر بازشونده، پروفایل و منوی موبایل در screenshot ابزار بررسی شدند؛ نمایش معمول دسکتاپ بازگردانده و queryآزمون پاک شد. کنسول۰message/error داشت؛ Issues جداگانه سه بهبود نام/id فیلد و یک blocked-eval درchunk فرم/schema گزارش کرد؛ CSP تضعیف نشد و رفع این دو موضوع هنوز باز است. دستگاه فیزیکی/WCAGکامل/ورود تعاملی همکار/تأیید نهایی ظاهر توسط مالک ادعا نیست. رمز تازه یا تغییر credential باید توسط خود کاربر در مرورگر وارد و ثبت شود؛ تستSQL مسیر را پوشش می‌دهد. `admin-business85-main-browser.json` مرجع دامنهٔ مشاهدات است.

### سناریوهای Development روی SQL اصلی وارد شدند

[DEVELOPMENT-SCENARIOS](DEVELOPMENT-SCENARIOS.md)، `tools/admin-business-scenarios` و `scripts/admin-business-scenarios.py`: سه حساب با نام روشن «نمونه توسعه»، بدون رمز/نقش/تماس تأییدشده؛ دو تیکت، سه پیام و چهار فرمان از UserManager/TicketService. ایجاد حساب و audit اتمیک، UUID ثابت، replay و خواندن آمار واقعی دارند. host/listener/worker تازه شروع نمی‌شود؛ dependency اعلان در صورت فراخوانی خطا می‌دهد و تحویل زنده یا موفقیت provider جعل نمی‌شود. این حساب‌ها امکان ورود ندارند؛ ساخت همکار نمونه باید از پنل واقعی و MFA مدیر انجام شود.

build بدون warning/error، self-test روی SQL با دو اجرای بدون تکرار، رد Production پیش از اتصال و رد Sayman در self-test پیش از اتصال پاس‌اند (`admin-business85-scenarios-self-test.json` و `...scope-guard.json`)؛ cleanup صفر است. ابزار فقط به بستهٔ۱۴DLL پذیرفته‌شده ارجاع دارد و backend را rebuild نمی‌کند. پس از انتشار۸۵، `apply-main-development` رویSayman سه حساب/دو تیکت/سه پیام را با برچسب روشن ساخت. فقط شش جدول مجازIdentity/Support تغییر کردند؛ migrationhistory، کلیدها، مالی، انبار و سفارش حفظ شدند. manifest `admin-business85-scenarios-apply-main-development-c35ac19e0a6a45848ae3de62c672f919.json` مرجع است. هیچ رمز/نقش/تأیید تماس/امکان ورود برای نمونه‌ها ساخته نشد.

این بهبودنام/id وJITبا حفظCSP درD49پیاده و رویاصلی فعالشد؛ پذیرشbrowserIssuesنهاییهنوزبازاست. ادامهٔ آماده: پذیرش گسترده‌تر جدول‌های موبایل/مسیرهای عملیاتی وA102 طبقPLAN. سفارش/پرداخت/چک/ارسال نمونه به سیاست‌های واقعی نیاز دارند؛ D21 مخصوصQA به اصلی منتقل نشود. D16/D30 همچنان اطلاعات واقعی ندارند و خاموش‌اند؛ سؤال تکراری یا provider جعلی ساخته نشود. کل پروژه کامل نیست.

## D45 — کیفیت کد روی نسخهٔ اصلی فعال است

ESLint و Prettier با lock مستقل `tools/lint`، flat config، scriptهای lint/format و CI gate اضافه شدند. کامپایلر apps7.0.2 حفظ شده؛ parser ابزار TS6.0.3 دارد. baselineکامل516error/3warning بود؛ `npm run lint` و `format:check` کل source پس اصلاح بدون خطا/هشدار پاس شدند. 621تست فروشگاه،239تست پنل و strictTS هر دو پاس‌اند؛ logهای `artifacts/checks/d45-*` مرجع‌اند. Proxy بدون تغییرِ hash نسبت به27تست پذیرفته‌شده است. GitHub job اجرا نشده است.

callbackها و صفحه‌بندی خواندنی پایدار شدند؛ مقادیر صفحهٔ قبلی صریح به دریافت بعدی داده می‌شوند تا effect با هر پاسخ دوباره از ابتدا اجرا نشود. `advanceRequestGeneration` نسل فعلی درخواست را در cleanup باطل می‌کند؛ این ref شمارنده است و گرفتن snapshotعدد آن، خواندن دیررس را زنده می‌گذارد. استثناهای lint محلی و توضیح‌دارند؛ no-any/hooks خاموش سراسری نداریم. harness واقعی۱۰handler گوشی/سبد با unknown و callbackmemo نوع‌دهی و پاس شد. ۹مجموعهٔ پاسخ تاریخی با decoderهای اصلی بازاعتبارسنجی شدند (`wire-lint-cleanup-replay.json`)؛ SQL تازه محسوب نمی‌شود. بازاجرای wireقدیمی گوشی در تطبیق DLLroot/bin متوقف شد (`phone-wire-d45-revalidation.log`) و قبولی تازه ادعا نمی‌شود؛ شاهد قدیمی بازنویسی نشد.

بستهٔ sourceثابت و کامل D45 پس اصلاح‌ها ساخته و روی همان اصلی3000/3173 فعال شد؛ D46 storefrontdesign محفوظ است. `tmp/frontend-quality-build.json`/`frontend-quality-prepared.json` و `artifacts/checks/frontend-quality-main-release.json`: فروشگاه27 و پنل10HTTP/assetexact پاس، API descriptorدقیقاًثابت،0migration/0Dockerrestart. restartها در `scripts/serve-main-{storefront,admin}` و ساخت/انتشار در `build-local-frontends.py`/`publish-local-frontends.py` هستند. publisher اکنون manifest/evidence/آرشیو build/prepared را با نام یکتایrun می‌سازد؛ builder نیز --onlyadmin/storefront و label دارد و logهای آینده یکتا هستند. گزارش کامل1ff24 ازprepared پیشین آرشیو شد؛ adminbuildlogنام ثابتِ نخست باbuildبعدی بازنویسی شده و به‌عنوانlogدقیق بستهٔ نخست استناد نشود. شواهد source/artifact آن محفوظ‌اند. در پایانD45، API بستهٔ frozenreadiness83 بود؛ اکنون بستهٔ مجازD47 روی۸۵ فعال است. source نیمه‌تمامA102 را جداگانه migrateنکنید.

ساخت اول Next دو دقیقه بی‌پیشرفت ماند و فقط فرزند ownednext-build پس تطبیقPID/cwd متوقف شد؛ log/report اولیه حفظ است. اجرای مجاز تازه، هر دو build را در16ثانیه باsourceStable پاس کرد. generatedPWAازhashsourceخارج و خودbuild-pwaدرscope است؛ دارایی‌های generated درmanifestنهایی pinهستند. نسخه‌های جدید runtimeQUALITY باrun1ff24a7d67594fb9a2f650342c40ba91 انتخاب شده‌اند؛PIDتازه ازdescriptorبخوانید.

بازبینی خواندنی واقعی با نشست مدیر در GoogleChrome انجام شد: داشبورد23کالا/5دسته/14مانده‌آزاد/3طرح، لیست کالاها، فرم دو زبان آیفون وEscape→فوکوس همان ویرایش، سفارش خالی، موجودی16تنوع/16گردش، جست‌وجوی منو با یعربی و اعتبارسنجی بازهٔ گزارشچک بررسی شدند. هیچ ذخیرهٔ تجاری/تغییر credential نشد. سفارش اصلی0 بود؛ ارسال/خرید در مرورگر اصلی آزموده نیست. کاربر هم‌زمان درChromeفعال بود و دو بار ابزار تغییرتب را متوقف کرد؛ کنترل را به زور ادامه ندهید. تب IAB164 هنوزlogin است؛ نشست واقعی درChromeبوده، نه IAB. بازبینی موبایلِ احراز‌شده هنوز باز است. D47صریحاً ظاهر جدول‌های این نسخه را تأیید نکرده است.

گفت‌وگوی «Find account login credentials» D46 را تمام و idle شد؛ آخرینcursor `dc51c527-64db-463d-bc33-4027c734a3c3:10`. هیچپیامیبهآن ارسال نشد. sourceهایبازطراحیstorefront را حفظ کنید؛ descriptorمرجعجاری است. D46 درartifactهایstorefront-designمرجعپذیرشخودرا دارد؛ QAتازهٔ رابط پس اصلاحD45ازآن نتیجه گرفته نشود.

## ادامهٔ فعال A102 — قابلیت دیجیتال/مختلط هنوز فعال نیست

[طرح تحویل دیجیتال](DIGITAL-FULFILLMENT.md) و قرارداد/مدل اولیه درSales افزوده شده‌اند. متن هرواحد محدود/UTF8 معتبر، رمزگذاری owner/order/item، خلاصه بدون محتوا، endpoint خصوصی reveal، ledger مشترک۶۴ و جلوگیری از گیرکردن سفارش مختلط قواعدند. مدل، service اولیه، DP protection و اشتراک ledger با Parcel در source وجود دارند. migration سازگاری `PrivateDigitalFulfillment` با سه جدول خالی و محافظ Down در بستهٔ۸۵ آزموده و روی اصلی اعمال شده است؛ **قابلیت دیجیتال فعال یا کامل نیست**. root endpoint، BFF، UI و پذیرش کامل دیجیتال بازند؛ checkout نیمه‌تمام را جداگانه روی اصلی migrate نکنید.

buildآفلاین اولیه به‌علتNuGetrestoreشبکه معطل و فقطPIDهمانbuild متوقف شد؛ باcacheمحلی/sourceخالی/NuGetAudit=false ساخته شد.9خطای compileتست paramsnew اصلاح شدند. نخستین12unit،11pass/1fail fixture داشت:InlineDataسورروگیتنامعتبر را حینserializationجایگزین می‌کرد؛ اکنون surrogateداخلFact ساخته شد و12/12unitپاس‌اند. `digital-fulfillment84-rules-initial.log/.trx` محفوظ‌اند؛ قبولی جدید ازlog/TRXتازه بررسی شود. خروجی buildخصوصی `tmp/digital-fulfillment84-build`؛ هیچ bin/mainruntime بازنویسی نشده. تاپایانtesthostمحصولbuildنکنید.

اقدام بعدی A102 پس از D47: قراردادهای service دیجیتال، تراکنش/مجوز root و endpointهای ثبت/خواندن خصوصی را نهایی کنید؛ سپس SQL واقعی دیجیتال/مختلط، BFF و رابطFAEN/admin. اتصال اولیهٔ history/ledger به Parcel انجام شده و رگرسیون فیزیکی در۸۹۲SQL بستهٔ D47 پاس است؛ این شاهد، پذیرش کامل مسیر دیجیتال نیست. قابلیت روی همان اصلی پس از پذیرش فعال شود. باقی D34 درPLAN است؛ پایان یک برش پایان کار نیست.

## تصمیم‌ها و وابستگی‌های باز

D16 درگاه/SMS/email وD30 نسخه/APIواقعی هلو نداریم/خاموش؛ مجدد سؤال تکراری یا providerجعلی نسازید. D21 سیاست12345rial/بدونمالیاتجدا/60min/max2 فقطQA؛ اصلی هنوزpolicyunset. D27 نمونهٔDevelopmentصریح مجاز؛ Productionنمونه/بدیل ندارد. D35 ارسالچکیپسدریافتکاملupfrontوتأییددستی همهچک‌ها. D36 اعتبارسازمانیفعلاًخارجدامنه. D32 Redisپارسهعمداًrunning؛ دست‌نخوردهبماند. D43Docker/SQL بازیابی/CHECKDBپاس؛ restart تازه لازم نیست و پرسش قبلی این گفت‌وگو منقضی‌موضوع است. D33 کلtmpپاکنشود؛ current/rollback/helper/key/backup/evidence محفوظ‌اند. هیچ انتشار بیرونی یا اتصال واقعیprovider پذیرفته نیست.
