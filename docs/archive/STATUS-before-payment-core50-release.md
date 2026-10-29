# وضعیت و نقطهٔ ادامه

آخرین به‌روزرسانی: 2026-10-26. **اصلی محلی۴۸، ارسال فیزیکی سفارش همراه نسخهٔ بسته/تاریخچه پذیرفته و منتشر است؛ کل پروژه/PDF هنوز کامل نیست.** هدف D34 تکمیل همهٔ بخش‌هاست. پایان یک برش، پایان هدف نیست.

## اجرای اصلی محلی۴۸

- API: http://127.0.0.1:5080، PID1341/session17512؛ runtime `tmp/api-runtime-order-shipment48-96534105235445878b7756244ebaf3ac`؛ restart: `python3 tmp/order-shipment48-release.py serve-api`.
- فروشگاه: http://127.0.0.1:3000، PID1310/session79986؛ build تازه `BRPi6Ov6taJV5TsW52n7B`،۳۳۴تست؛ runtime اصلی از descriptor؛ restart: `python3 tmp/order-shipment48-release.py serve-storefront`.
- پنل: http://127.0.0.1:3173، PID1337/session83262؛۲۱۱تست؛ restart: `node tmp/serve-order-shipment48-main-admin.mjs`؛ proxy ثابت `tmp/admin-server-source48.mjs`.
- `tmp/{api,storefront,admin}-runtime-current.json` مسیر/PID/hash دقیق را دارند. تمام runtimeهای۴۷ و وابستگی restart/rollback محفوظ‌اند؛ writer قدیمی علیه schema۴۸ خودکار اجرا نشود. preview خاموش و API mode فعال است.
- SQL۴۸migration/۱۳۳جدول/۹schema؛ فقط۴جدول خالی ارسال Sales اضافه شدند. Stock101/0/0، Orders/Reservations/Settings/Policies صفر و CMS دو زبان site3/auth1 محفوظ‌اند. Redis پارسه طبقD32 running و دست‌نخورده است.
- بکاپ پیش۴۸:۱۸٬۹۹۳٬۱۵۲بایت COPY_ONLY/CHECKSUM/VERIFYONLY با کلید خصوصی؛ `main-pre48-release-backup.json`. tmp شامل runtime جاری/بازگشت/کلید/بکاپ است؛ کامل پاک نشود.

## سوابق پیشین

هلو manualapply۴۷، اصلاح لینک تنوع و منوی CMSبازار revision3 قبلاً پذیرفته و منتشر شدند؛ شواهد آن‌ها و مسیرهای rollback در [آرشیو پیش۴۸](archive/STATUS-before-order-shipment48-release.md)، HOLOO-STOCK-APPLY و MARKET-NAVIGATION محفوظ‌اند. runtime جاری و اقدام بعدی فقط از همین STATUS خوانده شوند.

## ارسال فیزیکی سفارش، اصلی۴۸ پذیرفته

[ORDER-FULFILLMENT](ORDER-FULFILLMENT.md) و A46 قرارداد را ثبت می‌کنند. چرخهٔ pack/repack/dispatch/deliver فقط Paid/Allocated واقعی با دستگاه‌های کامل، نسخه‌ها و fingerprint مرورشده مجاز است؛ هیچ endpoint پرداخت مصنوعی ساخته نشد. تغییر facts نیازمند بازبینی صریح و revision بعدی append-only است. رسید actor+UUID/hash، GET تاریخی، rootSerializable/audit، خروج Stock دقیقاً یک بار و تحویل مشتری بدون ledger دوباره حفظ‌اند. مشتری فقط سفارش خودش و IMEI پس از خروج را در FA/EN می‌بیند؛ حمل‌کننده/رهگیری دستی با تأیید زمان واقعی است.

۸۷۲ واحد، کل۵۸۵ SQL،۳۳۴ فروشگاه،۲۱۱ پنل،۳proxy با۱۳ثانیه تأخیر واقعی، build/typecheck/model و۱۰wireSQL+۳بدنه،۶wireمرورگر+۶بدنه موفق‌اند؛۱۳DLL محصول در واحد/SQL/harness/runtime برابرند. رگرسیون نخست۷شکست آزمون guard تاریخی داشت؛ baseline خود Sales به migration Order2 خودش pin شد؛ guard محصول تغییر نکرد، کل۵۸۵ نهایی موفق‌اند. نسخهٔ نخست migration منتشرنشده بایگانی و نسخهٔ نهایی `20261025223205_OrderShipments` دارای revision پاک scaffold شد.

مرورگر GUID مستقل: سفارش مصنوعی Paid/Allocated دوخطی/۳واحد و یک IMEI؛ دو پاسخ200 pack و دو پاسخ200 dispatch قطع، هر دو retry byte/UUID یکسان، ناوبری/GET رسید، منع dispatch پس از تغییر صریح fixture گارانتی QA، repack revision2 و GET رسید revision1 پس از تحویل موفق‌اند. pack بدون Stockwrite، dispatch یک ledger برای هر خط، delivery بدون Stockwrite؛ تمام جداول دیگر دامنه و مبالغ/خطوط snapshot محفوظ. QA/کلید/credential و تب‌های46/47 پاک، پورت‌های QA بسته‌اند؛1280/client=scroll1265، mobile پذیرفته نیست. `order-shipment-browser-acceptance.json` و screenshotهای `order-shipment-browser-{admin,customer-fa,customer-en,device-fa}.png` محفوظ‌اند.

پس از بکاپ تازه۱۸٬۹۹۳٬۱۵۲بایتی COPY_ONLY/CHECKSUM/VERIFYONLY و کلید خصوصی،۴جدول خالی Sales اضافه شد: OrderShipments/Lines/Units/Commands.۱۲۸جدول قدیمی به‌جز SalesEFhistory و تمام schema/viewها عین baseline تازه محفوظ‌اند؛۱۳۳جدول/۴۸migration.۸۱۵HTTP یکتا شامل پوشش۱۴۶۷شاهد پیشین،۴۷۹assetقبلی پنل و۱۸۷Next و تمام جدیدها و401/no-store موفق؛ پس ازHTTP هر۱۳۳جدول دقیقاً برابرند. CMSsite revision3/auth1، Stock101/0/0 و settings/policies/orders/reservations صفر؛ هیچQA/provider/policyنمونه به اصلی منتقل نشد. `order-shipment48-main-release.json` و source-acceptance و before/after/post-smoke مرجع‌اند.

## کار جاری: هسته/سوابق پرداخت نقدی، سورس۵۰ منتشرنشده

[PAYMENT-CORE](PAYMENT-CORE.md) طرح و وابستگی درگاه واقعی را ثبت می‌کند. اصلی۴۸/۱۳۳جدول محفوظ است. سورس دو migration افزایشی دارد: Sales `20261025231229_CashOrderPaymentLinks` یک لینک immutable و Payments `20261025231645_CashPaymentAttempts` سه جدول attempt/event/verification؛ مجموع۵۰/۱۳۷جدول در QA. Down در حضور history بسته است، تمام SaveChangesguardها، authority رمز‌شده مقید به AttemptId و registry پیش‌فرض خالی‌اند. هیچ endpoint عمومی دریافت proof/ثبت Paid یا successadapter در محصول وجود ندارد.

آماده‌سازی پایدار از مبلغ/نسخه/fingerprint تاریخی سرور با binding صریح method→provider/account و rootSerializablePayments/Sales/Inventory/قفل مشترک مالک، UUID/body ثابت و منع تلاش unresolved دوم ساخته شد. فاز SQL تسویه فقط پس از Verify سروری آینده قابل استفاده است؛ amount/authority/reference، snapshot و سهم دقیق snapshot2 را می‌سنجد. Paid/Allocated/لینک/verification/event اتمیک‌اند؛ دیررس/لغوشده/ناسازگار review و بدون تغییر تجاری است. replay بعد از ارسال رسید اصلی را حفظ می‌کند. network داخل transaction نیست؛ initiationlease/فراخوانی واقعیVerify/reconcile/callback vendor و شروع پرداخت مشتری هنوز باز و به قراردادD16وابسته‌اند. canPayمحصول false می‌ماند.

۳۹SQLهدفمند، شامل snapshot2 توافقی با همانSKU/قیمت۲^۵۳ و انتقال سهم تا ارسال/تحویل بدون انتساب مستقیم Paid موفق‌اند. رویداد/تسویهٔ سه ماژول، rollback پس از SalesSave، رقابت لغو/verify، review/reference، allSaveChanges، Productiondemo، nullableSQLCHECK و rootDeadline آزموده‌اند. خطاهای fixture DDLپارامتری و hashتکراری اصلاح شدند، نه guard محصول. ۸۸۴واحد نهایی موفق؛ کلSQL۵۰ در حال اجرای رگرسیون است. یک build با137 بی‌خروجی متوقف شد؛ dotnet سالم/فضا۲۱GiB بود؛ build با heap۱GiB محدود دوباره بدون هشدار موفق شد؛ سرویس دیگری متوقف نشد.

خواندن خصوصی GET مشتری orders/attempts و مدیر با هر دوfinance.read+sales.read، no-store و seek۵۰مقید به scope/فیلتر ساخته شد. headerverified بدون evidence و اختلاطdemo/واقعی failclosed است؛ authority/reference/owner/configخام بیرون نیستند. BFF GET-only، contractstrict، سوابق FA/EN مشتری، صفحهٔ lazy مالی پنل و دسترسی ترکیبی/پس‌گرفتن صفحه پیاده‌اند.۳۴۱فروشگاه/۲۱۲پنل/typecheck/buildهای مستقل مثبت‌اند. PWA از تمام/api دوری می‌کند، ورودی پرداخت به آزمون آن افزوده شد. شش wire واقعیSQL با decoder تولیدی در `payment-core-wire-final/payment-core-sql-wire/acceptance.json` پذیرفته‌اند؛ wire نخست حذف nullفیلتر را کشف کرد، DTOسرور با nullصریح اصلاح شد و decoder شُل نشد. ورودی factدرگاه فقط داخلیِ QA است و wireHTTPپرداخت واقعی نیست.

PaymentHarnessSeed و flagصریح `SHOP_UI_PAYMENT_QA=1` برای GUID تازه/operations، سه نمونهٔ روشن pending/verified/review، D21سیاست12345/بدون‌مالیات‌جدا/۶۰دقیقه/۲سفارش و بدون هیچ networkدرگاه نوشته شد؛ هنوز build/مرورگر آن انجام نشده است. fixtureGateway فقط executableآزمون است و productDIregistryخالی می‌ماند. buildharness، rawwire نهاییِ artifactهای ثابت، browserFAEN/نقش/cleanup، backup/حفظ اصلی و انتشار۵۰ بعدی‌اند. این پیشرفت اتصال درگاه یا تکمیل کلPDF نیست.

## کار بعدی برای D34 — ادامه بده

1. هستهٔ پرداخت: intent/attempt پایدار، قرارداد provider واقعی، callback تأییدشده و تطبیق مبلغ/سفارش، idempotency و همزمانی با انقضا/لغو/تخصیص. D16 provider نامعلوم است؛ محصول موفقیت مصنوعی نسازد. سپس تکمیل ارسال جزئی/دیجیتال، مرجوعی/بازپرداخت، پروندهٔ چک/مدارک، CMS پیشرفته، support/notification و کلPDF طبقPLAN. ارسال کامل صرفاً فیزیکی۴۸ پذیرفته است؛ کل چرخهٔ فروش/PDF کامل نیست.
2. mobile/accessibility/SEO/performance/CI/native Linux/load/offsite backup و معیار۱۲گانه بازند؛ scaffold کامل نیست. D14 انتشار محلی/API/admin مجاز؛ D16 provider نداریم؛ D21 سیاست نمونه فقط QA؛ D32 Redis روشن؛ D33 پاک‌سازی۱٫۶۷GiB؛ D34 کل پروژه. هزینه/مالیات/شرایط واقعی گارانتی و مرجوعی و درصد چک نامعلوم‌اند. داده/نظر خارجی و هلو زنده قرارداد معتبر می‌خواهند؛ scrape/جعل نشوند.

سوابق۴۶/۴۷ و شواهد هر برش در [آرشیو](archive/STATUS-before-market-navigation47-release.md) و اسناد هر قابلیت محفوظ‌اند.
