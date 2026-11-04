# اجرای اسکریپت‌های migration

این فایل‌ها خروجی idempotent ابزار EF Core هستند؛ تولید فایل، اعمال آن روی دیتابیس نیست. برای bootstrap تازه همان ترتیب composition root اجرا شود:

`identity.sql → payments.sql → credit.sql → cms.sql → inventory.sql → catalog.sql → sales.sql → market.sql`

از migration کاتالوگ `20261023201055_MarketStoreAvailability`، نمای `catalog.MarketModelsV1` به قرارداد خواندنی `inventory.AvailableStockV1` وابسته است. بنابراین migration انبار `20261022113100_InventoryPublicAvailability` باید **پیش از** آن وجود داشته باشد. اجرای کامل `catalog.sql` به‌تنهایی روی دیتابیس خالی کافی نیست. ترتیب فوق در `Shop.Api/Program.cs`، `Shop.SqlTests/SqlFixture.cs` و `Shop.UiHarness/UiHarnessProgram.cs` نیز رعایت شده است.

Up کاتالوگ ستون افزایشی `HasAvailableStoreOffer` را می‌افزاید؛ معنای `IsEligible` را حفظ می‌کند. Down همان view قبلی را بدون این ستون و بدون وابستگی به Inventory بازمی‌گرداند. حذف view انبار در rollback باید پس از بازگرداندن view کاتالوگ انجام شود؛ نسخهٔ runtime باید با schema مقصد هماهنگ باشد. Down درخواست‌های تأمین/ردیف‌های سبد، دادهٔ همین قابلیت را حذف می‌کند؛ این اسکریپت‌های رو به جلو عملیات بازگردانی داده نیستند.

خواندن view مجوز نوشتن Stock یا Catalog از ماژول دیگر ایجاد نمی‌کند. هیچ اسکریپت این برش هزینهٔ ارسال، مالیات، شرایط چک یا تنظیمات provider را تعیین نمی‌کند.
