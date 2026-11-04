# Order2؛ قرارداد پیاده‌شدهٔ خرید اقلام توافقی

2026-10-24؛ **کد، سه migration افزایشی و رابط فروشگاه/پنل پیاده شده‌اند؛۱۷بدنهٔ خام پاسخ واقعی SQL HTTP از decoderهای strict محصول گذشته‌اند،۲۹۲تست فروشگاه/۱۸۰پنل، typecheck و buildهای ایزوله موفق‌اند. ۷۸۳واحد و۴۶۴SQL واقعی نهایی با صفرfail/skip پذیرفته‌اند؛ مرورگر، restore۳۸ و انتشار Order2 هنوز معوق‌اند.** [گزارش مستقیم wire](../artifacts/checks/order2-wire-final/order2-wire-report.json) فقط پاسخ‌های captureشده را بدون normalization و با hash اصلی می‌پذیرد؛ درخواست مرورگر، اثر موجودی یا نتیجهٔ نهایی رقابت‌ها از آن نتیجه نمی‌شود. این سند قرارداد سورس۳۸ را از روی کد ثبت می‌کند. اجرای اصلی پذیرفته‌شده همچنان۳۵ است؛ candidate یا build موفق، شاهد ارتقای اصلی یا صحت SQL نیست. وضعیت اجرای آزمون‌ها و runtime فقط از [STATUS](STATUS.md) خوانده شود.

[Quote4](MARKET-QUOTE4-SLICE.md)، [Cart2](MARKET-CART2-SLICE.md) و [مسیر تخصیص](MARKET-ALLOCATION-CONVERSION.md) مراجع مرحله‌های قبلی‌اند. سیاست ارسال/مالیات، تنظیم واقعی چک و provider تازه‌ای با این پیاده‌سازی تعیین نشده‌اند. تنظیم سفارش موقت اصلی همچنان خاموش است؛ هیچ داده یا سیاست مالی QA به اصلی منتقل نمی‌شود.

طبق D32 در [DECISIONS](DECISIONS.md)، Redis چت Parseh عمداً روشن است و روشن می‌ماند؛ دستور قدیمی D17 دربارهٔ خاموش‌ماندن همین کانتینر با این تصمیم جایگزین شده است. QA فروشگاه مجوز توقف یا restart آن نیست.

## Quote5 مستقل و حفظ Quote4

`POST /api/cart/{fa|en}/v2/order-quote` برای مشتری احرازشده اضافه شده است. ورودی strict فقط `{cartVersion,methodId,planId,requestId}` است؛ owner، تعداد، قیمت، سهم موجودی یا شروط توافق از مرورگر پذیرفته نمی‌شوند. بدون method، پاسخ preview با `quoteId:null` و مهلت محدود می‌آید؛ ذخیره با انتخاب method و UUID درخواست است. حداقل یک خط پذیرفته‌شده لازم است؛ ordinary-only از Quote3 قبلی استفاده می‌کند.

پاسخ `schemaVersion:5` از نظر مبلغ/روش/هزینه‌ها با ساختار Quote4 هم‌خانواده است، اما DTO، decoder، endpoint و marker جدا دارد. `canPlaceOrder:false` و `canPay:false` دائمی‌اند. فقط `temporaryOrder.canCreate` می‌تواند برای روش نقدی online فعال و بدون approval، هزینه‌های معلوم، مبلغ مثبت و تنظیم صریح معتبر true شود. این اجازهٔ ساخت سفارش پرداخت‌نشده است؛ اتصال درگاه یا مجوز پرداخت نیست. نبود تنظیم معتبر با مقدار فرضی توسعه دور زده نمی‌شود.

Quote4 در `/v2/quote` برای همیشه calculator است. snapshot و replay نسخه۴ به۵ تبدیل نمی‌شوند. markerهای `null/3`،۴ و۵ قبل از deserialize جدا می‌شوند؛ UUID مشترک actor-bound در قرارداد دیگر conflict می‌دهد. Quote5 از `CheckoutQuotes` و خطوط LineIdدار `CheckoutQuoteLinesV4` استفاده می‌کند؛ نام مشترک جدول، قرارداد۴ را تغییر نمی‌دهد.

هر خط Quote5 دارای `lineId,lineKind,variantId,productId,sellerId,categoryId,sku,name,label,warranty,isDigital,quantity,unitPriceRial,lineTotalRial,priceVersion,accepted` است. `priceVersion` و `accepted` صریحاً null یا مقدارند. خط ordinary قیمت/نسخهٔ فعلی Catalog دارد و accepted=null است. خط acceptedOffer غیر‌دیجیتال، مقدار ثابت و قیمت پذیرفته‌شدهٔ immutable دارد و priceVersion=null است. چند خط مستقل و چند Agreement برای یک SKU مجازند؛ inquiry در مبلغ وارد نمی‌شود.

`accepted` علاوه بر provenance نسخه۴، `revision,snapshotHash,termsFa,termsEn,materialFingerprint,containsDemo` دارد. provenance کامل شامل `conversionId,agreementId,agreementLineId,requestId,taskId,offerId,acceptanceId,allocationId,offerLineId,termsHash,agreementVersion,allocationVersion,purchaseUntil,allocationExpiresAt` است. شرایط دو زبان، نام/تنوع/گارانتی و مبالغ توافقی از Sales snapshot خوانده می‌شوند؛ قیمت عمومی امروز جایگزین آن‌ها نمی‌شود. publication، هویت مادی SKU و محدودیت‌های جاری روش/دسته/طرح دوباره بررسی می‌شوند.

fingerprint خطوط و شرایط کامل، eligibility جاری، method/plan، قواعد هزینه و نسخهٔ تنظیم سفارش را پوشش می‌دهد. اعتبارسنجی سفارش، `CreatedAt/ExpiresAt` ذخیره‌شده را هنگام محاسبهٔ دوباره حفظ می‌کند. replay همان UUID/body snapshot و مهلت قبلی را برمی‌گرداند؛ expired یا فاقد authority جاری، `temporaryOrder.canCreate:false` و blocker مربوط می‌گیرد. احراز هویت و منع demo در Production در replay هم باقی‌اند. replay قبلی، تخصیص یا رضایت مصرف‌شده را احیا نمی‌کند.

## API سفارش و تاریخچهٔ مخلوط

| مسیر | قرارداد و policy |
|---|---|
| POST `/api/orders/v2` | customer؛ `{quoteId,requestId,contactName,contactPhone,delivery,note,acknowledgeTemporary:true}`؛ nested delivery نیز strict؛ نخست201 و replay200 |
| GET `/api/orders/v2` | customer؛ owner از principal، cursor حداکثر۲۰۰، صفحه۲۰ و جدیدترین ابتدا |
| GET `/api/orders/v2/{id}` | customer؛ جزئیات همان مالک؛ غایب و مالک دیگر404 یکسان |
| POST `/api/orders/v2/{id}/cancel` | customer؛ `{version}` و فقط گردش لغو سفارش پرداخت‌نشده |
| GET `/api/admin/orders/v2` | sales.read/MFA؛ summary با ownerId؛ بدون نام/تلفن/نشانی |
| GET `/api/admin/orders/v2/{ownerId}/{id}` | sales.write/MFA؛ detail خصوصی |
| POST `/api/admin/orders/v2/{id}/cancel` | sales.write/MFA؛ `{ownerId,version}`، هماهنگ با transaction/audit مدیریت |

ورودی‌های جدید unknown member را رد می‌کنند؛ مبدأ مجاز، rate limit، سیاست customer یا staff و transaction filter قبلی حفظ‌اند. اطلاعات تماس/نشانی با قواعد نرمال‌سازی موجود سفارش بررسی می‌شوند. ساخت سفارش، قیمت یا LineId انتخابی از client نمی‌گیرد.

detail همواره `schemaVersion:2` و `originalSnapshotVersion:1|2` دارد؛ summary نیز نسخهٔ اصلی را می‌دهد. نسخه۱ نمایش سازگار تاریخچهٔ `SnapshotVersion=NULL` است؛ کلید، JSON، مبالغ، خطوط قدیمی و مهلت اصلی بازنویسی نمی‌شوند. LineId نمایشی پایدار برای خط قدیمی از سفارش/SKU ساخته می‌شود و entitlement نیست؛ categoryId قدیمی null و priceVersion نامعلوم/غیرcanonical در نمایش null است. نسخه۲ از `OrderLinesV2` با کلید `(OrderId,LineId)` و snapshot کامل همان Quote5 استفاده می‌کند. LineId و قیمت مستقل خطوط یک SKU در detail حفظ می‌شوند.

readerهای قدیمی Order1، Inventory و serial برای marker جدید صریحاً upgrade/conflict می‌دهند؛ سفارش V2 با خطوط خالی یا جمع صفر به‌عنوان تاریخچهٔ قدیمی نمایش داده نمی‌شود. مسیرهای V2 فهرست/جزئیات/لغو، هر دو نوع سابقه را می‌خوانند. replay ساخت Order2 پیش از گیت فرمان تازه انجام می‌شود؛ همان owner/UUID با payload دیگر یا قرارداد Order1 conflict می‌دهد. یک quote فقط به یک سفارش تعلق می‌گیرد. replay سفارش موجود فقط lifecycle همان سفارش را بررسی می‌کند.

## تراکنش، قفل و انتقال واقعی موجودی

Sales/Catalog/Inventory/Payments/Credit در composition root، یک connection و transaction مشترک Serializable دارند. ماژول‌ها DbContext یکدیگر را نمی‌خوانند. Market context وارد checkout نمی‌شود.

ترتیب فرمان جدید Order2 در کد چنین است: `order-owner → replay/quote uniqueness → cart exclusive → Agreementها به ترتیب AcceptanceId → Inventory request/order/reservation → تمام acceptanceها مرتب → تمام allocation resourceها مرتب → Stockهای متمایز مرتب → units مرتب → claims`. اعتبارسنجی Quote5 سفارش پیش از Hold، Stock نمی‌خواند؛ proof نهایی و تغییر موجودی در همان Hold انجام می‌شود.

خواندن‌های هدفمند زیر، در همان transaction Serializable و پس از گرفتن دامنهٔ application lock مربوط، صریحاً `READCOMMITTEDLOCK` دارند:

- `OrderCommandQueries` فقط برای فرمان‌های Order1/2، headerهای همان owner شامل replay/quote uniqueness/open-count و خطوط immutable/رویدادهای سفارش موجود را زیر قفل exclusive مشترک `order-owner` می‌خواند. خطوط و رویدادها پس از یافتن header خوانده می‌شوند؛ indexهای یکتا و اعتبارسنجی quote متعلق به owner همچنان یکتایی را اعمال می‌کنند.
- `CartService` زیر قفل هویت cart، header و هر سه مجموعهٔ `CartLines/CartSourcingLines/CartOfferLines` را می‌خواند؛ header غایب باعث خواندن children نمی‌شود. خواندن قفل Shared، mutation قفل Exclusive و merge قفل دو هویت به ترتیب canonical دارد؛ همان دامنه، graph کامل cart را محافظت می‌کند.
- Inventory هویت replay رزرو و یکتایی order را زیر قفل‌های request/order/reservation، و Items/entitlement/transferهای immutable را زیر دامنهٔ رزرو یا تخصیص مربوط می‌خواند. این تغییر شامل کنارگذاشتن قفل نوشتن allocation، Stock، unit یا claim نیست.

این انتخاب پس از دو graph واقعی `system_health` است: ابتدا range روی `Orders.PK` در برابر Stock و سپس range روی `CartOfferLines.PK` در برابر Stock. حذف rangeهای خواندنِ فرمان، چرخهٔ میان دو owner نامرتبط را هدف می‌گیرد؛ [graph نخست](../artifacts/checks/order2-coexistence-deadlock-current.json) و [graph دوم](../artifacts/checks/order2-coexistence-deadlock-after-rangefix.json) شواهد شکست قبلی‌اند. Serializable در root، قفل‌های Catalog/config/Agreement و `UPDLOCK,HOLDLOCK` نوشتن موجودی باقی‌اند. قفل سراسری create یا retry خودکار برای پنهان‌کردن deadlock اضافه نشده است؛ دو آزمون مستقیم هم‌زمانی و رگرسیون۴۶۴نهایی بدون retry موفق‌اند؛ STATUS و order2-source-acceptance.json مرجع دقیق‌اند.

فرمان‌های ایجاد Order1 و Order2 دیگر سفارش‌های دیگر را در همین transaction منقضی نمی‌کنند. workerها در transaction کوتاه مستقل موجودی due را آزاد می‌کنند؛ تا آن زمان available محافظه‌کارانه کمتر است. سقف سفارش باز، AwaitingPayment واقعاً due را فعال نمی‌شمارد. این ترتیب مانع برگشت Stock→Agreement یا Stock→cart در فرمان جدید است.

مرز داخلی قیمت‌ناشناس در `Shop.SharedKernel/StockOrderReservationsV2.cs` شامل `StockOrderHoldV2Request` با owner/order/request و **ExpiresAt مطلق**، خطوط `(LineId,VariantId,Quantity,AllocationId?,OfferLineId?)` و plan/version کامل تخصیص‌هاست. `IStockOrderReservationsV2`، Hold/Read/Allocate/Release/Fulfill/ExpireIfDue و entitlement هر خط را می‌دهد. تعداد کل خطوط حداکثر۶۴ و جمع مقدار هر SKU حداکثر۱٬۰۰۰٬۰۰۰ است. پوشش هر سهم باید کامل و متعلق به همان owner/پذیرش/خط/تعداد باشد؛ قیمت و متن تجاری وارد Inventory نمی‌شوند.

پس از همهٔ انتظارها، اصل و نسخهٔ allocation، مهلت‌ها، tracking mode، claim و دستگاه دقیق دوباره بررسی می‌شوند. برای مقدار توافقی A و ordinary O یک SKU:

```text
require A <= SourcingReserved
require O <= OnHand - Reserved - SourcingReserved
SourcingReserved -= A
Reserved += A + O
```

`ReservationItems` یک ردیف تجمیعی برای هر SKU نگه می‌دارد؛ `ReservationLineEntitlements` با PK `(ReservationId,LineId)` خطوط مستقل را حفظ می‌کند. انتقال توافقی به‌تنهایی available عمومی را تغییر نمی‌دهد. `SourcingAllocationTransfers` با PK AllocationId یک تاریخچهٔ immutable و یکتا می‌سازد؛ allocation به `Transferred/IsActive=false` و claim دقیق از AllocationHeld به OrderHeld فعال با OrderId/ReservationId/OrderLineId تبدیل می‌شود. OriginAllocationId و OfferLineId باقی می‌مانند.

Hold، OrderLinesV2/snapshot، Agreement→Consumed/ConsumedOrderId، حذف دقیق ordinary و offer از همان cartVersion و outbox، همگی در همین transaction ذخیره می‌شوند. inquiry در همان سبد باقی می‌ماند. replay انتقال انجام‌شده را تکرار نمی‌کند. مهلت سفارش کمینهٔ `now + ReservationMinutes تنظیم‌شده`، مهلت Quote5، PurchaseUntil و allocation deadline است؛ پس از انتظار و پیش/پس از مرزهای ذخیره دوباره کنترل می‌شود. مهلت گذشته به مدت تازه تبدیل نمی‌شود و replay آن را تمدید نمی‌کند.

## دستگاه، لغو و انقضا

مرز داخلی `IStockSerialAssignmentsV2`، pick صریح `(LineId,UnitId,Version,WarrantyUntil?)` دارد. فقط reservation Allocated دستگاه می‌گیرد. خط توافقی باید همان unit و claim OrderHeld وعده‌داده‌شدهٔ همان entitlement را بگیرد؛ خط ordinary دستگاه بدون claim فعال و در مقدار باقی‌ماندهٔ همان خط می‌گیرد. انتساب، unit را assigned و claim را `Assigned/IsActive=false` می‌کند. receipt نسخه‌دار serial با actor/request/body به همان reservation مقید است.

Release/expiry مسیر `reservation → Stock → units/claims` را می‌گیرد و Agreement/allocation/cart/Market را دوباره قفل نمی‌کند. هم OrderHeld فعالِ هنوز unassigned و هم Assigned غیرفعالِ دارای unit متصل به همان سفارش بررسی و آزاد می‌شوند. Reserved دقیقاً یک بار کم می‌شود؛ OnHand و SourcingReserved تغییر نمی‌کنند. allocation همچنان Transferred، Agreement همچنان Consumed و transfer record باقی می‌مانند. لغو و انقضا حق خرید قبلی را برنمی‌گردانند.

`StockReservationExpiryWorker` برای قرارداد۲ dispatch داخلی دارد؛ `OrderExpiryWorker` نیز سفارش SnapshotVersion2 را از مرز V2 آزاد و وضعیت Sales را منقضی می‌کند. due Active در خواندن قابل استفاده نمایش داده نمی‌شود؛ Allocated از unpaid expiry آزاد نمی‌شود. Fulfill داخلی فقط پس از انتساب کامل هر خط رهگیری‌شده، claim/unit را Fulfilled/delivered می‌کند و Reserved و OnHand را با ledger کم می‌کند. **گردش بیرونی پرداخت، ارسال، refund و تغییر وضعیت فروش به Paid/Fulfilled با این خدمات داخلی تکمیل‌شده محسوب نمی‌شود.**

بستن سادهٔ Market یا release سهم برای Agreement مصرف‌شده همچنان conflict دارد؛ این مسیر سفارش را لغو یا سهم منتقل‌شده را آزاد نمی‌کند. ادامهٔ چنین خریدی از سفارش واقعی است. projection تاریخی، مجوز بستن، تخصیص یا پرداخت نمی‌سازد.

## Outbox و پیوند تاریخی درخواست به سفارش

برای هر Agreement سفارش‌شده، `sales.OrderOutbox` رویداد نسخه۱ `SourcingAgreementOrdered` با EventId قطعی و یکتایی `(OrderId,AgreementId,EventType)` در transaction سفارش ذخیره می‌کند. worker بعد از commit، ابتدا Market را در scope/transaction مستقل به‌روز و سپس delivery را در Sales ثبت می‌کند. lost acknowledgement به replay همان EventId/hash منجر می‌شود. event نامعتبر، رویدادهای بعدی batch را متوقف نمی‌کند؛ تلاش ناموفق و NextAttemptAt با backoff محدود ثبت می‌شوند. worker با `Market:OrderProjectionEnabled` قابل خاموش‌کردن و runner یک‌باره با `--project-sourcing-orders` در کد موجود است.

Market فقط provenance immutable و تعلق parent/task/offer/acceptance به owner را بررسی می‌کند؛ وضعیت یا تاریخ انقضای جاری، مانع ثبت تاریخی نمی‌شوند. `market.SourcingOrderLinks` با PK AgreementId و EventId یکتا، hash payload را حفظ می‌کند. FK پذیرش از OfferId به PK واقعی `SourcingOfferAcceptances.OfferId` است؛ alternate key تازه‌ای به جدول قدیمی اضافه نشده است.

`GET /api/sourcing/requests/{id}/orders` فقط customer مالک، صفحه۲۰ و cursor مقید به owner/request با حداکثر۵۱۲ کاراکتر می‌دهد. پاسخ strict `{schemaVersion:1,requestId,items:[{orderId,taskId,offerId,acceptanceId,createdAt}],nextCursor}` است؛ nextCursor حتی در پایان صریحاً null است. یک order می‌تواند برای پذیرش‌های متفاوت تکرار شود. این خروجی قیمت، وضعیت پرداخت، وضعیت جاری سفارش یا capability ندارد؛ UI برای آن‌ها به detail سفارش پیوند می‌دهد و تأخیر projection را توضیح می‌دهد.

## رابط و مرزهای خصوصی

فروشگاه Quote4 را با دکمهٔ مستقل دریافت شرایط سفارش، به Quote5 جدا متصل می‌کند؛ JSON نسخه۴ بازبرچسب نمی‌خورد. پیش‌فاکتور تازه، خطوط مستقل، متن شرایط زبان جاری و مهلت اصلی را نمایش می‌دهد. فرم فقط در canCreate معتبر فعال است، وضعیت unpaid و عدم احیای پیشنهاد پس از لغو/انقضا را روشن می‌کند. فهرست/جزئیات/لغو مشتری و پنل از API V2 استفاده می‌کنند؛ پنل LineId و متن کامل FA/EN و نسخهٔ تاریخچه را حفظ می‌کند.

Quote5 و Order2 journalهای مستقل owner-bound در RAM دارند؛ اطلاعات تماس، قیمت یا credential در local/sessionStorage ذخیره نمی‌شود. پس از پاسخ نامعلوم، abort یا شکست refresh، همان UUID/body برای همان مالک نگه می‌ماند؛ خطای بعدی۴xx ابهام قبلی را پاک نمی‌کند. دادهٔ خصوصی در وضعیت احرازنشده پنهان است؛ مالک متفاوت/logout journal را پاک می‌کند. recovery از checkout حتی بعد از مصرف خطوط سبد قابل نمایش است. بستن کامل صفحه RAM را پاک می‌کند، اما سفارش احتمالی سرور باقی است و از تاریخچه پیگیری می‌شود.

BFF مسیر/method/origin/input را allowlist می‌کند، cookie مدیریت یا guest را به API سفارش نمی‌فرستد و پاسخ ناشناخته را با قرارداد قبلی قبول نمی‌کند. ورودی BFF حداکثر۱۶KiB، پاسخ Quote5 حداکثر۵۱۲KiB و پاسخ سفارش حداکثر۱MiB است؛ مبالغ فقط decimal string صحیح ریال‌اند و اعتبار مالی با BigInt سنجیده می‌شود. private no-store/noindex و منع کش PWA برای account/cart/checkout/order/API حفظ‌اند. پنل query keyهای نسخه‌دار و viewer-bound دارد؛ پاسخ دیررس پس از تغییر حساب/مجوز، cache خصوصی را دوباره پر نمی‌کند.

## migrationها و پذیرش باقی‌مانده

سورس سه migration افزایشی دارد:

- `20261024073909_OrderReservationsV2`: marker nullable رزرو، OrderLineId nullable دستگاه، entitlement/transfer و FKهای داخل Inventory.
- `20261024074017_AcceptedOfferOrdersV2`: SnapshotVersion nullable و ContainsDemo روی Orders، OrderLinesV2/OrderOutbox و اجازهٔ marker۵ در CHECK quote؛ دادهٔ قدیمی marker=null می‌ماند.
- `20261024074132_SourcingOrderLinks`: فقط projection تاریخی Market و FKهای آن.

Down هر migration پیش از DDL، وجود تاریخچهٔ متعلق به خودش را با51000 رد می‌کند؛ Sales هم Quote5 JSON/header و هم سفارش/outbox، Inventory هم entitlement/transfer/OrderLineId/Transferred و Market هم link را محافظت می‌کنند. این کد guard است؛ **۱۱آزمون SQL تازهٔ guard/downgrade و سازگاری قبلی در رگرسیون۴۶۴پذیرفته‌اند؛ restore۳۸ هنوز باید اثبات شود.** ارتقای اصلی۳۵ به۳۸ در این سند انجام‌شده اعلام نمی‌شود.

پذیرش محدود رابط شامل۲۹۲تست فروشگاه و۱۸۰پنل با صفر fail/skip، typecheck و buildهای ایزولهٔ جدا از runtime اصلی است؛ [گزارش حفظ artifactها](../artifacts/checks/order2-ui-wirefix-build-preservation.json) مرز این buildها را ثبت می‌کند.۱۷پاسخ خام در گزارش wire شامل ششQuote5، چهارcreate، چهارdetail، دوpage و یکprojection هستند؛ نخستین شکست decoder و captureهای اولیه حفظ شده‌اند. رویداد معتبر `temporary_order_v2_created` فقط در قرارداد۲ صریحاً پذیرفته می‌شود؛ قرارداد۱ گسترش داده نشده است.

اجرای SQL واقعی آغاز شده، اما نتیجهٔ نهایی پس از اصلاح دو چرخهٔ مشاهده‌شده هنوز در این سند پذیرفته اعلام نمی‌شود. پیش از پذیرش برش، SQL واقعی ordinary + دو Agreement یک SKU، serial هر خط، رقابت UUID/quote/آخرین ظرفیت و هم‌زیستی Order1/2، انتقال در برابر release/expiry/close، deadline پس از انتظار، rollback همهٔ مرزهای نوشتن و cancel/expiry assigned+unassigned لازم است. تاریخچهٔ مخلوط و downgrade دارای داده، worker/outbox retry/lost acknowledgement/poison، pagination/owner/demo و حفظ دادهٔ قبلی باید در نتیجهٔ نهایی پذیرفته شوند. verifier پاسخ خام `scripts/verification/verify-order2-wire.mts` به‌تنهایی اثر موجودی، درخواست واقعی مرورگر یا انتشار را ثابت نمی‌کند.

مرورگر واقعی FA/EN و موبایل/دسکتاپ، قطع پاسخ با UUID/body ثابت، auth unavailable→همان مالک، پیگیری سفارش/لغو و پنل دارای نقش مستقل، سپس پاک‌سازی QA لازم‌اند. انتشار تنها پس از backup تازه، guard حفظ داده، تطبیق backend/frontend artifact، ارتقای افزایشی و smoke/guard پس از startup است. Linux مستقل، provider واقعی، offsite backup و تمام معیارهای PDF همچنان از build محلی یا این قرارداد نتیجه نمی‌شوند.
