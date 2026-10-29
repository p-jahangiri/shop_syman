# تخصیص واقعی، توافق قیمت و تبدیل به خرید — سورس foundation و پیش‌نویس ادامهٔ مرحلهٔ سوم

2026-10-24؛ **تخصیص/توافق قیمت، SerialV2/فرمان پنل و Cart2/convert در اصلی/سورس۳۴ محلی پذیرفته و منتشر شده‌اند.** موبایل واقعی/CSS اصلاح‌شده، restore۳۴، بکاپ تازه و۸۰smoke پذیرفته‌اند؛ [STATUS](STATUS.md) و [PLAN](PLAN.md) شواهد/محدودیت‌ها را مشخص می‌کنند. ادامهٔ مرحلهٔ سوم شامل **Quote4، Order2، انتقال به رزرو سفارش، مصرف Agreement و پایان workflow هنوز DRAFT/کار ناتمام** است. [MARKET-CART2-SLICE](MARKET-CART2-SLICE.md) مرز پیاده‌شده و [MARKET-QUOTE4-SLICE](MARKET-QUOTE4-SLICE.md) طرح آمادهٔ بعدند. بخش‌های foundation/پیش‌نویس پایین تاریخچه و الزامات فنی را حفظ می‌کنند؛ Cart2 دیگر API فرضی نیست، اما وجود آن پایان MARKET-02 یا کل PDF و قابلیت پرداخت را ثابت نمی‌کند.

مبنای دامنه D23/D27/D28 و قراردادهای [پیشنهاد/رضایت](MARKET-OFFER-CONSENT.md) و [پیگیری/دریافت](MARKET-SUPPLY-RECEIPTS.md) است. هیچ نرخ، هزینه، درصد چک، گارانتی، مهلت تجاری تازه یا اجازهٔ اتصال زنده از این پیشنهاد استنتاج نشود. D16، D17 و D21 همچنان برقرارند: providerها نامشخص/خاموش، Redis چت خاموش، سیاست نمونه فقط QA خودش و هیچ credential مالک برای آزمون مصرف نشود.

## foundation و SerialV2/فرمان پنل در سورس؛ انتشار هنوز باز است

این بخش وضعیت کد موجود را توصیف می‌کند، نه تصمیم تجاری تازه یا تأیید نهایی آزمون‌ها. عدد و نتیجهٔ آخرین build/SQL/wire/UI فقط از STATUS خوانده شود؛ نتیجهٔ پیش از اصلاح guard آزادسازی، پذیرش سورس نهایی نیست.

| مالک و کد موجود | رفتار پیاده‌شده و حد آن |
|---|---|
| Market: [SourcingAllocationPlanService](../backend/src/Shop.Modules.Market/SourcingAllocationPlanService.cs) | همان request/task locks، نسخه‌های والد/task/Offer، پذیرش فعال و نامنقضی، مالک/TermsHash و همهٔ خطوط دقیق را می‌سنجد؛ SKU فیزیکیِ منتشرشده، material و تنظیم خرید جاری دوباره خوانده می‌شوند. plan، قیمت و snapshot اصلی پذیرش را حفظ می‌کند و قیمت عمومی تازه را کپی نمی‌کند. Complete فقط نتیجهٔ تازه، همان actor/command، reference آماده‌شده و همان تراکنش را می‌پذیرد؛ event فرزند `stock_allocated` می‌نویسد، بدون enum تازهٔ Request/Offer. |
| Inventory: [SourcingAllocationService](../backend/src/Shop.Modules.Inventory/SourcingAllocationService.cs) و [SourcingAllocationRules](../backend/src/Shop.Modules.Inventory/SourcingAllocationRules.cs) | تخصیص کامل همهٔ خطوط از Stock واقعی، `SourcingReserved`، انتخاب دقیق UnitId/Version برای tracked، claim یکتای فعال، آزادسازی/انقضا، تاریخچه و receipt مقید به actor/operation/UUID/route/بدنه وجود دارند. ExpiresAt صریح و UTC، پس از انتظار قفل Stock/unit دوباره سنجیده و به PurchaseUntil محدود می‌شود؛ تمدید خودکار یا Stock فرضی ندارد. انتقال به Order هنوز پیاده نشده است. |
| حفاظت مسیرهای موجود Inventory | Available/Hold/Adjust و view عمومی هر دو reserve را رعایت می‌کنند. mode، تبدیل دیجیتال، retire و assign قدیمی در برابر claim فعال و سهم sourcing محافظت شده‌اند. SerialV2 اکنون counter/claim صریح و فیلتر available درست دارد؛ reader قدیمی در سهم/claim فعال upgrade409 می‌دهد. mutation/history قدیمی با همان قرارداد حفظ‌اند. |
| Sales: [SourcingPriceAgreementService](../backend/src/Shop.Modules.Sales/SourcingPriceAgreement.cs) | `SourcingPriceAgreements/Lines` قیمت صحیح ریال، متن FA/EN و snapshot دقیق همان پذیرش را نگه می‌دارند؛ LineId پایدار و SnapshotHash دارند. تخصیص مجدد همان پذیرش فقط همان snapshot را به allocation تازه پیوند می‌دهد. revoke و guard مصرف وجود دارند؛ تعریف State=Consumed یا فیلد ConsumedOrderId به معنی وجود مسیر واقعی Consume/Order2 نیست. |
| root: [SupplyAllocationCoordinator](../backend/src/Shop.Api/SupplyAllocationCoordinator.cs) | همان اتصال/تراکنش Serializable مربوط به audit را assert می‌کند؛ ترتیب Market command/request/task → Sales agreement → Inventory command/acceptance/allocation → Stock مرتب → unit/claim حفظ می‌شود. replay تاریخی قبل از نسخه و authority زنده است؛ plan مالی فقط در root به قرارداد بدون قیمت Inventory و Agreement خصوصی Sales تقسیم می‌شود. |
| root: [SourcingPurchaseLifecycle](../backend/src/Shop.Api/SupplyAllocationCoordinator.cs) | staff cancel/fail و بستن قانونی والد، پیش از Stock و حتی پس از expiry یا غیرفعال‌شدن Offer، authority مصرف Sales را می‌سنجند و revoke/release را در همان تراکنش انجام می‌دهند. fence قبلیِ لغو سادهٔ پذیرش نامنقضی همچنان برقرار است؛ لغو جدید مشتریِ تأمین پذیرفته‌شده هنوز مسیر آینده است. |
| آزادسازی مستقیم | `ReplayReleaseAsync` هدف request/task/allocation و بدنه را پیش از `AssertReleaseAllowedAsync` می‌بندد. receipt تاریخی موفق حتی پس از مصرف بعدی معتبر می‌ماند؛ فرمان تازه در برابر Sales.Consumed/ConsumedOrderId محافظت می‌شود. این guard فقط اجازهٔ release را می‌سنجد و Agreement را revoke نمی‌کند؛ بستن پیگیری مسیر جدا دارد. |
| expiry: [SourcingAllocationExpiryWorker](../backend/src/Shop.Api/SourcingAllocationExpiryWorker.cs) | batch محدود Inventory را در تراکنش‌های کوتاه اجرا می‌کند و قفل بالادستی Market/Sales/cart نمی‌گیرد. clock در read/command فوراً capability منقضی را می‌بندد؛ worker فقط counter/claim را آزاد می‌کند. تنظیم مستقل `Inventory:AllocationExpiryEnabled` در QA قابل خاموش‌کردن است؛ تأخیر worker مجوز مصرف سهم منقضی نیست. |
| SerialV2 و رابط انبار | [SerialInventoryV2](../backend/src/Shop.Modules.Inventory/SerialInventoryV2.cs) صفحه۵۰تایی، Stock.Version cursor و بازسنجی Stock/unit/claim می‌دهد. پنل claim را نمایش و خروج دستگاه محفوظ را می‌بندد؛ mapper صریح StockV2→V1 فقط ورودی mutation قدیمی را نگه می‌دارد. |
| فرمان پنل | [SourcingAllocation](../apps/admin/src/sourcing-allocation.tsx) مهلت/دلیل صریح، انتخاب دستی دقیق دستگاه و journal موجود را به allocate/release وصل می‌کند. GETهای موازی با ID/version/terminal guard تطبیق می‌یابند؛ receipt تاریخی سهم را احیا نمی‌کند. نوار بازیابی داخل modal، همان UUID/body و GET تازه بدون resend را حفظ می‌کند. |

### migrationهای تولیدشده، نه اعمال‌شده روی اصلی

- Inventory، migration۳۲: [`20261024010005_SourcingAllocations`](../backend/src/Shop.Api/Migrations/Inventory/20261024010005_SourcingAllocations.cs)؛ ستون SourcingReserved با default صفر، قید مانده با cast به bigint، تغییر فرمول همان `AvailableStockV1` و جدول‌های تخصیص/خط/فرمان/رویداد/claim. این migration علاوه بر جدول تازه، constraint و view موجود را تغییر می‌دهد؛ صرفاً افزودن جدول نیست.
- Sales، migration۳۳: [`20261024010045_SourcingPriceAgreements`](../backend/src/Shop.Api/Migrations/Sales/20261024010045_SourcingPriceAgreements.cs)؛ Agreement و خطوط snapshot با قیود مبلغ/مصرف و کلیدهای مستقل از schema دیگر.

وجود فایل migration، شاهد اجرای SQL، انطباق مدل نهایی، restore یا حفظ دادهٔ اصلی نیست. بررسی SQL idempotent، رگرسیون واقعی، بکاپ تازه، حفظ مانده/قیمت/CMS/حساب‌ها، cleanup QA و smoke پیش از اعمال/انتشار لازم‌اند؛ هیچ seed یا ماندهٔ تخصیص از QA به اصلی منتقل نشود.

### StockV2، Supply2 و readهای فعلی

[AdminStockService/Endpoints](../backend/src/Shop.Api/AdminStockEndpoints.cs) برای `GET /api/admin/inventory/v2/variants` و `.../v2/variants/{id}`، ماندهٔ فیزیکی، Reserved سفارش، SourcingReserved و Available واقعی را جدا می‌دهد؛ صفحه `version=2` دارد. reader قدیمی روی ردیف دارای sourcing hold خطای `inventory_contract_upgrade_required` با409 می‌دهد و Available قدیمیِ ظاهراً سازگار تولید نمی‌کند.

`GET /api/admin/inventory/variants/{id}/serials/v2` wrapper نسخه۲ با stock/ردیف `{unit,hasActiveClaim}` دارد؛ active claim حتی پیش از cleanup انقضایافته در انتخاب available حذف می‌شود. cursor حداکثر۵۱۲نویسه به SKU/فیلتر/Stock.Version وابسته است؛ بازخوانی bounded نسخهٔ Stock/unit/claim، drift حین projection را409 می‌کند. cursor صفحه‌بندی، snapshot تاریخی چندصفحه‌ای نیست. Serial1 در سهم/claim فعال `serial_contract_upgrade_required` می‌دهد.

[SourcingSupplyProjection](../backend/src/Shop.Api/SourcingSupplyProjection.cs) و [SourcingSupplyEndpoints](../backend/src/Shop.Api/SourcingSupplyEndpoints.cs) readهای `schemaVersion=2` را اضافه کرده‌اند. summary دارای `allocation|null` با id/state/effectiveState/version/expiresAt/isDemo/quantity و خطوط OfferLineId/VariantId/quantity، و `reservedForRequest` صریح است. فقط Active و نامنقضی، محفوظ اعلام می‌شود؛ `canCheckout=false` و `canPay=false` تا ساخت مسیر واقعی تبدیل/انتقال حفظ‌اند. owner، قیمت، منبع/یادداشت خصوصی و UnitIds به projection مشتری/انبار افزوده نمی‌شوند.

`ReadSummariesAsync` در قرارداد Inventory تا۵۰ پذیرش را به‌صورت batch محدود و با بازخوانی نسخه‌ها، بدون خواندن unit claim، ترکیب می‌کند؛ صفحات مشتری۲۰ و مدیر۵۰ باقی‌اند. Market پیش/پس از ترکیب دوباره سنجیده می‌شود؛ این read ادعای snapshot سراسری Stock در چند module ندارد و mutation همچنان نسخهٔ واقعی Stock/unit را الزام می‌کند. readهای Supply1 اگر allocation فعالِ ذخیره‌شده داشته باشند، حتی در حالت effective expired پیش از cleanup، با `sourcing_supply_contract_upgrade_required` و409 رد می‌شوند. events، receipt و mutationهای Supply1 تغییر نکرده‌اند.

متن ثابت «دریافت‌شده؛ هنوز رزرو نشده» از read/UI جدید حذف شده است. current-message تولیدشدهٔ نگه‌داری پس از release/expiry با وضعیت جاری سازگار می‌شود؛ event تاریخی بازنویسی نمی‌شود. decoder سخت، client/BFF خصوصی و journal refresh به read نسخه۲ متصل‌اند؛ رابط FA/EN مهلت نگه‌داری را از مهلت اعتبار قیمت جدا نمایش می‌دهد و تب باز پس از رسیدن deadline ادعای فعال‌بودن hold را حفظ نمی‌کند. این‌ها پیاده‌سازی سورس‌اند؛ پذیرش مرورگر متصل و انتشار نهایی در STATUS جدا ثبت می‌شوند.

### مسیرهای foundation موجود در سورس

| مسیر | نقش/مرز | اثر |
|---|---|---|
| `GET /api/admin/inventory/sourcing-tasks/{taskId}/allocation` | inventory.read | candidate بدون قیمت/مالک، StockV2 و mode/version، خطوط پذیرفته‌شده و summary تخصیص؛ `CanAttemptAllocation` تضمین موفقیت mutation نیست |
| `PUT /api/admin/inventory/sourcing-requests/{id}/tasks/{taskId}/allocations/{allocationId}` | inventory.write | تخصیص کامل و Agreement در تراکنش audit؛ body بزرگ‌تر فقط مسیر canonical و محدود است |
| `POST /api/admin/inventory/sourcing-requests/{id}/tasks/{taskId}/allocations/{allocationId}/release` | inventory.write | replay هدف‌دار، سپس guard مصرف Sales و release سهم؛ لغو سفارش/پیگیری نیست |
| `GET /api/admin/inventory/sourcing-allocations/{allocationId}`، `/events` و `/commands/{operation}/{commandId}` | inventory.read؛ receipt فقط actor اجراکننده | جزئیات/تاریخچهٔ مجاز انبار؛ UnitIds در جزئیات مستقل مجاز انبار است، نه summary مشتری/Supply2 |
| `GET /api/admin/sourcing/requests/{id}/agreements/{agreementId}` | sales.read | توافق قیمت خصوصی، بدون اجازهٔ پرداخت |
| `GET /api/sourcing/requests/{id}/agreements/{agreementId}` | مالک احرازشده | فقط توافق همان حساب/درخواست؛ بدون مصرف یا پرداخت |
| `GET /api/sourcing/requests/{id}/supply/v2` و `/v2/{taskId}` | مالک احرازشده | صفحه/جزئیات Supply2 با hold صادق و مهلت |
| `GET /api/admin/sourcing/requests/{id}/supply/v2` و `/v2/{taskId}` | sales.read | read کارکنان با اطلاعات داخلی مجاز قبلی و summary تخصیص |
| `GET /api/admin/inventory/sourcing-tasks/v2` و `/v2/{taskId}` | inventory.read | read انبار بدون هویت مشتری/قیمت/یادداشت فروش، همراه Stock contract موجود دریافت |

**کار باز پیش از تحویل/انتشار مرحلهٔ سوم:** SerialV2، فرم تخصیص/آزادسازی و journal با wire/SQL/مرورگر دسکتاپ دو زبان و قطع پاسخ پذیرفته‌اند؛ موبایل واقعی، restore۳۳ و rollout با بکاپ/حفظ اصلی بازند. ارتقای محدودِ reservation/serial جای تاریخچهٔ پُر سفارش/دریافت را نمی‌گیرد. مسیر کامل CartOfferLines/Cart2 → Quote4 → Order2/Consume → انتقال اتمیک ordinary+sourcing به reservation واقعی، هنوز پیاده نشده و پذیرش نقش/مالک/auth/دو حساب و مراحل مالی معتبر خودش را می‌خواهد. Completed واقعی و outbox مستقل نیز بازند. این سند foundation را به پایان کل مرحله یا هدف PDF تبدیل نمی‌کند.

## ادامهٔ مرحلهٔ سوم — DRAFT فنی؛ اجرا و پذیرش نشده

بخش‌های بعد دامنه و معیارهای کامل را حفظ می‌کنند. برای رفتار پیاده‌شده و نام قطعی سرویس/route/migration، بخش foundation بالا مرجع است؛ نام‌ها و انتقال‌های آینده در بخش‌های DRAFT الزاماً قرارداد نهایی منتشرشده نیستند.

## نتیجه و سه واقعیت مستقل

مشتری باید بتواند اقلام همان پیشنهاد پذیرفته‌شده را، با قیمت توافقی خودش و موجودی واقعاً محفوظ، به همان سبد فروشگاه منتقل کند. سپس quote تازه و OrderService معمول، با تمام محدودیت‌های واقعی خرید، ادامه می‌یابند. تبدیل، پرداخت یا سفارش خودکار نیست.

| واقعیت | مرجع اختیار | شرط و اثر |
|---|---|---|
| رضایت به شرایط | Acceptance ثابت Market | همان مالک، Offer/Revision/TermsHash و مهلت؛ بدون Stock/Order |
| سهم واقعی مشتری از انبار | Allocation و claim واحد Inventory | از OnHand واقعی کم‌مصرف عمومی می‌شود؛ OnHand افزایش نمی‌یابد |
| قیمت و مصرف خرید | Agreement/Conversion/Order در Sales | قیمت صحیح snapshot پذیرفته‌شده؛ یک بار مصرف و مستقل از قیمت عمومی |

نام‌های این بند بیان معنای قابلیت‌اند و enum تازهٔ Supply2 نیستند. `Received` فعلی فقط ثبت ورود واقعی است. `StockAllocated` یعنی سهم انبار محفوظ است. `CanConvertToCart` یعنی تبدیل مجاز است. `CanCreateTemporaryOrder` و `CanPay` از policy/quote/provider واقعی می‌آیند. وقتی هزینه/مالیات یا سفارش موقت خاموش است، عبارت «آمادهٔ پرداخت/خرید» و capability مثبت نمایش داده نشود؛ رابط می‌تواند «کالا محفوظ است؛ تکمیل خرید در انتظار تنظیمات فروشگاه» بگوید. تخصیص یا تبدیل اجازهٔ روشن‌کردن تنظیمات اصلی را ندارد.

## شاهدهای سورس و تغییر لازم

| سورس فعلی | پیامد اجرایی |
|---|---|
| [Cart.cs](../backend/src/Shop.Modules.Sales/Cart.cs): کلید CartLines برابر CartId+VariantId؛ CartSourcingLines مستقل در همان cart است | اقلام توافقی جدول جدا با LineId/AgreementLineId می‌خواهند؛ ردیف عادی همان SKU نباید overwrite شود |
| [CartService](../backend/src/Shop.Modules.Sales/CartService.cs): Replace/Read/Merge تراکنش مستقل باز می‌کنند؛ Find/ReadContents/Consume، ordinary lines را می‌خوانند | هستهٔ داخلی join-parent و aggregate سبد۲ لازم است؛ متد عمومی Replace داخل root transaction فراخوانی نشود |
| [CheckoutQuoteService](../backend/src/Shop.Modules.Sales/CheckoutQuoteService.cs): فقط ordinary cart، قیمت عمومی و Available عمومی را می‌خواند؛ quote۳ و پنج دقیقه اعتبار دارد | Quote4 باید ordinary و agreement را جدا قیمت‌گذاری و سپس مبلغ و ظرفیت مشترک را بررسی کند |
| [CheckoutQuote.cs](../backend/src/Shop.Modules.Sales/CheckoutQuote.cs) و [Order.cs](../backend/src/Shop.Modules.Sales/Order.cs): **هر دو** کلید خط را بر QuoteId/OrderId+VariantId می‌گذارند | اصلاح فقط cart کافی نیست؛ یک SKU با دو قیمت به LineId ثابت در quote و snapshot سفارش نیز نیاز دارد |
| [CheckoutQuoteValidation](../backend/src/Shop.Modules.Sales/CheckoutQuoteValidation.cs): schema۳ را الزام و fingerprint جاری را دوباره محاسبه می‌کند | quoteهای۱–۳ تاریخی خوانده شوند، ولی هیچ‌کدام اجازهٔ نادیده‌گرفتن offerline سبد۲ در سفارش تازه نداشته باشند |
| [OrderService](../backend/src/Shop.Modules.Sales/OrderService.cs): owner lock، quote/cart، سپس Hold با OrderId واقعی و Consume ordinary cart | هستهٔ سفارش جدید، انتقال تخصیص و Hold عادی را یک فرمان اتمیک انجام دهد و فقط buy-lines تأییدشده را مصرف کند |
| [IStockReservations](../backend/src/Shop.SharedKernel/StockReservations.cs): Hold، OrderId واقعی و مقدار۱..۱٬۰۰۰٬۰۰۰ هر SKU و عمر۱..۶۰دقیقه می‌خواهد | تخصیص قبل از سفارش نوع مستقل است؛ OrderId فرضی برای آن تولید نشود؛ deadline معتبر بدون تمدید لازم است |
| [Inventory.cs](../backend/src/Shop.Modules.Inventory/Inventory.cs) و [StockReservationService](../backend/src/Shop.Modules.Inventory/StockReservationService.cs): foundation سورس، Available/Hold و guard مانده را با SourcingReserved اصلاح کرده است | پذیرش رگرسیون همهٔ مسیرها و انتقال آینده به reservation واقعی لازم است؛ اصلاح view به‌تنهایی حفاظت نمی‌سازد |
| [SerialAssignment](../backend/src/Shop.Modules.Inventory/SerialAssignment.cs): foundation guard claim فعال را به assign عادی افزوده؛ OrderHeld هنوز مسیر واقعی انتقال ندارد | SerialV2 خواندنی پذیرفته است؛ انتخاب/انتقال/تحویل همان IMEI و OrderLineId برای سفارش۲ هنوز لازم‌اند؛ count-only allocation برای دستگاه مشخص کافی نیست |
| [SupplyReceivingCoordinator](../backend/src/Shop.Api/SupplyReceivingCoordinator.cs): root audit transaction، قفل Market پیش از Inventory و proof محدود Catalog | الگوی ownership/transaction حفظ شود؛ receipt دریافت، مجوز قیمت/تخصیص/خرید نیست |
| [CheckoutOrderSettings](../backend/src/Shop.Modules.Sales/CheckoutOrderSettings.cs): نبود تنظیمات، TemporaryOrdersEnabled=false؛ فقط online بدون approval مسیر موقت دارد | Agreement نمی‌تواند چکی/اقساطی را بدون workflow واقعی به temporary order تبدیل کند |

## مدل پیشنهادی و مالکیت

### Market: رضایت و plan محدود

Acceptance، Offer.State=Accepted، snapshot و TermsHash تغییرناپذیر می‌مانند. Market یک reader/prepare محدود از همان snapshot می‌دهد؛ body مرورگر مالک، قیمت، VariantId جایگزین یا سقف قابل مصرف تعیین نمی‌کند.

`AcceptedSourcingPurchasePlan` داخلی شامل RequestId/TaskId/OfferId/Revision/AcceptanceId/OwnerId، نسخه‌های والد/task/offer، TermsHash، PurchaseUntil، ContainsDemo و حداکثر۶۴ خط OfferLineId/VariantId/ProductId/quantity/unitPriceRial/materialFingerprint است. مقدار مالی در سرویس long و در مرز JSON رشتهٔ decimal است. دریافت کامل task به‌تنهایی plan مجاز نمی‌سازد؛ current acceptance، material و وضعیت خرید باید دوباره سنجیده شوند.

کالای موجود فروشگاه می‌تواند همان SKU درخواست خصوصی قدیمی را پوشش دهد. موجودی عمومیِ تازه، درخواست/پیشنهاد خصوصی را حذف نمی‌کند. از reader «خارج از موجودی بازار» برای رد کردن plan خصوصی استفاده نشود. کالای جایگزین، گارانتی/گزارش دستگاه متفاوت یا کاهش مقدار، plan قبلی نیست و پیشنهاد/رضایت تازه می‌خواهد.

### Inventory: سهم واقعی و claim دستگاه

انتخاب فنی foundation، **تخصیص کامل تمام خطوط پذیرش در یک فرمان** است؛ دریافت ناقص همچنان ثبت و نمایش داده می‌شود، اما «همهٔ اقلام برای شما محفوظ‌اند» تا موفقیت کامل گفته نمی‌شود. تخصیص از Available واقعی فروشگاه انجام می‌شود، چه از رسید همین task باشد چه موجودی معتبر قبلی. برای کالای count-only با انبار جهانی فعلی، provenance رسید اثبات‌کنندهٔ lot اختصاصی نیست؛ نسبت‌دادن فیزیکی یک عدد موجودی به فاکتور خاص بدون مدل lot ادعا نشود. برای واحد tracked، UnitId واقعی و پیوند رسید آن قابل ردیابی است.

جدول‌های foundation و امتداد ناتمام آن‌ها برای انتقال:

- `SourcingAllocations`: Id، OwnerId، RequestId/TaskId/OfferId/AcceptanceId، TermsHash، State، IsActive، CreatedAt/ChangedAt/ExpiresAt، RowVersion و ContainsDemo. FK به Market/Sales ندارد. UNIQUE پذیرش فعال و receipt actor+operation+UUID/target/hash دارد.
- `SourcingAllocationLines`: AllocationId+OfferLineId، VariantId، مقدار پذیرفته‌شده؛ خطوط همان SKU برای Stock جمع می‌شوند ولی provenance خط از بین نمی‌رود.
- `SourcingAllocationEvents/SourcingAllocationCommands`: تاریخچه و receipt تخصیص/آزادسازی/انقضا؛ انتقال واقعی هنوز لازم است. replay سهم تازه نمی‌سازد و مهلت را تمدید نمی‌کند.
- `SerialUnitClaims` فعلی و رویدادهای مستقل آیندهٔ آن: claim فعال یکتای UnitId با AllocationId یا، پس از ساخت انتقال، ReservationId/OrderId واقعی. `AllocationHeld` و `OrderHeld` فعال‌اند؛ Released/Assigned/Fulfilled تاریخی‌اند. UNIQUE فیلترشده بر UnitId فعال و قید سازگاری نوع/شناسه لازم است.

Claim جدول مستقل است تا enum فعلی SerialUnit و DTO سخت قدیمی ناگهانی نشکند. تا assign معتبر، SerialUnit می‌تواند از نظر وضعیت فیزیکی available بماند، ولی **انتخاب‌پذیری عمومی** آن باید claim را کم کند. Query صفحهٔ available عادی، Retire، Assign عادی، تغییر mode، انتقال و تحویل همگی claim را بشناسند. مسیر انتخاب واحد سفارشِ صاحب claim از قرارداد جدا همان ReservationId/OrderId می‌خواند؛ دستگاه مشتری دیگر حتی با دانستن UnitId قابل انتخاب نیست. رابط انبار۲ claim/انتخاب‌پذیری را صریح نمایش دهد؛ پنهان‌کردن claim فقط در رابط حفاظت نیست.

برای `serial`/`imei` تمام مقدار تخصیص با UnitId+Version واقعی پوشش داده شود؛ تعداد دقیق، VariantId، available فیزیکی، نبود claim فعال و نبود reservation/delivery/retirement سنجیده شوند. هیچ IMEI/serial یا پایان گارانتی حدس زده نشود. سقف موجود batch۱۰۰ برای واحد tracked در نخستین فرمان تخصیص صریح حفظ یا با قرارداد/آزمون جدا ارتقا یابد؛ تقسیم خاموش یک تخصیص کامل به چند فرمان مستقل مجاز نیست.

Allocation از کالاهای واقعی OnHand استفاده می‌کند؛ به معنای انتقال فیزیکی/تحویل یا فروش نیست. ExpiresAt مطلق باید از اقدام صریح مجاز مدیر یا تنظیم معتبر فروشگاه بیاید و از PurchaseUntil پذیرفته‌شده بیشتر نباشد؛ مقدار نمونه، مدت پیش‌فرض ساختگی یا تمدید خودکار وجود ندارد. نبود مهلت معتبر، تخصیص را می‌بندد. زمان اعتبار قیمت و زمان نگه‌داری واقعی سهم در UI جدا و صریح نمایش داده شوند؛ تغییر مهلت نگه‌داری نباید قیمت یا رضایت تاریخی را بازنویسی کند.

### Sales: توافق و ردیف قابل خرید

foundation فعلی `SourcingPriceAgreement` با AcceptanceId یکتا، Revision، OwnerId، RequestId/TaskId/OfferId، TermsHash، MaterialFingerprint در snapshot خطوط، مهلت و AllocationId را می‌سازد؛ تکمیل مصرف و ردیف قابل خریدِ زیر هنوز لازم است. Agreement قیمت عمومی را ویرایش نمی‌کند. قیمت دقیق snapshot همان پذیرش است؛ InventoryManager صرفاً با plan سروری کپی‌شده آن را materialize می‌کند و حق تایپ/تغییر قیمت ندارد. هر تغییر قیمت، Offer جدید با finance.write و رضایت مالک جدید است.

خطوط Agreement دارای AgreementLineId ثابت، OfferLineId، VariantId، required quantity، unitPriceRial و snapshot FA/EN مشخصات/گارانتی‌اند. ظرفیت مصرف از مقدار همین پذیرش بیشتر نیست. Stateهای تعریف‌شدهٔ foundation برابر `Active`, `Revoked`, `Consumed` هستند؛ مسیر واقعی گذار به Consumed هنوز لازم است. expiry در هر read/command از ساعت سرور محاسبه می‌شود و worker پیش‌نیاز صحت نیست. `Consumed` به OrderId واقعی متصل است و با cancel سفارش پاک یا به Active برگردانده نمی‌شود. دوباره‌خرید پس از سفارش لغوشده نیازمند اقدام صریح جدید و بررسی ظرفیت/رضایت تازه است؛ receipt قدیمی دوباره کالا اضافه نمی‌کند.

`CartOfferLines` کنار CartLines/CartSourcingLines در همان ShoppingCart قرار می‌گیرد؛ کلید CartId+AgreementLineId و LineId پایدار دارد. ordinary line با LineId مشتق‌شدهٔ ثابت و lineKind=ordinary نمایش داده می‌شود؛ agreement lineKind=acceptedOffer دارد. قیمت، آدرس و شمارش انبار از body تأمین نشوند. مجموع buy-lines ابتدا به سقف فعلی۶۴ و مقدار aggregate هر SKU به ظرفیت واقعی Hold فعلی محدود شود؛ عبور از سقف، خطای صریح و rollback است و حذف/ادغام خاموش ردیف دیگر ندارد. CartSourcingLines سقف۲۴ و ماهیت مستقل غیرقابل پرداخت خود را حفظ می‌کند.

### کلید خط در quote و سفارش

انتخاب فنی پیشنهادی برای کاهش خطر دادهٔ تاریخی: جدول‌های افزایشی `CheckoutQuoteLinesV4` و `OrderLinesV2` با کلید QuoteId/OrderId+LineId؛ SnapshotVersion سفارش‌های قبلی پیش‌فرض۱ و جدید۲ باشد. Quote4/Order2 تمام خطوط ordinary و acceptedOffer خود را در جدول نسخهٔ جدید می‌نویسند؛ هم‌زمان دو منبع authority برای یک سفارش ساخته نشود. جدول‌های قدیمی و snapshotهای تاریخی برای reader نسخهٔ قبلی باقی‌اند. تغییر PK جاری درجا تنها با طرح migration/restore و سنجش همهٔ مصرف‌کنندگان جایگزین این گزینه شود.

خط Quote4/Order2 شامل LineId، LineKind، VariantId، quantity، unit/totalRial، و برای توافق: AgreementId/LineId، Request/Task/Offer/AcceptanceId، TermsHash و SnapshotVersion است. چند خط با یک VariantId به چند قیمت مستقل حفظ می‌شوند. فقط درخواست Inventory به‌صورت aggregate VariantId ساخته می‌شود؛ aggregation قیمت میانگین یا حذف provenance ممنوع است. قرارداد [StockSerials](../backend/src/Shop.SharedKernel/StockSerials.cs) که امروز در comment به کلید OrderId/VariantId تکیه دارد نیز باید معنای assignment جدید را صریح کند.

## موارد تأییدشده در مرور ریشه پیش از پیاده‌سازی

این مرور تصمیم تجاری یا پذیرش کد مرحلهٔ سوم نیست. در `OrderService.CreateAsync` خطوط فعلی مستقیماً با VariantId به Hold فرستاده می‌شوند؛ ورودی سفارش ترکیبی باید ابتدا مقدارهای هر SKU را جمع کند، ولی قیمت و provenance هر LineId در snapshot جدا بماند. `ValidateForOrderAsync` فعلی فقط schema۳ را می‌پذیرد؛ مسیر نسخه۴ و guard صریح برای سبد دارای اقلام توافقی، پیش‌نیاز انتشار هستند.

readerهای قدیمی سفارش نیز باید هم‌زمان پوشش داده شوند: `OrderService.ReadAsync` و `CancelAsync` از Include(Lines) و `ListAsync` از Lines.Sum استفاده می‌کنند. افزودن OrderLinesV2 به‌تنهایی سفارش نسخه۲ را در فهرست صفرکالا و در جزئیات بی‌خط نشان می‌دهد. آزمون فهرست مختلط Order1/Order2، خلاصهٔ مدیریت، شمارش، ترتیب LineId، لغو/انقضا و snapshot تاریخی لازم است؛ reader قدیمی حق پاسخ ظاهراً موفق با اقلام ناقص ندارد.

مدت نگه‌داری تخصیص، دریافت کامل و قیمت سه مفهوم جدا هستند. PurchaseUntil سقف اعتبار قیمت است؛ ExpiresAt تخصیص طبق قرارداد پیشنهادی بالا از تنظیم معتبر یا اقدام صریح مجاز می‌آید. این انتخاب فنی مدت تجاری پیش‌فرضی تعیین نمی‌کند. پیاده‌سازی foundation در سورس وجود دارد؛ تا پذیرش نهایی و rollout مجاز، تخصیص روی runtime اصلی۳۱ فعال نشده است.

## الزامات مرور Inventory؛ guardهای foundation و انتقال ناتمام

- انتقال به رزرو سفارش باید `ExpiresAt` مطلق بگیرد و ساعت سرور را پس از انتظار همهٔ قفل‌ها دوباره بسنجد. `HoldAsync` فعلی زمان را پس از قفل Stock با `now + Lifetime` می‌سازد؛ تبدیل deadline به duration پیش از انتظار می‌تواند مهلت رضایت را تمدید کند. adapter انتقال نباید این رفتار را برای سهم توافقی تکرار کند.
- claim دستگاه باید منشأ AllocationId و OfferLineId را تغییرناپذیر حفظ و هنگام انتقال به OrderHeld به OrderLineId دقیق متصل شود. `StockSerialPick` فعلی فقط UnitId/Version/Warranty دارد؛ aggregate SKU به‌تنهایی نمی‌تواند دو Agreement یا دو قیمت همان SKU را به خط درست سفارش نسبت دهد. انتقال نباید منشأ قبلی claim را پاک کند.
- Retire و Assign قدیمی باید claim فعال را زیر همان Stock lock موجود بررسی کنند و پس از آن قفل والد allocation را نگیرند؛ release/expiry ترتیب allocation→Stock دارد و ترتیب معکوس بن‌بست می‌سازد. claim فعالِ منقضی‌شده تا آزادسازی اتمیک counter و claim همچنان برای انتخاب عمومی بسته است.
- `RemoveReservedAsync` فعلی فقط واحدهای SerialUnit تخصیص‌یافته را آزاد می‌کند؛ cancel/expiry جدید باید claimهای OrderHeldِ هنوز assignنشده را هم آزاد کند. fulfillment به تطبیق claim و pick دقیق همان خط/سفارش نیاز دارد، نه فقط برابری شمارش دستگاه‌ها. سناریوی ترکیبی assigned/unassigned در لغو و انقضا باید SQL واقعی داشته باشد.

مرجع سورس: `StockReservationService.cs` سطرهای۳۷–۴۲ و۱۱۴–۱۳۳، `SerialAssignment.cs` سطرهای۱۳–۲۱، `SharedKernel/StockSerials.cs` سطرهای۳–۶ و `SerialInventoryService.cs` سطرهای۵۹–۶۱ و۶۹–۷۳.

این الزامات به provider یا credential بیرونی وابسته نیستند. guardهای بنیادین در سورس بالا پیاده شده‌اند؛ انتقال واقعی OrderHeld/assignment/fulfillment و پذیرش آن‌ها باز است. وجود این مرور یا کد سورس، فعال‌بودن تخصیص روی اصلی را ثابت نمی‌کند.

## invariant موجودی و مهاجرت هم‌زمان تمام مسیرها

```text
Stock.OnHand >= Stock.Reserved + Stock.SourcingReserved >= 0
PublicAvailable = OnHand - Reserved - SourcingReserved
```

قید SQL هر سه ستون را جداگانه nonnegative و مجموع دو reserve را با cast به bigint از OnHand کمتر/مساوی کند؛ مثبت‌بودن مجموع به‌تنهایی کافی نیست. جمع مقدارها/ظرفیت در سرویس با long/checked انجام و فقط پس از اعتبارسنجی به int مانده تبدیل شود؛ overflow ورودی خطای دامنه است، نه500 خام.

`SourcingReserved` با default صفر برای مانده‌های موجود افزوده شود؛ هیچ مانده/claim از سابقهٔ Market حدس زده نشود. view نسخه۱ `inventory.AvailableStockV1` همان ستون/shape را نگه دارد ولی فرمول واقعی تازه را مصرف کند؛ Catalog public، facet، market eligibility و همهٔ خواننده‌ها از همان Available عمومی استفاده کنند.

فهرست تغییر اجباری پیش از روشن‌کردن allocation: `InventoryService.AvailableAsync/AdjustAsync`، `StockReservationService.HoldAsync/RemoveReservedAsync`، serial mode/receive/retire/assign/fulfill، `SourcingReceivingService`، `AdminStockReader` و summaryها، view عمومی و readerهای مستقیم Stock. تغییر فقط نمایش پنل یا یک view کافی نیست. mapper هلو در آینده نیز همین مرز را مصرف می‌کند؛ هیچ sync مانده‌ای Reserved/SourcingReserved را overwrite نمی‌کند.

| فرمان | OnHand | SourcingReserved | Reserved | claim |
|---|---:|---:|---:|---|
| دریافت واقعی | +مقدار واقعی | ثابت | ثابت | ورود واحد؛ claim نمی‌سازد |
| تخصیص جدید | ثابت | +تخصیص | ثابت | AllocationHeld همان واحدها |
| لغو/انقضای تخصیص پیش از سفارش | ثابت | −تخصیص | ثابت | آزادسازی یک بار |
| تبدیل به cart | ثابت | ثابت | ثابت | تخصیص همان است |
| سفارش ترکیبی | ثابت | −سهم توافقی | +سهم توافقی و عادی | انتقال به OrderHeld در همان transaction |
| لغو/انقضای سفارش unpaid | ثابت | ثابت | −رزرو سفارش | آزادی OrderHeld/assigned مربوط، یک بار |
| fulfillment معتبر سفارش | −تحویل | ثابت | −رزرو تحویل | delivered/fulfilled همان سفارش |

اصلاح منفی انبار از OnHand کمتر از مجموع هر دو reserve عبور نکند. Retire یک UnitId دارای claim حتی در صورت وجود مقداری Available دیگر رد شود. دریافت تاریخی بعد از task terminal، سهم یا Agreement تازه نمی‌سازد. در صورت نبود Stock یا ناکافی‌بودن آن، allocation نمی‌تواند با درج مقدار فرضی موفق شود.

## قراردادهای محدود پیشنهادی

قرارداد فعلی foundation در `SharedKernel/SourcingAllocation.cs` و سرویس‌های بخش اول است؛ امضاهای زیر طراحی ادامهٔ تبدیل/انتقال‌اند و endpoint فعال نیستند. DTO عمومی و command داخلی متفاوت‌اند و تنها root اجازهٔ ترکیب module services را دارد.

```csharp
// Implemented foundation: exact signatures live in the linked source files.
SourcingAllocationPlanService.AcquireLocksAsync(...)
SourcingAllocationPlanService.PrepareAsync(...) -> AcceptedSourcingPurchasePlan
SourcingAllocationPlanService.CompleteAsync(...)
IInventorySourcingAllocations.ReplayAsync(...) / ReplayReleaseAsync(...)
IInventorySourcingAllocations.AllocateAsync(...) / ReleaseAsync(...)
IInventorySourcingAllocations.ReadSummariesAsync(...) / ExpireBatchAsync(...)
SourcingPriceAgreementService.EnsureForAllocationAsync(...)
SourcingPriceAgreementService.AssertReleaseAllowedAsync(...) / BeforeCloseAsync(...)

// DRAFT, not implemented: whole-cart checkout and exact physical transfer.
HoldOrderWithAllocationsAsync(ValidatedOrderHoldPlan, ct)
    -> StockReservationData // real OrderId, ordinary+accepted capacities atomic
ConvertToCartAsync(owner, agreementId, allocationId, cartVersion, command, ct)
RevokeBeforeOrderAsync(ownerOrStaff, agreementId, expectedVersion, command, ct)
ReadConsumptionAsync(owner, agreementIds, ct) -> AgreementConsumption[]
```

`ValidatedOrderHoldPlan` شامل OrderId/OwnerId/CommandId واقعی، deadline نهایی، ordinary quantities و خطوط agreement→allocation→offerLine→quantity/claim است. Inventory مجموع SKU را از همان plan می‌سازد و ظرفیت سهم عادی و توافقی را مستقل می‌سنجد. یک allocation برای دو خط/دو مشتری یا دو سفارش دوباره مصرف نشود. هیچ `HoldAsync` قدیمیِ دارای validation «VariantId یکتا» با خطوط quote تکراری مستقیم صدا زده نشود.

readerهای عمومی Catalog برای هویت/انتشار/نوع فیزیکی/گزینه/گارانتی/روش خرید و MaterialFingerprint دوباره لازم‌اند. reader حداقلی دریافت فیزیکی مرحله۲ به‌تنهایی برای خرید کافی نیست: Hidden/inactive یا graph غیرقابل نمایش نمی‌تواند به قابلیت خرید مثبت تبدیل شود. `catalog_unavailable` در خرید/quote باعث fail-closed می‌شود؛ استثنای ثبت واقعیت تاریخی دریافت، مجوز ادامهٔ خرید نیست.

## فرمان تخصیص و ساخت Agreement

1. inventory.write/MFA و Origin، body bounds، UUID مستقل actor و targetهای معتبر بررسی شوند. فرم انبار قیمت/مالک را دریافت نمی‌کند؛ واحدهای tracked و نسخهٔ Stock/Unit واقعی صریح انتخاب می‌شوند.
2. داخل AdminAuditFilter موجود، root همان اتصال/transaction Serializable همهٔ moduleهای لازم را assert کند؛ تراکنش تازه داخل آن باز نشود.
3. Market command→request→task locks؛ replay تاریخی قبل از سنجش نسخهٔ زنده. سپس plan پذیرش فعال/نامنقضی، task باز، absence سفارش مصرف‌شده و current material/configuration خوانده شود.
4. Sales Agreement lock به ترتیب شناسه، سپس Inventory allocation command/resource lock و Stockهای مرتب‌شده؛ claim واحدها زیر همان write-intent بررسی شوند. proof Catalog/Market پیش از Stock کامل شود.
5. تمام quantity/claimها یکجا تخصیص و Agreement عین پذیرش materialize شود؛ Market فقط event فرزند و نسخهٔ parent/task را ثبت کند، نه enum تازهٔ درخواست یا تغییر State=Accepted.
6. receipt/audit/event/Agreement/Stock/claim همه با هم commit یا rollback شوند. هیچ callback/ارسال خارجی در این transaction وجود ندارد. UI پس از receipt همان فرمان، GET تازهٔ capability/Stock را می‌خواند.

موجودی قبلی واقعی همان SKU مجاز است؛ از عدد referencePrice بازار یا مقدار رسید به‌تنهایی allocation ساخته نشود. مقدار ReceivedQuantity یک ledger پیشرفت است و authority Available نیست. اگر یک واحد واقعاً قبلاً به خریدار عادی فروخته یا رزرو شده، receipt task حق پس‌گرفتن آن را ایجاد نمی‌کند.

## Cart2 و تبدیل دقیقاً یک بار

مسیر نسخه‌دار پیشنهادی `/api/cart/{locale}/v2` و `/api/cart/{locale}/v2/quote` است؛ cookie/cart/owner/version همان است. `CartSnapshot2` سه بخش مشخص ordinary buy-lines، acceptedOffer buy-lines و sourcing enquiry lines دارد؛ sourcing enquiry وارد جمع قابل خرید نمی‌شود. ارتباط callback، مسیر BFF و PWA exclusion باید پیش از انتشار backend نسخهٔ جدید در هر دو زبان آماده باشند.

تبدیل مالک عضو از child مستقل `POST .../offers/{offerId}/convert` با CommandUUID، request/task/agreement/allocation/cart versions و TermsHash انجام می‌شود. هر target/hash/نسخه بخشی از payload canonical است؛ قیمت و OnHand و actor از body پذیرفته نشوند.

- root پس از request/task، cart exclusive و سپس agreement/allocation را می‌گیرد؛ `CartService` هستهٔ join-parent محدود داشته باشد. accepted lines به CartOfferLines اضافه و cart فقط یک بار touch می‌شود. ordinary lines و انتخاب‌های تازهٔ sourcing دست‌نخورده می‌مانند.
- `SourcingConversions` در Sales با UNIQUE AcceptanceId برای تبدیل نخست و receipt actor+operation+UUID ثبت می‌شود؛ اثر cart، provenance و event Market اتمیک‌اند. متن/مبلغ/مهلت قیمت همان Agreement است.
- replay همان UUID پس از حذف دستی خط cart، تغییر زبان، سفارش، expiry یا تغییر نسخه، نتیجهٔ تاریخی را برمی‌گرداند و چیزی دوباره اضافه نمی‌کند. همان UUID با body/هدف دیگر409 است؛ lookup actor/هدف دیگر404.
- افزودن مجدد بعد از حذف فقط endpoint/command صریح «افزودن دوباره» با نسخهٔ تازه و حدود grant/allocation است. از UNIQUE نخست برای ایجاد حلقهٔ silent re-add استفاده نشود. باقی‌ماندهٔ مصرف معتبر و نبود Order مصرف‌کننده دوباره سنجیده شود.
- حذف خط cart به‌تنهایی revoke/کاهش مقدار پذیرفته‌شده نیست؛ UI بین «حذف از سبد» و «لغو پیگیری و آزادکردن سهم» فرق روشن می‌گذارد. برای نخستین نسخه، checkout یک Agreement فقط با تمام خطوط/مقادیر آن مجاز باشد؛ سبد ناقص blocker دارد و partial order بی‌رضایت ساخته نمی‌شود. کاهش سفارش/جایگزینی نیازمند رضایت تازه است.
- v1 cart/quote mutation در cart دارای offerlines باید `cart_contract_upgrade_required` بدهد یا فقط در عملیات دقیقاً محدود ordinary section و با همان version پشتیبانی شود؛ مسیر انتخاب‌شده قبل از migration قطعی شود. **پیشنهاد این سند fail-closed برای v1 quote/order در سبد دارای offerlines است**؛ snapshot ناقص با جمع ظاهراً صفر یا سفارش بدون خطوط توافقی ارسال نشود. cart عادی/مهمان بدون offerline در v1 کار می‌کند و merge فقط خطوط مجاز صاحب verified را حفظ می‌کند.

برای مهمان Agreement/Allocation وجود ندارد؛ merge به حساب دیگر سهم قبلی را منتقل نمی‌کند. بازخوانی ordinary یا merge نباید با `Include` ناقص موجب حذف OfferLines شود. `ConsumeAsync` جدید دقیقاً ordinary+offerlines quote تأییدشده را از همان cartVersion مصرف می‌کند و CartSourcingLines تازه را پاک نمی‌کند.

## Quote4: قیمت مستقل و ظرفیت مشترک

Quote4 فقط از سبد۲ معتبر ساخته می‌شود. lineKind و LineId پایدار، SnapshotVersion و provenance تا response/table/order حمل شوند. Order2 reader نیز جدا و strict است؛ Order1 تاریخی با LineId ساختگی یا قیمت میانگین بازنویسی نشود. v1 خواندن سفارش۲ باید پاسخ صریح upgrade-required بدهد، نه سفارش بی‌خط؛ UI جدید هر دو نسخه را درست نمایش می‌دهد.

برای هر SKU:

```text
ordinaryQuantity <= PublicAvailable
acceptedQuantityForEachAgreement <= its active owned allocation share
acceptedQuantityForEachAgreement <= its unconsumed agreement quantity
aggregate future order hold <= actual inventory capacity
```

سهم توافقی که از PublicAvailable کم شده، برای صاحبش دوباره از همان PublicAvailable کسر نشود؛ این خطای double-count سفارش معتبر را رد می‌کند. برعکس، ردیف عادی همان مشتری اجازهٔ مصرف سهم اختصاصی استفاده‌نشده را ندارد. چند Agreement یک SKU باید ظرفیت مستقل و claimهای غیرمشترک داشته باشند.

ordinary قیمت جاری Catalog را می‌گیرد؛ acceptedOffer قیمت صحیح Agreement را. تغییر صرف قیمت عمومی، مبلغ توافق را overwrite نمی‌کند؛ quote تازه هنوز ممکن است لازم باشد. تغییر material/گارانتی/گزارش دستگاه/انتشار/روش خرید، Agreement را به blocker/رضایت تازه می‌برد. نسخهٔ جاری Catalog و material hash دو معنای جدا دارند و هر rowversion مساوی تغییر رضایت نیست.

محاسبهٔ مبلغ checked long، و نسبت/مالیات/گردکردن با حساب صحیح موجود انجام شود؛ Rial در تمام DTOها رشته و JS با BigInt است. `9007199254740993×2` دقیق باشد و ضرب/جمع خارج Int64 رد شود. شیوهٔ خرید از اشتراک مجاز همهٔ خطوط و طرح چک از قواعد موجود می‌آید؛ Agreement روش/provider جدید ایجاد نمی‌کند.

fingerprint Quote4 شامل LineId/kind/quantity/قیمت واقعی هر خط، AgreementId/version/terms/material، AllocationId/version/state/deadline، SKU current identity/material/روش‌های خرید، policy حمل/مالیات و OrderSettingsVersion است. snapshotهای اقلام/شرایط پذیرفته‌شده immutable می‌مانند؛ quote فقط اختیار فعلی ادامه را حساب می‌کند.

Expiry پیشنهادی Quote4 کمینهٔ عمر معمول quote فعلی، PurchaseUntil همهٔ توافق‌ها و Allocation.ExpiresAt آن‌هاست. Hold انتقالی نیز از deadline مؤثر خرید/تخصیص/quote و مهلت policy عادی بیشتر نشود. حد معتبر Hold فعلی۱دقیقه است؛ کمتر از آن خطای deadline دارد و retry یا تبدیل deadline را تمدید نمی‌کند. عمر quote پنج‌دقیقه‌ای و ReservationMinutes فعلی دو مفهوم‌اند؛ این محدودسازی برای ردیف sourcing باید در UI صریح و جدا از رفتار تاریخی quote۳ آزموده شود.

خاموشی سفارش موقت، حمل/مالیات unconfigured، zero_amount_review_required، cheque approval و providerهای unconfigured همان blockers واقعی باقی‌اند. Quote4 می‌تواند اقلام و دلیل عدم ادامه را نشان دهد؛ این مرحله مجوز ساخت سفارش صفر/پرداخت‌شده یا نمایش ارسال رایگان به‌عنوان سیاست تأییدشده نیست.

## ایجاد سفارش و انتقال اتمیک

Order2 در همان entrypoint مجاز OrderService، با quote4 معتبر و همان احراز مالک ایجاد شود؛ مسیر خرید تأمین به‌طور مستقل سفارش سازگارتر/آسان‌تر نسازد. ابتدا owner lock فعلی، replay OrderUUID و unique QuoteId، policy/orders due و cart exclusive، سپس Agreementهای مرتب و Inventory locks گرفته شوند. OrderId واقعی سروری **پیش از Hold** ساخته می‌شود و تنها برای همان سفارش به Inventory داده می‌شود.

`HoldOrderWithAllocationsAsync` یک Reservation واقعی برای سفارش ترکیبی می‌سازد: سهم accepted را از SourcingReserved به Reserved منتقل و سهم ordinary را از PublicAvailable hold می‌کند. هر دو در یک transaction و هر Stock یک بار قفل می‌شوند. allocation `Transferred` و immutable Consumption به OrderId/ReservationId متصل می‌شود؛ claimها از AllocationHeld به OrderHeld منتقل می‌شوند. پنجرهٔ آزادکردن سهم بین دو عملیات یا دو رزرو مستقل وجود ندارد.

Agreementها `Consumed`، OrderLinesV2، snapshot quote4، cart consumption و Sales outbox در همان commit هستند. خرابی هر کدام rollback کامل می‌کند. supplier reference، note داخلی Market یا سند دریافت وارد Order customer snapshot نمی‌شود؛ فقط provenance مجاز و قیمت/شرایط رضایت لازم است.

بعد از پرداخت معتبر آینده، reservation همان State=Allocated فعلی را می‌گیرد؛ assignment باید UnitIdهای وعده‌داده‌شدهٔ OrderHeld را به همان سفارش bind کند و برای سهم عادی انتخاب مجاز مستقل بگیرد. WarrantyUntil از policy/اقدام صریح مجاز می‌آید، نه زمان receipt یا allocation. Fulfill بدون تعداد کامل tracked assigned همچنان رد می‌شود. provider خاموش، پرداخت موفق یا این انتقال بعد از پرداخت را شبیه‌سازی نمی‌کند.

## ترتیب قفل و مرز transaction

| مسیر | ترتیب لازم |
|---|---|
| تخصیص مدیر | Market command → request → task → Sales agreement → Inventory command/allocation → Stock مرتب → unit claims |
| تبدیل مالک | owner sourcing/command → request → task → cart exclusive → agreement مرتب → allocation مرتب → Stock فقط در صورت تغییر واقعی سهم |
| لغو تأمین/آزادسازی | command → request → task → cart exclusive → agreement → allocation → Stock مرتب → unit claims |
| quote4 | cart shared → quote command → agreementهای read/guard → allocationهای read/guard؛ بدون request lock Market |
| Order2 | Sales order-owner فعلی → cart exclusive → agreement مرتب → Inventory request/order/reservation فعلی → allocation مرتب → Stock مرتب → unit claims |
| expiry تخصیص | allocation lock → Stock مرتب → unit claims؛ بدون cart/Market/Order-owner |
| expiry/cancel/fulfill سفارش | ترتیب فعلی reservation → Stock و claim همان سفارش؛ بدون گرفتن request Market |

root admin از AdminAuditFilter موجود استفاده می‌کند. customer تخصیص/تبدیل/لغو از coordinator اختصاصی Serializable که فقط در scope مستقل ایجاد می‌شود استفاده می‌کند؛ به سرویس‌های عمومی cart که تراکنش تازه باز می‌کنند وارد نشود. checkout از SalesTransactionCoordinator موجود با قرارداد Sales/Inventory استفاده می‌کند؛ MarketDbContext وارد OrderService نمی‌شود و پس از داشتن cart/Stock به Market lock بازنمی‌گردد.

ترتیب کارهای موجود order-owner و cart برعکس نشود. اگر مسیر لغوِ دارای cart تشخیص داد grant به سفارش مصرف شده، همان‌جا OrderService.CancelAsync را صدا نزند: آن متد order-owner می‌خواهد و ترتیب معکوس می‌سازد. باید conflict/provenance خواندنی و مسیر مجاز سفارش را برگرداند؛ فرمان صریح بعدی Sales با ترتیب خودش اجرا می‌شود.

در تمام absent-key/idempotency guards از الگوی write-intent ثابت و مرتب (`UPDLOCK,HOLDLOCK`) استفاده شود؛ شکست مرحله۲ نشان داد shared gap هنگام انتظار mapping می‌تواند چرخه بسازد. اینجا quote/agreement/allocation/claim uniqueness نیز باید با SQL همزمان آزموده شوند؛ compile یا صرف app-lock نام‌گذاری‌شده اثبات نبود deadlock نیست.

## لغو، انقضا و پیوند وضعیت سفارش

State تخصیص: `Active` → `Released|Expired|Transferred`، هیچ بازگشت خودکار به Active. `Transferred` از نظر supply expiry دیگر قابل آزادسازی نیست. State receipt، Offer.Accepted و ورود واقعی انبار دست‌نخورده‌اند. انقضای clock فوری قابلیت را می‌بندد؛ worker صرفاً counters/claims فیزیکی را به‌صورت bounded آزاد می‌کند. تأخیر worker به‌جای فروش بیش از موجودی، محافظه‌کارانه Available را کمتر نگه می‌دارد.

لغو جدید مشتریِ تأمین پذیرفته‌شده، که مرحله۲ نداشت، لازم است: مالک پس از تأیید روشن می‌تواند **پیش از مصرف Order** agreement را revoke، cart offerlines متعلق را حذف، allocation را آزاد و task را با تاریخچه Cancelled کند. OnHand کم نمی‌شود و هیچ سفارش واقعی/خرید خارجی لغو نمی‌شود. staff cancel/fail مرحله۲ و parent close در foundation به guard/coordinator متصل شده‌اند؛ پس از اضافه‌شدن cart/Order2 باید همان مسیر اتمیک را برای حذف offerline و مصرف واقعی توسعه داد و راه قدیمی برای عبور از موجودی محفوظ باز نگذاشت.

اگر مصرف Order وجود دارد، Request/Task.Cancel یا Fail نمی‌تواند رزرو سفارش را آزاد کند؛ حتی وقتی PurchaseUntil گذشته، Offer.IsActive قبلاً false یا projection Market عقب است. Sales consumption authoritative بررسی می‌شود. سفارش AwaitingPayment/Paid/Fulfilled مسیر خودش را دارد؛ unpaid cancel/expiry، refund/return آینده و تحویل، از Sales/Payments/Inventory انجام می‌شوند. پس از سفارش terminalِ unpaid، بستن پیگیری می‌تواند مجاز شود ولی Agreement/Allocation مصرف‌شده به Active برنمی‌گردد و سهم دوباره آزاد نمی‌شود.

`Sales.SourcingOrderOutbox` با کلید event UUID/OrderId+sequence در commit سفارش و تغییر معتبر بعدی نوشته شود؛ worker مستقل به Market رویداد deduplicated می‌دهد. payload فقط Request/Task/Offer/Acceptance/Agreement/Allocation/OrderId، نسخه/وضعیت، deadline و ContainsDemo دارد؛ آدرس/تلفن/یادداشت/credential ندارد. worker پس از commit request/task را قفل می‌کند؛ شکست/راه‌اندازی مجدد آن سفارش یا Hold را دوباره نمی‌سازد.

تا projection برسد، capability حساس از Sales/Inventory فعلی compose می‌شود؛ outbox عقب‌افتاده اجازهٔ لغو، تخصیص دوباره یا پرداخت نمی‌دهد. expiry مستقل Inventory نباید برای revoke کردن Sales در حالی که Stock قفل است، cart/agreement جدید بگیرد؛ event/outbox یا effective deadline این ارتباط را مدیریت می‌کند.

برای پایان واقعی پیگیری پس از fulfillment، وضعیت task فعلی کافی نیست: قید `IsOpen` و enum سخت Supply1 فقط سه حالت باز و Cancelled/Failed دارند. **قرارداد نسخهٔ بعدی Supply یا purchase-child با terminal=Completed هنوز DRAFT است. Supply2 فعلی فقط read تخصیص را افزوده و enum قبلی workflow را حفظ کرده است.** تنها رویداد fulfillment معتبر Sales آن را کامل می‌کند، نه دریافت، conversion یا Paid تنها. schema1 درخواست و Offer همچنان همان‌اند؛ reader Supply1 برای رکورد دارای enum تازه پاسخ upgrade-required می‌دهد و مقدار جعلی Cancelled/Failed نمی‌سازد. این تغییر پیش از اضافه‌کردن وضعیت به SQL/serializer باید در هر دو رابط پذیرفته شود. تکمیل payment/fulfillment واقعی و USED همچنان دامنهٔ کامل بعدی است؛ اضافه‌کردن enum به‌تنهایی پایان کار نیست.

## API آیندهٔ تبدیل/checkout و الزامات بازیابی — DRAFT

| مسیر جدید پیشنهادی | نقش/مرز | اثر |
|---|---|---|
| `GET /api/sourcing/requests/{id}/purchase` | فقط مالک | Agreement/Allocation/Order capability فعلی و مهلت، بدون supplier/IMEI |
| `POST .../offers/{offerId}/convert` و `/readd` | فقط مالک + origin | اثر cart idempotent و صریح |
| `POST .../supply/{taskId}/cancel-supply` | مالک یا sales.write مجاز در مسیر staff جدا | revoke/release پیش از Order؛ پس از مصرف مسیر Sales |
| `GET /api/cart/{locale}/v2` و mutation بخش‌بندی‌شده | همان cart identity/version | ordinary و offer buy-lines + enquiry بخش مستقل |
| `POST .../v2/quote` | همان checkout root | Quote4؛ هیچ provider fake |
| order endpoint نسخهٔ جدید و OrderDetail2 | فقط مالک/کارمند مجاز | snapshot خط پایدار و provenance؛ Hold واقعی |

تمام فرمان‌ها actor+operation+UUID مستقل از resource، target و hash canonical بدنه دارند؛ replay پیش از نسخهٔ زنده و نتیجهٔ تاریخی محدود است. GET تازه authority وضعیت فعلی است. نقش finance برای ویرایش قیمت Offer همچنان جداست؛ inventory.write یا sales.write قیمت را تغییر نمی‌دهد. مشتری مالک از principal است؛ staff receipt کارمند دیگر404 و دادهٔ خصوصی بدون حدس status افشا نشود.

journal تأمین/خرید در هر سطح همان slot حساب را توسعه می‌دهد؛ slot موازی برای allocation/conversion ساخته نشود. unknown همان UUID/body را در ناوبری و unavailable/restoring حفظ اما از داده/عملیات حساب تأییدنشده پنهان می‌کند؛ logout/401 قطعی/مالک دیگر پاک می‌کنند. موفقیت/receipt تا GET تازهٔ هم‌نسخه در refresh می‌ماند؛ شکست GET فقط retry خواندن دارد و فرمان دوباره ارسال نمی‌شود. عملیات stock/conversion خودکار retry نشود.

private/no-store/noindex، Vary Cookie/Authorization و exclusion کامل PWA حفظ شوند. صفحه۲۰ مشتری/۵۰ مدیر، cursor مقید به مالک/هدف/فیلتر و byte-budget واقعی با nextCursor لازم است. scalarهای nullable صریح، event bigint رشته، body معمول۱۶KiB و استثنای bounded tracked selection فقط برای route واقعی تعیین شود. قیمت، Serial/IMEI، private supply note و provenance خارجی سه دسترسی جدا دارند. ContainsDemo تا agreement/allocation/conversion/quote/order/outbox حفظ و در Production بسته است.

## آزمون‌های پذیرش پیش از انتشار

1. GUID SQL واقعی: قبول→task/رسید واقعی→تخصیص→Agreement→convert→Cart2→Quote4. تک‌تک مراحل عدم تغییر قیمت عمومی، OnHand ثابت در allocation/convert، counter/claim واقعی و نبود Order/Payment تا OrderService را ثابت کنند.
2. ordinary+دو Agreement همان SKU با قیمت‌های متفاوت؛ Cart2، Quote4 و Order2 سه LineId/قیمت مستقل و Inventory یک aggregate صحیح داشته باشند. quote/order قدیمی نتواند offerline را حذف یا average کند.
3. آخرین واحد: دو allocation، ordinary checkout، allocate versus Hold، expiry/release/retire/adjust و انتقال همزمان؛ دقیقاً یک ظرفیت مصرف و invariant هر دو reserve حفظ شود. هر Stock یک بار و canonical مرتب قفل شود.
4. IMEI/serial مشخص: unit claim مشتری اول توسط allocation، Retire یا paid assignment مشتری دوم مصرف نشود. انتقال همان واحد به OrderHeld و assign معتبر همان Order، سپس cancel/fulfill یک بار؛ warrantyUntil حدس زده نشود.
5. receipt UUID/target/payload/actor/operation برای allocation، release، convert/readd/cancel-supply و Order؛ قطع پاسخ بعد از commit و همان UUID فقط یک اثر. replay بعد از حذف cart، expiry و مصرف سفارش re-add یا تمدید نکند.
6. stale cart/request/task/offer/agreement/allocation/stock/unit versions، overposting owner/price/quantity-cap و مدل جایگزین همگی رد و rollback شوند. task quantity و claim یک واحد برای دو line/Agreement مصرف نشود.
7. تغییر صرف قیمت عمومی توافق را عوض نکند؛ تغییر material/گارانتی/روش خرید/گزارش USED، hidden/inactive/future publication و ظرفیت Catalog، quote/convert/order را fail-closed کند. استثنای ثبت تاریخی receipt برای خرید مصرف نشود.
8. PurchaseUntil و Allocation/Quote/order deadlines در یک tick قبل/خود مرز؛ worker خاموش و چند worker. حد Hold کمتر از۱دقیقه رد و هیچ retry deadline را تمدید نکند. Transferred با expiry sourcing آزاد نشود.
9. cancellation owner/staff و parent close پیش/پس از conversion و در رقابت با Order2: قبل مصرف revoke/release/cart atomیک؛ بعد مصرف مسیر Sales و بدون دوباره‌آزادسازی. expiry Offer به‌تنهایی Order فعال را قابل لغو از Market نکند.
10. fault در ledger/claim/Agreement/conversion/cart/order/receipt/audit/outbox، تمام writeهای تراکنش rollback؛ crash پس از commit/قبل پاسخ و worker restart deduplicated باشد. checkout هرگز بعد از cart/Stock request Market نگیرد.
11. `9007199254740993`, Int64.MaxValue، صفر واقعی، ضرب/جمع overflow، مالیات/چک checked و JSON money strings/JS BigInt؛ نسخه/نوع خط/قیمت پذیرفته تا historical order حفظ شود.
12. هزینه/مالیات اصلی نامعلوم و TemporaryOrdersEnabled=false همچنان blocker؛ providerهای gateway/credit/SMS/email unconfigured موفق نشوند. policy مصنوعی D21 فقط همان QA مجاز و پس از cleanup صفر تنظیم نمونه روی اصلی.
13. public Available پس از allocation کمتر و market eligibility واقعی جابه‌جا شود؛ private request/Offer/Acceptance حذف نشوند. release دوباره Available را برگرداند و دیگران هیچ سهم owner را در quote مصرف نکنند.
14. Customer/InventoryManager/SalesManager/FinanceManager و anonymous/mfa_pending؛ private price/supplier/note/serial projectionها و receiptها جدا، owner switch/late response/auth unavailable در دو رابط.
15. wire واقعی Cart2/Quote4/Order2/Supply2 و reader تاریخی Cart1/Quote1–3/Order1/Request1/Offer1؛ schema enum تازه پیش از consumer سازگار منتشر نشود. تمام null/Unicode/paging و byte-budget معتبر قابل عبور باشند.
16. مرورگر متصل دو حساب/دو تب، FA/EN و موبایل RTL؛ همان SKU دو قیمت، لغو/re-add، quote blocker، claim دقیق، دو پاسخ گم‌شده، ناوبری→auth unavailable→همان حساب→receipt/GET تازه. هیچ credential مالک مصرف نشود.
17. کل رگرسیون SQL cart/merge/quote/order/reservation/serial/receiving؛ EF pending model و SQL idempotent، backup تازه و restore schema جدید در GUID QA، smoke و hash حفظ قیمت/Stock/CMS/حساب‌های اصلی. native Linux مستقل/بار/پایش شواهد جدا می‌خواهند.

## ترتیب پیشنهادی پیاده‌سازی و کار باقی‌مانده

1. foundation، StockV2/Supply2، SerialV2 و فرمان تخصیص با SQL/wire/مرورگر دسکتاپ پذیرفته‌اند؛ موبایل واقعی، restore۳۳ و پذیرش انتشار بازند. ارتقای محدودِ دارای reservation/serial پذیرفته است، نه همهٔ تاریخچه‌های پُر. STATUS شاهد قبولی است، این فهرست نیست.
2. رگرسیون **تمام** مسیرهای قدیمی Inventory و SQL رقابت، expiry/replay/rollback و صفر اثر ساختگی لازم‌اند؛ نمایش «محفوظ» فقط از تخصیص واقعی فعال و contract جدید بیاید.
3. [Cart2/convert مستقل](MARKET-CART2-SLICE.md) با گیت V1 پیش از shortcut/replay و provenance ثابت ساخته شود؛ با policyهای خاموش فقط سبد و blocker واقعی، نه موفقیت مالی. lifecycle پیش از حل چرخهٔ request/cart، سبد را eager cleanup نکند.
4. Quote4، Order2، انتقال atomic و outbox/guard لغو؛ خواندن تاریخی و rollback/مرز deadlines و browser واقعی.
5. provider/هلو قرارداددار، approval چکی/اسناد، پرداخت/refund/تحویل/مرجوعی و پایان workflow واقعی؛ USED device report/snapshot، چندانبار/ماندهٔ قبلی، منوی بازار/facet/نظرات/مقایسه، رسانه/امنیت، PWA/accessibility/CWV، Linux/Docker/CI/backup/restore و بقیهٔ PRD/PDF همچنان بازند. مرحلهٔ سوم فقط با سبزشدن compile یا یک مسیر demo پایان اعلام نشود.

این پیش‌نویس هیچ تصمیم باز تجاری را از طرف مالک پاسخ نمی‌دهد و scope کامل فروشگاه را به مسیرهای حاضر کاهش نمی‌دهد. مانع provider بیرونی جلوی اجرای مستقل Inventory/Sales/قرارداد و تست‌های واقعی را نمی‌گیرد؛ هر قابلیت خارجی تا مدارک/قرارداد/آزمون خودش unavailable باقی می‌ماند.
