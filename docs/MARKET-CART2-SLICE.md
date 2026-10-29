# برش اجرایی بعد: Cart2 و تبدیل پیشنهاد به همان سبد

2026-10-24؛ **اصلی/سورس۳۴ محلی پذیرفته و منتشر شده‌اند.** [STATUS](STATUS.md) مرجع runtime و شواهد است؛ [MARKET-ALLOCATION-CONVERSION](MARKET-ALLOCATION-CONVERSION.md) مسیر کامل Quote4/Order2/انتقال را حفظ می‌کند. این برش تصمیم مالی یا مهلت تجاری تازه‌ای تعیین نمی‌کند. providerها و تنظیمات اصلی خرید خاموش می‌مانند.

تکمیل پس از پذیرش زیر: mobile پنل با CSS اصلاح‌شده و۳۹۰ واقعی/تب تازه۱۲۸۰، restore۳۴ دارای۱۰۵جدول/۱۶verifier و cleanup پذیرفته‌اند. بکاپ تازهٔ خصوصی۳۱ و guard هر۹۵ جدول قبلی، سه migration بدون seed،۱۰جدول خالی و ستون صفر SourcingReserved را روی اصلی تأیید کردند؛ هیچ داده/قیمت/موجودی/حساب/CMS قدیمی تغییر نکرد. API و دو رابط تازه با۸۰smoke ناشناسGET و guard پس از startup پذیرفته‌اند؛ `cart34-main-release.json` مرجع است. پاراگراف‌های «پیش از انتشار» پایین شواهد همان مرحله‌اند؛ محدودیت nativeLinux/offsite/production و نبود Quote4/Order2 حفظ است. [طرح Quote4](MARKET-QUOTE4-SLICE.md) گام آمادهٔ بعد است.

## نتیجهٔ محدود این برش

مالک بتواند تمام اقلام همان پیشنهاد پذیرفته‌شده را با قیمت دقیق Agreement و تخصیص واقعیِ فعلی به **همان cart** اضافه کند. ordinary، accepted offer و inquiry سه بخش مستقل‌اند. هیچ Quote4، Order2، Consume، انتقال موجودی یا پرداخت در این برش فعال نمی‌شود؛ سبد دارای offerline تا ساخت مسیر واقعی خرید، blocker صریح دارد.

مدل افزایشی Sales: `CartOfferLines` با LineId پایدار، Agreement/AgreementLine و منشأ Allocation/OfferLine زمان تبدیل؛ `SourcingConversions` و receipt مقید به actor/operation/UUID/هدف/hash با یکتایی AcceptanceId برای تبدیل نخست. مقادیر و قیمت فقط از plan سرور، مبلغ صحیح long/ریال و JSON decimal string می‌آیند؛ registry عمومیِ قیمت بر VariantId بازنویسی نمی‌شود. ordinary و offer در مجموع سقف فنی۶۴ خط دارند؛ inquiry سقف۲۴ و جمع جدا دارد. مقدار توافقی قابل ویرایش نیست. حذف صریح از سبد، رضایت/سهم را revoke نمی‌کند؛ checkout آینده تنها تمام خطوط/مقادیر هر Agreement را می‌پذیرد. افزودن دوبارهٔ حذف‌شده فرمان صریح مستقل می‌خواهد و از replay تبدیل ساخته نمی‌شود.

## قراردادهای لازم

- `GET /api/cart/{locale}/v2` و PUT محدود ordinary با همان cart cookie/owner/version؛ اقلام توافقی در update عادی حذف نشوند. حذف توافق از سبد باید صریح و نسخه‌دار باشد.
- `POST /api/cart/{locale}/v2/merge` برای ورود/بازخوانی provider نیز لازم است. مهمان حق ساخت/انتقال offerline ندارد؛ merge به حساب دیگر سهم را منتقل نمی‌کند.
- candidate مالک از مسیر purchase و convert فرزند Offer، با UUID و نسخه‌های request/task/Agreement/Allocation/cart و TermsHash؛ receipt حداقلی و GET تازهٔ Cart2 برای وضعیت جاری. نام نهایی route/DTO پیش از کدنویسی در API ثبت شود.
- تبدیل همهٔ خطوط یکجا، touch سبد یک بار و حفظ دو بخش دیگر است. OnHand/Reserved/SourcingReserved/claims/Agreement/deadline ثابت‌اند. receipt تاریخی پس از حذف، expiry، سفارش یا تخصیص دوباره فقط همان موفقیت تاریخی را می‌دهد؛ هیچ خطی را دوباره اضافه یا deadline را تمدید نمی‌کند.

## گیت نسخه و حفظ خواندن تاریخی

Cart1 GET/PUT/merge در cart دارای offerline صریح `cart_contract_upgrade_required` با409 بدهند؛ DTO strict V1 عضو تازه نگیرد. `CartService.ReplaceAsync` میان‌بر `Same` پیش از version check دارد و merge tombstone replay دارد: guard باید **پیش از هر دو** باشد. guest/ordinary بدون offerline همچنان V1 کار کند.

بازخوانی سورس تأیید کرد `CheckoutQuoteService.CreateAsync` هم‌اکنون cart زنده را پیش از replay quote تاریخی می‌خواند؛ guard داخل `ReadContentsAsync` پیش از آن کافی است. `CheckoutQuoteValidation.ValidateForOrderAsync` نیز پیش از Hold سفارش تازه guard مستقل می‌خواهد تا quote قدیمی خطوط توافقی را حذف نکند. replay سفارش تاریخیِ واقعاً ساخته‌شده حفظ شود. تا Quote4/Order2، هم client و هم server سبد دارای offerline را از خرید قدیمی بازدارند؛ offer-only «سبد خالی» نیست.

migration فقط جداول افزایشی Sales می‌سازد؛ migrationهای۳۲/۳۳ و PK/data/JSON تاریخی CartLines، CheckoutQuoteLines و OrderLines عوض نشوند. Quote1–3 و Order1 reader تاریخی بدون LineId/قیمت ساختگی حفظ‌اند.

## تراکنش و ریسک‌های تأییدشدهٔ سورس

ترتیب پیشنهادی تبدیل: همان Market owner lock → conversion command → request → task → cart exclusive → Agreement → allocation read/guard، در Serializable ریشه. replay فرمان پس از قفل فرمان و پیش از اعتبار زنده است. `CartService` عمومی تراکنش مستقل باز می‌کند؛ هستهٔ محدود join-parent لازم است. پس از cart/Inventory قفل Market تازه گرفته نشود؛ ترتیب نهایی با همهٔ مسیرهای submit/merge/close و SQL race سنجیده شود.

سه ریسک مشخص مانع پیاده‌سازی ساده‌اند:

1. `SourcingPriceAgreementService.EnsureForAllocationAsync` هنگام تخصیص مجدد AllocationId را عوض می‌کند. CartOfferLine منشأ نخست را ثابت نگه دارد؛ hold تازه بی‌صدا جایگزین نشود. read جاری باید `allocation_changed` یا blocker هم‌معنا بدهد؛ readd صریح آینده جداست.
2. staff-close فعلی request را می‌گیرد ولی `SourcingRequestService.SubmitAsync` پس از cart درخواست‌ها را می‌شمارد. افزودن cleanup سبد به close می‌تواند چرخهٔ request→cart / cart→request بسازد. در این برش revoke/release/expiry، ردیف را در Cart2 به issue صادق تبدیل می‌کنند؛ eager cleanup از lifecycle افزوده نشود. حذف اتمیک آینده به حل ترتیب مشترک و آزمون رقابت نیاز دارد.
3. `OrderService` پیش از cart lock، سفارش منقضی را با Inventory آزاد می‌کند. این ترتیب Stock→cart نباید وارد Order2 شود؛ اصلاح آن متعلق به برش بعدی انتقال است، نه ساخت Order فرضی در convert.

فایل‌های اصلی: Sales `Cart.cs`، `CartService.cs` و سرویس/قرارداد تازهٔ CartV2/CartOffer/Conversion؛ Market plan مالک؛ SharedKernel قرارداد محدود؛ Api coordinator/endpoints و نگاشت409 در Program. هیچ DbContext ماژول دیگر وارد سرویس دامنه نشود؛ root فقط مالک transaction مشترک است.

رابط: قرارداد/client تازهٔ Cart2، allowlist دقیق BFF و customer-session، provider/context و POST merge، CartPage/Drawer/summary و دکمهٔ convert در Supply مشتری. accepted lines با LineId مستقل قیمت می‌گیرند؛ دو توافق یک SKU و ordinary همان SKU با هم جمع/overwrite نشوند. convert به journal همان مالک، UUID/body frozen، mutex مشترک تغییر سبد و receipt→GET تازه متصل شود؛ خطای موقت auth همان قواعد محفوظ/پنهان قبلی را حفظ کند. PWA هیچ پاسخ خصوصی را cache نکند.

## پذیرش لازم پیش از ادعای تکمیل این برش

- SQL واقعی: ordinary به‌همراه دو توافق همان SKU با قیمت‌های متفاوت و مبلغ بالاتر از۲^۵۳؛ همهٔ بخش‌ها/قیمت‌ها مستقل، ظرفیت دقیق و inquiry بدون جمع خرید.
- replay/target/body/actor، حذف سپس replay، expiry و تخصیص مجدد؛ هیچ resurrection یا دنبال‌کردن hold تازه رخ ندهد. convert با close/expiry/merge همزمان؛ شکست event/command/audit همهٔ اثر cart را rollback کند.
- V1 no-op/merge tombstone، quote replay قدیمی و سفارش تازه از quote قدیمی واقعاً مسدود شوند؛ ordinary-only و replay سفارش تاریخی سالم بمانند.
- migration دارای داده، hash قیمت/Stock/کلیدهای تاریخی و no financial effect؛ wire واقعی هر دو رابط و مرورگر مالک/FA-EN/موبایل، قطع پاسخ و GET تازه. تنظیمات اصلی خاموش، QA خودش پاک و اصلی محفوظ بماند.

انتقال بعدی، `HoldOrderWithAllocationsAsync` با deadline مطلق، OrderLineId و انتقال اتمیک SourcingReserved→Reserved می‌خواهد؛ claim منشأ ثابت، OrderHeld واقعی و releaseِ assigned+unassigned باید با SQL آزموده شوند. وجود enum/marker آینده یا این طرح، شاهد انتقال یا پایان کل پروژه نیست.

## قرارداد قطعی در حال پیاده‌سازی۳۴

- Cart2: GET/PUT `/api/cart/{locale}/v2`؛ PUT فقط `{lines:[{variantId,quantity}],version}` را می‌گیرد و دو بخش دیگر را حفظ می‌کند. merge: POST همان مسیر با `/merge`. ordinary LineId یک hash پایدار دامنه‌دار از CartId/VariantId است؛ VariantIdهای تاریخی مجبور به GUID نمی‌شوند.
- حذف یک گروه کامل: DELETE `/api/cart/{locale}/v2/offers/{agreementId}` با `{requestId,version}`. رسید: GET همان مسیر با `/commands/remove/{commandId}`. پاسخ schemaVersion1 شامل agreementId/cartId/cartVersion/lineIds/commandId/at/replayed و canCheckout=false/canPay=false است. حذف، سهم موجودی و Agreement را دست نمی‌زند.
- candidate: GET `/api/sourcing/requests/{id}/offers/{offerId}/purchase`؛ تبدیل POST همان Offer با `/convert`؛ رسید GET همان Offer با `/commands/convert/{commandId}`. input دقیق SharedKernel/SourcingCart.cs، بدون قیمت/تعداد/مالک انتخابی client.
- Candidate schemaVersion1 شامل requestId/requestVersion/taskId/taskVersion/offerId/offerVersion/acceptanceId/termsHash/purchaseUntil، agreement/allocation/cartVersion/conversion با null صریح، canConvert، canCheckout=false، canPay=false و blockers است. conversion تاریخی فقط id/cartVersion/line links دارد. کل candidate و Cart2 حداکثر۲MiB و بدون بریدن خطوط است.
- Cart2 schemaVersion2، ordinaryLines/offerLines/inquiry، subtotalهای جدا، hasIssues/blockers دارد. canCheckout فقط با ordinary غیرخالیِ معتبر و نبود offerline مثبت است؛ issue بخش inquiry مستقل خرید عادی را نمی‌بندد. canPay=false capability این snapshot است؛ Quote3 عادی حفظ می‌شود. قیمت توافقی در registry عمومی VariantId نوشته نمی‌شود.
- candidate نیز owner/request/task app lock را پیش از graph/cart می‌گیرد. بدون آن، readهای Serializable می‌توانستند Market→cart / cart→Market نوشتن چرخه بسازند. تبدیل Market owner→Sales command/replay→request/task→cart→Agreement→Inventory guard دارد؛ پس از guard قفل Market تازه گرفته نمی‌شود.

این بخش freeze قرارداد است؛ شواهد اجرا در ادامه آمده‌اند. اصلی روی۳۱ و candidate پذیرفتهٔ پیشین۳۳ محفوظ‌اند.

Migration تازهٔ سورس۳۴ `20261024025922_CartAcceptedOffers` فقط CartOfferLines/SourcingConversions/CartOfferCommandReceipts و index/FK همان‌ها را می‌سازد. LineId در SQL اجباری و یکتا در cart است. Down پیش از DDL، در صورت وجود هر خط یا conversion یا receipt تاریخی با51000 رد می‌شود؛ حذف گروه اجازهٔ فراموشی idempotency نمی‌دهد. ID nullable تولیدشده در EF با مدل و Designer/Snapshot تازه تصحیح شد؛ pending-model check و دو SQL migration با داده‌های تاریخی موفق‌اند. اجرای مستقیم SQL idempotent و restore کامل۳۴ ادعا نمی‌شوند.

پذیرش فنی:۷۰۷ واحد،۴۹ targetedSQL اولیه،۳ race تازه و **۳۷۴ SQL کامل نهایی**،۲۴۹ pure storefront/plain tsc، Next build، Sales مدل بدون تغییر جامانده و۱۰ wire پاسخ واقعی پذیرفته‌اند؛ صفر fail/skip.۴۸ SQL تازه شامل۲۰ Market،۸ Inventory،۱۱ Sales،۷ HTTP و۲ migration است. raceهای coordinator با owner merge، staff-close و expiry writer واقعی، با app-lock دقیق محصول و اثبات دو session منتظر از DMV پیش از release موفق‌اند؛ winner از پیش فرض نشده است. expiry از clock صریح QA روی deadline استفاده می‌کند، نه زمان سپری‌شدهٔ واقعی. بیلد تست نهایی۱۳DLL محصول را عین candidate پذیرفته حفظ کرد. مسیر customer convert audit ادمین ندارد؛ provenance همان Market event است و خطای این event و خطای receipt در تراکنش آزموده شده‌اند. شاهدی به‌نام audit fault تبدیل ادعا نمی‌شود.

مرورگر SQL با هویت‌های خود GUID: افزودن قیمت بزرگ و سه بخش، قطع دو پاسخ موفق convert، retry عین body و رسید→Cart2؛ سپس FA/EN، حذف گروه با دو پاسخ قطع‌شده،401/refresh503، پنهان‌شدن دادهٔ خصوصی و بازیابی همان مالک/UUID تا رسید و GET تازه پذیرفته شد. SQL پس از حذف یک conversion/دو receipt/یک event، صفر offerline، حفظ ordinary/inquiry/Stock/Agreement/claims و صفر اثر خرید را ثابت کرد. چهار بدنهٔ اصلی در `artifacts/checks/cart2-ui-wire/` ذخیره‌اند؛ initial SQL-wire فقط response را ثبت کرده بود. جریان کامل build `3sjwncRj7-yg12Atcux1m` و رفع دو ایراد ظاهری build نهایی `ij2LB3O8NnHzgtmJZi4Uh` در GUID دوم پذیرفته‌اند. موبایل واقعی390×844، عرض سند375 در FA/EN، console صفر و تصویر viewport معتبر است؛ crop ابزار در fullPage شاهد محسوب نمی‌شود. هر دو دیتابیس/credential/key ring پاک، تب‌ها بسته و viewport reset؛ main31/Redis و hashها ثابت‌اند. `cart2-ui-acceptance.json` و `cart2-acceptance.json` شواهد و محدودیت‌ها را دقیق حفظ می‌کنند. rollout، mobile پنل۳۳ و restore تازه همچنان جدا بازند.
