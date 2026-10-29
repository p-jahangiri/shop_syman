# Quote4؛ محاسبه و مرور پذیرفته، بدون سفارش توافقی

2026-10-24؛ **اصلی/سورس۳۵ محلی با واحد/SQL/wire/build، مرورگر نهایی و انتشار حفظ‌داده پذیرفته‌اند.** Cart2 نیز در اجرای جاری پذیرفته است. [STATUS](STATUS.md)، [Cart2](MARKET-CART2-SLICE.md) و [مسیر کامل انتقال](MARKET-ALLOCATION-CONVERSION.md) مرجع‌اند. این برش سیاست تجاری یا provider تازه تعیین نمی‌کند.

## مرز قابل تحویل

`POST /api/cart/{locale}/v2/quote` کل ordinary و accepted را با LineId مستقل، قیمت صحیح ریال و snapshot توافقی محاسبه و در صورت انتخاب روش، idempotent ذخیره کند؛ inquiry از مبلغ جدا بماند. رابط FA/EN فقط شرایط و محاسبه را مرور کند. تا Order2 و انتقال/لغو/انقضای موجودی، `TemporaryOrder.CanCreate=false` و blocker صریح `accepted_offer_order_unavailable` و `CanPay=false` اجباری‌اند؛ گیت checkout سبد توافقی برداشته نشود. ordinary/guest فعلی و Quote1–3 حفظ شوند.

ورودی همان چهار فیلد محدود `{cartVersion,methodId?,planId?,requestId?}` است؛ قیمت، تعداد، مالک، منشأ و مهلت از سرور می‌آیند. کاربر توافقی احرازشده و مالک باشد. UUID/نسخه/بدنه freeze و رسید/بازخوانی همان قواعد امنیتی Cart2 را حفظ کنند.

قرارداد اجرایی این برش به حساب احرازشده با حداقل یک خط توافقی محدود است؛ سبد صرفاً عادی/مهمان مسیر Quote3 خود را حفظ می‌کند. پاسخ `CheckoutQuoteV4Data` فیلدهای محاسبهٔ قبلی را با `lines:QuoteLineV4Data[]` و `canPay:false` دارد؛ `canPlaceOrder:false` و مانع سفارش توافقی همواره لازم‌اند. پیش‌نمایش بدون انتخاب روش، header ذخیره نمی‌کند ولی مهلت مرور کمینه را دارد؛ انتخاب روش UUID لازم دارد. فیلد ناشناخته در ورودی V4 رد می‌شود و قرارداد تاریخی V3 تغییر نمی‌کند. کنترل موجودی تمام SKUهای عادی، شامل دیجیتال، مطابق رفتار Quote3 حفظ است.

مرز قیمت‌ناشناس `IInventoryCheckoutOffers.AssertAsync(ownerId,requests,ordinary,ct)` آرایهٔ `SourcingCheckoutAllocationRequest(Plan,AllocationId,Version)` و `SourcingCheckoutOrdinaryLine(VariantId,Quantity)` می‌گیرد و `SourcingCheckoutInventoryProof(Allocations,OrdinaryAvailable)` می‌دهد. تمام قفل‌های acceptance، سپس resource و سپس Stock مرتب قبل از بررسی ظرفیت گرفته می‌شوند؛ شمارنده، claim، سریال و مهلت تغییر نمی‌کنند. proof محاسباتی از invariant نویسندگان تخصیص استفاده می‌کند؛ انتقال claim به سفارش متعلق به Order2 است.

خط Quote4: LineId، LineKind، VariantId، quantity، product/seller/category/SKU، name/label/warranty/isDigital، مبلغ‌های رشته‌ای و `priceVersion:null|string`. فیلد `accepted` برای ordinary صریح null و برای پیشنهاد شامل conversion/agreement/agreementLine/request/task/offer/acceptance/allocation/offerLine/TermsHash، نسخه‌های Agreement/Allocation و PurchaseUntil/AllocationExpiresAt است. چند توافق و ordinary یک SKU خط/قیمت خود را حفظ می‌کنند. public price مرجع مبلغ توافقی نیست.

## اختیار و ترتیب قفل

SalesTransactionCoordinator فعلی فقط Sales/Inventory را هماهنگ کند؛ Market context/request/task در checkout وارد نشود. Agreement زنده و مصرف‌نشده + تخصیص دقیق مالک، با current Catalog/material/configuration، اختیار خریدند. close موجود پیش از Inventory release از Agreement عبور می‌کند. projection Market در Order2 آینده از outbox پس از commit بیاید و capability حساس نسازد.

ترتیب quote: cart shared → quote command/replay → Agreementها مرتب بر AcceptanceId → Inventory acceptance/resourceها مرتب → ordinary Stock مرتب. یک raw whole-cart reader داخلی، پیش از hydration/Stock همهٔ سه بخش و نسخه را بخواند. **CartV2Service.ReadAsync helper آماده‌سازی checkout نیست:** پیش از برگشت Stock عادی را خوانده و پس از آن گرفتن allocation می‌تواند ترتیب را معکوس کند. سرویس جدید نباید Market را پس از cart بخواند.

تمام خطوط/تعداد هر Agreement، منشأ Allocation نخست، material/current publication و روش خرید دوباره سنجیده شوند. reallocation خودکار دنبال نشود. Inventory proof فقط قیمت‌ناشناس و فقط‌خواندنی است. accepted-only با PublicAvailable=0 در صورت سهم کامل معتبر است؛ ordinary مستقل از سهم توافقی، PublicAvailable کافی می‌خواهد.

مهلت Quote4 کمینهٔ عمر۵دقیقهٔ فعلی quote، تمام PurchaseUntilها و deadline سهم‌هاست. پس از انتظار قفل و پیش از ذخیره clock دوباره سنجیده شود. replay، عمر را تمدید نکند و تاریخچه را به موفقیت خرید جاری تبدیل نکند. overflow ضرب/جمع و بودجهٔ body صریح و بدون truncate رد شوند.

## مدل افزایشی پیاده‌شده

Sales migration `20261024045600_CheckoutQuotesV4` پس از۳۴: ستون nullable `CheckoutQuote.ContractVersion`؛ قدیمی‌ها null می‌مانند، Quote3 تازه۳ و Quote4 تازه۴ می‌نویسد. replay دو قرارداد پیش از deserialize جداست؛ UUID قدیمی نمی‌تواند پاسخ V4 یا برعکس بدهد.

`CheckoutQuoteLinesV4` با PK `(QuoteId,LineId)` و FK به header موجود، قید LineKind/provenance، محدودهٔ شناسه/تعداد و برابری checked مبلغ ساخته شود. CheckoutQuoteLines/Installments/OrderLines، کلیدها و JSONهای تاریخی دست نخورند. Down در حضور هر header/line V4 پیش از DDL رد شود؛ حذف تاریخچهٔ idempotency مجاز نیست. نام/شکل نهایی مدل پیش از تولید migration با سورس تطبیق داده شود.

فایل‌های مورد انتظار: SharedKernel proof محدود، Sales raw reader و QuoteV4 DTO/model/service، marker و replay guard Quote3، SalesDbContext/migration، Inventory proof، root route/DI و decoder/BFF/review UI. calculator چک/هزینه و intersection روش‌ها مشترک بمانند؛ fingerprint عمومی Quote3 نباید قیمت عمومی را authority توافقی کند.

## پذیرش پیشین پیش از اصلاح رابط؛ شواهد تاریخی

در برش نخست،۷۳۸ واحد بک‌اند،۳۹۸ SQL واقعی و۲۶۹ فروشگاه، typecheck، buildهای API/Next و EF بدون pending model پذیرفته‌اند. SQL هدفمند۳۶ پس از چهار اصلاح fixture/observer/مرز migration موفق و رگرسیون کامل۳۹۸ با صفر fail/skip است. ۸ پاسخ واقعی HTTP از `scripts/verify-quote4-wire.mts` گذشتند؛ `artifacts/checks/quote4-wire/quote4-wire-report.json` hash هر body، دو زبان/سه قیمت/expired replay و fence سفارش/پرداخت را ثبت می‌کند. در این run request body ثبت نشد. SQL idempotent تولید شده؛ اجرای مستقیم آن ادعا نمی‌شود. لاگ‌های ناموفق نخست حفظ‌اند؛ STATUS علت و اصلاح‌ها را شرح می‌دهد.

HTTP متصل مستقل در GUID تازه با همان API/Next پذیرفته و پاک شد: FA/EN preview/save، دو پاسخ200 commitشدهٔ ازدست‌رفته، سه body خام/UUID یکسان و فقط یک header همان فرمان، مجموع۲header/۴line و۹۱ جدول دیگر ثابت. `quote4-ui-http-report.json` و `quote4-ui-cleanup.json` hashها، صفر سفارش/رزرو/تنظیمات و حذف GUID/کلید/credential/بستن پورت‌ها را ثبت می‌کنند. این HTTP، آزمون رفتار رابط نیست. آن زمان مرورگر/موبایل و انتشار باقی بود و native Mac قفل گزارش می‌شد؛ بعداً IAB بدون unlock قابل استفاده بود و پذیرش نهایی در بخش پایانی همین سند ثبت شد. موارد زیر معیارهای این برش‌اند:

- SQL واقعی ordinary + دو Agreement همان SKU با سه LineId/قیمت، مقدار بالای۲^۵۳ و inquiry مستقل؛ accepted-only با available صفر و ordinary capacity جدا.
- قیمت عمومی تازه مبلغ توافقی را تغییر ندهد؛ material/publication/warranty/method نامعتبر fail-closed باشد. گروه ناقص، stale، reallocation/revoke/expiry/مالک دیگر هیچ اثر موجودی/سفارش نسازند.
- replay همان UUID/body، ID/line/deadline را حفظ کند؛ body یا قرارداد دیگر conflict. Quote1–3/Order1 و replay تاریخی رگرسیون داشته باشند.
- رقابت واقعی با release/expiry/reallocation/Stock، چند Agreement با ترتیب ID متفاوت از SKU، مرز deadline و انتظار تا پس از آن آزموده شود.
- migration دارای داده، Down history guard، wire HTTP واقعی، FA/EN و عرض واقعی موبایل، قطع پاسخ و recovery. فقط quote اثر تازه باشد؛ counter/claim/Agreement consumption/Order/payment ثابت بمانند.

## مرز فعال‌سازی Order2 بعدی

[MARKET-ORDER2-BOUNDARY](MARKET-ORDER2-BOUNDARY.md) طرح خواندن کد برای انتقال/entitlement/لغو را شرح می‌دهد؛ هنوز کد نیست. Quote4 محاسباتی تاریخی برای سفارش مجاز نشود؛ Quote5 و route/decoder مستقل برای capability تازه پیشنهاد شده‌اند.

OrderService فعلی پیش از cart، سفارش‌های دیگر را با reservation/Stock منقضی می‌کند؛ این Stock→cart وارد Order2 نشود. Hold فعلی VariantId یکتا و `now+Lifetime` دارد؛ خطوط قیمت تکراری را مستقیم به آن ندهید و deadline مطلق را به duration پیش از انتظار تبدیل نکنید. RemoveReserved/Assign فعلی claim توافقی را رد می‌کنند و LineId ندارند. read/list/detail/cancel قدیمی فقط Lines قدیمی را می‌بینند؛ درج OrderLinesV2 بدون reader تازه سفارش خالی می‌سازد.

Order2 فقط همراه قرارداد واقعی HoldOrderWithAllocations، نگاشت پایدار line entitlement و انتقال اتمیک `SourcingReserved→Reserved`، claimهای OrderHeld با منشأ ثابت و OrderLineId، Agreement consumption، مصرف cart و outbox ساخته شود. لغو/انقضا هر دو حالت assigned و unassigned را یک‌بار آزاد کنند و Agreement/allocation را احیا نکنند. پرداخت/fulfillment تا پذیرش قرارداد دقیق همان خط خاموش بماند؛ هیچ پرداخت ساختگی لازم نیست.


## پذیرش نهایی و انتشار محلی۳۵

نسخهٔ نخست2Graw در UI دکمهٔ مرور را از cartIssue ممنوعیت سفارش می‌گرفت؛ اصلاح `quoteReviewIssue` و notice پس از conversion با۲۷۴تست/build/typecheck مستقل پذیرفته شد. گزارش و تصویر شکست محفوظ‌اند. `quote4-browser-final-report.json` روی build sVP5K1g5H12sjHHMi5pGf و۱۳DLL/APIc649...، ورود/تبدیل واقعی یک‌بار، فارسی/انگلیسی موبایل390×844 و دسکتاپ1280×720، جمع دقیق و بدون overflow/console error را می‌پذیرد. دو UUID، هریک دو پاسخ200 قطع‌شده و replay سوم با body ثابت، و401/refresh503 واقعی با پنهان‌شدن دادهٔ خصوصی/احراز دوبارهٔ همان مالک/فرمان اولیه پذیرفته‌اند.۷body درخواست خام strict decoder و SQL سه header/شش خط با۹۱جدول دیگر ثابت و صفر اثر سفارش/رزرو/مالی دارد. GUID/credential/key/controls و پورت‌های QA پاک و viewport reset است.

`quote35-main-release.json` انتشار جاری۳۵ را ثبت می‌کند: بکاپ تازهٔ۱۴٬۷۹۸٬۸۴۸بایت،۱۰۵جدول قدیمی و چهار quote/چهار line/۲۴installment محفوظ، marker قدیمی null و جدول V4 خالی؛ Stock/Available/JSON/rowversion/CMS/حساب‌ها ثابت، DBCC0 و۹۲GET و guard پس از startup موفق‌اند. API5080 و Next3000 از artifact پذیرفته با۱۱۵static قبلی اجرا می‌شوند؛ admin3173/QR همان نسخهٔ قبلی است. `quote4-acceptance.json` و candidateها snapshot ثابت پیش از انتشارند؛ وضعیت جاری از release و runtime-current خوانده شود.

ترتیب بعد [MARKET-ORDER2-BOUNDARY](MARKET-ORDER2-BOUNDARY.md) پیش‌نویس است؛ هنوز سفارش توافقی/انتقال سهم/پرداخت ساخته نشده و کل پروژه کامل نیست. متن‌های پذیرش قبلی این سند تاریخی‌اند؛ STATUS اجرای جاری را مشخص می‌کند.
