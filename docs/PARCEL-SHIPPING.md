# اتصال ارسال چندبسته‌ای به Sales و رابط — طرح گام بعد A99

این سند طراحی گام دوم/سوم PARTIAL-FULFILLMENT است، نه قابلیت تحویل‌شده. foundation81 فقط دفتر داخلی انبار است. foundation81 با A100/1148unit/809SQL پذیرفته شد؛همهtesthostهاتماموQA0است. source82 باA101 در حال پیاده‌سازی است؛ کد و migration شش‌جدولی نوشته شده‌اند، اما تا پذیرش SQL/wire/رابط کامل، قابلیت تحویل‌شده محسوب نمی‌شود.

## مرز گردش سفارش

فقط سفارش تماماً فیزیکی Paid یا CreditApproved با مجوز مالی جاری D35 و رزرو Allocated می‌تواند وارد گردش چندبسته‌ای شود. دیجیتال/مختلط تا گردش تحویل دیجیتال مستقل مسدود است؛ موجودی ناموجود/backorder یا کرایهٔ تازه فرض نمی‌شود. انتخاب چندبسته‌ای هم‌زمان با اولین pack موفق و در همان root transaction ثبت می‌شود. تا پیش از آن، سفارش بدون header جدید همان چرخهٔ single فعلی دارد. سفارش دارای OrderShipment یا receipt کامل قبلی نمی‌تواند به‌صورت ضمنی تبدیل شود. اولین pack کامل و اولین pack چندبسته‌ای زیر همان ownergate رقابت می‌کنند؛ فقط یکی می‌برد.

پیشنهاد مدل مستقل Sales، با migration افزایشی و بدون تغییر جدول تاریخی OrderShipments:

- FulfillmentHeader با OrderId یکتا،OwnerId/ReservationId/Contract/ContainsDemo ثابت،version وFirstDispatchRecordedAt. اولین زمان سروری ثبت خروج ثابت است؛ زمان واقعی هر بسته جداست و اولین actual hand-off درنمایش ازminزمان‌هایواقعی محاسبه می‌شود؛ rollback پس از خطا باید این فیلد را هم برگرداند.
- OrderParcels با GUID مستقل،phase packed/dispatched/delivered/void،revision بسته،snapshotFingerprint،نسخه و زمان‌های server/occurred جدا،carrierFaEn وtracking دستی.
- ParcelLines وParcelUnits برای هر packing revision immutable؛ نام/SKU/گارانتی وIsDigital از خطوط snapshot سفارش، هیچ خواندن Catalog امروز. شناسهٔ دستگاه فقط پس dispatch به همان مشتری نشان داده می‌شود.
- ParcelCommands باactor+UUID/payloadHash/receipt تاریخی وaudit ریشه؛ نقشsales.write+inventory.write+staffMFA وreason/ack صریح. رسید پیش CAS وfacts جاری replay می‌شود.
- در صورت نیاز ParcelUnitClaims فقط برای تخصیص جاری بسته‌هایpacked،UnitId یکتا؛packing snapshotهای قبلی حذف یا بازنویسی نمی‌شوند. قیود فعال، تاریخی وInventory.UniqueReservationUnit نقش جدا دارند.

جمع quantity همه بسته‌های packed جاری به‌علاوهٔ مقدار dispatched هر خط از اصل بیشتر نمی‌شود. واحد رهگیری هم‌زمان در دو بستهٔ فعال نیست. قفل owner جمع‌ها و تغییر نسخهٔ سفارش را سریال می‌کند؛ version سفارش برای pack/repack/void حتی با ساعت ثابت صریحاً touch شود. شمارندهٔ انبار فقط در dispatch تغییر می‌کند. void فقط پیش خروج،claims جاری را آزاد می‌کند و هیچ Stock write ندارد. repack فقط پیش خروج با preview تازه،revision بعدی و حفظ receipt قبلی. تاریخچهٔ voidها صفحه‌بندی می‌شود؛ سقف تعداد draft تاریخی نباید سفارش را برای همیشه مسدود کند.

## مجوز مالی و خروج

در هر dispatch، root Identity/Sales/Inventory/CreditSerializable با همان ترتیب owner→command→reservation→Stock→units کار می‌کند. مجوز D35 بلافاصله پیش از خروج بررسی می‌شود. دادهٔ انتخابی همان بسته وfingerprint تمام مانده/دستگاه‌های جاری است. اگر proof پس pack عوض شده، فرمان خروج رد و repack صریح لازم است. همان ParcelId وcommandUUID به foundation81 داده می‌شوند؛ دفتر Inventory، snapshot Sales وaudit با هم commit یاrollback می‌شوند. هیچ mutation جدا یا انتقال واقعی وجه وجود ندارد.

**FirstDispatchRecordedAt در همان تراکنش اولین خروج نوشته و reader `SalesCreditUpfrontOrderStages` به آن متصل شود.** حتی اگر بخشی از کالا هنوز مانده، اصلاح گواهی upfront پس از اولین hand-off بسته ممنوع است. نبودن مجوز تازه، خروج بسته‌های بعدی را می‌بندد؛ ثبت تحویل بسته‌ای که قبلاً مجاز خارج شده نیازمند مجوز تازه نیست، همان قاعدهٔ تحویل کامل فعلی. وضعیت کلی سفارش تا تحویل تمام تعداد همه خطوط Paid/CreditApproved می‌ماند؛ Inventory.Fulfilled به معنی خروج کامل است و نباید به‌تنهایی Order.Fulfilled بسازد.

دفتر خروج جزئی بدون header/parcel متناظر Sales در محیط واقعی یک ناسازگاری است؛ آن را خودکار به بستهٔ مشتری تبدیل نکنید. خروج‌های نمونهٔ foundation فقط در GUIDهای موقت آزمون بوده‌اند. fullShipment قدیمی پس انتخاب گردش چندبسته‌ای درread/write خطای409 `shipment_contract_upgrade_required` می‌دهد؛DTO قدیمی نبایدpackingLinesدروغین یاخالی خلافschema بسازد. receiptهای قبلی مسیر قدیمی همچنان خوانده می‌شوند.

## خواندن و رابط

مرز پیشنهادی admin زیر`/api/admin/orders/{ownerId}/{orderId}/fulfillment` برایread/page/preview وفرمانUUID جدا؛Customer فقطGET زیر`/api/orders/{id}/fulfillment` و`/api/orders/v2/{id}/fulfillment`. shape نهایی پس پیاده‌سازی درAPI ثبت شود. نشانگر نصب نسخه روی endpoint واقعی مانع تبدیل404 سرویس قدیمی به «ارسال وجود ندارد» می‌شود. unknown-query،Origin،body/response bounds،MFA/ownership،JSON strict وprivate/no-store/noindex/no-cookie الزامی‌اند. مسیرهای shipment قدیمی تغییر JSON نمی‌کنند؛خواندن جدید single/none/parcels را صریح نمایش می‌دهد.

پنل مقدار ordered/dispatched/delivered/packed/remaining هر خط را جدا نشان می‌دهد. انتخاب عملکرد خالی،timestamp خالی،reviewunchecked،واحد وIMEI فقط ازpreview متعلق به همین سفارش،ذخیرهٔ reason/body/receipt فقطRAMهمانactor. خروج/تغییرمجوز/چندتب دادهٔ خصوصی وjournal را پاک می‌کند؛قطع پاسخ فقط همانUUID/GET رسید،بدونارسال خودکارفرمانجدید. مشتریFA/EN فهرست بسته‌ها و گزارش دستی carrier/زمان را می‌بیند؛ لینک رهگیری حدس زده نمی‌شود و هیچ دستگاهی پیش hand-off نمایش داده نمی‌شود.

حد actual dispatch همان۶۴ بنیاد است. آخرین خروج باید تمام مانده را پوشش دهد؛اگر بستهٔpacked آخر ناقص است،repack صریح راه اصلاح است. مجموعactivepacked+dispatched هم bounded می‌ماند وvoidبستهٔفعال ظرفیت را باز می‌کند. partial cancellation/return/تعویض دستگاه پس خروج/حسابداری refund واعلان سفارش workflowهای بعدی‌اند؛مسیر قدیمی release عمدی مسدود است و نباید با کم‌کردن اصل entitlement دور زده شود.

پذیرش لازم: SQLfull single/parcels race،partial Finance gate،race با revoke وdispatch اول،عدم اصلاحupfrontپسآن،sameSKU دوخط/serial/IMEI/used snapshots،packبدونStockwrite،void/repack/history،دو خروج ودو تحویل/OrderFulfilledآخر،CAS/UUID/replay/rollback همهcontextها،down guard،decoderwireواقعی،browserFAEN/mobile/قطع پاسخ/globalRAMguard/logout،snapshot سایرجدول‌ها وcleanup. public/end-user partial shipping تا پایان این گام‌ها کامل نیست.

## نکتهٔ مالی و اندازهٔ پاسخ — A101

SafeChequestatesموجودReceived/Deposited/CollectedReportedهستند؛هرتغییرledgerهنوزapprovalدستیfreshمی‌خواهد. برایclearanceمانده،statusداخلیHasRemainingPartialDispatch(بهJSONعمومیتحمیل‌نشود) وackPartialDispatchصریح+Noteلازماست؛falseomit/optionalfalseدرInputوSeal/EventبایدhashوDPlegacyراexactحفظکند. CurrentClearancePageهمانshipmentState=dispatchedوreservationState=Allocatedراصادقانهمی‌دهد؛parser/UIجدیدنیازبهبازبینیآگاهانهٔماندهداشتهباشد. CommitمجددهیچAllocate/ScopeUse/Deadlineتازه‌ایانجامنمی‌دهد. upfrontStageپسFirstDispatchRecordedAtمسدودمی‌ماند؛اینمجوزصرفاًارسالماندهراکنترلمی‌کند.

ShippingAuthorityخصوصیعلاوهبرEffective،RecordedAtمجوزموثررابدهد؛OccurredAtخروجازmax(PackedAt,AuthorityRecordedAt)قدیمی‌ترنباشد. اینسخت‌گیریطبقD35است،هیچبانکیverifiedنمی‌شود. مسیرکاملقبلیهمهمینمرززهمانیکلرا رعایتکند؛رسیدهایگذشتهreplayقبلfactsباقیمی‌مانند.

Order.QuoteSnapshotJsonموجودDATALENGTH≤1048576دارد؛Responsebudgetبایدازحدواقعیsnapshot+100unitمحاسبهشود،نه256KiBکورسکهآخرینبستهرابهعلتمتنمعتبرغیرقابلارسالکند. فهرستبسته‌هاmetadata/line-ref/countکم‌حجماست؛جزئیاتسنگینsnapshotدربازخوانیتک‌بسته‌ایخصوصی جداوboundedدریافتشود،بدونfan-outتکرارWarrantyدر64بسته.
