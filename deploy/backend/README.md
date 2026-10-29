# پیکربندی API در Production

راهنمای انتشار اصلی در `docs/DEPLOYMENT.md` قرار دارد. این فایل قرارداد عملیاتی backend را توضیح می‌دهد؛ هیچ فرمان آن روی نسخهٔ محلی اجرا نمی‌شود.

image از .NET 10 با digest ثابت و NuGet lock ساخته می‌شود و با کاربر `app`، UID `1654`، روی پورت داخلی `8080` اجرا می‌شود. دستورهای یک‌باره از همان image نسخهٔ مورد انتشار استفاده می‌کنند.

## تنظیمات لازم

- `ASPNETCORE_ENVIRONMENT=Production`
- `ConnectionStrings__Shop`: اتصال SQL Server با رمز واقعی، `Encrypt=True` و گواهی معتبر سرور. دسترسی runtime را از دسترسی migration جدا کنید؛ رمز migrator در env سرویس دائمی نماند.
- `Auth__SigningKey`: کلید تصادفی با حداقل ۶۴ بایت UTF-8؛ مثلاً خروجی `openssl rand -hex 64`. مقدار در Git یا log ثبت نشود.
- `Auth__Issuer` و `Auth__Audience`: بین نسخه‌ها ثابت بمانند.
- `DataProtection__KeyDirectory=/var/lib/sayman/keys`: bind/volume ماندگار و قابل‌نوشتن برای UID `1654`.
- `DataProtection__CertificatePath=/run/secrets/identity-encryption.pfx` و `DataProtection__CertificatePassword`: PFX شامل private key و mount فقط‌خواندنی.
- `AllowedHosts` و آرایه‌های `Cors__Origins__0`، `Cors__AdminOrigins__0`: نام میزبان داخلی API و دامنه‌های واقعی، بدون wildcard عمومی. Origin مرورگر و سرآیند `X-Sayman-Admin` در BFF/proxy حفظ شوند.

برای ساخت اولیهٔ گواهی روی سرور اجرا کنید:

```bash
bash deploy/backend/create-dp-certificate.sh /opt/sayman/shared
sudo chown 1654:1654 /opt/sayman/shared/identity-encryption.pfx
sudo chmod 0400 /opt/sayman/shared/identity-encryption.pfx
sudo install -d -o 1654 -g 1654 -m 0700 /opt/sayman/shared/identity-keys
```

این گواهی برای رمزگذاری key ring است و جای گواهی HTTPS دامنه را نمی‌گیرد. رمز export را در تنظیمات محرمانهٔ سرور قرار دهید. در ارتقا دوباره گواهی نسازید. پشتیبان سازگار شامل SQL، objectها، key ring، خود PFX و رمز آن است؛ گم‌شدن کلیدها می‌تواند خواندن داده‌های خصوصی قبلی را ناممکن کند. گواهی تاریخی را تا بازیابی کامل داده‌های وابسته نگه دارید؛ تعویض گواهی بدون پشتیبانی خواندن کلیدهای قدیمی در این نسخه فراهم نشده است.

## migration و حساب مدیر نخست

فرمان `dotnet Shop.Api.dll --migrate` تمام ۱۲ ماژول را به‌ترتیب migration می‌دهد و search fieldها را ترمیم می‌کند؛ startup عادی migration اجرا نمی‌کند. با Compose که ENTRYPOINT را حفظ می‌کند، آرگومان انتهایی فقط `--migrate` است. ابتدا سرویس‌های نویسنده را متوقف کنید، SQL backup را با `CHECKSUM` بگیرید، `RESTORE VERIFYONLY ... WITH CHECKSUM` اجرا کنید و نسخهٔ امن آن را خارج از سرور نگه دارید. سپس فرمان migration را با اتصال دارای مجوز DDL اجرا و بعد API را با اتصال runtime بالا بیاورید.

حساب نخست یک فرمان صریح جداگانه دارد:

```text
dotnet Shop.Api.dll --bootstrap-admin
```

تنها هنگام اجرای این فرمان، متغیرهای `Bootstrap__AdminUserName` و `Bootstrap__AdminPassword` را به process بدهید؛ رمز حداقل ۱۶ کاراکتر و مطابق قواعد Identity شامل حروف بزرگ/کوچک، عدد و نماد باشد. `Bootstrap__AdminDisplayName` اختیاری است. رمز را در argv، فایل release، secret دائمی CI یا env سرویس عادی نگذارید. فرمان باید تنها آرگومان برنامه باشد و پس از migration اجرا شود.

حساب با username، بدون email تأییدشدهٔ ساختگی، ایجاد می‌شود؛ ورود نخست در پنل نیازمند تغییر رمز اولیه و سپس ثبت/تأیید authenticator MFA است. اگر هر حسابی با نقش Administrator وجود داشته باشد، فرمان بدون تغییر حساب یا credential تمام می‌شود. اگر username قبلاً موجود باشد ولی مدیر نخست هنوز ساخته نشده باشد، فرمان خطا می‌دهد؛ حساب موجود را ارتقا یا reset نمی‌کند. عملیات دارای تراکنش و قفل اختصاصی SQL است. این مسیر هیچ CMS، کالا، قیمت، stock یا policy توسعه‌ای وارد نمی‌کند.

## فایل‌ها و providerها

`Media__Storage=Disabled` و `Files__Storage=Disabled` حالت صریح عدم‌دسترسی هستند. `Filesystem` در Production ممنوع است. برای فعال‌کردن upload واقعی هر حوزه را جدا به `S3` تغییر دهید و `S3__Endpoint`، `S3__Bucket`، `S3__Region`، `S3__AccessKey` و `S3__SecretKey` آن را بدهید؛ برای نمونه `Files__S3__Endpoint`. endpoint باید HTTPS و در ریشهٔ میزبان باشد. bucketهای private document و تصویر عمومی را جدا نگه دارید. store خصوصی به public bucket یا مسیر static وصل نشود.

ClamAV واقعی با تنظیمات `Media__ClamAvHost` و `Files__ClamAvHost` (پورت پیش‌فرض ۳۳۱۰) برای upload لازم است؛ نبود scanner موفقیت جعلی تولید نمی‌کند. `Media__CleanupEnabled` را تنها پس از تنظیم و پذیرش object storage فعال کنید. SMS/OTP، email/recovery، gateway پرداخت و هلو با انتشار Docker فعال نمی‌شوند؛ قرارداد و اعتبارنامهٔ واقعی آن‌ها همچنان وابستگی بازند.

## health و بازگشت نسخه

`/health/live` فقط زنده‌بودن process است. `/health/ready` اتصال SQL، تطابق دقیق تاریخچهٔ migration هر ماژول با همین executable و آمادگی search fieldها را بررسی می‌کند. `dotnet Shop.Api.dll --health-probe` این endpoint را از داخل container می‌خواند؛ `HealthProbeUrl` فقط در صورت تغییر پورت داخلی قابل‌تنظیم است. قبولی readiness معادل پذیرش همهٔ providerها یا داشتن محتوای منتشرشده نیست.

پس از تغییر schema، بازگرداندن image قدیمی به‌تنهایی ممکن است readiness را عمداً ۵۰۳ کند. rollback باید با برنامهٔ سازگاری/restore پشتیبان سازگار انجام شود؛ migration `Down` خودکار یا حذف داده انجام ندهید. migration شکست‌خورده نیز ممکن است ماژول‌های قبلی را اعمال کرده باشد؛ تا بررسی و رفع/بازیابی، سرویس را در maintenance نگه دارید.
