# وضعیت و نقطهٔ ادامه

آخرین به‌روزرسانی: 2026-10-25. **نگاشت انبار و پیش‌نمایش تطبیق هلو روی اصلی محلی۴۶ منتشر است؛ کل پروژه/PDF کامل نیست.** هدف D34 تمام بخش‌هاست و پایان برش پایان هدف نیست. مرجع `artifacts/checks/holoo-reconciliation46-main-release.json` و [HOLOO-RECONCILIATION](HOLOO-RECONCILIATION.md) است. وضعیت۴۵/CSV در [آرشیو](archive/STATUS-before-holoo-reconciliation46-release.md) و MARKET-SOURCE-CSV محفوظ است.

## کار جاری پس از۴۶

برش۴۷: فرماناعمالدستیفایل فیزیکی هلو درحالطراحی/شروع است؛ [HOLOO-STOCK-APPLY](HOLOO-STOCK-APPLY.md) طراحیقفل/نسخه/ledger/رسید/انتخابصریح/حفظتعهدات و آزمون‌های لازم راثبت می‌کند. قرارداد/readerproofکاتالوگ/یکپارچگیhashفایل،مدلheader+lineimmutable/قفل/rootcoordinator/APIو۵واحدتازه نوشتهشدند؛APIbuildبدونهشدارموفق است. migration۴۷دوجدول+Downguardنوشتهشد؛۸۶۶واحدو۱۹SQLهدفمنداولموفق‌اند. ۲۴SQLهدفمندشاملholdrace/rollbackردیفدوم/Stockغایب/Production/guardmigrationموفق‌اند. UI/journalفریز/accountboundary/انتخابصریح/رسیدتاریخیو۷تستتازهساختهشد؛۲۰۸پنل،typecheck/buildو۲proxyموفق‌اند. رسیدخراب503می‌دهد؛۸۶۶واحدنهایی/۲۰۸پنل/بیلدنهایی/دوproxyموفق‌اند. کل۵۶۷SQLواقعی و۶wireخاموابسته‌بهبدنهواقعیcommandباdecoderتولیدی موفق‌اند؛۳proxyشاملتاخیرواقعی۱۳ثانیهStockPOSTودرکنارآن503برایGETعادیپذیرفته‌اند. بستهimmutable۴۷با۱۳DLLهمسانunit/SQL/harnessساختهشد. مرورگر/cleanup/backup/انتشار۴۷بازند. زمانفرمفایلstep1ثانیهشدتامشاهدهپسازگردشجدیدبدونازدست‌رفتنثانیهممکنباشد. restart۴۶بهcopyدقیقtmp/admin-server-source46.mjsمقیدشدتاتغییرproxy۴۷رویآناثرنداشتهباشد؛holoo46-restart-proxy-preserved.jsonمرجع است. اصلی۴۶ طبقdescriptorsمحفوظ است؛ ادامه بده وبهتحویلتک‌برشمحدودنکن.

## اجرای اصلی محلی۴۶

- SQL:۴۶migration/۱۲۷جدول/۹schema. فقط inventory.AccountingWarehouseLinks وAccountingWarehouseCommands خالی اضافه شدند؛۱۲۴جدول قدیمی غیرhistoryخودInventory وتمامschema/viewها دقیقاً محفوظ‌اند. پس ازHTTPهر۱۲۷جدول برابربعدmigration است. Stock101/0/0؛ Order/Reservation/SourcingRequest/CheckoutSettings/ChargePolicy/UsedInspection/نگاشت وstagingهلو صفر. seed/سیاستمالی/دادهQA واردنشده است.
- API5080:`tmp/api-runtime-holoo-reconciliation46-fa542af70d8a46f5af809ba7e1153b18`؛PID78548/session26739؛restart:`python3 tmp/holoo-reconciliation46-release.py serve-api`؛ContentRoot/keyring قبلی و۱۳DLLهمسانunit/SQL/harness.
- Next3000:`tmp/storefront-runtime-holoo-reconciliation46-main-03cd074335444b9296fbbacf996f2f65`؛PID78599/session56186؛build=`5IuIFFIFlBqpFOCP-uTzn` همانbuild۴۴/۳۲۵test،کدتازه ادعا نمی‌شود. restart:`python3 tmp/holoo-reconciliation46-release.py serve-storefront`؛API5080/previewخاموش/۱۸۳assetقبلی محفوظ.
- پنل3173:`tmp/admin-runtime-holoo-reconciliation46-main-a1f6d2c183974822b7a13583a9f9e2fa`؛PID78678/session61295؛restart:`node tmp/serve-holoo-reconciliation46-main-admin.mjs`؛۴۲۵assetقبلی محفوظ. پنلدائمی http://127.0.0.1:3173/ است؛3175QAبسته وپاک شد.
- `tmp/{api,storefront,admin}-runtime-current.json` مرجع‌اند. بکاپتازه۱۷٬۹۴۴٬۵۷۶بایت COPY_ONLY/CHECKSUM/VERIFYONLY وکپیخصوصیکلیدها محفوظ؛main-pre46-release-backup.json مرجع است. Downباوجودنگاشت/رسید51000متوقفمی‌شود؛Down/restore/oldwriterعلیه۴۶خودکارنشود. نسخه۴۵وبکاپ/وابستگیrestartمحفوظ‌اند؛کلtmpپاکنشود.
- Redisپارسه طبقD32runningدست‌نخورده؛صفرSaymanTest/حذفخصوصیGUIDخودQA/پورت‌های3105/3175/5181/5182بسته وتبخودQA39بسته تأیید شدند. تبمالکدست‌نخورده.

## پذیرش نگاشت/تطبیق هلو

Inventoryماندهٔکلدارد؛نگاشتwhole_store_physicalفقطباتأییدصریحمدیربرایمنبعکل‌مانده ویکactiveglobalاست؛نبایدانبارجزئی/availableرابهphysicalتبدیلکرد. هویتBIN2ثابت/rowversion/rootSerializable/actor+UUID/hash/رسیدتاریخی/auditاتمیکواindexfilteredیکتایSQLاست. نگاشتهمگام‌سازیرافعال‌نمی‌کند. واحدهاازReceivingUnitMappingsباoriginدقیقholooوشرکت/انبار/واحد/SKUاستفاده‌می‌کنند؛decimal۸رقم/BigInteger/ratioصریح/نتیجهexact۰تا۱۰۰۰۰۰۰،غایبنامعلوموغیرقابلگردکردن است. پیش‌نمایشGETدرrootreadtransactionSerializableکاتالوگوانبار رامنسجممی‌خواند؛فقط۲۰۰mappingidentityدقیق/Stock/تعهدات/نسخه/آخرینگردش راگزارشمی‌دهد. Canonicalmoneystringمحفوظ؛canApplyManual/canSyncLive=false.

۸۶۱unit/کل۵۴۳SQLواقعی/۲۰۱پنل/typecheck/build و۵SQLwireخام موفق‌اند. ۱۹هدفمند شاملرقابت/actor/replay/هویت/قالب/decimal/zero/تعهدات/سریال/کارکرده/نسخه/Production/paging/rollbackرسیدوaudit/guardDownوهیستوریکUsedStockاند؛guardقدیمیبهmigrationخودشمقیدشد. VSTestدرsandboxاجازهپورتخودرانداشت؛خارجsandbox۸۶۱موفقشد،کدمحصولبرایعبورآزمونتغییرنکرد. serverproxyکدبدونتغییر،همان۲testقبلی۴۵باhashبرابراست؛فروشگاههمانbuild۴۴است.

مرورگر: دراولینartifact،ابهاممتنبررسیخامدرکنارنتیجهنگاشتپیداشدوفقطمتنپنلاصلاح/بیلدمجددشد؛API۱۳DLLثابت وSQL/واحدبی‌دلیل تکرارنشدند. artifactنهایی `tmp/holoo-reconciliation46-ui-fix-runtime-set.json` است؛قبلیimmutableنگه‌داشته‌شد. بیلدنهاییجدا:دوپاسخ200کاملقطع‌شده/byteیکسان/همانUUID/ناوبریواحدها→هلو/GETرسید/ویرایشهویتقفل‌شده/رسیدتاریخی؛تطبیق۱٫۵×۴=۶ دربرابرStock۳/اختلاف۳وunknownبدونصفر،ریال۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۳دقیق پذیرفته‌اند. کلQAدوwarehouse/۴command،یکunit/command،یکitemlink،یکbatch/۲row؛تمامStock/گردش/قیمت/Catalogواقعی/مالیثابت. ششrawbrowserresponseباdecoderپذیرفته،۴/۵/۶متعلقبهartifactنهایی‌اند؛مجموع۴پاسخقطع‌شدهشاملدوآزمایشقبل‌اصلاحاست. consoleخالی/actual1280/client=scroll1265؛**mobileپذیرفتهنیست**.

انتشارباbackupتازه/۴۵→۴۶/CHECKDB/۱۳۹۵HTTPشامل۶۹۹درخواستیکتایپوشاننده۳۷۶۷رکوردپیشین/همهassetsقدیم‌وجدید/401مسیرها وتمام۱۲۷جدولبعدHTTPثابت پذیرفتهشد. storefrontبدونتغییربیلد/کدبودومرورگراصلیبی‌دلیل‌تکرارنشد؛پذیرشپنلعینartifactدرQAاست. `holoo-reconciliation-browser-{acceptance,observations,sql-before,sql-after,ui-fix-fault-acceptance,wire-acceptance}.json` و`holoo-reconciliation46-main-{before,after,post-smoke,public-smoke,release}.json` و تصاویرمرجع‌اند.

## کار بعدی برای D34 — ادامه بده

۱. **فرماناعمالدستیفایلهلو** باانتخابصریحرسی‌ها،fingerprint/نسخهٔتماموابستگی‌ها،حفظرزرو/سهم/سریال/کارکرده،منعفایلقدیمی/گردشپسازمشاهده،roottransaction/audit/رسیدوledger؛قیمت/محتوابدونانتخاببازنویسینشود. canApplyدر۴۶false است وwriterجدیدهنوزساخته‌نشده. نسخه/ماژولD30نامعلوم،دوبارهپرسیده‌نشود،vendorendpointجعل‌نشود،liveخاموش.
۲. پیوندبازاردرCMSمنویفعلیوجودندارد؛باworkflowمدیریتمحتواوبازبینیحفظداده تکمیل‌شود. سپس ارسال/تحویل/مالکیتدستگاه/مرجوعی،پروندهچک/مدارک،CMSپیشرفته/support/notification وکلPDF طبقPLAN.
۳. mobile/accessibility/SEO/performance/CI/nativeLinux/load/backup ومعیار۱۲گانهبازند؛scaffoldکاملنیست. D14انتشارمحلی/API/adminمجاز؛D16providerنداریم؛D21سیاستنمونهفقطQA؛D32Redisروشن؛D33۱٫۶۷GiBپاک‌سازی؛D34کلپروژه. سیاستواقعیهزینه/مالیات/گارانتی/مرجوعی/درصدچکنامعلوم. منبعخارجی/نظرDigiKala/ترب/هلوواقعیمجوزوقراردادمی‌خواهد؛scrape/جعلنباشد.
