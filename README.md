# فروشگاه سایمان

راهنمای انتشار فعلی: [Vercel، Docker روی لینوکس و انتشار با tag](docs/DEPLOYMENT.md). مخزن: [p-jahangiri/shop_syman](https://github.com/p-jahangiri/shop_syman). برای انتشار Production از `compose.production.yaml` استفاده کنید؛ `compose.yaml` مخصوص توسعه است. آمار و فرمان‌های تاریخی پایین جای [STATUS](docs/STATUS.md) را نمی‌گیرند.

فروشگاه داینامیک مطابق PDF، با فروشگاه Next.js، پنل مستقل React/Vite و API ماژولار .NET/SQL Server. مالک ظاهر و جریان فروشگاه را تأیید کرده است (D14). اکنون برش اتصال API و پنل در حال تکمیل است؛ پروژه برای فروش واقعی آماده نیست.

اجرای محلی پذیرفته‌شدهٔ جاری: فروشگاه [3000/fa](http://127.0.0.1:3000/fa)، پنل [3173](http://127.0.0.1:3173)، API5080/SQL۲۴. پنل بازار/CSV و رسید پایدار فعال‌اند؛ صفحهٔ عمومی بازار و تأمین ادامه دارند. هلو طبق درخواست تازه افزوده شده و اتصال زنده تا شناسایی نسخه/ماژول و قرارداد رسمی فعال نیست؛ [وضعیت](docs/STATUS.md) و [طرح اتصال هلو](docs/HOLOO-INTEGRATION.md).

## پیش‌نمایش محلی

پیش‌نیاز: Node.js 22.18 یا جدیدتر در شاخهٔ پشتیبانی‌شده و npm.

```sh
npm ci
npm run dev
npm run dev:admin
```

این دو دستور dev را در terminalهای جدا اجرا کنید. فروشگاه: [فارسی](http://127.0.0.1:3000/fa) و [English](http://127.0.0.1:3000/en). پنل: [مدیریت](http://127.0.0.1:5173).

حالت پیش‌فرض فروشگاه preview است؛ کالا/قیمت/موجودی/گارانتی/شرایط چک نمونه‌اند. ورود نمونه پیامکی و `demo / SaymanDemo!2026` فقط در این حالت است. هیچ سفارش، پرداخت، پیامک یا مدرک واقعی ثبت نمی‌شود. در حالت API، ورود نمونه کنار گذاشته می‌شود.

## نصب و مرور آفلاین

راهنما: [فارسی](http://127.0.0.1:3000/fa/install) و [English](http://127.0.0.1:3000/en/install). Service Worker در build تولیدی فعال است؛ حالت dev آن را ثبت نمی‌کند. فقط اطلاعات عمومی بدون قیمت/موجودی و منابع ثابت ذخیره می‌شوند. حساب، سبد و پرداخت اتصال لازم دارند. نصب و Push روی دستگاه واقعی هنوز آزموده نشده است.

```sh
npm run build
SHOP_PUBLIC_URL=http://127.0.0.1:3000 python3 scripts/serve-storefront-preview.py
```

در terminal دیگر: `python3 scripts/smoke-storefront-public.py`. برای اجرای مستقل و توقف خودکار process آزمایش، پورت 3000 باید آزاد باشد: `python3 scripts/verify-storefront-build.py`. تنظیمات CMS/SEO، قواعد کش و شواهد در [docs/PWA-SEO.md](docs/PWA-SEO.md) است. نمایه‌سازی تا پیکربندی دامنه، اجازهٔ CMS و خروج API از preview غیرفعال می‌ماند.

## API و SQL محلی

پیش‌نیاز: SDK .NET 10 و SQL Server سالم. مجموعهٔ۱۲۹ آزمون SQL واقعی روی Mac ARM/Rosetta موفق است؛ Linux x64 نهایی، بار و تمرین restore هنوز باقی‌اند. D20 پایان آزادسازی را تأیید کرد و محدودیت D19 رفع شد؛ Redis چت طبق D17 خاموش می‌ماند. وضعیت جاری در STATUS ثبت است.

```sh
python3 scripts/init-local-env.py
docker compose --profile backend up -d sqlserver
dotnet restore backend/Shop.sln
dotnet build backend/Shop.sln --no-restore --disable-build-servers -m:1
python3 scripts/backend-local.py --seed-dev
python3 scripts/backend-local.py
```

`init-local-env.py` فقط در صورت نبود `.env`، رمزهای تصادفی را با مجوز 0600 می‌سازد؛ آن‌ها را چاپ نمی‌کند. `--seed-dev` migrationها را اعمال و seed صریح توسعه را اضافه می‌کند؛ فقط در Development مجاز است. API روی [localhost:5080](http://127.0.0.1:5080/health/live) و OpenAPI توسعه روی `/openapi/v1.json` است. زنده بودن API به‌تنهایی سلامت SQL را ثابت نمی‌کند.

ورود اولیهٔ پنل با نام `admin` و مقدار خصوصی `BOOTSTRAP_ADMIN_PASSWORD` در `.env` است. رمز را منتشر یا commit نکنید. پس از ورود، Authenticator باید راه‌اندازی و کد آن تأیید شود. تست SQL این جریان پاس شده؛ ثبت Authenticator حساب اصلی باید توسط مالک انجام شود و QA کامل پنل باقی است.

برای اتصال فروشگاه، dev قبلی را متوقف و این فرمان را اجرا کنید:

```sh
SHOP_DATA_MODE=api SHOP_API_URL=http://127.0.0.1:5080 npm run dev
```

در حالت API، خرابی سرور باعث خطای بارگذاری می‌شود و دادهٔ نمونه جایگزین آن نمی‌شود. access token در حافظه و refresh در cookie امن است. OTP/ثبت‌نام/بازیابی تا اتصال ارائه‌دهندهٔ تأیید هویت غیرفعال‌اند. ارسال/مالیات تعیین نشده و پرداخت واقعی فعلاً فعال نیست.

## آزمون‌ها و SQL قابل بررسی

```sh
npm test
npm run typecheck
npm run typecheck:admin
npm run build
npm run build:admin
dotnet test backend/tests/Shop.Tests --no-restore --disable-build-servers -m:1
```

آخرین اجرا: **۴۳۱ تست بک‌اند،۵۲ تست پنل و۱۲۹ SQL واقعی موفق**؛۱۱۶ تست فروشگاه شاهد قبلی‌اند و این برش دوباره اجرا نشده‌اند. سریال/IMEI پویا، history و retry دستی همان تلاش در پنل اضافه شدند؛۱۷ بررسی محدود مرورگر با SQL/MFA موقت و نمایش کالای منتشرشده/قیمت دقیق FA/EN موفق است. تمدید پیش از درخواست برای وقفهٔ مرورگر و پیمایش منوی کم‌ارتفاع اصلاح شدند؛۸ تست نشست جزو۵۲ موردند. وقفهٔ بلند واقعی بعد از اصلاح و mobile متصل هنوز شاهد جدا می‌خواهند. build نهایی مستقل پنل در tmp/serial-admin-dist موفق است؛ entry333.94/gzip105.92kB و سریال lazy20.67kB، بدون ادعای CWV.

اصلی و سورس اکنون۲۳ migration/هشت schema دارند؛ پس از بکاپ خصوصی SQL+key ring تأییدشده، چهار migration افزایشی و کنترل حفظ داده/DBCC موفق شد. API5080 از artifact مستقل tmp اجرا می‌شود و پنل3173 فعال است؛ Next3000 نیز build/اجرا شد و۲۸ smoke HTTP روی API/SQL واقعی موفق است. CMS انتشار/بازگردانی QA طبق D22 با۱۴ بررسی API/HTTP موفق و همان QA کامل پاک شد. «لحظهٔ سایمان» از CMS، با دادهٔ نمونهٔ مشخص Development در SQL و صفحهٔ /moments پیاده شد؛۱۲۰ فروشگاه/۴۳۵ بک‌اند و چهار SQL مرتبط موفق‌اند. مدل/انتشار مستقل و API کاتالوگ بازار با سه نمونهٔ SQL پیاده شد؛ UI/پنل/CSV و سبد درخواست، همراه دست‌دوم/نظرات/مقایسه در ادامه‌اند؛ پروژهٔ کامل تمام نشده است. [docs/STATUS.md](docs/STATUS.md) مرجع اجرای جاری و حدود پذیرش است.

تست واقعی دیتابیس، پس از آماده شدن SQL:

```sh
dotnet restore backend/tests/Shop.SqlTests
python3 scripts/test-sql-local.py
```

این تست فقط دیتابیس‌های جداگانهٔ `SaymanTest_*` می‌سازد و در پایان همان دیتابیس تست را حذف می‌کند. عدم دسترسی به SQL با خروجی 2 اعلام می‌شود؛ هیچ تست SQL در این حالت اجرا نمی‌شود. تست‌ها ذخیرهٔ هشت ویژگی پویا، قیمت بزرگ، انتشار کاتالوگ/CMS، موجودی و درخواست تکراری/همزمان، enrollment و refresh replay را هدف می‌گیرند. این توضیح مربوط به شش سناریوی پذیرش اولیه بود؛ سناریوی چهارم Staged/Ready و rowversion رسانه را پوشش می‌داد. آمار اجرای پذیرفته‌شده و موارد تازهٔ اجرا‌نشده در STATUS ثبت می‌شود.

## Docker فروشگاه

تمرین محلی SQL+key ring در [docs/BACKUP-RESTORE.md](docs/BACKUP-RESTORE.md) با۲۳ بررسی واقعی و۵ guard موفق ثبت شده است؛ ابزار `scripts/rehearse-qa-restore.py` فقط run موقت QA را به کپی GUID مستقل برمی‌گرداند و کپی را جمع می‌کند. این ابزار backup تولید/زمان‌بندی/offsite را فعال نمی‌کند. build ایزوله با guard ظرفیت اکنون `--platform linux/amd64` یا `linux/arm64` را به‌صورت صریح می‌پذیرد، بدون تغییر default builder.

```sh
python3 scripts/init-local-env.py
docker compose up -d --build storefront
docker compose stop storefront
```

پیش‌نمایش کانتینری روی پورت 3100 با کاربر غیر root و healthcheck است. image قبلی اجرا شده بود؛ تغییرات فعلی داخل image قدیمی3100 بازسازی نشده‌اند. Compose صریحاً `SHOP_ENABLE_PREVIEW=true` دارد. اجرای preview با build تولیدی بیرون Compose نیز همین flag را لازم دارد. فایل‌های Docker API و پنل و override اتصال آماده و syntax آن‌ها بررسی شده است؛ build/run کانتینری آن‌ها هنوز تأیید نشده؛ خروجی standalone فروشگاه و runtime پنل به‌صورت مستقیم روی localhost بررسی شده‌اند. پس از سلامت Docker:

```sh
docker compose --profile backend up -d --wait sqlserver
docker compose --profile backend build api admin
docker compose --profile backend run --rm api --seed-dev
docker compose -f compose.yaml -f compose.connected.yaml --profile backend up -d
```

در این حالت پنل روی 3173، API روی 5080 و فروشگاه روی 3100 است. پورت‌ها فقط localhost هستند؛ Compose برای توسعه و با محیط Development است. در صورت فعال بودن processهای dev روی پورت‌های یکسان، ابتدا همان processها را متوقف کنید. برای استقرار نهایی، TLS، تنظیم Production، certificate و key ring پایدار، حساب محدود SQL و backup/restore باید تکمیل و آزمون شوند. URL عمومی فروشگاه در build پنل با `VITE_STOREFRONT_URL` قابل تنظیم است.

## ساختار

| مسیر                            | کاربرد                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `apps/storefront`               | فروشگاه فارسی/انگلیسی، RTL/LTR، انتخاب تنوع، فیلتر، مقایسه، سبد، تسویهٔ نمایشی                          |
| `apps/admin`                    | پنل مجوزدار کالا/دسته/ویژگی/برند، انبار، روش خرید/چک و CMS                                              |
| `packages/design-tokens`        | توکن‌های OKLCH مشترک و رنگ برند قابل تنظیم                                                              |
| `backend/src/Shop.Api`          | composition root، routeها، policy و migrationها                                                         |
| `backend/src/Shop.Modules.*`    | مالکیت داده به تفکیک ماژول؛ برخی ماژول‌ها هنوز اسکلت‌اند                                                |
| `backend/Seed/development.json` | seed صریح دو زبانه؛ قابل تولید با `node --experimental-strip-types scripts/export-development-seed.mjs` |
| `backend/sql`                   | SQL قابل بررسی تولیدشده از migrationها                                                                  |
| `docs`                          | PRD، تصمیم‌ها، برنامه، معماری و شواهد وضعیت                                                             |
| `skills/dynamic-shop`           | skill اختصاصی و معیارهای پذیرش                                                                          |

تصاویر فعلی محصول SVG مفهومی محلی‌اند. uploader امن در سورس/تست آماده است؛ پذیرش ClamAV/S3 واقعی، اتصال سفارش به رزرو داخلی، providerها، حسابداری کامل و فازهای بعد همچنان در نقشهٔ راه هستند. ایندکس موتور جست‌وجو در این محیط غیرفعال است.

API query جدید با page/filter/lookup و bootstrap خالی در [docs/CATALOG-QUERY.md](docs/CATALOG-QUERY.md) شرح داده شده است. فروشگاه از bootstrap بدون محصول، SSR محدود صفحه/خانه/محصول و lookup انتخاب‌های ذخیره‌شده استفاده می‌کند؛ شش تست SQL واقعی پاس شده‌اند؛ QA کامل پنل تا فروشگاه باقی است. `--migrate`/`--seed-dev` پس از schema، فیلدهای جست‌وجوی خالی قدیمی را با همان نرمال‌سازی فارسی برنامه تعمیر می‌کنند؛ پس از اعمال SQL دستی، `--repair-search-fields` لازم است. اجرای SQL/repair محلی موفق بوده است؛ محدودیت میزبان فعلی در STATUS ثبت می‌شود.

`verify-storefront-build.py` به پورت‌های آزاد 3000 و 3002 نیاز دارد و ۵۷ بررسی HTTP عمومی/قطع API را روی پردازش‌های خودش اجرا می‌کند. فرم چک پنل واحد گردکردن ۱ یا ۱۰ ریال دارد؛ نمایش تومان با یک رقم اعشار و نرخ با دقت basis point حفظ می‌شود. سیاست نمونه تأیید تجاری نیست.

جست‌وجو و صفحه‌بندی مقدار ویژگی از API و UI پشتیبانی می‌شود؛ انتخاب‌های بیرون صفحه با عنوان زبان جاری می‌مانند. فیلدهای FacetSearch پس از migration تازه به repair برنامه نیاز دارند. QA با گزینه‌های فراوان و مرز اجرای واقعی SQL در [docs/CATALOG-QUERY.md](docs/CATALOG-QUERY.md) ثبت شده است.

## تصویر عمومی و اجرای API mode

گالری کالا، upload تصویر کالا/دسته/برند، WebP سه‌اندازه، scanner اجباری و proxy محدود اضافه شده‌اند. بدون تنظیم واقعی scanner/storage، upload موفق نمایش داده نمی‌شود. [MEDIA.md](docs/MEDIA.md) تنظیم‌ها، شواهد و موارد باز را دارد.

```sh
SHOP_PUBLIC_URL=http://127.0.0.1:3000 python3 scripts/serve-storefront-api.py
PORT=3173 ADMIN_API_URL=http://127.0.0.1:5080 node apps/admin/server.mjs
```

هر دستور در terminal جدا و پس از build اجرا شود؛ پورت باید آزاد باشد. runner API فقط API mode را فعال می‌کند؛ runner preview جداست. تست مرز تصویر: `python3 scripts/verify-media-gateway.py`، نیازمند پورت آزاد3002 و build تولیدی است. برای تست codec در Linux: `docker build --target test -f backend/Dockerfile -t sayman-api-tests:local .`؛ اجرای جاری Linux/amd64۴۳۱ تست را پاس کرد (روی MacARM/emulation)؛ runtime API/پنل هنوز آزموده نشده‌اند. نتیجهٔ جاری در STATUS است. پیش از build سنگین، فضای کافی میزبان لازم است.

برای build محلی با کنترل فضای دیسک و builder اختصاصی، `python3 scripts/build-local-image.py backend-test --isolated` (یا `api`، `admin`، `storefront`) را اجرا کنید. حداقل۱۰GiB آزاد لازم است؛ این دستور cache مشترک را prune و builder پیش‌فرض را تغییر نمی‌دهد. حالت isolated فقط برای base imageهای عمومی است و به credential store کاربر وصل نمی‌شود.

ثبت موفقیت مدیریت اکنون با تغییر دامنه اتمیک است؛ شکست audit تغییر برند/دسته/موجودی را rollback می‌کند. چهار سناریوی audit در مجموعهٔ۳۱ تست SQL این رفتار و حفظ rowversion را بررسی کردند. audit دامنه و مدیریت کارکنان همچنان باقی است.

رزرو داخلی موجودی، انقضا/تخصیص/لغو/ارسال و آزمون همزمانی SQL در [راهنمای رزرو](docs/INVENTORY-RESERVATIONS.md) شرح داده شده‌اند؛ checkout و پرداخت واقعی هنوز فعال نیستند.

API سبد مهمان/عضو، ادغام یک‌باره و BFF خصوصی در [راهنمای سبد سروری](docs/SERVER-CART.md) آماده و آزموده‌اند؛ رابط سبد و نشست مشتری هم متصل‌اند؛۱۱ سناریوی مرورگر با SQL و مشتری موقت واقعی پاس شده‌اند.

محاسبهٔ سروری خرید و checkout دو زبانه اکنون به SQL وصل‌اند؛۱۷ HTTP و۱۰ SQL تازه، replay/expiry/قواعد روش و طرح و مبلغ دقیق چک را آزموده‌اند. مالیات/ارسال هنوز تعیین نشده و سفارش/پرداخت فعال نیست. مرز و ادامه در [docs/CHECKOUT-QUOTES.md](docs/CHECKOUT-QUOTES.md) است.

سیاست اولیهٔ ارسال/مالیات و صفحهٔ مالی پنل به quote وصل‌اند؛ مالیات داخل قیمت دوباره دریافت نمی‌شود. QA با حساب مالی موقت و MFA واقعی تا SQL/checkout موفق و پاک‌سازی شد. هزینه‌های فروشگاه اصلی هنوز تعیین نشده‌اند؛ [docs/CHECKOUT-CHARGES.md](docs/CHECKOUT-CHARGES.md) مرز و ادامه را ثبت می‌کند.

مسیر آفلاین جدید snapshot مالی کامل را نمی‌خواند؛ query عمومی محدود و۱۶ HTTP تازه روی build مستقل پذیرفته شدند. اجرای SQL/انتشار اصلی هنوز باقی است؛ [docs/OFFLINE-PROJECTION.md](docs/OFFLINE-PROJECTION.md).

سایت‌مپ/robots در سورس جدید فقط count و صفحهٔ۱۰۰۰ کلید عمومی را می‌خوانند؛ فایل‌های ریشه، زبان واقعی و گیت preview حفظ شده‌اند.۲۹ HTTP build واقعی موفق و SQL/انتشار اصلی باقی است؛ [docs/SITEMAP-PROJECTION.md](docs/SITEMAP-PROJECTION.md). فهرست آفلاین نیز projection محدود مستقل دارد؛ [docs/OFFLINE-PROJECTION.md](docs/OFFLINE-PROJECTION.md).

تاریخچهٔ فیزیکی انبار در سورس جدید از سقف۱۰۰ رویداد به صفحه‌بندی۵۰تایی سرور با فیلتر تنوع/جهت/زمان منتقل شد؛۵ contract پنل و۱۵ QA مستقل کامپوننت موفق، دو SQL تازه فقط compile و نسخهٔ زنده تغییر نکرده است. [docs/INVENTORY-HISTORY.md](docs/INVENTORY-HISTORY.md).

صفحهٔ موجودی و داشبورد در سورس جدید از snapshot کامل Catalog/Stock جدا شدند: صفحهٔ۵۰ تنوع و موجودی همان شناسه‌ها، تنوع بدون Stock، جست‌وجو/فعالیت، lookup و summary مستقل.در همان برش۱۰ contract پنل و۱۴ QA فقط خواندنی موفق؛ SQL۷۳ تازه اجرا نشده و نسخهٔ زنده تغییر نکرده است. [docs/INVENTORY-PAGING.md](docs/INVENTORY-PAGING.md).

مدیریت کالا در سورس به فهرست۵۰تایی و جزئیات تک‌کالا منتقل شد؛ پنل متادیتا را بدون graph کامل می‌گیرد و انتخاب‌گر CMS انتخاب‌های مفقود/خارج صفحه و ترتیب را حفظ می‌کند.۱۶ contract،۷ wire واقعی ASP.NET→TypeScript و۲۳ QA محدود کامپوننت موفق‌اند؛ ویرایش/MFA/ذخیرهٔ CMS و SQL۷۳ هنوز پذیرفته نشده‌اند و main تغییر نکرد. [docs/ADMIN-PRODUCTS.md](docs/ADMIN-PRODUCTS.md).

کد پشتیبان و بازیابی MFA کارکنان در سورس اضافه شد؛ پس از مصرف کد، نشست‌های قدیمی باطل و Authenticator تازه اجباری است. ورود فقط با رمز در وضعیت بازیابی اجازهٔ ثبت کلید نمی‌دهد.۲۰ contract،۱۰ wire native،۱۴ QA محدودِ رد auth و۳۱۱ واحد موفق‌اند؛ SQL۷۸ فقط discovery شده و۱۹ مورد تازه اجرا نشده‌اند. اصلی۱۷ است و runtime تازه پیش از migration۱۸/۱۹ اجرا نمی‌شود. [docs/MFA-RECOVERY.md](docs/MFA-RECOVERY.md).

مدیریت کارکنان در سورس، فهرست/تاریخچهٔ۵۰تایی، نقش‌های server-driven و افزودن از حساب فعالِ تأییدشده با رمز دارد؛ تغییر دسترسی، نشست‌ها را با audit اتمیک باطل می‌کند و تغییر حساب خود مدیر بسته است.۳۳۵ واحد/۲۶ contract/۱۴ wire و۲۴ QA محدود نمونه موفق؛ شش SQL تازه فقط compile و کل۸۴ با۲۵ اجرا‌نشده است. هیچ تغییر واقعی کارکنان در fixture انجام نشده، دعوت/ثبت‌نام/provider و پذیرش متصل باقی است. [docs/STAFF-ADMINISTRATION.md](docs/STAFF-ADMINISTRATION.md).

بخش منتخب مدیر در [لحظهٔ سایمان فارسی](http://127.0.0.1:3000/fa/moments) و [English](http://127.0.0.1:3000/en/moments) به SQL محلی متصل است؛ [MOMENTS](docs/MOMENTS.md) قرارداد انتخاب/زمان/نمونه و حدود visual را دارد. اسناد اصلی در پنل3173 از بخش محتوا قابل مدیریت‌اند.

API/SQL بازار در [MARKET-CATALOG](docs/MARKET-CATALOG.md) مستند است؛۴۵۱ واحد، مجموعهٔ کامل۱۴۲ SQL و یک SQL نمونهٔ Development جدا موفق‌اند. مسیر و PID artifact API پذیرفته‌شده در tmp/api-runtime-current.json ثبت می‌شود؛ برای serve آن از backend-local.py --runtime-dir و برای migrate/seed صریح از سورس بدون این گزینه استفاده می‌شود.۳ نمونهٔ بازار، SKU/Stock و مبلغ قابل پرداخت ندارند؛ هنوز صفحهٔ بازار و CSV به رابط افزوده نشده‌اند.
