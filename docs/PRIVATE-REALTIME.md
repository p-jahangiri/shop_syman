# تازه‌سازی زندهٔ خصوصی پشتیبانی

برش کد پس از اعلان۵۲؛ روی اصلی۵۲ بدون migration پذیرفته و محلی منتشر شده است. هدف SUPPORT-01: وقتی پاسخ/وضعیت تیکت یا اعلان در SQL ثبت شد، صفحهٔ باز مشتری و پشتیبان از تغییر باخبر شود و دادهٔ مجاز را دوباره از API بخواند. مرجع پیام/اعلان همان SQL است؛ event زنده متن، عنوان، مالک یا شناسهٔ مکالمهٔ دیگران را حمل نمی‌کند. حضور آنلاین/زمان پاسخ انسانی وعده داده نمی‌شود.

## انتخاب فنی

SignalR استاندارد با پروتکل JSON و transport رسمی Long Polling از مسیر هم‌مبدأ BFF استفاده می‌شود؛ مرورگر JWT را فقط در Authorization می‌فرستد و access_token در query، Cookie به upstream، WebSocket/SSE و stateful reconnect این برش فعال نیستند. این انتخاب با BFF موجود و پنل مستقل سازگار است؛ جایگزین stack نیست. سرور poll حداکثر۸ثانیه و حافظه/بدنه محدود دارد؛ reconnect و خواندن مجدد وضعیت، تغییرِ ازدست‌رفته را جبران می‌کنند. پیام زنده صرفاً invalidate است و تحویل آن best-effort؛ صندوق اعلان SQL دائمی است. ادعای outbox یا تضمین تحویل realtime نمی‌شود.

منابع اولیهٔ بررسی‌شده: [امنیت SignalR](https://learn.microsoft.com/en-us/aspnet/core/signalr/security?view=aspnetcore-10.0)، [تنظیم transport و محدودیت‌ها](https://learn.microsoft.com/en-us/aspnet/core/signalr/configuration?view=aspnetcore-10.0)، [هویت در طول اتصال](https://learn.microsoft.com/en-us/aspnet/core/signalr/authn-and-authz?view=aspnetcore-10.0) و [Dispatcher نسخهٔ10.0.12](https://github.com/dotnet/aspnetcore/blob/v10.0.12/src/SignalR/common/Http.Connections/src/Internal/HttpConnectionDispatcher.cs). principal اتصال در SignalR ماندگار است؛ به auth ابتدایی یا مخفی‌بودن منو بسنده نمی‌شود. قابلیت‌های معرفی‌شده برای .NET11 وارد پروژهٔ .NET10 نمی‌شوند.

## مرز امنیت

مسیر مشتری `/api/realtime` فقط access معتبر و گروه حساب مشتق از sub دارد؛ مسیر مستقل `/api/admin/realtime` فقط staff_mfa+support.read و گروه پشتیبانی را دارد. client هیچ JoinGroup/Send/target-owner ندارد و ارسال پیام هنوز فقط از فرمان نسخه‌دار/idempotent تیکت انجام می‌شود. Origin/query/method/frameها محدودند؛ JWT query رد می‌شود و logها هیچ query/token/frame/PII ضبط نمی‌کنند. event عمومی فقط schemaVersion و scope محدود support/notifications دارد.

connectionToken تولیدی SignalR پیش از خروج negotiation با Data Protection اختصاصی به audience و fingerprint همان sub/sst/jti/role/permission/token_kind مقید و زمان‌دار می‌شود. هر GET/POST/DELETE پیش از dispatcher آن را با JWT فعلی باز می‌کند؛ token خام به مرورگر نمی‌رود. تغییر حساب، token تازه، stamp یا مجوز، اتصال قدیمی را معتبر نمی‌کند و reconnect/negotiation تازه لازم است. هر HTTP درخواست توسط auth فعلی بررسی می‌شود؛ CloseOnAuthenticationExpiration نیز فعال است. سیاست قبلی access ده‌دقیقه‌ای تغییر نمی‌کند: logout، refresh family را می‌بندد و رابط همان لحظه داده/اتصالش را پاک می‌کند؛ ابطال اداری stamp باعث رد JWT می‌شود. تحویل pulse بی‌محتوا در poll شروع‌شده، اثبات مجوز خواندن داده نیست؛ API خواندن دوباره مجوز را بررسی می‌کند.

Queue محدود scoped در composition root، تغییرهای ماژول‌ها را از قرارداد SharedKernel می‌گیرد. فقط پس از برگشت موفق pipeline و commit transactionها pulse می‌فرستد؛ exception/rollback/receipt replay چیزی پخش نمی‌کند. خرابی ارسال realtime، نتیجهٔ موفق SQL را به شکست تبدیل نمی‌کند؛ reconnect/manual refresh مرجع بازیابی است. متن/شناسه/مبلغ کاربر در event یا log ارسال خطا نیست.

## رابط و پذیرش

رویداد و reconnect باید خواندن تازه ایجاد کنند؛ هنگام فرمان pending/unknown تیکت، journal و UUID/body/version ثابت می‌مانند و refresh زنده تا تعیین نتیجه/ack عقب می‌افتد. هنگام mark-read، pulse قبل از response نباید generation را عوض کند و دکمه را قفل نگه دارد. خروج/عوض‌شدن حساب اتصال و اشتراک را قطع و پاسخ دیررس را دور می‌ریزد. وضعیت اتصال قابل‌فهم و تلاش دوباره/manual refresh باقی می‌مانند؛ در نبود اتصال، SQL/API معمولی کار می‌کنند.

unit/SQL/SignalR واقعی برای مالکیت، role/MFA، audience، token/account/claim tamper/expiry، source-token مخفی، query/Origin/frame/body limits، event فقط پسcommit، rollback/replay بی‌event، خرابی dispatch بدون ازبین‌رفتن commit، reconnect/stamp revocation و late reply لازم است. مرورگر دو صفحهٔ واقعی با reply/state/read خودکار، قطع پاسخ و حفظ journal، FA/EN، logout و SQL preservation لازم است. wire negotiation یا query connectionToken در artifact عمومی ذخیره نمی‌شود؛ فقط event frame غیرحساس خام و hash/metadata سانسورشدهٔ transport ثبت می‌شود. migration تازه انتظار نمی‌رود؛ اصلی۵۲ تا پذیرش ثابت است. mobile/Linux/load/چندمیزبانی و file/SMS/email جدا بازند.


## شواهد پذیرفته

۹۳۲unit/۶۴۸SQL/۳۷۸storefront/۲۱۴admin/۴proxy و مدل بدون pending، ۱۳DLL برابر،۲ SQL eventbatch و۹۵ پاسخ/۶ ورودی مرورگر/۱۲۸transport/۳۸frame پذیرفته‌اند. مذاکره و queryToken ذخیره نشده‌اند. ابتدا refresh متن draft را پاک کرد؛ effect پاک‌سازی به ID پاسخ موفق همان گفت‌وگو محدود و در GUID تازه با reply/reconnect/ارسال همان draft پذیرفته شد. قطع reply200→unknown ثابت→GETreceipt بدون POST تکراری؛ قطع read200→refresh عقب‌افتاده→read درست بدون retry، logout/login/FAEN و cleanup پذیرفته‌اند. ۱۳۶ از۱۴۴ جدول QA دقیقاً ثابت و فقط۸ جدول مجاز تغییر کرد. `private-realtime52-source-acceptance.json` و wire/screenshotها مرجع‌اند.

انتشار تنها کد با بکاپ تازه18,997,248بایتی و keyring، حفظ همه۱۴۴ جدول/history/schema/view،۱۰۴۱HTTP و assetهای پیشین پذیرفته است. `private-realtime52-main-release.json` و descriptorهای current مرجع restart هستند. mobile/چندمیزبانی/بار/NativeLinux/فایل/ارسال بیرونی و کل پروژه کامل اعلام نمی‌شوند.
