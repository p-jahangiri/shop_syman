# وضعیت و نقطهٔ ادامه

2026-10-27 — **اصلی محلی۶۷، مدیریت انتقال نشانی پذیرفته و منتشر است. کل PRD/PDF کامل نیست؛ D34 ادامه دارد.** [آرشیو پیش این برش](archive/STATUS-before-cms-redirects67-release.md)، PRD/PLAN/DECISIONS و اسناد قابلیت‌ها مرجع‌اند.

## اجرای اصلی۶۷

- API: http://127.0.0.1:5080؛ PID72799/session78067؛ `python3 tmp/cms-redirects67-release.py serve-api`.
- فروشگاه: http://127.0.0.1:3000؛ PID72792/session97844؛ `python3 tmp/cms-redirects67-release.py serve-storefront`.
- پنل: http://127.0.0.1:3173؛ PID72791/session84104؛ `node tmp/serve-cms-redirects67-main-admin.mjs`.

`tmp/{api,storefront,admin}-runtime-current.json` مرجع مسیر/hash/session/restart؛ مجموعهٔ ثابت `tmp/cms-redirects67-runtime-set.json` و Next build `9Lt_Y2TY8R7FN2OHUWs-C` است. flagهای پیش‌پذیرش runtime-set، وضعیت انتشار نهایی نیستند؛ `cms-redirects67-{source-acceptance,main-release}.json` مرجع‌اند. current۶۷ و rollbackسایت‌مپ۶۶/۶۶HTTP/initial66 و helperdependencies/keys/backups/evidence محفوظ؛ tmp کامل حذف نشود. D33 این برش cleanupساخت قدیمی انجام نداد.

SQL۶۷migration/۱۸۱جدول/۱۲schema: فقط Redirects/RedirectRevisions/RedirectCommands اضافه شدند؛ همه خالی‌اند. در توقف، هر۱۷۷جدول قبلی به‌جز CmsMigrationHistory، تمام۶۶migrationقبلی و schema/views دقیقاً حفظ شدند. پس۱۷۴۵HTTP نیز۱۸۰جدول غیرنشست/schema/views/history ثابت؛ bookkeepingنشست جدا و بدونreset بررسی شد. همهٔ۱۶۸۲HTTPقبلی و۹۸۰assetپنل/۳۲۹Next قبلی حفظ شدند.

Safety:stock101/0/0؛ Orders/Reservations/Settings/Policies/Sourcing/payments/Files/Support/Inbox وتمامcreditcase/terms/scope/quote/use/orderlink/schedule/cheque/ledger صفر. cms.Pages/PageRevisions/PageCommands و۳جدولRedirect خالی؛CMSsite3FAEN/auth1 محفوظ،support منتشر نشده. هیچ قانون/صفحه/منو/سیاست/seed/role/grant/provider یا indexواقعی فعال نشد. Files اصلیDisabled؛D16درگاه/SMS/email وD30هلو اطلاعات واقعی ندارند و خاموش‌اند؛سؤال تکراری نشود. D32Redisپارسه روشن و دست‌نخورده است.

بکاپ متوقف COPY_ONLY/CHECKSUM/VERIFYONLY:23191552بایت،SHA `6545f226eab40dc3fc380aa79aa0c8e13b095e406f234f378b4dcfadbe752d00`،۱key بدونparsing؛`main-pre-cms-redirects67-stopped-backup.json`. همان‌میزبان؛offsite/restore/nativeLinux پذیرفته نیست. بکاپ‌ها و پذیرش‌های قبلی محفوظ‌اند.

## انتقال نشانی — پذیرش۶۷

[CMS-REDIRECTS](CMS-REDIRECTS.md)/A74/A75/API مرجع‌اند. sourceثابت محصول/صفحه،targetعمومی داخلی همان‌زبان و301/302صریح؛draft ناقص مجاز وبدوننوعقابلpublishنیست. revision/commandimmutable وsame-head+sourceFK،rootIdentityCmsSerializable/audit/actorUUID/hash/version/receiptاتمیک؛گیتgraphقبلhead وcommandقبلآن. کلgraphunionنمونه/واقعی بدونcycle و≤۵hop؛ancestor ودوpublishمعکوسهم‌زمان پذیرفته‌اند. restoreانتشارتازه وdraftمحفوظ؛unpublishسابقهراپاکنمی‌کند. سقف۱۰هزارhead/revision وDownمحافظ تاریخچه.

privateMFA/cms.read+write/originstrict/no-store/noindex،body۱۶KiB/response۲۶۲KiB وپراکسیبدونCookie/Set-Cookie. resolveعمومی فقطsource/target/status/found/demo؛draft/actorخصوصی،demoخارجDevelopmentمخفی. NextقبلgateوجودCMSlookupanonymous/bounded/fatalUTF8/no-store؛LocationفقطtrustedSHOP_PUBLIC_URL،statusهرhopحفظ،بدونقانونعبورعادی،خطا/API/schema/origin→503. previewمحصولموجودAPIlookupنمی‌کند؛indexواقعیفعال‌نشد.

۱۰۶۶unit/کل۷۳۵SQL/۴۹۱front/۲۱۷admin/۱۸proxy موفق؛۲۱unit/۴SQL/۵front/۱proxy تازه. buildAPI/unit/SQL/harness/Nextisolated/admin وtypecheck/مدلnopending موفق؛۱۴DLL محصول بینAPI/unit/SQL/harness/frozen برابر. fullSQLheap۳GiB،۷دقیقه۳۸ثانیه،۰fail. اصلاحZodrefineبرایمسیرکوتاه،۴۹۱آزمونکاملدوبارهپاس؛لاگ‌هایقبلیمحفوظ‌اند.

۴۲SQLwire باdecoderتولیدی و۲۱NativeHTTP باredirectfixtureصریحsynthetic پذیرفته؛status/Locationtrusted/همان‌زبان/no-default/privatefields/UTF8/size/error/preview و۰credentialforward. NativelayoutmetadataفقطخواندنAPIمحلیاست،شاهدSQLredirectنیست؛شاهدSQLجداست. دوexpectationاولcacheexactومحصولpreviewناموجوداصلاحشدند؛کدمحصولبرایآن‌هاعوضنشد. **نقص قدیمی باز UX/SEO: محصول ناموجود درpreview پسstream صفحهٔخطا باHTTP200 می‌دهد؛عدمlookupاینبرشباiphone-16موجودآزمودهشد.** gate404واقعیصفحهCMSمحفوظ.

۷۵browserwire،۱۰POST/۱۰command/۱۰audit/۵revision،۱قطعپاسخبعدcommit→۱GETreceiptهمانUUID/۰POSTتکراری. RAMjournalباnavigation/globalguardبدونselectedقابلبازیابی،reviewخطابسته وreceiptقابلدسترسی؛تأییداولیهfalse،نوعاولیهخالی/previewمانعانتشار. دومبدأساختگیFApages/ENproduct؛draftمستقل،publish301/302،restoreنسخه۳باحفظdraftsupport،unpublish۴→404 و۵HTTPNativeواقعیSQLپذیرفته. از۱۸۱جدولQA،۶تغییرمجازسهCMSوUsers/Audit/Sessions؛۱۷۵دیگرexact/stock101/0/0/Policies0. موبایلadmin375=scroll/dialog330،create/save/publishفعال؛desktopEN1265=scroll/ltr،FAوENبهcatalogخودرفتند. logoutصریحتب‌اولفرمذخیره‌نشدهتب‌دومراپاککرد؛معنایابطالJWTسرورتغییرنکرد. سهconsoleخالی؛actualdevice/WCAG/perf/کلmobileپذیرفتهنیست.

QA_GUID `6bb446a2fe1c4140b874102b7aa63e72`،credential/key/tab121–123/viewport/portsجمعشدند؛هیچQAدیتابیسیباقینماند. شواهد artifacts/checks: `cms-redirects67-{source-acceptance,main-release,qa-cleanup}.json`،`cms-redirects-{sql-full-wire,browser-wire}/acceptance.json`،`cms-redirects-browser-{ui,final-sql,native-http}.json` و `cms-redirects67-native-http.json`،before/after/post-smoke/backupهم‌نام.

## ادامهٔ آماده — D34/D35

[CREDIT-SCHEDULES](CREDIT-SCHEDULES.md)/[CHEQUE-LEDGER](CHEQUE-LEDGER.md)/CREDIT-ORDERS وCMS-PAGES/CMS-PAGE-SITEMAP همچنان پذیرفته‌اند؛آرشیو۶۶جزئیاتگذشتهراپوششمی‌دهد. برنامه وگزارش داخلی وصول،bankVerified/Paidنقدی/مجوزارسال نیستند. Cash VerifiedCashPayment فقطverifyواقعیprovider؛mainChequeOrdersEnableddefaultfalseوSettingsندارد. cancel/expiryنهScopeUse رااحیا می‌کندنهسندراپاکمی‌کند.

**اولویت بعد CREDIT-02 طبق پاسخ مستقیم D35: «پس از دریافت پیش‌پرداخت و تأیید دستی همهٔ چک‌ها» اجازهٔ ارسال.** منتظر وصول همه نباشد؛مجوز مستقل مالی چکی/تعهدInventory باقراردادmoduleها،audit/idempotency وraceلغو/انقضا/نسخه/گردشسند لازم است. مدت رزروبرایسفارش‌هایجدیدتنظیمصریحمی‌خواهد؛deadlineتاریخیپنهانی تمدید وScopeUseمصرف‌شده احیا نشود. پاسخمالیهم‌اکنونداریم؛سؤال تکراری لازم نیست.

سپس blog/SEOتکمیلیCMS-03،وصولواقعی/یادآوری/گزارش/سازمانی،ارسالجزئی/دیجیتال/مرجوعی/بازپرداخت،search/alert/loyalty/EXT،mobile/WCAG/perf/CI/observability/nativeLinux/load/offsitebackup/restoreobject+keyring و۱۲معیارPDF بازند. انتهایبرشانتهایهدفنیست؛D14/D21/D32/D33/D34/D35برقرارند.

### برش فعال بعد۶۷

CREDIT-UPFRONT/A76 در ساخت: ثبت تأیید انسانی دریافت کامل پیش‌پرداخت، مبلغ از اصلquote/orderمحفوظ،صفرصریح،اصلاحگواهی/DP/audit/idempotency وsummaryبدونمرجعبرایمشتری؛ هنوزAPI/پذیرش/migrationجدیدیندارد. ایناولینبخشاجرایD35است؛تأییدهمهچک‌ها/مجوزنهاییارسال/سیاستصریحرزرودرادامه‌اند. CREDIT-UPFRONTمرجعطرحاست؛main۶۷حفظشود.

پیشرفت source68 (2026-10-28): قرارداد/مدل۳جدولUpfrontConfirmation/Event/Command،service/DP/API/root audit وUIپنل/summaryFAEN/customerBFF ساخته شدند؛اصلی۶۷دست‌نخورده است.۱۰unitهدفمند/۶SQLهدفمند و۱۰۷۶unitکامل/۴۹۶front/۲۱۷admin پاس‌اند؛مدلCreditnopending وbuild/typecheckموفق. DTOخصوصیِنسخهٔنهاییsourceorder/schedule/previousVersion/ackراهمبرایمقیدکردنرسیدبهبازبینینشانمی‌دهد؛wireهدفمنداولقبلاین‌افزودهتاریخیست،fullwireنهاییجدااست. fullSQLاولیکآزمونقدیمیChequeLedgerراشکست:latestCreditmigrationراLedgerفرضمی‌کرد. آزمونبهschemaLedgerپینوبعدبهlatestبرمی‌گردد؛assertDown/تاریخچهوسیاستDBضعیفنشد،migrationمنتشرشدهعوضنشد. runاولبا۷۴۰پاس/۱failتمامشد؛فقطSQLtestassemblyبرایآزمونپین‌شدهbuildمی‌شود،productDLLهاعوضنمی‌شوند؛fullSQLجدیدوwireجدانتیجهٔنهاییخواهندبودولاگ/TRXاولمحفوظاست. UIمرورگر/freeze/QAcleanup/backup/main68هنوزپذیرفتهنیست؛مجوزنهاییD35همچناندرادامهاست.
