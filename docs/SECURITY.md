# امنیت پنل، فروشگاه و API — D51

این بازبینی در2026-10-29 روی پروژهٔ محلی درخواست شده است. امنیت مطلق یا «غیرقابل نفوذ» تضمین‌پذیر نیست. معیار پذیرش، رفع نقص قابل بازتولید، آزمون منفیِ مجوز/نشست/ورودی و ثبت مرزهای محیط واقعی است. سه سرویس اصلی3000/3173/5080 و SQL85 حفظ می‌شوند؛ fixture خودکار کوتاه‌عمر پس از آزمون پاک می‌شود.

## یافته‌ها و کار جاری

| حوزه | وضعیت ابتدای بازبینی | اقدام و پذیرش مورد نیاز |
|---|---|---|
| خروج و access token | refresh family باطل می‌شد؛ access تا10دقیقه با stamp معتبر می‌ماند | اتصال JWT به خانوادهٔ فعال SQL؛ آزمون خروج/refresh/replay/دو نشست مستقل |
| عمر refresh | هر چرخش7روز به عمر اضافه می‌کرد | سقف مطلق7روزِ خانواده، بدون migration |
| مجوز و MFA | policyهای حوزه‌ای و stamp/TOTP/replay موجود | اعتبارسنجی خانواده، نقش و permission جاری و MFA واقعی؛ بررسی metadata تمام endpointها |
| کوکی | HttpOnly/Strict/Secure در محیط غیرDevelopment، دو نام مجزای مشتری/پنل | prefixHost در HTTPS، pathصحیح، حذف legacy و منع کوکی تکراری/اختلاط زمینه |
| CSRF و proxy | فروشگاه Origin را چک می‌کرد؛ API رمز مشتری و proxyعمومی پنل یکدست نبودند | Origin/fetch-metadata، بستن مرز auth پنل، فیلتر کوکی/هدر/روش/حجم و فایل‌های قابل سرو |
| XSS | React و renderer تایپ‌دار؛ CSPسخت پنل؛ فروشگاه CSPنداشت | CSPnonce پویا، منع eval/JITمرورگر، nonceاسکریپت‌های JSON-LD، آزمون hydration/گردش واقعی |
| دادهٔ خصوصی | no-store و policyهای مالک/حوزه موجود؛ کلیدها و اسناد خصوصی رمز شده | پوشش cache/header/error و آزمون دسترسی ناشناس/مالک دیگر/توکن ناقص |
| وابستگی | نسخه‌های pinned/lock موجود | npm/NuGet auditتازه و CI؛ نتیجهٔ اجرا جدا ثبت شود |
| عملیات واقعی | تنها محیط HTTP محلی Development حاضر است | TLS/HSTS واقعی، دامنه و proxyهای قابل اعتماد، secrets/DBaccount کم‌دسترسی، restore/monitoring/WAF/آزمون نفوذ مستقل در استقرار واقعی؛ بدون اجرا کامل اعلام نشود |

## منابع معیار

- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)
- [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [اعتبارسنجی JWT در ASP.NET Core10](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/configure-jwt-bearer-authentication?view=aspnetcore-10.0)
- راهنمای CSPهمین Nextنصب‌شده: `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`.

جدول بالا طرح و یافتهٔ اولیه است، نه قبولی اجراشده. نتایج نهایی و محدودیت‌ها پس از آزمون در همین سند، STATUS و artifactهایsecurity51 ثبت می‌شوند. رمز، کلید، cookie و token واقعی در گزارش‌ها وارد نمی‌شوند.
