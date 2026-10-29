# کاتالوگ صفحه‌بندی‌شدهٔ سرور

به‌روزرسانی اجرای متصل: دوازده migration/seed اعمال و چهار سناریوی SQL واقعی محلی پاس شدند؛ سناریوی Catalog همین جست‌وجو، وراثت تنوع، پنج نوع ویژگی، ۸۲ گزینه/صفحهٔ پنجم/انتخاب بیرون صفحه و repair را آزمود. شمارش‌های پایین، شاهد برش‌های قبلی‌اند. وضعیت زندهٔ SQL پس از خطای دیسک Docker در STATUS ثبت می‌شود؛ این شاهد محلی جای query plan/بار و Linux x64 نهایی نیست.


وضعیت 2026-10-22: query و قرارداد API پیاده و build شده‌اند؛ ترجمهٔ SQL و مرز ورودی آزموده شده، اجرای مثبت روی SQL واقعی هنوز تأیید نشده است. فروشگاه به metadata-only و query/lookup محدود متصل شده است؛ preview تولیدی در HTTP و مرورگر بررسی شد. این شاهد اجرای مثبت SQL یا پنل متصل نیست.

## API عمومی

| مسیر | ورودی/خروجی |
|---|---|
| POST `/api/catalog/{fa|en}/search` | `CatalogSearchInput`؛ محصولات همان صفحه، `matchingVariantIds`، total/page/pageSize/totalPages و version/locale |
| GET `/api/catalog/{fa|en}/filters?categoryId=...` | برندهای مرتبط، نوع/عنوان/واحد ویژگی‌های قابل فیلتر، مقدار و label ترجمه‌شده، بیشینهٔ قیمت رشتهٔ ریال |
| POST `/api/catalog/{fa|en}/facet-values` | categoryId/key/query/page/pageSize/selectedValues؛ یک صفحهٔ مقدار و عنوان انتخاب‌های بیرون صفحه |
| POST `/api/catalog/{fa|en}/lookup` | حداکثر ۶۴ شناسهٔ محصول/تنوع یا slug در مجموع؛ فقط کالاهای منتشرشده و قابل نمایش |
| GET `/api/storefront/{fa|en}?metadataOnly=true` | همان قرارداد تنظیمات/CMS با `products: []`؛ مناسب bootstrap بدون ارسال کل کالاها |

POST جست‌وجو و lookup فقط خواندنی‌اند؛ هیچ سبد، سفارش یا اثر مالی ثبت نمی‌کنند. همهٔ پاسخ‌های API `Cache-Control: no-store` دارند. ورودی به کد SQL متصل نمی‌شود؛ queryهای EF پارامتری هستند.

نمونهٔ ورودی جست‌وجو:

```json
{
  "categoryId": "phones",
  "query": "سامسونگ ۲۵۶",
  "brandIds": ["samsung"],
  "minPriceRial": "10000000",
  "maxPriceRial": "9223372036854775807",
  "availableOnly": true,
  "sort": "price-asc",
  "page": 1,
  "pageSize": 12,
  "attributes": [{"key": "storage", "values": ["configured-option-id"]}]
}
```

این شناسه‌ها نمونه‌اند؛ کلید/گزینهٔ واقعی از تنظیم دسته و پاسخ filters دریافت می‌شود. حدود ورودی: page از ۱ تا ۱۰۰۰۰، pageSize از ۱ تا ۴۸، حداکثر ۸ ویژگی/۲۰ مقدار برای هر ویژگی، ۲۰ برند و ۸ واژهٔ جست‌وجو. مبلغ فقط رشتهٔ صحیح ریال در بازهٔ Int64 است. ترتیب‌های مجاز selected، price-asc، price-desc و newest هستند؛ ID یکتا tie-breaker نهایی است.

## معنا و مرز query

- کالا باید Published و موعد انتشارش رسیده باشد؛ برند، دسته و تنوع هم فعال باشند. انتخاب دسته، فرزندان فعال آن را شامل می‌شود.
- همهٔ قیود قیمت/موجودی/ویژگی روی همان candidate تنوع اعمال می‌شوند. وجود مقدار اختصاصی تنوع، مقدار همان ویژگی در محصول را override می‌کند؛ نبود آن به مقدار محصول ارث می‌رسد.
- در هر ویژگی چند مقدار OR هستند؛ میان ویژگی‌های مختلف AND است. Text متن کاملِ هر یک از دو ترجمه را می‌پذیرد؛ مقدار canonical فیلتر از فارسی با fallback انگلیسی و label از زبان جاری می‌آید تا تغییر زبان، انتخاب را خراب نکند؛ Number رشتهٔ decimal صحیح با حداکثر هشت رقم اعشار؛ Bool فقط true/false؛ Select/MultiSelect شناسهٔ گزینهٔ تعریف‌شده را می‌گیرند.
- ویژگی باید برای دستهٔ انتخاب‌شده قابل فیلتر باشد؛ در درخت دسته، rule دستهٔ واقعی هر محصول نیز بررسی می‌شود. گزینه یا کلید ناشناخته با 400 رد می‌شود.
- sort قیمت و `matchingVariantIds` ارزان‌ترین تنوع موجودی را انتخاب می‌کنند که تمام قیود را پاس کرده است؛ در نبود تنوع موجودِ واجد شرایط، ارزان‌ترین تنوع واجد شرایط مبناست. غیرفعال یا ارزان بودن یک تنوع دیگر روی آن اثر ندارد.
- count/group/sort/offset/take پیش از بارگذاری graph محصولات در SQL انجام می‌شود؛ فقط IDهای همان صفحه hydrate می‌شوند. همزمانی تغییر کاتالوگ ممکن است count/page را میان queryها جابه‌جا کند؛ این پاسخ snapshot سفارش یا تعهد قیمت نیست. checkout همچنان باید قیمت/موجودی را دوباره اعتبارسنجی کند.
- جست‌وجوی فعلی واژه‌های نام دو زبان، نام برند و SKU نرمال‌شده را تطبیق می‌دهد. این بخش جای Meilisearch/Typesense، مترادف، غلط املایی، پیشنهاد و جست‌وجوی کامل مشخصات را نگرفته است.
- فیلترها مستقل از صفحهٔ نتایج‌اند و count وابسته به فیلتر فعال ندارند. فهرست اولیهٔ هر ویژگی حداکثر ۲۰ مقدار و total/truncated دارد. مقادیر بیشتر با facet-values جست‌وجو/صفحه‌بندی می‌شوند؛ سقف هر پاسخ ۶۰ است و سقف کل مقدارها ۶۰ نیست.

## قرارداد خواندن موجودی

ماژول Inventory مالک view نسخه‌دار `inventory.AvailableStockV1` است: فقط VariantId و Available برابر OnHand - Reserved. Catalog آن را keyless و `ToView` نگاشت می‌کند؛ به InventoryDbContext دسترسی ندارد و حق نوشتن از این مدل ندارد. migration ساخت/حذف view فقط در Inventory است. جدول موجودی و قانون `Reserved <= OnHand` مالک همان ماژول می‌مانند. این مسیر خواندن مستقیم از دادهٔ commit‌شده است؛ رویداد یا outbox هنوز جایگزین گردش تراکنشی سفارش نشده است.

دلیل انتخاب، امکان filter/group/page موجودی در SQL بدون دریافت کل شناسه‌های انبار در حافظه است. این قرارداد به SQL Server مشترک این modular monolith وابسته است؛ جداکردن سرویس‌ها در آینده به قرارداد query جدید یا read model پایدار نیاز دارد. مرجع نگاشت: [EF Core keyless types](https://learn.microsoft.com/en-us/ef/core/modeling/keyless-entity-types). الگوهای query با provider نصب‌شده واقعاً به SQL ترجمه و آزموده شده‌اند؛ جزئیات تفاوت providerها در [Complex Query Operators](https://learn.microsoft.com/en-us/ef/core/querying/complex-query-operators) است.

view با SCHEMABINDING و نام جدول دو بخشی ساخته می‌شود. CREATE VIEW داخل EXEC ثابت قرار گرفته تا script idempotent بتواند آن را داخل شرط migration اجرا کند؛ قاعدهٔ batch در [مستند رسمی CREATE VIEW](https://learn.microsoft.com/en-us/sql/t-sql/statements/create-view-transact-sql?view=sql-server-ver16) آمده است. SQL تولید شده، هنوز روی سرور در اجرای محلی جدید پاس شد.

## مهاجرت و فیلد مشتق‌شدهٔ جست‌وجو

`CatalogSearchFields` سه فیلد SearchName برند/ترجمهٔ محصول و SearchSku تنوع، همراه index، اضافه می‌کند. تمام SaveChangesهای Catalog آن‌ها را با تابع مشترک NFKC، ی/ک، ارقام و فاصله یکسان می‌سازند. پول با این فیلدها یا float مخلوط نمی‌شود.

مقدار داده‌های قبلی پس از schema migration خالی است تا با جایگزینی تقریبی SQL به متن نادرست تبدیل نشود. `--migrate` پس از اعمال همهٔ migrationها، فیلدهای خالی را در batchهای ۲۵۰تایی با همان تابع برنامه بازسازی می‌کند؛ `--seed-dev` نیز همین مرحله را دارد. هر batch تراکنش RepeatableRead دارد و تغییر متن حین بازسازی را کنترل می‌کند. این عملیات با context بدون تغییر ذخیره‌نشده اجرا می‌شود.

اگر SQL script دستی اعمال شود، مرحلهٔ repair برنامه نیز لازم است:

```sh
python3 scripts/backend-local.py --repair-search-fields
```

این فرمان فقط فیلدهای خالی را تعمیر می‌کند و rebuild کامل موتور جست‌وجو نیست. readiness و search تا باقی ماندن فیلد خالی، 503 می‌دهند. migrationها/SQL قابل بررسی‌اند؛ هیچ‌یک در محیط فعلی اعمال نشده است.

## شواهد و ادامه

- `Shop.Tests`: ۶۷ تست موفق، شامل ۱۷ مورد تازه برای bounds/ورودی/انواع ویژگی/ترجمهٔ SQL/ترتیب قیمت و tie-breaker. این‌ها SQL را اجرا نمی‌کنند؛ `ToQueryString` ترجمهٔ provider واقعی SQL Server را بررسی می‌کند.
- `Shop.SqlTests`: سه سناریو compile می‌شوند؛ سناریوی تازه انتشار/عدم انتشار، والد/فرزند، تنوع غیرفعال و ناموجود، override و ارث‌بری، پنج نوع فیلتر، page/sort/lookup/bootstrap و repair را با SQL واقعی هدف می‌گیرد. در اجرای محلی جدید پاس شد.
- `scripts/test-sql-local.py` همچنان خروجی 2 داد: پورت 11433 آماده نیست؛ هیچ تست SQL یا تغییر دیتابیس انجام نشد.
- دو migration تازه و SQLهای idempotent Catalog/Inventory تولید شدند؛ بررسی EF نیز model change جامانده‌ای برای این دو context گزارش نکرد. اجرای آن‌ها و برنامهٔ query روی SQL محلی موفق بود؛ اندازه‌گیری query plan و بار باقی است.
- API محلی با endpointهای جدید بالا آمد: live برابر 200، search با pageSize=49 و lookup خالی برابر 400 و همه no-store؛ گزارش `artifacts/checks/catalog-api-boundary.json`. این شواهد مثبت SQL نیستند.

## اتصال فروشگاه و شواهد جدید

- root و metadata فقط `/api/storefront/{locale}?metadataOnly=true` را می‌خوانند؛ در صورت دریافت محصول در این پاسخ، مرز رد می‌شود. `LocaleProvider` با تغییر زبان مجدداً ساخته می‌شود و IDهای ذخیره‌شده به زبان جاری lookup می‌شوند.
- کاتالوگ SSR، query را از URL می‌خواند: `category,q,brand,min,max,available,sort,page,size,a.{key}`. برند/ویژگی تکرارپذیرند، مبلغ رشتهٔ ریال است؛ تغییر فیلتر page را به ۱ برمی‌گرداند. Back/Forward و لینک صفحه همان query را نگه می‌دارند. قیمت قابل ویرایش به تومان با حداکثر یک رقم اعشار است و سقف ساختگی ۲۰۰ میلیون حذف شد. drawer موبایل هنگام تغییر فیلتر باز می‌ماند. URL یا فیلتر ردشدهٔ API مسیر پاک‌کردن فیلتر دارد.
- خانه بر اساس CMS برای هر بلوک query محدود یا lookup IDهای مشخص دارد؛ تب‌های دسته فقط چهار کالا می‌خوانند. برندها از پاسخ filters می‌آیند. محصول با slug lookup می‌شود و حداکثر چهار مرتبط می‌گیرد؛ راهنمای چک با query محصول نیز lookup همان کالا را دارد.
- پیشنهاد Header حداکثر چهار نتیجه و debounce ۲۵۰ میلی‌ثانیه دارد؛ تغییر query یا بسته‌شدن پیشنهاد، درخواست قبلی را لغو می‌کند. موتور fuzzy یا مترادف هنوز پیاده نیست.
- سبد/علاقه‌مندی/مقایسه فقط شناسه و تعداد ذخیره می‌کنند؛ state نامعتبر/قیمت تزریقی کنار گذاشته می‌شود. lookupها در دسته‌های حداکثر ۶۴ ref و با commit یکجای نتیجه انجام می‌شوند. خطای میانی localStorage را تغییر نمی‌دهد؛ retry وجود دارد. دادهٔ محصول فقط حافظهٔ scope صفحه و انتخاب‌های فعلی است. قیمت/موجودی به storage یا worker افزوده نشد.
- BFF ورودی و پاسخ Zod، محدودیت ۳۲ KiB و no-store دارد؛ هیچ cookie/Authorization به API ارسال نمی‌شود. در بررسی مرورگر، mismatch میان Origin عمومی 127.0.0.1 و URL داخلی localhost پیدا و اصلاح شد؛ smoke معتبر اکنون Origin واقعی می‌فرستد و Origin نامرتبط 403 می‌گیرد.
- `npm test`: ۴۴ تست فروشگاه؛ پنج آزمون query/hydration و چهار آزمون دقت پول اضافه شدند. build تولیدی فروشگاه/پنل و TypeScript موفق‌اند؛ `Shop.Tests` ۶۷ و SQL tests فقط compile موفق‌اند.
- `smoke-catalog-gateway.py`: ۳۹ HTTP موفق، شامل مرز ورودی، دو صفحه بدون همپوشانی در دو زبان، شمار محدود کارت SSR، دریافت مبلغ تنوع در calculator و نبود `priceRial` در HTML اولیهٔ cart/wishlist/compare.
- `verify-catalog-failure.py`: پردازش مستقل API mode و upstream موقت 503؛ چهار عملیات خطا دادند، هیچ fixture برنگشت و upstream هیچ Cookie/Authorization آزمایشی دریافت نکرد. فقط پردازش‌های ساخته‌شدهٔ خود harness متوقف شدند.
- `verify-storefront-build.py` اکنون ۱۴ PWA/SEO، ۳۹ کاتالوگ/SSR و چهار قطع API را اجرا می‌کند؛ اجرای محلی موفق است، CI remote هنوز در اجرای محلی جدید پاس شد. گزارش‌ها در `artifacts/checks/` هستند.

مرورگر تولیدی: دو صفحهٔ مجزا، فیلتر گوشی/حافظهٔ ۵۱۲ و لینک تنوع `v2-black`، حفظ انتخاب پس از تغییر زبان، و بازیابی دو قلم قبلی سبد پس از خطا/retry/reload بررسی شد. فیلتر موبایل پس از افزودن برند باز ماند؛ clientWidth و scrollWidth هر دو 360 در viewport 375 بودند. پیشنهاد Anker سه نتیجه، تب لپ‌تاپ سه محصول و مقایسهٔ دو لپ‌تاپ/علاقه‌مندی Lenovo پس از reload بازیابی شدند؛ console error خالی بود. عکس‌ها: `sayman-cart-recovery.jpg`، `sayman-rial-precision-fa.jpg`، `sayman-catalog-filter-fa.jpg`، `sayman-catalog-filter-en-mobile.jpg` و `sayman-compare-hydrated-en.jpg` در `artifacts/screenshots/`.

## پول و quote چک

تومان در نمایش/ورودی دقیقاً ریال تقسیم بر ده است و باقی‌مانده با یک رقم اعشار حفظ می‌شود؛ Int64 به Number تبدیل نمی‌شود. درصد با دقت دو رقم به basis point صحیح تبدیل می‌شود. واحد گردکردن طرح ۱ یا ۱۰ ریال از پنل می‌آید؛ پیش‌پرداخت و markup رو به بالا، اقساط میانی رو به پایین و باقیماندهٔ دقیق در قسط آخر قرار می‌گیرند. پیش‌پرداخت به اصل محدود است و ماه/فاصله حداکثر ۶۰ و بخش‌پذیرند. مثال مرورگر: مبلغ ۶۸٬۹۰۰٬۰۰۰٫۱ تومان، چک آخر ۱۷٬۰۴۱٬۲۶۷٫۱ تومان و جمع دقیق حفظ شد.

این الگوریتم quote نمایشی است؛ نرخ و سیاست واقعی هنوز تأیید نشده و quote معتبر/سفارش سروری ساخته نشده است. `ChequeRoundingUnit` migration و SQL Credit تولید شده‌اند؛ در اجرای محلی جدید اعمال شدند. تست SQL آماده همچنین ذخیره/خواندن واحد ۱ ریال و درصد 12.34 را هدف می‌گیرد؛ هنوز در اجرای محلی جدید پاس شد.

گام‌های بعد: QA کامل پنل تا فروشگاه، سنجش query plan/بار و paging مدیریت. sitemap و DTO عمومی آفلاین فعلاً در سرور به snapshot کامل دسترسی صریح دارند؛ روت/صفحات مرورگر آن را دریافت نمی‌کنند. برای کاتالوگ بزرگ، آن دو مصرف‌کننده نیز به projection محدود/streaming نیاز دارند. PWA/SEO HTTP پس از این اتصال دوباره پاس شد و فهرست آفلاین خالی نشده است.

## مقدارهای فراوان ویژگی

`facet-values` با body زیر فقط یک صفحه می‌دهد؛ selectedValues برای حفظ عنوان انتخاب‌های بیرون صفحه است و انتخاب کاربر را تغییر نمی‌دهد:

```json
{"categoryId":"phones","key":"storage","query":"۲۵۶","page":1,"pageSize":20,"selectedValues":["configured-option-id"]}
```

پاسخ `version=1,locale,key,values,selectedValues,total,page,pageSize,totalPages` است؛ total فقط نتایج جست‌وجوی مقدارها را می‌شمارد و selectedValues مستقل است. page از 1 تا 10000، pageSize از 1 تا 60، query حداکثر 100 حرف/8 واژه و انتخاب‌ها حداکثر 20 مقدار یکتا هستند. کلید باید برای دسته/فرزندان فعال آن filterable باشد. هر شاخه در SQL count/order/skip/take دارد؛ کل گزینه‌ها برای صفحه بارگذاری نمی‌شوند. Select/MultiSelect همهٔ گزینه‌های پیکربندی‌شده را عرضه می‌کنند، حتی اگر فعلاً محصولی نداشته باشند. Text/Number فقط مقدار مؤثر تنوع فعال یا fallback محصول منتشرشده را می‌دهند. Bool دو مقدار ثابت دارد.

عنوان گزینه/Value و متن فارسی/انگلیسی در ذخیره با تابع واحد نرمال می‌شوند؛ جست‌وجو میان هر دو زبان است و تمام واژه‌ها باید تطبیق کنند. عدد با prefix رشتهٔ decimal SQL بدون float جست‌وجو می‌شود؛ unit در خروجی صفحه اضافه می‌شود. مقدار canonical متن همچنان فارسی با fallback انگلیسی است. این query موتور fuzzy، مترادف یا full-text index نیست؛ بررسی query plan و بار لازم است.

`FacetSearchFields` سه ستون مشتق‌شده اضافه می‌کند: AttributeOptions.FacetSearch غیر nullable با مقدار قدیمی خالی و Product/VariantAttributeValue.FacetSearch nullable. null متنِ دارای ترجمه به معنی تعمیرنشده است؛ null برای ویژگی غیرمتنی طبیعی است. متنِ نرمال‌شدهٔ خالی با رشتهٔ خالی از تعمیرنشده متمایز می‌شود تا repair بی‌پایان نشود. SaveChanges این فیلدها را بازسازی می‌کند و JsonIgnore مانع نمایش آن‌ها در خروجی مدیریت است. migration/SQL تولید شده و model check موفق است؛ روی SQL در اجرای محلی جدید اعمال شدند.

`--migrate`/`--seed-dev` و `--repair-search-fields` همان repair دسته‌ای 250تایی/RepeatableRead را برای این سه جدول ادامه می‌دهند. پس از SQL دستی نیز repair برنامه لازم است؛ readiness/search و facet-values تا باقی‌ماندن فیلد تعمیرنشده 503 می‌دهند. metadata بدون محصول دیگر Options را eager-load نمی‌کند؛ hydration صفحه فقط گزینه‌های مصرف‌شدهٔ همان محصولات و اعتبارسنجی query فقط IDهای درخواست‌شده را می‌خواند. پنل مدیریت هنوز pagination مستقل لازم دارد.

رابط هر گروه، جست‌وجوی 300 میلی‌ثانیه‌ای قابل لغو، صفحهٔ قبل/بعد، انتخاب ثابت بیرون صفحه، خطا/retry و سقف انتخاب هماهنگ با API دارد. مقادیر گزینه‌ها/عنوان انتخاب‌ها فقط در حافظهٔ همین صفحه‌اند. تغییر query مقدار ویژگی، فیلتر کالای انتخاب‌شده را حذف نمی‌کند؛ تغییر انتخاب، query کالای URL را به‌روز می‌کند.

شواهد: 44 تست فروشگاه، 67 تست بک‌اند و build تولیدی موفق. آزمون غیر SQL، صفحه‌های 85 مقدار، انتخاب بیرون صفحه، جست‌وجوی ارقام/ی/ک و حفظ عنوان دو زبان را پوشش داد. سناریوی SQL با 82 گزینه، صفحهٔ پنجم، query فارسی و یافتن محصول از گزینهٔ بیرون 60 تای اول، prefix عددی، منع rule فرزند و repair compile شد؛ در اجرای محلی جدید پاس شد. سه ورودی endpoint واقعی API قبل از SQL 400/no-store دادند (`facet-api-boundary.json`). harness عمومی 39 کاتالوگ/SSR، 14 PWA/SEO و چهار پاسخ قطع upstream را پاس کرد.

مرورگر روی محیط **نمونهٔ صریح** `scripts/serve-facet-ui-preview.py` با 83 گزینه روی پورت موقت 3002 بررسی شد: صفحهٔ پنجم/انتخاب 512/برگشت صفحه/تغییر زبان، سپس جست‌وجوی 256 در موبایل با حفظ 512 و عرض 375 بدون overflow؛ console error خالی بود. این محیط API mode با upstream نمونه است و شاهد SQL واقعی نیست. تب، Next و upstream متعلق به آن بسته شدند؛ پورت 3002 بعد از آزمون بسته بود. اسکریپت وارد deployment نمی‌شود و auth/پرداخت/نوشتن ندارد.

عکس‌ها در `artifacts/screenshots/`: `sayman-facet-offpage-en.jpg`، `sayman-facet-search-en-mobile.jpg` و `sayman-facet-search-fa.jpg`. جست‌وجوی اصلی 3000 با ارقام فارسی ۲۵۶ هم انتخاب ۵۱۲ را حفظ کرد؛ گزارش دستی `artifacts/checks/facet-ui-qa.json`. فروشگاه عادی روی 3000 به build نهایی بازگردانده شد. دستور QA اختیاری، در حالی که preview عادی 3000 اجراست: `python3 scripts/serve-facet-ui-preview.py`؛ پایان با Ctrl-C فقط فرایندهای خود اسکریپت را متوقف می‌کند.
