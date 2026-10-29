# پیشنهاد تأمین، پذیرش و تبدیل به خرید — طرح برش‌های بعد

2026-10-24؛ **طرح معماری مسیر کامل؛ Offer/consent در۲۹ و پیگیری/دریافت واقعی طبق [MARKET-SUPPLY-RECEIPTS](MARKET-SUPPLY-RECEIPTS.md) در اصلی/سورس۳۱ محلی پذیرفته و منتشر شدند.** مرحلهٔ دوم۶۲۰واحد/۲۴۳SQL/۱۷wire،۱۴۴پنل/۲۱۰فروشگاه، مرورگر/cleanup، بکاپ تازه/حفظ داده‌ها و۴۹smoke را گذراند؛ تخصیص/خرید هنوز پیاده نشده‌اند. [MARKET-ALLOCATION-CONVERSION](MARKET-ALLOCATION-CONVERSION.md) پیش‌نویس فنی مرحلهٔ سوم است؛ Cart2/Quote4/OrderSnapshot2 و توافق Sales همچنان لازم‌اند. مبنا: D23/D28 و A32/A33/A34، [PRD](PRD.md)، [COMMERCE-EXTENSIONS](COMMERCE-EXTENSIONS.md)، [سبد/درخواست سورس۲۸](MARKET-SOURCING.md) و قراردادهای فعلی Catalog/Sales/Inventory. وضعیت دقیق از STATUS خوانده شود؛ انتشار محلی پایان MARKET-02، تولید/native Linux یا بقیهٔ PDF نیست.

## نتیجهٔ مورد انتظار

مدیر برای درخواست ثبت‌شده یک پیشنهاد دارای SKU واقعی، پیکربندی/شرایط دقیق، قیمت صحیح ریال و مهلت صریح آماده می‌کند. مشتری نسخهٔ مشخص را آگاهانه می‌پذیرد. اگر کالا هنوز در فروشگاه دریافت نشده، پذیرش فقط اجازهٔ پیگیری تأمین است و **سفارش فروش/پرداخت/رزرو کالای ناموجود ایجاد نمی‌کند**. مدیر تأمین دستی از فروشنده را پیگیری و دریافت واقعی را در انبار ثبت می‌کند. پس از موجودشدن واقعی و آماده‌شدن تمام شرایط، مشتری مستقیم به سبد قابل خرید و checkout عادی می‌رود؛ تبدیل تکراری همان اقلام را دوباره اضافه نمی‌کند.

تأمین‌کنندهٔ API نداریم؛ منبع فعلی پنل/CSV است. فرمان «ثبت پیگیری سفارش نزد تأمین‌کننده» فقط گزارشی است که مدیر از اقدام خودش ثبت می‌کند؛ تماس، ارسال پیام، خرید خارجی، موفقیت vendor یا فاکتور هلو را شبیه‌سازی نمی‌کند. اتصال هلو بعداً از adapter قرارداددار همان مرزها را به‌کار می‌گیرد.

## آنچه سورس فعلی اجازه نمی‌دهد

| شاهد سورس | پیامد طراحی |
|---|---|
| `CartService.ReplaceAsync` موجودی و کاتالوگ عمومی را برای افزایش می‌سنجد و transaction مستقل ReadCommitted باز می‌کند | تبدیلِ چندماژولی نباید آن را داخل transaction والد صدا بزند؛ هستهٔ داخلی محدود با assert والد لازم است |
| CartLines فعلی PK بر cart+variant و quote از قیمت عمومی Catalog استفاده می‌کند | قیمت توافقی مشتری نباید با تغییر قیمت عمومی SKU یا overwrite کردن ردیف خرید عادی اعمال شود |
| `ICheckoutCatalogReader` فقط SKU عمومی فعال، ترجمه، گارانتی و روش‌های مجاز می‌دهد | پذیرش مدل بازار به‌تنهایی خریدپذیری نمی‌سازد؛ SKU و قواعد جاری باید دوباره خوانده شوند |
| `IStockReservations.HoldAsync` OrderId واقعی و موجودی OnHand−Reserved می‌خواهد | fake OrderId برای «رزرو درخواست» یا افزایش OnHand از مشاهدهٔ بازار ممنوع است |
| `OrderService` quote معتبر، هزینه/تنظیم معلوم و موجودی واقعی می‌خواهد؛ CanPay فعلاً false است | هیچ مسیر تأمین اجازهٔ دورزدن policy، ساخت سفارش پرداخت‌شده یا روشن‌کردن درگاه را ندارد |
| Market درخواست و receipt و Inventory دفتر موجودی/سریال را مالک‌اند | FK یا DbContext میان‌ماژولی افزوده نشود؛ coordination فقط در root با قرارداد محدود باشد |

## جریان کامل و تفکیک وضعیت‌ها

سه مفهوم جدا نگه داشته شوند: پیشنهاد/رضایت، عملیات تأمین، و خرید Sales. از یک رشتهٔ status برای اثبات هر سه استفاده نشود.

| مرحله | واقعیت و اثر مجاز |
|---|---|
| `OfferDraft` | مدیر SKU/شرایط/قیمت/زمان را ویرایش می‌کند؛ مشتری نمی‌بیند |
| `OfferPublished` / نمایش درخواست `Quoted` | snapshot عمومیِ همان مالک ثابت و قابل قبول است؛ هیچ stock/order/payment ایجاد نشده |
| `OfferAccepted` + `PendingSupply` | مشتری همان snapshot را پذیرفته؛ رضایت غیرمالی ثبت و کار تأمین داخلی ایجاد می‌شود؛ هنوز غیرقابل پرداخت |
| `SupplierRequested` / `SupplierOrderRecorded` | اقدام دستی مدیر با منبع/مرجع/زمان ثبت شده؛ موجودی تأمین‌کننده به OnHand سایمان تبدیل نشده |
| `PartiallyReceived` | فقط بخشی واقعاً دریافت شده؛ سفارش کامل آماده نیست و مقدار باقی‌مانده مشخص است |
| `SupplyReceived` | دریافت واقعی با سند/واحد/سریال لازم ثبت شده؛ انبار مالک شمارش است |
| `ReadyForCheckout` | همهٔ اقلام واقعی، شرایط پذیرفته‌شده معتبر و تخصیص انباری کافی برقرار است؛ مهلت خرید صریح دارد |
| `ConvertedToCart` | همان پذیرش فقط یک بار به ردیف‌های خرید قابل ردیابی تبدیل شده؛ هنوز سفارش/پرداخت نیست |
| `SalesOrderCreated` | فقط OrderService و quote تازه سفارش موقت می‌سازند؛ receipt/provenance به تأمین پیوند می‌خورند |
| `Paid/Fulfilled/Returned` | فقط گردش معتبر آیندهٔ Payments/Sales/Inventory؛ از Accept یا CSV استنتاج نمی‌شوند |

Offer می‌تواند پیش از پذیرش Withdrawn/Expired/Superseded/Declined شود. درخواست با رد پیشنهاد بی‌صدا بسته نمی‌شود: مشتری امکان درخواست بررسی دوباره یا لغو دارد و تاریخچه باقی می‌ماند. پس از پذیرش، ویرایش پیشنهاد منتشرشده ممنوع است؛ تغییر شرایط، پیشنهاد/رضایت تازه می‌خواهد. `SupplyFailed` و `SupplyCancelled` مستقل از Declined/Expired و با علت/پیام عمومی ثبت شوند. پس از ایجاد سفارش واقعی، لغو و refund از مسیر Sales/Payments انجام می‌شود؛ لغو درخواست آن سفارش را مخفیانه لغو نمی‌کند.

این نام‌ها طرح‌اند؛ state machine نهایی پیش از migration با تمام انتقال‌های مجاز، نقش، زمان و رویداد بسته شود. حالت مؤثر منقضی در خواندن فوراً غیرقابل قبول/خرید است؛ worker دیررس اجازهٔ پذیرش یا خرید منقضی نمی‌دهد.

سازگاری با سورس۲۸ باید صریح بماند: DTOهای schema1 درخواست فقط چهار وضعیت فعلی را می‌پذیرند و decoderها strict هستند. برش Offer وضعیت/receipt مستقل خودش را داشته باشد؛ نمایش پیشنهاد از child aggregate می‌آید و وضعیت جدیدی بی‌خبر به summary/receipt نسخه۱ تزریق نمی‌شود. اگر حالت اصلی درخواست گسترش یافت، قرارداد نسخه‌دار و مسیر ارتقای هر دو رابط لازم است؛ نگاشت سازگار نسخه۱ و خواندن تاریخچه نیز آزموده شوند. انتشار یک API با enum تازه پیش از رابط سازگار، پذیرش این برش نیست.

## SKU واقعی و دریافت واقعی بدون موجودی ساختگی

1. مدیر از همان مدل Catalog، SKU واقعیِ دارای کد/گزینه/قیمت/گارانتی و هویت مستقل می‌سازد یا SKU موجود را انتخاب می‌کند. ایجاد SKU یک فرمان مجاز Catalog است؛ Accept مشتری خودکار SKU نمی‌سازد. SKU با مشخصات کامل ولی بدون واحد انبار مجاز است؛ ردیف Stock با OnHand=0 در این حالت «موجودی فرضی» نیست، اما قیمت یا SKU جای‌نگهدار برای پرکردن فرم ممنوع است. قیمت صفرِ واقعی تصمیم صریح قیمت‌گذاری است و فقط با قواعد معتبر Catalog/checkout و آزمون مستقل آن پذیرفتنی است؛ این طرح کف قیمت تجاری تازه‌ای تصویب نمی‌کند.
2. پیشنهاد به Id/نسخه/SKU و snapshot ویژگی/شرایط **آن تنوع واقعی** متصل است. قیمت مرجع بازار برای قیمت فروش کپی خودکار نمی‌شود؛ مدیر مجاز مقدار فروش را صریح وارد می‌کند. در صورت ساخت تنوع تازه، receipt و کلید تطبیق پایدار Catalog مانع ساخت تکراری آن در retry می‌شوند.
3. پذیرش در Market و توافق قیمت در Sales ثبت می‌شود، نه در Stock. کار تأمین sourceKey/sourceItemKey، نام منبع، نوع manual/CSV، reference اختیاری سند واقعی و زمان ثبت دارد. ETA اگر معلوم نیست null است؛ سیستم تاریخ یا تضمین تأمین نمی‌سازد.
4. ورود کالا فقط با فرمان **دریافت واقعی Inventory** انجام می‌شود: variant، مقدار دریافت‌شده، مرجع دریافت، actor، زمان، دلیل و برای دستگاه ردیابی‌شده سریال/IMEI. مقدار دریافت از عدد بازار/CSV مشاهده، خود Offer.Quantity یا «تأیید مدیر فروش» استنتاج نمی‌شود. receipt دریافت با کلید پایدار و hash، تکرار فاکتور/فرمان را دوباره وارد انبار نمی‌کند؛ تطبیق منبع هلو/دستی نیز کلید جلوگیری از شمارش دوباره می‌خواهد.
5. Inventory ledger و Stock در یک transaction تغییر می‌کنند. واحد/بسته باید به واحد فروش همان SKU نگاشت روشن داشته باشد؛ واحد نامعلوم رد شود. برای گوشی دست‌دوم دریافت و پیشنهاد تا وجود قرارداد گزارش نسخه‌دار همان دستگاه در USED-01 نمی‌توانند سلامت/باتری/آسیب را حدس بزنند.
6. دریافت ناقص یا کالای متفاوت درخواست را Ready نمی‌کند. جایگزین محصول/کاهش تعداد/گارانتی تازه به پیشنهاد جدید و پذیرش تازه نیاز دارد. اگر چند ردیف پیشنهاد از یک SKU استفاده کنند، کنترل مقدار روی مجموع variant انجام شود؛ یک واحد برای دو ردیف تخصیص نیابد.

## تخصیص واقعی و حفظ کالای تأمین‌شده برای مشتری

پیشنهاد اجرایی: هنگام آماده‌شدن تأمین، Inventory یک **SourcingAllocation** واقعی از واحدهای دریافت‌شده/موجود بسازد؛ این allocation سفارش فروش نیست. اتکا به یک چک Available هنگام Ready و سپس رهاکردن واحد برای خریدار دیگر، ادعای «برای شما آماده است» را پایدار نمی‌کند.

- Inventory مالک AllocationId، OwnerId، AcceptedOfferId، مقدار هر SKU/واحد، CreatedAt/ExpiresAt، State و receipt است. هیچ دادهٔ فرضی به OnHand اضافه نمی‌شود. سقف مهلت فنی محدود/قابل تنظیم است؛ زمان تجاری خرید از خود پیشنهادِ مدیر و رضایت مشتری می‌آید، نه عدد نمونه.
- Stock به تفکیک encumbrance سفارش و تأمین نگه‌داری شود؛ طرح حداقلی ستون `SourcingReserved` کنار Reserved و CHECK `OnHand>=Reserved+SourcingReserved`. view عمومی Available باید هر دو را کم کند. تمام adjust/receipt/fulfill/هلو و مسیر چندانبار بعدی این invariant را رعایت کنند؛ صرف اضافه‌کردن یک جدول Market که Inventory نمی‌بیند کافی نیست.
- کنترل داخلی `StockReservationService.HoldAsync` هم باید SourcingReserved را کم کند؛ اصلاح صرف view، مسیر Hold عادی را ایمن نمی‌کند. برای هر SKU، مقدار offerline حداکثر سهم allocation فعال همان توافق است و مقدار ordinary حداکثر Available عمومی؛ جمع این دو ظرفیت مستقل است و سهم تخصیص یک بار شمرده می‌شود. اقلام عادی نمی‌توانند تخصیص استفاده‌نشدهٔ همان مشتری را بدون فرمان انتقال صریح مصرف کنند.
- quote مالک، ظرفیت تخصیص خود را از قرارداد Inventory می‌خواند؛ تخصیص مشتری دیگر در Available او قابل مصرف نیست. جمع اقلام عادی و توافقی برای یک SKU کنترل شود. تخصیص اضافی فقط با موجودی واقعی تازه و command نسخه‌دار انجام شود.
- هنگام سفارش، `TransferSourcingAllocationToOrderHold` در **همان transaction** واحد را از SourcingReserved به Reserved سفارش منتقل کند؛ یک OrderId واقعی و deadline معتبر لازم است. پنجرهٔ آزادشدن میان دو مرحله یا دو بار رزرو ممنوع است. برای اقلام ترکیبی، انتقال سهم تأمین و Hold سهم عمومی اتمیک‌اند؛ شکست یکی همه را rollback می‌کند.
- deadline مؤثر quote و hold انتقالی از کمینهٔ PurchaseUntil، انقضای allocation و مهلت عادی quote/order بیشتر نشود؛ retry یا تبدیل آن را تمدید نکند. اگر زمان باقیمانده از حد معتبر قرارداد Hold کمتر است، سفارش رد و پیشنهاد/مهلت تازه با رضایت تازه لازم است. انقضای تأمین پس از انتقال، دستور آزادسازی رزرو سفارش نیست؛ تنها چرخهٔ معتبر سفارش/پرداخت دربارهٔ آن تصمیم می‌گیرد.
- expiry/لغو پیش از سفارش allocation را یک بار آزاد می‌کند، اما OnHand را کم نمی‌کند؛ fulfillment فقط مسیر سفارش واقعی OnHand را کم می‌کند. بعد از انتقال، درخواست حق آزادکردن دوبارهٔ allocation/رزرو سفارش را ندارد. خرابی/کمبود واقعی بعد از دریافت مسیر مغایرت انبار دارد و نمی‌تواند reserved واقعی را بی‌دلیل منفی کند.
- تا پیاده‌سازی و پذیرش این مرز، مرحلهٔ Ready با «واحد اختصاص‌یافته» و تبدیل نهایی کامل اعلام نشود. ساخت پیشنهاد/پذیرش/پیگیری تأمین مستقل از این کار قابل اجرا و پذیرش است و باید ادامه پیدا کند.

## قیمت توافقی و تبدیل به سبد

**قیمت توافقی در Sales است، قیمت عمومی SKU در Catalog.** توافق یک مشتری نباید قیمت همه را تغییر دهد یا برای هر مشتری یک SKU با موجودی تکراری بسازد.

- Market مالک OfferRevision ثابت و AcceptedOffer است. Sales از قرارداد محدود server-only، پذیرش صاحب حساب، snapshot مالی/شرایط و hash را می‌گیرد و `AcceptedPriceAgreement` می‌سازد؛ UNIQUE AcceptedOfferId/Revision از دوباره‌سازی دفاع می‌کند. پول همه‌جا integer rial/long/bigint، JSON رشته و JS BigInt است؛ محاسبهٔ qty×unit و مجموع checked باشد.
- پیشنهاد منتشرشده دارای lineId ثابت، SourceRequestLineId، ProductId/VariantId/Sku، quantity، unitPriceRial، snapshot FA/EN گزینه/گارانتی/شرایط و fingerprint است. حداکثر۲۴ ردیف درخواست به حداکثر۶۴ ردیف تنوع واقعی نگاشت شوند؛ مقدار هر ردیف درخواست کامل پوشش داده شود. برش نخست جایگزینی مدل متفاوت ندارد؛ قابلیت جایگزینی آینده باید تفاوت را صریح و رضایت را مستقل ثبت کند.
- برای حفظ ردیف عادی همان SKU و قیمت مستقل، `CartOfferLines` افزایشی در Sales کنار CartLines ایجاد شود؛ PK بر CartId+AgreementLineId، با VariantId و quantity. همان cart/cookie/owner/version و قفل را به‌کار برد؛ هیچ ردیف خرید موجود overwrite نشود و مبلغ توافقی با قیمت عمومی جمع نشود. در UI هر دو **خرید قابل پرداخت** هستند؛ CartSourcingLines همچنان غیرقابل‌پرداخت است.
- تبدیل فقط مالک عضو، پذیرش معتبر، allocation فعال، SKU جاری خریدپذیر، hash شرایط، deadline و cartVersion فعلی را می‌گیرد. body قیمت/مالک/Stock را تعیین نمی‌کند. receipt و UNIQUE AcceptedOfferId→Conversion ثابت، cart effect و رویداد Market در یک transaction ثبت شوند. تکرار پس از حذف دستی ردیف سبد، سفارش یا تغییر سبد **نباید دوباره آن را اضافه کند**؛ replay نتیجهٔ تاریخی/مسیر پیگیری می‌دهد. افزودن مجدد پس از حذف فقط فرمان تازهٔ صریح با رضایت/نسخهٔ جاری و سقف توافق است.
- endpoint نسخه‌دار سبد/quote برای نمایش provenance و ردیف توافقی لازم است؛ strict decoder v1 را با فیلد بی‌خبر نشکنید. پیشنهاد عملی: Cart schema2 و Quote schema4، با بازخوانی/ارتقای صریح UI و خواندن تاریخی quoteهای۱–۳؛ quote3 نمی‌تواند با CartOfferLines پنهان، سفارش تازه بسازد. قرارداد جدید lineKind/lineId/agreementLineId و SnapshotVersion را تا order snapshot حمل کند.
- Quote4 از Catalog برای هویت/انتشار/روش/گارانتی جاری و از Sales برای قیمت توافقی پذیرفته‌شده استفاده می‌کند؛ grant expired/revoked/mismatched را رد می‌کند. مقدار و قیمت توافق، مقدار تخصیص، روش خرید مجاز، policy مالی/حمل و همهٔ نسخه‌ها در PricingFingerprint باشند. ordinary SKU هم‌زمان از قیمت عمومی جاری استفاده می‌کند. quote/order همین توافق را snapshot می‌کنند و linkage به request/offer/acceptance/conversion حفظ می‌شود.

## مهلت‌ها، تغییر کاتالوگ و بازار

هر پیشنهاد `AcceptUntil` و `PurchaseUntil` صریحِ UTC دارد؛ ETA/تاریخ تأمین اگر معلوم نیست null است. OfferDraft بدون این مهلت‌ها منتشر نمی‌شود؛ توسعه مقدار یا وعدهٔ نمونه را به سیاست اصلی تبدیل نمی‌کند. Accept پس از deadline یا با offerVersion/termsHash قدیمی409 است. پذیرش اعتبار قیمت را بی‌نهایت تمدید نمی‌کند. اگر دریافت پس از PurchaseUntil رخ دهد، پیشنهاد تازه و پذیرش تازه لازم است؛ واحد واقعی انبار محفوظ ولی رضایت قبلی برای قیمت/شرایط تازه مصرف نمی‌شود.

Snapshot material terms شامل SKU/گزینه‌ها، گزارش دستگاه/نسخه در USED، گارانتی/شرایط و سیاست قیمت توافق است. تغییر مؤثر آن‌ها، غیرفعال/Hidden شدن محصول/تنوع/دسته/برند یا حذف روش خرید، قابلیت ادامه را سروری دوباره بررسی می‌کند؛ وضعیت قدیمی UI حق خرید نمی‌دهد. تغییر صرف قیمت عمومی Catalog نمی‌تواند قیمت توافق پذیرفته‌شده را overwrite کند؛ quote تازه هنوز لازم می‌شود ولی توافق معتبر قیمت خودش را حفظ می‌کند. برای تغییر متن/محتوا، canonical material hash و rowversion خواندن جاری از هم جدا باشند؛ هر تغییر rowversion را بی‌دلیل رضایت تازه تلقی نکنید و هیچ تغییر واقعاً مادی را هم با توضیح UI نپذیرید.

قانون جدید بازار بر Available عمومی پس از کسر **هر دو نوع رزرو** است: اگر عرضهٔ عمومیِ فعال و Available>0 باشد، مدل از market public خارج و درخواست تازه/افزایش/submit با now_in_store رد می‌شود. درخواست/پیشنهاد خصوصی قبلی حذف نمی‌شود؛ پیشنهاد می‌تواند از موجودی واقعی فروشگاه تأمین شود و دیگر به خوانندهٔ eligibility «خارج از موجودی» وابسته نیست. اگر تمام واحدها برای یک مشتری تخصیص یافته‌اند، Available عمومی صفر است و دیگران می‌توانند استعلام تازه ثبت کنند؛ آن‌ها حق مصرف allocation قبلی را ندارند. انقضای allocation یا تأمین تازه می‌تواند Available را مثبت و بازار را پنهان کند؛ سفارش/hold آن را دوباره صفر می‌کند. این رفت‌وبرگشت‌ها باید در SQL و خواندن عمومی، بدون loop وضعیت درخواست آزموده شوند.

## receipt، مجوز، transaction و محرمانگی

- برای publish/withdraw/supersede/accept/decline/cancel-supply/receive/allocate/convert، فرمان actor+operation+UUID، target و hash بدنهٔ canonical دارد. receipt پایدار کوچک، نتیجهٔ تاریخی و نسخهٔ زمان فرمان دارد؛ GET جزئیات وضعیت جاری است. همان UUID/بدنه پس از تغییر وضعیت هم replay، بدنهٔ متفاوت409؛404 lookup پایان فرمان در حال اجرا را ثابت نمی‌کند.
- actor و owner از principal؛ receipt مدیر به actor/operation/offer یا request مسیر مقید است. فروشنده/مدیر دیگر صرف داشتن نقش رسید شخص قبلی را نمی‌خواند. journal فقط RAM مقید به حساب، حفظ UUID/body در unknown و retry دستی؛ هیچ mutation مالی/موجودی خودکار توسط retry مرورگر.
- پیشنهاد قیمت: sales.write برای بررسی/محتوا، **مجوز مالی لازم برای publish قیمت/شرایط فروش** از policy موجود یا policy کوچک مستقل تعریف شود؛ catalog.write به‌تنهایی کافی نیست. ساخت SKU catalog.write و دریافت/تخصیص inventory.write، هرکدام MFA/audit دارند. مشتری فقط پیشنهاد خودش را می‌بیند/می‌پذیرد؛ credential تأمین‌کننده، بهای خرید خصوصی و یادداشت داخلی به DTO او نمی‌روند.
- root اتصال مشترک Serializable برای Market+Sales+Catalog+Inventory و Identity audit دارد؛ سرویس‌ها مالک جدول خود و دارای assert والد هستند. کلیدها/قفل‌های مالک و command پیش از خواندن رقابتی گرفته شوند؛ cart پیش از agreement/allocation/Stock و Stock به ترتیب canonical VariantId قفل شود. checkout مصرف‌کنندهٔ grant نباید برای تکمیل سفارش به قفل request در Market بازگردد؛ نتیجهٔ OrderId از Sales provenance/قرارداد به root می‌رسد. plan دقیق lock با مسیرهای موجود Hold/expiry/fulfill پیش از implementation مرور و تست رقابت شود.
- پیوند پیشرفت Order→Market با outbox پایدار Sales در همان transaction سفارش ثبت شود؛ worker پس از commit از قرارداد Market رویداد deduplicated با کلید OrderId اعمال کند. گرفتن request lock در انتهای checkoutِ دارای cart lock ممنوع است، چون cancel/convert از request به cart می‌روند. تا رسیدن projection، خواندن خصوصی می‌تواند وضعیت authoritative توافق/سفارش را از قرارداد فقط‌خواندنی Sales ترکیب کند؛ stale بودن projection هیچ permission یا امکان پرداخت نمی‌سازد. outbox شامل provenance لازم و فاقد آدرس/یادداشت/credential باشد؛ خرابی worker سفارش موفق را تکرار نمی‌کند.
- لغو پس از conversion تا پیش از مصرف grant باید cart/allocation را با همان قفل‌ها کنترل کند؛ اگر سفارش grant را مصرف کرده، عملیات درخواست از تغییر رزرو سفارش خودداری و مسیر Sales را برمی‌گرداند. نباید در حالی که cart قفل است، order-owner lock را خلاف ترتیب فعلی OrderService درخواست کند.
- no-store بومی و private/no-store/noindex در BFF، Vary Cookie/Authorization، body/response byte bounds و paging۲۰/۵۰ حفظ شوند. IsDemo/ContainsDemo تا توافق/receipt/allocation/order provenance منتقل و خارج Development بسته باشد. هیچ دادهٔ QA/نمونه منبع یا شرط تجاری اصلی نشود.

## API پیشنهادی برای برش‌بندی

این نام‌ها قرارداد پیشنهادی‌اند، نه route موجود؛ همگی تحت همان Origin/MFA/policy/limits و strict unknown-member خواهند بود.

| مسیر پیشنهادی | اثر |
|---|---|
| POST `/api/admin/sourcing/requests/{id}/offers` | draft با UUID ثابت و نگاشت SKU واقعی؛ بدون انتشار/Stock |
| PUT `/api/admin/sourcing/requests/{id}/offers/{offerId}` | ویرایش draft نسخه‌دار |
| POST `.../{offerId}/publish` / `/withdraw` | snapshot ثابت/مهلت یا withdraw پیش از پذیرش؛ receipt/audit |
| GET `/api/sourcing/requests/{id}/offers` و `.../{offerId}` | فقط مالک؛ published/history مجاز با اثر مالی صریح |
| POST `.../{offerId}/accept` / `/decline` | UUID+offerVersion+termsHash؛ ثبت رضایت/رد، بدون Order/Stock |
| GET `/api/admin/sourcing/requests/{id}/supply` و POST `.../supply-events` | پیگیری منبع دستی/CSV و رخدادهای غیرمالی؛ نه ثبت دریافت یا تماس خودکار |
| POST `/api/admin/inventory/sourcing-receipts` | دریافت واقعی idempotent با inventory.write، provenance/سریال |
| POST `/api/admin/sourcing/requests/{id}/ready` | تخصیص واقعی و آماده‌کردن خرید با snapshot/مهلت معتبر |
| POST `/api/sourcing/requests/{id}/offers/{offerId}/convert` | تبدیل اتمیک یک بار به CartOfferLines مالک؛ بدون سفارش |
| GET `.../commands/{operation}/{commandId}` | receipt actor/operation/target؛ مشتری و مدیر allowlist جدا |
| POST quote/order عادی نسخهٔ جدید | محاسبه/سفارش معتبر با grant و انتقال allocation؛ provider غیرفعال موفق نمی‌شود |

فهرست/تاریخچهٔ offer، supply و receipt صفحه‌بندی مستقل و cursor مقید به مالک/هدف دارد؛ graph نامحدود در request detail include نمی‌شود. هر پیشنهاد snapshot محدود تایپ‌دار و تصاویر نسخه‌دار دارد؛ فایل واقعی/اسناد تأمین خصوصی فقط از مسیر رسانه/مجوز واقعی و نه URL عمومی گزارش داخلی.

## آزمون‌های پذیرش لازم

1. SQL واقعی GUID-only با دادهٔ نمونهٔ مشخص: مدل بازار→SKU مشخص واقعی بدون stock→publish قیمت/مهلت→accept. صفر تغییر OnHand/Reserved، صفر Order/Payment و یک Acceptance/Grant؛ API مشتری canPay=false.
2. قیمت9007199254740993 و Int64.MaxValue، ضرب/جمع overflow، null/صفر، decimal(28,8)/false/گزینه/واحد FA/EN؛ هیچ افت دقت در SQL→API→BFF→UI.
3. draft خصوصی/offer مالک دیگر، mfa_pending، catalog/content-only و نقش sales.read نتوانند publish/accept/receive کنند؛ receipt actor/operation/target و overposting مستقل آزموده شوند.
4. same UUID+payload در publish/accept/receive/ready/convert یک اثر؛ payload متفاوت409. بعد از expiry، حذف ردیف cart، تغییر درخواست یا مصرف سفارش replay اثر تازه نسازد. UUID فرمان با resource ثابت در مسیر دیگر404/تعارض امن بدهد.
5. accept هم‌زمان با withdraw/supersede/expiry/تغییر مادی کاتالوگ فقط یک نتیجهٔ سازگار؛ snapshot پذیرفته‌شده پس از ویرایش منبع/کاتالوگ ثابت و نسخهٔ قبلی قابل پذیرش نباشد.
6. دریافت بخشی/دوباره‌واردشدن reference/سریال تکراری/واحد نامعلوم/مدل متفاوت؛ فقط دریافت واقعی ledger و OnHand را یک بار تغییر دهد. خرابی receipt/audit کل دریافت را rollback کند.
7. دو مشتری آخرین واحد واقعی را برای Ready تخصیص دهند؛ دقیقاً یک allocation، Available منفی نشود. ordinary checkout هم‌زمان با allocation و انتقال به سفارش همین invariant را حفظ کند.
8. transfer به سفارش در رقابت با expiry/cancel-supply/withdraw پس از پذیرش، یک برنده؛ انتقال اتمیک SourcingReserved→Reserved، هرگز stock موقت آزاد یا دو بار کم نشود. سفارش مصرف‌شده با لغو درخواست آزاد نشود.
9. quote برای صاحب allocation سهم خودش را ببیند و دیگری نبیند؛ مجموع ردیف عادی+توافقی همان SKU از ظرفیت تجاوز نکند. receipt قدیمی allocation منقضی را قابل استفاده نکند.
10. conversion با cartVersion کهنه،۶۴ردیف، overflow، ordinary sameSKU و ردیف sourcing تازه؛ هیچ lost update/overwrite/مصرف اقلام دیگر. افزودن دوباره پس از remove فقط با عمل صریح تازه و حدود grant باشد.
11. قیمت عمومی عوض شود ولی توافق معتبر باقی بماند؛ توافق مشتری دیگر/منقضی/مصرف‌شده قابل استفاده نباشد. تغییر گارانتی/گزارش دستگاه/نوع محصول/انتشار و روش خرید quote قبلی را بی‌اعتبار کند و تغییر مادی رضایت تازه بخواهد.
12. quote4→OrderService با هزینه/مالیات تعیین‌نشده یا provider خاموش سفارش/پرداخت جعلی نسازد. در QA سیاست‌های مصنوعی فقط با مجوز قبلی D21 و فقط در دیتابیس موقت باشند؛ اصلی تغییری نکند.
13. order snapshot provenance/قیمت/شرایط/رضایت را حمل کند؛ عادی و توافقی باهم محاسبه شوند، انتقال تخصیص و Hold عادی با خرابی receipt/cart/audit یکجا rollback شوند. quote قدیمی۱–۳ نتواند offerline را نادیده بگیرد.
14. دریافت/public Available مثبت→پنهان‌شدن بازار؛ allocation کامل/hold→Available صفر؛ expiry/release→بازگشت مثبت. درخواست و پیشنهاد خصوصی تاریخی حفظ و دکمهٔ تازهٔ بازار هیچ allocation دیگری را دور نزند.
15. Product/SKU/OnHand واقعی ولی hidden/future/inactive، برند/دسته غیرفعال، دست‌دوم بدون گزارش یا serial تخصیص‌یافته، و sample خارج Development خریدپذیری نسازند.
16. رخدادهای worker چندنویسنده و restart بین commit/پاسخ، cursor۲۰/۵۰ و filterbinding، note/cost/supplier private، no-store/PWA؛ snapshot و رسید byte bounds و Unicode.
17. مرورگر واقعی با حساب/MFA خود GUID QA: مدیر draft/publish/ویرایش نسخه/پیگیری/دریافت/ready، مشتری FA/EN/mobile/RTL قبول/رد/لغو/سبد/quote؛ قطع پاسخ پس از commit، unknown→ناوبری→lookup و همان UUID، دو تب/دو حساب و۲نویسندهٔ انبار.
18. رگرسیون کل SQL Cart/Merge/Quote/Order/Reservation/Serial و model checks/idempotent SQL؛ بکاپ/restoreِ schema جدید و smoke حفظ قیمت/Stock/CMS/حساب‌های اصلی پیش و پس از promotion. صرف compile، fixture یا UI از دادهٔ حافظه پذیرش نهایی نیست.

## برش‌های اجرایی پیشنهادی

1. **Offer/consent واقعی SQL — محلی۲۹ پذیرفته:** draft/publish/snapshot/accept/decline/withdraw/expiry، grant غیرقابل‌پرداخت و UI/receipt؛ عدم اثر مالی/انبار حفظ است.
2. **تأمین دستی و دریافت واقعی — محلی۳۱ پذیرفته:** task/events، inventory receipt/provenance/unit/serial و جلوگیری از دوباره‌شماری؛ SQL و مرورگر/cleanup/انتشار پذیرفته‌اند، با حدود ثبت‌شده در STATUS. هلو زنده همچنان قرارداد لازم دارد.
3. **تخصیص و خرید — برش بعد، هنوز DRAFT:** SourcingAllocation/Available، CartOfferLines/Cart2/Quote4/OrderSnapshot2، تبدیل دقیقاً یک بار، price agreement و انتقال اتمیک به OrderService؛ SQL رقابت/خرابی و UI متصل کامل لازم‌اند. MARKET-02 قبل از این مرحله کامل نیست.
4. **اتصال و تحویل کامل:** provider واقعی، هزینه/مالیات/شرایط مورد تأیید مالک، پرداخت/چک/ارسال/مرجوعی، هلو قرارداددار، Linux/restore/پایش و همهٔ شروط PDF. وابستگی بیرونی ثبت شود؛ برش‌های داخلی آماده همچنان ادامه پیدا کنند.

این پیشنهاد قیمت/مالیات/هزینهٔ ارسال/درصد چک/گارانتی/مهلت تجاری خاصی را از طرف مالک تصویب نمی‌کند. پارامترهای واقعی باید از پنل و دادهٔ معتبر بیایند و تا آن زمان blocker روشن بمانند؛ blocker خارجی بهانهٔ توقف Offer/consent/تأمین داخلی نیست.
