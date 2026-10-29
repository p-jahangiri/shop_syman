# رسانهٔ عمومی کاتالوگ

این برش برای تصویر عمومی کالا، دسته و برند است. مدارک هویتی/اعتباری از این مسیر پذیرفته نمی‌شوند؛ سامانهٔ مدارک خصوصی جداگانه پیاده شده ولی روی اصلی Disabled است؛ PRIVATE-FILES مرجع آن است. پنل کالا گالری مرتب دارد، تصویر اول اصلی است و حذف از فرم فقط رابطهٔ محصول را تغییر می‌دهد.

## بازبینی D51

اعتبارسنجی عمومیURLبینکالا وCMSیکسان شد؛مسیرصادرشده وCMSpageدیگرnewlineانتهایی نمی‌پذیرند. پنل علاوه برکالا/برند/دسته/بازار، لوگو/hero/تصویراشتراک/بنر،بلوک تصویر صفحه و تصویرمقاله uploader دارد. پیش‌نمایش پنل مسیرصادرشده را به/apiمی‌برد ولیمقدارذخیره‌شدهcanonicalمی‌ماند. ذخیره/انتشارهنگامuploadقفل است؛ پاسخ سه‌اندازه وlimitsاعتبارسنجی وارسال/تغییرتکراری مهار می‌شوند. وضعیت انتشار و مرورگر درSTATUS ثبت می‌شود.

وابستگی محلی واقعی با `docker compose -f compose.media.yaml up -d scanner` روی127.0.0.1:13310 وvolumeمختصامضاها اجرا می‌شود. `scripts/serve-main-api.py` فقطدرصورتوجودتنظیمدقیق `tmp/public-media-local.json`،Filesystemخارجwebroot در `tmp/public-media-objects` را درDevelopmentفعال می‌کند. این دایرکتوری **دادهٔ تصویر** است؛cache نیست و باید همراهSQLوکلیدهادرbackup/restoreهماهنگ حفظ شود. پاک‌سازیtmpنبایدآن را حذف کند. S3تولید ازاینموفقیتنتیجهگرفته نمی‌شود. حافظهٔاسکنربه4GiBمحدوداست،مطابق[راهنمایرسمیClamAV](https://docs.clamav.net/manual/Installing/Docker.html).

اسکنPNGواقعی وامضایبی‌خطرآنتی‌ویروسدرحافظه پاس شد. ClamAV1.5.4بانک28164مورخ2026-10-25رادارد؛CDNبانک28168راتبلیغمی‌کندولیFreshClamپاسخ403ودورهٔcooldownتا2026-10-30می‌گیرد. آخرینتصویررسمیدریافت‌شده هم28164دارد؛تلاشبی‌پایان/خاموش‌کردناسکن/ادعایامضایروزانجامنشد. نیازشبکهدرFINAL-REVIEWبازاست.

گزارش‌هایقبلیپایین،سابقهٔآزمون‌اند. کتابخانهٔرسانه/حذفReadyبدونارجاع،گرافمرجعCMSوپذیرشS3/Linux/load/restoreباobjectهنوزبازند. مدارکخصوصیازاینمسیرمنتشرنمی‌شوند.

## جریان و حدود

`POST /api/admin/media/images` به نقش همکار،توکن کامل پس از MFA و یکی از مجوزهای `catalog.write` یا `cms.write` نیاز دارد. این مجوز تصویر عمومی،مجوز تغییر کاتالوگ یا مدارک خصوصی ایجاد نمی‌کند. تنها یک قسمت multipart با نام `file` پذیرفته می‌شود؛ فیلد اضافی رد می‌شود. JPEG/PNG/WebP، حداکثر ۸ MiB، حداقل ۱۶×۱۶، حداکثر ۸۱۹۲ در هر ضلع و ۱۲ میلیون پیکسل مجازند. نام، پسوند، MIME، signature و decode واقعی باید سازگار باشند؛ SVG و تصویر چندفریمی رد می‌شوند.

فایل خام با پروتکل واقعی INSTREAM به ClamAV فرستاده می‌شود. فقط پاسخ دقیق موفق پذیرفته می‌شود؛ نبود تنظیم، قطع سرویس، timeout یا پاسخ نامعتبر برابر 503 و تشخیص تهدید برابر 400 است. هیچ scanner همیشه‌موفق در اجرای برنامه ثبت نشده است.

SkiaSharp پیکسل‌ها را decode، هشت جهت EXIF را اعمال، رنگ را به sRGB و خروجی را به WebP تبدیل می‌کند. فایل خام عمومی ذخیره نمی‌شود. سه اندازهٔ `thumb`، `card` و `zoom` با ضلع بلند حداکثر ۳۲۰، ۹۶۰ و ۱۹۲۰ تولید می‌شوند؛ تصویر کوچک بزرگ نمی‌شود. re-encode اطلاعات EXIF و نام فایل را به خروجی منتقل نمی‌کند. هر خروجی هش SHA-256 دارد.

Catalog مالک `PublicImages` و `PublicImageVariants` است. پیش از نوشتن objectها، ردیف Staged با عامل و زمان ساخته می‌شود؛ فقط پس از ثبت همهٔ خروجی‌ها، Ready و متادیتای آن‌ها در یک SaveChanges تراکنشی ذخیره می‌شوند. ProductMedia برای فایل تولیدشده FK دارد و ذخیرهٔ کالا/دسته/برند فقط مسیر صادرشده و Ready را قبول می‌کند. SQL یک rowversion برای تعارض دارد.

خرابی نوشتن خروجی‌ها باعث تلاش برای حذف همان سه کلید و ثبت Failed می‌شود. اگر ثبت Ready آغاز شده ولی پاسخ آن نامعلوم باشد، objectها حفظ می‌شوند تا احتمال موفق‌شدن commit باعث حذف تصویر منتشرشده نشود. reconciliation پایدار اکنون آپلودهای Staged/Failed قدیمی و lease منقضی را جمع می‌کند. فایل Ready بدون ارجاع عمداً نگه داشته می‌شود؛ سیاست حذف آن و مرجع کامل مصرف CMS هنوز باقی است. پذیرش سرویس واقعی/بار نیز جدا لازم است.

## خواندن و کش

مسیر عمومی فقط `/api/media/catalog/{32 lowercase hex}/{thumb|card|zoom}.webp` است؛ اصل فایل یا مسیر دلخواه قابل دریافت نیست. خواندن به ردیف Ready، طول دقیق و SHA-256 مطابق SQL نیاز دارد. پاسخ WebP، ETag قوی، marker `catalog-image-v1`، nosniff و CSP sandbox دارد و immutable است.

Next مسیر `/media/catalog/...` را فقط به API تنظیم‌شده proxy می‌کند. cookie، Authorization و Range مشتری ارسال نمی‌شوند؛ redirect دنبال نمی‌شود. MIME/marker/طول/هش/امضای WebP کنترل می‌شوند و پاسخ دارای Set-Cookie، Vary Cookie/Authorization یا cache خصوصی رد می‌شود. خطا 404/503 با no-store است و fixture جایگزین نمی‌شود.

PWA فقط همین مسیر ثابت را با marker و MIME صحیح وارد کش عمومی می‌کند؛ تصویر خصوصی، اصل، URL امضاشده و پاسخ خطا وارد آن نمی‌شوند. DTO آفلاین تنها thumbnail عمومی را نگه می‌دارد و قیمت/موجودی/گالری خصوصی اضافه نمی‌کند. تصاویر HTTPS قبلی همچنان مستقیم توسط مرورگر خوانده می‌شوند و توسط سرور Next fetch نمی‌شوند.

## پیکربندی

پیش‌فرض `Media__Storage=Disabled` است. `GET /api/admin/media/capabilities` با مجوز کاتالوگ، حدود و آماده‌بودن تنظیمات را می‌دهد؛ این پاسخ تضمین سلامت لحظه‌ای سرویس بیرونی نیست. UI تا پیکربندی ذخیره‌ساز و اسکنر، upload را غیرفعال نشان می‌دهد.

| متغیر | کاربرد |
|---|---|
| `Media__Storage` | `Disabled`، `Filesystem` یا `S3` |
| `Media__Directory` | مسیر خصوصی خارج webroot، فقط Development/Filesystem |
| `Media__ClamAvHost` / `Media__ClamAvPort` | سرویس clamd در شبکهٔ خصوصی؛ پورت پیش‌فرض 3310 |
| `Media__ScanTimeoutSeconds` | پیش‌فرض ۱۰ ثانیه، محدوده ۱ تا ۶۰ |
| `Media__S3__Endpoint` / `Bucket` / `Region` | origin ثابت، bucket خصوصی و region امضا |
| `Media__S3__AccessKey` / `SecretKey` | secret محیطی؛ در سورس/لاگ/چت قرار نگیرد |

Filesystem در محیط غیر Development هنگام startup رد می‌شود؛ فایل CreateNew است و overwrite نمی‌شود. Production/S3 به HTTPS بدون userinfo/query/path، bucket ثابت و credential محدود به namespace `catalog-images/` نیاز دارد. bucket مستقیم عمومی نشود. SDK با stream طول‌دار و checksum SHA-256 می‌نویسد؛ متن کامل فایل در لاگ قرار نمی‌گیرد. اسکنر TCP نباید روی اینترنت عمومی در دسترس باشد.

پاک‌سازی با `--reconcile-public-images` در batch حداکثر۲۵ اجرا می‌شود. worker خودکار فقط با `Media__CleanupEnabled=true` فعال است: پنج دقیقه پس از startup و سپس ساعتی. Staged/Failed باید حداقل۲۴ ساعت عمر و یک ساعت فاصله از تلاش قبلی داشته باشند. claim با rowversion و lease پنج‌دقیقه‌ای SQL است؛ کل حذف هر asset سی ثانیه مهلت دارد. شکست، Failed و تلاش بعدی؛ موفقیت، Purged با حفظ متادیتای عامل/زمان است. lease منقضی بازیابی می‌شود. Ready در انتخاب و claim حذف‌شدنی نیست و هیچ ردیف اصلی پاک نمی‌شود.

دو upload همزمان و ۱۰ درخواست در دقیقه برای هر partition سیاست API مجازند. runtime پنل نیز فقط برای upload احراز‌شده سقف ۸ MiB به‌علاوهٔ ۶۴ KiB multipart دارد و بقیهٔ JSONها همان سقف ۵۱۲۰۰۰ بایت را حفظ می‌کنند. deadline کل upload چهل ثانیه و عملیات S3 ده ثانیه است. decode بومی همزمان هنوز worker/process ایزوله ندارد؛ benchmark حافظه/CPU و محدودیت‌های استقرار باقی‌اند.

## شاهد و کار باقی

- ۲۹ مورد تازه در مجموعهٔ ۹۶ تست بک‌اند: codec واقعی سه فرمت/جهت EXIF/حذف metadata، حدود و جعل MIME، شکست اسکن، پاک‌سازی نوشتن ناقص، عدم حذف پس از Ready نامعلوم، tamper و پروتکل framed. اسکنر پروتکل و SDK S3 در این تست‌ها stub/capture صریح‌اند؛ شاهد سرویس واقعی نیستند.
- سه سناریوی رسانه در مجموعهٔ شش تست SQL واقعی، Staged/Ready، منع ارجاع زودهنگام، rowversion/Failed، دو worker همزمان، تعارض Ready و cleanup، lease منقضی و retry فاصله‌دار خطای حذف را آزمودند. دادهٔ مصنوعی آن آزمون codec/scan نیست.
- دو تست runtime پنل و ۱۴ تست HTTP تولیدی Next برای مسیر عمومی، مرز خصوصی، عدم ارسال اعتبار ورود و خطای upstream پاس شدند (`media-gateway-smoke.json`). یک تست PWA کش مجاز و رد marker/MIME/private/query را پوشش می‌دهد.
- build تولیدی دو رابط و۹۶ تست stage Linux موفق‌اند؛ runtime image هنوز جدا باید بررسی شود. پذیرش UI upload پس از ورود اصلی مدیر، ClamAV واقعی با signature تازه، S3 واقعی، runtime Linux، سیاست Ready بدون ارجاع، پایش و load همچنان باقی‌اند. uploader CMS و مدیریت/حذف رسانهٔ استفاده‌نشده هنوز متصل نشده‌اند.

منابع: [ClamAV scanning](https://docs.clamav.net/manual/Usage/Scanning.html)، [SKCodec](https://learn.microsoft.com/en-us/dotnet/api/skiasharp.skcodec?view=skiasharp)، [SkiaSharp 4.153.1](https://www.nuget.org/packages/SkiaSharp/4.153.1)، [Linux native assets](https://www.nuget.org/packages/SkiaSharp.NativeAssets.Linux.NoDependencies/4.153.1)، [AWS SDK S3](https://www.nuget.org/packages/AWSSDK.S3/4.0.104.6).

فرمان پاک‌سازی با Disabled پیش‌فرض، خروجی۲ و پیام صریح می‌دهد و قبل از query/حذف متوقف می‌شود (`media-reconcile-disabled.log`). نتیجهٔ پاک‌سازی دارای Failed با خروجی۱ اعلام می‌شود.
