# دیتابیس سایمان

سرویس SQL Server در `compose.sqlserver.yaml` تعریف شده است. برای راه‌اندازی مستقل، مسیر فایل تنظیمات محیطی دارای `SQL_SA_PASSWORD` را به Compose بدهید.

```sh
docker compose --env-file /path/to/database.env -f database/compose.sqlserver.yaml up -d --wait
```

نام پروژهٔ Compose و volume با اجرای محلی یکپارچه مشترک است. برای اتصال API، مقدار `ConnectionStrings__Shop` را در محیط خود API تنظیم کنید. فروشگاه و پنل از طریق HTTP به API وصل می‌شوند.

`sqlserver/snapshots` خروجی‌های تاریخی SQL برای بررسی نسخه‌های قبلی است. مرجع نسخهٔ جاری طرحواره، migrationهای EF در بک‌اند است. تغییر موتور دیتابیس به پیاده‌سازی لایهٔ ذخیره‌سازی، migrationهای همان موتور و برنامهٔ انتقال و آزمون داده نیاز دارد.
