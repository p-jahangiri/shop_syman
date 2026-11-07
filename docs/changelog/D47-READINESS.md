# اصلاح سلامت نسخهٔ۸۳ — تاریخچهٔ پیش از D47

## تغییر

در این اصلاح، `tmp/api-runtime-current.json` بستهٔ مستقل readiness83 را انتخاب کرد؛ restart `python3 scripts/serve-main-api.py`، session89311/PID98964 در زمان ثبت. این runtime اکنون rollback پیش از D47 است؛ نسخهٔ فعال۸۵ در بخش D47 شرح داده شده است. فایل محیط و DataProtection keyring قبلی محفوظ‌اند؛ privateFiles همچنانDisabled و workerاعلان داخلی گوشی طبق D44 روشن است. 0migration/seed یاDockerrestart در این اصلاح سلامت انجام شد و descriptorهای storefront/admin دقیقاً ثابت ماندند.

## فعال‌شده روی

API محلی ۵۰۸۰، سازگار با schema ۸۳ آن دوره.

## تأیید‌شده

فقط healthroutes درProgram نسبت به frozenintegrated2 تغییر کردند: تطبیق exacthistory هر12ماژول،503 قطعSQL،no-store/noindex.25SQL واقعی و1172unit همان14DLL پاس؛ 881آزمونSQL کشف شده ولی full881تازه اجرا نشده است.12HTTP اصلی شامل live/ready باheaderدقیق،401سه‌مسیر خصوصی،FA/ENmarket/account/moments وادمین پاس. `readiness-schema-source-acceptance.json`، `readiness-main-release.json` و [READINESS](../READINESS.md) مرجع‌اند. شواهد856SQL زیر مربوط به coreقبلی است، نه full881 تازه. اصلاح عملیاتی Linux/تمرینrestore هنوز پذیرفته نیست.

## تأیید‌نشده یا باز

حدود بررسی و موارد باز در سابقه آمده‌اند. این مدخل پذیرش تازه‌ای برای محیط تولید یا گردش‌های آزموده‌نشده ثبت نمی‌کند.

## شواهد

ارجاع‌های ثبت‌شده در سابقهٔ همین فایل.

## سابقهٔ منتقل‌شده

## اصلاح سلامت نسخهٔ۸۳ — تاریخچهٔ پیش از D47

در این اصلاح، `tmp/api-runtime-current.json` بستهٔ مستقل readiness83 را انتخاب کرد؛ restart `python3 scripts/serve-main-api.py`، session89311/PID98964 در زمان ثبت. این runtime اکنون rollback پیش از D47 است؛ نسخهٔ فعال۸۵ در بخش D47 شرح داده شده است. فایل محیط و DataProtection keyring قبلی محفوظ‌اند؛ privateFiles همچنانDisabled و workerاعلان داخلی گوشی طبق D44 روشن است. 0migration/seed یاDockerrestart در این اصلاح سلامت انجام شد و descriptorهای storefront/admin دقیقاً ثابت ماندند.

فقط healthroutes درProgram نسبت به frozenintegrated2 تغییر کردند: تطبیق exacthistory هر12ماژول،503 قطعSQL،no-store/noindex.25SQL واقعی و1172unit همان14DLL پاس؛ 881آزمونSQL کشف شده ولی full881تازه اجرا نشده است.12HTTP اصلی شامل live/ready باheaderدقیق،401سه‌مسیر خصوصی،FA/ENmarket/account/moments وادمین پاس. `readiness-schema-source-acceptance.json`، `readiness-main-release.json` و [READINESS](../READINESS.md) مرجع‌اند. شواهد856SQL زیر مربوط به coreقبلی است، نه full881 تازه. اصلاح عملیاتی Linux/تمرینrestore هنوز پذیرفته نیست.

