# وضعیت و نقطهٔ ادامه

آخرین به‌روزرسانی: 2026-10-24. **کل پروژهٔ PDF و درخواست‌های تکمیلی ناتمام‌اند؛ فروش واقعی آماده نیست و goal باید فعال بماند.** این فایل وضعیت جاری است؛ [پیش از انتشار تأمین۲۸](archive/STATUS-before-sourcing28-release.md) و [پیش از CSV](archive/STATUS-before-market-csv-main23.md) تاریخچه‌اند.

## تصمیم‌ها و محدودیت‌های جاری

- D14 ظاهر و جریان را تأیید و API/پنل/SQL را مجاز کرده است؛ تأیید دوباره لازم نیست. Next16/React19، Vite و .NET10/EF10/SQL Server ثابت‌اند. مبلغ صحیح ریال، JSON رشته و JS BigInt است.
- D16 نام/مستندات درگاه، SMS و ایمیل موجود نیست؛ providerها غیرفعال و بدون موفقیت ساختگی‌اند. هزینه/مالیات، درصد/ماه/پیش‌پرداخت چک و متن واقعی گارانتی/مرجوعی تعیین نشده‌اند. اصلی صفر ردیف CheckoutOrderSettings دارد و سفارش موقت پیش‌فرض خاموش است.
- D17 **Redis چت Parseh خاموش بماند**؛ فایل شخصی/volume حذف نشود. برای QA هیچ credential/MFA مالک مصرف نشود. D20 پایان آزادسازی فضا را تأیید کرد؛ اکنون حدود۲۹GiB آزاد است.
- D21 سیاست نمونهٔ هزینه/رزرو فقط در QA خودش مجاز بود؛ به اصلی منتقل نشده است. D22 انتشار/بازگردانی CMS در QA تکمیل و پاک‌سازی شد؛ اجازهٔ معلقی وجود ندارد.
- D23–D28 بازار/درخواست تأمین، دست‌دوم، نظر/مقایسه و لحظهٔ سایمان لازم‌اند. مالک فعلاً پنل/CSV و نمونهٔ مشخص SQL را انتخاب کرد؛ API تأمین‌کننده نداریم. بازنشر نظرات دیجی‌کالا API/مجوز تأییدشده ندارد؛ متن نظر کپی یا ترب scrape نشود.
- D29–D30 هلو وجود دارد و دریافت کالا/مشخصات/موجودی لازم است؛ فرض قدیمی D06 اصلاح شده است. نسخه/ماژول اتصال معلوم نیست؛ دوباره همان سؤال پرسیده نشود. نگاشت اولیه موجود است؛ sync یا provider زنده فرض نشود.
- D31 QR محلی Authenticator، کلید دستی و مهلت MFA پیاده/منتشر شده‌اند؛ کلید موجود در تصویر مالک برای QA استفاده نشده است. [DECISIONS](DECISIONS.md)، [PRD](PRD.md) و skill پروژه مراجع‌اند.

## اجرای جاری پذیرفته‌شده

| بخش | وضعیت |
|---|---|
| SQL اصلی/سورس | **۲۸/۲۸ migration، هشت schema**؛۲۶ نمای عرضهٔ موجود Catalog،۲۷ CartSourcingLines و۲۸ درخواست/snapshot/event/receipt Market منتشر شدند. bootstrap تازه Inventory را پیش از Catalog migrate می‌کند |
| API5080 | artifact مستقل `tmp/api-runtime-sourcing28-3160f6a8cc1149a8aa5bdc6e46ed499f`؛ PID23395/session27001، ready200؛ ContentRoot اصلی و key ring صریح tmp/identity-keys |
| admin3173 | apps/admin/dist از tmp/sourcing-admin-final-dist؛ PID5843/session25935؛ صف/جزئیات/بررسی/عدم‌امکان/رسید تأمین، همراه نگاشت هلو و QR/مهلت MFA. index اتمیک عوض و۱۲۶ فایل قبلی برای تب‌های باز حفظ شدند |
| Next3000 | artifact مستقل `tmp/storefront-runtime-sourcing28-main-8f74180f635a44ec8fbe01e241b6ebe9`؛ PID23946/session73749؛ API mode واقعی، buildId `x-vAHRLfbZGjnKP0JbLFw` و distDir داخلی .next-qa؛۱۷ فایل static قبلی محفوظ |
| URLها | `/fa/market` و `/en/market`، بخش تأمین `/fa/cart#sourcing` و حساب `/fa/sourcing`؛ پنل «درخواست‌های تأمین». منوی بازار CMS هنوز اضافه نشده؛ پیوند کشف بازار از بخش تأمین سبد موجود است |
| storefront3100 | کانتینر قدیمی؛ مرجع سورس جاری نیست |
| بکاپ/بازگشت | pre28-release تازه از اصلی۲۵ پس از توقف writer API: COPY_ONLY/CHECKSUM/VERIFYONLY و کپی خصوصی key ring بدون parse؛ main-pre28-release-backup.json. pre28/pre25/pre24، API۲۵، Next بازار قبلی و tmp/admin-before-sourcing28-* نیز محفوظ‌اند؛ دستی/روی همین میزبان، نه production/offsite |
| QA | دقیقاً SaymanTest_Ui_32a4f8ab4ab042c299fe00c4d112029c با credential/keyهای تولیدشدهٔ خودش graceful پاک شد؛ همهٔ پورت‌های3105/3175/5181/5182 بسته، صفر SaymanTest باقی، تب‌های فعال QA بسته و viewport بازنشانی شد |
| Redis چت | exited؛ روشن نشده است |

Descriptorهای PID/path در tmp/{api,admin,storefront}-runtime-current.json مرجع‌اند. در ادامهٔ این اجرا PIDهای قبلی پایان یافته و SQL exited255 بود؛ همان SQL و artifactهای۲۵ بدون seed/migration برگشتند و سپس برش پذیرفتهٔ۲۸ منتشر شد. علت توقف صرفاً از این مشاهده تعیین نشده است. پیش از ادامه listener/cwd/health را دوباره بسنجید؛ timeout را دلیل restart ندانید.

**sourcing-main28-state.json** حفظ تعداد کاربران، hash همهٔ قیمت/compareAt/SKU، تعداد و جمع OnHand/Reserved و hash/نسخهٔ JSONهای CMS نسبت به بکاپ تازه را تأیید می‌کند. DBCC PHYSICAL_ONLY صفر خطا، صفر درخواست/رسید/انتخاب تأمین و صفر نگاشت هلو در اصلی،۳ نمونهٔ بازار قبلی، صفر تنظیم سفارش موقت و صفر QA باقی است؛ دادهٔ QA کپی نشده. **۲۰ smoke فقط‌خواندنی HTTP/BFF دو زبان، خصوصی401، سلامت API/پنل/Next و assets موفق‌اند**؛ sourcing-main28-public-smoke.json. این شواهد، restore کامل schema۲۸ یا native Linux/بار تولید نیستند.

## برش پذیرفته: انتخاب، ثبت و پیگیری درخواست تأمین

[MARKET-SOURCING](MARKET-SOURCING.md) و A32 قرارداد دقیق‌اند. مهمان/عضو در همان سبد Sales و cookie/نسخه/merge واحد، ردیف‌های مستقل تأمین دارند. ورود هر دو بخش خرید و تأمین را یک بار ادغام می‌کند؛ submit فقط تأمین را مصرف و کالای خرید را حفظ می‌کند. قیمت مرجع در جمع پرداخت نیست؛ هیچ SKU/Stock/Order/پرداخت/رزرو فرضی ساخته نمی‌شود. unknown/stale/unavailable منبع، امکان استعلام را نمی‌بندند؛ موجودشدن عرضهٔ عمومی واقعی، انتخاب/submit تازه را با now_in_store می‌بندد.

Market مالک درخواست، snapshot رابطه‌ای پنج نوع ویژگی با ترجمه/واحد/گزینه، event و receipt پایدار actor+operation+UUID/hash است. یادداشت مقید به حساب+درخواست حفاظت می‌شود؛ summary/receipt/log آن را ندارند و رویداد مشتری هویت کارکنان را افشا نمی‌کند. تغییر Catalog snapshot ثبت‌شده را عوض نمی‌کند. root تراکنش Serializable چندماژولی را هماهنگ و audit مدیریت را اتمیک ثبت می‌کند؛ receipt قبل از بررسی سبد مصرف‌شده replay می‌شود.۴۰۴ receipt پایان فرمان در حال اجرا را ثابت نمی‌کند.

مشتری FA/EN ثبت، فهرست/جزئیات/تاریخچه و لغو دارد؛ مدیر با sales.read می‌خواند و با sales.write بررسی یا عدم‌امکان با پیام عمومی می‌نویسد. journal فقط RAM و مقید به حساب است؛ unknown همان UUID/body را برای retry نگه می‌دارد و خطای۴xx بعدی ابهام نخست را پاک نمی‌کند. پس از receipt، وضعیت جاری از GET تازه می‌آید و نسخهٔ تاریخی receipt برای ویرایش اعمال نمی‌شود. منوی CMS/facet کامل بازار و پیشنهاد/قبول/تبدیل هنوز باقی‌اند؛ MARKET-02 کامل نیست.

پذیرش سورس۲۸:

- **۵۰۲/۵۰۲ واحد بک‌اند،۳۰/۳۰ SQL هدف و کل۱۹۳/۱۹۳ SQL واقعی،۷۲/۷۲ تست پنل و۱۵۸/۱۵۸ تست فروشگاه** با صفر fail/skip؛ typecheck/buildهای ایزوله موفق‌اند؛ بازسازی نهایی DLL و اجرای دوبارهٔ۵۰۲ واحد نیز موفق و hash API با artifact پذیرفته یکسان است (sourcing-final-units.trx). سه EF model check بدون تغییر جامانده و سه SQL idempotent تازه تولید شدند.
- ابتدا bootstrap Inventory/Catalog و سپس دو ایراد fixture (scale رشتهٔ decimal و ورود مکرر نقش مصنوعی) اصلاح شدند؛ limiter محصول تغییر نکرد. اجرای۳۰ و کل۱۹۳ پس از اصلاح موفق است. capture نخست از factهای مختلف بود؛ به یک چرخهٔ منسجم تبدیل و یک fact snapshot دوباره۱/۱ موفق شد. **۸ wire واقعی مشتری و۴ wire مدیریت** با پنج نوع، صفر/false، واحد FA/EN و مبلغ9007199254740993 دقیق پذیرفته‌اند.
- **مرورگر واقعی و SQL خود QA:** انتخاب مهمان→کالای خرید+تأمین→ورود/ادغام، عدم جمع قیمت مرجع، submit/پیگیری/لغو، حفظ کالای خرید پس از مصرف تأمین، سبد فقط تأمین، FA/EN/mobile RTL/LTR بدون overflow؛ صف/جزئیات/بررسی/عدم‌امکان/پیام عمومی مدیر با MFA خودش موفق‌اند. console هر دو صفر است.
- دو پاسخ موفقِ هر فرمان بررسی مدیر، ثبت مشتری و لغو مشتری عمداً پس از commit قطع شدند. همان UUID در retry/ناوبری محفوظ و رسید بازیابی شد؛ SQL فقط یک اثر ثبت کرد. سناریوی نخست یک ایراد UI یافت: رسید لغو وضعیت/فرم قدیمی را نگه می‌داشت. callback مقید به مالک/هدف اکنون detail و history تازه را می‌خواند؛ سناریوی تازه SR-3 بدون refresh دستی، Cancelled و صفر دکمهٔ تأیید/retry قدیمی را نشان داد. regression مربوطه سه تست دارد.
- شواهد: sourcing-ui-acceptance.json، sourcing-admin-sql-proof.json، sourcing-customer-sql-proof.json، sourcing-recovery-sql-proof.json، sourcing-*-response-loss.json و تصاویر sourcing-*.png. هر سه درخواست مصنوعی و کلید/حساب/دادهٔ QA حذف شدند؛ Orders/Reservations در QA صفر بودند. هیچ credential/MFA مالک مصرف نشد. native SQL روی MacARM/Rosetta، شاهد native Linux مستقل یا بار نیست.

ساخت نخست Next در sandbox در انتظار IPC ماند؛ PID/handle زنده بررسی و محدودیت مشابه مستند قبلی تشخیص داده شد. فقط wrapper خودش متوقف و build با مجوز IPC مناسب موفق شد؛ صرف گذشت زمان دلیل restart نبود. artifacts مستقل‌اند؛ build بعدی dist/.next اجرای اصلی را پیش از پذیرش بازنویسی نکند.

## پذیرش‌های پیشین محفوظ

- [MFA-QR](MFA-QR.md): QR محلی، کلید دستی، حداکثر۵دقیقه/exp، پیام401 مرحله، محافظ دوبارارسال/پاسخ حساب قبلی؛ اسکن Vision/TOTP حساب تولیدشده و انقضای واقعی پذیرفته، QA پاک. اصلاح پاسخ بازیابی معلق React مرور کد دارد، نه UI مستقل؛ مالک برای آزمون login نشده است.
- [HOLOO-INTEGRATION](HOLOO-INTEGRATION.md): نگاشت Catalog/API/پنل SKU با هویت خارجی پایدار، نسخه/مجوز/audit و وضعیت unconfigured پذیرفته؛۱۱ SQL هلو،۵ wire و UI ساخت/ویرایش/غیرفعال/فیلتر/mobile قبلاً موفق‌اند. **فقط نگاشت است؛ دریافت/staging/apply/sync زنده هنوز پیاده نشده‌اند.** نمونهٔ QA به اصلی کپی نشده است.
- [MARKET-CSV](MARKET-CSV.md) و [MARKET-STOREFRONT](MARKET-STOREFRONT.md): مدل بدون SKU، ویرایش/CSV، preview خواندنی، commit/receipt اتمیک، unknown/retry، بازار FA/EN و منبع/تازگی/demo پذیرفته بودند؛ تأمین۲۸ ادامهٔ آن‌هاست. مجوز API تأمین‌کننده و بازنشر نظر ثالث نداریم.
- [MOMENTS](MOMENTS.md): spotlight پویا با انتخاب/ترتیب/زمان و FA/EN، صفحه و بنر؛ visual دسکتاپ فارسی و موبایل FA/EN روی SQL اصلی پذیرفته. reduced-motion/CWV اندازه‌گیری‌شده باقی است.
- تاریخچهٔ پذیرفتهٔ محصول/سریال، حساب/نشانی/سفارش موقت، draft/CMS publish/rollback و restore/schema۲۱ در آرشیو محفوظ است.۴۳۱ واحد Linux/amd64 قبلی در Docker روی MacARM اجرا شده؛ این شاهد سورس۲۸/native Linux/runtime image تازه نیست.

## مسیر ادامه تا کل پروژه

در حال اجرا، 2026-10-24: قرارداد [MARKET-OFFER-CONSENT](MARKET-OFFER-CONSENT.md) و A33 ثبت شدند. reader کاتالوگ/lookup و hash مادی مستقل از قیمت عمومی، مدل رابطه‌ای Market، lifecycle/receipt، endpoint/policy/coordinator و قرارداد/BFF دو رابط به سورس اضافه شده‌اند. **سورس۲۹، اصلی/runtime پذیرفته همچنان۲۸؛ UI/journal پیشنهاد در حال تکمیل و مرورگر/انتشار باقی است.** migration تازه `20261023214832_SourcingOffers` فقط۹ جدول Market می‌افزاید. مدل EF بدون تغییر جامانده و SQL idempotent تولید شده؛ شناسهٔ پذیرش در مدل/snapshot/migration صریحاً NOT NULL و یکتا است.

پذیرش محدود بک‌اند: **۵۳۸/۵۳۸ واحد،۲۲/۲۲ SQL هدف و کل۲۱۵/۲۱۵ SQL واقعی** با صفر fail/skip؛ ساخت‌ها بدون warning/error و۱۱ پاسخ واقعی SQL با پنج نوع ویژگی، صفر/false، واحد FA۲۰۰۰نویسه و گزینه۲۰۱نویسه و قیمت بالاتر از Number دقیق از قرارداد رابط گذشتند. شواهد offer-consent-backend-acceptance.json و offer-consent-{units,targeted-sql,all-sql}.trx و offer-wire-contract.json هستند. lifecycle/حریم draft، مجوز مالی/مالکیت، snapshot ثابت، استقلال قیمت توافقی از قیمت عمومی، تغییر گارانتی/روش خرید، replay/target/payload، ویرایش draft/قیمت صفر واقعی، expiry بدون worker و حفظ پذیرش تاریخی، رقابت accept/cancel/withdraw، جایگزینی صریح، rollback رسید/audit و عدم اثر مالی پذیرفته‌اند. ترتیب snapshot قدیمی درخواست و flags schema1 حفظ است؛ public Offer version والد را می‌چرخاند، اما event والد فقط گذار واقعی Submitted→Reviewing دارد؛ Reviewing→Reviewing به decoder قدیمی تزریق نمی‌شود.

دو شکست نخست واحد از projection سازندهٔ record در EF رفع شدند. نخست SQL۱۷ از۱۹ موفق بود؛ دو assertion به‌اشتباه reference اشیای JSON را مقایسه می‌کردند و به مقایسهٔ مقدار اصلاح شدند؛ log/trx نخست محفوظ است. پس از اصلاح حدود metadata و اجباری‌کردن acceptance identity، target۱۹ و full۲۱۲ موفق شدند؛ سپس سه سناریوی مهم و محافظ تاریخچه اضافه و target۲۲/full۲۱۵ دوباره موفق شدند. pure frontend پیش از UI:۱۷۴ فروشگاه/۷۵ پنل و دو typecheck موفق؛ شمار نهایی پس از UI بازخوانی شود. این شواهد پذیرش کامل برش/مرورگر، اصلی۲۹، MARKET-02 یا PDF نیستند.

1. **برش در حال اجرا: پیشنهاد مدیر و پذیرش مشتری با SQL واقعی.** [MARKET-OFFERS](MARKET-OFFERS.md) طرح فنی مسیر کامل و MARKET-OFFER-CONSENT قرارداد نخست است؛ وضعیت پیاده‌سازی/آزمون از بند بالا خوانده شود. نخست Offer/consent نسخه‌دار، snapshot SKU واقعی/شرایط/قیمت، publish/withdraw/accept/decline/expiry و receipt/دو رابط، با canPay=false و بدون ساخت Stock/Order. DTO چهارحالتهٔ schema1 بی‌خبر شکسته نشود. SKU را مدیر Catalog با مقدار واقعی می‌سازد؛ پذیرش مشتری مجوز جعل موجودی نیست.
2. سپس پیگیری تأمین دستی/CSV و دریافت واقعی/واحد/سریال، تخصیص Inventory، قیمت توافقی Sales، CartOfferLines/Cart2/Quote4 و تبدیل idempotent به checkout عادی با رزرو واقعی لازم‌اند. پیشنهاد/پذیرش تنها، MARKET-02 را کامل نمی‌کند. policy هزینه/مالیات/پرداخت خاموش دور زده نشود. منوی CMS بازار، facet کامل/چندمنبع/تاریخچه/تطبیق نیز باقی‌اند.
3. هلو: دریافت/staging/پیش‌نمایش اختلاف و تطبیق شرکت/انبار/واحد بعدی‌اند؛ نسخه/ماژول و قرارداد vendor بیرونی‌اند، sync یا نوشتن در هلو فعال نشود. کار آمادهٔ داخلی منتظر این ابهام نمی‌ماند.
4. دست‌دوم با دستگاه/SKU و گزارش نسخه‌دار سلامت فنی/باتری/آسیب/نامعلوم و snapshot سفارش؛ نظر moderated/verified buyer و مقایسه۲–۴ با ویژگی تایپ‌دار/SQL واقعی و نمونه لازم‌اند. review/import غیرمجاز ساخته نشود.
5. کل PDF ادامه دارد: INV-01/چندانبار و ماندهٔ قبلی، Sales/ارسال/مرجوعی/گارانتی دستگاه، کارکنان/بازیابی و role/دو حساب UI، provider هویت/پرداخت/refund/چک/مدارک/ارسال، رسانهٔ S3/ClamAV، CMS/SEO پیشرفته، PWA/Push/accessibility/CWV، support/review، CI/پایش، Docker/native Linux و backup/restore تولید/offsite/schema تازه. adapter خاموش یا scaffold معیار پایان نیست. پذیرش‌های موفق بی‌دلیل تکرار نشوند؛ کار مستقل بعدی ادامه یابد.
