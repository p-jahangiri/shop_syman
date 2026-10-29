# کالای کارکرده؛ انتشار محلی۴۲ با پذیرش دسکتاپ

اصلی/سورس۴۲ اکنون برش دست‌دوم را همراه نظرات/مقایسه منتشر کرده‌اند؛ پذیرش mobile و کل پروژه همچنان باز است. درخواست D25 کالای کارکرده با مشخصات همان دستگاه را می‌خواهد. دسته/ویژگی‌های افزوده همچنان از metadata پویا هستند؛ گزارش هسته‌ای سلامت، معنای معلوم/نامعلوم را ثابت و قابل پیگیری نگه می‌دارد.

هر دستگاه یک SKU فیزیکی مستقل و همان قیمت/رنگ/حافظه/گارانتی/روش‌های خرید تنوع را دارد. گزارش immutable شامل ارزیابی فنی unknown/passed/needsRepair، باتری unknown/notApplicable/measured با درصد صحیح۰–۱۰۰ فقط در measured، صفحه/بدنه unknown/intact/worn/damaged، تعمیر unknown/noKnownRepair/repaired، یادداشت عمومی FA/EN و زمان بازرسی UTC است. نامشخص به سالم تبدیل نمی‌شود و گزارش، تضمین یا سیاست گارانتی نمی‌سازد. اطلاعات خصوصی IMEI/سریال در public نیست؛ رهگیری موجود Inventory جدا حفظ می‌شود.

Catalog مالک گزارش‌ها/receipt و currentInspectionId تنوع است. هر تغییر current، version تنوع و والد را می‌چرخاند. Inventory مالک IsSingleUnit/SQL CHECK حداکثر۱مانده است؛ root در Serializable/audit با مجوز هم catalog.write و هم inventory.write، فقط با OnHand≤1 و Reserved/SourcingReserved=0 آن را مقید می‌کند. مقدار مانده،movement یا رزرو تغییر نمی‌کند؛ موجودی چندتایی باید SKU مستقل بگیرد. همین CHECK تمام مسیرهای دریافت/اصلاح موجودی را پوشش می‌دهد. SKU دارای سابقهٔ کارکرده به کالای دیجیتال/نو برگردانده نمی‌شود؛ بایگانی/غیرفعال‌سازی معمول کاتالوگ موجود است.

فرمان با actor/UUID/hash و applicationlock، replay همان receipt و تغییر بدنه۴۰۹ دارد؛ هرrevision یکInspectionId تازه می‌خواهد. کلیهٔ گزارش‌ها حفظ می‌شوند؛ Down باید پیش ازDDL وجود تاریخچه یا ظرفیت تک‌دستگاه را رد کند. API/پنل/SQLQA و guard با شواهد زیر پذیرفته‌اند.

گزارش عمومی دقیق همان SKU در detail/compare/cart نمایش می‌یابد. Checkout3/4/5 گزارش را همراه line در ResponseJson موجود خودش کپی می‌کند؛ priceVersion تنوع با گزارش عوض می‌شود و quote قدیمی معتبر نمی‌ماند. Order1/2 همان ResponseJson تأییدشده را در QuoteSnapshotJson تاریخی خود نگه می‌دارند. خواندن سفارش فقط از این snapshot غیرقابل ویرایش است؛ هیچ دادهٔ جاری Catalog جای آن نمی‌آید. parser محدود۶۴خط/۵۱۲KiB و key/variant/product را هم‌بسته می‌کند؛ شکل خراب با503 پاسخ می‌گیرد. Order/Quoteهای قدیمی و کالاهای نو فیلد جدید ندارند؛ nullable تازه برای آن‌ها serialized نمی‌شود. اصل attributeهای فیلترپذیر سلامت در مدل رابطه‌ای Catalog است؛ JSON این قسمت فقط snapshot تاریخی غیرقابل‌فیلترِ سفارش موجود است.

در این برش مسیر خرید عادی پشتیبانی می‌شود. SKU دارای currentInspectionId به پیشنهاد تأمین بازار وارد نمی‌شود تا snapshot رضایت/مادهٔ توافقیِ ویژهٔ دستگاه جدا توسعه یابد؛ رضایت نسخهٔ قدیمی به کالای کارکرده تبدیل نمی‌شود. منبع API هلو/بازار جعل نمی‌شود، هزینه/مالیات/قیمت/شرایط واقعی یا provider فعال نمی‌شوند. دادهٔ نمونه و خرید موقت فقط QA خودGUID است؛ پذیرش محلی دسکتاپ/SQL/حفظ اصلی انجام شد؛ این امر فعال‌بودن provider یا افتتاح تولید نیست.


## شاهد و مرز پذیرش

`artifacts/checks/used42-main-release.json` مرجع جاری است:۸۲۶واحد/۴۹۳SQLواقعی/۳۱۳فروشگاه/۱۸۹پنل،۱۳بدنهٔخامSQLباdecoderتولید،۱۳DLLبرابر API/واحد/SQL/harness،typecheck/build ومدل‌هابدونpendingchange. mixedQuote5/Order2 نیز SKUکارکردهٔ مستقلکنارپیشنهادنو را snapshotمی‌کند؛ پس‌ازلغو/ویرایشcurrent،Order1،projection1-via2 وmixedOrder2 factsقدیمی راحفظکردند. PolicyهایجداCatalogManager/InventoryManager PUTرا۴۰۳کردند؛DBmeasured+null وStock>1 رد شدند؛auditfailure همهٔCatalog/Stock/receipt راrollbackکرد.

GUIDمرورگرfb3f… فقط دوSKUنمونه باStock1 داشت؛reportپیشseedنبود. password/MFAمدیرتولیدی،فهرست/فرم،دو200قطع‌شده/سهبدنهٔدقیقاًیکسان برایهمانcommand،unknownدستگاه دوم،reinspectionاول به۱۰۰٪،نمایشFAEN/detail/cart/quote/comparisonوSKUنو بدونreport پذیرفته‌اند. پایان۳inspection/۳command/۲flag ومانده/جدول‌های نامرتبطثابت؛QA/key/credential حذف،تب‌های23/24 بسته،portsآزاد. `used-items-browser-acceptance.json` و`used-browser-wire/acceptance.json` مرجع‌اند. تصاویرviewport1280 پذیرفته‌اند؛fullPageRTLابزارجابه‌جا/cropشدوقبولنیست. mobile هنوزبازاست؛ browserایجادorderدراینGUIDادعانشده،تاریخچه باSQLHTTPواقعی آزمودهشد.

انتشار۴۲: بکاپ خصوصیCOPY_ONLY/CHECKSUM/VERIFYONLY،۲migrationافزایشی/۲جدولخالی/۲ستونdefault،برابریتمامفیلدهایقدیمی وschema/historyباافزودهٔمجاز،CHECKDB و۱۳۳۷GET(شامل۸۱۴قبلی) مثبت.۱۴۷staticNext و۲۹۴adminassetقبلی حفظ شدند. هیچseedگزارش،تغییرمانده/تنظیممالی/providerدر اصلی انجام نشد؛ دادهٔQA سلامت واقعی کالاهایفروشگاه نیست. جزئیات شکست‌های نخست واصلاح فرمتPascalCase/عدد رشته‌ای،ترجمهٔSQLrecordprojection وscopingتست migrationقدیمی درSTATUSثبت‌اند.
