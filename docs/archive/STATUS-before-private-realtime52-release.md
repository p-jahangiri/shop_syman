# وضعیت و نقطهٔ ادامه

آخرین به‌روزرسانی: 2026-10-26. **اصلی محلی۵۲، تیکت خصوصی، CMS پشتیبانی و اعلان‌های دائمی داخل حساب پذیرفته و منتشرند. کل PRD/PDF هنوز کامل نیست.** D34 ادامه تا تکمیل همهٔ بخش‌هاست؛ پایان یک برش پایان هدف نیست.

## اجرای اصلی محلی۵۲

- API: http://127.0.0.1:5080 — PID59497/session60882؛ restart: `python3 tmp/private-notifications52-release.py serve-api`.
- فروشگاه: http://127.0.0.1:3000 — PID59549/session40771؛ restart: `python3 tmp/private-notifications52-release.py serve-storefront`.
- پنل: http://127.0.0.1:3173 — PID59604/session85885؛ restart: `node tmp/serve-private-notifications52-main-admin.mjs`.
- descriptorهای `tmp/{api,storefront,admin}-runtime-current.json` مسیر/hash دقیق و مرجع restart هستند. build فروشگاه `mICR8wwE2fhuEaFdaHkls`، API mode و preview خاموش است. `tmp/private-notifications52-runtime-set.json` snapshot ثابت پیش‌انتشار است؛ sourceAcceptancePending/mainPublished تاریخی آن با release/current اشتباه نشود.
- SQL۵۲ migration،۱۴۴ جدول و۱۱ schema دارد. فقط `notifications.Inbox` خالی و یک history افزوده شد؛ همه۱۴۲ جدول قبلی، حتی historyها، و schema/view قبلی عیناً محفوظ‌اند. Stock101/0/0 و Orders/Reservations/Settings/Policies/SourcingRequests/paymenthistory/Support/Inbox صفرند. CMS site3 FA/EN و auth1 محفوظ‌اند؛ سند support اصلی هنوز ثبت/منتشر نشده، FAQ خالی پنهان است و تیکت کار می‌کند. نقش یا دادهٔ نمونه/تجاری به اصلی اضافه نشد.
- بکاپ تازه20,041,728بایت COPY_ONLY/CHECKSUM/VERIFYONLY و keyring خصوصی: `artifacts/checks/main-pre-notifications52-backup.json`. همان میزبان است؛ offsite/restore۵۲/nativeLinux را اثبات نمی‌کند. runtimeهای قبلی/rollback/restart/keys/backups/evidence در tmp نگه داشته شوند؛ tmp کامل پاک نشود. writer قدیمی خودکار علیه۵۲ اجرا نشود. Redis پارسه طبق D32 روشن و دست‌نخورده است.

## اعلان خصوصی۵۲ پذیرفته

[PRIVATE-NOTIFICATIONS](PRIVATE-NOTIFICATIONS.md) مرز را ثبت می‌کند. Support فقط قرارداد SharedKernel را برای ثبت اعلان پاسخ/close/reopen کارمند صدا می‌زند؛ پیام/رویداد/رسید/اعلان/audit در همان root Serializable هستند. کلید مالک+تیکت+event identity یکتاست؛ replay یا فرمان خود مشتری اعلان تکراری نمی‌سازد. متن/عنوان پیام در اعلان کپی نمی‌شود؛ DTO مالک یا source event ندارد. فهرست seek۵۰، cursor مقید به مالک/فیلتر، count رشتهٔ64bit، read صریح idempotent با زمان اولیهٔ یکنواخت و guard تاریخچه/Down پیاده‌اند. صفحهٔ FA/EN و لینک از حساب، BFF bounded/bearer بدون cookie به upstream/no-store/noindex و PWA خصوصی آماده‌اند. زمان CMS پنل در سورس منتشرشده صریحاً تهران است.

۹۱۳ واحد backend،کل۶۴۵ SQL واقعی،۳۶۴ فروشگاه/۲۱۲ پنل و typecheck/build موفق‌اند. نخست رگرسیون مشترک تیکت با ورودهای متعدد آزمایشی به429 رسید؛ guard محصول حفظ و مجموعهٔ اعلان به fixture مستقل منتقل شد، سپس کل۶۴۵ با صفر شکست/skip موفق شد. خطای DDL آزمون identity بدون براکت و compile خود آزمون پیش‌تر اصلاح شدند. مدل Notifications بدون pending است.۱۳ DLL در unit/SQL/harness/runtime برابرند؛ proxy همان نسخهٔ پذیرفتهٔ قبلی با۳ شاهد بدون تغییر است.

۹ wire SQL و۵۲ پاسخ/۶ ورودی مرورگر از decoder تولیدی گذشتند. SupportAgent/MFA و مشتری ساختگی مستقل، reply/close/reopen→سه اعلان، قطع یک پاسخ موفق read، retry همانID/body و زمان ReadAt دقیقاً یکسان، فیلتر دو unread، FA/EN، عدم کپی متن، logout→پنهان‌شدن، ورود دوباره→۳ اعلان/۱read/۲unread و لینک تیکت صحیح پذیرفته‌اند. از۱۴۴ جدول QA فقط Support/Inbox و User/Session/Audit مجاز تغییر کرد؛۱۳۶ جدول دیگر برابرند.۱ticket/۲message/۴event/۴command/۳notification/۳audit ثبت شد. GUID/keys/credentials و تب‌های54/55 پاک و QAports بسته‌اند. عرض۱۲۸۰/client=scroll۱۲۶۵ و log خطا/هشدار صفر؛ mobile پذیرفته نیست. تصاویر browser FA/EN بررسی شدند. `private-notifications52-source-acceptance.json` و wireها مرجع‌اند.

بکاپ و baseline تازه، migration صرفاً افزایشی `20261026061434_PrivateAccountNotifications` و برابری۱۴۲ جدول/schema/view قبلی موفق‌اند.۹۸۲ HTTP شامل۹۴۴ شاهد قبلی و حفظ۵۷۹ asset پنل/۲۱۵ Next و مرزهای401/no-store/noindex موفق است؛ پسHTTP هر۱۴۴ جدول برابر است. `private-notifications52-main-release.json` و before/after/post-smoke شواهدند. این پذیرش، SignalR/Push/SMS/Email یا کل SUPPORT-01 نیست.

## بخش‌های پذیرفتهٔ پیشین

[SUPPORT-CONTENT](SUPPORT-CONTENT.md): ویرایش/ترتیب/فعال‌بودن FAQ مستقل FA/EN، preview/publish/restore نسخه‌دار و SSR فقط انتشار در۵۱ پذیرفته و محفوظ است؛ محتوای واقعی اصلی را مدیر وارد می‌کند. [SUPPORT-TICKETS](SUPPORT-TICKETS.md): مکالمهٔ خصوصی SQL رمز‌شده، مالکیت، SupportAgent/MFA و journal. [PAYMENT-CORE](PAYMENT-CORE.md): هسته۵۰ با provider خاموش. [ORDER-FULFILLMENT](ORDER-FULFILLMENT.md): ارسال کامل صرفاً فیزیکی۴۸. جزئیات در [آرشیو پیش۵۲](archive/STATUS-before-private-notifications52-release.md) محفوظ‌اند.

## سورس جاری — SignalR خصوصی، هنوز منتشر نشده

ارتباط زندهٔ JSON/Long Polling با کلاینت رسمی10.0.11، مسیر هم‌مبدأ، bearer فقط header و lease رمز‌شدهٔ connectionToken مقید به حساب/jti/stamp/capability/audience پیاده شده است. Hub فرمان/JoinGroup دلخواه ندارد؛ pulse فقط schemaVersion/scope است، داده از API مجاز دوباره خوانده می‌شود. Queue پس از موفقیت pipeline/commit می‌فرستد؛ rollback/replay بی‌event و خرابی dispatch بی‌اثر بر SQL است. محدودیت بدنه/frame، منع JWTquery/SSE/WebSocket/stateful reconnect، reconnect و حفظ journal pending/unknown و deferred refresh حین mark-read در سورس‌اند. پروکسی پنل DELETE را فقط برای اتصال زنده می‌پذیرد و cookie را در آن مسیر منتقل نمی‌کند.

۱۹ واحد هدفمند و۱۲ آزمون قرارداد/کنترل اتصال/refresh و۴ proxy/typecheck موفق‌اند.۳ SQL واقعی binding/revocation/rollback و تحویل واقعی موفق شدند؛ نخست انتظار «بدون event برای حساب دیگر» فقط با نوع exception لغو TestServer شکست خورد و helper بدون تغییر سیاست محصول اصلاح شد. آزمون محدودیت audience و token تازهٔ همان حساب هم تقویت و در رگرسیون بعدی اجرا می‌شود. کل۳۷۶ آزمون فروشگاه و۲۱۲ پنل نیز موفق‌اند. رگرسیون کامل، wire غیرحساس تولیدی، مرورگر/reconnect/unknown، freeze و انتشار باقی‌اند. migration تازه انتظار نمی‌رود؛ اصلی۵۲ frozen و SQL اصلی دست‌نخورده است. [PRIVATE-REALTIME](PRIVATE-REALTIME.md) طرح و مراجع رسمی را دارد. log و artifact نباید negotiation یا query connectionToken/JWT را ذخیره کنند.

## کار بعدی برای D34 — ادامه بده

1. ارتباط زندهٔ مجوزدار SignalR برای تازه‌شدن تیکت/اعلان در دو صفحهٔ باز، با SQL به‌عنوان مرجع، reconnect/ابطال نشست/بدون نشت توکن یا مکالمهٔ دیگران؛ سپس فایل خصوصی و باقی SUPPORT-01. SMS/Email بدون D16 فعال نشود.
2. پرداخت زنده initiation/Start/Verify/callback/reconcile/sandbox/refund به قرارداد D16 وابسته است؛ موفقیت یا vendor API جعلی ساخته نشود و سؤال قبلی تکرار نشود. هلو live D30 و منابع مجاز بازار/نظر خارجی بازند.
3. ارسال جزئی/دیجیتال، مرجوعی/بازپرداخت، پرونده چک/مدارک خصوصی/سررسید، CMS پیشرفته/بلاگ، search/alert/loyalty و باقی PRD لازم‌اند؛ کل چرخه فروش/PDF کامل نیست.
4. mobile/WCAG/SEO/performance/CI/nativeLinux/load/offsitebackup و معیارهای۱۲گانه شاهد مستقل لازم دارند. هزینه/مالیات/شرایط واقعی گارانتی/مرجوعی/چک نامعلوم‌اند؛ mainSettings/Policy خاموش‌اند. D14 انتشار محلی،D21 نمونه فقط QA،D32 Redis روشن،D33 نگه‌داری tmp وD34 هدف کل پروژه حفظ‌اند.
