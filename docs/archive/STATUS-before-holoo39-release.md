# وضعیت و نقطهٔ ادامه

آخرین به‌روزرسانی: 2026-10-24. **اصلی۳۸ منتشر و پذیرفته؛ سورس۳۹ هلو در حال پذیرش است؛ کل PDF و درخواست‌های تکمیلی ناتمام‌اند و goal فعال است.** سفارش توافقی/Quote5/Order2، لغو/انقضای واقعی، پیوند تاریخی تأمین، پنل و فروشگاه پذیرفته‌اند. [آرشیو پیش از۳۸](archive/STATUS-before-order38-release.md) جزئیات برش‌ها و شکست‌های قبلی را حفظ می‌کند. پس از این فایل [PLAN](PLAN.md)، [PRD](PRD.md) و [DECISIONS](DECISIONS.md) خوانده شوند.

## حدود قطعی

- D14 ظاهر و جریان و ادامهٔ API/پنل/SQL را مجاز کرده است؛ تأیید تکراری لازم نیست. Next16/React19، Vite و .NET10/EF10/SQL Server ثابت‌اند؛ context هر ماژول مستقل و تراکنش میان‌ماژولی در root است.
- همهٔ مبالغ ریال صحیح long/bigint، JSON رشتهٔ decimal و JS BigInt هستند؛ تومان فقط نمایش است.
- D16 نام/مستندات درگاه و SMS/ایمیل موجود نیست؛ providerها خاموش‌اند. هزینه/مالیات، شرایط دقیق چک و سیاست واقعی گارانتی/مرجوعی نامشخص‌اند. اصلی **صفر CheckoutOrderSettings/CheckoutChargePolicies، صفرOrder/Reservation/SourcingRequest** دارد؛ سفارش موقت نیازمند تنظیم صریح مدیر است و پرداخت در دسترس نیست. Quote4 محاسبه است؛ Quote5 قرارداد مستقل ثبت سفارش موقت است.
- D32 جایگزین D17 است: **parseh-chat-redis عمداً روشن شده و روشن بماند**؛ Redis در تمام انتشار دست‌نخورده running است. حساب/رمز/MFA مالک برای QA مصرف نشود؛ فایل شخصی/volume حذف نشود.
- D21 فقط سیاست‌های نمونه در GUID QA خودش را اجازه داد؛ flat12345ریال/exempt/enabled60/max2 به اصلی منتقل نشد. D22 انتشار/بازگردانی CMS در QA قبلاً بسته و پاک شده است؛ سؤال معلق ندارد.
- D23–D28 بازار/تأمین، دست‌دوم، review/compare و لحظهٔ سایمان لازم‌اند. منبع اولیه پنل/CSV و نمونهٔ مشخص SQL است؛ API بازار ندارند. نظر دیجی‌کالا بدون API/مجوز تأییدشده بازنشر نشود؛ ترب scrape نشود.
- D29–D30 هلو دارند؛ نسخه/ماژول نامعلوم را دوباره نپرسید. نگاشت SQL/پنل پذیرفته است؛ staging/preview/apply/sync لازم‌اند و endpoint vendor جعل نشود. [HOLOO-INTEGRATION](HOLOO-INTEGRATION.md).
- D31 QR محلی Authenticator روی پنل3173 موجود است؛ فقط enrollment، همراه کلید دستی و مهلت. MFA فعال کلیدش را دوباره نمایش نمی‌دهد؛ کلید تصویر مالک مصرف نشد. [MFA-QR](MFA-QR.md).

## اجرای جاری

| بخش | اجرای پذیرفته |
|---|---|
| SQL | Sayman،۳۸migration،۱۱۱جدول و هشت schema: identity3/payments1/credit2/cms1/catalog8/inventory7/sales10/market6 |
| API5080 | `tmp/api-runtime-order38-648dec755b1844ada41dc4209c04e5ee`؛ PID29623/session36636؛ SHA `ece8e8a26179ba5af98e8d857d5de616ce47450ac67eb11a994c9446515280dc`؛۱۳DLL آزموده؛ ContentRoot=`backend/src/Shop.Api`، keydir اصلی قبلی=`tmp/identity-keys` |
| Next3000 | `tmp/storefront-runtime-order38-main-25b8bc865ba6404eb1a991d20824c714`؛ PID29677/session22600؛ buildId=`MqWcSlB06dF3LOGvc72GW`، API5080 واقعی/preview خاموش؛ تمام۱۷۳۹فایل candidate و۱۲۴static قبلی محفوظ |
| admin3173 | `tmp/admin-runtime-order38-main-a7b18f5507a14455a325f8c2b08ed2ba`؛ PID29707/session79952؛ indexSHA=`35d41f605c3a611f1a4d036a40307ef90d73c8fd9a021546eb7e3890b4a5e4cd`؛۶۶فایل candidate و۱۹۴asset قبلی محفوظ؛ **servingRoot همین runtime است، نه apps/admin/dist قدیمی** |
| URL | فروشگاه `/fa` و `/en`، بازار `/fa/market`، سبد `/fa/cart`، تأمین `/fa/sourcing`، سفارش `/fa/orders`؛ پنل3173 |
| 3100 | کانتینر قدیمی، مرجع سورس جاری نیست |
| QA | صفرSaymanTest؛3105/3175/5181/5182/5183 بسته؛ تب‌های6/7/8/9 بسته، viewport reset و credential bindings پاک |
| Redis | parseh-chat-redis running طبق D32، بدون restart/stop |

`tmp/{api,admin,storefront}-runtime-current.json` و `artifacts/checks/order38-main-release.json` مرجع جاری‌اند؛ پیش از هر عمل listener/cwd/health دوباره سنجیده شود. timeout دلیل restart نیست. runtimeهای۳۵ و توصیف کامل قبلی در prepared/registration محفوظ‌اند؛ restore/Down/drop اصلی خودکار انجام نشود. **candidateها و acceptanceهای تاریخی عمداً main35/false را حفظ می‌کنند؛ runtime-current/release مرجع انتشار است.** برای اجرای مجدد همین نسخه: API با `scripts/backend-local.py --runtime-dir <همین API38>`، Next با `tmp/serve-order38-main.py` و admin با `tmp/serve-order38-main-admin.mjs`؛ helper بازیابی۳۵ به نسخه۳۸ نسبت داده نشود.

## پذیرش Order2 و انتشار۳۸

[MARKET-ORDER2-BOUNDARY](MARKET-ORDER2-BOUNDARY.md)، A36 و `order2-source-acceptance.json`: **۷۸۳واحد،۴۶۴SQL واقعی (۶۶تازه)،۲۹۲فروشگاه،۱۸۰پنل،۱۷پاسخ SQL HTTP خام** و typecheck/build/سه model check موفق؛ صفرfail/skip. migrationهای `20261024073909_OrderReservationsV2`، `20261024074017_AcceptedOfferOrdersV2` و `20261024074132_SourcingOrderLinks` افزایشی‌اند؛ پنج جدول تازه و markerها دارند؛ Down با تاریخچهٔ جدید پیش از DDL با51000 بسته است. SQL idempotent تولید شد؛ اجرای مستقیم آن ادعا نمی‌شود.

Quote5 جدا از Quote4، LineId و قیمت/متن کاملFA/EN هر توافق را نگه می‌دارد. ریشه Serializable، Cart و Agreementهای مرتب و سپس Inventory را قفل می‌کند؛ entitlement هر خط و رزرو مجموعSKU، انتقال SourcingReserved→Reserved/claims، AgreementConsumed و مصرف فقط خطوط خرید سبد و snapshot2/outbox اتمیک‌اند. لغو/انقضا فقط رزرو را آزاد می‌کنند و تخصیص/پیشنهاد مصرف‌شده احیا نمی‌شوند؛ inquiry می‌ماند. readerهای قدیمی fence دارند و تاریخچهٔV1 درV2 نسخهٔ اصل را نشان می‌دهد. projection Market مستقل و دارای retry/backoff/ack است؛ پرداخت را فعال نمی‌کند.

دو deadlock واقعی Stock↔Orders و Stock↔CartOfferLines در آزمون SQL دیده و گراف‌ها حفظ شدند. خواندن محدود graph هویت زیر app lock دامنهٔ خودش READCOMMITTEDLOCK شد؛ Serializable/Stock/Agreement/indexهای یکتا حفظ‌اند. دو contention واقعی سپس بدون retry و رگرسیون۴۶۴ موفق‌اند. فنس۴۰۰→۴۰۹ و literal نسخه۲ `temporary_order_v2_created` اصلاح شدند؛ قرارداد۱ شل نشد. آزمون واحد محدود sandbox پیش از test abort شد و اجرای مجاز۷۸۳ پذیرفته است. [آرشیو](archive/STATUS-before-order38-release.md) نام تمام TRX/گزارش‌های شکست را دارد.

سه راهنمای قدیمی FA/EN در سبد/تخصیص به امکان بررسی Order2 و خاموش‌بودن پرداخت اصلاح شدند؛ gate/سیاست مالی تغییر نکرد. candidate تازه `tmp/storefront-order38-guidance-candidate.json` و مجموعه `tmp/order38-guidance-runtime-set.json` همان۱۳DLL API و پنل۱۸۰تستی را انتخاب می‌کنند؛ candidateهای wirefix و اولیه منجمد و تاریخی می‌مانند. build sandbox بی‌پیشرفت متوقف و لاگش نگه‌داری شد؛ build مجاز/typecheck/۲۹۲تست موفق‌اند.

### مرورگر، قطع پاسخ و SQL واقعی

`order38-browser2-acceptance.json` و effects/ui-observations: مشتری تولیدی095...، یک تبدیل UI، سه بخش سبد، Quote5 با دو پاسخ200 قطع‌شده و همانUUID/body، سفارش با201و200قطع‌شده،401 دقیق همانUUID و refresh503، پنهان‌شدن دادهٔ خصوصی، Try again همان مالک و بازیابی همان سفارش واحد موفق‌اند. قیمت عادی123 و توافقی9007199254740993×2 مستقل و جمع نهایی18014398509494454ریال دقیق است؛ هیچ پولی پرداخت نشد.

پنج snapshot SQL، Stock3/0/2→3/3/0→3/0/0، AgreementConsumed/AllocationTransferred، دو claim نهایی، مصرف خرید و بقای inquiry را اثبات می‌کنند. لغو یک پاسخ از دست داد و با GET جاری بازیابی شد؛ دو قطع پاسخ یا تکرار mutation لغو ادعا نمی‌شود. CLI projection مستقل یکdelivered/صفرfailed ثبت و پیوند تاریخی از UI درخواست دنبال شد. **هشت بدنهٔ درخواست و هفت پاسخ خام** با hash و decoder تولید بدون normalization موفق‌اند (`order38-browser2-wire`). اشکال enum و مقایسهٔ قالب UTC فقط در verifier بود؛ rawها تغییر نکردند، tick دقیق مقایسه و شواهد اولیه حفظ شدند.

FA/EN روی موبایل390×844/client375 و تب تازه دسکتاپ/client1265، RTL/LTR و صفرconsole warning/error پذیرفته‌اند. پنل با رمز/MFA تولیدی خودش، دو ردیف مستقل همانSKU، متن کاملFA/EN و مبلغ ریالی درست در دسکتاپ1280 و موبایل375 پذیرفته شد. هیچ credential مالک استفاده نشد.

`order38-expiry-acceptance.json`: GUID مستقل0de...، ثبت عادی انگلیسی از UI، سپری‌شدن واقعی deadline بدون تغییر clock/SQL و runner واقعی: پیش ازdeadline صفر، پس از آن یکexpired، replay صفر. SQL موجودی3/0/0 و دو claimExpired، عدم احیای Agreement/Allocation، مبلغ/مهلت و inquiry را تأیید کرد؛ پیامExpired/منقضی و حذف لغو در EN/FA موبایل دیده شد. هر دو harness با default cleanup وexit0، DB و credential/key خودش را حذف کردند؛ guardهای after-browser2/after-expiry صفرQA و اصلی۳۵ محفوظ را ثبت کرده‌اند.

### بکاپ و بازیابی

`order38-restore-22aabb470a414d14b43a2df514039f4f.json`:۱۲بررسی، بکاپQA۲۲٬۱۳۸٬۸۸۰بایت COPY_ONLY/CHECKSUM/VERIFYONLY، restore بدونREPLACE به GUID تازه، CHECKDB کامل، هش/تعداد تمام۱۱۱جدول/۳۸history و rowversion، key ring کپی‌شده، هفت مسیر خصوصی مشتری، منع customer از admin و ورود واقعی کارکنان باMFA/متن کامل snapshot موفق‌اند. auth فقط identity کپی را تغییر داد؛ source SQL/key دقیقاً ثابت ماند. کپی/API5183/backup/credential/key پاک شدند. دو شکست اولیهٔ header/path ابزار با cleanup موفق حفظ‌اند؛ پذیرش به آن‌ها نسبت داده نمی‌شود. ابزار تازه `scripts/rehearse-order38-restore.py` guard قدیمی۳۴ را تغییر نمی‌دهد. این پذیرش همان میزبان Development است؛ nativeLinux/offsite/RTO/تولید را ثابت نمی‌کند.

### حفظ داده هنگام انتشار

`main-pre38-release-backup.json`: پس از توقف writerها، بکاپ۱۴٬۷۹۸٬۸۴۸بایت COPY_ONLY/CHECKSUM/VERIFYONLY همراه یکXML key ring خصوصی بدون parse،0700/0600، در همان میزبان نگه‌داری شد. مسیر/hash خصوصی در گزارش است؛ اصلی restore نشده است.

`order38-main-{before,after,post-smoke}.json`: هر۱۰۶جدول قبلی در projection ستون‌های قدیمی و تمام تعریف‌های قبلی ستون/index/FK/check/trigger محفوظ‌اند؛ فقط سه history افزوده، پنج جدول خالی و چهار ستون جدید اضافه شد و قید نسخهٔQuote به3/4/5 گسترش یافت. تمام history قبلی، چهارQuote قدیمی/JSON/۲۴installment، موجودی، کاربران/CMS/SKU محفوظ‌اند؛ marker تازه جعل نشد. موجودی۱۰۱OnHand/صفرReserved/صفرSourcingReserved، صفرOrder/Reservation/SourcingRequest/Settings/Policy و سه نمونهٔ بازار قبلی باقی‌اند. پس از انتشار وsmoke تفاوت حتی در Sessions هم صفر بود؛ تفاوت زندهٔ نشست‌ها در guard تاریخی پیش ازSQL (۲۲→۲۶) فقط متعلق به آن baseline است و reset/rollback نشده است.

تمام۱۷۳۹فایلNext و۶۶فایلپنل آزموده و۱۲۴static/۱۹۴asset قبلی حفظ شدند. `order38-main-public-smoke.json` **۱۱۱GETموفق، شامل هر۹۲بررسی قبلی**، صفحاتFA/EN و Order2/BFF/admin401/no-store و hash فایل‌های جدید/قدیمی را ثبت می‌کند؛ هیچ credential/POST استفاده نشد. DBCC PHYSICAL_ONLY پیش/پس و بعدsmoke موفق‌اند. نسخهٔ اصلی و سورس اکنون۳۸ هستند؛ سرویس‌های بیرونی و سفارش موقت همچنان بدون تنظیم صریح فعال نشده‌اند.

## سورس۳۹ هلو؛ در حال آزمون، منتشر نشده

`AccountingImports.cs` در SharedKernel و Catalog، API خصوصی `/api/admin/accounting/holoo/imports` و پنل `accounting-imports.tsx` اضافه شده‌اند. ورودی v1 استاندارد خود سایمان، شرکت/انبار/واحد و timestampUTC،۱–۲۰۰شناسهٔ ثابت یکتا، معنایquantity و پول صریح دارد؛ این قالب nativeهلو یا اتصال vendor نیست. batch/rows immutable در دو جدول Catalog و migration `20261024183809_HolooImportStaging` ذخیره می‌شوند؛ Down با هرhistory پیش ازDDL بسته است. PUTباUUIDثابت و hash محتوای اصلی، appLock دامنه و Serializable/auditریشه replay را محافظت می‌کند. Rawعدد نامعتبر/اعشاری/منفی برای بازبینی نگه‌داری می‌شود؛ هرگز truncate/zero فرضی نیست. ریال/تومان معلوم باlong وstring دقیق تبدیل می‌شوند؛ قیمت/شناسه/موجودی سایت تغییر نمی‌کند. خواندن، نگاشت فعال همانcompany/key و قیمت جاریSKU را کنارمنبع نشان می‌دهد؛ انبار/واحد/موجودیقابل‌فروش نیازمند تطبیق‌اند و canApply/canSyncLive همیشهfalseاند. DemoفقطDevelopment، حتیreplay؛productionدرPage/Detailپنهان است.

۱۸قواعد تازه و مجموع۸۰۱unit باصفرfail/skip، build۰warning/error موفق‌اند؛ این unit پیش از تولیدmigration و تغییر status503/API نهایی است، تطبیق۱۳DLL نهایی هنوز لازم است. نخستین build محدودsandbox بدونخروجی متوقف و لاگ تهی/تشخیص حفظ شد؛ build مجاز موفق بود. buildSQLنخست۳analyzer خودتست را رد کرد، بدونdisableاصلاح شد و build نهایی۰warning/error است. SQLهدفمند نخست۷از۸موفق؛ انتظار تست از نقشContentManager اشتباه بود (catalog.readمجاز، writeممنوع)، تست اصلاح و مجوز محصول تغییرنکرد. اجرای تازه۱۰SQL بادوMigrationTest درحالاجراست؛ هنوز پذیرفته اعلام نشود. wireخام اولیه حفظ و اجرای تازه جداست.

CSVپنل UTF8/۲۵۶KiB/۲۰۰ردیف و شش ستون ثابت دارد؛ opaqueID/صفرابتدایی حفظ، quote/ستون/تکرار/کنترل رد و مقدارخالی unknown می‌ماند. شش تست تازه و مجموع۱۸۶admin، typecheck موفق‌اند؛ build ایزوله در `tmp/holoo-stage-admin-build-path.json` درحالاجراست. UI ذخیرهٔ unknown باهمانid/body و GETمقایسهٔ تمامفیلدها بازیابی می‌کند؛ هنوز wire/browser متصل پذیرفته نیست. اصلی۳۸/پنل3173 همچنانartifactپذیرفتهٔ قبلی را سرو می‌کنند؛ migration۳۹ رویSaymanاعمال نشده است.

مرحلهٔ بعد: نتیجهٔ۱۰SQL، model check وSQLidempotent، fullSQLregression وunitنهایی/تطبیقartifact؛ سپسstrictwireوUIواقعیCSV/قطعپاسخ/موبایل باstaffMFAتولیدیخودQA وcleanup. دریافتزنده/تطبیقواحدوانبار/apply/Stockوvendor همچنانباقی‌اند؛ CSVstaging پایان اتصال هلو نیست.

## اقدام بعدی تا تکمیل کل پروژه

1. هلو staging/preview و نگاشت شرکت/انبار/واحد، بدون اتصال/نوشتن vendor یا اعمال خودکار Stock. ورودی سایمان صریح باشد؛ CSVnative هلو و معنایquantity/ریال/تومان حدس زده نشود. قرارداد/لایسنس vendor بیرونی مانع ساخت این بخش مستقل نیست.
2. منویCMS بازار و facet کامل/چندمنبع/تاریخچه/تطبیق؛ دست‌دوم با دستگاه/SKU مستقل، گزارش نسخه‌دار سلامت فنی/باتری/آسیب/نامعلوم و snapshot سفارش؛ نظرmoderated/verified-buyer و مقایسه۲–۴ با ویژگی تایپ‌دار/SQL و نمونه. نظر خارجی بدونمجوز ساخته نشود.
3. INV-01/چندانبار/ماندهٔ قبلی، ارسال/مرجوعی/گارانتی دستگاه، کارکنان/بازیابی و role/دوحساب UI، provider هویت/پرداخت/refund/چک/مدارک/ارسال، S3/ClamAV، CMS/SEO پیشرفته، PWA/Push/accessibility/CWV، support/review، CI/پایش، Docker/runtime و nativeLinux مستقل، backup/offsite/rotation/میزبان/حجم واقعی و تمام معیارهای PDF بازند. scaffold یا adapter خاموش معیار پایان نیست.

## مراجع قبلی؛ بدون تکرار بی‌دلیل

[Cart2](MARKET-CART2-SLICE.md)، [Quote4](MARKET-QUOTE4-SLICE.md)، [تخصیص](MARKET-ALLOCATION-CONVERSION.md)، [رضایت](MARKET-OFFER-CONSENT.md)، [SUPPLY](MARKET-SUPPLY-RECEIPTS.md)، [CSV](MARKET-CSV.md)، [بازار](MARKET-STOREFRONT.md)، [لحظه](MOMENTS.md)، [QR](MFA-QR.md)، [بکاپ](BACKUP-RESTORE.md) و آرشیوهای۳۴/۳۵/۳۸ شواهد دقیق را نگه می‌دارند. عددهای قدیمی دلیل تکرار همهٔ آزمون‌ها نیستند. نمونهٔ۴۳۱واحدLinux/amd64 روی Docker/MacARM، nativeLinux مستقل را نمی‌پذیرد. کل پروژه تا بستن همهٔ معیارهای باقی‌مانده کامل نیست.

**پیشرفت تازهٔ هلو۳۹:** SQLهدفمند اصلاح‌شده۱۰/۱۰ و رگرسیون کامل۴۷۴ باصفرfail/skip موفق‌اند؛ unitنهایی۸۰۱ نیز با API39/migrationساخته موفق است. Catalogmodelبدونتغییرجامانده وSQLidempotentفقطتولیدشد.۴پاسخخامSQL ازdecoderپنل بدونnormalizationگذشتند.۱۸۶admin/typecheck وbuildایزوله موفق؛ wrapperاولoutDirرا بهNPMدرست نرساند و بدونتغییرartifactاصلی اصلاح شد؛ لاگش محفوظاست. اصلاحfile-reader (جلوگیریازrace/ثبتپیشازخواندن) وCSSموبایل درbuildنهایی تازه هستند. UIHarness39 با۰warning/errorساخته؛ مرورگر/Captureهمانid/cleanup/انتشار۳۹ هنوزپذیرفتهنیستند.

**تفاوت هویت اصلی حین توسعه۳۹:** guardاولبرابری را ردکرد؛ `holoo-stage-main-drift-diagnostic.json` فقط AspNetUsers (count1ثابت/hashمتفاوت) و Sessions (۷۸→۸۲) را متفاوتیافت؛۱۰۹جدول دیگر دقیقاًباpost-smoke۳۸برابرند. لاگ مسیرهای اصلی refresh200/401 و دو password401 را نشان می‌دهد؛ از لاگبدونidentifierمنشأکلاینت/فیلدتغییرکرده تعییننمی‌شود. عامل هیچauthیافرمانتجاری روی اصلی نفرستاده؛ این تفاوت را بهQA یا مالک نسبت نمی‌دهیم و هیچaccount/session/reset/rollbackانجامنشد. `holoo-stage-main-preservation-scope.json` حفظهمه۱۱۱جدول/فیلدهایحساب را ادعا نمی‌کند؛ guardقبلی شل نشد. پیش ازانتشار۳۹ بایدwriterبسته، baselineتازه ازهمین وضعیتجاری و بکاپتازه ثبت شوند. اصلی همچنان۳۸است.
