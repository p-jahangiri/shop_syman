# وضعیت و نقطهٔ ادامه

آخرین به‌روزرسانی: 2026-10-26. **اصلی محلی۵۰، هسته و سوابق خصوصی پرداخت پذیرفته و منتشر است؛ درگاه واقعی و کل PRD/PDF هنوز کامل نیستند.** D34 تکمیل همهٔ بخش‌هاست؛ پایان یک برش پایان هدف نیست.

## اجرای اصلی محلی۵۰

- API: http://127.0.0.1:5080، PID68885/session57392؛ restart: `python3 tmp/payment-core50-release.py serve-api`.
- فروشگاه: http://127.0.0.1:3000، PID68910/session31096؛ restart: `python3 tmp/payment-core50-release.py serve-storefront`.
- پنل: http://127.0.0.1:3173، PID68937/session62725؛ restart: `node tmp/serve-payment-core50-main-admin.mjs`.
- `tmp/{api,storefront,admin}-runtime-current.json` مسیر/PID/hash دقیق و `tmp/payment-core50-final-runtime-set.json` artifact آزموده را دارند. build فروشگاه `3B4lNSmVUSFgYLExa1DSo` است؛ API mode/previewخاموش. runtime۴۸، assetهای قبلی، restart/rollback و کلیدها محفوظ‌اند؛ writer قدیمی علیه schema۵۰ خودکار اجرا نشود.
- SQL۵۰migration/۱۳۷جدول/۹schema؛ چهار جدول جدید پرداخت خالی‌اند. Stock101/0/0، Orders/Reservations/Settings/Policies/SourcingRequests صفر؛ CMSsite3 دو زبان/auth1 محفوظ‌اند. D32 Redis پارسه running و دست‌نخورده است.
- بکاپ تازهٔ پیش۵۰: 18,993,152 بایت COPY_ONLY/CHECKSUM/VERIFYONLY و keyring خصوصی؛ `main-pre50-release-backup.json`. این بکاپ محلی است و offsite/nativeLinux/restore۵۰ را اثبات نمی‌کند. tmp کامل پاک نشود.

## هسته/سوابق پرداخت۵۰ پذیرفته

[PAYMENT-CORE](PAYMENT-CORE.md)، API و A47 مرز را تعریف می‌کنند. مبلغ/نسخه/fingerprint از snapshot تاریخی معتبر سرور، آماده‌سازی actor/UUID/body پایدار، registry پیش‌فرض خالی و authority رمز‌شدهٔ وابسته به AttemptId هستند. تسویهٔ داخلی فقط پس از Verify معتبر آینده، در rootSerializablePayments/Sales/Inventory و قفل مالک مشترک انجام می‌شود؛ Paid/Allocated/لینک/verification/event اتمیک‌اند و OnHand تغییر نمی‌کند. دیررس/لغوشده/ناسازگار review بدون تغییر Order/Stock است؛ replay تاریخی بعد از ارسال نیز رسید اصلی را می‌دهد. هیچ endpoint عمومی دریافت proof یا «Paidکن» و هیچ successadapter در محصول وجود ندارد؛ canPay=false.

GET خصوصی مشتری برای سفارش/attempt خودش و پنل با هر دوfinance.read+sales.read/MFA، seek۵۰مقید به scope/فیلتر، no-store/noindex و decoder سخت‌گیر ساخته‌اند. raw authority/reference/owner/configخام نمایش داده نمی‌شوند. رابط FA/EN هر سه وضعیت pending/verified/review، اختلاف یک ریال، برچسب نمونه و هشدار پرداخت دوباره را حفظ می‌کند؛ پنل فقط خواندنی است. متن «پرداخت‌نشده» در awaiting به نبود تأیید نهایی تغییر کرد تا دریافت احتمالی وجه را نفی نکند؛ شناسه‌های جدول پنل جدا و خوانا شدند.

۸۸۴واحد، کل۶۲۴SQL،۳۴۱فروشگاه/۲۱۲پنل، typecheck/build مستقل،۳proxyبدون تغییر با شاهد تأخیر۱۳ثانیه،۶rawSQL و۲۱پاسخ واقعی مرورگر با decoderتولیدی موفق‌اند.۱۳DLL در واحد/SQL/harness/runtime یکسان بوده‌اند. raceلغو/verify/expiry، rollbackسه‌ماژولی، moneyبیشاز2^53، همهٔSaveChangesguardها، nullableSQLCHECK، Productiondemo، seek/owner/HTTP و snapshot2تاارسال/تحویل آزموده‌اند. دو build نخست محلی به‌ترتیب modeپیش‌فرض نامناسب/IPC sandbox منتظر ماندند و فقط همان buildها بسته شدند؛ build نهایی با APIصریح/previewخاموش بیرون sandbox موفق است؛ ربطی به permissionrejection یا توقفDocker ندارد.

مرورگر GUID واقعی، سه نمونهٔ روشن pending/verified/review را با سیاست D21 و fixtureفقطexecutable آزمون ساخت؛ هیچ networkدرگاه نبود. همه۱۳۷جدول سنجیده،۱۲۶جدول غیرIdentity دقیقاً برابر و تغییر فقطUser/Session ورود خودQA بود. FA/EN/ناوبری/refresh/فیلتر ترکیبی/ورودی نامعتبر و تصاویر بررسی شدند؛ عرض۱۲۸۰/client=scroll۱۲۶۵ و خطایconsole صفر. mobile هنوز پذیرفته نیست. GUID/کلید/credential و تب‌های48/49 پاک، پورت‌هایQA بسته‌اند. `payment-core-browser-acceptance.json`، wire/observations و screenshotهای `payment-core-browser-{admin-final,customer-fa-final,customer-review-en-final}.png` مرجع‌اند.

پس از بکاپ تازه، Sales49 `20261025231229_CashOrderPaymentLinks` وPayments50 `20261025231645_CashPaymentAttempts` فقط چهار جدول خالی اضافه کردند.۱۳۱جدول قدیمی به‌جز دوEFhistory و تمام schema/viewها برابر baselineتازه‌اند؛۵۰migration/۱۳۷جدول.۸۴۸HTTP یکتا با پوشش۸۱۵شاهد قبلی،۵۰۵assetپنل/۱۹۲Nextقدیمی و تمام جدیدها و401/no-store موفق‌اند؛ بعدHTTP هر۱۳۷جدول برابرند. هیچ نمونه/سیاست/provider به اصلی منتقل نشد. `payment-core50-main-release.json` و source-acceptance و before/after/post-smoke مرجع‌اند.

## کار جاری: تیکت خصوصی، سورس۵۱ منتشرنشده

[SUPPORT-TICKETS](SUPPORT-TICKETS.md) طرح را نگه می‌دارد. schema مستقل support با چهار جدول ticket/message/event/command و یک migration جدید `20261026003519_PrivateSupportTickets`، ciphertext مقید به ticket/record/kind، receipt تاریخی و rootSerializable/audit ساخته شد. نقش SupportAgent فقطsupport.read/write؛ MFA و origin و bodyحد۳۲KiB صریح‌اند؛ دیگر نقش‌ها مکالمه نمی‌خوانند. Downحافظhistory و همهSaveChangesguardها پیاده‌اند. درگاه صف‌بندی SQL مشترک خودSupport ظرفیت همزمان را ایمن می‌کند؛ load/partitioning هنوز پذیرفته نیست.

۷واحد رمزنگاری/متن/cursor/نقش و۹SQLواقعی مالک/پشتیبانMFA/reply-close race/duplicate/replay/append-only/auditrollback/ظرفیت/pagination/tamper/Downguard مثبت‌اند؛ build بدونwarning. ۸۹۶واحد نهایی مثبت‌اند؛ رگرسیون نخست فقطفرض ثابت۶نقش را رد کرد و آزمون به فهرست صریح۷نقش به‌روز شد، guardمحصول شل نشد. کل۶۳۳SQLپیش از افزودن provisionنقش مثبت است؛ آزمون مستقل نبودRole/اعطایصریح/rollbackنقش+عضویت+stamp هم موفق و کل۶۳۴SQL نهایی نیز بدون شکست/skip مثبت است. نقش فقط در grantمجازمدیر با RoleManager و همانtransaction/audit ساخته می‌شود، نهstartup/seedاصلی.

۳۵۲فروشگاه/۲۱۲پنل/typecheck/build مستقل و۱۱wireSQLباdecoderتولیدی مثبت‌اند. نخستینbuild تداخل نامhelperمتنFAQ با stateرا کشف کرد؛ نامcopyاصلاح وbuildنهایی APImode/previewخاموش موفق است. sourceهای وابستهٔ پنل اززمانbuild ثابت‌اند؛ Dockerfileپنل lib/componentsمشترک رابهcontextمی‌آورد ولیnativeLinux هنوزپذیرفته نیست. رابط مشترک مشتریFAEN/پنل،BFFstrict،journalفقطRAMمقیدبهحساب وorigin/roleکنترل وPWAprivate ساخته‌اند؛FAQدرAPImodeدیگر ادعایپیش‌نمایشیاپشتیبان‌نبودن نمی‌کند،CMSFAQمدیریت‌شدهنوزبازاست. ۱۳DLL محصول واحد/SQL/harness هم‌خوان‌اند. مرورگر GUID واقعی باSupportAgent/MFA/مشتری،FAEN/HTMLمتنساده/فیلتر، قطع۲پاسخ200createو۲پاسخ200staffreply،sameUUID/body/GETreceipt/ناوبری،ردstale409/بستن/بازگشایی موفق است.۶۱پاسخ/۸ورودی خامdecoderمحصول را گذرانده‌اند؛۱۴۲جدول سنجیده و۱۲۶جدول سایر دامنه‌ها عینbaselineاند،فقطSupport1ticket/3message/5event/5command وIdentity3audit/User/Session تغییر کرده‌اند. عرض۱۲۸۰/client=scroll۱۲۶۵؛mobileپذیرفته نیست. تغییرزبانfullnavigationتاunresolved باbeforeunloadمحافظتشد و پسازackدرهمانticketFAENموفقبود؛ حفظRAMدرfullreloadادعانشود. تصاویرoverview/admin/customer بررسی شدند. QAدرحالcleanup است؛ backup/حفظاصلی/انتشار۵۱ بعدی‌اند؛ اصلی۵۰/۱۳۷جدول وruntimeثابتش حفظ است و۵۱ به آن migrate نشده. فایل/SignalR/اعلان/provider وکلPDF با ساخت تیکت کامل معرفی نمی‌شوند.

## کار بعدی برای D34 — ادامهٔ مستقل تا تکمیل

1. پشتیبانی/تیکت خصوصی واقعی SQL و گردش مجوزدار مشتری/پشتیبان، سپس اعلان داخلی؛ رابط فعلی support هنوز راهنمای نمایشی است و ماژول Support scaffold است. ابتدا طرح مرز، حفظ حریم خصوصی، idempotency/همزمانی/seek و UIFAEN/پنل؛ ارتباطات بیرونی پس از قرارداد واقعی.
2. پرداخت زنده باز است: initiationlease، شبکهٔStart/Verify، callback/reconcile/sandbox و بازپرداخت به قراردادD16 وابسته‌اند؛ اسم/provider/موفقیت جعلی ساخته نشود و سؤال قبلی تکرار نشود. هلو زندهD30 و منبع مجاز بازار/نظر خارجی نیز بازند.
3. ارسال جزئی/دیجیتال، مرجوعی/بازپرداخت، پروندهٔ چک/مدارک خصوصی/سررسید، CMSپیشرفته، search/alert/loyalty و باقیPRD لازم‌اند. ارسال کامل صرفاً فیزیکی۴۸ پذیرفته است؛ کلچرخه/PDF کامل نیست.
4. mobile/WCAG/SEO/performance/CI/nativeLinux/load/offsite backup و معیار۱۲گانه شاهد لازم دارند. هزینه/مالیات/شرایط واقعی گارانتی/مرجوعی/چک نامعلوم؛ mainSettings/Policyخاموش، providerغیرفعال باقی می‌ماند. D14انتشار محلی مجاز،D21نمونه فقطQA،D32Redisروشن،D33پاک‌سازی۱٫۶۷GiB،D34هدفکلپروژه‌اند.

## سوابق

ارسال۴۸ و کارهای۴۷/قبل در [آرشیو پیش۵۰](archive/STATUS-before-payment-core50-release.md) و اسناد هر قابلیت محفوظ‌اند. runtimeجاری و گام بعدی از همین STATUS خوانده شوند؛ بخش‌های قدیمی PLAN سابقه‌اند.
