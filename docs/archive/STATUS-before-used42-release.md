# وضعیت و نقطهٔ ادامه

آخرین به‌روزرسانی: 2026-10-25. **اصلی۴۰ محلی منتشر است؛ سورس۴۲ دست‌دوم در حال ساخت و هنوز منتشر/پذیرفته نیست؛ کل پروژه و PDF کامل نیست.** مرجع `artifacts/checks/reviews40-main-release.json` و [PLAN](PLAN.md)، [PRD](PRD.md)، [DECISIONS](DECISIONS.md) است. [آرشیو پیش از۴۰](archive/STATUS-before-reviews40-release.md)، [پیش ازمقایسه](archive/STATUS-before-comparison-release.md) و آرشیوهای۳۹/۳۸ شواهد تاریخی‌اند.

## اجرای محلی جاری

- SQL Sayman: **۴۰migration/۱۱۹جدول**؛۳۹تاریخی در۸schema و۱Reviews. تمام۱۱۳جدول قبلی/تعاریف/history، قبل/بعد/پس ازsmoke دقیقاً محفوظ‌اند؛فقط۵جدول خالی Reviews وhistoryآن اضافه شدند. اصلی صفرReview/Order/Reservation/Settings/Policy/SourcingRequest وStock101/0/0 دارد. هیچseed،سیاست مالی،provider یاCMSانتشاراصلی تغییر نکرد.
- API5080: `tmp/api-runtime-reviews40-c0a13fa563c64746bc95bcf08534fbac`؛PID87611/session79583؛۱۳hashمحصول درreleaseثبت‌اند،keyringقبلی `tmp/identity-keys`،ContentRoot=`backend/src/Shop.Api`. restart: `python3 scripts/backend-local.py --runtime-dir tmp/api-runtime-reviews40-c0a13fa563c64746bc95bcf08534fbac`.
- Next3000: `tmp/storefront-runtime-reviews40-main-4b836ab9127e47e6bf7917bcc037a37c`؛build=`Z-aVV2A6CSTVxqDBI40p9`؛PID87230/session83008؛APIواقعی5080/fixturemodeخاموش و۱۴۱staticقبلی محفوظ. restart: `python3 tmp/reviews40-release.py serve`.
- ادمین3173: `tmp/admin-runtime-reviews40-main-0c6ec44bffc747c2838bd25fa0aee974`؛PID87229/session85270؛صف/بررسی/پاسخ نظرات افزوده و۲۶۷assetقبلی محفوظ. restart: `node tmp/serve-reviews40-main-admin.mjs`. servingRootهمینartifactاست،نهapps/admin/dist.
- descriptorهای `tmp/{api,storefront,admin}-runtime-current.json` مرجع جاری‌اند؛قبلتوقفPID/مسیر/hashبازبینی شود. Redis چت Parseh طبقD32 عمداًrunning و دست‌نخورده است. صفرSaymanTest؛QA3105/3175/5181/5182 بسته؛تب21/22 وcredential/keyخودQAپاک وviewportresetاست.

## نظرات داخلی پذیرفته در محدودهٔ دسکتاپ

[REVIEWS](REVIEWS.md): حساب/کالا یکنظر،نامعمومی/رضایت/متنساده/امتیاز۱–۵/زباناصلیFAEN،revisionهایimmutable وPendingدرهر ویرایش. پنل باCMSpermission/MFA/نسخه/RevisionId وrootSerializable/audit تأیید/رد/پنهان/پاسخ می‌دهد. گزارش یک‌بارهرحساب/نسخه و شمارندهٔنسخهٔفعلی درپنل است. publicفقطApproved+کالایPublished،بدونowner/نامخصوصی است. verifiedBuyerفقطازSalesPaid/FulfilledغیرDemoدرsnapshot1/2 می‌آید؛ورودی/پنل نمی‌توانند بسازند. providerپرداختهنوزخاموشاست وواقعیتQAپرداختواقعیادعانشد.

۸۱۵unit،۴۸۱SQLواقعی نهایی(شاملrollback/reapplyخالی،منعDownتاریخچه‌دار،race/replay،مجوز/مالکیت/متنساده وrollbackاتمیکaudit)،۳۰۸فروشگاه/۱۸۶پنل،typecheck/build/modelcheckو۱۳DLLیکسان API/unit/SQL/harness موفق‌اند. ۸rawSQL و۱۳rawمرورگرباdecoderتولید/hash/بدونnormalizationپذیرفته‌اند. فایل‌هایشکستابتدایی(EFrestore،نبودنCLIدرPATH،analyzerخودتست وsandboxVSTest) محفوظ‌اند؛تست/محصولبرایپاسشدنضعیفنشده.

GUIDQA7bed…: صفرنظرپیشseed،ثبتازUIمشتریخودQA وMFAمدیرتولیدی خودش. دوبدنهSave ودوApprove دقیقاًیکسان،چهارپاسخکامل200پسازcommitقطعشدند؛replayfalse/true وGETبازیابی فقطیکrevision/دوcommand/دوevent را ثابتکرد. سپسReply/Report/نسخهقدیمی409→GET/ویرایشPending/Approve/Hide/ویرایشEN/Reject،وbuildنهاییجهت۴/۵باsubmit/approve/نمایشFAENمثبت‌اند.۱نظر/۴revision/۱۱receipt/۱۰event/۱report؛Stock وCatalog/CMS/مالی وتمامجدول‌هایغیرمجاز ثابت‌اند. SQL/بدنه‌ها وcleanupپیش‌فرضexit0ثبت‌اند. scriptبه‌صورتliteralمتن،صفرscriptداخلReview/صفرbadgeخریدارساختگی دیدهشد.

Core/full-lifecycle و۴response-loss رویNextاول=`_Ns0V7XQPud3F51nT25BI` بود؛فقطbdiامتیازدرNextنهایی=`Z-aVV2A6CSTVxqDBI40p9` عوضشد وsubmit/approve/publicFAEN واندازه/تصویرنهایی دوباره آزمودهشد. API/admin/SQLهمان۱۳DLLاند؛همهٔ۱۳پاسخبه‌اشتباهبهbuildنهایی نسبتندادهشده‌اند. مشاهدهٔconsoleنهاییهردوتبخالی است؛اسکرین‌شات‌های `reviews-browser-{fa,en}-final.jpg` واقعیdesktop1280/client1265بدونoverflowاند.

## انتشار و حفظ اصلی

`main-pre40-release-backup.json`:بکاپتازه۱۵٬۸۴۷٬۴۲۴بایتCOPY_ONLY/CHECKSUM/VERIFYONLY+۱XMLopaqueدر0700/0600رویهمینمیزبان،بدونrestore. `reviews40-main-{before,after,post-smoke}.json`:همه۱۱۳جدول/تعاریف/historyوStock/مالی دقیقاًبرابرند؛newReviewsخالی‌اند وCHECKDBPHYSICAL_ONLYموفقاست. ۸۱۴GETشاملتمام۳۳۹قبلی/hashتمامassetهایقبل/جدید/ReviewAPI/401وno-storeپذیرفته‌اند.

Verifierاولپس‌ازmigrationدرخواندنکلیدomittedلیستخالیtriggers خطاداد؛APIتازهیکباراجراآزمایشیوNext/adminبه‌علتgateاجرانشدند. APIدوبارهبسته، `.get(section,[])`متقارنبرایلیستخالیاصلاح،guardکاملwriterمتوقفموفق،سپسهرسهruntimeبالاآمدند. هیچتعریف/data/guardحفظتاریخچهضعیف/restore/downنشد.

فضایآزادبه۶٫۹GiBافتکرد. `runtime-cow-preservation.json`۴۵۷کتابخانهٔتکراریartifactقدیمیرا باclonefileCoW/هرinodeمستقلونلینک۱،hashپیش/پسیکسان،بدونحذفruntime/بکاپ/فایلخصوصی یا volumeهم‌فضاکرد؛حدود۵٫۸GiBافزایشآزاداندازه‌گیریشد وپیش‌بکاپ۱۳GiBبود. فایل‌هایliveAPItargetنشدند؛همهٔمسیرها/bytesنسخه‌هایقدیمی محفوظ‌اند. دربسته‌بندی‌هایبعدی ازCoWبرایکتابخانه‌هایثابتاستفادهشودتاSDKناتیوتکراری۶۰۰MiBدرهرنسخهفشارنسازد.

## بازها و اقدام بعدی

۱. دست‌دوم باSKU/دستگاه مستقل،گزارش نسخه‌دار سلامت فنی/باتری/آسیب/نامعلوم وsnapshotتاریخی سفارش؛مقایسه/جزئیات/سبد وپنل بههمان‌تنوع متکیبمانند. سپس facet/چندمنبع/تاریخچه بازار و هلوwarehouse/unit/reconciliation/apply.
۲. **QAموبایلcomparison/reviewsبازاست**؛viewport.setواقعاً۱۲۸۰می‌ماند. درخواست محدودباریک‌کردنپنلپیش‌ترارسالشده وپاسخنیامده؛عکسdesktopجایmobileپذیرفتهنشده. nativeCodexابزارمجازنبودودورزده‌نشد. coreHeaderکلیکبسیارسریعزبانپیشhydrationیکباربی‌اثربود،پسازstateآمادهکارکرد؛SSRlinkfallbackبرایزبانبهبودآمادهٔمستقل است. سؤال تجاری نیست.
۳. D14ادامه/API/پنل/SQLرامجازکرد؛تأییدتکراریظاهرلازمنیست. D16درگاه/SMS/ایمیلندارد؛فعالسازینیست. D21سیاستنمونهفقطQA،D32Redisروشنحفظاست. D29/30هلوversion/moduleنامعلومرا دوباره نپرسید؛staging/CSVپذیرفتهاماcanApply/canSyncLive=false وvendorواقعیحدسزده نشود. Reviewخارجی/دیجی‌کالابدونAPI/مجوزبازنشرنشود؛تربscrapeنشود.
۴. انبارچندانباری/ماندهقبلی،ارسال/مرجوعی/گارانتی/مالکیتدستگاه،کارکنان/بازیابی،گردشچک/مدارک،providerهویت/پرداخت/refund/ارسال،support/files/S3/ClamAV،SEO/CWV/Push/accessibility،CI/پایش/runtime/nativeLinux/offsitebackup/حجمواقعیو۱۲معیارPDFبازند. سیاستواقعیهزینه/مالیات/ماه‌درصدچک/مرجوعی نامعلوم است؛scaffoldیاadapterخاموشمعیارپایاننیست.


## ادامهٔ دست‌دوم و پاک‌سازی مجاز tmp؛ 2026-10-25

سورس دوmigration افزایشی Catalog.UsedItemInspections/UsedItemCommands/currentVariantFK و Inventory.IsSingleUnit دارد (۴۲ در مقابل اصلی۴۰)؛ **روی اصلی اجرا نشده**. گزارش نسخه‌دار immutable/receipt/replay، تک‌دستگاه SQLCHECK/منع رزرو فعال، quote3/4/5 و snapshot تاریخی order1/2، فرم مستقل پنل و نمایش SKU در detail/compare/cart/checkout/orders نوشته شدند؛ [USED-DEVICES](USED-DEVICES.md) مرجع است. Build API و typecheck دو رابط موفق؛۳۱۳فروشگاه و۱۸۶پنل موفق. هشتSQL هدفمند شامل downgrade guard/حفظ موجودی/auditrollback/reinspection-stalequote/order1+2history موفق‌اند. تست SQL نخست یک شکست واقعی خواندن گزارش تاریخی یافت: snapshot داخلی PascalCase با عدد رشته‌ای بود ولی parser ابتداcamelCase فرض کرده بود؛ parser به فرمت واقعی اصلاح و هشتSQL دوباره مثبت شدند. شکست و لاگ نخست محفوظ‌اند. ۸۲۶واحد پیش از این اصلاح parser مثبت بود؛ **واحد نهایی پس از اصلاح، رگرسیون کاملSQL، wire، بیلد رابط، مرورگر و انتشار۴۲ باقی‌اند**. فعلاً API/پنل جاری همچنان artifact۴۰ است، نه این سورس.

طبقD33، `scripts/cleanup-local-artifacts.py` ابتدا فهرست فقط‌خواندنی ساخت و سپس۸۵پوشهٔ بیلد قدیمی داخلtmp را حذف کرد. tmp از۹٫۹GiBبه۱٫۸GiB ظاهری رسید؛ به‌علتcloneهایCoW، افزایش واقعی فضای آزاد۱٬۷۹۵٬۱۵۳٬۹۲۰بایت(۱٫۶۷GiB)، از۶٫۹۵به۸٫۶۲GiB بود. hash تمام۲۰پوشهٔ محافظت‌شده، شامل نسخهٔ جاری/بازگشت، وابستگی restart، بکاپ/کلید وPDF دقیقاً برابرند. هیچSQL/Docker/volume/key/source/evidence حذف یا بازنویسی نشد؛ metadata descriptor فقطPID/session پس ازrestart به‌روز شد. `artifacts/checks/tmp-cleanup-{plan,applied,health}.json` شواهدند. مسیرهای runtime حذف‌شده در اسناد قدیمی صرفاً تاریخی‌اند؛ بازگشت‌های خیلی قدیمی دیگر artifact محلی ندارند. پاک‌سازی همهٔtmp مجاز/لازم تشخیص داده نشد چون اجرای فعلی وbackup درآن است.
