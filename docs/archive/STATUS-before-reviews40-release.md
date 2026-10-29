# وضعیت و نقطهٔ ادامه

آخرین به‌روزرسانی: 2026-10-25. کل پروژه هنوز کامل نیست. مرجع جاری `artifacts/checks/comparison-main-release.json` است؛ [وضعیت پیشین و حدود قطعی](archive/STATUS-before-comparison-release.md)، [PLAN](PLAN.md)، [PRD](PRD.md) و [DECISIONS](DECISIONS.md) حفظ‌اند.

## نسخهٔ محلی جاری

- SQL اصلی Sayman همچنان۳۹migration/۱۱۳جدول است. انتشار آخر **فقط کد** بود؛ هر۱۱۳جدول/schema/history نسبت به baseline تازهٔ writerمتوقف دقیقاً حفظ شدند. هیچseed،تنظیم مالی،migration یا فعال‌سازی provider انجام نشد. اصلی صفرOrder/Reservation/Settings/Policy/SourcingRequest وStock101/0/0 دارد.
- API5080: `tmp/api-runtime-comparison-stock-fix-9ba3289c15f14b8aa2e35a77b5e3c50d`؛PID80950/session28379؛keyringقبلی `tmp/identity-keys`. نسبت به API39 فقط Inventory DLL تغییرکرد؛API DLL SHA به‌تنهایی تغییر را نشان نمی‌دهد و۱۳hashدرreleaseثبت‌اند.
- Next3000: descriptor `tmp/storefront-runtime-current.json`،runtime `tmp/storefront-runtime-comparison-main-...`،build=`VnQaUZ1kSxSjAgzUZ2GPS`؛PID80983/session21914؛API واقعی5080/fixturemodeخاموش. ۱۳۴staticقبلی محفوظ‌اند. restart: `python3 tmp/comparison-main-release.py serve`.
- ادمین3173 بدونتغییر همان `tmp/admin-runtime-cms-menu-0b87df7989c144a2b3a4b16406379da0`؛PID17440/session82033؛منوی مقصد/زیرمنو/ترتیب/CMS قبلاً پذیرفته‌اند. restart: `node tmp/serve-cms-menu-main-admin.mjs`.
- Redis چت Parseh طبقD32 عمداًrunning و دست‌نخورده است. credential/MFAمالک برایQA مصرف نشد. هیچ دیتابیس SaymanTest یا listenerQA باقی نمانده؛چهارتبخودQA بسته وviewportreset شد.

## مقایسه و اصلاح موجودی پذیرفته در محدودهٔ دسکتاپ

[COMPARISON](COMPARISON.md): مقایسه۲–۴محصول هم‌دسته،SKUهرستون/قیمت‌صحیح/Stock/گارانتی،۸ویژگیتایپ‌داردسته،overrideتنوع،نامشخص صریح،فقطتفاوت‌ها،Search وسقف۴،اشتراکURLعمومی وFA/EN پیاده و رویSQLواقعی آزموده‌اند. لینک اشتراکpreferencesرا عوض نمی‌کند؛SKUناموجودfallbackندارد؛mixed/hidden/duplicate/503+Retry آزموده‌اند. SKUuppercaseباCartlowerناسازگار بود؛ SQLredExpected3Actual0 وgreen اصلاح comparer Inventory/Client/BFF را اثبات کردند. افزودن دقیقSKU وتکرارqty1→2 درهمانGUID/صفررزرو پذیرفته‌اند.

۸۰۱unit،۴۷۵SQL واقعی،۳۰۳فروشگاه/typecheck/build و۱۳DLLنهایی یکسان موفق‌اند. `comparison-wire-acceptance.json`۱۵lookupخام واقعی+۲metadata مجزا باstrictdecoder/hash/بدونnormalization را پذیرفت؛gatewayیک503عمدی داشت. API metadataعمداًisPreview=true/dataSource=api دارد؛ این باfixturemodeBFFخاموش فرق دارد. QAداده‌نمونه فقطخودGUID بود وپاکشد؛چهارمدل/۸نوع/اعدادبزرگ/تغییرpublishH/categoryC ازپنل با حفظقیمت/Stock و۱۱۳جدولغیرمرتبط ثبت‌اند. قاعدهقدیمیSaveProduct چهارSKUمتنیfixtureراuppercaseکرد؛diagnosticصریح محفوظاست.

**موبایل مقایسه هنوز باز است.** ابزارviewportحتیset/reload/tabتازه واقعاً1280/client1265 می‌ماند؛ nativeCodexاجازهنداشت و دورزده‌نشد. پرسش محدود resize قبلاً ارسالشده وپاسخنیامده؛ رویسایتاصلی همبعداً قابلآزمون است. تصاویرcomparison-four-fa-desktop-confirmed وcomparison-final-visible-desktop واقعاًdesktopاند وبه‌جایmobileپذیرفتهنشده‌اند. انتشارمحلی باdesktopAccepted=true/mobileAccepted=false ثبتشد،نهپذیرشکاملUI.

`comparison-main-{before,after,public-smoke,release}.json`:۳۳۹GETشاملتمام۱۷۲مسیرقبلی/hashassetها/401no-store موفق‌اند؛تمام۱۱۳جدول/schema/historyدقیقاً ثابت. `comparison-browser-cleanup.json`cleanupپیش‌فرضexit0/حذفDBوcredentialخودQA/صفرQAرا ثابتکرد. تاریخی‌ها/candidateهایقبلیimmutableاند.

## ادامه تا تکمیل

۱. برش نظرات داخلی: SQL مستقلReviews،ثبت/ویرایش باحساب،صفبررسی/پاسخ/گزارشدرپنل،نمایشپسازتأییدوverifiedbuyerفقطازPaid/FulfilledغیرDemoدرSales. بازنشرنظرخارجیبدونقراردادوجودندارد. سپسدست‌دومباگزارشسلامتنسخه‌دار/SKUدستگاه وsnapshotسفارش.
۲. هلوstaging/CSVپذیرفتهاماcanApply/canSyncLive=false؛نگاشتشرکت/انبار/واحد،previewماندهباحفظرزرووapplyصریح/idempotent باقیاند. نسخه/ماژولvendorنامعلوم؛سؤال تکراریلازمنیست.
۳. بازارfacet/چندمنبع/تاریخچه،انبارچندانباری،ارسال/مرجوعی/گارانتی،گردشچک/مدارک،هویتprovider/پرداخت/refund،support/files/S3/ClamAV،SEO/CWV/Push/accessibility،CI/پایش/Linuxnative/offsitebackupو۱۲معیارPDFبازند. D14ادامهخودکاررامجازکرد؛D16providerندارد،D21سیاستنمونهفقطQA،D32Redisروشن حفظاست. سیاستواقعیهزینه/مالیات/چک/مرجوعیهنوزتعییننشده؛scaffoldیاadapterخاموشکاملنیست.
