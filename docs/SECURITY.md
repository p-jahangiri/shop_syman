# امنیت پنل، فروشگاه و API — D51

این بازبینی در2026-10-29 روی پروژهٔ محلی درخواست شده است. امنیت مطلق یا «غیرقابل نفوذ» تضمین‌پذیر نیست. معیار پذیرش، رفع نقص قابل بازتولید، آزمون منفیِ مجوز/نشست/ورودی و ثبت مرزهای محیط واقعی است. سه سرویس اصلی3000/3173/5080 و SQL85 حفظ می‌شوند؛ fixture خودکار کوتاه‌عمر پس از آزمون پاک می‌شود.

## یافته‌ها و اصلاحات پیاده‌شده

| حوزه | وضعیت ابتدای بازبینی | اقدام و پذیرش مورد نیاز |
|---|---|---|
| خروج و access token | refresh family باطل می‌شد؛ access تا10دقیقه با stamp معتبر می‌ماند | اتصال JWT به خانوادهٔ فعال SQL؛ آزمون خروج/refresh/replay/دو نشست مستقل |
| عمر refresh | هر چرخش7روز به عمر اضافه می‌کرد | سقف مطلق7روزِ خانواده، بدون migration |
| مجوز و MFA | policyهای حوزه‌ای و stamp/TOTP/replay موجود | خانوادهٔ فعال SQL، نقش جاری و اثبات MFA بررسی می‌شوند؛ مجوز امضاشده فقط می‌تواند از مجوز نقش جاری کم کند، نه به آن بیفزاید. metadata تمام endpointهای ادمین آزموده شد |
| کوکی | HttpOnly/Strict/Secure در محیط غیرDevelopment، دو نام مجزای مشتری/پنل | prefixHost در HTTPS، pathصحیح، حذف legacy و منع کوکی تکراری/اختلاط زمینه |
| CSRF و proxy | فروشگاه Origin را چک می‌کرد؛ API رمز مشتری و proxyعمومی پنل یکدست نبودند | Origin/fetch-metadata، بستن مرز auth پنل، فیلتر کوکی/هدر/روش/حجم و فایل‌های قابل سرو |
| تصویر عمومی پنل | پیش‌نمایش باید از مرز عمومی مجاز عبور کند | فقط GETمسیر دقیقِ سه WebP با شناسه32hex؛ بدون انتقال کوکی/توکن، کنترل marker/MIME/ETag/SHA256/طول و8MiB/10s/8درخواست هم‌زمان. سایر مسیرهایAPI باز نمی‌شوند |
| XSS | React و renderer تایپ‌دار؛ CSPسخت پنل؛ فروشگاه CSPنداشت | CSPnonce پویا، منع eval/JITمرورگر، nonceاسکریپت‌های JSON-LD، آزمون hydration/گردش واقعی |
| دادهٔ خصوصی | no-store و policyهای مالک/حوزه موجود؛ اسناد خصوصی و دادهٔ MFA رمز شده‌اند | پوشش cache/header/error و آزمون دسترسی ناشناس/مالک دیگر/توکن ناقص؛ حفاظت کلید مادر درProduction گواهی مستقل می‌خواهد |
| وابستگی | نسخه‌های pinned/lock موجود | npm/NuGet auditتازه و CI؛ نتیجهٔ اجرا جدا ثبت شود |
| رمز عبور | Identity PBKDF2-SHA512 با100هزار تکرار |220هزار تکرار؛ hashقدیمی پس از ورود موفق به‌روزرسانی می‌شود. آزمون headerhash/rehash و هم‌هزینه‌بودن hashمصنوعی حساب ناشناخته؛ رمز مالک تغییر نمی‌کند |
| عملیات واقعی | تنها محیط HTTP محلی Development حاضر است | TLS/HSTS واقعی، دامنه و proxyهای قابل اعتماد، secrets/DBaccount کم‌دسترسی، restore/monitoring/WAF/آزمون نفوذ مستقل در استقرار واقعی؛ بدون اجرا کامل اعلام نشود |

## منابع معیار

- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)
- [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [اعتبارسنجی JWT در ASP.NET Core10](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/configure-jwt-bearer-authentication?view=aspnetcore-10.0)
- [OWASP Password Storage؛ PBKDF2-SHA512 و220هزار تکرار](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- راهنمای CSPهمین Nextنصب‌شده: `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`.

## شواهد تا freeze کد

در مرحلهٔ اول،1292آزمون واحد،17SQL مربوط به نشست/MFA/حساب همکار،633آزمون فروشگاه و270قرارداد پنل پاس شدند. پس از آن پذیرش scopeامضاشدهٔ محدودتر و منع wildcardHTTPS تکمیل شد و یک سناریوی SQL برای حذف ادعایMFA/نامعتبرشدن سطرنشست اضافه شد؛ بنابراین نتایج مرحلهٔ اول به‌تنهایی پذیرش باینری نهایی نیستند. اجرای یکپارچه و انتشار تنها در گفت‌وگوی اصلی پروژه انجام می‌شود تا رسانه، امنیت و تغییرات استقرار همدیگر را بازنویسی نکنند.

- [واحد اولیه](../artifacts/checks/security51-unit-results/security51-unit.trx)، [SQL اولیه](../artifacts/checks/security51-sql-auth-results/security51-auth.trx).
- [فروشگاه633](../artifacts/checks/security51-storefront-tests-third.log)، [پنل270](../artifacts/checks/security51-admin-tests-first.log). آزمون CSP در فرایند تازه با `Function` ممنوع، حتی تلاش برایeval را نیز رد می‌کند.
- [npm audit](../artifacts/checks/security51-npm-audit-initial.json)، [ابزارهایlint/CI](../artifacts/checks/security51-tooling-audit.json) و [NuGet audit](../artifacts/checks/security51-dotnet-audit-initial.json) در2026-10-29 آسیب‌پذیری شناخته‌شده‌ای گزارش نکردند. این نتیجه جای بازبینی کد یا آزمون نفوذ را نمی‌گیرد؛ CI برای advisoryجدید گیت جدا دارد.

آزمون‌های جدید، خروج فوری و حفظ نشست مستقل، ثبات خانواده/مهلت refresh، بازپخش، کوکی تکراری/اشتباه، امضای معتبر با ادعاهای نامعتبر، issuer/audience/expiry و تغییر نقش را پوشش می‌دهند. پنل نیز Origin،fetch-metadata،روش/مسیر،کوکی و هدر جعلی،پاسخ بزرگ و فایل مخفی/source-map را بررسی می‌کند. پاسخ auth پیش از فرستادن Set-Cookie به مرورگر کامل، محدود، UTF8 وJSON بررسی می‌شود.

## مرزهای امنیت و استقرار

Access token فقط در حافظهٔ رابط است؛ storageمرورگر صرفاً نشانهٔ خروج/هماهنگی دارد. refresh در HttpOnlycookie است. کوکی refreshدر Development روی HTTPمحلی Secureنمی‌شود؛ در محیط واقعی از `__Host-`،Secure،Strict وPath=/ استفاده می‌شود و legacyفقط حذف می‌شود. کوکی سبد مهمان نیز HttpOnly/Strict و در محیط غیرDevelopment،Secure است؛ توکن تصادفی256بیتی آن درSQLبه‌صورتhash نگه‌داری می‌شود و مجوز حساب کاربری نمی‌دهد. Originهای Production باید HTTPSصریح و مجموعهٔ Originادمین زیرمجموعهٔ مجاز باشند. دامنه‌های `.localhost` فقط loopbackتوسعه‌اند؛ HTTPرویLAN یا دامنهٔ عمومی پذیرفته نیست.

CSPفروشگاه برای scriptاز nonceتازه وstrict-dynamic استفاده می‌کند وeval/inline-script را در buildProduction مجاز نمی‌کند. CSSدرون‌خطی به‌علت متغیرهای برند SSR و styleاجزای موجود مجاز است؛ ادعای حذف همهٔ inline-style نداریم. صفحه‌های HTMLحاوی nonce،auth و پاسخ‌های خصوصی no-storeهستند؛ service worker دادهٔ خصوصی یا درخواست دارایAuthorization را cacheنمی‌کند. SignalRفقط long-polling محدود دارد، توکن query را نمی‌پذیرد و در انقضای احراز هویت بسته می‌شود؛ پیام‌ها صرفاً اعلان تغییر برای دریافت دوبارهٔ دادهٔ مجازند.

این محیط هنوز فقط محلی است. پذیرش TLS/HSTSروی دامنهٔ واقعی،ترمینیشن/proxy قابل اعتماد،حساب SQLکم‌دسترسی،مدیریت/چرخش secret و certificate،restoreبیرونی،rate-limitلبه و پایش عملیاتی و آزمون نفوذ مستقل نیازمند استقرار واقعی‌اند و با آزمون localhost کامل محسوب نمی‌شوند. سرویس پیامک/ایمیل/درگاه بدون credentialواقعی همچنان بسته می‌ماند. هیچ گواهی «غیرقابل نفوذ»، تست بار/DDoS یا پذیرش کامل همهٔ گردش‌های کسب‌وکار از این تحویل نتیجه گرفته نمی‌شود.

در Development کلید مادر Data Protection در فایل محلی با دسترسی600 و پوشه700 است؛ رمزنگاری فایل کلید با گواهیِ Production روی این محیط ادعا نمی‌شود. [بررسی دسترسی فایل‌ها](../artifacts/checks/security51-local-permissions.json) و [بررسی مسیرهای ثبت‌شده درGit](../artifacts/checks/security51-tracked-paths.json) پاس‌اند. بررسیGit بر نام و مسیر فایل تمرکز دارد و جای اسکن محتوایی کامل secret را نمی‌گیرد.

## نتیجهٔ یکپارچه و بررسی نسخهٔ اصلی

1293آزمون واحد بک‌اند و902سناریویSQL متمایز تأیید شدند. اجرای کامل SQL دارای901قبولی و یک شکست fixture بود: هدر ادمین اشتباهاً همراه درخواست مشتری فرستاده می‌شد. پس از حذف همان هدر فقط درfixture، کل کلاس کارکنان با7آزمون پاس شد. همهٔ902نام discovery با unionنتایج پوشش دارند و هر14DLL محصول درAPI/unit/SQL برابرند؛ حفاظت برنامه برای عبور آزمون تضعیف نشد. [اثبات مستقل پذیرش](../artifacts/checks/security51-backend-acceptance-proof.json) و [گزارش هماهنگ‌شده](../artifacts/checks/admin-d51-final-integrated-acceptance.json) مرجع‌اند. SQLfixtureها با گزارش cleanupصفر پایان یافتند.

633آزمون فروشگاه و270قرارداد پنل پاس‌اند. بررسی پراکسی پس از آزمون واقعی به42قبولی رسید: پاسخ401/403خالیASP.NET به همان statusباJSONامن نگاشت می‌شود، problem+jsonپذیرفته و empty200/HTML/UTF8خراب/بدنهٔ بزرگ رد می‌شوند. مسیر دقیق تصویر عمومی نیز با هر سه تصویر واقعیAPI، بدون ساخت listenerجدید، از handlerواقعی گذشت و با hashبرابر تحویل شد. [42آزمون](../artifacts/checks/security51-public-image-tests.log)، [سه تصویر واقعی](../artifacts/checks/security51-public-image-real.json)، lint وformatهمان دو فایل پاس‌اند.

روی فروشگاه منتشرشده، nonceهر پاسخHTMLتازه است و همهٔscriptهایHTMLبازار وکالا nonceصحیح دارند.21بررسیHTTP، دسترسی ناشناس/Originبد/کوکی تکراری و فایل‌های مخفی را هم پوشش دادند. JSON-LDدرنسخهٔمحلیDevelopment/noindex عمداً رندر نمی‌شود؛ پذیرش runtimeآن رویProduction ادعا نیست. [بررسیHTTP](../artifacts/checks/security51-main-http.json) و [مرورگر](../artifacts/checks/security51-browser.json) مرجع‌اند. جست‌وجوی زنده، متنHTMLآزمایشی، رنگ گوشی، پیمایش به کالا وبارگذاری کامل، باز/بسته‌شدن فیلتر وفوکوس بررسی شد وconsoleبدونerror/warningبود. ورودی آزمایشی پاک وسبد1کالایی قبلی حفظ شد.

آخرین اصلاح پراکسی تصویر نیز روی همان پنل3173 فعال شد و21بررسیHTTP دوباره پاس شد. هر سه تصویر واقعی از آدرس پنل باAPIمقایسه شدند وbyte/MIME/ETag/hash دقیقاً برابر بود؛ hashفایل پراکسی منتشرشده با نسخهٔ42آزمونی برابر است. [بررسی تصویر پنل اصلی](../artifacts/checks/security51-public-image-main.json) و [پذیرش نهایی امنیت](../artifacts/checks/security51-final-acceptance.json) مرجع‌اند.

در لحظهٔ تحویل، API71681 باruntime `api-runtime-media-b5020844a16b4bc2aa1027928a7fea91`، فروشگاه74811 باruntime `storefront-runtime-quality-448b6658b2aa4ce2994958a0c5bf2538` وپنل82492 باruntime `admin-runtime-quality-28bfbdb3ca424e088181d8e270d31b3b` روی5080/3000/3173 فعال‌اند. descriptorهایcurrent مرجعPIDپس از restartهستند. schema85/222 حفظ شد و کار امنیت migrationتازه‌ای اضافه نکرد. باینریAPIمنتشرشده نیز با14DLLپذیرفتهٔ unit/SQL برابر است.

نسخهٔ بازبینی ماندگار ساخته نشد؛ fixtureها پایان یافته وSQLcleanupصفر است. خروجی قدیمی `tmp/security51-build` پس از پذیرش باینری تازه برای آزادکردن دیسک حذف شد؛ گزارش‌های ابتدایی تاریخی‌اند. پذیرش یک تصویر مصنوعی درآزمونHTTP با فعال‌شدن سرویس واقعیProduction یکی نیست. رمز، کلید،cookie وtokenواقعی در گزارش‌ها وارد نمی‌شوند. محدودیت‌های TLS/استقرار/آزمون نفوذ مستقل که بالاتر آمده‌اند همچنان بازند.
