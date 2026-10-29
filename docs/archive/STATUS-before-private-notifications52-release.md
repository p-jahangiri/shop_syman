# وضعیت و نقطهٔ ادامه

آخرین به‌روزرسانی: 2026-10-26. **تیکت خصوصی و محتوای پشتیبانی از CMS در اصلی محلی۵۱ پذیرفته و منتشرند. کل PRD/PDF هنوز کامل نیست.** D34 ادامه تا تکمیل همهٔ بخش‌هاست؛ پایان یک برش پایان هدف نیست.

## اجرای اصلی محلی

- API: http://127.0.0.1:5080 — PID38219/session80492؛ restart: `python3 tmp/support-content51-release.py serve-api`.
- فروشگاه: http://127.0.0.1:3000 — PID38244/session1202؛ restart: `python3 tmp/support-content51-release.py serve-storefront`.
- پنل: http://127.0.0.1:3173 — PID38448/session10455؛ restart: `node tmp/serve-support-content51-main-admin.mjs`.
- descriptorهای `tmp/{api,storefront,admin}-runtime-current.json` مرجع مسیر و hash هستند. build فروشگاه `DFbLuDryGKjpkfFnlDVsM`، API mode و preview خاموش است. مجموعهٔ ثابت `tmp/support-content51-runtime-set.json` شاهد پیش‌انتشار است؛ mainPublished=false تاریخی آن با release/current اشتباه نشود.
- SQL همچنان۵۱ migration،۱۴۲ جدول و۱۰ schema دارد. در انتشار CMS هیچ migration یا seed اجرا نشد؛ همهٔ۱۴۲ جدول، حتی تاریخچه‌ها، schemaها و viewها با baseline پیشین عیناً برابرند. Stock101/0/0، Orders/Reservations/Settings/Policies/SourcingRequests/paymenthistory و Support خالی‌اند. CMS site3 FA/EN و auth1 محفوظ‌اند؛ هنوز سند support در اصلی ثبت/منتشر نشده است. در این حالت FAQ خالی پنهان است و مسیر تیکت کار می‌کند؛ مدیر محتوای واقعی را از پنل وارد می‌کند.
- بکاپ تازه 20,041,728بایت COPY_ONLY/CHECKSUM/VERIFYONLY و keyring خصوصی: `artifacts/checks/main-pre-support-content51-backup.json`. همان میزبان است؛ offsite/restore۵۱/nativeLinux را اثبات نمی‌کند. نسخه‌های جاری/بازگشت، restart، keyring، backup و شواهد در tmp محفوظ‌اند؛ کل tmp پاک نشود. Redis پارسه طبق D32 روشن و دست‌نخورده است.

## محتوای پشتیبانی از CMS پذیرفته

[SUPPORT-CONTENT](SUPPORT-CONTENT.md) قرارداد را ثبت می‌کند. سند مستقل support در همان CMS برای FA/EN شامل عنوان/شرح/CTA و حداکثر۳۰ پرسش با ترتیب، شناسهٔ ثابت و فعال‌بودن مستقل است. ویرایشگر اختصاصی، پیش‌نمایش انتشار و نسخهٔ تاریخی، rowversion ثابت و audit/Serializable موجود استفاده می‌شوند. فقط انتشار همان زبان و پرسش فعال عمومی است؛ draft و enabled و updatedBy بیرون نمی‌روند. نبود محتوا FAQ ساختگی یا fallback زبان دیگر ایجاد نمی‌کند؛ خرابی503 می‌دهد و تیکت در دسترس می‌ماند. نمونهٔ توسعه در Production نمایش داده نمی‌شود. HTML متن ساده می‌ماند. لینک پشتیبانی از حساب مشتری و متن مخصوص کارمند اضافه شدند.

۹۰۷ واحد بک‌اند،۶۳۹ SQL واقعی،۳۵۸ فروشگاه/۲۱۲ پنل، typecheck/build و proxy بدون تغییر پذیرفته‌اند.۹ wire SQL و۲۵ پاسخ/۸ ورودی مرورگر از decoder تولیدی عبور کردند. حساب ContentManager/MFA و مشتری موقت مستقل، draft/publish FA/EN، reorder/disabled، قطع یک پاسخ204 انتشار، retry همان نسخه409 و بازخوانی فقط یک revision، ویرایش منتشرنشده، پیش‌نمایش و restore فارسی به revision3 و حفظ انگلیسی، لینک حساب→تیکت موفق‌اند. همه۱۴۲ جدول QA سنجیده شدند؛ تغییر فقط CMS و User/Session/Audit مجاز بود و۱۳۷ جدول دیگر دقیقاً برابرند. GUID/کلید/credential و تب‌های52/53 پاک و پورت‌های QA بسته‌اند. عرض۱۲۸۰/client=scroll۱۲۶۵ و log خطا/هشدار صفر؛ mobile پذیرفته نیست. تصاویر preview-fa و customer-fa/en بررسی شدند. `support-content51-source-acceptance.json` و wireها مرجع‌اند.

انتشار فقط کد با حفظ۵۵۷ asset قدیمی پنل/۲۰۸ Next و۹۴۴ HTTP، شامل۹۰۹ شاهد قبلی و مرز خصوصی endpoint جدید موفق است. SQL پس از smoke هم دقیقاً برابر است؛ `support-content51-main-release.json` و before/after/post-smoke شواهدند. خطای نحوی ابزار ثبت release پیش از هر نوشتن رفع و ثبت نهایی موفق شد؛ خطای محصول نبود.

## بخش‌های پذیرفتهٔ پیشین

تیکت خصوصی۵۱ با رمزنگاری متن/مالکیت/مجوز SupportAgent/MFA/journal و پرداخت هسته۵۰ با provider خاموش و ارسال کامل فیزیکی۴۸ محفوظ‌اند. [SUPPORT-TICKETS](SUPPORT-TICKETS.md)،[PAYMENT-CORE](PAYMENT-CORE.md)،[ORDER-FULFILLMENT](ORDER-FULFILLMENT.md) و [آرشیو پیش CMS](archive/STATUS-before-support-content51-release.md) شواهد و حدود را نگه می‌دارند.

## سورس جاری — اعلان خصوصی، هنوز منتشر نشده

ماژول Notifications با Inbox اختصاصی، قرارداد SharedKernel و ثبت اتمیک با پاسخ/close/reopen کارمند و audit پیاده شده است. متن تیکت کپی نمی‌شود؛ فقط مالک/تیکت/نوع/رویداد/UTC و ReadAt یک‌طرفه ذخیره می‌شوند. GET فهرست۵۰تایی با cursor مقید، unread-count رشته‌ای و PUT read idempotent، BFF محدود و خصوصی، صفحهٔ FA/EN و لینک حساب، و حفاظت PWA آماده‌اند. زمان CMS پنل در سورس به تهران صریح شده است. migration `20261026061434_PrivateAccountNotifications` فقط سورس است؛ اصلی همچنان۵۱/۱۴۲ جدول است. Down با تاریخچه رد می‌شود.

۹۱۳ واحد backend و۳۶۴ فروشگاه و typecheck موفق‌اند؛۶ SQL تازهٔ مالکیت/replay/race/readtime/rollback دو ماژول/history/seek/Down موفق شدند. نخست یک خطای DDL آزمون (identity بدون براکت) و چند خطای compile خود آزمون اصلاح شد؛ guard محصول تضعیف نشد. رگرسیون کامل نخست در helper ورود مجموعهٔ مشترک تیکت به429 رسید؛ محدودیت محصول حفظ و آزمون اعلان به class/fixture مستقل منتقل شد. اجرای کامل اصلاح‌شده، wire تولیدی، مرورگر QA و freeze/backup/انتشار هنوز باقی‌اند. build دو رابط و harness موفق‌اند؛۹ wire هدفمند SQL با decoder تولیدی موفق است. [PRIVATE-NOTIFICATIONS](PRIVATE-NOTIFICATIONS.md) مرجع است؛ هیچ SMS/Email/SignalR فعال نشده است.

## کار بعدی برای D34 — ادامه بده

1. اعلان دائمی خصوصی داخل حساب برای پاسخ/تغییر وضعیت پشتیبانی، با transaction مشترک و جلوگیری از تکرار، فهرست و خوانده‌شدن؛ سپس SignalR/file خصوصی و بقیه SUPPORT-01. پیامک/ایمیل بدون D16 فعال نشود. زمان انتشار CMS در پنل فعلاً locale فارسی دارد ولی timezone مرورگر است؛ در ادامه صریحاً تهران شود.
2. پرداخت زنده initiation/Start/Verify/callback/reconcile/sandbox/refund به قرارداد واقعی D16 وابسته است؛ موفقیت یا vendor API جعلی ساخته نشود و سؤال قبلی تکرار نشود. هلو live D30 و منابع مجاز بازار/نظر خارجی نیز بازند.
3. ارسال جزئی/دیجیتال، مرجوعی/بازپرداخت، پرونده چک/مدارک خصوصی/سررسید، CMS پیشرفته/بلاگ، search/alert/loyalty و باقی PRD لازم‌اند. ارسال کامل صرفاً فیزیکی۴۸ پذیرفته است؛ کل چرخه فروش/PDF کامل نیست.
4. mobile/WCAG/SEO/performance/CI/nativeLinux/load/offsitebackup و معیارهای۱۲گانه شاهد مستقل لازم دارند. هزینه/مالیات/شرایط واقعی گارانتی/مرجوعی/چک نامعلوم‌اند؛ mainSettings/Policy خاموش‌اند. D14 انتشار محلی،D21 نمونه فقط QA،D32 Redis روشن،D33 نگه‌داری tmp وD34 هدف کل پروژه حفظ‌اند.
