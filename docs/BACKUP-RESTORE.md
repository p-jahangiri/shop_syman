# تمرین بازیابی SQL و کلیدهای برنامه

**شاهد تازهٔ 2026-10-24 برای سورس۳۴:** `artifacts/checks/cart34-restore-88c24df7891c43db90837f40521c4776.json` با۸ مرحلهٔ SQL و۱۶ بررسی verifier موفق است. COPY_ONLY/CHECKSUM/VERIFYONLY، restore در GUID و فایل تازه بدون REPLACE، CHECKDB کامل و hash/شمارش هر۱۰۵ جدول و۳۴ migration عین مبدأ پذیرفته‌اند. مشتری و InventoryManager تولیدشده با رمز/MFA جاری خود QA، Cart2 دو زبان/قیمت بالای۲^۵۳، رسید تاریخی و key ring کپی‌شده، رمزگشایی یادداشت و fail-closed کلید غایب/مالک یا application متفاوت را گذراندند؛ snapshotSKU فقط deserialize شد و رمزگذاری‌شده معرفی نشد. ورود فقط جدول‌های identity کپی را تغییر داد؛ هیچ جدول کسب‌وکار/موجودی، مبدأ یا اصلی۳۱ تغییر نکرد.

مبدأ، history واقعی آزادسازی/تخصیص دوباره از پنل موبایل و تبدیل از مرورگر داشت: سه دستگاه/دو claim فعال، OnHand3/Reserved0/SourcingReserved2، یک conversion/receipt/event و سه بخش cart؛ public123 و accepted9007199254740993×2، صفر Orders/Quotes/Reservations/Settings/Policies. کپی restore و فایل‌های خودش پاک و پس از پذیرش، فقط مبدأ GUID و credential/key ring همان QA نیز با `cart34-owned-source-cleanup-9c2c0368c6244e0b8eed433b1e4a7993.json` حذف شدند.۶ محافظ target/mode پیش از SQL موفق‌اند؛ `cart34-restore-negative-guards.json` مرجع است. حدود همان میزبان/Development/MacARM-Rosetta و نبود offsite/nativeLinux/RTO/production همچنان برقرارند؛۷٫۵۹ثانیه برای این دادهٔ کوچک RTO نیست.

خطاهای ابزار محفوظ‌اند: build نخست فقط CA1416 helper را نشان داد و guard پلتفرم اضافه شد؛ نوشتن marker توقف با `UnixCreateMode` در `FileMode.Truncate` exit134 داد و restore به‌درستی رد شد. گزینهٔ ساخت فایل اصلاح شد. mode مستقل recovery فقط پس از بسته‌بودن چهار پورت، نبود session دیگر SQL و اثبات readonly source۳۴/هویت/تاریخچه، marker اولیه را حفظ و provenance صریح recovery نوشت؛ `cart34-preserve-finalize-ccb0acb9e98a419d86ed85c9130b1bf0.json` شاهد است و shutdown عادیِ موفق ادعا نمی‌کند. compile نخست recovery یک await/span داشت و با await جدا اصلاح شد؛ build نهایی صفر warning/error. اولین prebackup fingerprint جدول خالی فاقد sha بود؛ count مستقل و hash صریح `[]` در خود SQL تصحیح و اجرای کامل موفق شد؛ فایل‌های نخست بازنویسی نشده‌اند. هیچ marker دستی، seed، migration، auth یا writeSQL در recovery انجام نشد. رفتار عادی preserve پس از اصلاح، از recovery نتیجه گرفته نمی‌شود؛ مسیرهای پیش‌فرض cleanup قبلی محفوظ‌اند.

وضعیت 2026-10-23: **تمرین واقعی محلی QA با۲۳ بررسی موفق** (۶ مرحلهٔ SQL/backup و۱۷ بررسی verifier) و۵ محافظ ورودی موفق است. این شاهد، سرویس بکاپ تولید، بازیابی روی میزبان مستقل یا RTO/RPO نیست. معیار OPS-02/معیار۱۲ PDF هنوز کامل نیست.

## اجرای قابل تکرار

ابتدا `Shop.UiHarness` عملیات QA باید یک run مستقل با مشتری/مدیر تولیدشدهٔ خودش، key ring خصوصی، دست‌کم یک نشانی و سفارش‌های لغوشده ساخته باشد. این ابزار seed/حساب/سفارش تازه نمی‌سازد؛ مبدأ را حفظ می‌کند. این ابزار برای بازیابی run متعلق به خود QA است که پس از وقفهٔ فرایند، SQL و فایل‌های خصوصی آن باقی مانده‌اند و API آن خاموش است. توقف graceful معمولی harness پس از readiness، دیتابیس و فایل‌های مبدأ را حذف می‌کند؛ از SIGTERM برای آماده‌کردن مبدأ این تمرین قدیمی استفاده نکنید. مسیر قدیمی source۲۱ تغییر نکرده است؛ گزینهٔ محدود Cart2 در بخش زیر مستقل است. پورت باید بسته و SQL سالم و فضای میزبان دست‌کم۱۰GiB باشد.

```sh
dotnet build backend/tests/Shop.UiHarness --no-restore -m:1 -nr:false
python3 scripts/rehearse-qa-restore.py --source-run SaymanTest_Ui_<32-hex-guid>
```

پارامتر دوم فقط basename دقیق run متعلق به QA زیر `tmp/ui-cart/` است؛ نام اصلی `Sayman`، مسیر و نام غیرcanonical پیش از خواندن credential/اتصال رد می‌شوند. source directory باید0700، credentialها0600 و هیچ عضو symlink نباشد. usernameها فقط الگوی تولیدی cartui/financeui دارند. script فقط container محلی ثابت فروشگاه را مصرف می‌کند؛ verifier نیز فقط SQL loopback11433 و نام `SaymanTest_Restore_<guid>` را می‌پذیرد.

رمز SQL از `.env` فقط به env فرایند می‌رود؛ credential و کد/کلید خصوصی در آرگومان، گزارش یا خروجی چاپ نمی‌شوند. key ring و credential QA فقط داخل پوشهٔ مستقل0700 کپی و فایل‌ها0600 می‌شوند. رمز/MFA/کلید مالک استفاده نمی‌شود.

## مراحل و نتیجهٔ پذیرفته‌شده

1. SQL مبدأ فقط با query متادیتا، ciphertext و مبلغ/وضعیت سفارش خوانده می‌شود. همهٔ سفارش‌های مورد سنجش باید لغوشده باشند؛ هیچ سفارش/نرخ/تنظیم تجاری توسط این ابزار ساخته نمی‌شود.
2. `BACKUP ... WITH COPY_ONLY,CHECKSUM` به فایل GUID تازه در data volume خود SQL، `RESTORE VERIFYONLY ... CHECKSUM` و SHA256 فایل موفق شدند. overwrite/REPLACE وجود ندارد.
3. restore به دیتابیس و MDF/LDF تازه، `DBCC CHECKDB` کامل بدون repair و تطابق۲۱ migration مبدأ/بازیابی موفق شد. اصلی قبل/بعد۱۷ ماند.
4. verifier در فرایند .NET تازه و TestServer واقعی، ورود رمز مشتری موجود را انجام داد؛ GET خصوصی دفتر نشانی، default و digest ciphertext یکسان را با key ring کپی‌شده تأیید کرد. دادهٔ خصوصی در گزارش ثبت نشد.
5. GET جزئیات هر دو سفارش: مبلغ رشته‌ای صحیح ریال، وضعیت لغوشده، ارسال فیزیکی/دیجیتال و وجود یا نبود delivery، `canPay=false` و `gateway_unconfigured` مطابق مبدأ بود.
6. مدیر موقت موجود همچنان MFA می‌خواست؛ access موقت قبل MFA حق خواندن محتوا نداشت و403 داد. secret فقط از حساب QA بازگردانی‌شده خوانده و TOTP خودش در مسیر واقعی verify مصرف شد؛ سپس GET مجوزدار CMS موفق بود. revision و digest مستقل draft/published حفظ شدند. این verifier انتشار یا rollback انجام نداد. پس از پاسخ صریح D22، آزمون مستقل انتشار/بازگردانی با۱۴ بررسی API/SQL/Next موفق شد؛ cms-approved-publication.json مرجع مستقل است.
7. نبود key ring خطای `address_unavailable` داد؛ owner متفاوت و application discriminator متفاوت رمز را باز نکردند. هیچ دادهٔ جایگزین/موفقیت ساختگی تولید نشد.
8. فقط دیتابیس restore همین invocation، فایل BAK هم‌نام و پوشهٔ private کپی‌شده حذف شدند. در پایان خود تمرین، مبدأ CMS و فایل‌های خصوصی خودش محفوظ بودند؛ پس از تکمیل مستقل D22، همان مبدأ با توقف graceful پاک شد (customer-operations-final-cleanup.json).

`Shop.UiHarness` این حالت را فقط با `SHOP_UI_VERIFY_RESTORE=1` دارد؛ در پروژهٔ تست است و endpoint تولیدی، Kestrel یا provisioning هویت اضافه نشده است. environment/DTOها و providerهای اصلی تغییر نکرده‌اند.

## شواهد و حدود

- `artifacts/checks/qa-restore-report.json`:۶ بررسی بیرونی و۱۷ verifier موفق، main۱۷/source۲۱، cleanup کپی کامل؛ حدود۴ثانیه برای این دادهٔ کوچک (اندازه‌گیری RTO نیست).
- `qa-restore-guards.json`:۵ ورودی اصلی/مسیر/نام نامعتبر پیش از SQL رد شدند. `qa-restore-build.log`: build صفر warning/error. `qa-restore-verifier.log` خروجی اجرای واقعی است؛ دادهٔ خصوصی گزارش نشده است.
- نخستین تلاش رسیده به restore مراحل SQL را پاس کرد اما ContentRoot verifier نادرست بود؛ کپی خودش پاک و پس از اصلاح همان مسیر content root harness، اجرای کامل موفق شد. `qa-restore-first-report.json` و `qa-restore-first-verifier.log` شاهد شکست محفوظ‌اند. اجرای میانی مشتری/نشانی در `qa-restore-address-only-report.json` محفوظ است. خطاهای گزینهٔ `sqlcmd` پیش از هر backup/restore اصلاح شدند؛ ciphertext با خروجی نامحدود خوانده می‌شود و header به‌جای truncation حذف می‌شود.

این تمرین روی SQL2022 در Docker/MacARM/Rosetta و همان میزبان/instance/data volume انجام شد؛ SQL واقعی بود ولی native Linux x64، بازیابی پس از فقدان دیسک یا نسخهٔ دیگر SQL را نمی‌پذیرد. فایل BAK و key ring این QA در Development بدون certificate تولیدی بودند و فقط در محدودهٔ خصوصی موقت نگه‌داری و حذف شدند.

## پیش از تکمیل OPS-02

حساب محدود backup/restore، نگه‌داری و encryption/offsite/rotation، مقصد واقعی S3/MinIO و هشدار شکست، زمان‌بندی، RPO/RTO و سنجش با حجم واقعی، backup مستقل certificate و private key رمزگشایی key ring، media/object storage و تنظیمات لازم، بازیابی روی میزبان Linux مستقل و smoke برنامه، سازگاری migration و runbook عملیاتی هنوز لازم‌اند. backup خودکار تولید فعال نشده؛ هیچ دادهٔ واقعی به بیرون فرستاده نشده است.

## ابزار مستقل تمرین Cart2، سورس۳۴؛ هنوز اجرا نشده

`scripts/rehearse-cart34-restore.py` و `Cart34RestoreVerifier` برای SQL۳۴ ساخته شده‌اند. این بخش صرفاً روش اجرا و محافظ‌های کد است؛ build/guard/backup/restore/DBCC/HTTP تازه تا ثبت گزارش واقعی پذیرفته نیستند. script قدیمی و شاهد۲۳بررسی source۲۱ حفظ‌اند.

برای آماده‌کردن مبدأ، root پس از build سریالی UiHarness باید run **تازه** با شش flag صریح و گزینهٔ زیر بسازد:

```sh
SHOP_UI_CART2_QA=1 SHOP_UI_ALLOCATION_QA=1 SHOP_UI_OPERATIONS_QA=1 SHOP_UI_SUPPLY_QA=1 SHOP_UI_OFFERS_QA=1 SHOP_UI_SOURCING_QA=1 python3 scripts/ui-cart-harness.py --preserve-cart34-on-stop
```

این flag با resume یا بدون Cart2 رد می‌شود. حفظ فقط پس از Ready و توقف graceful انجام می‌شود: credential writer و API ابتدا بسته می‌شوند، سپس marker خصوصی `preserved-cart34.json` با حالت `stopped-preserved` ثبت می‌شود. حالت پیش‌فرض harness همچنان SQL و فایل‌های خودش را پاک می‌کند؛ startup ناموفق حفظ نمی‌شود. مجوز درخت فایل‌های تولیدی خود run به پوشه0700/فایل0600 محدود می‌شود. پس از توقف، همهٔ listenerهای QA باید بسته باشند؛ sourceGUID/marker/cart2 metadata/شناسهٔ مشتری و InventoryManager تولیدی، key ring خود run، UID جاری، نبود symlink/hardlink و۱۰GiB فضای آزاد مستقل سنجیده می‌شوند.

root پیش از snapshot باید تبدیل واقعی Cart2 را از مرورگر/HTTP مجاز همان QA اجرا کند؛ حذف گروه اختیاری است. release/reallocate قبلی می‌تواند وجود داشته باشد: script allocation اولیهٔ metadata را وضعیت جاری فرض نمی‌کند. ordinary/inquiry و قیمت عمومی۱۲۳ریال مستقل از توافق9007199254740993×2 باید حفظ، موجودی فیزیکی۳/رزرو سفارش۰ و سهم جاری۰یا۲ با claim فعال همان مقدار سازگار باشد. هیچ سفارش، quote، reservation یا سیاست هزینه/سفارش مالی ساخته نمی‌شود.

```sh
python3 scripts/rehearse-cart34-restore.py --source-run SaymanTest_Ui_<32-hex-guid> --preflight-only
python3 scripts/rehearse-cart34-restore.py --source-run SaymanTest_Ui_<32-hex-guid>
```

`--preflight-only` فقط فایل/مجوز/listener/ظرفیت را می‌سنجد؛ `.env`، SQL، verifier و پاک‌سازی اجرا نمی‌شوند. اجرای اصلی فقط همان SQL container محلی و DB مبدأGUID را می‌خواند. history دقیق هشت schema/۳۴migration و اصلی۳۱ لازم است؛ همهٔ جدول‌های user با PK قطعی، تعداد ردیف و SHA256 ردیف‌های مرتب، شامل rowversion، Cart2 history، receipt، snapshot و ciphertext سنجیده می‌شوند. بدون PK تمرین بسته می‌شود. بکاپ `COPY_ONLY,CHECKSUM`، `VERIFYONLY` و digest، restore به DBGUID و MDF/LDF کاملاً تازه بدون `REPLACE` و `DBCC CHECKDB` کامل بدون repair انجام می‌شوند. history و همهٔ hashها پیش از auth باید دقیقاً برابر مبدأ باشند.

verifier در فرایند تازه/TestServer بدون seed/migration/Kestrel با credential موجود مشتری و InventoryManager همان GUID وارد می‌شود. رمز مشتری و MFA جاری انبار از مسیر واقعی، منع دسترسی قبل MFA، SerialV2 و منع خواندن مالی/یادداشت داخلی برای نقش انبار، Cart2 FA/EN و GET receipt تاریخی سنجیده می‌شوند. درخواست/یادداشت داخلی و eventهای آن با key ring کپی‌شده باز می‌شوند؛ نبود کلید، owner دیگر و application discriminator دیگر باید بسته بمانند. **accepted SKU snapshot رمزگذاری نشده است**؛ `SkuSnapshotJson` حفظ و deserialize و مبلغ ریال رشته‌ای دقیق سنجیده می‌شود. هیچ credential/کد/کلید/یادداشت خصوصی یا خروجی خام exception در گزارش ذخیره نمی‌شود. auth فقط schema identity کپی restore را تغییر می‌دهد؛ تمام جدول‌های تجاری/فیزیکی کپی و همهٔ جدول‌ها/فایل‌های مبدأ دوباره برابر سنجیده می‌شوند.

گزارش هر invocation با GUID تازه زیر `artifacts/checks/cart34-restore-*.json` است و overwrite نمی‌شود. `finally` فقط DB کپی، فایل‌های BAK/MDF/LDF همان invocation و private directory کپی را پس از drop موفق حذف می‌کند. مبدأ برای پذیرش root باقی می‌ماند؛ helper حذف مبدأ عمل مستقل و عمدی زیر است، با همان guardهای مالکیت و SQL۳۴:

```sh
python3 scripts/rehearse-cart34-restore.py --source-run SaymanTest_Ui_<32-hex-guid> --cleanup-source
```

این ابزار restore اصلی، انتشار، مالی یا تولید نیست و native Linux/offsite/RTO/RPO را اثبات نمی‌کند. شکست cleanup باید در گزارش بماند و فایل یا DB دیگری برای جبران حذف نشود.

### بازیابی صریح marker پس از شکست پایان run

در نخستین توقف preserve-enabled، API و credential writer بسته شدند اما نوشتن marker با `FileMode.Truncate` همراه `UnixCreateMode` خطای آرگومان داد و فرایند با134 خاتمه یافت؛ marker `running` و SQL/فایل‌های همان QA باقی ماندند. این shutdown موفق گزارش نمی‌شود و لاگ شکست حفظ می‌شود. تنظیم UnixCreateMode اکنون فقط برای CreateNew است.

برای چنین مبدأیی، mode مستقل زیر فقط recovery متادیتا را انجام می‌دهد؛ قبل از build/اجرای واقعی، موفقیت آن ادعا نمی‌شود:

```sh
python3 scripts/ui-cart-harness.py --finalize-preserved-cart34-run SaymanTest_Ui_<32-hex-guid>
```

wrapper پیش از `.env` نام exactGUID، UID caller، مجوز دقیق0700/0600 و نبود symlink/hardlink را می‌سنجد و تمام modeهای seed/resume/auth-verifier را از محیط این اجرا حذف می‌کند. helper برنامه را بالا نمی‌آورد: بسته‌بودن هر۴پورت QA پیش و پس از SQL، نبود session دیگر متصل به همان source، شمار دقیق۳۴migration در هشت schema، اتصال metadata به حساب‌های تولیدی مشتری/InventoryManager و نقش‌ها، conversion/receipt/event واقعی و نبود سفارش/quote/reservation/تنظیم مالی فقط با SELECT/IF تأیید می‌شوند؛ هیچ migration/seed/login/MFA/فرمان تجاری یا write SQL ندارد. پس از سنجش دوبارهٔ فایل‌ها، marker اصلی در فایل خصوصی `preserved-cart34.running-before-recovery.json` بدون تغییر نگه داشته و marker جایگزین با provenance `finalize_after_shutdown_marker_write_failure` و hash اصلی ثبت می‌شود. گزارش مستقل `cart34-preserve-finalize-<guid>.json` این recovery را از shutdown عادی، restore و CHECKDB متمایز می‌کند. داده و کلیدهای واقعی همان run حفظ و سناریوی Cart2 بازتولید نمی‌شود.

## بکاپ خصوصی ارتقای اصلی در ادامه

پیش از اعمال migrationهای۱۸–۲۱ روی اصلی محلی، COPY_ONLY/CHECKSUM و VERIFYONLY موفق و BAK۱۲٫۱MiB به همراه کپی خصوصی Data Protection key ring (بدون parse/چاپ) در tmp/local-backups نگه‌داری شد. main-pre21-backup.json مسیر دقیق و SHA256 را ثبت می‌کند؛ پوشه0700 و فایل‌ها0600 هستند. فایل BAK فقط همین invocation از container پس از کپی حذف شد؛ نسخهٔ خصوصی میزبان باقی است. بکاپ پیش از ارتقا و نمونهٔ Moments است (CMS revision1 و main۱۷)؛ خود اصلی restore نشده است و بازیابی overwrite باید عملیات جدا و آگاهانه باشد. این نگه‌داری همان میزبان، جای offsite/encryption/certificate/زمان‌بندی تولید را نمی‌گیرد.

## ارتقای بعدی بازار و helper دستی

پیش از۲۱→۲۳ نیز scripts/backup-local.py --label main-pre23 --report artifacts/checks/main-pre23-backup.json، بکاپ خصوصی COPY_ONLY/CHECKSUM/VERIFYONLY و key ring را نگه داشت؛ label/report جدید و۱۰GiB فضای آزاد لازم است، فقط container و database ثابت محلی را مصرف می‌کند و restore ندارد. schema جدید در بازیابیِ قبلی با۲۳ بررسی وجود نداشت؛ آن شاهد برای schema۲۱ است و restore Market۲۳ هنوز جدا پذیرفته نشده. شمارندهٔ schema در rehearse-qa-restore.py اکنون هفت schema قدیمی و market را از metadata whitelist می‌خواند، تا جدول history غایبِ نسخهٔ قدیمی را query نکند. این تغییر کمکی full restore تازه نیست.


## بکاپ و ارتقای محلی۳۴→۳۵

`main-pre35-release-backup.json` بکاپ تازه پس از پذیرش نهایی مرورگر و توقف writerهاست: COPY_ONLY/CHECKSUM/VERIFYONLY،۱۴٬۷۹۸٬۸۴۸بایت و یک XML کلید خصوصی بدون parse در پوشهٔ0700/فایل0600. helper اصلی و wrapper پیش/پس از بکاپ تمام۱۰۵جدول و۳۴history را برابر دیدند. `quote35-main-{before,after,post-smoke}.json` ارتقای فقط یک migration Sales/یک جدول خالی و marker nullable را با حفظ چهار quote تاریخی/۲۴installment، تمام داده‌ها/schema قدیمی و DBCC PHYSICAL_ONLY اثبات می‌کنند؛۹۲GET پس از startup هم تغییری نداد. مسیر خصوصی/hash و گزارش خام helper محفوظ‌اند. این بکاپ روی همان میزبان، restore/offsite/nativeLinux/بازیابی کامل schema35 یا زمان‌بندی تولید را اثبات نمی‌کند؛ اصلی restore نشده است. runtimeهای۳۴ برای بررسی/برگشت آگاهانه حفظ‌اند؛ Down در حضور V4 history بسته است و restore/Down خودکار انجام نشود.


## پذیرش تازهٔ Order38

`order38-restore-22aabb470a414d14b43a2df514039f4f.json` با۱۲بررسی موفق، بکاپQA۲۲٬۱۳۸٬۸۸۰بایت COPY_ONLY/CHECKSUM/VERIFYONLY، restore بدونREPLACE بهGUIDتازه، CHECKDBکامل و تطبیق۱۱۱جدول/۳۸history/rowversion، کپی دقیق keyring، رمز مشتری و MFA کارکنان و خواندن Order2/page/CartFA-EN/supply/request/link را ثبت می‌کند. auth فقط identityکپی را عوض کرد؛ sourceSQL/key دقیقاً محفوظ و کپی/API5183/backup/credential/key پاک شدند. دو شکست اولیهٔ ابزار (headerادمین، مسیر ownerId) باcleanupموفق محفوظ‌اند؛ guardهای۳۴ تغییر نکردند. `scripts/rehearse-order38-restore.py` فقط QA متعلق به همین task را می‌پذیرد؛ overwrite اصلی/seed/migration ندارد.

`main-pre38-release-backup.json` بکاپ تازهٔ اصلی۳۵ با writerبسته،۱۴٬۷۹۸٬۸۴۸بایت و یکXMLkeyring خصوصی0700/0600است. پس از سهmigration و پنج جدول خالی، حفظ۱۰۶جدول/ستون‌های قبلی و schema/index/FK/trigger، DBCCPHYSICAL_ONLY و۱۱۱GETباguardنهایی پذیرفته‌اند. اصلی restore یاDown نشده است. هر دو پذیرش همان میزبانDevelopmentهستند؛ offsite/nativeLinux/RTO/تولید همچنان بازند.
