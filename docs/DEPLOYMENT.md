# انتشار سایمان با tag، Vercel و Linux

تاریخ: 2026-10-29. مخزن: [shop_syman](https://github.com/p-jahangiri/shop_syman).

## تنظیمات انجام‌شده برای این مخزن

GitHub خصوصی روی شاخهٔ `main` متصل و push شده است. در تیم مالک، دو پروژهٔ Vercel ساخته و اتصال آن‌ها به همین GitHub تأیید شده؛ Node22 و دسترسی build به workspaceهای بیرون Root تنظیم شده‌اند:

| بخش     | پروژه                                                                               | شناسه                              | Root Directory    | دامنهٔ تخصیص‌یافته            |
| ------- | ----------------------------------------------------------------------------------- | ---------------------------------- | ----------------- | ----------------------------- |
| فروشگاه | [shop-syman](https://vercel.com/parviz21jgmailcoms-projects/shop-syman)             | `prj_rnKzD8MmUPSSNeKWFdZr5205tKOm` | `apps/storefront` | `shop-syman.vercel.app`       |
| پنل     | [shop-syman-admin](https://vercel.com/parviz21jgmailcoms-projects/shop-syman-admin) | `prj_Av5SLbbD4JZIGRudmjNRaZvkXAlW` | `apps/admin`      | `shop-syman-admin.vercel.app` |

`VERCEL_ORG_ID=team_r5gwfze48ez83lvEPUhu7Mul` و شناسهٔ هر دو پروژه و `STOREFRONT_PUBLIC_URL` در GitHub Variables ثبت شده‌اند؛ Environment با نام `production` نیز ساخته شده است. هر دو متغیر `VERCEL_DEPLOY_ENABLED` و `PRODUCTION_DEPLOY_ENABLED` فعلاً `false` هستند. envهای غیرمحرمانهٔ شناخته‌شدهٔ Production در دو پروژه ثبت شده‌اند؛ `SHOP_API_URL` و `ADMIN_API_URL` تا تعیین API واقعی عمداً مقدار ساختگی ندارند.

**این پروژه‌ها هنوز deploy نشده‌اند. مالک تأیید کرد فعلاً سرور ندارد و تنظیمات آماده بمانند؛ انتشار تا درخواست بعدی و آماده‌شدن API فعال نمی‌شود.** دامنهٔ تخصیص‌یافته به‌معنی سایت فعال نیست. موارد لازم برای فعال‌سازی: سرور واقعی API/SQL و HTTPS، ثبت URL API در هر دو پروژه، قبولی CI و health/گردش متصل، و secret `VERCEL_TOKEN` در GitHub Environment به نام `production` برای انتشار خودکار tag. ساخت و ورود token را مالک حساب انجام دهد؛ در چت ارسال نشود. این بخش برای همین حساب ثبت شده است؛ انتقال به حساب دیگر نیازمند شناسه‌های همان مقصد است.

## انتخاب فعلی: رابط روی Vercel، API و SQL روی سرور

دو پروژه از همین مخزن بسازید: فروشگاه Next.js با Root Directory برابر `apps/storefront` و پنل Vite با Root Directory برابر `apps/admin`. در هر دو، گزینهٔ **Include source files outside of the Root Directory in the Build Step** روشن باشد؛ وابستگی‌های workspace و توکن‌های طراحی در ریشهٔ مخزن‌اند. تنظیمات build/install و مسیرهای پنل در `vercel.json` هر پروژه قرار دارند.

پیکربندی آمادهٔ این راهنما رابط‌ها را روی Vercel و API/SQL را روی میزبان جدا قرار می‌دهد. Vercel اکنون [Container Runtime برای OCI](https://vercel.com/docs/functions/runtimes/container) دارد و اجرای API دات‌نت در کانتینر از نظر runtime ممکن است. این API فعلی به key ring مشترک و پایدار، گواهی رمزگذاری، SQL Server و workerهای پس‌زمینه وابسته است؛ انتقال آن به Vercel به طراحی و پذیرش ماندگاری کلیدها، اجرای کارها، migration و backup نیاز دارد. برای اجرای پیوسته نیز سرویس‌های مخصوص پلتفرم باید جدا بررسی و پیکربندی شوند. فایل‌های فعلی این انتقال را پیاده نمی‌کنند و SQL/کلیدها نباید به filesystem گذرای تابع سپرده شوند. `SHOP_API_URL` و `ADMIN_API_URL` باید آدرس واقعی HTTPS یک API در دسترس Vercel باشند؛ `localhost` و IP خصوصی مک قابل استفاده نیستند. بدون API، نمایش داده، ورود و عملیات تجاری متصل پذیرفته نیست. برای ظاهرسازی، Production را به Development یا preview تغییر ندهید و کلیدهای دیتابیس را در دو پروژهٔ رابط Vercel قرار ندهید.

در صفحهٔ [New Project تیم مالک](https://vercel.com/new?teamSlug=parviz21jgmailcoms-projects)، GitHub و سپس `p-jahangiri/shop_syman` را انتخاب کنید. پروژه‌ها را جداگانه import کنید:

| تنظیم              | فروشگاه           | پنل                |
| ------------------ | ----------------- | ------------------ |
| نام پیشنهادی       | `shop-syman`      | `shop-syman-admin` |
| Framework          | Next.js           | Vite               |
| Root Directory     | `apps/storefront` | `apps/admin`       |
| Node               | 22.x              | 22.x               |
| وابستگی بیرون Root | روشن              | روشن               |

متغیرهای **Production** فروشگاه:

```dotenv
SHOP_DATA_MODE=api
SHOP_API_URL=https://api.example.com
SHOP_ENABLE_PREVIEW=false
SHOP_PUBLIC_URL=https://shop-syman.vercel.app
SHOP_ENABLE_INDEXING=false
SHOP_PWA_ENABLED=true
```

متغیرهای **Production** پنل:

```dotenv
ADMIN_API_URL=https://api.example.com
ADMIN_PUBLIC_URL=https://shop-syman-admin.vercel.app
NODEJS_HELPERS=0
VITE_STOREFRONT_URL=https://shop-syman.vercel.app
```

دامنهٔ واقعی تخصیص‌یافته را جایگزین نمونه کنید. `VITE_STOREFRONT_URL` در زمان build وارد فایل عمومی می‌شود؛ رمز در متغیرهای `VITE_*` یا `NEXT_PUBLIC_*` قرار ندهید. API نیز باید `Cors__Origins__0` را برابر origin فروشگاه، `Cors__Origins__1` را برابر origin پنل و `Cors__AdminOrigins__0` را برابر origin پنل بشناسد. در صورت انتشار مستقیم API پشت reverse proxy، تنظیم Host و اعتماد به proxy را طبق پیکربندی همان سرور انجام دهید؛ `AllowedHosts=*` راه‌حل تنظیم اشتباه نیست.

پنل روی Vercel همان کنترل‌های BFF را از `server.mjs` به‌صورت تابع Node اجرا می‌کند. [حد بدنهٔ درخواست تابع](https://vercel.com/docs/functions/limitations) 4.5MB است و adapter این پروژه کل multipart را به۴MiB محدود می‌کند؛ overhead فرم هم جزو آن است. UI فعلی هنوز قابلیت۸MiB بک‌اند را نشان می‌دهد و سقف میزبان را نمی‌شناسد؛ این ناهماهنگی پیش از پذیرش کامل آپلود روی Vercel باید رفع شود.

برای پاسخ، سقف buffered را از [پاسخ stream‌شده](https://github.com/vercel/vercel-plugin/blob/main/skills/vercel-functions/SKILL.md#request-and-response-payloads) جدا کنید: streaming از سقف۴٫۵MB بدنه مستثناست، ولی محدودیت زمان تابع و سقف‌های برنامه باقی‌اند. proxy فعلی برای بعضی مسیرها از `remote.pipe(response)` استفاده می‌کند؛ دانلود و تصویر بزرگ روی Vercel هنوز end-to-end آزموده و پذیرفته نشده‌اند.

Vercel از [WebSocket](https://vercel.com/docs/functions/websockets) پشتیبانی می‌کند؛ اتصال در پایان حداکثر عمر تابع بسته می‌شود و کلاینت باید reconnect کند. ارتباط فعلی پنل Long Polling می‌ماند و پذیرش عملیاتی آن روی Vercel هنوز انجام نشده است. پذیرش Docker یا آزمون محلی، نتیجهٔ اجرای واقعی آپلود، نشست یا ارتباط زنده روی Vercel را ثابت نمی‌کند.

## انتشار فقط با tag

پس از آماده‌شدن مقصد و secretها، از کد بازبینی‌شده و commitشده در `main` نسخه بسازید:

```sh
git add .
git commit -m "Prepare release"
git push origin main
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0
```

برای نسخهٔ بعد `v1.0.1` بسازید. tag منتشرشده را جابه‌جا یا بازنویسی نکنید. Push روی `main` و PR تست دارند؛ workflow انتشار فقط tag نهایی `vMAJOR.MINOR.PATCH` را می‌پذیرد. نسخهٔ prerelease از این مسیر Production منتشر نمی‌شود.

انتشار ابتدا CI رابط و بک‌اند/SQL واقعی را می‌گذراند؛ سپس سه image برای `linux/amd64` می‌سازد و با شناسهٔ مخزن به GHCR می‌فرستد. بستهٔ انتشار، commit و digest دقیق هر image را ثبت می‌کند. میزبان image را با digest اجرا می‌کند؛ تگ متغیر `latest` مبنای اجرا نیست. [مستند انتشار image در GitHub](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images).

### اتصال GitHub Actions به Vercel

Environment به نام `production` در مخزن بسازید. شناسهٔ team و هر دو project را از Settings همان پروژه‌های Vercel بردارید. متغیرهای repository عبارت‌اند از `VERCEL_DEPLOY_ENABLED=true`، `VERCEL_ORG_ID`، `VERCEL_STOREFRONT_PROJECT_ID`، `VERCEL_ADMIN_PROJECT_ID` و `STOREFRONT_PUBLIC_URL`. متغیرها و secretهای دقیق workflow در `.github/workflows/vercel-release.yml` تعریف شده‌اند. `VERCEL_TOKEN` در Secrets محیط `production` ثبت شود و فقط مرحله‌های نیازمند احراز هویت به آن دسترسی دارند؛ در کد، خروجی CI یا چت قرار نگیرد. ساخت token و واردکردن آن را مالک حساب انجام دهد. token در آرگومان CLI قرار نمی‌گیرد و هنگام نصب وابستگی‌ها یا build به environment برنامه داده نمی‌شود. تا زمانی که مقصد فعال و شناسه‌ها تنظیم نشده‌اند، job انتشار Vercel نباید فعال شود.

اگر انتشار با Actions را انتخاب کردید، انتشار خودکار branch از یکپارچگی Git Vercel خاموش بماند تا هر push به `main` مستقل از tag به Production نرود. فایل‌های `vercel.json` این مرز را مشخص می‌کنند. اولین import و یک build موفق به‌تنهایی پذیرش API و گردش تجاری نیست.

## API جدا برای رابط‌های Vercel

وقتی سرور API آماده شد، حالت جایگزین `compose.api.production.yaml` فقط API و Nginx را اجرا می‌کند. آن را هم‌زمان با Compose کامل اجرا نکنید؛ هر دو یک project تولید دارند. SQL همچنان خارجی است. از تنظیمات [deploy/.env.api.production.example](../deploy/.env.api.production.example) استفاده کنید و فایل خصوصی `shared/api-production.env` با مجوز0600 بسازید. `API_DOMAIN` دامنهٔ API، `STOREFRONT_ORIGIN` و `ADMIN_ORIGIN` دامنه‌های دقیق Vercel، و `API_IMAGE` همان `images.api` از `release.json` نسخهٔ تست‌شده است. TLS این حالت فقط باید دامنهٔ API را پوشش دهد. PFX و key ring و backup hook مانند مسیر کامل پایین لازم‌اند.

در پوشهٔ استخراج‌شدهٔ bundle روی Linux:

```bash
set -euo pipefail
python3 scripts/production_release.py prepare-api /opt/sayman
api_compose() {
  docker compose --project-name sayman-production \
    --env-file /opt/sayman/shared/api-production.env \
    --env-file /opt/sayman/shared/api-release.env \
    -f compose.api.production.yaml "$@"
}
api_compose config --quiet
api_compose pull
api_compose run --rm --no-deps -T nginx nginx -t
api_compose stop --timeout 60 nginx api
/opt/sayman/shared/pre-migrate-backup "$PWD"
ConnectionStrings__Shop=$(python3 scripts/production_release.py value /opt/sayman/shared/api-production.env MIGRATION_CONNECTION_STRING) \
  api_compose run --rm --no-deps -T api --migrate
api_compose up -d --wait --wait-timeout 240
```

سپس `https://YOUR_API_DOMAIN/health/ready` باید200 بدهد و آدرس همین API در Production هر دو پروژهٔ Vercel ثبت و دوباره deploy شود. مقدار bootstrap فقط برای فرمان یک‌باره استفاده شود؛ دستور دقیق و شروط حساب نخست در راهنمای backend آمده است. این حالتِ ترکیبی آماده‌سازی شده است؛ job خودکار SSH فعلی Compose کامل را منتشر می‌کند. روی API-only، تا تعریف گردش اختصاصی سرور، ارتقا را با همین فرمان‌های کنترل‌شده و backup نسخه‌دار انجام دهید. شکست بعد از stop/migration نیازمند بررسی اپراتور است؛ image قدیمی خودکار شروع نمی‌شود.

## انتشار کامل روی Linux با Docker

این مسیر مستقل از Vercel است: Nginx روی80/443، فروشگاه، پنل و API در شبکهٔ داخلی Compose؛ SQL Server جداگانه و پایدار است. پورت API یا SQL عمومی نمی‌شود. از `compose.production.yaml` به‌تنهایی استفاده کنید؛ آن را با Compose توسعه ترکیب نکنید.

پیش‌نیاز میزبان: Linux x86_64، Docker Engine و Compose جدید با `--wait`، Python3، `curl`، `flock`، `timeout` و `sha256sum`، DNS دو دامنه، TLS معتبر برای هر دو، SQL Server2022/2025 با مجوز متناسب Production، فضای کافی برای imageها و بکاپ. SQL Developer مخصوص توسعه است. سیستم‌عامل و بسته‌ها را طبق [راهنمای رسمی Docker Engine](https://docs.docker.com/engine/install/ubuntu/) نصب کنید.

### آماده‌سازی یک‌بارهٔ میزبان

با کاربر استقرار اختصاصی:

```sh
sudo install -d -m 0750 -o "$USER" -g "$USER" /opt/sayman
install -d -m 0700 /opt/sayman/shared /opt/sayman/releases /opt/sayman/deployments
install -d -m 0700 /opt/sayman/shared/tls /opt/sayman/shared/identity-keys
```

عضویت کاربر در گروه Docker اختیار بسیار بالایی روی همان میزبان می‌دهد؛ کلید deploy را به همین ماشین و مخزن محدود نگه دارید. فایل [deploy/.env.production.example](../deploy/.env.production.example) را به `/opt/sayman/shared/production.env` کپی و با مقادیر واقعی کامل کنید؛ مجوز فایل0600 باشد. `production.env` فقط برای interpolation و آماده‌سازی است؛ helper فایل `runtime.env` را بدون حساب migration تولید می‌کند. از `docker compose config` بدون `--quiet` در لاگ عمومی استفاده نکنید، چون مقدار رمزها را نمایش می‌دهد. [قواعد interpolation در Compose](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation).

SQL را از قبل ایجاد کنید. حساب runtime فقط مجوز دادهٔ لازم را داشته باشد؛ حساب migration مجوز ایجاد/تغییر schema دارد. هر دو connection string باید `Encrypt=True;TrustServerCertificate=False` و نام میزبان منطبق با گواهی SQL داشته باشند. migrationها با همان image نسخه و فرمان `--migrate` اجرا می‌شوند؛ شروع عادی API خودکار migrate یا seed نمی‌کند.

کلید امضای Auth را مستقل از مک و با حداقل۶۴بایت تصادفی بسازید. گواهی رمزگذاری Data Protection را طبق [راهنمای backend](../deploy/backend/README.md) تولید کنید. فایل PFX در `/opt/sayman/shared/identity-encryption.pfx`، رمز آن در فایل خصوصی محیط، و key ring پایدار در `shared/identity-keys` قرار می‌گیرند. پوشهٔ کلید و PFX باید برای کاربر `app` داخل image خواندنی/نوشتنیِ لازم باشند؛ UID image را بررسی کنید. نگهداری دیتابیس بدون همین key ring و PFX و رمز آن بازیابی مدارک، MFA و دادهٔ رمزگذاری‌شده را ممکن نمی‌کند.

برای TLS، گواهی معتبر شامل هر دو نام در `shared/tls/fullchain.pem` و کلید آن در `shared/tls/privkey.pem` بگذارید. این مسیر mount پایدار است؛ پوشه‌های symlinkدار Certbot را بدون targetهایشان کپی نکنید. تمدید certificate و reload سرویس Nginx را روی میزبان زمان‌بندی و انقضا را پایش کنید. گواهی Data Protection با گواهی HTTPS متفاوت است.

در `NGINX_IMAGE` یک image رسمی Nginx Alpine با digest واقعی ثبت کنید؛ placeholder نمونه قابل اجرا نیست:

```sh
docker buildx imagetools inspect nginx:stable-alpine
```

Digest انتخابی را در محیط نگه دارید. اتصال GHCR خصوصی روی سرور با credential فقط `read:packages` انجام شود؛ token را از stdin به `docker login ghcr.io --username YOUR_GITHUB_USER --password-stdin` بدهید.

### بکاپ پیش از migration

فایل اجرایی `/opt/sayman/shared/pre-migrate-backup` را بسازید. اسکریپت deploy پس از توقف نویسنده‌ها و پیش از migration آن را با timeout اجرا می‌کند. hook باید فقط پس از بکاپ معتبر SQL، key ring، PFX و ذخیره‌ساز فایل‌ها با exit0 برگردد؛ stub شامل `exit 0` بکاپ نیست. ابزار SQL ممکن است روی میزبان DB اجرا شود؛ مسیر فایل بکاپ در فرمان SQL متعلق به سرور SQL است.

نمونهٔ بخش SQL برای اجرا توسط اپراتور با حساب backup و مسیر مجاز سرور SQL:

```sql
DECLARE @BackupPath nvarchar(4000) =
  N'/var/opt/mssql/backup/Sayman-' + CONVERT(nvarchar(36), NEWID()) + N'.bak';
BACKUP DATABASE [Sayman]
  TO DISK = @BackupPath WITH COPY_ONLY, CHECKSUM;
RESTORE VERIFYONLY FROM DISK = @BackupPath WITH CHECKSUM;
SELECT @BackupPath AS BackupPath;
```

در hook واقعی نام یکتای هر نسخه، کپی offsite، snapshot نسخه‌دار object storage و archive رمزگذاری‌شدهٔ کلیدها لازم‌اند. `VERIFYONLY` جای تمرین restore روی محیط مستقل کوتاه‌عمر را نمی‌گیرد. نمونهٔ ابزار بکاپ توسعه در [BACKUP-RESTORE](BACKUP-RESTORE.md) نباید بدون بررسی محدوده روی Production اجرا شود. این تغییرات، زمان‌بندی یا offsite واقعی را فعال نمی‌کنند.

### اتصال GitHub به Linux

برای Environment `production` در GitHub، کلید SSH اختصاصی در secret `SSH_PRIVATE_KEY` و خروجی معتبر host key در `SSH_KNOWN_HOSTS` قرار دهید. fingerprint سرور را از کانال مستقل تطبیق دهید؛ صرف `ssh-keyscan` روی همان اتصال اثبات هویت نیست. Variables مقصد شامل `SSH_HOST`، `SSH_USER`، `SSH_PORT` و `DEPLOY_ROOT=/opt/sayman` هستند. مقدار `STOREFRONT_PUBLIC_URL` در repo برابر URL عمومی فروشگاه باشد؛ این مقدار در build پنل استفاده و با دامنهٔ سرور تطبیق داده می‌شود. فعال‌سازی نهایی با `PRODUCTION_DEPLOY_ENABLED=true` است.

بستهٔ انتشار به پوشهٔ یکتای release منتقل می‌شود؛ checksum، manifest، تنظیمات، دسترسی فایل‌ها و TLS بررسی می‌شوند. سپس imageها pull، Nginx preflight، توقف برنامه‌ها، backup، migration، شروع با `--wait` و HTTP200 روی HTTPS فروشگاه و پنل انجام می‌شوند. موفقیت فقط پس از این مراحل `current` را جابه‌جا می‌کند. هنگام migration قطعی کوتاه داریم؛ استقرار بدون توقف ادعا نیست.

بسته را می‌توان دستی نیز اجرا کرد:

```sh
cd /opt/sayman/releases/RELEASE_DIRECTORY
bash scripts/deploy-production.sh /opt/sayman --validate-only
bash scripts/deploy-production.sh /opt/sayman
```

### نخستین مدیر Production

پس از migration و پیش از استفادهٔ عمومی، فرمان صریح `--bootstrap-admin` را طبق [راهنمای backend](../deploy/backend/README.md) با نام کاربری و رمز اولیهٔ خصوصی اجرا کنید. این فرمان seed کاتالوگ یا حساب Development نمی‌سازد و رمز مدیر موجود را تغییر نمی‌دهد. حساب جدید باید در ورود نخست رمز اولیه را عوض و MFA را تکمیل کند؛ رمز را در آرگومان خط فرمان یا فایل commitشده نگذارید. پس از اجرا ورودی bootstrap را حذف کنید. نمونهٔ اجرای یک‌باره برای Compose کامل، از داخل پوشهٔ release:

```bash
read -r -p 'First admin username: ' Bootstrap__AdminUserName
read -r -s -p 'Initial password (16+ chars): ' Bootstrap__AdminPassword
printf '\n'
export Bootstrap__AdminUserName Bootstrap__AdminPassword
docker compose --project-name sayman-production \
  --env-file /opt/sayman/shared/production.env --env-file ./release.env \
  -f compose.production.yaml run --rm --no-deps -T \
  -e Bootstrap__AdminUserName -e Bootstrap__AdminPassword api --bootstrap-admin
unset Bootstrap__AdminUserName Bootstrap__AdminPassword
```

برای حالت API-only، دو env-file و فایل Compose همین دستور را با مقادیر بخش «API جدا» جایگزین کنید. رمز واردشده در history فرمان قرار نمی‌گیرد؛ آن را در log یا output چاپ نکنید.

### شکست، بازگشت و پایش

پس از ورود به مرحلهٔ maintenance، شکست backup/migration/health باعث بسته‌ماندن برنامه‌ها و ثبت مرحله در `deployments/*.state` می‌شود. اطلاعات نسخهٔ قبل نگه داشته می‌شود؛ downgrade خودکار دیتابیس یا اجرای کورکورانهٔ image قدیمی وجود ندارد. ابتدا log و وضعیت migration را بررسی کنید. اگر schema با نسخهٔ قبل سازگار است، با bundle همان نسخه و فرایند استقرار کنترل‌شده بازگردید؛ در غیر این صورت دیتابیس و key ring/object storage هم‌زمان از بکاپ همان نقطه بازیابی شوند. هرگز برای rollback از `docker compose down -v` یا حذف پوشهٔ shared استفاده نکنید.

برای مشاهدهٔ وضعیت، از bundle متصل به `/opt/sayman/current` و همان envهای release استفاده کنید. health زنده‌بودن process با سلامت SQL و schema متفاوت است؛ API probe readiness دقیق schema را می‌سنجد. alert بیرونی HTTPS، انقضای TLS، فضای دیسک، بکاپ، خطای ورود و خطای worker باید روی میزبان واقعی تنظیم شوند. این مخزن مانیتورینگ فعال خارجی یا تضمین کارکرد تجاری ایجاد نمی‌کند. تنظیم trusted proxy و نرخ محدودسازی IP در API نیز باید روی معماری میزبان واقعی بررسی شود؛ ارسال X-Forwarded-For به‌تنهایی باعث اعتماد API به آن نمی‌شود و ممکن است نرخ مشترک برای کاربران پشت BFF اعمال شود.

## مرز آماده‌سازی و پذیرش

درگاه، SMS، ایمیل، هلو و سیاست تجاریِ تعیین‌نشده خودکار فعال نمی‌شوند. `Media__Storage=Disabled` و `Files__Storage=Disabled` به‌معنی غیرقابل استفاده بودن آپلود/رسانهٔ وابسته‌اند؛ برای فعال‌سازی، S3 واقعی HTTPS و scanner معتبر با مجوز/bucketهای مجزا لازم است. دادهٔ نمونهٔ Sayman محلی با انتشار سورس به دیتابیس Production منتقل نمی‌شود. قابلیت دیجیتال A102 و سایر موارد باز طبق [STATUS](STATUS.md) همچنان بازند.

اجرای CI روی GitHub، ساخت کامل Linux، استقرار و پذیرش Vercel/سرور فقط با شواهد همان اجرا پذیرفته‌اند؛ بررسی syntax یا تست macOS معادل آن‌ها نیست. وضعیت دقیق تحویل در STATUS ثبت می‌شود.
