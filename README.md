# فروشگاه سایمان

فروشگاه دوزبانهٔ فارسی و انگلیسی، پنل مدیریت مستقل و API ماژولار متصل به SQL Server. [وضعیت جاری](docs/STATE.md)، [صف کارها](docs/PLAN.md) و [شاخص تصمیم‌ها](docs/DECISIONS-INDEX.md) مرجع ادامهٔ پروژه‌اند.

## اجرای محلی

طبق D44، سایمان یک مجموعهٔ محلی با دیتابیس `Sayman` دارد.

| بخش                   | نشانی                                                                   |
| --------------------- | ----------------------------------------------------------------------- |
| فروشگاه               | [فارسی](http://127.0.0.1:3000/fa) · [English](http://127.0.0.1:3000/en) |
| پنل مدیریت            | [پورت ۳۱۷۳](http://127.0.0.1:3173/)                                     |
| سلامت API و اتصال SQL | [پورت ۵۰۸۰](http://127.0.0.1:5080/health/ready)                         |
| SQL Server            | `127.0.0.1:11433` · `Sayman`                                            |

### اجرای دوبارهٔ نسخهٔ ثبت‌شده

Docker Desktop را باز کنید. اگر کانتینر SQL متوقف است، در پوشهٔ پروژه فقط سرویس SQL را بالا بیاورید.

```sh
cd '/Users/jahangiri/ shop'
docker compose --profile backend up -d --wait --no-recreate sqlserver
```

در سه تب ترمینال، از همان پوشه ابتدا API و سپس فروشگاه و پنل را اجرا کنید. بعد از اجرای فرمان اول، صبر کنید تا نشانی سلامت API در جدول بالا وضعیت `ready` نشان دهد.

| تب ترمینال | فرمان                                      |
| ---------- | ------------------------------------------ |
| API        | `python3 scripts/serve-main-api.py`        |
| فروشگاه    | `python3 scripts/serve-main-storefront.py` |
| پنل مدیریت | `node scripts/serve-main-admin.mjs`        |

هر فرمان در تب خودش فعال می‌ماند و با `Ctrl+C` متوقف می‌شود. این مسیر بسته‌های ثبت‌شده در `tmp` و دیتابیس موجود را استفاده می‌کند. `--seed-dev` در بخش بعد فقط برای محیط تازه است. برای ورود به پنل، رمز فعلی حساب مدیر و کد Authenticator را وارد کنید.

اگر صفحهٔ سلامت `503` داد، با `docker compose --profile backend ps -a sqlserver` وضعیت SQL را ببینید. سیاست Docker محلی پس از خروج ناموفق SQL تا سه بار راه‌اندازی دوباره را امتحان می‌کند.

### راه‌اندازی محیط تازه

به Node.js 22.18 یا جدیدتر، .NET 10 SDK، Python 3 و Docker Compose نیاز است.

```sh
npm ci
npm ci --prefix tools/lint --ignore-scripts
python3 scripts/init-local-env.py
docker compose --profile backend up -d --wait sqlserver
dotnet restore backend/src/Shop.Api --locked-mode
dotnet build backend/src/Shop.Api --no-restore --disable-build-servers -m:1
python3 scripts/backend-local.py --seed-dev
```

`--seed-dev` برای آماده‌سازی دیتابیس تازه در Development است. فایل `.env` برای محیط محلی ساخته می‌شود و حاوی اطلاعات محرمانه است. در محیط تازه ورود اولیه با حساب `admin` و رمز اولیهٔ خصوصی انجام می‌شود. ورودهای بعدی از رمز فعلی و Authenticator همان حساب استفاده می‌کنند.

API، فروشگاه و پنل را در سه ترمینال روی پورت‌های جدول بالا اجرا کنید.

```sh
npm run dev:api
```

```sh
SHOP_DATA_MODE=api SHOP_API_URL=http://127.0.0.1:5080 SHOP_PUBLIC_URL=http://127.0.0.1:3000 npm run dev
```

```sh
npm run build:admin
HOSTNAME=127.0.0.1 PORT=3173 ADMIN_API_URL=http://127.0.0.1:5080 ADMIN_PUBLIC_URL=http://127.0.0.1:3173 node apps/admin/server.mjs
```

برای ساخت آفلاین رابط‌ها و جایگزینی نسخهٔ فعال، از `scripts/local/build-local-frontends.py` و مراحل `prepare` و `apply` در `scripts/publish-local-frontends.py` استفاده کنید.

## ساختار مخزن

| مسیر                                      | مسئولیت                                              |
| ----------------------------------------- | ---------------------------------------------------- |
| `apps/storefront`                         | مسیرها، رابط و BFF فروشگاه Next.js                   |
| `apps/admin`                              | پنل React/Vite و پراکسی API مدیریتی                  |
| `packages/design-tokens`                  | توکن‌های طراحی مشترک                                 |
| `packages/web-shared`                     | قراردادهای HTTP، اجزای رابط و ابزارهای مشترک         |
| `backend/src/Shop.Api`                    | نقطهٔ ترکیب برنامه، مسیرها و سیاست‌های دسترسی        |
| `backend/src/Shop.Modules.*`              | منطق دامنه، قرارداد، داده و مهاجرت‌های هر ماژول      |
| `backend/tests`                           | آزمون‌های واحد و آزمون یکپارچه با SQL Server         |
| `scripts/tests`                           | آزمون‌های ابزارهای عملیات و انتشار                   |
| `backend/Seed` و `database`               | دادهٔ صریح توسعه و سرویس و خروجی‌های SQL Server      |
| `scripts`، `deploy` و `.github/workflows` | ابزار توسعه و عملیات، بسته‌بندی و CI                 |
| `tools`                                   | بررسی کیفیت و ابزارهای صریح دادهٔ توسعه              |
| `data` و `design`                         | منابع داده و فایل‌های مرجع طراحی و برند              |
| `tmp` و `artifacts`                       | بسته‌های اجرای محلی و بازگشت، شواهد و خروجی بررسی    |
| `docs` و `skills/dynamic-shop`            | نیازمندی‌ها، قراردادها، راهنمای عملیات و قواعد پروژه |

مبلغ در دامنه و SQL به‌صورت عدد صحیح ریال و در JSON به‌شکل رشتهٔ ده‌دهی نگه‌داری می‌شود. هر ماژول مالک دادهٔ خودش است و تبادل بین ماژول‌ها از قراردادهای مشخص انجام می‌شود. [معماری](docs/ARCHITECTURE.md) · [قرارداد API](docs/API.md)

صفحه‌های پنل در `apps/admin/src/pages`، اجزای مشترک در `apps/admin/src/components` و قراردادهای پنل در `apps/admin/src/api/contracts` هستند. فروشگاه اجزای هر حوزه را در `components` و منطقش را در `lib` گروه‌بندی می‌کند. آزمون‌های رابط‌ها در پوشهٔ `tests` هر برنامه‌اند. [نقشهٔ کامل پوشه‌ها](docs/ARCHITECTURE.md#محل-کد-هر-قابلیت)

هر رابط از سورس خودش و بسته‌های صریح `packages/web-shared` و `packages/design-tokens` ساخته می‌شود. برای خروجی جدا از `python3 deploy/package-production.py --component admin --output <new-directory>` استفاده کنید. مقدار `--component` برای سایر بسته‌ها `storefront`، `api` یا `database` است. [راهنمای استقرار](docs/DEPLOYMENT.md) · [دیتابیس](database/README.md) · [اسکریپت‌ها](scripts/README.md) · [ابزارهای توسعه](tools/README.md)

## بررسی تغییرات

```sh
npm run lint
npm run format:check
npm run typecheck
npm run typecheck:admin
npm test
npm run test:admin-contract
npm run test:admin-server
python3 -m unittest discover -s scripts
dotnet test backend/tests/Shop.Tests --disable-build-servers -m:1
```

برای آزمون SQL، ابتدا پروژهٔ آزمون را با `dotnet restore backend/tests/Shop.SqlTests --locked-mode` آماده کنید و سپس `python3 scripts/test-sql-local.py` را با SQL Server فعال اجرا کنید. آزمون از دیتابیس‌های موقت `SaymanTest_*` استفاده می‌کند و در پایان آن‌ها را جمع می‌کند. [راهنمای کیفیت کد](docs/CODE-QUALITY.md)

برای بررسی خروجی‌های قابل حذف محلی، `python3 scripts/local/cleanup-local-artifacts.py` را ابتدا بدون گزینه اجرا کنید. پس از بازبینی فهرست، `--apply` همان سیاست نگه‌داری را اعمال می‌کند. `tmp` هم خروجی ساخت دارد و هم بسته‌های فعال، نسخه‌های بازگشت و کلیدهای محلی. پاک‌سازی را با ابزار پروژه انجام دهید.

## راهنماهای مرجع

- محصول و تحویل · [سند نیازمندی‌ها](docs/PRD.md) · [چک‌لیست بخش‌ها](docs/DELIVERY-CHECKLIST.md) · [بازبینی نهایی](docs/FINAL-REVIEW.md)
- امنیت و نگه‌داری · [امنیت](docs/SECURITY.md) · [پشتیبان‌گیری و بازیابی](docs/BACKUP-RESTORE.md) · [DataGrip محلی](docs/LOCAL-DATABASE-CLIENT.md)
- استقرار · [Docker روی Linux و انتشار](docs/DEPLOYMENT.md) · [آمادگی تولید](docs/READINESS.md)
