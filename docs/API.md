# قرارداد برش فعلی API

API یک modular monolith با .NET 10 و EF Core 10 است. هر ماژول schema و DbContext مستقل دارد. Composition root در `backend/src/Shop.Api/Program.cs` قرار دارد. ارتباط Catalog با موجودی و شرایط خرید فقط از قرارداد است.

## D70 — فضای کالا و ویدیو، فعال روی اصلی93

تمام مسیرهای `/api/admin/catalog/workspace` زیر staffMFA وcatalog.read هستند؛ mutation/receiptخواندن، catalog.write نیز می‌خواهند و Origin/X-Sayman-Clientکنترل می‌شوند. پاسخ خصوصی no-store/noindex است؛ پراکسی محدود پنل همان قرارداد را منتقل می‌کند.

- `GET /products`: `search` تا120نویسه/8واژه، `status=all|Draft|Published|Hidden|archived`، `categoryId`، `brandId`، `availability=all|available|empty`، `sort=name|category|brand|status|price|stock|variants|updated`، `direction=asc|desc`، `page` صفرمبنا و `pageSize=25|50|100`. کلید تکراری/ناشناخته رد می‌شود. پاسخ schemaVersion1 و totalCountرشته‌ای، صفحه و itemsخلاصه شامل کمینه/بیشینهٔ ریال رشته‌ای، موجودی آزاد خواندنی رشته‌ای، تصویر وversion دارد. ترتیب/فیلتر/شمارش درSQL است.
- `GET /products/{id}`: کالای قابل‌ویرایش وarchiveflag وvideos؛ نسخهٔ قدیمیAdminProductDetailوImageMediaبدون تغییر ناسازگار باقی‌اند.
- `POST /save`: `{requestId,productId:null|id,product:ProductInput}`. `ProductInput` شامل Videosاختیاری است؛ nullیعنی حفظ قبلی و[]یعنی حذف روابط ویدیو. هیچ stock/onHand/reservedنمی‌پذیرد.
- `POST /prices`: `{requestId,productId,version,lines:[{variantId,version,priceRial,compareAtRial,isActive}]}`؛ حداکثر100تغییر، CASمادر/تنوع و قیمت integerریال رشته‌ای. تاریخچهٔ قیمت واقعی حفظ می‌شود و سفارش/quoteقدیمی بازنویسی نمی‌شوند.
- `POST /archive`: `{requestId,productId,version,restore}`؛ archiveبهHidden/ArchivedAt وrestoreفقطDraft. تاریخچه/موجودی/سفارش حذف فیزیکی نمی‌شوند.
- `GET /fields` و `PUT /fields`: تنظیم محدود فیلدهای شناخته‌شدهٔ فرم باversion/command؛ برچسب/راهنما/ترتیب/نمایش اختیاری. الزام‌های هویتی/مالی سرور خاموش نمی‌شوند؛ قواعد/گزینه‌های دسته از قراردادهای موجود دسته/ویژگی مدیریت می‌شوند.
- `GET /commands/{requestId}`: رسید پایدار فقط همانactor؛ UUIDسی‌ودوhex، fingerprint وrootSerializable/applock/CAS. تکرار دقیق همان نتیجه و payloadمتفاوت conflict است. خطای فیلد schemaمحدود `fieldErrors` دارد؛ خطا mutation/auditنیمه‌کاره باقی نمی‌گذارد.

ویدیو: `GET /api/admin/media/videos/capabilities` و `POST /api/admin/media/videos` باstaffMFA/public_media.write. multipartفقطیک`file`MP4/WebM،32MiB،10دقیقه و پردازش/اسکن واقعی؛ [MEDIA](MEDIA.md) حدود کامل را دارد. خواندن عمومی صادرشده `/api/media/videos/{id}/clip.mp4|webm` باRange/ETag/SHA وpublicmarker است. فروشگاه `/media/videos/...` و پنل `/api/media/videos/...` آن را به‌صورت محدود جریان می‌دهند. لینک مستقیمHTTPS توسط سرور fetchنمی‌شود. جزئیات محصول فقط ویدیوهای مدل/تنوع انتخابی را با nativecontrols/preloadnone نمایش می‌دهد.

شواهد آزمون و مرزChromeخصوصی در [STATUS](STATUS.md)، [راهنمای مدیر](PRODUCT-WORKSPACE.md) و [نمونه‌های SQL/HTTP](../artifacts/checks/d70-examples-verification.json) ثبت‌اند؛ migration93دوباره اجرا نشود.

## D66 — کتابخانهٔ خصوصی تصاویر Ready

این بخش قرارداد منبع است؛ شواهد انتشار در [STATUS](STATUS.md) ثبت‌اند و پذیرش خصوصی مرورگر هنوز باقی است. `GET /api/admin/media/images` فقط `staff_mfa` و policy موجود `public_media.write`، یعنی یکی از `catalog.write` یا `cms.write`، می‌خواهد. endpoint فقط متادیتای Ready را از SQL می‌خواند؛ ذخیره‌ساز/اسکنر پیش‌نیاز این فهرست نیستند و سلامت فعلی فایل از آن نتیجه نمی‌شود.

query فقط `q`، `fromAt`، `toAt` و `cursor`، هرکدام یک بار است. `q` اختیاری، prefix شناسه با ۴..۳۲ نویسهٔ hex ASCII و نرمال‌شده به lowercase است؛ برای بدون جست‌وجو ارسال نشود. بازهٔ زمان ایجاد asset برابر `[fromAt,toAt)`؛ شروع شامل و پایان غیرشامل، برابر دو حد خالی و معکوس نامعتبر. زمان ورودی UTC ISO با `Z` و کسر اختیاری ۱..۷ رقم است؛ خروجی `asOfAt/createdAt` هفت رقم کسر دارد. query ناشناخته/تکراری، offset/فاصله/تاریخ ناممکن و `page/pageSize/sort` رد می‌شوند.

پاسخ `{schemaVersion:1,asOfAt,pageSize:24,items,nextCursor}` با حداکثر ۲۴ item مرتب‌شده بر `CreatedAt DESC, Id DESC` و `BIN2` است؛ `nextCursor` رشته یا `null` صریح. هر item فقط `{id,url,createdAt,variants}` دارد: `id` برابر ۳۲ hex کوچک، `url` اصلی `/media/catalog/{id}/card.webp` و دقیقاً `thumb/card/zoom` با `{name,url,width,height,bytes,sha256}` و URL canonical همان شناسه. نام فایل اصلی، EXIF، actor، مسیر ذخیره‌ساز و دادهٔ خصوصی برنمی‌گردد. سه اندازه/حدود/hash بررسی می‌شوند؛ فایل از objectstore خوانده یا دوباره اسکن نمی‌شود.

cursor پایه۶۴URL حداکثر ۱۰۲۴ نویسه، مقید به فیلتر و `asOfAt/watermark` است و امضای امنیتی نیست. مرز انحصاری `MIN_ACTIVE_ROWVERSION()` و `CreatedAt <= asOfAt` از ورود درج/Readyشدن دیرهنگام به ادامه جلوگیری می‌کنند. این snapshot کامل SQL نیست؛ تراکنش طولانی نامرتبط می‌تواند نمایش ردیف‌های commitشدهٔ جدیدتر را تا تازه‌سازی عقب بیندازد. فیلتر یا تازه‌سازی پیمایش تازه می‌گیرد.

پنل فقط با بازکردن صریح «انتخاب از تصاویر آماده» در ویرایشگر تصویر، این فهرست را می‌گیرد. انتخاب فقط URL را به همان فرم اضافه می‌کند؛ هیچ upload، ذخیره/حذف SQL، اتصال حوزه یا انتشار خودکار انجام نمی‌دهد. ثبت نهایی از گردش عادی مجوز/CAS همان فرم می‌گذرد؛ گالری نسخه‌دار دستگاه کارکرده و آپلود موجود حفظ‌اند. Ready بودن، بی‌ارجاع‌بودن یا اجازهٔ حذف نیست. فهرست خصوصی `Cache-Control: private, no-store`، `X-Robots-Tag: noindex, nofollow`، `X-Content-Type-Options: nosniff` و `Vary: Cookie, Authorization` دارد و در PWA/storage پایدار ذخیره نمی‌شود؛ مسیر عمومی تصویر کنترل و کش مستقل قبلی را حفظ می‌کند. خطاها: ۴۰۰ `invalid_image_library_filter`/`invalid_image_library_cursor`، ۴۰۱/۴۰۳ نشست و مجوز، ۵۰۳ `media_unavailable`. [راهنمای کتابخانه و حدود](MEDIA.md#d66--انتخاب-دوباره-از-تصاویر-آماده) و [STATUS](STATUS.md) مراجع قرارداد و پذیرش جدا هستند.

## D65 — تاریخچهٔ خصوصی قیمت کالا

`GET /api/admin/products/{productId}/price-history` فقط `staff_mfa` و `catalog.read`؛ خواندنی و بدون تغییر قیمت/انبار/سفارش/audit است. query فقط `variantId`، `direction=all|increase|decrease`، `fromAt`، `toAt` و `cursor` را هرکدام یک بار می‌پذیرد؛ پارامتر ناشناخته/تکراری ۴۰۰ است. شناسهٔ کالا/تنوع ASCII حرف/رقم/`_`/`-` و حداکثر ۶۴ نویسه است. کالاهای Draft/Hidden و تنوع‌های غیرفعال برای مدیر مجاز قابل مشاهده‌اند؛ تنوع کالای دیگر ۴۰۴ است.

بازه `[fromAt,toAt)` است؛ شروع شامل و پایان غیرشامل. برابری دو حد نتیجهٔ خالی و بازهٔ معکوس ۴۰۰ است. ورودی زمان UTC ISO با `Z` و کسر اختیاری ۱..۷ رقم، بدون offset/فاصله/تاریخ ناممکن است؛ پاسخ `asOfAt` و `changedAt` همواره هفت رقم کسر دارد. اندازهٔ ثابت ۵۰، ترتیب `CreatedAt DESC, Id DESC` با collation شناسه `BIN2`؛ `page/pageSize/sort` ندارد. cursor پایه ۶۴ URL حداکثر ۱۰۲۴ نویسه، مقید به کالا/فیلتر و مرز مشاهده است؛ امضای مجوز نیست.

پاسخ `{schemaVersion:1,productId,asOfAt,pageSize:50,variants,items,nextCursor}` است. `variants` حداکثر ۵۰۰ متادیتای کامل `{id,sku,isActive,currentPriceRial}` و `items` حداکثر ۵۰ رویداد `{id,variantId,oldPriceRial,newPriceRial,changedBy,changedAt}` دارد؛ `nextCursor` همیشه رشته یا `null` صریح است. مبلغ‌ها رشتهٔ صحیح ریال/Int64 و در مرورگر `bigint` هستند. SKU/فعال‌بودن/قیمت فعلی، دادهٔ جاری هر پاسخ‌اند؛ مبلغ قدیم/جدید و شناسهٔ عامل از رویداد موجود خوانده می‌شوند. برای قیمت اولیه یا سابقهٔ خالی رویداد ساخته نمی‌شود.

صفحهٔ نخست `asOfAt` و مرز انحصاری `MIN_ACTIVE_ROWVERSION()` را می‌گیرد؛ ادامه فقط رویدادهای `CreatedAt <= asOfAt` و `Version < watermark` همان پیمایش را می‌خواند. append تازه حتی با timestamp عقب‌تر وارد ادامه نمی‌شود. این snapshot کامل SQL نیست؛ تراکنش طولانی نامرتبط می‌تواند نمایش رویدادهای commit شدهٔ جدیدتر را تا تازه‌سازی عقب بیندازد. تازه‌سازی/تغییر فیلتر نمای جدید می‌گیرد؛ metadata جاری میان صفحه‌ها منجمد نیست. نمودار خصوصی پنل فقط رویدادهای یک تنوع در همان صفحه را با SVG مستقل نشان می‌دهد؛ نمودار عمومی یا سری زمانی پیوسته ساخته نشده است.

پاسخ و خطاها `Cache-Control: private, no-store`، `X-Robots-Tag: noindex, nofollow`، `X-Content-Type-Options: nosniff` و `Vary: Cookie, Authorization` دارند؛ تاریخچه در storage/PWA ذخیره نمی‌شود. خطاها:۴۰۰ `invalid_price_history_filter`/`invalid_price_history_cursor`،۴۰۱/۴۰۳ هویت و مجوز،۴۰۴ `not_found`،۴۰۹ تعارض نسخه و ۵۰۳ `catalog_unavailable`. [راهنمای پنل، محدودیت مشاهده و منابع فنی](PRICE-HISTORY.md) مرجع تفصیلی‌اند؛ وضعیت انتشار از [STATUS](STATUS.md) خوانده شود.

## D60 — قرارداد پذیرفته و منتشرشدهٔ نسخهٔ۸۸

این قرارداد با دو migration Sales۸۷ `PostpaidShipping` و۸۸ `PrivateReturnRequests` روی همان نسخهٔ محلی منتشر شده است: [انتشار۸۸](../artifacts/checks/commerce-rma-52f840c405b74fa4ba39c8f733aa9e33-main-release.json). [STATUS](STATUS.md) مرجع runtime و پذیرش جاری است؛ بخش‌های قدیمی پایین سابقهٔ همان برش‌اند. تنظیم واقعی سیاست‌ها از نشست مدیر و QA محدود Chrome/۱۰۷GET/SQLreadback پذیرفته‌اند: [پذیرش D60](../artifacts/checks/commerce-rma-acceptance.json). این قبولی شامل همهٔ گردش‌های خصوصی مرورگر نیست. تصمیم مالک در [DECISIONS/D60](DECISIONS.md) ثبت است؛ دادهٔ QA به سیاست اصلی منتقل نشده است.

### هزینه، مالیات و مهلت سفارش

`GET|PUT /api/admin/checkout-charges` همچنان به MFA کامل و `finance.read|finance.write` متناسب با روش نیاز دارد؛ PUT با نسخهٔ جاری، تراکنش و audit اعمال می‌شود. حالت‌های قدیمی حفظ‌اند و دو مقدار محدود تازه اضافه شده‌اند:

- `shippingMode:"postpaid"`: ورودی `shippingFeeRial` و `shippingFreeFromRial` هر دو `null` هستند. quote فیزیکی `shippingRial:"0"` و `chargeRules.shippingReason:"postpaid"` دارد؛ صفر فقط مبلغ حمل دریافتی فروشگاه است. هزینهٔ جداگانهٔ شرکت حمل نامعلوم و به‌عهدهٔ مشتری است؛ ارسال رایگان یا مبلغ صفر برای شرکت حمل ادعا نمی‌شود. quote کاملاً دیجیتال `shippingReason:"digital"` دارد. در مبنای `goods_shipping` فقط مبلغ کالای فروشگاه به‌علاوهٔ حمل آنلاینِ معلوم وارد می‌شود؛ هزینهٔ بیرونی نامعلوم محاسبه یا مالیات‌گذاری فرضی نمی‌شود.
- `taxMode:"included_unitemized"`: `taxRateBasisPoints:null`، `taxIncluded:true` و `taxRial:null` است. مبلغ کالا شامل مالیات است، اما جزء مالیات تفکیک نشده؛ نرخ، معافیت یا مالیات صفر ساخته نمی‌شود. `payableTotalRial` معلوم، برابر کالا به‌علاوهٔ حمل آنلاین است و مالیات دوباره اضافه نمی‌شود. همین معنا در quote۳/۴/۵، خرید عادی، پیشنهاد تأمین و خرید چکی حفظ می‌شود. `inclusive` با نرخ معلوم، رفتار قدیمی خود را دارد.

در جزئیات Order1، OrderV2 و projection سازگار آن‌ها، `taxRial` فیلد صریحِ رشتهٔ ریال یا `null` است. فقط سفارش تازهٔ بدون تفکیک، `taxBreakdownKnown:false` دارد و هم‌زمان `taxIncluded:true` و `taxRial:null` لازم‌اند؛ این پرچم برای سوابق قدیمی/تفکیک‌شده حذف می‌شود. در SQL، nullableشدن `Orders.TaxRial` و `TaxBreakdownKnown` با CHECK به snapshot تاریخی مقیدند. مسیر خواندن و guard پرداخت، `null` را به صفر تبدیل نمی‌کنند.

`shippingMode?:"postpaid"` فقط در تاریخچهٔ سفارش فیزیکی‌ای صادر می‌شود که snapshot اصلی quote، هر دو `ChargeRules.ShippingMode` و `ShippingReason` را `postpaid` و حمل آنلاین را صفر ثبت کرده باشد. در سوابق قدیمی، ارسال رایگان و سفارش دیجیتال، فیلد حذف می‌شود. نام قابل‌ویرایش ارسال یا تنظیم امروز مرجع این تشخیص نیست. snapshot خراب یا disclosure متناقض به `order_shipping_unavailable|order_tax_unavailable` با503 می‌انجامد؛ جایگزین با سیاست امروز یا مبلغ فرضی وجود ندارد. شکل JSON/hash و رسیدهای تاریخی فاقد فیلدهای اختیاری حفظ می‌شوند.

`GET|PUT /api/admin/order-settings` همچنان مدت و سقف سفارش پرداخت‌نشده را با مجوز فروش/MFA و CAS مدیریت می‌کند. تصمیم اولیهٔ مالک۶۰دقیقه و۲سفارش باز است؛ اعمال واقعی آن ازپنل و بازخوانی۶۰/۲ در [گزارش نهایی](../artifacts/checks/commerce-rma-main88-final-live.json) ثبت شده است؛ گیت ثبت چکی مطابق وضعیت قبلی خاموش ماند. quote باید هنگام ساخت و پس از انتظارهای تراکنش هنوز معتبر باشد؛ انقضای پنج‌دقیقه‌ای قیمت، مهلت رزرو عادی پس از ثبت موفق نیست. رزرو تازه از زمان ثبت معتبر تا مدت تنظیم‌شده است، ولی `PurchaseUntil`، تخصیص و اختیار مالی/بررسی چک با مهلت زودتر همچنان سقف سخت‌اند. replay همان سفارش/مهلت قبلی را برمی‌گرداند و رزرو را تمدید نمی‌کند. محدودیت جریان OrderV2 به سبد و پیشنهاد معتبر نیز عوض نشده است.

### درخواست مرجوعی و شکایت دیجیتال — `rma-v1`

مرجع گردش و راهنمای مدیر/مشتری [RETURNS](RETURNS.md) است. این برش فقط ثبت درخواست، انصراف و بررسی است؛ همهٔ DTOهای مربوط `canRefund:false` و `refundAvailability:"provider_unconfigured"` دارند. `canReceive/canRestock/canReship` در جزئیات false می‌مانند. هیچ API برای بازپرداخت، دریافت انبار، افزایش موجودی، ارسال مجدد، لغو مانده یا تغییر حق ارسال چکی اضافه نشده است.

| روش و مسیر | مجوز و کاربرد |
|---|---|
| `GET /api/returns/policy` | عمومی، بدون ارسال Cookie یا Authorization؛ `configured` الزامی است. در نبود تنظیم، enabled و دو نوع درخواست false و conditionsFa/En، windowMode و windowDays همگی صریحاً null هستند |
| `GET /api/orders/{orderId}/returns/context` | مشتریِ مالک سفارش؛ snapshot، نسخهٔ سفارش، سیاست جاری، تعداد واقعی قابل درخواست و blockers. alias با `/v2` ندارد؛ هر دو snapshotVersion را از خود سفارش می‌خواند |
| `PUT /api/orders/{orderId}/returns/commands/{commandId}` | مشتریِ مالک؛ ساخت از context معتبر و تأیید صریح؛201 تازه یا200 replay |
| `GET /api/returns[?state=...&after=...]` | فهرست همان مشتری؛ state اختیاری submitted/reviewing/reviewed/withdrawn و cursor مقید به مالک/فیلتر |
| `GET /api/returns/{caseId}` | جزئیات همان مالک، بدون ownerId عمومی یا یادداشت خصوصی کارکنان |
| `PUT /api/returns/{caseId}/withdrawals/{commandId}` | انصراف مالک از درخواست باز، با version و دلیل و confirmed=true |
| `GET /api/returns/commands/{commandId}` | رسید تاریخی همان عامل/مخاطب مشتری؛ خواندن آن درخواست تازه نمی‌سازد |
| `GET /api/admin/returns[?state=...&after=...]` | MFA کامل کارکنان و sales.read؛ فهرست شامل ownerId برای پیگیری مجاز |
| `GET /api/admin/returns/policy` و `/policy/history[?beforeRevision=...]` | MFA کامل و sales.read؛ current صریحاً null یا revision، تاریخچه صفحه۲۰تایی و beforeRevision صحیح۱..۱۰۰۰۰ |
| `PUT|GET /api/admin/returns/policy/commands/{commandId}` | علاوه بر موارد بالا sales.write؛ ثبت نسخهٔ سیاست یا رسید همان عامل |
| `GET /api/admin/returns/{ownerId}/{caseId}` | MFA کامل و sales.read و sales.write؛ جزئیات شامل یادداشت خصوصی مجاز کارکنان |
| `PUT /api/admin/returns/{caseId}/commands/{commandId}` | همان مجوزها؛ startReview یا completeReview با ownerId و version صریح |
| `GET /api/admin/returns/commands/{commandId}` | همان مجوزها؛ رسید تاریخی بررسیِ همان عامل/مخاطب کارکنان |

شناسه‌های مسیر BFF از نوع GUID غیرصفر N32، version پایه۶۴ هشت‌بایتی و snapshotHash/payloadHash از نوع SHA-256 هستند. ساخت فقط `{policyRevisionId,orderVersion,kind,lines:[{lineKey,quantity}],reason,acknowledgeNoFinancialAction:true}` می‌گیرد؛ kind از physicalReturn/digitalComplaint و حداکثر۶۴خط یکتا از context همان سفارش است. سفارش مختلط در یک درخواست، دو نوع خط را مخلوط نمی‌کند. هیچ مالک، قیمت، مبلغ refund یا وضعیت سفارش از ورودی مشتری پذیرفته نمی‌شود.

سیاست نسخه‌دار `{version,enabled,physicalReturns,digitalComplaints,conditionsFa,conditionsEn,windowMode,windowDays,maxOpenPerOwner,note,confirmed:true}` است. windowMode محدود به manualReview با days=null یا deliveryDays با۱..۳۶۵۰روز است؛ تصمیم اولیهٔ مالک۳روز پس از تحویل واقعی است. حداکثر درخواست باز RMA، اختیاری و مستقل از سقف۲سفارش پرداخت‌نشده است. ثبت سیاست، نسخهٔ جاری CAS می‌خواهد و revisionهای قبلی تغییر نمی‌کنند. جزئیات درخواست همان سیاست و خطوط تاریخی زمان ثبت را نگه می‌دارند.

مرجع تعداد و زمان، Sales است: برای کالای فیزیکی فقط مقدار تحویل‌شده به مشتری در shipment/parcel و برای دیجیتال مقدار واقعاً Availableشده؛ زمان مشاهدهٔ محتوای دیجیتال خوانده یا حدس زده نمی‌شود. در deliveryDays هر خط فقط در مهلت همان تحویل واقعی قابل درخواست است. وضعیت سفارش باید Paid/CreditApproved/Fulfilled باشد؛ این شرط به معنی تأیید بانکی چک نیست. یک درخواست باز به‌ازای سفارش مجاز است و سقف اختیاری مالک نیز زیر قفل بررسی می‌شود. مرور دوباره یا replay مهلت را تمدید نمی‌کند.

بررسی `{ownerId,version,action,outcome,note,customerMessage,acknowledgeNoFinancialAction:true}` می‌گیرد. `submitted→reviewing` با startReview و outcome=null؛ `reviewing→reviewed` با completeReview و outcome=followUp یا declined. declined بسته است؛ followUp برای پیگیری باز می‌ماند. انصراف مالک هر درخواست باز را withdrawn و بسته می‌کند. شروع/نتیجهٔ بررسی، پذیرش مالی یا Refunded نیست.

همهٔ خواندن‌ها و نوشتن‌ها در root Serializable مشترک Identity/Sales انجام می‌شوند؛ context، جزئیات و فرمان پرونده قفل مالک، سیاست قفل مستقل و فرمان قفل عامل/UUID دارد. اولین فرمان موفق، تغییر دامنه، رویداد، receipt حفاظت‌شده و audit متادیتا را اتمیک ثبت می‌کند؛ خطای audit یا حفاظت، کل تغییر را برمی‌گرداند. replay قبل از CAS/مهلت جاری، همان نتیجهٔ تاریخی را با replayed=true می‌دهد؛ UUID مشترک با payload متفاوت409 است. receipt مشتری با رسید کارکنان یا عامل دیگر قابل جایگزینی نیست. note سیاست، دلیل، متن رویداد و رسیدها purpose/actor/owner-bound حفاظت می‌شوند؛ audit متن خصوصی ندارد و snapshot/سیاست/رویداد/رسید تاریخی immutable هستند.

API/BFF با `X-Sayman-Returns-Contract:rma-v1`، JSON bounded و UTF-8 سخت کار می‌کنند. پاسخ موفق بدون marker و404 بی‌marker از upstream به503 تبدیل می‌شود؛401/403 خالی حفظ می‌شوند. حداکثر درخواست حتی chunked۳۲KiB، پاسخ پراکسی۲MiB و عمق JSON۳۲است؛ کلید تکراری بدون حساسیت به حروف، فیلد ناشناخته، query نامعلوم/تکراری، redirect و Set-Cookie رد می‌شوند. public policy بدون credential upstream است؛ باقی مسیرها Bearer، X-Sayman-Client مناسب، Origin مجاز برای mutation و رد Sec-Fetch-Site=cross-site دارند. پاسخ خصوصی و خطاها private/no-store/noindex/nosniff هستند؛ public policy نیز no-store/noindex است. body شامل دلیل/یادداشت/receipt در cache عمومی یا PWA ذخیره نمی‌شود.

خطاهای معمول:400 invalid_rma،401نشست،403مجوز/Origin،404نبود منبع متعلق به مالک،409نسخه/سیاست/مهلت/تعداد/ظرفیت/همان فرمان با بدنهٔ متفاوت،413سقف درخواست و415نوع محتوا؛ داده یا حفاظت ناسازگار503 rma_unavailable است. مشتری در پاسخ نامعلوم، همان بدنهٔ منجمد و UUID را با رسید بررسی می‌کند؛ commandId تازه یا retry خودکار mutation جایگزین این کار نیست.

**به‌روزرسانی 2026-10-24:** **اصلی۳۱/سورس۳۱ محلی** است؛ پیگیری و دریافت واقعی مرحلهٔ دوم زیر قرارداد [MARKET-SUPPLY-RECEIPTS](MARKET-SUPPLY-RECEIPTS.md) با۶۲۰ واحد/کل۲۴۳ SQL واقعی،۱۴۴ پنل/۲۱۰ فروشگاه،۱۷ wire، build و مرورگر دو نقش/FA-EN/mobile/قطع پاسخ و auth پذیرفته و منتشر شد. پس از cleanup و بکاپ تازه، فقط۱۰جدول افزایشی خالی اضافه و حساب/Stock/قیمت-SKU/CMS/counts حفظ شدند؛۴۹ smoke ناشناس/no-store و DBCC PHYSICAL_ONLY موفق‌اند. QA دادهٔ دریافت۲واحد/۰رزرو/۲سند/گردش را آزمود؛ به اصلی داده/seed منتقل نشد، CheckoutOrderSettings اصلی صفر/خاموش است و عمل واقعی تأمین‌کننده یا API هلو انجام نشد. [STATUS](STATUS.md)، supply-ui-acceptance.json و supply-main31-release.json شواهد و حدودند؛ native Linux/بار/restore کامل۳۱ باقی‌اند. بخش‌های قدیمی تاریخچه‌اند. رضایت غیرمالی است؛ تخصیص/توافق Sales/Cart2/Quote4/OrderSnapshot2/تبدیل به checkout، MARKET-02 و کل PDF هنوز کامل نیستند.

## خواندن عمومی

- `GET /health/live`: زنده بودن process؛ اتصال SQL را ثابت نمی‌کند.
- `GET /health/ready`: بررسی اتصال SQL و نبود migration معوق در هشت schema؛ جای اجرای سناریوی فروش را نمی‌گیرد.
- `GET /api/storefront/fa` یا `/en`: محتوای منتشرشده، دسته‌ها، ویژگی‌های تایپ‌دار، کالا/تنوع، موجودی قابل فروش و تنظیم روش‌های خرید/چک. snapshot فعلاً `isPreview:true` است؛ ثبت سفارش واقعی وجود ندارد.
- مبلغ‌ها در تمام JSONها رشتهٔ صحیح ریال هستند؛ `long`های شناسهٔ رویداد/نسخه نیز به رشته تبدیل می‌شوند. تعداد موجودی `int` است.

## هویت

تمام مسیرهای `/api/admin` پیش از authentication/authorization، حتی پاسخ401، هدرهای `Cache-Control: private, no-store`، `X-Robots-Tag: noindex, nofollow` و `Vary: Cookie, Authorization` دارند؛ `nosniff` عمومی API حفظ می‌شود. scope بر پایهٔ قطعهٔ کامل مسیر است و `/api/administrator-...` را شامل نمی‌شود. این قاعده مجوزی اعطا نمی‌کند؛ [پذیرش روی اصلی۸۶](../artifacts/checks/business-private-headers-acceptance.json).

`POST /api/auth/password` با `{identifier,password}` برای ایمیل یا نام کاربری. پاسخ کامل، access token ده‌دقیقه‌ای و refresh cookie از نوع HttpOnly/SameSite=Strict دارد. access token فقط در حافظهٔ مرورگر است. دادهٔ refresh در SQL هش می‌شود؛ چرخش و کشف replay با SQL واقعی محلی آزموده شده‌اند.

ورود کارکنان فقط از مسیر پنل، با headerهای `X-Sayman-Admin: 1` و `X-Sayman-Client: admin` و Origin مجاز مدیر است. مدیر ابتدا token محدود `mfa_pending` می‌گیرد؛ به API مدیریت دسترسی ندارد. `POST /api/auth/mfa/setup` کلید Authenticator و challenge تازه را می‌دهد. پاسخ همچنین account/issuer/algorithm=SHA1/digits=6/period=30 را دارد. پنل طبق D31 از همین پاسخ QR محلی تولید می‌کند؛ URI یا تصویر از سرویس خارجی نمی‌گیرد. شمارش exp فقط UX است و سرور اعتبارسنجی را انجام می‌دهد. `POST /api/auth/mfa/verify` کد را بررسی و زمان مصرف‌شده را اتمیک ثبت می‌کند. enrollment و replay در تست SQL واقعی پاس شده‌اند؛ راه‌اندازی حساب اصلی و QA مرورگر جداست.

`POST /api/auth/refresh` و `/logout` به Origin مجاز نیاز دارند. cookie پنل `sayman_admin_refresh` و cookie فروشگاه `sayman_refresh` است. Origin فروشگاه اجازهٔ refresh نشست پنل ندارد. `GET /api/auth/me` فقط اطلاعات همان کاربر را می‌دهد.

D68: `POST /api/auth/staff/change-password` با `{currentPassword,newPassword,code}` فقط حساب همان subject را تغییر می‌دهد. نشست جاریِ پایدار/MFAدار، نقش شناخته‌شدهٔ کارکنان، مبدأ و client مدیر، رمز فعلی و TOTP تازه/مصرف‌نشده لازم‌اند. ورودی ناشناخته یا query پذیرفته نمی‌شود. رمز تازه طبق PasswordValidators و طول۱۲تا۱۲۸ بررسی می‌شود و نباید همان رمز فعلی باشد. موفقیت204/private-no-store، تغییر hash/SecurityStamp، مصرف counter، ابطال تمام نشست‌ها و audit اتمیک دارد؛ کوکی مدیر پاک می‌شود و Authenticator/نقش/کدهای پشتیبان محفوظ‌اند. اثبات نامعتبر با400/invalid_staff_confirmation و یک شمارش خطا/audit رد می‌شود؛ به401/retry تبدیل نمی‌شود. احراز نشست نامعتبر401 است. هیچ targetId/reset بدون رمز فعلی/OTP مشتری در این مسیر وجود ندارد. [راهنمای مدیر](ADMIN-ACCESS.md).

D67: ورود و ساخت مشتری با OTP واقعی sms.ir پیاده و روی اصلی فعال‌اند؛ آمادگی مؤثر به تنظیمات خصوصی ارسال و روش مطلوب منتشرشده وابسته است. ثبت‌نام از تأیید OTP انجام می‌شود؛ مسیر قدیمی `/api/auth/register` و بازیابی رمز همچنان503 هستند. تنظیم ورود global از سند `auth/fa` خوانده می‌شود؛ روشن‌کردن CMS به‌تنهایی کلید/ارسال را پیکربندی نمی‌کند.

**تداوم ورود مشتریان فعلی — روی اصلی، تکمیل‌شده با D67:** ذخیرهٔ `PUT /api/admin/content/auth/fa` فقط پیش‌نویس است؛ حداقل یکی از `emailPassword`، `usernamePassword` و `mobileOtp` باید در پیش‌نویس فعال باشد؛ انتشار OTP-only به سرویسLive آماده نیاز دارد. `POST /api/admin/content/auth/fa/publish` با `version` جاری، چه برای انتشار پیش‌نویس و چه برای بازگردانی با `restoreRevisionId`، پیش از تغییر انتشار، تداوم ورود مشتریان واجد شرایط را بررسی می‌کند. شناسهٔ revision از نوع long و در JSON رشتهٔ ده‌دهی است. مجوز `cms.write`، نشست کامل کارکنان/MFA و کنترل نسخه حفظ‌اند؛ بازگردانی هم انتشار جدید است و از این بررسی عبور نمی‌کند.

اگر تنظیم انتخاب‌شده فقط یکی از دو روش رمز را نگه دارد، مشتری فعالِ دارای رمز و دست‌کم ایمیل یا تلفن تأییدشده باید حداقل یک شناسهٔ قابل استفاده در همان مسیر واقعی ورود داشته باشد. کارکنان دارای نقش شناخته‌شدهٔ مدیریت از این جمعیت جدا هستند. تشخیص مسیر با وجود `@`، نرمال‌سازی و lookup یکتا مطابق ورود واقعی است؛ تعارض با حساب دیگر حتی اگر غیرفعال، تأییدنشده یا همکار باشد، شناسهٔ قابل استفاده محسوب نمی‌شود. فقط وجود رمز در شرط SQL می‌آید؛ مقدار hash رمز در برنامه materialize، لاگ یا برگردانده نمی‌شود. حساب‌های فعال/تأییدشدهٔ بدون رمز هم در D67 بررسی می‌شوند؛ روشن‌ماندن هر دو روش رمز، مجوز خاموش‌کردن آخرین مسیرOTP آن‌ها نیست. شماره باید یکتا، تأییدشده و مطابق مسیر واقعی باشد و حساب هیچ نقش کارکنان نداشته باشد. این کنترل حساب قدیمیِ معیوب را خودکار تعمیر نمی‌کند.

رد محدودکننده با HTTP409 و `customer_login_continuity_conflict` است. بررسی در تراکنش Serializable مشترک Identity/CMS و پیش از نوشتن انجام می‌شود: انتشار، revision، پیش‌نویس ذخیره‌شده، نسخه و audit موفق تغییری نمی‌کنند. پیش‌نویس تک‌روشِ معتبر می‌تواند ذخیره شود؛ امکان انتشار آن را سرور بر اساس حساب‌های فعلی تعیین می‌کند، نه فرم پنل. این مسیر رمز، اطلاعات تماس، تأیید هویت، نشست یا MFA مشتری/مدیر را تغییر نمی‌دهد و OTP/provider را فعال نمی‌کند.

شواهد D59 تاریخی در [پذیرش پیشین](../artifacts/checks/business-continuity-backend/acceptance.json) محفوظ‌اند. D67 رویschema89 با۱۷۴۰unit و۶۹SQLدر۷کلاس‌کامل/cleanupصفر پذیرفته است؛ fullSQL این برش اجرا نشده. [پذیرش جاری](../artifacts/checks/customer-otp-backend/acceptance.json) و [STATUS](STATUS.md) مرز دقیق عملیاتی را دارند.

کلید Authenticator در SQL با Data Protection رمز می‌شود. در توسعه key ring در `tmp/identity-keys` قرار می‌گیرد؛ حفظ آن برای ورود بعدی ضروری است. محیط Production به مسیر پایدار کلید و certificate رمزگذاری کلیدها نیاز دارد (`DataProtection__KeyDirectory`, `DataProtection__CertificatePath`, `DataProtection__CertificatePassword`). بکاپ SQL بدون key ring و certificate برای بازیابی MFA کافی نیست.

## مدیریت مجوزدار

| مسیر `/api/admin` | مجوز |
|---|---|
| GET `catalog` | `catalog.read` |
| POST/PUT `categories`, `brands`, `attributes`, `products` | `catalog.write` |
| GET `inventory` | `inventory.read` |
| GET `inventory/movements` | `inventory.read`؛ نشست کامل، نه mfa_pending |
| POST `inventory/{variantId}/adjust` | `inventory.write` |
| GET `purchase-methods`, `cheque-plans` | `finance.read` |
| POST/PUT `purchase-methods`, `cheque-plans` | `finance.write` |
| GET `content` | `cms.read` |
| PUT `content/{key}/{locale}`, POST `.../publish` | `cms.write` |
| GET `audit` | `audit.read` |

PUTها به `version` از خواندن قبلی نیاز دارند. version همان rowversion به Base64 است. رکورد قدیمی با 409 رد می‌شود. محصول منتشرشده تصویر، تنوع فعال، دو ترجمه و روش خرید لازم دارد. ویژگی‌ها Text/Number/Bool/Select/MultiSelect هستند؛ اعداد ویژگی decimal(28,8)، و قیمت bigint است. محور تنوع MultiSelect ندارد. حذف تنوع قبلی از فرم آن را غیرفعال می‌کند.

اصلاح موجودی `{delta,reason,requestId,version}` دریافت می‌کند. requestId یک UUID است؛ تکرار دقیق درخواست همان نتیجه را می‌دهد. تغییر تراکنش Serializable و کنترل نسخه دارد. تست تکرار دقیق و تعارض همزمان روی SQL واقعی پاس شد. رزرو داخلی از `IStockReservations` انجام می‌شود؛ endpoint مستقیم مرورگر ندارد. جزئیات چرخه/قفل/انقضا در [INVENTORY-RESERVATIONS.md](INVENTORY-RESERVATIONS.md). سبد/سفارش موقت و دفتر سریال/IMEI در سورس اضافه شده‌اند؛ checkout نهایی و مالی/حسابداری کامل هنوز باقی است.

جدول جدید با `GET /api/admin/inventory/workspace/variants` و مجوز `inventory.read` کار می‌کند. `query` نام یا SKU، `active` وضعیت تنوع، `minAvailable` و `maxAvailable` بازهٔ ماندهٔ آزاد، `sort=name|sku|available`، `direction=asc|desc`، `page` صفرمبنا و `pageSize=25|50` هستند. پاسخ `{items,total,page,pageSize}` تنوع‌های فیزیکی را حتی بدون سابقهٔ موجودی می‌شمارد. ماندهٔ تازه ممکن است هنگام اصلاح هم‌زمان با زمان فیلتر فهرست فرق کند. فرم شمارش، موجودی را با نسخهٔ تازه می‌خواند و فرمان اصلاح همان SKU را ارسال می‌کند.

CMS سند `site/fa` و `site/en` دارد: برند، فونت مجاز، رنگ روشن/تاریک، تماس، تنظیمات اختیاری SEO هر زبان، منوی درختی، hero، بلوک خانه و بنر زمان‌دار. نوع بلوک whitelist است؛ HTML یا JavaScript دلخواه اجرا نمی‌شود. ذخیره فقط draft را تغییر می‌دهد؛ انتشار snapshot و revision جدید می‌سازد. `restoreRevisionId` در publish نسخهٔ قبلی را به‌عنوان انتشار جدید برمی‌گرداند. preview خصوصی draft هنوز ساخته نشده است.

## محدودهٔ تأییدشده و باقی‌مانده

Build،۱۶۵ تست بک‌اند،۴۷ تست SQL واقعی و اعمال هفده migration/seed موفق‌اند. اجرای SQL روی مک ARM با Rosetta است؛ معیار Linux x64، بار و QA کامل پنل هنوز جدا لازم‌اند.

Audit موفق مدیریت اکنون همراه mutation در یک transaction Serializable ثبت می‌شود؛ شکست درج audit تغییر دامنه را rollback می‌کند. درخواست با نسخهٔ قدیمی و خواندن عمومی رویداد موفقیت نمی‌نویسند. actor، مسیر، روش و trace ذخیره می‌شوند؛ audit دامنهٔ کامل/تغییرات قبل‌وبعد و امنیت شکست‌ها هنوز باقی است. snapshot کامل و لیست مدیریت هنوز موجودند؛ root فروشگاه metadata-only و صفحات از query/filter/page/lookup محدود استفاده می‌کنند. ترجمهٔ SQL و اتصال preview آزموده شده، اما اجرای مثبت SQL پاس شده و سنجش بار باقی است؛ پذیرش سرویس واقعی رسانه، مدیریت کارکنان/بازیابی MFA، ذخیرهٔ آدرس/سفارش و همهٔ providerهای واقعی باقی‌اند.

منابع فنی استفاده‌شده: [بردارهای TOTP در RFC 6238](https://datatracker.ietf.org/doc/html/rfc6238#appendix-B)، [اصلاح Pkcs در اعلان Microsoft](https://github.com/dotnet/runtime/security/advisories/GHSA-846f-f764-76mx)، [imageهای رسمی ASP.NET](https://github.com/dotnet/dotnet-docker/blob/main/README.aspnet.md).

مسیرهای آفلاین و SEO در process فروشگاه Next قرار دارند، نه API مدیریت: `/pwa/catalog/{fa|en}.json` فقط DTO عمومی بدون اطلاعات مالی می‌دهد و marker مخصوص worker دارد. `/fa/manifest.webmanifest` و `/en/manifest.webmanifest` نام و رنگ منتشرشده را می‌خوانند. هیچ cookie یا Authorization کاربر هنگام دریافت snapshot سروری به API فرستاده نمی‌شود. شرح allowlist و تنظیمات `site.seo` در `PWA-SEO.md` است.

## API query کاتالوگ

POST `/api/catalog/{locale}/search` و `.../facet-values`، GET `.../filters?categoryId=...` و POST `.../lookup` عمومی و خواندنی‌اند. GET `/api/storefront/{locale}?metadataOnly=true` محصولات را حذف می‌کند. قرارداد، نمونه، حدود ورودی، ارث‌بری variant، view Inventory و repair در [CATALOG-QUERY.md](CATALOG-QUERY.md) است. کد، ترجمهٔ SQL و مرز ورودی تأیید شده‌اند؛ adapter مرورگر/SSR/BFF با preview و پاسخ خطای upstream آزموده شد. ذخیره/خواندن و query مثبت SQL در مجموعهٔ۳۱ سناریوی واقعی محلی تأیید شدند.

مدل شرایط چک `roundingUnitRial` دارد: در فرم مدیریت عدد ۱ یا ۱۰، در پاسخ عمومی رشتهٔ ریال است. migration ده‌ریالی را برای دادهٔ قدیمی پیش‌فرض می‌گذارد و CHECK دارد. نرخ‌ها basis point صحیح‌اند و عمومی با حداکثر دو رقم اعشار درصد ارائه می‌شوند. محاسبهٔ preview نمونه است؛ checkout API mode اکنون quote سروری دارد. سررسید قطعی، سفارش و امضای شرایط هنوز پیاده نشده‌اند.

BFF Next همان مسیرهای `/api/catalog/{locale}/{search|filters|lookup|facet-values}` را فقط برای این چهار عملیات عمومی عرضه می‌کند؛ body حداکثر ۳۲ KiB، schema دوطرفه، مهلت ۸ ثانیه، عدم دنبال‌کردن redirect، بدون cookie/Authorization upstream و Cache-Control برابر no-store. Origin فرستاده‌شده با origin فروشگاه تنظیم‌شده تطبیق دارد؛ خطای سرویس 503 است و fixture جایگزین API نمی‌شود. مسیر auth و پنل مجوزهای مستقل دارند.

`facet-values` ورودی `{categoryId,key,query?,page=1,pageSize=20,selectedValues=[]}` دارد؛ حداکثر pageSize=60 و 20 انتخاب/8 واژه است. پاسخ version/locale/key، values صفحه، selectedValues دارای عنوان حتی بیرون صفحه، total/page/pageSize/totalPages دارد. filters اولیه برای هر ویژگی total و حداکثر 20 مقدار می‌دهد؛ truncated به معنی وجود صفحهٔ بعد است. گزینه/متن با FacetSearch مشتق‌شده جست‌وجو می‌شوند؛ عدد با prefix رشتهٔ invariant decimal و Bool در true/false و عناوین بله/خیر/Yes/No. هیچ مبلغی به float تبدیل نمی‌شود. شرح repair و حدود در `CATALOG-QUERY.md` است.

## رسانهٔ عمومی

GET `/api/admin/media/capabilities`، POST `/api/admin/media/images` و فهرست خصوصی GET همان مسیر به `staff_mfa` و policy موجود `public_media.write` نیاز دارند؛ این policy یکی از `catalog.write` یا `cms.write` را می‌خواهد. multipart فقط یک `file` می‌پذیرد؛ پاسخ upload برابر `{id,url,variants}` و پاسخ فهرست مطابق بخش D66 بالاست. GET `/api/media/catalog/{id}/{thumb|card|zoom}.webp` عمومی است و فقط Ready+hash معتبر را می‌دهد. ProductDto اکنون `images` مرتب نیز دارد؛ `image` برای تصویر اصلی سازگار مانده است. حدود، وضعیت SQL، پیش‌فرض Disabled، S3/ClamAV و محدودیت‌های باقی در [MEDIA.md](MEDIA.md) هستند.

پاک‌سازی رسانه API عمومی ندارد. فرمان اپراتوری `--reconcile-public-images` و worker اختیاری `Media__CleanupEnabled=true` همان lease/rowversion را استفاده می‌کنند؛ Ready حذف نمی‌شود و Staged/Failed قدیمی بعد از پاک‌سازی به Purged می‌روند. گزارش/حدود و نگه‌داری ردیف در MEDIA.md شرح داده شده است.

## سبد خصوصی Sales

GET/PUT `/api/cart/{locale}` و POST `.../merge` پیاده‌اند؛ مهمان با cookie امن و عضو با access token خودش شناخته می‌شود. مبلغ/موجودی از سرور، ویرایش با rowversion و ادغام یک‌باره با تراکنش SQL انجام می‌شود. قرارداد، حدود، BFF و شاهد۹ SQL/۱۴ HTTP در [SERVER-CART.md](SERVER-CART.md) است. رابط فروشگاه اکنون به این سبد متصل است؛ نشست سراسری، انتقال و۱۱ QA در SERVER-CART ثبت شده‌اند. quote معتبر و رابط محاسبهٔ checkout اکنون آماده‌اند؛ سفارش و پرداخت واقعی باقی‌اند.

## محاسبهٔ سروری خرید

POST `/api/cart/{locale}/quote` همان هویت و نسخهٔ سبد را می‌گیرد. درخواست بدون روش، شرایط جاری را می‌خواند؛ انتخاب روش/طرح و UUID غیرصفر، snapshot اتمیک۵دقیقه‌ای می‌سازد. قیمت از قرارداد Catalog و موجودی از Inventory است؛ تمام مبالغ رشتهٔ ریال‌اند. replay همان نتیجه و مهلت، payload متفاوت409 و session منقضی/مصرف‌شده خطا دارد. ارسال/مالیات تعیین‌نشده و provider/order غیرفعال blocker صریح‌اند؛ CanPlaceOrder هنوز false است. BFF، رابط دو زبانه، محدودیت‌ها و۱۰ SQL/۱۷ HTTP و QA در [CHECKOUT-QUOTES.md](CHECKOUT-QUOTES.md) ثبت‌اند.

## تنظیم هزینه‌ها و quote نسخه۲

GET/PUT `/api/admin/checkout-charges` با finance.read/write و MFA کامل، سیاست نسخه‌دار Sales را می‌خوانند/ذخیره می‌کنند؛ PUT با audit اتمیک است. حالت نبود تنظیم، دادهٔ تعیین‌نشده و بدون ایجاد سطر است. quote تازه schema2 و chargeRules دارد؛ مالیات داخل قیمت از مبنا استخراج می‌شود و دوباره اضافه نمی‌شود. replay schema1 پشتیبانی می‌شود؛ مبلغ نهایی فقط با هزینه‌های معلوم محاسبه می‌شود. جزئیات، حدود،۶ SQL تازه و QA پنل واقعی در [CHECKOUT-CHARGES.md](CHECKOUT-CHARGES.md) است. سیاست اصلی هنوز انتخاب نشده؛ سفارش و providerها غیرفعال‌اند.

## سفارش موقت و quote نسخه۳ (سورس جدید، هنوز روی اجرای اصلی منتشر نشده)

قرارداد کامل [TEMPORARY-ORDERS.md](TEMPORARY-ORDERS.md) است. POST مشتری `/api/orders` فقط با quote3 معتبر، روش نقدی مجاز، هزینه‌های معلوم و فعال‌سازی صریح مدیر، سفارش AwaitingPayment و hold می‌سازد؛ CanPay همیشه false است. GET فهرست/جزئیات همان مالک و POST `{id}/cancel` با version آماده‌اند. settings با GET/PUT `/api/admin/order-settings` و summary صفحه‌بندی‌شده با GET `/api/admin/orders`؛ جزئیات `/{ownerId}/{id}` و لغو `/{id}/cancel` دارای sales.write/MFA و audit اتمیک‌اند. FinanceManager فقط summary را با sales.read می‌خواند.

تمام مقادیر ریال رشته‌اند. ایجاد سفارش/رزرو/خالی‌کردن سبد یک transaction است؛ UUID و hash مالک‌محور و یک سفارش برای هر quote از تکرار جلوگیری می‌کنند. فرم و API خصوصی no-store هستند؛ نشانی اولیه IR و برای دیجیتال null است. replay quote۱/۲ فقط خواندنی سازگار باقی می‌ماند. اجرای اصلی هنوز quote2 و۱۷ migration دارد؛ migration۱۸، QA احرازشدهٔ متصل و update آن منتظر اعلام آزادشدن فضا هستند. build ایزولهٔ Next و۱۴ HTTP بدون هویت و۱۱ QA محدود مهمان/خطا موفق شدند؛ این بررسی‌ها اتصال سفارش به SQL را تأیید نمی‌کنند.

## projection عمومی آفلاین (سورس تازه)

GET `/api/catalog/{locale}/offline?limit=200` ناشناس و native no-store است؛ limit۱–۵۰۰، حداکثر۵۰۰ دسته، محصولات منتشرشدهٔ برند/دسته و تنوع فعال و truncated صریح دارد. DTO فقط نام/توضیح/برند/دسته/تصویر عمومی مجاز و site کوچک منتشرشده است؛ قیمت، موجودی، گارانتی، روش خرید و هویت خوانده یا ارائه نمی‌شوند. Next همین DTO را با schema مستقل برای PWA منتشر می‌کند و در خطا503/no-store می‌دهد؛ API mode به snapshot کامل یا fixture برنمی‌گردد. [OFFLINE-PROJECTION.md](OFFLINE-PROJECTION.md) شواهد و مرزها را ثبت می‌کند؛ اجرای SQL و انتشار اصلی هنوز باقی‌اند.

## projection سایت‌مپ (سورس تازه)

GET `/api/catalog/{locale}/sitemap` شمارش رشته‌ای محصول/دسته، pageSize=1000 و گیت منتشرشدهٔ همان زبان می‌دهد؛ GET `.../sitemap/{products|categories}?page=1` فقط key/fa/en، حداکثر۱۰۰۰ ردیف و صفحه۱–۵۰٬۰۰۰ دارد. هر دو عمومی/no-store هستند؛ قیمت، موجودی و graph مالی خوانده نمی‌شوند. فقط ترجمهٔ واقعی زبان، موجودیت فعال و محصول منتشرشدهٔ موعدرسیده قابل معرفی‌اند. Native API همچنان preview است و اجازهٔ ایندکس واقعی نمی‌دهد.

Next در `/sitemap.xml` index و در ریشه مانند `/sitemap-fa-products-1.xml` فایل XML با canonical/alternate معتبر می‌دهد؛ rewrite داخلی بدون redirect به handler مشترک است. robots نیز همین manifest محدود را می‌خواند. سقف index۵۰٬۰۰۰ فایل، خطای منبع503/no-store/Retry-After و بدون fallback است؛ گیت غیرفعال index خالی دارد و API خوانده نمی‌شود. [SITEMAP-PROJECTION.md](SITEMAP-PROJECTION.md) قرارداد، حدود و محدودیت شمارش/OFFSET و شاهد۲۹ HTTP را ثبت می‌کند؛ دو SQL تازه فقط compile شده‌اند و انتشار اصلی انجام نشده است.

## تاریخچهٔ انبار (سورس تازه)

GET `/api/admin/inventory/movements` فیلترهای اختیاری variantId، direction=all|in|out، fromAt/toAt و cursor دارد. پاسخ version1/pageSize50، items و nextCursor یا null است؛ Id رویداد رشتهٔ صحیح و هر ردیف شامل تنوع/تغییر/ماندهٔ فیزیکی/دلیل/عامل/درخواست/زمان است. query حداکثر۵۱ ردیف با Id نزولی و seek می‌خواند؛ cursor با همهٔ فیلترها تطبیق دارد. بازهٔ زمان UTC، شروع شامل و پایان انحصاری است. GET قدیمی inventory با includeMovements=false query۱۰۰تایی تاریخچه را حذف و movements خالی می‌دهد؛ omission رفتار قبلی را حفظ می‌کند. Stock هنوز کامل است.

۱۸ تست جدید بک‌اند و۵ contract پنل و۱۵ QA محدود کامپوننت موفق‌اند؛ دو SQL تازه فقط compile شده‌اند و نسخهٔ زنده تغییر نکرد. [INVENTORY-HISTORY.md](INVENTORY-HISTORY.md) مرز مجوز، نبود snapshot مشترک، picker فعلی، شواهد و پذیرش‌های باز را شرح می‌دهد.

## صفحهٔ موجودی و summary (سورس تازه)

GET `/api/admin/inventory/variants` با query حداکثر۱۲۰/۸واژه، active=all|true|false و cursor وابسته به فیلتر، صفحهٔ۵۰ می‌دهد؛ GET همین مسیر `/{id}` فقط همان تنوع را می‌خواند. هر دو inventory.read کامل دارند. Catalog متادیتای مختصر بدون قیمت/graph و Inventory موجودی همان شناسه‌ها را می‌دهند؛ تنوع بدون Stock صفر و version=null است و خطای سرویس هرگز صفر فرض نمی‌شود. GET `/api/admin/inventory/summary` با inventory.read شمارندهٔ رشته‌ای Stock/آزاد/رزرو، و GET `/api/admin/catalog/summary` با catalog.read شمارندهٔ رشته‌ای کالا/دسته دارد. همه no-store هستند.

پنل موجودی و داشبورد از snapshot قدیمی Inventory/Catalog جدا شدند؛ صفحات دیگر هنوز تکمیل pagination می‌خواهند. مدل‌ها migration تازه ندارند.۲۶۷ بک‌اند/۱۰ contract و۱۴ QA فقط خواندنی موفق، دو SQL جدید فقط compile شده‌اند. [INVENTORY-PAGING.md](INVENTORY-PAGING.md) شواهد و محدودیت snapshot/بار و فرم اصلاح را ثبت می‌کند؛ source روی اجرای اصلی منتشر نشده است.

## مدیریت کالا و انتخاب CMS (سورس تازه)

GET `/api/admin/products` با query تا۱۲۰/۸واژه، status=all|Draft|Published|Hidden، categoryId/brandId و cursor وابسته به فیلتر، خلاصهٔ۵۰ کالا می‌دهد. GET `products/{id}` همان یک کالای کاملِ قابل ویرایش را در envelope schemaVersion1/product و GET `catalog/product-lookup?ids=id1&ids=id2` حداکثر۲۴ خلاصهٔ موجود را می‌دهد. همگی catalog.read کامل/no-store هستند؛ lookup GET audit mutation ندارد و با id معتبر lookup تداخل نمی‌کند. POST/PUT قبلیِ نوشتن و version/audit همچنان مرجع‌اند.

GET `catalog?metadataOnly=true` products خالی و بدون query graph می‌دهد؛ omission رفتار legacy را حفظ می‌کند. پنل جاری همیشه metadataOnly می‌گیرد و برای فهرست، ویرایش و انتخاب از مسیرهای محدود جدید استفاده می‌کند. ساختار دسته/برند/تعریف/گزینه هنوز کامل است؛ پایان pagination مدیریت نیست. DTO جزئیات پول صحیح رشته‌ای و تمام روابط/نسخه‌ها را حفظ می‌کند. null نهایی cursor در DTOهای جدید کالا/موجودی/گردش و version بدون Stock صریح نگه داشته شدند؛۷ قرارداد HTTP واقعی test host به TypeScript نیز موفق‌اند.

۲۸۸ بک‌اند،۱۶ contract و۲۳ QA فقط خواندنی موفق؛ SQL۷۳ هنوز اجرا نشده و ویرایش/MFA/ذخیرهٔ CMS و انتشار اصلی باقی است. [ADMIN-PRODUCTS.md](ADMIN-PRODUCTS.md) مرجع قرارداد/محدودیت و شواهد است.

## کد پشتیبان MFA کارکنان (سورس تازه، اصلی منتشر نشده)

GET `/api/auth/mfa/recovery-codes` فقط schemaVersion1/remainingCodes از حساب خود می‌دهد. POST همان مسیر با Password/Code، رمز جاری و TOTP تازه را بررسی و۱۰ کد یک‌بارمصرف را فقط همان پاسخ برمی‌گرداند. هر دو staff_mfa (access و نقش کارکنان)، Origin پنل و X-Sayman-Client: admin لازم دارند. فقط hash وابسته به UserId ذخیره می‌شود و GET هیچ کدی افشا نمی‌کند.

POST `/api/auth/mfa/recover` با mfa_pending، Password/RecoveryCode و همان کنترل Origin/client، کد مصرف‌نشده را اتمیک مصرف و تمام نشست‌های قبلی را باطل می‌کند؛ فقط challenge راه‌اندازی بدون permission/refresh برمی‌گردد. AuthResponse فیلد افزایشی requiresRecovery دارد: در MfaRecoveryPending، ورود صرفاً رمز requiresRecovery=true/RequiresEnrollment=false می‌دهد و setup/verify را باز نمی‌کند. فقط claim امضاشدهٔ mfa_recovery=verified اجازهٔ ثبت دوباره دارد؛ setup deadline اولیه۵دقیقه را نگه می‌دارد. verify کلید تازه، پرچم/کدهای قدیمی را پاک و نشست کامل صادر می‌کند.

Password صحیح برای حساب MFA شمارندهٔ شکست را قبل از عامل دوم reset نمی‌کند. refresh از stamp منسوخ، stamp جدید را دوباره نمی‌چرخاند. همهٔ پاسخ‌ها no-store و مشمول rate limit auth هستند؛ audit شامل هیچ رمز/کد/کلید/token نیست. Source migration۱۹ و SQL idempotent آماده، اصلی۱۷ و۱۸/۱۹ اعمال‌نشده‌اند.۳۱۱ واحد/۲۰ contract/۱۰ wire و۱۴ QA محدودِ شکست موفق‌اند؛ SQL۷۸ و مثبت MFA/بازیابی backup هنوز اجرا نشده‌اند. [MFA-RECOVERY.md](MFA-RECOVERY.md) مرجع جزئیات و محدودیت‌هاست.

## کارکنان و دسترسی (سورس تازه، اصلی منتشر نشده)

GET `/api/admin/staff-role-catalog` نقش/نام FA/EN/permission، GET `staff` صفحهٔ۵۰ با query/active/role/cursor، GET `staff/{id}` جزئیات نسخه‌دار و GET `staff/{id}/history` صفحهٔ۵۰ رویداد با Id رشته‌ای می‌دهند. staff.read/write به نقش Administrator و access کامل نیاز دارند؛ mfa_pending یا ادعای permission بدون آن نقش کافی نیست. DTO هیچ SecurityStamp/PasswordHash/شماره تماس/فیلد ایمیل/token/کلید ندارد؛ نام کاربری می‌تواند ایمیل باشد. version همان ConcurrencyStamp است.

POST `staff-candidate` با identifier دقیق در body، metadata/flag تماس تأییدشده و hasPassword می‌دهد. POST `staff` با accountId/roles/version فقط حساب موجودِ فعال با تماس تأییدشده، رمز و بدون نقش کارکنان/بازیابی ناتمام را می‌پذیرد. PUT `staff/{id}` با roles/isActive/version صریح نقش‌ها و فعالیت کل حساب را تغییر می‌دهد. خود کاربر هدف actor نمی‌تواند باشد، حتی با تفاوت حروف شناسه. role خالی/ناشناخته/تکراری یا isActive حذف‌شده پیش از SQL/audit رد می‌شود. دعوت/ساخت حساب و تنظیم رمز توسط خود کاربر به provider واقعی وابسته‌اند؛ این مسیرها credential یا تأیید تماس نمی‌سازند.

قفل Administrator و actor/target، بررسی دوبارهٔ stamp/نسخه/صلاحیت و audit اتمیک، نقش/فعالیت، stamp و ابطال نشست را هماهنگ می‌کند. deltaهای نقش/فعالیت/نشست با target و trace در audit موجود ثبت می‌شوند؛ schema تازه لازم نیست.۳۳۵ واحد/۲۶ contract/۱۴ wire و۲۴ QA محدود موفق؛ SQL۸۴ و تغییر واقعی/رقابت/MFA/rollback هنوز پذیرفته نشده‌اند. [STAFF-ADMINISTRATION.md](STAFF-ADMINISTRATION.md) مرجع قرارداد، حریم داده و مرز پذیرش است.

## دفتر نشانی مشتری (سورس، منتشرنشده روی اصلی)

GET `/api/addresses` فقط حساب access جاری را با capacity=20 می‌خواند؛ query و owner ورودی ممنوع. PUT `/{id}` با UUID غیرصفر، label/contactName/contactPhone/delivery ایران، makeDefault صریح و version=null برای ساخت/نسخهٔ جاری برای ویرایش است؛۲۰۱ یا۲۰۰/replayed می‌دهد. DELETE همان resource با body نسخهٔ فعلی۲۰۴؛ مفقود/حساب دیگر۴۰۴ و نسخه/تکرار متفاوت۴۰۹ است. Origin برای تغییر الزامی و دقیق است؛ همهٔ پاسخ‌ها no-store و limiter۶۰ در دقیقه دارند.

payload خصوصی در Sales با Data Protection وابسته به حساب+شناسه حفاظت می‌شود. پیش‌فرض/ظرفیت/نسخه و marker حساب زیر transaction Serializable هماهنگ‌اند. GET خراب هرگز دفتر خالی نمی‌شود. رابط و BFF جدا در `/fa/addresses` و `/en/addresses`، انتخاب‌گر کپی صریح در سفارش فیزیکی، no-store/noindex و گیت PWA اضافه شدند؛ تماس ورود و snapshot قدیمی سفارش تغییر نمی‌کند.۳۵۳ واحد/۱۱۶ فروشگاه/۲ wire/۱۹ UI محدود/۱۲ HTTP مستقل موفق؛ هفت SQL تازه فقط compile و کل۹۱ با۳۲ اجرا‌نشده است. migration۲۰ فقط source؛ main۱۷ و۱۸/۱۹/۲۰ لازم‌اند. [ADDRESS-BOOK.md](ADDRESS-BOOK.md) مرجع دقیق تضمین replay، حفاظت داده، key ring و مرز پذیرش است.

## فهرست شرایط خرید پنل (سورس، منتشرنشده روی اصلی)

GET `/api/admin/purchase-methods-page` با query/enabled/kind/categoryId/cursor و GET `/api/admin/cheque-plans-page` بدون kind، پنجاه خلاصه و nextCursor صریح null می‌دهند؛ query ناشناخته/تکراری و cursor ناسازگار قبل از reader رد می‌شود. فیلتر دسته شامل شرایط بدون محدودیت هم هست. GET `purchase-methods/{id}` یا `cheque-plans/{id}` جزئیات نسخه‌دار با مبالغ رشته/null و حداکثر۵۰۰ دسته می‌دهد؛ بیش از حد۵۰۳ و تغییر میان header/rules۴۰۹ است. GET `purchase-summary` چهار شمارندهٔ رشته‌ای دارد و snapshot مشترک countها تضمین نمی‌شود. تمام GETها finance.read کامل می‌خواهند و no-store هستند.

هر ویرایش سرویس‌های روش/طرح parent را صریحاً modified می‌کند تا دسته‌تنها هم rowversion را عوض کند؛ فرمان‌ها همچنان finance.write و audit اتمیک قبلی دارند. native/public/assignment قدیمی تغییر قرارداد ندارند. پنل صفحه/فرم/دستهٔ غایب/unknown/conflict و read-only دارد؛ ساخت تنظیمات idempotency دائمی ندارد.۳۷۲ واحد/۳۱ contract/پنج wire/۳۰ UI محدود موفق؛ پنج SQL تازه فقط compile و کل۹۶ با۳۷ اجرا‌نشده است. schema تازه لازم نیست؛ main۱۷/source۲۰ حفظ است. [FINANCE-PAGING.md](FINANCE-PAGING.md) مرجع تضمین نسخه، محدودیت و پذیرش است.

## نسخهٔ graph مدیریت کاتالوگ (سورس)

GET جزئیات `/api/admin/products/{id}` و graphهای مدیریت `/api/admin/catalog` با/بدون metadataOnly پس از خواندن split، نسخهٔ محصول/تنوع یا دسته/تعریف ویژگی را دوباره بررسی می‌کنند. تغییر/حذف میان queryها version_conflict/409 می‌دهد؛ مجوز، no-store و DTO قبلی حفظ‌اند. query تأیید فقط Id/Version و در batchهای۵۰۰ است و truncation یا snapshot سراسری نیست. هر فرمان ویرایش Catalog parent/variant صریح را modified می‌کند تا در زمان برابر هم SQL rowversion بچرخد؛ TimeProvider موجود منبع زمان فرمان است.

۳۸۲ واحد بدون SQL موفق، هفت SQL تازه فقط compile و کل۱۰۳ با۴۴ اجرا‌نشده است. schema تازه لازم نیست؛ source۲۰/main۱۷ و D19 حفظ‌اند. خواندن عمومی/Cart/Checkout در این برش تغییر نکردند. [CATALOG-VERSIONS.md](CATALOG-VERSIONS.md) مرجع تضمین‌ها، وابستگی به writer نسخه‌دار و پذیرش باقی است.


## خواندن عمومی کاتالوگ و reader خرید (سورس)

GET storefront با/بدون metadataOnly و POST search/lookup با کنترل نسخهٔ رکوردهای خوانده‌شده و حداکثر دو تلاش read-only محافظت می‌شوند؛ ناپایداری مداوم catalog_unavailable/503، no-store قبلی و بدون fallback نمونه است. Search نسخهٔ winner را به hydration و Lookup نسخهٔ انتخاب اولیه را به تطبیق نهایی ID/slug/تنوع فعال وصل می‌کند. DTO/ریال رشته‌ای و endpoint/مجوز تغییر نکرده‌اند؛ مدیریت همچنان409 است. Filters/FacetValues در این برش تغییر نکردند.

قرارداد داخلی CheckoutCatalog یک projection قیمت/جزئیات/نسخه و تأیید نسخه پس از روابط دارد؛ Cart از قبل تک-query و quote/order از قبل Serializable مشترک بودند. این حفاظت snapshot سراسری شمارش/صفحه/موجودی یا رزرو نیست.۳۹۹ واحد بدون SQL موفق،۹ SQL تازه فقط compile/discovery و کل۱۱۲ با۵۳ اجرا‌نشده؛ source۲۰/main۱۷ و D19 حفظ‌اند. [PUBLIC-CATALOG-READS.md](PUBLIC-CATALOG-READS.md) مرجع حدود تضمین و پذیرش باقی است.


## نسخهٔ فیلترهای پویا و نگه‌داری جست‌وجو (سورس)

GET filters و POST facet-values پس از خواندن مقادیر/گزینه‌ها، نسخهٔ تعریف‌های استفاده‌شده و دسته‌های scope را کنترل می‌کنند؛ بودجهٔ کل read دو تلاش و ناپایداری ادامه‌دار catalog_unavailable/503 است. حذف پایدار rule همان unknown_catalog_filter/400 را حفظ می‌کند. نوع/واحد/ترجمه و selected بیرون صفحه محافظت می‌شوند؛ count/page/قیمت/موجودی snapshot مشترک ندارند. DTO/no-store/پول رشته‌ای و مجوز تغییر نکرده‌اند. RepairSearchFieldsAsync قبل از Clear، لغو یا transaction موجود EF/ambient را رد می‌کند؛ pending write قبلاً رد می‌شد و batch۲۵۰/RepeatableRead و فرمان بدون retry حفظ‌اند.

۴۰۷ واحد بدون SQL موفق؛ هشت SQL تازه فقط compile/discovery و کل۱۲۰ با۶۱ اجرا‌نشده است. source۲۰/main۱۷ و D19 حفظ‌اند. [CATALOG-FACETS.md](CATALOG-FACETS.md) مرجع تضمین‌ها، مرز maintenance و پذیرش باقی است.


## سریال و IMEI انبار و پنل

GET `/api/admin/inventory/variants/{id}/serials` با state/query/cursor صفحه۵۰+Stock و GET `.../serials/{unitId}/history?before=...` تاریخچه۵۰ با Id رشته‌ای دارند؛ inventory.read کامل/MFA لازم است. PUT `.../{id}/serial-mode`، POST `.../{id}/serials` و POST `.../{id}/serials/{unitId}/retire` inventory.write و audit اتمیک می‌خواهند. mode/version/requestId، receipt units/reason/version/requestId و retire unitVersion/reason/version/requestId صریح‌اند؛ حداکثر۱۰۰ واحد و snapshot پایدار actor/request، no-store و nullهای لازم حفظ‌اند. IMEI دوم alias همان یک دستگاه است؛ سریال در تنوع و IMEI سراسری یکتاست. موجودی عددی و digital نمی‌توانند tracking فعال را دور بزنند.

قرارداد داخلی IStockSerialAssignments فقط از رزرو Allocated سفارش معتبر، تا تعداد line، تخصیص می‌دهد. fulfill همهٔ سریال‌ها را لازم دارد و release/fulfill، واحد و ledger را با رزرو عوض می‌کنند؛ endpoint fake payment/paid/fulfillment اضافه نشده است. مرجع OrderId/VariantId و WarrantyUntil nullable/صریح است. پنل mode/دریافت/خروج/فهرست/history با strict schema، نقش read-only و retry همان تلاش در نتیجهٔ نامشخص اضافه شده است؛ Sales/ارسال معتبر، تبدیل ماندهٔ قدیمی/چندانباری و مالکیت دستگاه حساب هنوز ناتمام‌اند.

۴۳۰ واحد no-SQL موفق؛۹ SQL تازه فقط compile/discovery و کل۱۲۹ با۷۰ اجرا‌نشده است. migration۲۱/SQL idempotent فقط سورس و main۱۷،۱۸–۲۱ معوق‌اند؛ D19 حفظ است. [INVENTORY-SERIALS.md](INVENTORY-SERIALS.md) مرجع قرارداد، پیش‌نیازها و پذیرش باقی است.

## پذیرش SQL پس از رفع توقف D19

D20 پایان آزادسازی را تأیید کرد. مجموعهٔ جاری **۱۲۹/۱۲۹ SQL واقعی** موفق است؛ اعداد compile-only بخش‌های تاریخی بالاتر مربوط به زمان همان برش‌اند. staff/finance search اعراب پایه را صریحاً حذف می‌کنند و REPLACE روی BIN2 و contains روی CI_AI است؛ سیاست انتشار Published تضعیف نشده است.۴۳۱ واحد،۵۲ تست پنل،۳ wire سریال و۱۸ UI نمونه موفق؛۱۷ بررسی محدود محصول/سریال در مرورگر SQL و FA/EN نیز موفق است، سایر گردش‌های متصل جدا باقی‌اند. main۱۷/source۲۱؛ migrationهای۱۸–۲۱ اصلی و provider/ارسال واقعی هنوز باقی‌اند. [STATUS](STATUS.md) و [INVENTORY-SERIALS](INVENTORY-SERIALS.md) مرجع جاری‌اند.

پذیرش مرورگر بعدی:۴۷ بررسی واقعی دفتر نشانی/quote3/سفارش فیزیکی و دیجیتال/فهرست FA/EN/لغو مشتری و مدیر/آزادسازی رزرو و۷ بررسی CMS draft/picker موفق‌اند. قرارداد API در این ادامه تغییر نکرد. مقادیر هزینه و رزرو فقط طبق D21 در QA ذخیره شدند؛ canPay=false و gateway_unconfigured حفظ است. انتشار/rollback CMS، mobile مشتری، قطع پاسخ و worker این run پذیرفته نشده‌اند. [CUSTOMER-OPERATIONS-QA](CUSTOMER-OPERATIONS-QA.md) شواهد و interruption/cleanup باقی را ثبت می‌کند.

پنل پیش از ارسال درخواست با access نزدیک انقضا/منقضی، یک refresh مشترک انجام می‌دهد؛ deadline مطلق از expiresIn است. این preflight، mutation ارسال‌شده یا401 را retry نمی‌کند. grant موقت MFA و refresh در حلقه قرار نمی‌گیرند؛ logout/ورود تازه پاسخ دیرهنگام را بی‌اثر می‌کند.۸ تست deterministic شامل وقفهٔ ساعت/همزمانی/لغو موفق‌اند؛ تکرار وقفهٔ واقعی بلند مرورگر هنوز پذیرفته نشده است.

## PROMO-01 و اجرای اصلی۲۱

CMS kind=spotlight با عنوان و انتخاب صریح۱–۲۴ کالا برای enabled=true افزوده شد؛ زمان/ترتیب/متن و نسخهٔ publish/rollback همان قرارداد قبلی‌اند. مسیر عمومی تازهٔ API لازم نشد: خانه و /[locale]/moments از metadataOnly و /api/catalog/{locale}/lookup محدود استفاده می‌کنند. قیمت/شرایط/Stock از Catalog و ریال رشته‌ای است؛ references پنهان جزئیات عمومی نمی‌گیرند. [MOMENTS](MOMENTS.md) حدود را شرح می‌دهد.

اصلی پس از بکاپ خصوصی تأییدشده به۲۱ migration ارتقا یافت و API5080/پنل3173/Next3000 به سورس جاری برگشتند. D27 نمونهٔ مشخص دو زبان در SQL دارد؛ seed-moments-dev فقط Development، حفظ draft و transaction دو زبان/بی‌تکراری دارد. چهار SQL مرتبط،۱۲۰ فروشگاه/۴۳۵ بک‌اند و۲۸ smoke HTTP موفق‌اند؛ baseline قبلی۱۲۹ SQL و۷ CMS مرورگر+۱۴ D22 محفوظ‌اند. مجموعهٔ تازه۱۳۱تایی کامل دوباره اجرا نشده، visual/mobile و providerها همچنان بازند. STATUS مرجع جاری است؛ main۱۷/اجازهٔ CMS معلق در بخش‌های بالا تاریخی‌اند.

## MARKET-02: مدل و انتشار مستقل بازار (API/SQL)

اصلی/سورس۲۳ و هشت schema، مدل مشترک Catalog بدون SKU در Draft و Market.Listings با انتشار صریح/source/زمان/قیمت مرجع/IsDemo اضافه شدند. API عمومی POST /api/market/{locale}/search و GET /api/market/{locale}/{id} و CRUD مدیریت مدل/منبع مجوزدار در [MARKET-CATALOG](MARKET-CATALOG.md) شرح داده شده‌اند. هیچ variant، Stock یا شرایط قابل پرداخت برای مدل بازار صادر/ساخته نمی‌شود. publish/ویرایش و audit در transaction مشترک‌اند، version و eligibility خواندن دوباره سنجیده می‌شوند؛ Production نمونه را نمی‌پذیرد/نمی‌خواند.

۴۵۱ واحد و کل۱۴۲ SQL موفق؛ یک SQL نمونه/بی‌تکراری بعدی جدا موفق است.۳ نمونهٔ روشن در SQL محلی، بدون تغییر حساب/قیمت SKU/انبار/CMS، و API مستقل تازه همراه۲۸ smoke هسته پذیرفته شدند. UI/CSV/سبد درخواست و quote/accept/convert هنوز باقی‌اند؛ این API-only به معنی اتمام MARKET-02 نیست.

## CSV/پنل بازار — اصلی۲۴

POST /api/admin/market/import/preview فقط خواندنی و فاقد audit موفق است؛ commit با CSV/UUID/expected نسخهٔ listing/model/metadata و receipt پایدار actor-bound اتمیک است. GET receipts/{requestId} برای پیگیری همان حساب، GET template برای CSV UTF-8/BOM، GET models/{id} برای مدل و PUT market/{id}/edit برای ویرایش مشترک نسخه‌دار اضافه شدند. catalog.write/MFA و no-store برقرارند؛ template/مدل catalog.read. [MARKET-CSV](MARKET-CSV.md) قرارداد دقیق را دارد.

۴۶۲ واحد، کل۱۵۲ SQL،۵۷ پنل،۲ proxy و۷ wire واقعی موفق؛ مرورگر SQL/موبایل و قطع پاسخ/unknown/همان UUID retry پذیرفته و QA پاک شد. API5080/پنل3173/SQL۲۴ پذیرفته‌اند؛ Next3000 فعلاً رابط بازار ندارد. این اعداد جای شماره‌های تاریخی بخش‌های بالا را برای وضع جاری می‌گیرند. هلو در D29–D30 افزوده شده و provider زنده هنوز قرارداد ندارد؛ [HOLOO-INTEGRATION](HOLOO-INTEGRATION.md).

## نگاشت هلو در سورس/اصلی۲۵

GET /api/admin/accounting/holoo/status صریحاً provider غیرفعال و دلیل holoo_contract_required را می‌دهد. GET links صفحه۵۰/seek با شرکت دقیق و کد/SKU/فعالیت، GET links/{id}، GET variants?query محدود۲۰ SKU فیزیکی و PUT links/{id} برای نگاشت نسخه‌دار اضافه شدند. catalog.read/write و MFA/audit مشترک برقرارند؛ هویت شرکت/آیتم immutable، id یک UUID بدون خط تیره و version=null ساخت است؛ retry همان ID/body تا تغییر resource بی‌تغییر، اصلاح متفاوت/نسخهٔ قدیمی409. تغییر قیمت/Stock یا API هلو ندارد. [HOLOO-INTEGRATION](HOLOO-INTEGRATION.md) و STATUS مرجع اجرا/حدودند؛ برش نگاشت پس از پذیرش SQL/wire/مرورگر و بکاپpre25 روی API/SQL۲۵ و پنل3173 منتشر شده؛ اتصال زنده همچنان unconfigured است.

## بازار خواندنی در BFF فروشگاه

روی نسخهٔ پذیرفتهٔ بازار، POST /api/market/{fa|en}/search و GET /api/market/{fa|en}/{listingId} از upstream عمومی و DTO مستقل بازار استفاده می‌کنند؛ cookie/bearer مدیریت forward نمی‌شود. body۴KiB، پاسخ۲MiB، deadline۸ثانیه، origin/locale/query strict و no-store/noindex دارند. صفحه‌های /[locale]/market و /[locale]/market/[id] متصل‌اند؛ قیمت مرجع قابل پرداخت نیست. خواندن بازار و ثبت/پیگیری sourcing روی اصلی۲۸ منتشر شده‌اند؛ [MARKET-STOREFRONT](MARKET-STOREFRONT.md)، STATUS و قرارداد زیر مرجع‌اند.

## درخواست تأمین بازار — سورس و اصلی۲۸ پذیرفته‌شده

قرارداد/معماری و شواهد کامل در [MARKET-SOURCING](MARKET-SOURCING.md) است؛ مرجع مسیرها `backend/src/Shop.Api/Endpoints/SourcingEndpoints.cs` است. این برش درخواست غیرقابل‌پرداخت، ثبت/پیگیری/لغو مشتری و بررسی/عدم‌تأمین مدیر را پیاده کرده است. پیشنهاد SKU/قیمت/شرایط، پذیرش مشتری و تبدیل idempotent به خرید هنوز لازم‌اند؛ ثبت درخواست SKU/قیمت فروش/Order/Reservation/Payment نمی‌سازد.

| مسیر | ورودی/خروجی و policy |
|---|---|
| GET `/api/cart/{fa|en}/sourcing` | ناشناس/عضو، همان هویت سبد؛ schema1/locale/version nullable/capacity۲۴/lines/hasIssues و `requestOnly:true,canPay:false`؛ بدون total مالی |
| PUT همان مسیر | `{version,lines:[{listingId,quantity}]}`؛ فقط انتخاب تأمین، rowversion مشترک با خرید |
| POST `/api/cart/{fa|en}/merge` | مسیر قبلی هر دو بخش خرید/تأمین را اتمیک ادغام می‌کند؛ پاسخ خرید فعلی محفوظ، تأمین جدا بازخوانی می‌شود |
| POST `/api/cart/{fa|en}/sourcing/submit` | customer؛ `{requestId,cartVersion,expected:[{listingId,fingerprint}],note?}`؛ نخست201/replay200 و Location به detail بومی |
| GET `/api/sourcing/requests` | customer؛ فقط owner جاری، state/query/cursor، صفحه۲۰ و جدیدترین اول |
| GET `/api/sourcing/requests/{id}` | customer؛ detail تاریخیِ مالک، note، snapshot و flags؛ غایب/مالک دیگر404 یکسان |
| GET `/api/sourcing/requests/{id}/events` | customer؛ cursor، صفحه۲۰، Id صعودی |
| POST `/api/sourcing/requests/{id}/cancel` | customer؛ `{requestId,version}`؛ Submitted/Reviewing→Cancelled |
| GET `/api/sourcing/requests/commands/{submit|cancel}/{commandId}` | customer؛ receipt actor جاری، عملیات مدیر403 |
| GET `/api/admin/sourcing/requests` | sales.read/MFA؛ state/query/cursor، صفحه۵۰ |
| GET `/api/admin/sourcing/requests/{id}` | sales.read/MFA؛ detail خصوصی، ownerId فقط در summary مدیر |
| GET `/api/admin/sourcing/requests/{id}/events` | sales.read/MFA؛ cursor، صفحه۵۰، Id صعودی |
| POST `/api/admin/sourcing/requests/{id}/review` | sales.write/MFA؛ `{requestId,version}`؛ Submitted→Reviewing |
| POST `/api/admin/sourcing/requests/{id}/unavailable` | sales.write/MFA؛ `{requestId,version,reasonCode,publicMessage}`؛ Submitted/Reviewing→Unavailable |
| GET `/api/admin/sourcing/requests/{id}/commands/{review|unavailable}/{commandId}` | sales.write/MFA؛ actor+operation+target مقید به مسیر، عملیات مشتری403 |

ورودی unknown member را رد می‌کند؛ شناسهٔ listing/request غیرصفر N32، UUID فرمان D یا N و نسخه Base64 هشت‌بایتی طول۱۲ است. Origin mutation الزامی/مجاز و Origin ارسال‌شدهٔ GET نیز بررسی می‌شود. state فقط all/Submitted/Reviewing/Unavailable/Cancelled است؛ query۱۲۰کاراکتر/۸واژه، cursor۲۰۰ و مقید به owner/state/query یا owner/target است. mutation/receipt schema1 `{id,reference,state,version,eventId,at,replayed,requestOnly:true,canPay:false}`؛ page/events `{schemaVersion,pageSize,items,nextCursor}` با nextCursor صریحاً null یا رشته‌اند. receipt وضعیت/نسخهٔ زمان فرمان دارد؛ GET detail وضعیت جاری را می‌دهد.

انتخاب تأمین `CartSourcingLines` همان Carts/cookie/قفل/rowversion خرید است؛ guest cookie فقط پس از merge اتمیک هر دو بخش حذف می‌شود و tombstone مانع ادغام دوباره است. صاحب حساب از principal است و body نمی‌تواند owner/cart/token انتخاب کند. ویرایش هر بخش quote خرید قبلی را stale می‌کند؛ مصرف سفارش فقط اقلام خرید و submit فقط اقلام تأمین را مصرف می‌کند. هماهنگی مشتری Serializable در composition root، با Sales/Catalog/Inventory/Market است؛ تغییر مدیر audit را هم اتمیک دارد. دادهٔ تاریخی/receipt در Market و ویژگی تایپ‌دار در جداول رابطه‌ای مستقل از تغییر کاتالوگ ذخیره می‌شوند؛ یادداشت۵۰۰کاراکتری با DataProtection مقید به owner+request حفاظت و فقط در detail مجاز باز می‌شود.

unknown/stale/unavailable منبع مانع استعلام نیستند. مدل دارای عرضهٔ عمومی فعال و `Available>0` از بازار کنار می‌رود؛ انتخاب قبلی now_in_store می‌دهد و خودکار حذف/تبدیل نمی‌شود. قیمت مرجع nullable/مثبت/صحیح ریال است: SQL bigint، JSON رشته، JS BigInt؛ هیچ total قابل پرداخت ندارد. Number ویژگی decimal(28,8) رشته، Bool=false/صفر/null مستقل، eventId و identity داخل مرجع `SR-…` نیز رشته‌اند؛ هیچ مبلغ/شناسهٔ bigint به Number تبدیل نمی‌شود.

receipt پایدار `(ActorId,Operation,RequestId)` با hash بدنه و TargetId است. همان UUID/body پس از مصرف سبد یا تغییر وضعیت نتیجهٔ تاریخی `replayed:true` می‌دهد؛ بدنهٔ متفاوت409. receipt مدیر علاوه بر actor/operation به target مسیر مقید است؛ مدیر دیگر رسید actor قبلی را نمی‌خواند. **404 رسید پایان فرمان در حال اجرا را ثابت نمی‌کند**؛ پاسخ نامعلوم باید همان UUID/body را برای retry دستی حفظ کند و خطای بعدی۴xx ابهام قبلی را پاک نمی‌کند. پس از receipt موفق detail تازه خوانده می‌شود؛ نسخهٔ قدیمی receipt برای ویرایش جاری اعمال نمی‌شود.

حدود:۲۴ انتخاب/تعداد۱–۱٬۰۰۰٬۰۰۰، هر مدل۲۴تصویر/۶۴ویژگی/۶۴گزینه، note/پیام عمومی۵۰۰، body غیرGET حتی chunked۱۶KiB، پاسخ cart۲MiB UTF-8، detail۵۱۲KiB و snapshot پیش از INSERT با۸KiB فضای envelope کمتر. تجاوز خطاست و truncate ندارد. receipt ResultJson۱۶KiB UTF-16/ISJSON؛ سقف فنی درخواست باز پیش‌فرض۲۰ و پیکربندی `Sourcing:MaxOpenRequestsPerOwner` بین۱–۱۰۰۰ است. این سقف سیاست مالی نیست. IsDemo/ContainsDemo خارج Development در همهٔ مسیرهای مرتبط بسته می‌شود.

API بومی no-store است. BFF Next با body۱۶KiB/response۲MiB/deadline۲۰ثانیه، allowlist/schema/UTF-8 سخت‌گیرانه و بدون redirect/fallback، `private, no-store`، `Vary: Cookie, Authorization` و noindex/nofollow دارد. فقط cookie سبد برای مسیر cart و bearer مشتری forward می‌شوند؛ BFF مشتری در فهرست/رویداد فعلاً فقط cursor می‌پذیرد و فیلتر state/query API بومی را عبور نمی‌دهد. worker پاسخ sourcing/cart/account/checkout را cache نمی‌کند. journal فرمان فقط RAM/مقید به حساب است؛ ناوبری حفظ و logout/تغییر حساب پاک می‌کند؛ پس از reload lookup دستی UUID لازم است.

migration۲۶ Catalog/۲۷ Sales/۲۸ Market تولید شده‌اند. view Catalog اکنون به inventory.AvailableStockV1 وابسته است؛ **bootstrap دیتابیس تازه Inventory پیش از Catalog** است. Program/SqlFixture/UiHarness این ترتیب را دارند؛ ترتیب قفل دامنه تغییر نکرده است. سه model check بدون تغییر جامانده و SQL idempotent هر سه context موفق‌اند؛ [گزارش EF](../artifacts/checks/sourcing-ef-summary.json).

پذیرش سورس۲۸: **۵۰۲ واحد،۳۰ SQL هدف و کل۱۹۳ SQL،۷۲ پنل و۱۵۸ فروشگاه**، typecheck/build ایزوله، wire۸+۴ و مرورگر واقعی مشتری/مدیر موفق‌اند. مهمان/ورود/ادغام دو بخش سبد، ثبت/پیگیری/لغو، بررسی/عدم‌امکان مدیر، FA/EN/mobile و قطع دو پاسخ پس از commit با همان UUID و recovery پذیرفته‌اند. ایراد detail قدیمی پس از receipt رفع و در چرخهٔ تازه بدون refresh دستی آزموده شد. QA پاک، بکاپ pre28-release و انتشار اصلی۲۸ انجام و۲۰ smoke اصلی موفق شدند؛ شواهد sourcing-ui-acceptance.json، sourcing-recovery-sql-proof.json، sourcing-main28-state.json و sourcing-main28-public-smoke.json در artifacts/checks هستند. SQL روی MacARM/Rosetta شاهد native Linux/بار تولید نیست و MARKET-02/PDF کامل نشده‌اند.

## Offer/consent — سورس و اصلی محلی۲۹ پذیرفته‌شده

قرارداد مستقل [MARKET-OFFER-CONSENT](MARKET-OFFER-CONSENT.md) و فایل SourcingOfferEndpoints.cs مرجع‌اند. همهٔ DTOهای این فرزند schemaVersion1 خودشان، `consentOnly:true,canPay:false` و قیمت رشتهٔ صحیح ریال دارند. هیچ stock/order/payment از پذیرش ساخته نمی‌شود. parent schema1 و چهار وضعیت آن حفظ شده‌اند؛ parent version در هر تغییر عمومی Offer می‌چرخد، اما event وضعیت والد فقط هنگام Submitted→Reviewing ثبت می‌شود. تاریخچهٔ اختصاصی پیشنهاد، تغییرهای بدون تغییر وضعیت والد را نگه می‌دارد.

| مسیر | policy و اثر |
|---|---|
| GET `/api/sourcing/requests/{id}/offers` | customer مالک، صفحه۲۰/cursor؛ فقط دارای PublishedAt؛ flags دقیق لغو درخواست |
| GET همان مسیر `/{offerId}` | snapshot منتشرشده/شرایط/مهلت و قابلیت accept/decline؛ مالک دیگر یا draft404 |
| GET همان مسیر `/{offerId}/events` | تاریخچهٔ عمومی صفحه۲۰، بدون ActorId |
| POST همان مسیر `/{offerId}/{accept\|decline}` | مالک؛ `{requestId,requestVersion,version,termsHash}`؛ receipt و اثر اتمیک |
| GET همان مسیر `/{offerId}/commands/{accept\|decline}/{commandId}` | actor+operation+request+offer، نتیجهٔ تاریخی replayed؛ بدون تغییر |
| GET `/api/admin/sourcing/requests/{id}/offers` و `/{offerId}` و `/{offerId}/events` | sales.read؛ draft و سابقه نیز قابل خواندن؛ صفحه۵۰ |
| GET `/api/admin/sourcing/requests/{id}/offer-skus?listingId=…&query=…&cursor=…` | sales.read؛ فقط مدل ردیف همین درخواست، صفحه۲۰ |
| GET همان مسیر `/{variantId}?listingId=…` | sales.read؛ snapshot SKU منتخب و دو fingerprint؛ SKU مدل دیگر404 |
| PUT `/api/admin/sourcing/requests/{id}/offers/{offerId}` | finance.write؛ ایجاد/ویرایش draft با شناسهٔ ثابت client، Version=null فقط برای ایجاد؛ بدنه۶۴KiB |
| POST همان مسیر `/{publish\|withdraw}` | finance.write؛ نسخه/TermsHash؛ publish جفت SupersedesOfferId/Version صریح یا null می‌خواهد |
| GET همان مسیر `/commands/{save\|publish\|withdraw}/{commandId}` | finance.write؛ رسید actor و هر دو target، عملیات مشتری403 |

ذخیرهٔ draft علاوه بر UUID/نسخه، Lines حداکثر۶۴ با LineId/ListingId/VariantId/Quantity/UnitPriceRial/MaterialFingerprint/CurrentFingerprint، TermsFa/En حداکثر۴۰۰۰، AcceptUntil/PurchaseUntil صریح UTC و ExpectedAt اختیاری/null می‌گیرد. نگاشت مقدار هر ردیف درخواست باید کامل و مدل SKU همان مدل باشد. مبلغ مرجع یا عمومی خودکار قیمت پیشنهادی نمی‌شود. Material hash از قیمت عمومی مستقل و Current hash شامل نسخه‌ها/قیمت عمومی است؛ publish جاری کامل و accept مشخصات و قواعد خرید جاری را دوباره می‌سنجد.

Draft/Published/Accepted/Declined/Withdrawn/Superseded حالت‌های ذخیره‌شده‌اند؛ Expired فقط حالت مؤثر از ساعت سرور است. Accepted فعال پیش از PurchaseUntil برداشت/جایگزینی و لغو سادهٔ والد را می‌بندد؛ بعد از مهلت history باقی می‌ماند و active pointer در فرمان مجاز بعدی آزاد می‌شود. flags قدیمی والد، وضعیت پایه را بیان می‌کنند؛ رابط تازه باید CanCancelRequest/CanMarkRequestUnavailable فرزند را هم لحاظ کند. پاسخ خصوصی no-store، detail۵۱۲KiB، سایر mutationها۱۶KiB، cursor۲۰۰ است. مشتری از transaction Serializable ریشه با Catalog/Inventory/Market/Payments/Credit و Sales استفاده می‌کند؛ فرمان مالی مدیریت audit همان transaction را دارد.

migration `20261023214832_SourcingOffers` فقط۹ جدول Market افزود و پس از بکاپ تازه روی اصلی محلی اعمال شد.۵۳۸ واحد/۲۱۵ SQL واقعی،۹۸ پنل/۱۸۶ فروشگاه،۱۲ wire، مرورگر و۳۴ smoke اصلی موفق‌اند؛ offer-main29-release.json و STATUS شواهد و حدود را ثبت می‌کنند. journal واحد تا احراز دوباره در خطای موقت حفظ و پنهان می‌ماند؛ refresh401 تأییدشده/خروج/حساب دیگر آن را پاک می‌کنند. این پذیرش، دریافت/تخصیص/خرید یا پایان MARKET-02 نیست.


## سورس۳۳ تخصیص؛ هنوز روی API اصلی۳۱ منتشر نشده

[MARKET-ALLOCATION-CONVERSION](MARKET-ALLOCATION-CONVERSION.md) قرارداد داخلی و ادامهٔ ناتمام را شرح می‌دهد. بک‌اند، wire، SerialV2 و فرم/journal تخصیص در SQL و مرورگر دسکتاپ پذیرفته‌اند؛ `serial-allocation-acceptance.json` شاهد جاری است. موبایل واقعی، [Cart2/convert](MARKET-CART2-SLICE.md)، Quote4/Order2، restore۳۳ و انتشار باقی‌اند. runtime-current اصلی۳۱ است و مسیرهای زیر فعلاً متعلق به candidate مستقل سورس۳۳ هستند.

- موجودی خواندنی: `GET /api/admin/inventory/v2/variants` و `/{id}`، صفحه version2 و فیلد مستقل sourcingReserved؛ available برابر onHand−reserved−sourcingReserved. خواندن V1 در حضور سهم تأمین، `inventory_contract_upgrade_required` با409 می‌دهد.
- سریال خواندنی: `GET /api/admin/inventory/variants/{id}/serials/v2` با inventory.read؛ wrapper با schemaVersion2، صفحه۵۰تایی، Stock شامل reserved و sourcingReserved مستقل و هر ردیف `{unit,hasActiveClaim}`. فیلتر available واحد دارای claim فعال را، حتی پس از deadline و پیش از آزادسازی، حذف می‌کند. cursor حداکثر۵۱۲نویسه به SKU/فیلتر/Stock.Version مقید است؛ cursor قدیمی یا نسخهٔ کهنه پذیرفته نمی‌شود. صفحه snapshot تاریخی چندصفحه‌ای نیست. reader نسخه۱ در حضور سهم/claim فعال با `serial_contract_upgrade_required` و409 بسته می‌شود؛ mutation و receipt/history قدیمی همان قرارداد قبلی را حفظ می‌کنند.
- پیگیری Supply2: مشتری/فروش `GET /api/[admin/]sourcing/requests/{id}/supply/v2` و `/v2/{taskId}`؛ انبار `GET /api/admin/inventory/sourcing-tasks/v2` و `/v2/{taskId}`. تخصیص و مهلت/انقضای مؤثر در summary، بدون owner/unit identifier/قیمت/اطلاعات تأمین‌کننده در projection مشتری/انبار است. checkout/pay همچنان false؛ Supply1 در حضور تخصیص active (حتی منقضی و هنوز آزادنشده) upgrade409 می‌دهد.
- candidate بدون قیمت/هویت مشتری برای انبار: `GET /api/admin/inventory/sourcing-tasks/{taskId}/allocation`؛ شامل نسخه‌های فعلی/termsHash، خطوط دقیق و Stock/tracking mode است. مهلت نگهداری پیش‌فرض تولید نمی‌کند.
- فرمان کامل تخصیص: `PUT /api/admin/inventory/sourcing-requests/{id}/tasks/{taskId}/allocations/{allocationId}` با inventory.write؛ همهٔ خطوط پذیرش، نسخه‌های request/task/offer/Stock/unit، AcceptanceId/TermsHash، expiresAt مطلق UTC و دلیل صریح. مرورگر قیمت/مالک/مقدار جایگزین نمی‌فرستد. فقط همین route دقیق canonical تا۶۴KiB؛ release و مسیرهای mixed-case معمول۱۶KiB هستند.
- آزادسازی: `POST` همان مسیر با `/release`، شامل UUID فرمان، AcceptanceId، نسخه و دلیل. replay تاریخی قبل از authority زنده؛ فرمان تازه در برابر مصرف Sales و انتقال Inventory محافظت می‌شود. release مستقل Agreement را revoke نمی‌کند؛ بستن پیگیری، revoke/release اتمیک جدا دارد.
- خواندن انبار: `GET /api/admin/inventory/sourcing-allocations/{allocationId}`، `/events` و `/commands/{allocate|release}/{commandId}`. receipt به actor مقید است؛ این دسترسی، مجوز خواندن قیمت خصوصی Sales نیست.
- Agreement خصوصی: `GET /api/[admin/]sourcing/requests/{id}/agreements/{agreementId}`؛ مشتری فقط مالک و کارکنان sales.read. تمام مبلغ‌ها decimal string صحیح ریال، snapshot همان پذیرش و canPay=false هستند.

همهٔ این پاسخ‌ها private/no-store هستند. expiry worker فقط Inventory و batch کوتاه۱۰۰تایی را اجرا می‌کند؛ در QA با `Inventory:AllocationExpiryEnabled=false` خاموش است. SQL نهایی۳۲۶ مورد موفق دارد؛ دو مورد تازه ارتقای۳۱ دارای reservation/serial و رد downgrade دارای سهم فعال را فقط در GUID QA بررسی می‌کنند. سفارش تاریخی پُر، دریافت مرحلهٔ۲ پُر و restore۳۳ از این تست‌ها نتیجه نمی‌شوند. جزئیات نتیجه و artifactها در STATUS ثبت‌اند.


## Cart2 / accepted-offer conversion — locally released34

These routes are accepted on localmain34. Exact technical contract: [MARKET-CART2-SLICE](MARKET-CART2-SLICE.md). GET/PUT `/api/cart/{locale}/v2`, POST `/api/cart/{locale}/v2/merge`, DELETE `/api/cart/{locale}/v2/offers/{agreementId}` with strict `{requestId,version}`, and GET its `/commands/remove/{commandId}`. Candidate GET `/api/sourcing/requests/{id}/offers/{offerId}/purchase`, conversion POST the same offer's `/convert`, receipt GET its `/commands/convert/{commandId}`. Strict conversion input is `Shop.SharedKernel/SourcingCart.cs`; all prices/quantities/owner remain server-authoritative. Cart2 returns three independent lanes and keeps accepted unit prices out of the public price registry. An accepted-offer cart cannot use Quote3/Order1. Conversion and removal receipts are historical; reading/replaying them does not restore deleted lines or extend stock/price deadlines. No Quote4/Order2/stock transfer/payment activation is included in that release.

## Quote4 — locally released35, SQL/wire/browser accepted

`POST /api/cart/{fa|en}/v2/quote` requires a complete customer session, same-origin mutation and the root checkout transaction. The strict body is `{cartVersion,methodId?,planId?,requestId?}`; the current owner cart must contain at least one accepted line. An unselected-method preview has `quoteId:null` and a bounded `expiresAt` without persistence. A selected method requires a nonzero UUID and stores one immutable snapshot per actor/command. Historical replay preserves its original deadline and adds `quote_expired` when due; cross-contract UUID reuse fails before deserialization.

Response `schemaVersion:4` retains existing amount/configuration fields with `lines:QuoteLineV4Data[]` and `canPay:false`. Each line has independent `lineId`, `lineKind:ordinary|acceptedOffer`, existing SKU/product/quantity/amount/description fields, and explicit `priceVersion:null` for accepted lines. `accepted:null` is explicit for ordinary lines; accepted provenance contains `conversionId,agreementId,agreementLineId,requestId,taskId,offerId,acceptanceId,allocationId,offerLineId,termsHash,agreementVersion,allocationVersion,purchaseUntil,allocationExpiresAt`. Duplicate SKU IDs across independent lines are valid. All money remains integer-rial decimal strings. Inquiry lines are excluded. Both `canPlaceOrder` and `temporaryOrder.canCreate` remain false with `accepted_offer_order_unavailable`; Cart2 checkout fencing and ordinary-only Quote3 stay in place.

Price-free `IInventoryCheckoutOffers` batches all original owned allocations before sorted Stock checks, preserving ordinary capacity independently of sourcing holds. No Market context, new reservation, stock transfer, agreement consumption or payment is involved. Source35 adds nullable header ContractVersion and CheckoutQuoteLinesV4; historical keys/JSON remain unchanged and downgrade refuses retained V4 history. [MARKET-QUOTE4-SLICE](MARKET-QUOTE4-SLICE.md) and [STATUS](STATUS.md) record exact acceptance and limitations. Main API5080 and storefront3000 now run accepted local35; admin3173 is unchanged. `quote35-main-release.json` records preserved105oldtables, four historical quotes with NULL markers, one new empty V4 table, fresh verified backup,92 GET smokes and post-startup SQL preservation. Frozen `quote4-acceptance.json` and candidate descriptors intentionally retain their pre-promotion main34/false snapshot. That is the historical release35 snapshot. The following accepted release38 adds Order2; payment remains unavailable.

## Quote5 و Order2 — پذیرفته و منتشر در اصلی/سورس۳۸

در انتشار تاریخی۳۸، API/SQL، فروشگاه3000 و پنل3173 پذیرفته شدند.۷۸۳واحد/۴۶۴SQL/۲۹۲فروشگاه/۱۸۰پنل، wire خامSQL و مرورگر، بازیابی همان سفارش پس از قطع201/200 و401/refresh503، لغو/انقضای واقعی، restore۳۸ با کلید/MFA تولیدی و انتشار افزایشی با حفظ داده‌ها و۱۱۱GET پذیرفته‌اند. `artifacts/checks/order38-main-release.json` و [STATUS](STATUS.md) مرجع جاری‌اند؛ اسناد candidate پیش از انتشار تاریخی می‌مانند. اصلی صفرSettings/Policy و providerخاموش دارد؛ endpointها مجوز تنظیم مالی فرضی یا پرداخت واقعی نمی‌دهند. D32 Redis چتParseh را عمداً روشن نگه می‌دارد.

| مسیر | ورودی/خروجی و policy |
|---|---|
| POST `/api/cart/{locale}/v2/order-quote` | customer؛ locale فقط fa/en؛ strict `{cartVersion,methodId,planId,requestId}`؛ بدون method preview با quoteId=null، با method/UUID ذخیرهٔ Quote5؛ حداقل یک acceptedOffer |
| POST `/api/orders/v2` | customer؛ strict `{quoteId,requestId,contactName,contactPhone,delivery,note,acknowledgeTemporary:true}`؛ delivery نیز strict؛ نخست201/replay200 و Location نسخه۲ |
| GET `/api/orders/v2` | customer؛ صفحه۲۰ owner جاری، cursor حداکثر۲۰۰، جدیدترین ابتدا؛ schemaVersion2 |
| GET `/api/orders/v2/{id}` | customer؛ detail owner جاری، schemaVersion2 و originalSnapshotVersion1/2 |
| POST `/api/orders/v2/{id}/cancel` | customer؛ strict `{version}`؛ فقط لغو سفارش پرداخت‌نشده، idempotent برای terminal همان سفارش |
| GET `/api/admin/orders/v2` | sales.read/MFA؛ summary دارای ownerId و originalSnapshotVersion، بدون اطلاعات تماس/نشانی |
| GET `/api/admin/orders/v2/{ownerId}/{id}` | sales.write/MFA؛ detail خصوصی نسخه۲ |
| POST `/api/admin/orders/v2/{id}/cancel` | sales.write/MFA؛ strict `{ownerId,version}`، transaction/audit مدیریت |
| GET `/api/sourcing/requests/{id}/orders` | customer؛ projection تاریخی owner/request، صفحه۲۰، cursor حداکثر۵۱۲؛ بدون مبلغ/وضعیت پرداخت/capability |

Quote5، DTO/decoder و marker۵ مستقل دارد؛ Quote4 در `/v2/quote` همواره calculator و غیرقابل‌سفارش است. `canPlaceOrder:false,canPay:false` در Quote5 نیز دائمی‌اند؛ فقط `temporaryOrder.canCreate` برای روش online مجاز، هزینه/مبلغ و تنظیم صریح معتبر، اجازهٔ ساخت سفارش پرداخت‌نشده می‌دهد. تنظیم خاموش اصلی و providerهای نامشخص دور زده نمی‌شوند. خط‌های یک SKU با LineId و قیمت مستقل مجازند؛ inquiry از مبلغ و مصرف خرید خارج است.

خط Quote5 دارای `lineId,lineKind,priceVersion,accepted` و فیلدهای مالی/کالای نسخه۴ است. priceVersion و accepted صریحاً null یا مقدارند. accepted شامل provenance نسخه۴ به‌علاوهٔ `revision,snapshotHash,termsFa,termsEn,materialFingerprint,containsDemo` است؛ متن/نام/گارانتی/قیمت توافقی immutable و eligibility جاری کاتالوگ مستقل بررسی می‌شوند. ذخیره/replay همان actor/UUID/body به مهلت قبلی مقید است؛ expiry یا ازبین‌رفتن authority، canCreate را false می‌کند. marker قرارداد قبل از deserialize سنجیده می‌شود؛ Quote4 یا UUID قرارداد دیگر مجوز تازه نمی‌گیرد. اعتبارسنجی سفارش زمان‌های اولیه را حفظ و fingerprint شرایط/تنظیم جاری را دوباره مقایسه می‌کند.

Order detail2، `originalSnapshotVersion:1|2` را هم در detail و هم summary می‌دهد. سابقهٔ قدیمی null-marker بدون بازنویسی key/JSON/مبلغ/مهلت، با خطوط ordinary و LineId نمایشی پایدار خوانده می‌شود؛ categoryId ناموجود و priceVersion نامعلوم در projection null هستند. خط تازهٔ OrderLinesV2 کلید `(OrderId,LineId)` و شرایط کامل پذیرفته‌شده دارد. reader قدیمی در marker۲ upgrade می‌دهد و سفارش خالی نمایش نمی‌دهد. replay سفارش موجود پیش از بررسی cart/quote تازه است؛ payload متفاوت conflict می‌دهد و deadline/انتقال تکرار نمی‌شود.

ساخت Order2 در Serializable مشترک root، پس از cart exclusive و Agreementهای مرتب، از `IStockOrderReservationsV2` استفاده می‌کند. Inventory قیمت نمی‌گیرد؛ entitlement خطی و ReservationItems تجمیعی، انتقال `SourcingReserved→Reserved` و claim دقیق `AllocationHeld→OrderHeld` را اتمیک ثبت می‌کند. Agreement مصرف، خطوط خرید cart حذف و inquiry حفظ می‌شود؛ snapshot/outbox در همان transaction‌اند. مهلت سفارش کمینهٔ quote/خرید/تخصیص/مدت تنظیم‌شده و پس از انتظار و مرزهای ذخیره دوباره کنترل می‌شود. لغو/انقضا فقط رزرو همان سفارش را آزاد می‌کنند؛ Agreement مصرف‌شده و allocation منتقل‌شده احیا نمی‌شوند. خدمات داخلی Allocate/serial/Fulfill، به‌معنی تکمیل گردش بیرونی پرداخت/ارسال/refund نیستند.

خواندن هدفمند header/history فرمان Order1/2 زیر application lock مشترک `order-owner`، خواندن header و سه child مجموعهٔ cart زیر قفل هویت آن، و هویت replay/graph immutable رزرو Inventory زیر قفل request/order/reservation یا تخصیص مربوط، `READCOMMITTEDLOCK` دارند. برای cart خواندن Shared، mutation Exclusive و merge دو هویت مرتب است؛ header غایب child query ندارد. این تغییر پس از مشاهدهٔ دو چرخهٔ واقعی Orders-range↔Stock و CartOfferLines-range↔Stock، range میان ownerهای نامرتبط را هدف می‌گیرد. parent Serializable، Catalog/config/Agreement، indexهای یکتا و قفل‌های نوشتن Stock/unit/claim باقی‌اند؛ قفل سراسری ایجاد یا retry خودکار افزوده نشده و موفقیت SQL اصلاحات هنوز نیازمند نتیجهٔ نهایی است.

projection درخواست→سفارش پس از commit از outbox و در transaction مستقل Market ساخته می‌شود؛ EventId/hash و AgreementId از تکثیر جلوگیری می‌کنند. تأخیر یا lost acknowledgement فقط replay تاریخی می‌سازد. پاسخ لینک strict `{schemaVersion:1,requestId,items:[{orderId,taskId,offerId,acceptanceId,createdAt}],nextCursor}` است؛ nextCursor پایان صریحاً null و یک order برای پذیرش‌های متفاوت قابل تکرار است. مبلغ و وضعیت معتبر از detail سفارش خوانده می‌شوند.

BFFهای جدید method/path/origin/input و پاسخ را strict بررسی می‌کنند؛ private no-store/noindex، منع PWA cache و حذف cookie غیرضروری برقرارند. سقف ورودی BFF۱۶KiB، پاسخ Quote5۵۱۲KiB و سفارش۱MiB است؛ مقدار مالی JSON decimal string ریال و JS BigInt باقی است. Quote5/Order2 journal فقط در RAM همان owner است؛ قطع پاسخ/abort/refresh ناموفق UUID/body اصلی را نگه می‌دارد، مالک متفاوت/logout پاک می‌کند و دادهٔ خصوصی تا احراز مجدد پنهان است. پنل query key نسخه‌دار و viewer-bound دارد و پاسخ دیررس پس از تغییر مجوز/cache-clear را قبول نمی‌کند.

سه migration سورس `20261024073909_OrderReservationsV2`، `20261024074017_AcceptedOfferOrdersV2` و `20261024074132_SourcingOrderLinks` افزایشی‌اند؛ markerهای قدیمی nullable باقی می‌مانند و Down دارای تاریخچه پیش از DDL با51000 بسته می‌شود. SQL guardها/رقابت‌ها پذیرفته است؛ restore۳۸، مرورگر متصل دو زبان/موبایل، پاک‌سازی QA و backup/ارتقای اصلی هنوز شرط انتشارند. پذیرش۱۷پاسخ خام با `scripts/verification/verify-order2-wire.mts` فقط wire پاسخ است؛ درخواست مرورگر یا اثر Stock/transaction از آن نتیجه نمی‌شود.


## هلو staging در اصلی۳۹ پذیرفته

GET `/api/admin/accounting/holoo/imports` (companyKey/cursor،۲۰تایی) و GET `/{id}` باcatalog.read؛ PUT `/{id}` باcatalog.write/MFA/auditریشه. قالب ورودی v1 شرکت/انبار/معنایquantity/IRRیاIRTیاunknown/observedAtUTC/isDemo و۱–۲۰۰rawrow است. شناسهUUIDثابت وhashpayload replay200 باreplayedtrue،payloadمتفاوت409؛ قیمت/quantityخالینامعلوممی‌ماند،moneystringریال. DetailنگاشتجاریSKU/اختلاف وissues را نشانمی‌دهد؛ canApply/canSyncLive=false. DemoفقطDevelopment وProductiondetail/pageپنهان. دو جدولimmutableCatalog و migration۳۹،Downguard51000 باhistory. formatCSVقالبسایمان است؛ قراردادvendor/nativeهلو نیست. API/SQL/admin۳۹ وNextartifact۳۸بدونتغییر محلیپذیرفته‌اند؛ STATUS وHOLOO-INTEGRATION شواهد/حدود را ثبت می‌کنند.

### Reviews v1؛ از انتشار۴۰ محلی فعال

`GET /api/reviews/products/{productId}?cursor=<decimalString>` عمومی فقطApproved روی کالایPublished؛۲۰تایی وratingCounts[1..5]،اصلزبانFA/EN/نامعمومی/متنساده/verifiedBuyerسرور/Reply. `GET .../{productId}/mine` خصوصی همانحساب. `PUT .../{productId}/commands/{uuidN}` ورودیversionnullable/locale/rating/displayName/title/body/publishConsent=true؛یکنظرهرحساب/کالا وهر ویرایشPending باrevisionتازه. `POST /api/reviews/{reviewId}/reports/{uuidN}` خصوصی باrevisionId/reasonenum؛یکگزارشهرحساب/نسخه.

`GET /api/admin/reviews?state=&productId=&cursor=` باcms.read؛`PUT /api/admin/reviews/{reviewId}/commands/{uuidN}` باcms.write/MFA وrootSerializable/audit؛version/revisionId/actionApprove|Reject|Hide|Reply/reason/replynullable. رد/پنهان دلیل وپاسخ متن لازم دارد. فرمان actor+UUID/hash،replayهمانreceipt/متفاوت409 وoptimisticversionدارد. پاسخ‌هاnullableهایقراردادیexplicit وno-storeهستند؛BFFstrictرشته‌ها/body/response وorigin/authراکنترل می‌کند. Adminنمی‌تواندverifiedBuyerبسازد؛SalesPaid/FulfilledغیرDemoازsnapshot1/2خوانده می‌شود. جزئیات و حدود درREVIEWS.md؛این routeها از انتشار۴۰ فعال‌اند و در۴۲ حفظ شدند؛STATUS مرجع جاری است.


## گزارش کالای کارکرده؛ اصلی۴۲

- GET `/api/admin/used-items/variants?query=` باcatalog.read؛ query≤100، حداکثر۵۰SKUفیزیکی فعال و `hasMore` صریح. GET `/api/admin/used-items/{variantId}` همانمجوز، `schemaVersion=1/variantId/productId/sku/variantVersion/inspection:null|facts`.
- PUT `/api/admin/used-items/{variantId}/commands/{uuidN}` با **catalog.write وinventory.write وMFA**، rootSerializable/audit، ورودیstrict `{variantVersion,inspection}`. facts: `inspectionId` GUIDNتازه،technicalStateunknown|passed|needsRepair،batteryStateunknown|notApplicable|measured،batteryHealthPercent صریحnullیاعددصحیح۰–۱۰۰،screen/bodyunknown|intact|worn|damaged،repairunknown|noKnownRepair|repaired،notesFa/En≤2000 وinspectedAtUTCبدونآینده. پاسخ `{schemaVersion:1,replayed,detail}`. UUID/hashمتفاوت یاversionقدیمی/Stockچندتایی/رزروفعال۴۰۹؛هرنسخهٔفیزیکی SKUمستقل می‌خواهد. مانده تغییر نمی‌کند،StockSQLCHECK≤1درهمهٔwriterها وFKهمانVariant محفوظ است.
- Variant عمومی و خطوط معمولی Quote3/4/5 وOrder1/2 فیلدoptional `usedCondition` دارند؛کالای نو آن راserializeنمی‌کند. Salesگزارش را ازquoteJSONتاریخیخودش می‌خواند (PascalCase/عدد رشته‌ای داخلذخیره،camelCase/درصدnumberدرHTTP)،نهCatalogجاری. reportتغییرکندquoteقبلی نامعتبرمی‌شود؛سفارشقدیمیfactsخودش را نگه می‌دارد. acceptedOffer دراینبرش UsedConditionندارد وCatalogOfferReader SKUکارکرده را پیشنهاد نمی‌کند. خطای خراب‌بودنsnapshotتاریخی `order_condition_unavailable` با503است.
- گالری نسخهٔ بازرسی، قرارداد نهایی منبع D57/86: facts فیلد optional `photos:[{url,altFa,altEn}]` دارد؛ حداکثر۱۲تصویر مرتب با asset یکتا. URL فقط مسیر دقیق `/media/catalog/{nonzeroN32}/card.webp` با GUID غیرصفر و حروف کوچک است؛ URL خارجی، query/fragment، تصویر عمومی مدل یا فایل اصلی معتبر نیست. `altFa` و`altEn` هر دو اجباری، غیرصرفاًفاصله و حداکثر۱۶۰واحد UTF-16 هستند؛ control و bidi embedding/isolateهای `U+202A..U+202E` و`U+2066..U+2069` رد می‌شوند. بیش از۱۲عکس، asset تکراری یا facts نامعتبر با `invalid_used_condition`/400 رد می‌شود؛ فیلد ناشناخته نیز در decoder سخت‌گیر با400 رد می‌شود.
- این فرمان جایگزینیِ کل گزارش با یک `inspectionId` تازه است، نه patch گالری. `photos:[]` گالری نسخهٔ تازه را خالی می‌کند؛ نبود فیلد یاnull در DTO سرور نیز عکس تازه‌ای ثبت نمی‌کند و عکس نسخهٔ قبلی را خودکار به ارث نمی‌برد. خروجی گزارش بدون عکس، فیلد را حذف می‌کند؛ قرارداد TypeScript نبود/آرایه را می‌پذیرد وnull ارسال/قبول نمی‌کند. JSON و hash فرمان فاقد Photos و receiptهای قدیمی سازگارند. پاسخ نامعلوم با همان PUT/UUID و بدنهٔ منجمد پیگیری می‌شود؛ endpoint تازهٔ GET رسید ساخته نشده است.
- در فرمان تازه، Ready واقعی تمام assetها پیش از هر تغییر کسب‌وکار بررسی می‌شود؛ Staged/Failed/Purged/شناسهٔ ناموجود با `image_not_ready`/400 رد و نسخه، flag تک‌دستگاه، گزارش، receipt و audit موفق ثابت می‌مانند. عکس‌ها در `catalog.UsedItemInspectionPhotos` به همان revision با ترتیب۱..۱۲، FK محدود و قید یکتایی وصل‌اند؛ گزارش/عکس/receipt قبلی immutable هستند و شکست audit تراکنش را rollback می‌کند. migration `20261030160000_UsedInspectionPhotos` تنها یک جدول اضافه می‌کند.
- `usedCondition.photos` عمومی در Catalog و Quote3/4/5 می‌آید؛ Order1/2 و projection سفارش از `Photos` همان quoteJSON تاریخیِ PascalCase می‌خوانند و HTTP راcamelCase می‌دهند. تغییر/پاک‌کردن گالری جاری، عکس، ترتیب و متن دو زبانِ سفارش قبلی را عوض نمی‌کند. مسیر فایل عمومی در API `/api/media/catalog/{id}/{thumb|card|zoom}.webp` و فروشگاه `/media/catalog/...` است؛ پنل از مسیر API پروکسی می‌کند. فقط variantهای پردازش‌شده خوانده می‌شوند؛ thumbها lazy و zoom فقط پس از انتخاب صریح بارگیری می‌شود. عکس عمومی نباید IMEI/سریال/اطلاعات مشتری داشته باشد؛ این محدودیت OCR یا حذف خودکار نیست.
- پذیرش بستهٔ ترکیبی جاری۱۴۲۹unit/۱۴۲SQL هدفمند و۷۴۳storefront/۲۹۷admin وTypeScript/ESLint/Prettier است؛ [مدرک backend](../artifacts/checks/business-continuity-backend/acceptance.json) و[مدرک frontend](../artifacts/checks/business-continuity-frontend/acceptance.json). fullSQL۹۸۴ هنوز در جریان و انتشار۸۶ هنوز در انتظار است؛ runtime اصلی فعلاًD57/85 باقی است. پذیرش تازهٔ مرورگر/آپلود گالری ادعا نیست. [USED-DEVICES](USED-DEVICES.md) مرجع حریم خصوصی، تاریخچه و مرز rollback است وSTATUS نقطهٔ ادامه را نگه می‌دارد.
- API/SQL/پنل/فروشگاه۴۲ محلی باdesktopپذیرفته‌اند؛mobileوکلPDFبازاست. اطلاعات IMEI/سریال خصوصی دراین DTOنیست. provider/سیاست مالی فعال نشده و روی اصلیگزارشیاهماننمونهٔQAseedنشد؛USED-DEVICES/STATUSمرجعحدوداند.

## Market category/brand facets — local source/main42

Public anonymous `POST /api/market/{fa|en}/facets` accepts the existing strict `MarketSearchInput`. Schema 1 returns `locale`, `scope:{query,categoryId:null|string,brandId:null|string}`, `categories:[{id,count}]`, `brands:[{id,name,count}]`, `moreCategories`, `moreBrands`. Counts are eligible published market models, not inventory or payable offers. Each group ignores its own filter and preserves search/the other group; paging has no effect on counts. SQL returns at most 200 options per group with explicit truncation, keeping an eligible selected option first. `/search` is backward compatible. Next proxies this read anonymously with strict scope/locale binding and the existing bounds/origin/no-store policy. Admin `GET /api/admin/market` accepts optional `brandId` and binds it into the cursor; catalog.read/MFA remain required. See [MARKET-FACETS](MARKET-FACETS.md) for acceptance and remaining typed attributes/multiple sources/history.


## Market typed attributes — local source/main43

Public POST `/api/market/{fa|en}/filters` accepts `{categoryId}`; POST `/facet-values` accepts `{search,key,query?,page?,pageSize?,selectedValues?}`. Metadata and values schema1 use Catalog read views and existing Market eligibility. Search/facets accept optional `attributes:[{key,values:[]}]`, requiring category, max8keys ×20values; OR within a key, AND across keys. Decimal28/8 values stay strings. Selected values return localized labels/count0 as needed; absent Bool is unknown. Metadata caps64 with moreFilters; values cap40/page. Only requests with attributes receive optional appliedAttributes/scope.attributes, preserving old shape. BFF binds response locale/fullscope/key/page/selected IDs, no-store/noindex, anonymous/no credentials. See [MARKET-ATTRIBUTES](MARKET-ATTRIBUTES.md) for exact bounds, concurrent definition retry, SSR labels and accepted evidence.


## Market sources/history — local source/main44

GET `/api/market/{fa|en}/{listingId}/sources` returns schema1/locale/listingId and max16 sources, exactly one primary with id=listingId. GET `/{listingId}/sources/{sourceId}/history?before=<positive-int64-string>` returns max20 snapshots with decimal-string sequence, recordedAt, origin(recorded/migrationBaseline), historical source facts and nullable nextBefore. Current publication/model eligibility gates history too; hidden/demo records do not leak. Old item/search/Cart sourcing identity stays unchanged; references never become payable prices.

Admin GET `/api/admin/market/{listingId}/sources` and `/sources/{sourceId}/history` need catalog.read/MFA. PUT `/sources/{sourceId}/commands/{D-UUID}` needs catalog.write/MFA and strict `{listingVersion,sourceVersion:null|string,details}`; extraSourceId is lower-case N-GUID, original source uses the old editor. Both versions/rootSerializable/actor+UUID+hash/receipt/audit and max15extras are authoritative. GET `/api/admin/market/source-commands/{D-UUID}` reads only the same actor's receipt, returning replayed=true. Row snapshots are append-only from API/EF and every owning command bumps parent version. BFF anonymously binds locale/listing/source/cursor, bounds JSON and forbids extra query/origin/credentials; no-store/noindex. Down refuses any retained history/receipt. MARKET-SOURCES and STATUS record exact evidence/limits; extra-source CSV is not yet implemented.

## CSV منابع تکمیلی در اصلی۴۵ پذیرفته

POST `/api/admin/market/source-import/preview` فقط‌خواندنی و `/commit` نوشتناتمیک،GET `/receipts/{D-UUID}` actorخودش:catalog.write/MFA؛GET `/template`:catalog.read/MFA. قالبUTF8۱۲۸KiB/۵۰ردیف،چندمنبعیکوالد،expectedRow شامل listing/source/modelversionوmetadataFingerprint. commit `{csv,requestId,expected}` وresultschema1شاملpayloadHash/fileHashUTF8/created/updated/rows/replayedاست؛UUIDمتنD،sourceIdازlowerN. receipt/hashفایلخامراذخیره‌نمی‌کند. actor+UUID/hashوaudit/rowreceipts/observationsهمگیrootSerializableاند؛replayنتیجهتاریخیبی‌نوشتنمی‌دهد. SourceImportReceiptsتنهاجدولجدیدخالیاصلیاست؛Downباreceiptمتوقفمی‌شود. [MARKET-SOURCE-CSV](MARKET-SOURCE-CSV.md) وSTATUS قرارداد/شواهد/حدود را ثبت می‌کنند؛هلوواقعی/provider/mobile/کلPDFبازند.

## هلو warehouse/reconciliation در اصلی۴۶ پذیرفته

GET `/api/admin/accounting/holoo/warehouses?companyKey=&cursor=` صفحه۲۰/seekوGET `warehouses/{id}` باinventory.read؛PUT `warehouses/{id}` وGET `warehouse-commands/{N-UUID}` باinventory.write؛MFAوریشهauditبرایwrite. body `{commandId,companyKey,externalWarehouseKey,nameFa,nameEn,isActive,acknowledgeWholeStorePhysical,version}` وidentityimmutable/BIN2/oneActiveGlobal. Resultschema1/commandId/targetId/payloadHash/warehouse/replayed،receiptactor-boundوتاریخی. GET `imports/{id}/reconciliation` باcatalog.read+inventory.read فقط‌خواندنی درroottransactionSerializable،batchhash/warehouse/rows/Stock/ratio/target/delta/issues/fingerprint می‌دهد؛canApplyManual/canSyncLive=false. Rows≤200 وquantitydecimalexactشاملصفر،قیمتreadonlyریالرشته‌ای،تغییرSKU/Stock/هلوندارد. Downنگاشت/رسیددار51000دادهراحفظمی‌کند. HOLOO-RECONCILIATION وSTATUSمرجع‌اند؛apply/liveمرحلهٔبعدند.


## اعمال دستی موجودی هلو — اصلی۴۷

GET `/api/admin/accounting/holoo/imports/{id}/stock-preview` با catalog.read وinventory.read/MFA، schema1 شامل reconciliation قبلی، catalogProofs، candidates، fingerprint وcanApplyManual است؛ canSyncLive=false. قرارداد46/reconciliation با flags قبلی حفظ شد.

POST `imports/{id}/stock-commands` با catalog.read وinventory.write/MFA: `{commandId:N-UUID,previewFingerprint:SHA256,rowNumbers:[1..200],reason,acknowledgeWholeStorePhysical:true,acknowledgeUnpostedSalesReconciled:true}`. همهٔ ردیف‌های انتخاب‌شده اتمیک و نسخه‌دارند؛ ردیف غایب/نامعلوم صفر نمی‌شود. رزروها/قیمت/محتوا محفوظ‌اند. ردیابی سریال/کارکرده و مشاهدهٔ قدیمی مسدودند. actor+UUID/hash، رسید رابطه‌ای immutable، ledger وaudit در rootSerializable ثبت می‌شوند. GET `imports/{id}/stock-commands/{commandId}` همان actor را با مجوز نوشتن و GET `stock-applications/{id}` تاریخچه را با catalog.read+inventory.read می‌خوانند؛ receipt snapshot امروز نیست. تمام مسیرها private/no-store هستند. [HOLOO-STOCK-APPLY](HOLOO-STOCK-APPLY.md) وSTATUS شواهد/محدودیت‌ها را ثبت می‌کنند؛ live/قراردادvendor/mobile بازند.


## دسترسی منوی CMS به بازار — revision3 محلی، schema۴۷

HTTP قرارداد تازه‌ای ندارد. `site/fa` و `site/en` لینک `/market` را با عنوان ترجمه‌شده دارند؛ header/footer همان snapshot CMS را مصرف می‌کنند. ویرایش معمول با فرم فعلی CMS و publish نسخه‌دار است. ابزار CLI `--market-navigation-dev` فقط Development، dry-run پیش‌فرض و `--apply` صریح دارد؛ دو زبان اتمیک، draft منتشرنشده/منوی پُر/سند غایب موجب توقف و لینک/عنوان سفارشی موجود موجب حفظ بی‌نوشتن است. [MARKET-NAVIGATION](MARKET-NAVIGATION.md) وSTATUS شواهد محلی و حدود را ثبت می‌کنند.


## Physical shipment — source48

`docs/ORDER-FULFILLMENT.md` defines the physical-only, full-order workflow. Root Serializable audit coordinates Sales/Inventory; real Paid + Allocated + exact units required. No endpoint can manufacture payment. All routes are private/no-store/noindex.

- `GET /api/admin/orders/{ownerId}/{id}/shipment`: `sales.read` + `inventory.read`; exact readiness/fingerprint, current packing revision, historical order lines and assigned units.
- `POST /api/admin/orders/{id}/shipment/commands`: `sales.write` + `inventory.write`; strict ownerId, N-UUID commandId, action `pack|repack|dispatch|deliver`, orderVersion/shipmentVersion, inventoryFingerprint, reason, acknowledge, action-specific carrier/time fields. No money fields. Same actor+UUID/body returns immutable historical receipt before evaluating today's facts; different body409. `repack` appends one packing revision only after changed physical facts, prior history remains.
- `GET /api/admin/orders/{id}/shipment/commands/{commandId}`: same write policies, receipt scoped to the authenticated actor. Corrupt receipt fails503 `shipment_unavailable`.
- `GET /api/orders/{id}/shipment` and `/api/orders/v2/{id}/shipment`: JWT customer forced owner; foreign order404. Client BFF permits only the exact v2 GET route, no owner query or shipment mutation. Unit details hidden until dispatch; manual carrier report explicitly labeled.

Dispatch fulfills Inventory once; delivery only records Sales fulfillment. Staff event times explicit UTC, nonfuture, ordered. SQL bigint financial snapshots remain untouched. Carrier name FA/EN and optional tracking number are manual text, no invented provider/tracking URL. Shipment DTOs contain no monetary values. Synthetic Paid fixtures exist only in the test executable on a fresh explicit Development GUID QA database and are unavailable as a product adapter.


## Cash payment history — accepted local50

`PAYMENT-CORE.md` defines the internal verified-payment boundary; there is no public endpoint accepting a gateway verification fact or marking an order paid. No gateway adapter is configured and product `canPay` remains false. Initiation/network verification/callback/reconcile still require completion and a real vendor contract.

- `GET /api/payments/orders/{id}?cursor=...`: customer forced JWT owner; exact order filter, seek50, no foreign-owner records. Only cursor is accepted.
- `GET /api/payments/attempts/{id}`: owner-only, schema1 detail wrapping the evidence-validated attempt; foreign404.
- `GET /api/admin/payments/attempts?state=...&orderId=...&cursor=...`: both finance.read and sales.read under real admin/MFA policy. No manual Paid command.

All reads private/no-store/noindex. AmountRial/VerifiedAmountRial are integer-rial decimal strings, UTC timestamps and canonical versions; raw authority/reference, provider/account configuration, customer identity and protected payloads are absent. A verified header without matching applied evidence fails503. Cursor binds owner/admin scope and exact filters. Frontend BFF exposes only exact customer GET paths, bearer without cookies, strict bounded decoder and no financial mutations. Admin navigation requires both permissions and drops an inaccessible page on authorization changes. PWA never intercepts API traffic.

Local50 evidence: `payment-core50-main-release.json`; 884 unit/624 real SQL/341 storefront/212 admin, 6 SQL-wire and 21 browser-wire responses, isolated QA cleanup, verified pre-upgrade backup, 848 HTTP checks and preservation of all 137 tables after smoke. Actual gateway initiation/verification/callback/reconciliation and mobile acceptance remain open.

## Private support tickets — accepted local51

`SUPPORT-TICKETS.md` defines encrypted, private, plain-text conversations. A ticket is owned by its authenticated customer; the client cannot supply an owner or staff identity. Every route is no-store/noindex and excluded from PWA caching. Creation, reply, close and reopen use a canonical N-UUID in the URL and a frozen strict body. Repeating the same actor/UUID/body returns its original encrypted historical receipt; a changed payload conflicts. Reply and state commands require the exact rowversion. Staff writes share the root Serializable Identity audit transaction; history is append-only and physical deletion is unavailable.

- `GET /api/support/tickets?state=Open|WaitingCustomer|Closed&cursor=...`: own list, seek50 by creation sequence. All states when omitted.
- `GET /api/support/tickets/{id}`: own header, schema1.
- `GET /api/support/tickets/{id}/messages?cursor=...`: own messages, ascending seek50; sequence is a decimal string. Cursor binds ticket and customer/staff scope.
- `POST /api/support/tickets/commands/{commandId}`: `{subject,body,locale}`; subject1–120, plain body1–4000, fa/en. Technical per-owner open capacity defaults to20.
- `POST /api/support/tickets/{id}/replies/{commandId}`: `{version,body,locale}`; Closed requires a separate reopen.
- `PUT /api/support/tickets/{id}/state/{commandId}`: `{version,state:"Open"|"Closed"}`; Open only reopens Closed, Closed only closes an active ticket.
- `GET /api/support/commands/{commandId}`: only the same actor and customer audience; receipt reads do not write or extend anything.
- Corresponding reads/reply/state/receipt under `/api/admin/support` require completed staff identity plus support.read. Mutations and receipt recovery additionally require support.write. There is no staff create-on-behalf endpoint. Dedicated SupportAgent has only these two permissions; other business roles do not inherit private support access.

Customer reply→Open, staff reply→WaitingCustomer, explicit close→Closed, explicit reopen→Open. Subject, content and receipt are protected by ticket/kind/record purpose; raw protected bytes, owner IDs and staff identities are absent from the DTOs. Request maximum32KiB, strict queries and same-origin BFF; no attachments, external messages or automated refund/credit/order effects. Live SignalR chat and notification delivery are separate unfinished work. Provisioning a missing known role occurs only inside an explicit, audited Administrator grant; startup/migration grants no user access.

Local51 evidence: `support-ticket51-main-release.json`; 896 unit/634 real SQL/352 storefront/212 admin, 11 SQL-wire and 61 browser-wire responses plus 8 inputs, four committed response losses, isolated QA cleanup, verified backup, 909 HTTP checks and preservation of all 142 tables after smoke. All 137 prior tables including Identity roles remain unchanged; there is no implicit role grant. SignalR, notifications, private attachments, external delivery and mobile acceptance remain open.


## محتوای پشتیبانی — سورس پس از اصلی۵۱، پذیرش جاری

`GET /api/content/support/{fa|en}` عمومی و no-store است. schemaVersion1/locale/revision/content صریح‌اند؛ نبود انتشار یا نمونه در Production برابر revision0/contentnull است. فقط سؤال فعال از انتشار همان زبان نمایش داده می‌شود؛ draft/updatedBy/enabled در DTO عمومی نیست. خطای محتوای نامعتبر 503 `support_content_unavailable` است. هیچ query پذیرفته نمی‌شود.

`PUT /api/admin/content/support/{fa|en}` و `POST .../publish` همان CMS نسخه‌دار، staff_mfa/cms.write و audit/Serializable را دارند؛ سند شامل schemaVersion/isDemo/eyebrow/title/description/ticketsAction/faqTitle/faqDescription/faqs است. FAQ دارای id غیرصفر N-UUID کوچک، question/answer متن ساده و enabled است؛ ترتیب آرایه حفظ می‌شود. حداکثر۳۰ پرسش/۱۰۰۰۰۰بایت سریال‌شده و سقف مستقل هر متن اعمال می‌شوند.

`GET /api/admin/content/support/{fa|en}/revisions/{positive-decimal-id}` فقط staff_mfa/cms.read، no-store/private/noindex و بدون query؛ همان سند و زبان را بررسی می‌کند. envelope شامل schemaVersion/locale/revisionId رشته‌ای/revision/contentDraft است؛ سؤال غیرفعال فقط در این پیش‌نمایش مجاز دیده می‌شود. شناسهٔ متعلق به زبان دیگر 404 و نامعتبر 400 است. پنل ابتدا پیش‌نویس یا نسخهٔ تاریخی مشخص را نمایش می‌دهد و همان rowversion ثبت‌شده را برای انتشار/بازگردانی ارسال می‌کند.

## اعلان خصوصی — اصلی محلی۵۲ پذیرفته و منتشر

`GET /api/notifications?unreadOnly=true|false&cursor=...`، `GET /api/notifications/unread-count` و `PUT /api/notifications/{id}/read` فقط customer/access معتبر، origin مجاز و rate limit دارند. PUT فقط JSON `{}` می‌پذیرد؛ owner، timestamp یا وضعیت دلخواه قابل ارسال نیست. query ناشناخته/تکراری رد می‌شود. responseها private/no-store/noindex و Vary Cookie/Authorization هستند؛ BFF bearer را بدون cookie به API می‌فرستد و ورودی۱KiB/پاسخ۶۴KiB را محدود می‌کند.

فهرست schemaVersion1/unreadOnly/items/nextCursor صریح و۵۰تایی با seek است. آیتم id/sequence رشتهٔ decimal64bit/ticketId/kind/at/readAt nullable دارد؛ kind فقط support_reply/support_closed/support_reopened است. owner/eventSequence/عنوان/متن خصوصی پیام در DTO نیست. unreadCount رشتهٔ عدد غیرمنفی64bit و مستقل از snapshot فهرست است. read نتیجهٔ schemaVersion/notification با readAt غیرnull است؛ retry زمان اولیه را حفظ می‌کند و clock rollback آن را قبل از at نمی‌برد. اعلان دیگران404 است؛ نقش پشتیبان دسترسی به اعلان شخصی دیگران نمی‌دهد.

اعلان کارمند در همان transaction پاسخ/وضعیت/audit و بر اساس event identity پایدار ثبت می‌شود؛ replay یا فرمان خود مشتری اعلان تکراری ایجاد نمی‌کند. تاریخچه حذف/ویرایش نمی‌شود و Down با تاریخچه موجود رد است. API فاقد endpoint ارسال دلخواه/اعلان گروهی/خواندن اعلان دیگران است. SMS/Email/Push/SignalR در این برش متصل نیستند؛ PRIVATE-NOTIFICATIONS پذیرش را ثبت می‌کند.


## Private realtime — accepted local52, no migration

Customer `/api/realtime` and staff `/api/admin/realtime` expose only SignalR JSON Long Polling: POST `/negotiate?negotiateVersion=1`, GET/POST/DELETE base with protected `id`. Access bearer is header-only; staff requires MFA and support.read. Same-origin, no-store/noindex, bounded bodies/frames and no arbitrary hub methods/groups. Protected connection leases bind current identity/jti/stamp/capabilities/audience. Only `Changed` with `{schemaVersion:1,scope:'support'|'notifications'}` is delivered after commit; SQL APIs remain authoritative. Reconnect refreshes permitted data; failures do not reverse committed SQL. PRIVATE-REALTIME.md records security, existing ten-minute JWT logout semantics, exact evidence and remaining deployment limits. This supersedes earlier unfinished SignalR notes; private attachments and external providers remain open.

## Private ticket attachments — accepted local54

This supersedes earlier unfinished attachment notes. `PRIVATE-FILES.md` and STATUS record acceptance; **main Files storage remains Disabled** until actual private storage/scanner configuration. Plain text tickets remain available independently.

- GET `/api/support/files/capabilities`: schema1/configured/maxBytes8388608/contentTypes JPEG,PNG,WebP,PDF/maxPerTicket20. Configuration capability is not a health guarantee.
- GET `/api/support/tickets/{id}/attachments`: owner-only, maximum20 descriptors, schema1/ticketId/items; each item id/messageId/author/UTC/file{filename,contentType,bytes}. No owner, object key, raw hash or protected material.
- POST `/api/support/tickets/{id}/attachments/{commandId}`: bounded multipart with exactly version/body/locale/sha256/file. Caption required; actual server digest must match. Same actor/UUID/complete intent preserves one message/file/receipt; changed input409. File+reply+notification+audit attach atomically after scanning/storage outside SQL.
- GET `/api/support/tickets/{id}/attachments/{fileId}`: private attachment-only binary with exact MIME/length, X-Sayman-Private-File, no-store/noindex/nosniff/CSP sandbox; no ranges or public URL.
- Equivalent staff routes under `/api/admin/support` require staff/MFA/support.read; upload additionally support.write. Cross-owner404; wrong role403. GET list does not perform object I/O. Download audit is mandatory; failed audit discards plaintext.

Uploads10/min, metadata60/min, downloads30/min per identity, technical2 concurrent upload parses/2 downloads held until body completion and independent crypto/scan slots. Manual MultipartReader avoids IFormFile temporary disk buffering. Raw input8MiB+64KiB, timeout40s; binary output absolute30s. Client BFF sends bearer without cookies, uses bounded production decoders and does not cache. Unknown upload retains exact Blob/command/body only in RAM; GET receipt recovers committed success without duplicate POST. Files Staged/Stored/Attached metadata and Support history have guarded Down; orphan cleanup/retention/restore with objects remain separate unfinished work.

## Private cheque draft applications — accepted local55

`CREDIT-APPLICATIONS.md` defines the scope. These drafts neither reserve stock nor create/approve/pay an order. Principal requested by the customer is canonical positive integer rial as a decimal string. Credit snapshot preserves selected server plan/version; live plan edits cannot rewrite it. Consent/documents/submit/manual decision/order conversion are still unfinished and canSubmit is always false with an explicit blocker.

- GET `/api/credit/plans?after=...`: active plan options, seek50, exact plan rowversion and rates/limits/category count. No customer identity.
- GET `/api/credit/applications?state=Draft|Cancelled&cursor=...`: JWT owner-only seek50; cursor bound to owner/filter. Detail GET `/applications/{id}` includes its protected historical plan, canSubmit=false and blocker.
- POST `/api/credit/applications/commands/{commandId}`: strict `{planId,planVersion,requestedAmountRial,locale}`. Current enabled plan, range/version and technical20 open drafts per owner are checked under the command gate.
- PUT `/api/credit/applications/{id}/cancel/{commandId}`: strict `{version}`, only Draft→Cancelled. No physical deletion.
- GET `/api/credit/commands/{commandId}`: actor-only historical receipt; replay retains original snapshot/state even after cancellation.
- Staff GET `/api/admin/credit/applications` and `/applications/{id}` require staff/MFA/credit.read. Existing finance.read or support.read alone does not grant private case access. New CreditReviewer can only be assigned explicitly by an authorized Administrator; startup/migration assigns it to no user.

All private/no-store/noindex; strict origin/query/body allowlists. Every mutation/receipt/event/audit shares one root Serializable transaction and actor+UUID+payload hash. Plan and command receipt are Data Protection wrapped by application/kind/record. Accepted local55 after 963 unit / 662 real SQL / 395 storefront / 214 admin / 8 proxy tests, actual SQL/browser DTO decoding, two committed response losses recovered by receipts, logout/relogin, QA cleanup and backup/additive rollout. All financial amounts, including roundingUnitRial ("1" or "10"), are decimal strings. Consent/documents/submission/review/order conversion remain unfinished; draft acceptance does not complete CREDIT-01.


## شرایط و رضایت چک — اصلی۵۶

مشتری customer: GET `/api/credit/requirements`؛ GET `/api/credit/applications/{id}/requirements`؛ POST/GET `/api/credit/applications/{id}/consents/{commandId}` فقط مالک. staff/MFA/credit.read: GET `/api/admin/credit/applications/{id}/requirements`. پیکربندی شرایط مستقل با staff/MFA/finance.read: GET `/api/admin/credit/requirements`، `/history?cursor`، `/revisions/{id}`؛ POST/GET `/commands/{commandId}` علاوه بر آن finance.write می‌خواهد.

Consent ورودی صریح applicationVersion/requirementsVersion/requirementsRevisionId/locale/accepted=true دارد. Publish ورودی version nullable اما الزامی و content FA/EN/Enabled/Documents دارد؛ تاریخچه خلاصه و متن تک‌نسخه جداست. همه private/no-store/noindex، UUID actor-bound، receipt تاریخی رمز‌شده و rootSerializable/audit هستند. Limits انتشار۴۸KiB، consent۸KiB، خروجی۲۵۶KiB؛ BFF با strictdecoder. اعتبار/سفارش/submit از رضایت ساخته نمی‌شود. CREDIT-REQUIREMENTS و STATUS شواهد و باقی کار را ثبت می‌کنند.


## مدارک خصوصی پروندهٔ چکی — اصلی۵۷

Customer: GET `/api/credit/applications/{id}/documents`؛ POST/GET `/api/credit/applications/{id}/documents/commands/{commandId}`؛ GET `/api/credit/applications/{id}/documents/files/{fileId}`. فقط مالک؛ staff/MFA/credit.read فقط GET صفحه و GET فایل از prefix `/api/admin/credit` دارد. کارکنان upload/receipt مشتری ندارند.

POST multipart دقیقاً version/consentId/requirementsRevisionId/documentKey/replacesFileId/sha256 و file دارد؛ replacesFileId خالی یعنی null، جایگزینی ID فایل جاری می‌خواهد. digest واقعی سرور و MIME/اندازهٔ تعریف immutable کنترل می‌شوند. GETreceipt تاریخی بعد تغییر شرایط/لغو نیز معتبر است. صفحه تاریخچه۴۸تایی/IsCurrent/canUpload/configured/blockers و نسخهٔ جاری پرونده را می‌دهد؛ هیچ URL/storage key/owner/actor خام در DTO نیست.

۸MiB+۶۴KiB، deadline۴۰ثانیه/انتقال client۴۵ثانیه، slots مستقل bounded، bearer بدون cookie، JSON۲۵۶KiB و private/no-store/noindex. دانلود Range را رد و attachment/nosniff/CSP sandbox و X-Sayman-Private-File می‌دهد؛ audit پیش از تحویل body اجباری است. S3/ClamAV بیرون SQL و attach/receipt/event/audit در rootSerializable با بازاعتبارسنجی انجام می‌شوند. source core پذیرفته؛ mainFiles Disabled و submit/review/order بازند. CREDIT-DOCUMENTS و STATUS شواهد/حدود را ثبت می‌کنند.

## Credit submission۵۸ — خصوصی، پذیرفتهٔ محلی

- Owner customer: `GET /api/credit/applications/{id}/submission` قابلیت واقعی CanSubmit/CanWithdraw، blockers، consent/revision/headversion و تعداد/کلید مدارک ناقص؛ legacy detail همچنان canSubmit=false است.
- Owner: `POST /api/credit/applications/{id}/submissions/commands/{commandId}` JSON strict شامل `applicationVersion,consentId,requirementsRevisionId,requirementsVersion,locale,note,reviewRequested:true`. note اختیاری/trim/۲۰۰۰کاراکتر UTF-8معتبر؛ مبلغ سفارش نمی‌پذیرد. `GET` همان مسیر رسید تاریخی همان actor/body است.
- Owner: `GET .../{id}/submissions` تاریخچهٔ حداکثر۲۰summary، nextCursor=null؛ `GET .../{id}/submissions/{submissionId}` snapshot طرح/رضایت/یادداشت/فایل‌های همان ارسال. query پذیرفته نمی‌شود.
- Staff/MFA/credit.read فقط سهGET بالا با prefix `/api/admin/credit`؛ CanSubmit/CanWithdraw همیشهfalse. صف `GET /api/admin/credit/applications?state=Submitted` از state صریح پشتیبانی می‌کند. staff هیچ submit/receiptowner/upload/consent از طرف مشتری ندارد.
- وضعیت‌های این نسخه Draft/Submitted/Cancelled. `PUT /api/credit/applications/{id}/cancel/{commandId}` با `{version}` در Submitted انصراف از بررسی/event Withdrawn و حفظ snapshot/رسید است. Accepted دستی/checkout هنوز در این نسخه وجود ندارد.

root Serializable Identity/Credit/Files، gates شرایط→فرمان پرونده، metadata/hash و FKهای همان پرونده/consent/revision/key؛ پول همچنان رشتهٔ decimal ریال و SQLbigint. بدنه۸KiB/پاسخJSON۲۵۶KiB، bearer بدون cookie، same-origin/no-store/noindex. unknown با GETreceipt و retry UUID/body ثابت در RAM بازیابی می‌شود. Files اصلیDisabled، mainhead/consent/docs/submissions خالی و هیچ default حقوقی/مالی ندارند. مرجع [CREDIT-SUBMISSION](CREDIT-SUBMISSION.md).

## Manual credit review۵۹ — پذیرفتهٔ محلی

Staff/MFA/credit.read: `GET /api/admin/credit/applications/{id}/review` قابلیت `canReview/canApprove`، submissionId و blockers. بدون credit.write، canReview=false؛ نبود storage در snapshot دارای فایل، canApprove=false ولی Return/Decline را خودکار منع نمی‌کند.

Staff/MFA/credit.read+credit.write: `POST /api/admin/credit/applications/{id}/reviews/commands/{commandId}` با JSON strict `applicationVersion,submissionId,outcome,locale,note,approvedAmountRial,expiresAt,reviewConfirmed:true`. outcome از Returned/Declined/Approved. note trim/nonempty/۲۰۰۰کاراکترUTF-8معتبر؛ Approved مبلغ canonicalرشتهٔریال مثبت≤درخواست و expiresAtUTCآینده لازم دارد؛ دیگرoutcomeها این‌دو راnull می‌خواهند. `GET`همانمسیر رسید تاریخی فقطactor همان فرمان است؛ تازه‌ترین وضعیت جایآن نمی‌آید. بدنه۸KiB/پاسخ۲۵۶KiB، cookieforwardنمی‌شود.

Ownercustomer و staff/MFA/credit.read: `GET .../applications/{id}/reviews` summaryتا۲۰/nextCursor=null؛ `GET .../{id}/reviews/{reviewId}` نتیجه و دلیلِاصلی. prefixمالک `/api/credit` وstaff `/api/admin/credit` است؛ ownerهیچPOSTdecision/capabilitystaff/receiptstaffندارد. queryهیچ‌کدام پذیرفته نیست.

Stateهای جاری Draft/Submitted/Cancelled/Approved/Declined. Return،Draftباpointerتصمیم واصلsubmissionرا حفظ می‌کند؛ ارسال دوباره submissionتازه وpointerتصمیمnullمی‌سازد. Approved/Declinedترمینال اینبرش‌اند؛ سفارش یامصرف اعتبارنیستند. صفstate=Approved/Declinedدرlistمالک/بازبین صریحاً پشتیبانی می‌شود. rootSerializableIdentity/Credit/Files،gateمشترک،immutable/encryptednote+receipt،audit وFKهمانsubmission. مرجع [CREDIT-REVIEW](CREDIT-REVIEW.md). quoteچکی هنوز`credit_approval_required`می‌دهد؛ اتصالخرید مرحلهٔبعد است.

## مجوز خرید از approval — اصلی۶۰

تمام مسیرها bearer/private,no-store/noindex وبدونquery هستند. ownercustomer فقط پروندهٔخود؛staff بهMFA+credit.read و برای mutation/receipt بهcredit.write نیزنیازدارد. originهم‌مبدأ،input۸KiB/response۲۵۶KiB وJSONstrict؛پول decimal stringریال.

- GET `/api/credit/applications/{id}/purchase-scope` و همان `/api/admin/credit/...`: schema1/application/reviewIdnullable/scopenullable،canGrant/canRevoke/eligibleForQuote وblockers؛canPlaceOrder/canPay=false. scope شاملID/version/review/submission/basis/limitAmountRial/expiry/grantedAt/Active|Expired|Revoked وrevocationnullable(ActorKind/Locale/Note/At)؛بدونowner/actorID.
- فقطstaff POST `/api/admin/credit/applications/{id}/purchase-scope/grant/{commandId}`: applicationVersion/reviewId/limitBasis(PayableTotalRial|InstallmentsTotalRial)/grantConfirmed=true. هیچamount/expiryinput مجازنیست؛عینreviewنسخهٔجاری.
- owner/staff POST `/api/[admin/]credit/applications/{id}/purchase-scope/revoke/{commandId}`: applicationVersion/scopeVersion/locale/note/revokeConfirmed=true؛staffnoteلازم،ownerاختیاری.
- owner/staff GET `/api/[admin/]credit/applications/{id}/purchase-scope/commands/{commandId}` actor-boundreceipt؛schema1/replayed/commandId/KindGrant|Revoke/Application/Scope. replayهمانactor+UUID/bodyحتیپسابطال/expiryحقیقتتاریخیفرماناست،قابلیتفعلیازPageخواندهشود.
- Customer BFF صدورgrantرابازنمی‌کند؛ownerreceiptفقطRevoke/ActorKindOwner. Adminproxy دقیقاًGETpage/receipt وPOSTgrant/revokeرا با۸KiB/noCookie/noSetCookieبازمی‌کند. journalفقطRAM وscopeCommandGrant درclient metadata مبلغ/expiry/submissionتأییدیهبرایبررسیreceiptدارد؛اینmetadataبهserverفرستاده‌نمی‌شود.

اینAPI هنوزorder/reservation/payment/claim مصرفایجادنمی‌کند؛eligibilityبرایمحاسبهٔآیندهquoteاست. خطاهایinvalid_credit_purchase_scope/credit_purchase_scope_conflict/credit_scope_idempotency_conflict وblockerهایtyped درقراردادهایCredit/TSمرجع‌اند.

## Credit checkout quote — accepted local61

Customer bearer/private/no-store/noindex; no query, 8KiB JSON input, 1MiB response. `POST /api/cart/{fa|en}/v2/credit-quote/commands/{N32}` accepts only cartVersion/methodId/planId/applicationId/scopeId/applicationVersion/scopeVersion; no money/expiry. `GET` same command returns immutable actor/locale-bound receipt; `GET /api/cart/{fa|en}/v2/credit-quotes/{N32}` returns owned historical calculation with original locale. Schema1 sidecar contains exactly one ordinary Quote3 or accepted Quote5 plus thin scope authority/assessment; exact rial strings. Scope/price/stock/charges assessed in rootSerializable; UUID domain-separated, audit atomic. CanPlaceOrder/CanPay remain false/credit_order_not_configured. Expiry/revoke do not rewrite receipts. Main61 source/runtime evidence in STATUS; history UI after full reload and single-use order claim remain open.

### Credit cheque orders — accepted local63

Customer bearer/private/no-store/noindex: `POST /api/credit-orders/commands/{N32}` accepts strict `creditQuoteId`, `fingerprint`, contact/address/note and explicit `quoteAccepted` + `acknowledgeTemporary`; 16KiB, no client money, scope or owner. `GET` same command returns the immutable creation receipt (including after cancellation/expiry); `GET /api/credit-orders/{N32}` returns current order plus the retained calculation. `GET /api/credit-orders/quotes?cursor={canonicalBase64url}` provides 20 owned calculations and related order IDs; `GET /api/credit-orders/quotes/{N32}/readiness` rechecks current eligibility without claiming scope or reserving stock. No unrecognized or repeated query keys. Creation/receipt schema1 wraps unchanged order-detail-v2/original-snapshot1|2; current detail includes original credit calculation schema1. Monetary fields remain integer-rial decimal strings.

`GET /api/admin/credit-orders/{ownerId}/{N32}` requires staff MFA + `sales.write`, admin origin and orders rate limit. It exposes no creation or financial-settlement mutation. Admin proxy only forwards that scoped GET, excludes cookies/Set-Cookie, restricts query and bounds JSON at 1MiB. Customer BFF uses strict production decoders and original quote/receipt binding.

`CheckoutOrderSettings.chequeOrdersEnabled` is independently disabled by default; the existing `temporaryOrdersEnabled` still controls cash-only temporary orders. Legacy settings inputs omitting the new nullable field preserve its existing value. An explicit settings revision invalidates prior uncommitted calculations. Approval, scope and calculation continue to have `canPlaceOrder/canPay=false`; a separate order consumer validates current permission, plan, prices, charges, stock and deadlines in the shared Serializable transaction. `credit_settlement_pending` does not claim down-payment receipt or cheque collection. Cancellation/expiry release stock while `Credit.PurchaseScopeUses` remains immutable and unusable for another order. Local63 is active: 993 unit, 707 full SQL, 453 storefront, 214 admin, 14 proxy; 43 SQL and 21 browser wire responses. Ordinary browser and mixed/accepted-only SQL are accepted. Main defaults remain disabled; settlement, exact due dates and cheque collection remain open. See CREDIT-ORDERS and STATUS.

## برنامهٔ سررسید چکی۶۴

مشتریGET `/api/credit/orders/{orderId}/schedule` و `/history?beforeRevision=...` فقط owned/read-only. پنل staffMFA+finance.read:GET `/api/admin/credit/orders?cursor=...` صف۲۰تایی بدونcontact و GET `/api/admin/credit/orders/{ownerId}/{orderId}/schedule` و `/history`. finance.write اضافی برای POST `/preview`،POST و GET `/commands/{commandId}`. پیش‌نمایش با orderVersion/scheduleVersionnullable/calendarKind/anchorDate صریح؛ saveهمانفیلدها+previewFingerprint+confirmedtrue،بدونclientmoney. revision/receiptimmutable،DateOnlyGregorian/AsiaTehran،مبالغintegerریالرشته‌ای و همهٔcanPay/canFulfillfalse. customerBFFGETفقط،adminproxyروش/مسیر/query/bodybounded؛no-store/noindex. جزئیات CREDIT-SCHEDULES و A67؛ وصول/دریافت چک در این قرارداد نیست.

## دفتر گردش داخلی چک۶۵

مشتری GET `/api/credit/orders/{orderId}/cheques` فقط owned/read-only بدونمرجع/یادداشت. پنل MFA+finance.read:GET `/api/admin/credit/orders/{ownerId}/{orderId}/cheques`،`/{chequeId}`،`/{chequeId}/history?beforeSequence=...` (۱–۲۰۰ canonical/۲۰رویداد). finance.write اضافی:POST `/receive/commands/{commandId}` و `/{chequeId}/commands/{commandId}`؛ GET `/commands/{commandId}` رسید actorbound تاریخی. receive:orderVersion/scheduleVersion/sequence/instrumentReference/note/occurredAtUTC/confirmedtrue؛بدونclientamount/due/owner. move:headVersion/action/note/occurredAtUTC/confirmedtrue/acknowledgedClosedOrder صریح. مرجع و note رمز‌شده و فقطمالی؛ eventها و receipt تغییرناپذیر. bankVerified/canPay/canFulfillfalse؛ گزارش وصول داخلی verifyبانک نیست. اولین دریافت، برنامه را ثابت می‌کند؛ private/no-store/noindex/body۸KiB/response۲۶۲KiB وBFFفقطGETcustomer. CHEQUE-LEDGER/A69 مرجع است.

### صفحه‌های محتوایی مستقل — پذیرفته و منتشر در اصلی۶۶

`GET /api/content/pages/{locale}/{slug}` عمومی، فقط Published همان زبان، no-store و404 برای draft/unpublished/demo خارج Development. slug ثابت `[a-z0-9]+(-[a-z0-9]+)*` تا۸۰حرف و route فروشگاه `/{locale}/pages/{slug}` است. هیچ seed/publication اصلی ساخته نمی‌شود.

`/api/admin/pages` مستقل از فیلتر legacy admin، staff_mfa+cms.read، private/no-store/noindex: GETفهرست۵۰ با cursor=آخرینslug، GET`/{pageId}` پیش‌نویس/انتشار جاری، GET`/{pageId}/history?beforePublication=n` باseek۲۰ و GET`/{pageId}/revisions/{revisionId}` پیش‌نمایش همان صفحه. POST`/commands/{commandId}` ایجاد و POST`/{pageId}/commands/{commandId}` Save/Publish/Restore/Unpublish با cms.write؛ GETهمانpath رسید تاریخی actor-bound وcms.write دارد. UUID lowercaseN،hashبدنه/قفل/expectedVersion/audit/rootIdentityCmsSerializable اتمیک‌اند. replay پیش از کنترل نسخهٔ جاری و با همان action/body است؛ ارسال body تازه باUUIDقبلی409. نشر/بازگردانی/لغو نیازمند confirmed=true صریح‌اند.

Create:slug/isDemo/content، Save:version/content؛ Publish/Unpublish:version/confirmed؛ Restore:version/restoreRevisionId/confirmed. فیلدهای نامرتبط و ناشناخته رد می‌شوند. صفحهٔ نمونه از زمان ایجاد immutable و خارج Development مخفی است. bodyدوزبانه≤۶۴KiB،هرزبان۲۰بلوک Text/Callout/Image/Links باIDثابت وvisibility All/Mobile/Desktop،متن ساده و تصویر عمومیCatalog وپیوندداخلی محدود. publishعنوان وبلوک معتبر هردوزبان می‌خواهد. restoreنسخهٔ تازه می‌سازد وdraftرا تغییر نمی‌دهد؛unpublishتاریخچه را حفظ می‌کند. پاسخ فرمان commandId/pageId/action/version/publication/revisionId/publishedRevisionId/draftHash/replayed دارد؛ nullهای قراردادی صریح‌اند. CMS-PAGES مرجع حدود/پذیرش است؛ CMS-03/blog/redirect/sitemapصفحات هنوز ادعا نیست.

CMSصفحات Next پیشstreaming خواندن محدودpublic انجام می‌دهند؛ missing/draft/unpublished با404واقعی/بدونcache وAPIقطع503 برمی‌گردند. source-acceptance-http-refined وmain-release۶۶ مرجعند؛ نسخهٔ اولیهٔ پذیرفته برایسابقه ثابت مانده است.

### نقشهٔ سایت صفحه‌های CMS — پذیرفته code-only در اصلی۶۶

GET`/api/content/page-sitemap/{fa|en}` manifest مستقل strictv1،dataSource=api،isPreviewمحافظقبلی،allowIndexingازSEOمنتشرهمانزبان،pageSize1000 وpageCountرشتهٔرقم‌لاتین≤۵۰میلیون. اجازهٔSEOخاموش،شمارش وخواندن جدولPagesانجام‌نمی‌دهد. GET`/api/content/page-sitemap/{locale}/entries?page=1` باصفحهٔcanonical۱–۵۰هزار (پیش‌فرض۱)،itemsحداکثر۱۰۰۰رکورد key/fa/en/lastModifiedUTCواقعیrevision. فقطPublishedهمانheadوغیرنمونه؛DraftJson/BodyJson/actor/commerceخوانده‌نمی‌شوند. همهٔخواندن‌هاanonymous/no-store؛باslugمجاز`sitemap`درendpointصفحهتصادم‌ندارد. manifestخاموش‌بودنindexدسترسی‌عمومی‌صفحهٔPublishedراخصوصی‌نمی‌کند.

Nextفایل‌هایroot`/sitemap-fa-pages-1.xml`وENرا بهindexموجوداضافه‌می‌کند،فقطباشتراکgateهایCatalog/CMS/محیط. schemaقدیمیCatalogعوض‌نشده،سقفکل۵۰هزارفایل/۱۰۰۰URLهرصفحه وبدونcredential/strict/bounded/503حفظاست. lastmodفقطازUTCrevisionسرور وalternateفقطزبان‌مجازاست. previewمحصولبهfalseتبدیل‌نشده وindexاصلیفعال‌نشده؛اینبرشCMS-03/بلاگ/redirectرا کامل‌اعلام‌نمی‌کند. CMS-PAGE-SITEMAP/STATUSمرجعپذیرش‌اند.

### انتقال نشانی — پذیرفته و منتشر در اصلی۶۷

عمومی anonymous GET `/api/content/redirects/resolve?path=...` فقط یک query به نام path و source دقیق `/{fa|en}/{product|pages}/{slug}` می‌پذیرد. پاسخ version1/dataSourceapi/sourcePath/found/isDemo/targetPathnullable/statusnullable؛ نبود قانون200foundfalse با nullهای صریح، خطای حقایق503 است. پیش‌نویس/actor/history وارد پاسخ عمومی نمی‌شوند؛ demo خارج Development پنهان است. مقصد همان زبان و مسیر عمومی مصوب،301یا302صریح، بدونquery/fragment/external است.

پنل staffMFA+cms.read GET `/api/admin/redirects?cursor=...` (۵۰/seekمسیر)،`/{id}`،`/{id}/preview` (graphقفل‌شده)،`/{id}/history?beforePublication=...` (۲۰/seek)،`/{id}/revisions/{revisionId}`. cms.writeاضافی برای POSTوGET `/commands/{commandId}`create و`/{id}/commands/{commandId}` سایرعملیات/رسیدactorbound. ورودی strict:Action/Version/SourcePath/IsDemo/TargetPath/Status/RestoreRevisionId/Confirmed؛ مبدأ/isDemoفقطcreate؛versionبرایبقیه؛publish/restore/unpublishتأییدصریح وبدونtarget/statusارسالی. draftهدف/نوعnullable؛301پیش‌فرضنیست.

rootIdentityCmsSerializable/audit وactorUUID/hash/version/receiptاتمیک؛گیتgraphقبلhead وگیتcommandقبلآن؛saveفقطdraft. کلgraphمنتشرunionنمونه‌وواقعی بدونحلقه و≤۵hop؛restoreدرcommitدوبارهgraphجاری‌راکنترل‌می‌کند وdraftمحفوظمی‌ماند. تاریخچه immutable وDownدرصورتهررکوردسه‌جدولجدیدمتوقفاست. private/no-store/noindex/originstrict/body۱۶KiB/response۲۶۲KiB،cookieنبایدforwardیاSet-Cookieبرگردد. NextقبلوجودصفحهCMSlookupمحدودanonymous/no-store؛LocationفقطSHOP_PUBLIC_URLمعتبر،statusاصلیهرhopحفظ،نبودقانونعبورعادی،خرابیsource/schema/origin→503. CMS-REDIRECTS/STATUSمرجعپذیرشومحدودیت‌هاهستند.

### CREDIT-UPFRONT — پذیرش محلی۶۸

GET `/api/credit/orders/{orderId}/upfront` فقط summary مشتری مالک؛ GET `/api/admin/credit/orders/{ownerId}/{orderId}/upfront` و `/history?beforeSequence=` با FinanceMFA/finance.read؛ POST و GET `/commands/{UUID}` با finance.write. Actionصریح ConfirmReceipt/ConfirmNoUpfrontDue/RevokeConfirmation؛ OrderVersion/ScheduleVersion/Version، Reference/Note/OccurredAtUTC/Confirmed/AcknowledgedClosedOrder، بدون clientamount. مبلغ از quote/order محفوظ؛ manualattestation نه bankVerified/Paidنقدی/CanPay/CanFulfill. customerبدونمرجع/شرح/actor؛ تاریخچه append-only/DP وrootIdentitySalesCreditSerializable/audit/idempotency. 8Kبدنه/262Kپراکسی،private/no-store/noindex؛falseهایauthorityهموارهfalse. CREDIT-UPFRONT/STATUS/A77 شواهدند؛مجوزنهایی D35 و تأیید هرچک در ادامه‌اند.

### CHEQUE-APPROVALS — پذیرش محلی۶۹

GET `/api/credit/orders/{orderId}/cheque-approvals` owned/read-only/summaryبدونNote/مرجع/actor. FinanceMFA+finance.read GET `/api/admin/credit/orders/{ownerId}/{orderId}/cheque-approvals` و `/{chequeId}` و `/{chequeId}/history?beforeSequence=`؛ finance.write POST+GET `/{chequeId}/commands/{UUID}`. ActionApprove/Revoke،OrderVersion/ScheduleVersion/LedgerVersion/Versionnullable/Note/OccurredAtUTC/Confirmed/AcknowledgedClosedOrder؛بدونclientmoney. تأییدبههمانledgerheadمقید،هرحرکتگردشinvalidate،اصلاحگواهیهیچتغییرمالییاInventory/dispatchنمی‌دهد. AllChequesApprovedهمهخطواقعیومعتبرونهempty؛bankVerified/canPay/canFulfillfalse. 8Kbody/262Kproxy/private/no-store/noindex/originquerystrict/noCookie،DP/immutable/audit/rootIdentitySalesCreditSerializable/actorUUID/receipt. CHEQUE-APPROVALS/STATUS/A79 شواهدند؛مجوزنهاییD35درادامه.

### CHEQUE-REVIEW-HOLD — پذیرش محلی۷۰

FinanceMFA+finance.read GET `/api/admin/credit/review-hold-policy` و `/history?beforeRevision=`؛ finance.write POST+GET `/commands/{UUID}`. ActionEnableباMinutes۱..۶۰ یاDisableباMinutesnull،Versionnullable/Confirmedصریح؛body8K/response262K/private/no-store/noindex/originquerystrict/noCookie. rootIdentitySalesSerializable/audit/CAS/actorUUID/immutable revision+receipt. Readiness سفارش چکی وقتی فعال است reviewHoldPolicyنسخه/حداکثر می‌دهد؛ ثبت با ReviewHoldPolicyVersionدقیق، نتیجه/DetailاختیاریReviewHoldباquoteExpiry/PolicyRevision/deadlineimmutable. nullهادرJSONlegacyحذف می‌شوند. سیاست unset اصلی تغییری نمی‌دهد؛ تغییر بعدی deadline تاریخی را عوض نمی‌کند. لغو معمول سفارش اکنون هدرprivate/no-store/noindexدارد. مجوزنهاییD35هنوزساخته‌نشده؛ A81/STATUSمرجع‌اند.

### CREDIT-CLEARANCE — پذیرش و انتشار محلی۷۲

FinanceMFA+finance.read GET `/api/admin/credit/orders/{ownerId}/{orderId}/clearance` (شواهد/نسخه/preview/current/effective/capabilities) و `/history?beforeSequence=1..200`؛ finance.write POST+GET `/commands/{UUID}`. ورودی فقطActionApprove/Revoke،OrderVersion/Versionnullable/PreviewFingerprint/Note/Confirmedصریح،بدونمبلغیاproofبانکی. customerownedGET `/api/credit/orders/{orderId}/clearance` فقطخلاصه،بدونNote/actor/مرجعسند. nullهایقراردادصریح حفظ می‌شوند؛8Kbody/private/no-store/noindex/origin/querystrict/noCookie/responsebounded.

rootIdentitySalesCreditInventorySerializable/audit/owner→actorUUID/DPappend-only،receiptقبلCAS/expiry. اولینApproveفقطAwaitingPayment/unexpired/Active→CreditApproved/Allocated؛Refreshفقطگواهیتازه،Revokeفقطتوقفپیشdispatch. هرledgerMoveشواهدراstaleمی‌کند؛همانچکرویCreditApprovedدوبارهقابلتأییداست. WarehouseباICreditFulfillmentAuthorizationپیشpack/repack/dispatchبررسیزنده وdeliverتاریخچهٔارسالاست. Paid/VerifiedCashPaymentنقدیفعال نمی‌شوند. orderStateجدیدCreditApprovedوpaymentAvailabilityجاریcredit_manual_authorization؛receipt/linkایجادقدیمPending/AwaitingPaymentدست‌نخورده. CADHold/scopeمصرف‌شده/deadlineاحیا نمی‌شوند. mainجدول‌هایجدیدخالی وpolicyunsetاست؛A83/STATUSمرجع‌اند.


### CHEQUE-REPORT — source73 پذیرفته و با D36 محلی منتشر شد

`GET /api/admin/credit/cheque-report?from=YYYY-MM-DD&through=YYYY-MM-DD&state=All|Received|Deposited|CollectedReported|BouncedReported|Withdrawn|ReturnedToCustomer[&cursor=opaque]` فقطstaff_mfa+finance.read است؛ همهٔ سه فیلتر صریح، queryنامعلوم/تکراری رد، بازهٔ مدنی تهران حداکثر366روز شامل دو انتها، cursorDPمقیدactor/همانfilter/عمر15دقیقه، صفحه20ردیف DueDate/Idصعودی. actor/مرجعخصوصی/Note/contact درbodyنیست؛ OwnerGuid+ChequeSummary+CurrentOrderسروری است. registrationCutoff ورود سندهای تازه را ثابت نگه می‌دارد؛ ledger/currentOrder هرصفحه زنده تأیید می‌شوند و گزارش snapshotحسابداری نیست. stateRace409،cursorExpired409،invalid400،sourceخراب503؛ پاسخ private/no-store/noindex/noCookie،proxyحد262K. pageTotals فقطهمینصفحه، BigInteger aggregateممکن است ازlong بیشترشود وتمامrialرشته‌اند؛ CollectedReported/ReturnedToCustomer جزماندهٔنگهداری‌شده نیستند. bankVerified/canPay/canFulfill هموارهfalse؛ هیچPOST/permissionتازه/نوشتنمالی ندارد. طرح وپذیرش:CHEQUE-REPORT/A84.


### CREDIT-REMINDERS — دستی source75 پذیرفته، منتشر نشده

FinanceMFA+finance.read GET `/api/admin/credit/orders/{ownerId}/{orderId}/cheques/{chequeId}/reminders` و `/history?beforeSequence=1..3650`؛ finance.write POST/GET `/commands/{UUID}`. bodyفقطOrderVersion/LedgerVersion/PreviewFingerprint/Note/Confirmedصریح؛ روز/مبلغ/مقصد سروری و previewبه nextSequence/روزتهران ونسخه‌ها مقید. رویداد/receipt sealed immutable،summary شامل OrderVersion/PreviewFingerprint ونسخهledgerاست. فقطCreditApproved/Fulfilled+Held؛حدیک‌بارچک/روزمدنیتهران،خودکارنیست. rootIdentitySalesCreditNotificationsSerializable/audit،DP،replayقبلCAS،noBankVerified/CanPay/CanFulfill. private8Kbody/262Kproxy/noCookie/no-store/noindex.

مشتری فقطownedGET `/api/notifications/credit-reminders[?unreadOnly=true&cursor=...]` (50تایی)،GET `/unread-count` وPUT `/{id}/read` (bodyخالی)؛payloadشاملinternalIds/date/rial/civilDay/readAt،بدونprivateNote/actor/ref/financialproof. cursor scopeمستقل،readAtاولیه monotone باUPDLOCK/HOLDLOCK وDPقبلwrite،supportInbox/ticketId/countقبلی ثابت. source-acceptance وCHEQUE-REMINDERS/A87 مرجع،schedulerوmainpublication هنوزپذیرفته نیست.


### CREDIT-REMINDER-POLICY — source76 پذیرفته، منتشر نشده

staffMFA+finance.read GET `/api/admin/credit/reminder-policy` و `/history?beforeRevision=1..10000`؛ finance.write POST/GET `/commands/{UUID}`. InputفقطVersionnullable/Enabled/DayOffsets/SendAtnullable/Note/Confirmedtrue؛مرتبتامتمایز31offsetدر[-365,365]،ساعتcanonicalHH:mmتهران. Disableoffsets[]/SendAtnull. Currentnullصریحیعنیunset؛TimeZoneAsiaTehran/ChannelPrivateAccountInbox/WorkerEnabledواقعیمیزبان. append-onlyrowversion/offsetsrelational/DP/actorUUID/hash/replayقبلCAS/audit،page20،body8K/response262K/private/no-store/noindex/noCookie. history/receiptتاریخیباcurrentمتفاوتاست.

workerداخلی20candidate/60sبدونHTTPاجرادستییامقصدآزاد؛policyunset/off0send،sharedpolicygateتاcommit→ownergate→actorcommand،همانmanual75ودستینیزحدیکچک/روزتهران. ActorSYSTEM_CREDIT_REMINDER_V1بدونIdentityrole/login،auditCREDIT_CHEQUE_REMINDER_AUTOMATICوnoteمحافظت‌شدهpolicyid/version؛customerبدونآنها. روزجاافتادهbackfillنمی‌شود،tickفقطازساعتانتخابیدرروزهدف. جزئیات/شواهد CHEQUE-REMINDER-POLICY/A90.

### BLOG — source78 پذیرفته، اصلی73 و منتشرنشده

PublicGET `/api/content/blog/{fa|en}[?tag=slug&cursor=opaque]` و `/{slug}`؛هدرX-Sayman-Blog=1/no-store/noindex،missingواقعی404/خرابی503،page20/DPcursor15minمقیدlocale/tag/demo/cutoff. GET `/api/content/blog-sitemap/{locale}` و `/entries?page=1..50000` فقطmanifest/key باگیتpreview/indexingموجود. privateMFA+cms.read GET `/api/admin/blog-posts[?cursor=slug]`،`/{id}`،`/{id}/history?beforePublication=`،`/{id}/revisions/{revisionId}`؛cms.write POST/GET `/commands/{UUID}` برایCreate و`/{id}/commands/{UUID}`برایSave/Publish/Unpublish/Restore. fixedslug/IsDemo،versionCAS/confirmedصریح،draftHash/FirstPublishedAtصریح،authorKind/bylineعمومیFAEN/optionalcoveralts/tags<=8. body128KiB/response262KiB/noCookie/private/no-store/noindex/queryoriginstrict/actorreceipt/audit. BLOG/STATUS/A94 مرجع‌اند.

## علاقه‌مندی حساب — source80 پذیرفته، اصلی هنوز73

`GET /api/wishlist` و`PUT /api/wishlist` فقطcustomerJWT/Originمعتبر براینوشتن،بدونQueryیاOwnerورودی. PUT`{productIds:string[0..200],version:string|null}`؛شناسه‌هایکتاوالگوریتمCAS،same-setno-op،افزودنتازهفقطpublishedCatalog. پاسخ`{schemaVersion:1,ownerId,capacity:200,version:string|null,productIds:string[]}`؛versionnullحتماًصریح،IDsمرتب،unpublishedقدیمیپاکنمی‌شود. rootIdentitySalesCatalog+Audit؛`wishlist_version_conflict`409،`wishlist_product_unavailable`400،`invalid_wishlist`400،`wishlist_unavailable|wishlist_busy`503. BFFstrictbounded/no-store/noindex/no-cookie،GETبدونOriginمجازولیOriginارسالیبایدcanonicalباشد؛PUTOriginضروری. هیچقیمت/رزرو/خرید/اعلانازاینمسیرساختهنمی‌شود. WISHLIST/STATUS مرجعپذیرشوانتشارنداشتن‌اند.


### Multi-parcel fulfillment — source82, historical contract; current acceptance in STATUS

Private staff reads: `GET /api/admin/orders/{ownerId}/{orderId}/fulfillment?after=<positive decimal string>` (20 metadata rows), and `/fulfillment/parcels/{parcelId}` for the bounded immutable detail. Staff writes/read-back: `POST|GET /fulfillment/commands/{commandId}`; POST requires both sales.write and inventory.write plus staff MFA, exact owner/UUID body binding, canonical order/parcel versions, current inventory fingerprint, reason and explicit acknowledgment. Actions: pack/repack/void/dispatch/deliver. Command receipts are actor-bound DataProtection bytes; replay precedes mutable-state checks and has no second audit/stock effect.

Customer GET-only facade: `/api/orders/{orderId}/fulfillment` and `/api/orders/v2/{orderId}/fulfillment`, with optional canonical `after`, or `/fulfillment/parcels/{parcelId}`. Mode is none/single/parcels; old shipment contracts keep their shape and return409 shipment_contract_upgrade_required after the parcel workflow is selected. New installed routes return X-Sayman-Fulfillment-Contract: parcels-v1; an unmarked backend404 is503 at the new BFF, never an empty shipment. Packed/voided customer details hide all unit identifiers. All reads/errors/method rejection are private/no-store/noindex, proxies omit cookies and reject Set-Cookie. Detail/receipt budget4MiB; command input64KiB; historical line/warranty data comes from the original order. Parcel numbers and cursors are decimal strings, not JS Number.

The staff page includes ordered/packed/dispatched/delivered/remaining balances, original order lines, available devices and their packed claims, DispatchCount and ActiveParcelCount; active plus dispatched max64. The last actual dispatch must contain every remaining reserved item. Packing/repacking/voiding has no Inventory counter effect; actual dispatch uses the internal partial ledger, and only final customer delivery makes the order Fulfilled. Personal cheque remaining-authority commands require acknowledgedPartialDispatch=true and a private note; false is omitted to preserve legacy financial canonical JSON/receipts. Fresh financial authority bounds the actual hand-off timestamp, and upfront correction is forbidden after the first ledger hand-off. This API is source implementation, not main deployment or a completed acceptance claim.

### Private digital and mixed fulfillment — D57

Staff: `GET /api/admin/orders/{ownerId}/{orderId}/fulfillment/digital` returns balances and content-free history under staff MFA + sales.read + inventory.read. `POST|GET /.../digital/commands/{commandId}` additionally requires sales.write and inventory.write. POST accepts exact ownerId/commandId/orderVersion/inventoryFingerprint/reason/acknowledge/lines; each line has lineKey and one text per quantity. The shared Identity/Sales/Inventory/Credit Serializable transaction includes persistent receipt, stock dispatch, immutable encrypted content and metadata-only audit. All reads, including receipt, use the canonical owner gate and transaction. There is no staff plaintext endpoint.

Customer GET-only: `/api/orders/{orderId}/fulfillment/digital` and `/api/orders/v2/{orderId}/fulfillment/digital` return metadata. `/{deliveryId}/content` appended to either returns only that authenticated owner's explicitly requested batch. The installed contract is `X-Sayman-Fulfillment-Contract: digital-v1`. Proxies use exact paths, no queries, no forwarded cookies, reject Set-Cookie, private/no-store/noindex and bounded JSON. Content and receipts have a512KiB response budget, complete metadata history16MiB, POST512KiB. New order/quote capacity is bounded before reservations; details and current acceptance are in DIGITAL-FULFILLMENT/STATUS.

The existing parcels-v1 page may include digitalDispatchCount (only when positive) and digitalLineKeys (only when present). DispatchCount is the shared total; physical dispatches are DispatchCount minus digitalDispatchCount. ActiveParcelCount and packed quantities concern physical lines. Clients reject cross-kind packing and validate counts independently. Original physical-only JSON and historical receipts retain their shape.

CMS D57: Save/Publish/Restore recheck issued catalogue image IDs through the shared Ready-reference contract. Page/blog historical receipts and Unpublish remain available without requiring today's asset readiness. D67 supersedes the earlier password-only restriction: draft requires one desired email/password, username/password or mobile-OTP method. Publish/restore and SMS reconfiguration validate effective live availability and current-customer continuity; Sandbox cannot prove customer identity. Password reset remains ineffective.

## D58 — تکمیل اطلاعات دفتر نشانی (در حال پذیرش)

PUT `/api/addresses/{id}` علاوه بر فیلدهای قبلی، `details` می‌گیرد: `geographyVersion="iran-1404-v3.1.2"`, `provinceId`, `countyId`, `cityId:string|null`, `localityKind:"city"|"other"`, `plaque`, `unit`, `latitude:number|null`, `longitude:number|null`. شناسه‌های محل رشتهٔ رقم لاتین و مستقل از money هستند. برای city، شناسه و نام delivery باید دقیقاً به همان استان/شهرستان تعلق داشته باشند؛ برای other، cityId=null و نام محل دستی همراه شهرستان معلوم است. پلاک۱..۲۰/واحد۰..۱۰ نویسه، بدون control/bidi embedding و ارقام نرمال‌شده؛ جفت مختصات اختیاری finite در bounding box مستند ایران. نشانی کامل پس از اضافه‌شدن ساختمان حداکثر۲۰۰۰نویسه است. نشانی/کدپستی/همراه همچنان لازم‌اند؛ نقشه جای آن‌ها را نمی‌گیرد و اعتبارسنجی قالب، تأیید سامانهٔ پست یا مالکیت شماره نیست.

SavedAddressData.details برای دادهٔ legacy حذف می‌شود؛ ciphertext v1 بدون این فیلد قابل‌خواندن است. نوشتن تازه به details معتبر نیاز دارد؛ update با نسخهٔ جاری، دادهٔ قدیمی را تکمیل می‌کند. جدول، مالکیت، CAS، purpose کلید و schemaVersion1 ثابت‌اند. جزئیات تازه رمز‌شده و بخشی از fingerprint/replay هستند. مختصات در دفتر خصوصی می‌ماند؛ قرارداد سفارش تغییر نمی‌کند و کپی در فرم سفارش پلاک/واحد و در حالت دستی نام شهرستان را به متن تحویل اضافه می‌کند. [ADDRESS-BOOK](ADDRESS-BOOK.md) منبع/مجوز داده و مرز نقشه/پذیرش را شرح می‌دهد.

## D67 — قرارداد ورود پیامکی و تنظیمات محرمانهٔ مدیر

`POST /api/auth/otp` با `{mobile,requestId}`: شمارهٔ معتبر ایران به+989… نرمال می‌شود؛ requestId، GUIDبدونخط‌تیره/۳۲رقمhexکوچک است. پاسخ مستقل `{schemaVersion:1,challengeId,expiresAt,resendAt,delivery}` باdelivery=accepted|unknown، فاقدکد/نشست/شناسهٔ مشتری است. پذیرش provider به معنی تحویل نیست. یک requestId در نسل جاری/مهلت معتبر، همان challenge را می‌دهد و HTTPارسال دوباره انجام نمی‌دهد؛ با payload متفاوت رد می‌شود. درقطع پاسخ، فقط بررسی صریح همان درخواست مجاز است؛ retryارسال خودکار وجود ندارد.

`POST /api/auth/otp/verify` با `{challengeId,code}`، کد۶رقمیASCII را با deadline۳۰۰ثانیه/۵تلاش/نسل جاری/مصرف بررسی می‌کند. زمانresend۶۰ثانیه است؛ سقف پایدارهرشماره۵درساعت/۲۰درروز وکل۱۰۰درساعت/۱۰۰۰درروز است. تأیید و ساخت حساب/نشست/audit اتمیک‌اند؛ replayنشست دیگری نمی‌سازد. مشتری جدید بدونرمز/بدوننقشکارکنان فقطپسازاثباتشماره وregistrationمنتشرشده ساخته می‌شود؛ MFAمشتری موجود حفظ است. پاسخ، قرارداد عادیcustomer session یاmfa_pending است؛ refreshفقطHttpOnlycookie است. کارکنان و شمارهٔ تأییدنشده/مبهم وارد این مسیر نمی‌شوند.

خطاها: invalid_otp400، otp_invalid401، otp_expired410، otp_cooldown/otp_rate_limited429، otp_unavailable/otp_delivery_rejected503، otp_configuration_conflict409. start/verifyبدنهٔ ناشناخته، query وheaderپنل را رد می‌کنند. خطا/بدنهٔ نامعتبر همprivate,no-store,noindex,Vary:Origin,Cookie,Authorization دارند؛ کد/کلید/شماره درdetailنمی‌آید.

`GET /api/admin/sms/settings` و`PUT`همانمسیر بهAdministrator+MFAکامل/currentstamp،staff.write وOriginپنل نیاز دارند؛ queryمجازنیست. GET/پاسخPUTفقطschemaVersion/version/provider/enabled/mode/templateId/codeParameterName/nameParameterName/genericName/keyConfigured/otpLifetimeSeconds/resendAfterSeconds/maxAttempts/availabilityمی‌دهند. کلید/پسوند/هشآنبرنمی‌گردد. ورودیPUTهمینتنظیماتقابل‌نوشتن باversionجاری(nullدرایجادیاbase64rowversion۸بایتی)،requestId۳۲hex،apiKeyAction=keep|replace|clearاست؛ فقطreplaceفیلدapiKeyدارد. providerفعلاًsmsIr،liveباtemplate170274/CODE/NAME مطابقمالک؛sandboxفقطDevelopmentبا123456/CodeبدونNAMEاست وورودواقعینمی‌دهد.

کلیدباDataProtection/keyRevision/purposeمستقل وfingerprint/receiptفرمانهمرمزمی‌شوند. CASناموفقیاpayloadمتفاوتازهمانrequestId409است؛ replayدقیقهمانرسیدرامی‌دهد. ذخیرهٔموفقتازهکدهایقدیمیراSupersedeمی‌کند. پاک‌کردنکلید/خاموش‌کردنارسالیاpublish/restoreCMSاگرآخرینراهورودمشتریراببندد،همراهaudit/همهٔتغییراتrollbackمی‌شود. تنظیماتخارجCMSهستند؛ هیچرازدرپیش‌نویس/تاریخچهمنتشرنمی‌شود.

## مرکز پیامک D69 — فعال روی نسخهٔ محلی اصلی۹۲/۲۴۰

`GET/PUT /api/admin/sms/workspace` پیکربندی schemaVersion1/CAS/requestId و کلیدهای write-only چند اتصال؛ `GET /api/admin/sms/messages?state=&kind=&cursor=` گزارش خصوصی۵۰تایی و `POST /api/admin/sms/messages/test` فرمان دارای requestId/templateId/mobile/confirmed=true است. همه به staff_mfa،staff.write و بررسی دوبارهٔ مدیرکل جاری نیاز دارند؛ تغییرها در تراکنش audit مشترک و با Origin پنل و X-Sayman-Client=admin هستند. GETworkspace query نمی‌پذیرد؛ گزارش فقط سه فیلتر مشخص دارد. نامشخصبودن ارسال مجوز تکرار خودکار نیست. [راهنما](SMS-WORKSPACE.md).

D69 local acceptance (schema92/240): the SMS workspace endpoints and four-tab admin are active. OTP defaults above are configurable in the workspace and are snapshotted per challenge; the legacy settings PUT cannot overwrite an existing workspace. SMS.ir configuration was retained. Kavenegar transport has contract/SQL acceptance; live credentials/template and an explicit owner test remain external dependencies. See [SMS-WORKSPACE](SMS-WORKSPACE.md) and [accepted release](../artifacts/checks/d69-final-acceptance.json).

## D85 — رویدادهای مدیریتی

`GET /api/admin/audit/events` به نشست MFA کارکنان و مجوز `audit.read` نیاز دارد. فیلترهای `q` (متن عملیات، مرجع، شناسه یا نام فعلی عامل)، `actor`، `trace`، پیشوندهای `action` و `resource` و زمان UTC با `from` (شامل) و `before` (غیرشامل) روی کل سابقه اعمال می‌شوند. `trace` به بزرگی و کوچکی حروف حساس است. پارامترهای تکراری یا ناشناخته رد می‌شوند.

پاسخ خصوصی `schemaVersion: 1` تا ۵۰ رویداد نزولی دارد. `id` و `nextCursor` رشتهٔ اعشاری‌اند. پاسخ کد و مسیر اصلی، زمان، شناسهٔ عامل و پیگیری، نام فعلی عامل در صورت داشتن نقش کارکنان، و در رویدادهای مربوط به همکار، شناسه و نام فعلی همان حساب را می‌دهد. محتوا از رکورد فعلی حساب برای نام و از سابقه برای جزئیات عملیات خوانده می‌شود. اطلاعات تماس و بدنهٔ درخواست در این قرارداد ارائه نمی‌شوند. مسیر قبلی `/api/admin/audit` برای کلاینت قبلی باقی است.

## D90 — انتشار مستقل شبکه‌های اجتماعی

فرمان موجود `POST /api/admin/content/site/{locale}/publish` مقدار اختیاری `section: "socialLinks"` را همراه نسخهٔ `version` می‌پذیرد. به نشست `staff_mfa` و `cms.write`، نسخهٔ عمومی قبلی و تغییر ذخیره‌شده نیاز دارد. بخش شبکه‌های اجتماعی از پیش‌نویس همان زبان به نسخهٔ عمومی منتقل می‌شود. سرور کل نتیجه را اعتبارسنجی و نسخه و ممیزی را اتمیک ثبت می‌کند. پاسخ موفق `204` است. `restoreRevisionId` با انتشار بخش قابل ترکیب نیست. فرمان کامل و بازگردانی از همان قرارداد پیشین استفاده می‌کنند.

## D91 — وضعیت تنوع در کاتالوگ عمومی

`POST /api/catalog/{locale}/search` و `POST /api/catalog/{locale}/facet-values` فیلد اختیاری `condition` و `GET /api/catalog/{locale}/filters` پارامتر هم‌نام می‌پذیرند. `used` تنوع دارای گزارش سلامت جاری و `new` تنوع بدون گزارش را انتخاب می‌کند. در نبود فیلد، دامنهٔ API طبق قرارداد پیشین شامل هر دو است. وضعیت قبل از انتخاب تنوع، فیلتر و شمارش اعمال می‌شود. در فروشگاه، مرور عادی به‌صورت پیش‌فرض نو است، مسیر `/catalog?condition=used` کارکرده است و جست‌وجوی متنی آزاد هر دو را پوشش می‌دهد.

در D92 کلید بولی `appearance.showUsedProducts` در سند منتشرشدهٔ همان زبان، دامنهٔ عمومی را کنترل می‌کند. مقدار پیش‌فرض روشن است. در حالت خاموش، درخواست صریح `condition=used` پاسخ ۴۰۴ می‌گیرد و جست‌وجو، فیلتر، واکشی جزئیات، مرور آفلاین و نقشهٔ سایت بر اساس تنوع‌های نو هستند. دسترسی‌های داخلی و سوابق سفارش از قراردادهای جداگانه استفاده می‌کنند.
