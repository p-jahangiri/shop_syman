# درخواست تأمین بازار — قرارداد سورس۲۸

2026-10-24؛ برش نخست بر اساس D23/D28، A32 و COMMERCE-EXTENSIONS پیاده شده است. این فایل جای طرح اولیه را می‌گیرد. **اصلی و سورس schema۲۸ هستند؛ این برش پس از SQL، مرورگر متصل و بکاپ تازه به‌صورت محلی منتشر شده است.** وضعیت لحظه‌ای اجرا در [STATUS](STATUS.md) است. MARKET-02 و کل پروژهٔ PDF ناتمام‌اند.

## رفتار و مرز برش

مهمان و عضو مدل منتشرشدهٔ بازار را با تعداد در SQL انتخاب می‌کنند؛ صفحهٔ سبد بخش غیرقابل‌پرداخت «درخواست تأمین» دارد. ورود، انتخاب مهمان را با همان عملیات ادغام سبد به حساب می‌برد. مشتری درخواست را ثبت، فهرست/جزئیات/تاریخچه را می‌خواند و در Submitted/Reviewing لغو می‌کند. مدیر با sales.read درخواست‌ها را می‌بیند و با sales.write شروع بررسی یا عدم امکان تأمین با پیام عمومی را ثبت می‌کند. ثبت تأمین **سفارش فروش، پرداخت، SKU، قیمت فروش یا رزرو موجودی ایجاد نمی‌کند**؛ `requestOnly:true` و `canPay:false` صریح‌اند.

پیشنهاد نسخه‌دار مدیر با SKU/پیکربندی واقعی و قیمت/شرایط، پذیرش/رد مشتری، انقضا و تبدیل idempotent به خرید/checkout هنوز پیاده نشده‌اند. endpoint موفق ساختگی ندارند. منوی CMS بازار، facet کامل و سایر کارهای MARKET-02 باقی‌اند؛ اتصال زندهٔ هلو و providerهای مالی/پیامک/ارسال از این برش نتیجه نمی‌شوند.

## مالکیت، سبد و تراکنش

| مسئولیت | مالک/قرارداد |
|---|---|
| مدل، ترجمه، ویژگی/واحد/گزینه و تشخیص عرضهٔ عمومیِ موجود | Catalog / `ICatalogSourcingReader`؛ خواندن موجودی از view Inventory |
| انتشار، منبع/مشاهده، قیمت مرجع و fingerprint انتخاب | Market / `IMarketSourcingReader` |
| هویت/قفل/نسخه و دو مجموعهٔ انتخاب خرید/تأمین | Sales / `ISourcingCart`، Carts/CartLines/CartSourcingLines |
| درخواست تاریخی، snapshot رابطه‌ای، رویداد و receipt | Market |
| principal، transaction چندماژولی، audit و حفاظت یادداشت | composition root در Shop.Api |

هیچ ماژول DbContext ماژول دیگر را دریافت نمی‌کند. `SourcingTransactionCoordinator` مسیرهای ترکیبی مشتری را با transaction مستقل Serializable در Sales و enlist کردن Catalog/Inventory/Market هماهنگ می‌کند؛ داخل transaction خرید فعلی تو در تو اجرا نمی‌شود. تغییر مدیر با فیلتر audit موجود در همان transaction انجام می‌شود؛ شکست event/receipt/audit تغییر دامنه را rollback می‌کند.

یک cookie و یک مالک سبد حفظ شده است: `sayman_cart` با Path فعلی `/api/cart`، مالک عضو از JWT و rowversion مشترک هشت‌بایتی/Base64 طول۱۲. ownerId/cartId/token یا hash مهمان از body انتخاب نمی‌شوند؛ Authorization نامعتبر به مهمان تنزل نمی‌کند. merge فعلی هر دو مجموعه را اتمیک ادغام، یک tombstone ثبت و سپس cookie مهمان را حذف می‌کند. تکرار merge دوباره جمع نمی‌کند و overflow رد می‌شود؛ clipping ندارد. پاسخ قدیمی خرید حفظ شده و UI تأمین را جدا بازخوانی می‌کند.

تغییر هر مجموعه نسخهٔ مشترک را عوض و quote خرید قبلی را stale می‌کند. مصرف سفارش فقط CartLines و submit تأمین فقط CartSourcingLines را مصرف می‌کند. ترتیب قفل submit: owner→actor/operation/command→قفل مشترک cart→خواندن eligibility؛ transition مشتری owner→command→request و مدیر command→request است. receipt قبل از اعتبارسنجی سبد مصرف‌شده خوانده می‌شود.

## eligibility و snapshot

افزودن/افزایش فقط برای listing منتشرشده، مدل eligible و نمونهٔ مجاز محیط انجام می‌شود. Hidden/مدل یا دسته/برند نامعتبر محتوای تازهٔ خصوصی نمی‌دهد؛ کاهش/حذف انتخاب قبلی همچنان ممکن است. `unknown`، `stale` و گزارش منبع `unavailable` مانع **استعلام تأمین** نیستند و وعدهٔ موجودی محسوب نمی‌شوند.

`HasAvailableStoreOffer` یعنی مدل منتشرشدهٔ موعدرسیده، دسته/برند فعال و حداقل تنوع فعال با `Available>0` از `inventory.AvailableStockV1`. صرف OnHand در SKU خصوصی/آینده/غیرفعال کافی نیست. چنین مدل موجودی از فهرست/جزئیات عمومی بازار کنار می‌رود؛ در انتخاب قبلی `now_in_store` افزایش/submit را متوقف می‌کند. انتخاب خودکار حذف یا به خرید تبدیل نمی‌شود.

submit فقط `{requestId,cartVersion,expected:[{listingId,fingerprint}],note?}` می‌گیرد. expected دقیقاً مجموعهٔ انتخاب فعلی با fingerprint سرور برای نسخهٔ listing/model/metadata/مشاهده است؛ مشتری نام/قیمت/مشخصات تاریخی تعیین نمی‌کند. تغییر منبع/ویژگی/انتشار/تازگی یا موجودشدن فروشگاه تعارض409 می‌دهد. snapshot سروری شامل FA/EN نام/دسته/برند/شرح/تصویر، ویژگی‌های قابل نمایش در مشخصات یا مقایسه با نوع/واحد/گزینه، و منبع/تاریخ/قیمت مرجع است؛ ویرایش بعدی کاتالوگ آن را تغییر نمی‌دهد.

یادداشت حداکثر۵۰۰ کاراکتر متن ساده با DataProtection purpose نسخه‌دار و owner+request حفاظت می‌شود. فقط detail صاحب حساب/مدیر مجاز آن را باز می‌کند؛ summary/receipt/log یادداشت ندارند. حفظ key ring برای restore لازم است. DTO رویداد actorKind دارد و شناسهٔ کارکنان را به مشتری نمی‌دهد؛ summary مشتری ownerId ندارد و summary مدیر دارد.

## جداول و migration

| migration سورس | تغییر |
|---|---|
| ۲۶ / `20261023201055_MarketStoreAvailability` | ستون HasAvailableStoreOffer در view Catalog؛ Down projection قبلی را بازمی‌گرداند |
| ۲۷ / `20261023201115_CartSourcingLines` | PK داخلی `(CartId,ListingId)`، FK به Carts با Cascade و CHECK تعداد |
| ۲۸ / `20261023201151_SourcingRequests` | درخواست/ردیف/تصویر/ویژگی/گزینهٔ snapshot، رویداد و receipt در Market |

درخواست UUID N32/rowversion، identity برای مرجع `SR-…`، owner/locale/cartVersion/hash و ContainsDemo دارد. UNIQUE `(OwnerId,SubmitRequestId)` و `(CartId,SubmittedCartVersion)` دفاع مصرف تکراری‌اند. `SourcingRequestLines/Images/Attributes/Options` رابطه‌ای با FK داخلی Market و CHECK نوع/مقدارند. event append-only و receipt دارای PK `(ActorId,Operation,RequestId)`، TargetId، hash و ResultJson محدود است. FK میان Sales/Market/Catalog افزوده نشده است.

**در دیتابیس تازه Inventory باید پیش از Catalog migrate شود**؛ view تازه به `inventory.AvailableStockV1` وابسته است. Program، SqlFixture و UiHarness ترتیب Identity→Payments→Credit→Cms→Inventory→Catalog→Sales→Market دارند. این ترتیب فقط bootstrap schema است و ترتیب قفل دامنه را عوض نمی‌کند. شکست نخست targetedSQL از همین وابستگی و پیش از تست دامنه بود؛ لاگ شکست محفوظ و اجرای اصلاح‌شده موفق است. سه model check بدون تغییر جامانده و SQLهای idempotent Catalog/Sales/Market تولید شده‌اند؛ [گزارش EF](../artifacts/checks/sourcing-ef-summary.json) و [راهنمای SQL](../backend/sql/README.md).

## API بومی و دسترسی

ورودی‌ها unknown member را رد می‌کنند؛ listing/request شناسهٔ غیرصفر N32، فرمان UUID غیرصفر D یا N و نسخه Base64 طول۱۲ است. مسیرهای مشتری policy `customer` و مدیریت نشست کامل/MFA و مجوز جدول دارند. Origin برای mutation الزامی/مجاز است؛ GET با Origin ارسال‌شده نیز تطبیق داده می‌شود.

| مسیر | قرارداد/مجوز |
|---|---|
| GET `/api/cart/{fa|en}/sourcing` | ناشناس/عضو؛ schema1، locale، version یا null، capacity۲۴، lines، hasIssues، requestOnly/canPay؛ بدون total مالی |
| PUT همان مسیر | `{version,lines:[{listingId,quantity}]}`؛ replace فقط تأمین، همان cookie/نسخه؛ بدنهٔ بی‌تغییر revision را عوض نمی‌کند ولی eligibility تازه می‌خواند |
| POST `/api/cart/{fa|en}/merge` | endpoint قبلی؛ هر دو بخش اتمیک، پاسخ خرید فعلی محفوظ |
| POST `/api/cart/{fa|en}/sourcing/submit` | customer؛ بدنهٔ submit بالا؛ نخست201/replay200؛ Location به detail بومی |
| GET `/api/sourcing/requests` | صاحب حساب؛ state=all یا چهار وضعیت، query/cursor؛ صفحه۲۰، جدیدترین اول |
| GET `/api/sourcing/requests/{id}` | صاحب حساب؛ غایب/متعلق به دیگری404 یکسان؛ detail با note و snapshot |
| GET `/api/sourcing/requests/{id}/events` | صاحب حساب؛ صفحه۲۰/cursor، Id صعودی؛ صفحهٔ بعد رویدادهای بعدی است |
| POST `/api/sourcing/requests/{id}/cancel` | customer؛ `{requestId,version}`؛ Submitted/Reviewing→Cancelled |
| GET `/api/sourcing/requests/commands/{submit|cancel}/{commandId}` | customer؛ receipt همان actor؛ عملیات مدیر403 |
| GET `/api/admin/sourcing/requests` | sales.read؛ state/query/cursor، صفحه۵۰/seek |
| GET `/api/admin/sourcing/requests/{id}` | sales.read؛ detail خصوصی و ownerId در summary |
| GET `/api/admin/sourcing/requests/{id}/events` | sales.read؛ صفحه۵۰، Id صعودی، cursor مقید به target |
| POST `/api/admin/sourcing/requests/{id}/review` | sales.write؛ `{requestId,version}`؛ Submitted→Reviewing |
| POST `/api/admin/sourcing/requests/{id}/unavailable` | sales.write؛ `{requestId,version,reasonCode,publicMessage}`؛ Submitted/Reviewing→Unavailable؛ reason حروف کوچک/underscore و پیام عمومی الزامی |
| GET `/api/admin/sourcing/requests/{id}/commands/{review|unavailable}/{commandId}` | sales.write؛ actor+operation+target؛ عملیات مشتری403 |

mutation/receipt schema1: `{id,reference,state,version,eventId,at,replayed,requestOnly:true,canPay:false}`. detail: `{schemaVersion,summary,note,lines,canCancel,canReview,canMarkUnavailable,requestOnly,canPay}`. فهرست/رویداد `{schemaVersion,pageSize,items,nextCursor}` با nextCursor صریحاً null یا رشته‌اند. مرجع/وضعیت/نسخهٔ receipt **تاریخیِ زمان فرمان** هستند؛ GET detail حالت جاری را می‌دهد و UI نسخهٔ receipt را برای ویرایش جاری اعمال نمی‌کند.

## مبلغ، حدود و محرمانگی

- مبلغ مرجع nullable، مثبت و صحیح ریال در SQL bigint/CLR long است و در JSON **رشتهٔ ده‌دهی** می‌آید؛ null با صفر جایگزین و در جمع قابل پرداخت وارد نمی‌شود. JavaScript از BigInt استفاده می‌کند. eventId/Id رویداد bigint و شمارهٔ identity داخل reference رشته‌اند. Number ویژگی decimal(28,8) رشته است؛ صفر، Bool=false و null مستقل حفظ می‌شوند.
- حداکثر۲۴ انتخاب و تعداد۱–۱٬۰۰۰٬۰۰۰؛ هر مدل حداکثر۲۴ تصویر،۶۴ ویژگی و۶۴ گزینهٔ هر ویژگی. note/پیام۵۰۰، query۱۲۰ کاراکتر/۸واژه، cursor۲۰۰ و صفحه۲۰مشتری/۵۰مدیر. cursor فهرست به owner/state/query و رویداد به owner/target مقید است.
- body غیرGET تأمین حتی chunked حداکثر۱۶KiB؛ cart حداکثر۲MiB UTF-8؛ snapshot پیش از INSERT حداکثر۵۱۲KiB منهای۸KiB فضای envelope و detail حداکثر۵۱۲KiB. تجاوز خطاست و truncate ندارد؛ شکست بعد از تغییر سبد نیز transaction را rollback می‌کند. ResultJson رسید حداکثر۱۶KiB UTF-16 و ISJSON است.
- سقف فنی درخواست باز owner پیش‌فرض۲۰ با `Sourcing:MaxOpenRequestsPerOwner` در بازه۱–۱۰۰۰؛ فقط Submitted/Reviewing شمرده می‌شوند. این سقف سیاست مالی نیست و در DTO سبد به‌عنوان capacity درخواست باز معرفی نشده است. limiter سبد۱۲۰ و requests۳۰ در دقیقه بر sub یا IP است؛ submit زیر limiter سبد است.
- IsDemo/ContainsDemo تا snapshot/receipt منتقل و خارج Development در خواندن/انتخاب/فرمان/receipt بسته می‌شود. restore توسعه مجوز فروش نمونه در تولید نمی‌سازد.
- API بومی no-store است. Next BFF پاسخ خصوصی `Cache-Control: private, no-store`، `Vary: Cookie, Authorization` و noindex/nofollow دارد؛ worker مسیر خصوصی sourcing/account/cart/checkout را cache نمی‌کند. یادداشت/token/secret سبد نباید log شوند.

## تکرار فرمان و قطع پاسخ

receipt پایدار actor+operation+UUID و hash بدنهٔ canonical دارد. submit همان UUID/body حتی پس از مصرف سبد یا تغییر وضعیت، نتیجهٔ اولیه با `replayed:true` می‌دهد؛ بدنهٔ متفاوت409 است. transition نیز قبل از نسخهٔ جاری receipt را می‌خواند؛ دو تغییر رقیب فقط یک event موفق دارند. مدیر دیگر حتی با sales.write رسید actor قبلی را نمی‌خواند؛ lookup مدیر به target مسیر نیز مقید است. عملیات خارج از scope مشتری/مدیر403؛ غایب/actor دیگر/target ناهماهنگ404 است.

**404 رسید به معنی خاتمهٔ فرمان در حال اجرا نیست.** پاسخ نامعلوم همان UUID/body را برای retry دستی نگه می‌دارد؛ فرمان تازه تا تعیین تکلیف ساخته نمی‌شود. receipt موفق نتیجهٔ تاریخی را روشن و سپس detail تازه خوانده می‌شود. خطای بعدی۴xx ابهام نخست را پاک نمی‌کند.

journal پنل فقط RAM و مقید به حساب است؛ ناوبری حفظ و logout/تغییر حساب پاک می‌کند. پس از reload، UUID برای lookup دستی لازم است. فروشگاه نیز journal مالک‌محور RAM، قفل مشترک cart و guard پاسخ حساب قبلی دارد؛ یادداشت/فرمان در localStorage ذخیره نمی‌شود. مرورگر مشتری با حساب مصنوعی همان GUID QA و SQL واقعی پذیرفته شده و منابع موقت پاک شده‌اند.

## BFF و رابط سورس

Next همان مسیرهای cart/sourcing و sourcing/requests را با allowlist صریح عرضه می‌کند: body۱۶KiB، پاسخ۲MiB، deadline۲۰ثانیه، UTF-8/schema سخت‌گیرانه، redirect ممنوع و بدون fallback نمونه. فقط cart cookie فعلی forward و درخواست خصوصی bearer می‌خواهد. BFF فهرست/رویداد فعلاً فقط cursor می‌پذیرد؛ state/query API بومی هنوز از BFF مشتری عبور داده نمی‌شوند. صفحه‌های FA/EN `/sourcing` و `/sourcing/[id]`، انتخاب بازار، بخش cart و پیوند حساب در سورس هستند.

## پذیرش و باقی‌مانده

- **۵۰۲/۵۰۲ واحد،۳۰/۳۰ SQL هدف تأمین و کل۱۹۳/۱۹۳ SQL واقعی** با صفر fail/skip موفق‌اند؛ فایل‌های `sourcing-units`، `sourcing-targeted-sql` و `sourcing-full-sql` در artifacts/checks دارای log/TRX هستند. پوشش: ادغام/مالکیت دو بخش، نسخه/رقابت/مصرف، snapshot تایپ‌دار، now_in_store، rollback رسید/audit، مجوز/demo/pagination. SQL روی MacARM/Rosetta شاهد native Linux/بار تولید نیست.
- هشت پاسخ واقعی SQL از **یک چرخهٔ درخواست** با decoder فروشگاه پذیرفته‌اند؛ پنج نوع ویژگی، صفر/false، واحد FA/EN و قیمت9007199254740993 رشته‌ای؛ [wire8](../artifacts/checks/sourcing-wire-acceptance.json). fact snapshot پس از اصلاح capture به‌تنهایی۱/۱ دوباره موفق شد. چهار decoder مدیریت روی page/detail/events/receipt واقعی موفق‌اند؛ [wire4](../artifacts/checks/sourcing-wire/admin-report.json). این‌ها جای پذیرش مرورگر نیستند.
- پنل۷۲ تست/typecheck/build ایزوله و فروشگاه۱۵۸ تست/typecheck/build ایزوله موفق‌اند.۱۷ HTTP عمومی/بی‌هویت روی candidate متصل به GUID QA موفق‌اند؛ [HTTP](../artifacts/checks/sourcing-storefront-http.json). ۲۰ smoke فقط‌خواندنی پس از انتشار اصلی۲۸ نیز موفق‌اند؛ sourcing-main28-public-smoke.json.
- **مرورگر مدیریت با حساب/MFA تولیدشدهٔ خود QA پذیرفته شد:** فهرست/جزئیات/موبایل؛ دو پاسخ موفق upstream بررسی عمداً قطع شدند، unknown→ناوبری هلو/بازگشت با همان UUID→رسید Reviewing→Unavailable با پیام عمومی. [قطع پاسخ](../artifacts/checks/sourcing-admin-response-loss.json)، تصاویر `sourcing-admin-{detail-desktop,detail-mobile,list-mobile,unknown}.png` و [شاهد SQL](../artifacts/checks/sourcing-admin-sql-proof.json): یک درخواست هدف،۳رویداد/۳رسید، فقط۱رسید review و صفر Orders/Reservations در QA. هیچ credential/MFA مالک مصرف نشد.
- **مرورگر مشتری با SQL واقعی پذیرفته شد:** انتخاب مهمان و کالای خرید→ورود/ادغام دو بخش، submit/پیگیری/لغو، FA/EN/mobile بدون overflow، سبد فقط تأمین و حفظ کالای خرید پس از مصرف تأمین. دو پاسخ موفق submit و دو پاسخ موفق cancel پس از commit قطع شدند؛ همان UUID در retry/ناوبری محفوظ و receipt بازیابی شد. SQL هر هدف یک درخواست،۲event/۲receipt و صفر Order/Reservation را ثابت کرد؛ sourcing-customer-sql-proof.json.
- یک ایراد واقعی UI در همین QA اصلاح شد: بازیابی receipt لغو فرم/وضعیت قدیمی را نگه می‌داشت. receipt اکنون فقط نتیجهٔ تاریخی را روشن می‌کند و برای همان owner/target، GET detail/history تازه می‌خواند، read قدیمی را abort و تأیید/error قدیمی را پاک می‌کند. هدف دیگر reset نمی‌شود؛ اگر GET تازه شکست بخورد، detail قابل عملِ قدیمی باقی نمی‌ماند. سه regression و سناریوی تازهٔ متصل SR-3، Cancelled و صفر دکمهٔ لغو/retry قدیمی را **بدون refresh دستی** پذیرفتند؛ sourcing-recovery-sql-proof.json و تصویر sourcing-recovery-accepted-mobile-fa.png.
- **انتشار محلی۲۸ پذیرفته است:** بکاپ نهایی pre28-release از اصلی۲۵ در نبود writer با COPY_ONLY/CHECKSUM/VERIFYONLY و کپی خصوصی key ring بدون parse؛ سپس migration۲۶–۲۸، artifact مستقل API/Next و پنل با index اتمیک/assetهای قبلی. sourcing-main28-state.json حفظ تعداد کاربران، hash تمام قیمت/SKU/compareAt، تعداد و جمع مانده/رزرو و hash/revision CMS، DBCC PHYSICAL_ONLY صفر و۳ نمونهٔ بازار قبلی را تأیید می‌کند. صفر دادهٔ درخواست/سبد/receipt QA کپی شده؛ تنظیم سفارش موقت صفر/خاموش و Redis چت exited است. همهٔ دیتابیس‌های آزمون و private key/credential QA پاک شدند؛ runtime/PID جاری در STATUS است. restore کامل schema۲۸ و production/offsite/native Linux از این شواهد نتیجه نمی‌شوند.

پس از این برش، پیشنهاد/قبول/تبدیل MARKET-02، دست‌دوم، نظر/مقایسه، دریافت هلو و باقی PDF ادامه دارند. سیاست‌های هزینه/مالیات/چک/گارانتی و providerهای واقعی هنوز تصمیم/قرارداد بیرونی می‌خواهند؛ این سند آن‌ها را تکمیل/فعال اعلام نمی‌کند.
