# سفارش موقت چکی با مجوز یک‌بارمصرف — پذیرفتهٔ محلی۶۳

این بخش ادامهٔ CREDIT-01 و D34 است؛ ثبت سفارش موقت چکی در نسخهٔ محلی۶۳ پذیرفته و منتشر شده است. CREDIT-02/وصول/پیش‌پرداخت/سررسید قطعی هنوز پیاده‌سازی و پذیرش ندارند. سفارش، وصول چک، دریافت پیش‌پرداخت یا پرداخت موفق نیست. سرویس‌های واقعی D16/D30 و سیاست‌های اصلی همچنان خاموش می‌مانند.

## اختیار خرید و تراکنش

Credit مالک `PurchaseScopeUses` است: هر scope دقیقاً به یک سفارش و یک محاسبهٔ چکی با fingerprint مشخص متصل می‌شود. ثبت استفاده immutable است؛ لغو یا انقضای سفارش آن را به اعتبار قابل استفادهٔ دوباره تبدیل نمی‌کند. این مطابق مجوز «یک خرید» است، نه اعتبار گردان. مشتری برای خرید بعدی درخواست و تأیید تازه می‌خواهد. هیچ استفاده‌ای به سفارش اصلی داده نمی‌شود مگر همهٔ اعتبارسنجی‌ها و رزرو در همان تراکنش موفق شوند.

قرارداد SharedKernel از Credit می‌خواهد owner، همان پرونده/review/submission، نسخه‌های پرونده/scope، طرح جاری، انقضا، عدم ابطال و عدم مصرف را بررسی کند. مبلغ مبنای مصرف از محاسبهٔ سروری می‌آید و باید در سقف همان scope باشد. مبلغ/مدت مجوز تغییر نمی‌کند. `ScopeUsed` در تاریخچهٔ پرونده و state مشتق `Used` در UI دیده می‌شوند؛ Used مجاز به quote یا revoke تازه نیست. اصل grant/review و رسیدهای تاریخی تغییر نمی‌کنند.

root Identity/Sales/Catalog/Inventory/Payments/Credit با Serializable، ترتیب order-owner → Credit requirements/application gates → cart → agreements/allocations → reservation/Stock را رعایت می‌کند. هیچ مسیر Stock → قفل Credit تازه ایجاد نشود. quote۶۱ همچنان gateCredit → cart/Stock دارد؛ revoke فقط gateCredit می‌گیرد. در race checkout/revoke یکی پیش از دیگری تمام می‌شود؛ حالت سفارش موجود همراه scope باطل‌شده پذیرفته نیست. Claim پس از Hold هم فقط قفل Credit از قبل در اختیار همین تراکنش را دوباره می‌گیرد.

## محاسبه و سفارش

مشتری creditQuoteId، fingerprint و UUID فرمان، اطلاعات تماس/آدرس و تأیید صریح بازبینی همان محاسبه و مهلت سفارش موقت را می‌فرستد. هیچ مبلغ، قیمت، نرخ، scope جدید یا owner در ورودی وجود ندارد. محاسبهٔ متعلق به حساب با snapshot و protected receipt معتبر خوانده می‌شود؛ انقضای quote/scope و eligibility دوباره کنترل می‌شوند. مجموع و اقساط دقیقاً همان نسخه‌ای هستند که کاربر می‌پذیرد.

هستهٔ Quote3 برای سبد عادی و Quote5 برای accepted/mixed، با قیمت/روش/طرح/هزینه/نسخهٔ settings جاری دوباره بررسی می‌شوند. validation تازهٔ داخلی مخصوص Credit از consumer نقدی جدا است؛ قابلیت تاریخی `CanPlaceOrder` یا `TemporaryOrder.CanCreate` در quote قدیمی بازنویسی نمی‌شود. تنها blocker تأیید اعتبار با authority جاری حل می‌شود؛ هزینهٔ unknown، سقف ناکافی، روش/طرح نامعتبر یا تنظیم سفارش خاموش مانع‌اند. رزرو طبق settings صریح، با مهلت حداقل quote/scope/allocation و سقف سفارش باز همان مشتری است.

سفارش عادی snapshot قدیمی Quote3/Lines را با OriginalSnapshotVersion1 حفظ می‌کند؛ mixed همان Quote5/LinesV2 و OriginalSnapshotVersion2 است. گزارش دستگاه کارکرده از snapshot، قیمت توافقی از agreement و تخصیص همان واحدهاست. قرارداد تازهٔ Sales لینک سفارش به creditquote و scope و مبنای سقف/مبلغ و زمان تأیید را immutable نگه می‌دارد. گرفتن stock، مصرف سبد/توافق، ثبت order/claim/link/receipt/audit باید اتمیک باشند. جریان مالی فعلاً AwaitingPayment/settlement pending و CanPay=false است؛ وصول چک، پیش‌پرداخت، Paid و Fulfilled خودکار ایجاد نمی‌شوند.

تکرار فرمان همان owner+UUID+payload رسید ثابت اولیه را برمی‌گرداند؛ GET وضعیت جاری سفارش جداست. حتی پس از انقضا یا لغو، replay نباید scope را دوباره claim کند یا رزرو تازه بسازد. UUID مربوط به فرمان قدیمی نقدی با موفقیت قرارداد چکی اشتباه گرفته نمی‌شود. تاریخچه/رسید quote و سفارش در حساب بعد از reload از SQL خوانده می‌شود؛ صرفاً RAM نتیجهٔ موقت مبنای دسترسی نیست.

## پذیرش لازم

SQL واقعی: دو فرمان/دو quote برای یک scope، دو مشتری آخرین SKU، claim در برابر revoke/expiry/cancel، replay همزمان و payload متفاوت، audit/claim/link/stock failure rollback، main policy خاموش، unknown charges، limit/plan/price/settings/cart changes، ordinary/accepted-only/mixed/used snapshot، ownership/MFA و immutability/guarded downgrade. قرارداد/BFF/journal: ورودی بدون مبلغ، دقیق rial string، recovery بدون duplicate، logout و receipt بعد reload. مرورگر واقعی FA/EN/mobile شامل ایجاد سفارش موقت فقط در GUID QA و لغو/رزرو/claim و پنل. D21 settings60min/max2/shipping12345/exempt فقط QA؛ هیچ شخص واقعی ارزیابی و هیچ پرداخت واقعی انجام نمی‌شود. سپس QA cleanup، artifact ثابت، backup و ارتقای افزایشی با حفظ داده.

برای سبد عادی، قرارداد داخلی تازهٔ Inventory با deadline مطلق، رزرو legacy را دقیقاً تا حداقل مهلت quote/scope/settings نگه می‌دارد. قرارداد و hash قدیمی Lifetime دست‌نخورده‌اند؛ hash مسیر تازه domain جدا دارد. این مانع خطای چند میلی‌ثانیه‌ای ناشی از تبدیل deadline به duration پیش از انتظار قفل Stock می‌شود. نوع reservation عادی legacy و mixed خط‌محور V2 می‌ماند تا cancel/expiry/used snapshot از dispatcher قبلی درست عبور کنند.

فعال‌سازی سفارش موقت چکی، تنظیم مستقل `ChequeOrdersEnabled` با مقدار اولیهٔ false است. تنظیم نقدی قبلی و معنای snapshotهای آن حفظ می‌شوند. `ReservationMinutes` و سقف سفارش باز مشترک‌اند. ورودی قدیمی پنل که فیلد تازه را ندارد، مقدار جاری آن را تغییر نمی‌دهد؛ پنل تازه هر دو مجوز را صریح نشان می‌دهد. تست سفارش فقط در GUID QA، این گزینه را صریح روشن می‌کند. حذف migration تازه با سفارش/لینک/رویداد چکی یا گزینهٔ روشن، مجاز نیست.


## شواهد پذیرش۶۳ — 2026-10-27

۹۹۳unit،کل۷۰۷SQL،۴۵۳storefront،۲۱۴admin،۱۴proxy و۱۴DLL/API/unit/SQL/harness/frozenبرابر؛Credit/Salesmodelnopending. ۱۱SQLتازه،ordinary/accepted-only/mixed،دوفرمان/scope،دوخریدارآخرینSKU،raceorder/revoke،auditrollback،انقضا/replay،مالک/MFA/sales.write،SQLbudget/FK/Down،flagمستقلوlegacyinputراپوششدادند. ۴۳wireSQLباdecoderتولیدی وbindingعینquoteقدیمیپذیرفته.

مرورگراینبرشفقطسبدعادیبود؛۱POSTموفقپسcommitقطع→۱GETreceipt/۰POSTتکراری،۱quote/۱order/۱use/۱audit؛لغوstockراکاملاًآزادکردوUsedحفظشد. ۲۱wireدقیق،تاریخچهپسreloadوFA→EN،نسخهٔثبت‌شدهپسexpiry،پنلsales-onlyMFA،تنظیمجداگانهٔچک،FAENموبایل/desktopوپنلموبایلبدونoverflowو۰console،logoutدرEN→حذفخصوصیFAپذیرفته. یکGETتاریخی503وreselectهمانردیفپساصلاحبازیابی‌شد؛API/SQLبرایاینUIfixعوضنشد. ادعایaccepted/mixedbrowser،actualdevice،WCAGیاکلmobileنیست.

از۱۶۹جدولQA،۳۲تغییرمجاز و۱۳۷دیگرexact؛D21policyثابت/settingsدرپایانcashfalse/chequetrue/60min/max2،onHand101/reserved0/sourcing0،files0. QA_GUID/keys/credentials/4tabs/portsجمعشد. منبعشواهدcredit-order63-source-acceptance،credit-order-browser-{ui,final-sql}،wire/acceptanceوcredit-order63-qa-cleanupدرartifacts/checksاست.

main61→63با۲جدولخالی/۲migration/flagbitfalseوgrammarScopeUsedارتقایافت؛۱۶۵جدولقبلیجز۲historyexact،تمام۶۱history/schemaقبلیجزهمین۲تغییرصریح/viewمحفوظ. پس۱۴۸۵HTTP،۱۶۸جدولغیرنشستexact؛نشستزندهجدا/بدونreset. mainهیچSettings/policy/creditcase/order/claim/sample/role/providerنگرفت؛FilesDisabled. بکاپ۲۲٬۱۴۲٬۹۷۶بایتCOPY_ONLY/CHECKSUM/VERIFYONLY+۱key،همان‌میزبانوفاقدادعایoffsite/restoreجدید. RedisD32دست‌نخوردهروشن.

اولینfullSQL۷۰۲موفق/۱شکستتستقدیمیShipmentبودکهپسdowngradeمدلجاریراصدامی‌زد؛تستدرmigrationخودشpinوپیشHTTP/پسguardبهکلsourceارتقاداد. guardهایقدیمیCredit/CashLink/Quoteهمباکلhistoryrestoreسازگارشدند؛خودmigrationمنتشرشدهضعیفنشد. guardانتشاراولقالبdefaultرا((0))فرضکرد،SQLواقعی(CONVERT([bit],(0)))بود؛فقطguardباfalseواقعیتطبیقوafterدوبارهخواندهشد،migrationتکرارنشد.
