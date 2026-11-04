# کد پشتیبان و بازیابی Authenticator کارکنان

پذیرش جدید 2026-10-23: D20 توقف فضا را رفع کرد؛ **۱۲۹/۱۲۹ SQL واقعی** شامل آزمون‌های این برش موفق شدند. اعداد compile-only و توقف D19 متن زیر تاریخی‌اند؛ QA مرورگر متصل، main migration۱۸–۲۱ و Linux x64/بار هنوز جدا باقی‌اند. وضعیت جاری در [STATUS](STATUS.md) است.

وضعیت 2026-10-23: سورس و آزمون‌های بدون SQL آماده‌اند؛ بازیابی واقعی، همزمانی SQL و اتصال پنل هنوز پذیرفته نشده‌اند. اجرای اصلی تغییر نکرده و migration۱۹ اعمال نشده است. ساخت/مدیریت کارکنان، بازیابی رمز با provider و بازیابی دستیِ بدون کد پشتیبان جدا باقی‌اند.

## مسیر کاربر و قرارداد

| مسیر `/api/auth` | شرط و نتیجه |
|---|---|
| GET `mfa/recovery-codes` | access کامل با نقش شناخته‌شدهٔ کارکنان؛ فقط schemaVersion1/remainingCodes از حساب خود |
| POST `mfa/recovery-codes` | همان policy، رمز جاری و TOTP تازه؛ جایگزینی مجموعهٔ قبلی با۱۰ کد و نمایش یک‌بارهٔ schemaVersion1/codes/generatedAt |
| POST `mfa/recover` | mfa_pending پس از رمز درست، رمز دوباره و recoveryCode استفاده‌نشده؛ فقط مجوز موقت راه‌اندازی، بدون refresh/permission |

هر سه مسیر Origin دقیق پنل و X-Sayman-Client: admin، no-store و محدودسازی auth فعلی دارند. شناسهٔ هدف از sub گرفته می‌شود؛ تغییر حساب دیگری از body ممکن نیست. سرویس نقش جاری SQL را هم بررسی می‌کند. مشتری یا token کامل نمی‌تواند مسیر recover را صدا بزند؛ token محدود نمی‌تواند مجموعه بسازد یا مدیریت را بخواند.

در پنل، «امنیت حساب» شمارندهٔ کد استفاده‌نشده، فرم رمز/TOTP و نمایش یک‌باره با پنهان‌کردن یا دانلود صریح فایل متنی دارد. کدها در QueryClient، storage یا URL ذخیره نمی‌شوند؛ فقط state همان کامپوننت‌اند و با ترک/refresh از دسترس رابط خارج می‌شوند. دانلود فقط با کلیک مالک است. تولید تازه همهٔ کدهای قبلی را باطل می‌کند. هیچ کد موجودی از GET بازیابی نمی‌شود.

در مرحلهٔ MFA ورود، «به Authenticator دسترسی ندارم» فرم بازیابی را باز می‌کند. پذیرش کد، مرحلهٔ راه‌اندازی Authenticator تازه را نشان می‌دهد؛ ورود کامل فقط پس از TOTP کلید تازه صادر می‌شود. رمز فرم ورود پس از تلاش و رمز/کد فرم بازیابی پس از هر پاسخ پاک می‌شوند. فرم‌ها ارقام فارسی/عربی TOTP را نرمال می‌کنند؛ کد پشتیبان فقط hex لاتین با گروه‌بندی اصلی یا بدون خط تیره، بدون نویسهٔ مشابه یونیکد، پذیرفته می‌شود.

اگر پاسخ بازیابی قطع شد یا مجوز موقت تمام شد، کاربر دوباره با رمز وارد و کد استفاده‌نشدهٔ دیگری مصرف می‌کند. پس از تکمیل Authenticator تازه، تمام کدهای مجموعهٔ قبلی حذف می‌شوند؛ مالک باید مجموعهٔ تازه بسازد. بدون کد پشتیبان از پیش تولیدشده، بازیابی خودکار وجود ندارد. برای حساب اصلی عامل کد/کلید تولید یا ثبت نکرده است؛ انجام آن بعد از انتشار با خود مالک است.

## مرزهای امنیت و SQL

- هر کد۱۶ بایت تصادفی/۱۲۸ بیت، نمایش۳۲ hex در چهار گروه۸تایی است. فقط SHA-256 وابسته به UserId در جدول Identity ذخیره می‌شود؛ رمز، کد خام، کلید Authenticator یا token در audit نیستند. PK مرکب UserId/CodeHash غیرclustered است تا حداکثر کلید۹۶۴ بایت از سقف۹۰۰ clustered عبور نکند؛ قرارداد UserId۴۵۰ حفظ می‌شود.
- تولید، شروع بازیابی و setup/verify MFA تراکنش Serializable و قفل UPDLOCK/HOLDLOCK همان ردیف کاربر دارند. ردیف پس از قفل دوباره load و security stamp دوباره بررسی می‌شود؛ وضعیت track‌شدهٔ middleware مرجع تازه محسوب نمی‌شود. کد با UPDATE شرطی ConsumedAt=null مصرف می‌شود؛ شکست audit تمام تغییر موفق را rollback می‌کند.
- تولید مجموعه به رمز و counter مصرف‌نشدهٔ TOTP نیاز دارد؛ همان کد استفاده‌شده برای ورود دوباره پذیرفته نمی‌شود. تلاش غلط به lockout موجود می‌رود. ورود درست با رمز برای حساب MFA، شمارندهٔ شکست را صفر نمی‌کند؛ فقط تکمیل عامل دوم آن را reset می‌کند.
- شروع بازیابی کلید قدیمی را تعویض، MFA را در وضعیت اجباریِ ناتمام قرار می‌دهد، stamp را عوض و همهٔ refresh sessionهای قبلی را revoke می‌کند. JWTهای قبلی در middleware و stamp داخل قفل رد می‌شوند. refresh با stamp منسوخ اجازه ندارد stamp تازه را دوباره بچرخاند؛ replay خانوادهٔ همان stamp جاری همچنان ابطال قبلی را انجام می‌دهد.
- MfaRecoveryPending ماندگار است. token معمولیِ صادرشده فقط با رمز، requiresRecovery=true و requiresEnrollment=false دارد و setup/verify را باز نمی‌کند. فقط claim امضاشدهٔ mfa_recovery=verified در مجوز بازیابی اجازهٔ ثبت دوباره دارد؛ عمر آن۵دقیقه است و setup همان deadline را حفظ می‌کند. skew عمومی JWT۱۵ثانیه باقی است؛ setup مجوز منقضی را تمدید نمی‌کند.
- verify تازه وضعیت بازیابی و کدهای قدیمی را پاک، رویداد MFA_RECOVERY_COMPLETED و نشست MFA کامل را با هم commit می‌کند. نقش/permission روی token بازیابی وجود ندارد. success/failure auditهای مشخص فقط actor/action/resource/trace/time دارند. شکست auditِ تلاش ناموفق نیز موفقیت ایجاد نمی‌کند.

این تراکنش‌ها فقط Identity را لمس می‌کنند؛ مرز ماژول‌ها تغییر نکرد. deadlock با جریان‌های همزمان می‌تواند409 بدهد؛ retry خودکار تولید یا مصرف کد وجود ندارد. پذیرش ترکیبی refresh/recovery زیر بار و بازیابی عملی backup/key ring همچنان باقی است. کدهای پشتیبان جای backup SQL، key ring و certificate را نمی‌گیرند.

Migration سورس۱۹ `20261023005118_IdentityMfaRecovery` شامل MfaRecoveryPending و MfaRecoveryCodes است؛ SQL idempotent در database/sqlserver/snapshots/identity.sql تولید و model check بدون تغییر جامانده است. اصلی آخرین‌بار۱۷ migration داشت؛ برای اجرای سورس تازه، Sales۱۸ و Identity۱۹ هر دو لازم‌اند. طبق D19 تا اعلام مالک هیچ‌یک اعمال نشده‌اند و SQL/Docker تازه اجرا نشد.

## شواهد و حد پذیرش

- **۳۱۱ تست بک‌اند موفق**؛۲۳ تازه برای قالب/نرمال‌سازی/محدودیت، hash وابسته به حساب، مدل/SQL، نقش/token/Origin/ورودی null و HTTP serialization. reader/serviceهای مثبت native فقط داخل test assembly مصنوعی‌اند؛ این‌ها پذیرش هویت یا SQL واقعی نیستند.
- **۲۰ contract پنل موفق**؛۴ تازه برای count محدود،۱۰ کد یکتا، فرمت و رد challenge کامل/refresh/permission. **۱۰ wire ASP.NET→TypeScript** با `verify-admin-wire.mts artifacts/checks/admin-wire-mfa-recovery --mfa-recovery` موفق‌اند؛ سه پاسخ تازه status/batch/challenge با سرویس مصنوعی test-only هستند و credential حساب واقعی ندارند. فرمان قبلی بدون flag همچنان۷ بررسی را دارد.
- TypeScript و build ایزولهٔ `tmp/mfa-recovery-admin-dist` موفق؛ entry۳۲۴٫۱۲/gzip۱۰۳٫۴۰kB و modulepreload مشترک schemas۸۵٫۶۲/gzip۲۴٫۴۳kB، جمع JS اولیه۴۰۹٫۷۴/gzip۱۲۷٫۸۳kB. chunk امنیت۳٫۹۷/gzip۱٫۸۵kB lazy است. جداشدن schemas کاهش واقعی JS اولیه ادعا نمی‌شود؛ هشدار۵۰۰kB نیست، threshold عوض نشده و معیار دستگاه اندازه‌گیری نشده. دو تست runtime پنل هم موفق‌اند.
- **۱۴ QA محدود رابط** روی SecurityPage/RecoverMfaForm/Login واقعی و fixture صریحِ شکست:503/schema/retry، ارقام، رد کد ناقص، پیام پاسخ نامعلوم، رد401، پاک‌شدن ورودی‌ها/بازگشت و سه صفحه در۳۹۰×۸۴۴ بدون overflow. هیچ ورود، تولید کد یا بازیابی موفقی در fixture وجود ندارد.۷ درخواست، فقط طول فیلدها و حضور header ثبت شد؛ Cookie/Authorization در proxy حذف و در fixture API صفر بود. console error/warning صفر؛ parent۶۸۹۳/child۶۸۹۴ terminal، listener/control/temp حذف، tab۲۱ بسته و viewport reset شد.
- **۵ SQL تازه فقط compile شده‌اند**: بازیابی/ابطال نشست و منع password-only/حفظ deadline، تولید/rotation/hash/رمز/TOTP تازه، دو بازیابی همزمان/replay/کد جایگزین در قطع پاسخ، rollback audit و lockout پایدار میان challengeهای تازه. هر مورد SQL/کاربر/کلید موقت خودش را دارد؛ TimeProvider آزمایشی فقط نیاز به انتظار۳۰ثانیه را حذف می‌کند. discovery بدون اجرا۷۸ مورد دارد؛ شاهد SQL قبلی۵۹، **۱۹ مورد تازه هنوز اجرا نشده‌اند**.

گزارش `artifacts/checks/mfa-recovery-source.json`، logهای mfa-recovery-* و تصاویر sayman-mfa-*.png مرجع‌اند. پس از اعلام فضا: SQL۷۸، QA مثبت با حساب/کلید موقت و مدیر دارای MFA، مسیر قطع پاسخ/مهلت و دو زبان/موبایل مرتبط، migration۱۸/۱۹ و build/update/smoke اصلی. پذیرش Linux x64، staff provisioning و recovery بدون backup code، providerهای OTP/ایمیل/بازیابی رمز و تمام فازهای PLAN بازند.

انتخاب کد یک‌بارمصرف و الزام عامل فعلی برای تعویض از [راهنمای MFA در OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html) و جداسازی دسترسی مدیریتی پس از عامل دوم از [مستندات MFA در ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/mfa?view=aspnetcore-10.0) پیروی می‌کند؛ اعداد/قرارداد و سازوکار grant بالا انتخاب فنی این پروژه‌اند و پذیرش عملی‌شان جدا ثبت می‌شود.

نقطهٔ ادامهٔ فعلی پس از کارکنان: SQL۸۴ با۲۵ مورد اجرا‌نشده، شامل شش staff است؛ اعداد این سند شاهد زمان برش MFA‌اند. سورس هنوز۱۹ و اصلی۱۷ است؛ ادامهٔ عملی و پرسش پایان آزادسازی فضا در [STATUS.md](STATUS.md) و قرارداد کارکنان در [STAFF-ADMINISTRATION.md](STAFF-ADMINISTRATION.md) ثبت شده است.
