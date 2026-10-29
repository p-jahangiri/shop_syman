# وضعیت و نقطهٔ ادامه

آخرین به‌روزرسانی: 2026-10-23. **کل پروژهٔ PDF و درخواست‌های تازه ناتمام است؛ فروش واقعی آماده نیست.** [وضعیت پیش از این برش](archive/STATUS-before-moments-main21.md) شواهد و تاریخچهٔ قبلی را حفظ می‌کند. عبارات «منتظر اجازهٔ CMS»، main۱۷ و QA زنده در آن، تاریخی‌اند.

## تصمیم‌ها و محدودیت‌ها

- D14 تأیید UI و اجازهٔ API/پنل/SQL برقرار است؛ تأیید دوباره لازم نیست. Next16/React19، Vite و .NET10/EF10/SQL Server ثابت‌اند؛ مبالغ صحیح ریال و JSON رشته‌اند.
- D16 نام/مستندات درگاه، SMS و ایمیل موجود نیست؛ providerها غیرفعال و بدون موفقیت ساختگی‌اند. سیاست واقعی هزینه/مالیات، درصد/ماه/پیش‌پرداخت چک و گارانتی/مرجوعی تعیین نشده‌اند.
- D17 Redis چت Parseh خاموش بماند؛ هیچ فایل شخصی یا volume حذف نشود. credential/MFA مالک مصرف نشود.
- D20 پایان آزادسازی اعلام و توقف D19 رفع شد؛ حدود۳۳GiB آزاد. SQL2022 روی MacARM/Rosetta است؛ این میزبان native Linux مستقل نیست.
- D21 فقط مقادیر نمونهٔ هزینه/رزرو در QA خود آزمون را مجاز کرد؛ اصلی تغییر نکرد.
- **D22 تکمیل شد**: انتشار مصنوعی English و بازگردانی همان QA با۱۴ بررسی API/SQL/Next HTTP موفق؛ اجازهٔ معلق وجود ندارد. مبدأ و credential/key آن پس از پایان پاک شدند.
- D23–D28: کاتالوگ گوشی بازار/درخواست تأمین، دست‌دوم، نظرات/مقایسه و پیشنهادهای منتخب لازم‌اند؛ **منبع API نداریم، پنل/CSV و دادهٔ نمونهٔ مشخص در SQL واقعی انتخاب شد**. [COMMERCE-EXTENSIONS](COMMERCE-EXTENSIONS.md) مرجع جزئیات/منابع رسمی است.

## اجرای جاری

| بخش | وضعیت |
|---|---|
| SQL اصلی/سورس | **۲۳/۲۳، هشت schema**؛۲۲ view مدل Catalog و۲۳ Market.Listings بعد از ارتقای پیشین۱۸–۲۱ اعمال شدند |
| بکاپ پیش از ارتقا | main-pre21 و main-pre23 با COPY_ONLY/CHECKSUM/VERIFYONLY و کپی خصوصی key ring در tmp/local-backups محفوظ‌اند؛ backup-local.py helper دستی همین محیط است، تولید/offsite نیست |
| API5080 | artifact مستقل بازار۲۳/SQL۲۳، PID50863/session88546؛ ready200. مسیر در tmp/api-runtime-current.json؛ build سورس این پوشهٔ اجرا را بازنویسی نمی‌کند |
| admin3173 | build عادی جدید/server.mjs، PID31910/session58091، HTTP200؛ API5080 جدید/SQL۲۳ و نه fixture |
| Next3000 | build عادی تازه موفق، API mode/SQL۲۳، PID34408/session77742؛ readiness و۲۸ smoke HTTP موفق |
| storefront3100 | کانتینر قدیمی؛ مرجع سورس جاری نیست |
| QA پیشین | cleanup کامل: صفر SaymanTest، مبدأ/پوشهٔ خصوصی حذف و پورت‌های5181/3175/3105 بسته؛ customer-operations-final-cleanup.json |
| Redis چت | exited؛ روشن نشده است |

ارتقا بدون seed کامل/تغییر نقش/ورود مالک انجام شد. تعداد کاربران، نسخه و hash هر دو JSON CMS و ماندهٔ OnHand/Reserved با بکاپ برابر بودند؛ DBCC PHYSICAL_ONLY صفر خطا. migration سریال برای ماندهٔ قبلی none و صفر دستگاه می‌گذارد؛ نگاشت موجودی قبلی هنوز مستقل لازم است. تنظیم سفارش موقت اصلی ردیفی ندارد و پیش‌فرض خاموش است. main-pre21-upgrade.json شاهد است.

## برش جاری: کاتالوگ بازار در API و SQL

[MARKET-CATALOG](MARKET-CATALOG.md) مرجع دقیق است. مدل همان Product/ویژگی تایپ‌دار/ترجمه/تصویر Catalog است؛ مدل Draft فروشگاهی می‌تواند بدون SKU باشد، ولی انتشار فروشگاهی Published هنوز پیشنهاد فعال لازم دارد. Market.Listings انتشار بازار را صریح و مستقل نگه می‌دارد؛ reference صرف یا view داخلی، انتشار نیست. Hidden سراسری/دیجیتال/مدل ناقص/دسته و برند غیرفعال از بازار عمومی حذف می‌شوند. هیچ قیمت/SKU/روش خرید خصوصی در DTO مدل بازار نیست. Market فقط قرارداد IMarketModelCatalog و view read-only متعلق به Catalog را مصرف می‌کند.

فهرست عمومی۲۴تایی/جست‌وجو/دو زبان و فهرست مدیریت۵۰/seek و source/زمان/قیمت مرجع/IsDemo، rowversion، نوشتن اتمیک Catalog+Market+audit و محافظ Production پیاده‌اند. زمان منقضی stale و مبلغ مرجع string ریال/غیرقابل پرداخت است. ویرایش مدل، SKU/قیمت و روش‌های فروشگاهی موجود را حفظ می‌کند. **رابط بازار، فرم پنل، CSV، سبد درخواست و پیشنهاد/قبول هنوز پیاده نشده‌اند**؛ API-only را اتمام MARKET-02 اعلام نکنید.

۴۵۱ واحد و **۱۴۲/۱۴۲ SQL واقعی، صفر شکست/skip** موفق‌اند؛۱۱ مورد بازار شامل MFA/نقش، بدون SKU، استقلال انتشار، نسخه، rollback/audit، پول، جست‌وجو،۵۰/۳ صفحه و حفظ قیمت است. یک SQL مستقل بعدی نیز نمونهٔ Development و بی‌تکراری/عدم ساخت هویت/Stock را پذیرفت (۱۴۳ مورد یکتای موفق، مجموعهٔ۱۴۳تایی یک‌جا پس از آن اجرا نشده). اجرای نخست۶/۷ و خطای left join keyless/null اصلاح شد؛ انتظار نقش ContentManager با catalog.read موجود هماهنگ شد و policy ضعیف نشد. log/TRX شکست جدا حفظ است. Contextهای Catalog/Market بدون تغییر جامانده و SQL idempotent تولید شدند؛ lockها به‌روز و restore --locked-mode موفق است.

پس از بکاپ خصوصی اصلی۲۱، migrationهای۲۲/۲۳ اعمال و سه مدل نمونهٔ روشن A/B/C (unknown/available/stale) در SQL با --seed-market-dev اضافه شدند. هیچ حساب/SKU/Stock/سفارش یا CMS تغییر نکرد؛ تکرار Created=0/Preserved=3 و همان نسخه‌هاست. هش تمام قیمت‌های تنوع و دو JSON/نسخهٔ CMS، تعداد کاربران و OnHand/Reserved با پیش از ارتقا برابرند. تنظیم سفارش موقت صفر ردیف/پیش‌فرض خاموش، DBCC فیزیکی صفر خطا، صفر SQL QA و Redis چت exited پذیرفته شدند؛ market-main-state.json مرجع است.۲۸ smoke خانه/لحظه/PWA/خصوصی روی API۲۳ دوباره موفق‌اند؛ چهار بررسی اضافی no-store/عدم صدور کوکی و401 بی‌هویت مدیریت نیز موفق‌اند؛ moments-main-next-http.json به بازخوانی۲۳ به‌روز و market-core-moments-http.json کپی شد.

API جدید از tmp/api-runtime-market23-* (Debug/framework-dependent محلی) اجرا می‌شود. backend-local.py --runtime-dir <مسیر همین artifact> فقط serve می‌کند و ContentRoot/key ring اصلی را صریح نگه می‌دارد؛ عملیات --migrate/--seed-* بدون این گزینه از سورس ساخته‌شده اجرا می‌شوند. این snapshot محلی، انتشار image نهایی Linux نیست. run جاری را قبل از کار دوباره با listener/cwd/health بسنجید. فایل/کلید MFA مالک خوانده یا مصرف نشده است.

## برش پیشین: لحظهٔ سایمان

نوع تأییدشدهٔ spotlight به CMS، parser/نوع TypeScript و پنل افزوده شد؛ انتخاب/ترتیب دستی حداکثر۲۴، متن و زمان و FA/EN از CMS است. فعال‌بودن به عنوان و انتخاب صریح کالا نیاز دارد. خانهٔ بنری و /fa/moments و /en/moments به lookup عمومی SQL متصل‌اند؛ غایب/پنهان جایگزین خودکار ندارد. تخفیف/قیمت/روش خرید و موجودی همان SKU است؛ عضویت هیچ شرایط مالی نمی‌سازد. حرکت تزئینی کوتاه و reduced-motion، rail موبایل و صفحهٔ کامل پیاده‌اند؛ **visual مرورگر تازه هنوز پذیرفته نشده است**.

دادهٔ نمونهٔ واضح FA/EN به fixture/Seed اضافه شد. فرمان CLI صریح --seed-moments-dev فقط Development، بدون جایگزینی draft منتشرنشده/مجموعهٔ موجود، دو زبان را در transaction CMS با نسخهٔ جدید اضافه می‌کند. طبق D27، در SQL محلی همین نمونه و لینک /moments افزوده شد؛ main CMS اکنون revision2 هر زبان دارد. این انتشار دادهٔ نمونهٔ قابلیت درخواستی است؛ آزمون قبلی D22 فقط QA بود و مجوز آن به اصلی تعمیم داده نشد. قیمت/موجودی/سیاست مالی/هویت دست‌نخورده‌اند. Production substitute فعال نشده است.

۱۲۰ تست فروشگاه،۴۳۵ بک‌اند، typecheck و build پنل موفق‌اند. سه SQL مرتبط Commerce پس از اصلاح انتظار ترتیب تنوع، بدون شکست/skip موفق شدند؛ اجرای اول۲موفق/۱شکست در moments-sql-first.log محفوظ است: انتظار [0] به‌جای SKU مشخص خطای آزمون بود، کد دامنه ضعیف نشد. baseline قبلی۱۲۹ SQL موفق بود؛ **مجموعهٔ۱۳۱تایی تازه کامل دوباره اجرا نشده است**. build Next نخست در sandbox بدون پیشرفت ماند و فقط فرایندهای متعلق به build پس از بررسی cwd متوقف شدند؛ اجرای مجدد با IPC مجاز کامل موفق شد (compile۱٫۲ثانیه).۱۴ smoke عمومی و۱۴ HTTP home/moments/private روی API/SQL اصلی پذیرفته شدند. آزمون SQL مستقل چهارم Production guard/حفظ draft/rollback دو زبان/بی‌تکراری نمونه موفق است؛ اجرای تکراری اصلی هر دو revision2 را ثابت نگه داشت. moments-main-final-state.json، صفر دیتابیس SQL تست، حفظ کاربران/مانده/سیاست سفارش خاموش و سه listener متعلق به workspace را تأیید می‌کند.

## پذیرش‌های محفوظ و حدود

- SQL قبلی۱۲۹/۱۲۹؛ واحد Linux/amd64۴۳۱/۴۳۱ در Docker روی MacARM/emulation، target=test/cacheonly؛ runtime/native Linux مستقل را نمی‌پذیرد.
- پنل۵۲ تست شامل۴۴ contract و۸ نشست/clock؛ wire۳ مصنوعی، UI نمونه۱۸، SQL مرورگر۱۷ محصول/سریال با MFA تولیدشدهٔ خود QA؛ cleanup کامل.
- مشتری۴۷ بررسی مرورگر واقعی: دفتر نشانی FA/EN/default/ارقام فارسی، کپی صریح، note/رضایت، سفارش فیزیکی۶۸۹۰۱۲۳۴۵ریال و دیجیتال۲۹۵۰۰۰۰۰ریال، snapshot مستقل، لغو مشتری/مدیر و آزادسازی موجودی؛ console صفر. پرداخت/ارسال واقعی، mobile مشتری، قطع پاسخ/replay و worker این run پذیرفته نیستند.
- CMS۷ مرورگر draft/picker/ترتیب/SQL؛ سپس D22 با۱۴ API/HTTP: publish revision2، API+Next marker، استقلال FA، rollback revision3 به hash دقیق revision1، فقط دو audit موفق، logout204. دو restoreRevisionId عدد JSON400 شدند؛ پس از read تازه رشتهٔ ده‌دهی ارسال شد. cms-approved-publication.json شاهد است.
- restore QA۲۳ بررسی SQL/HTTP/نشانی رمز‌شده/سفارش/MFA/CMS و۵ guard موفق؛ کپی و مبدأ هر دو در مراحل خود پاک شدند. ابزار فقط run باقی‌مانده پس از interruption است؛ SIGTERM عادی مبدأ را حذف می‌کند. [BACKUP-RESTORE](BACKUP-RESTORE.md).
- اصلاح SessionAccess پیش از درخواست و sidebar scroll پذیرفته‌اند؛ وقفهٔ واقعی۲۱دقیقه‌ای پس از اصلاح تکرار نشد. CSS فاصله‌های picker موبایل build شد، visual پس از اصلاح باز است.
- فایل SKILL.md مرورگر در مسیر اعلام‌شده موجود نیست؛ ابزار/پذیرش تصویری از مسیر مستندننشده دور زده نشده است. تصاویر قبلی customer-operations-* و operations-* شواهد همان اجرای قبل‌اند.

## مسیر ادامه

1. برش لحظهٔ سایمان در API/HTTP/SQL بسته شد؛ visual/mobile تازه باقی است و ابزار/skill مرورگر موجود نیست. app جاری http://127.0.0.1:3000، پنل http://127.0.0.1:3173 است. در آغاز ادامه listener/cwd/health بررسی شوند؛۳۱۰۰ قدیمی مرجع معرفی نشود. [MOMENTS](MOMENTS.md) پذیرش/حدود را دارد.
2. **برش آمادهٔ بعد: CSV و رابط بازار/پنل** روی API/SQL۲۳ موجود؛ preview خطا/تطبیق و commit صریح و idempotency پایدار/rowversion، سپس سبد یکپارچهٔ درخواست تأمین و پیشنهاد مدیر/قبول مشتری/تبدیل به SKU. داده‌های نمونهٔ سه مدل حفظ شوند؛ schema/رابط/پیگیری کامل شود. Market backend دیگر scaffold نیست؛ Reviews هنوز فقط scaffold است. فیلتر ویژگی پویا/خارج‌کردن خودکار مدلِ واردشده به موجودی/چند منبع نیز باقی‌اند.
3. دست‌دوم: پیشنهاد همان مدل با دستگاه/SKU مستقل، فنی/باتری/آسیب/نامعلوم و نسخهٔ شرایط در quote/order؛ نمونه‌های مشخص SQL. نظر داخلی moderated و verified buyer فقط قابل اثبات؛ مقایسهٔ۲–۴ با ویژگی تایپ‌دار و SQL واقعی. بازنشر نظر دیجی‌کالا فاقد API/مجوز تأییدشده است؛ D04 حفظ شود.
4. QA کارکنان/بازیابی، finance/دو writer/نقش محدود، mobile/visual/قطع پاسخ و query plan/load مستقل لازم‌اند. از تکرار بی‌دلیل پذیرش‌های موفق خودداری شود.
5. INV-01 هنوز نگاشت ماندهٔ قدیمی/چندانبار/Sales/ارسال/مرجوعی و دستگاه/گارانتی حساب/QR می‌خواهد؛ endpoint fake paid ساخته نشود.
6. کل PDF ادامه دارد: providerهای هویت/پرداخت/refund/چک و مدارک/ارسال/تخفیف، رسانهٔ S3/ClamAV، CMS/SEO پیشرفته، PWA/Push/accessibility/CWV، support/review/market، CI/پایش و Linux/restore تولید/تحویل. adapter خاموش معیار پایان نیست.
