# کاتالوگ بازار: مدل مشترک و انتشار مستقل

وضعیت جدید 2026-10-25: فیلتر دسته/برند با شمارندهٔ کل مدل‌های مجاز SQL و فیلتر برند پنل روی اصلی۴۲ منتشر است؛ [MARKET-FACETS](MARKET-FACETS.md) و STATUS مرجع این تکمیل‌اند. توضیح‌های زیر سابقهٔ برش اولیه‌اند؛ نبود dropdown/facet دسته و برند در آن مرحله، محدودیت جاری نیست. facet ویژگی‌های تایپ‌دار هنوز باز است.

وضعیت 2026-10-23: **بخش API/SQL پیاده و پذیرفته شده است؛ رابط بازار، فرم پنل، CSV و سبد درخواست تأمین هنوز ناتمام‌اند.** این برش کل MARKET-01/02 یا پروژهٔ PDF را کامل نمی‌کند. D28 ورود پنل/CSV را انتخاب کرده و منبع API خارجی وجود ندارد.

## مدل و مرز انتشار

مشخصات پایه، ترجمه، برند، دسته، تصویر و ویژگی تایپ‌دار همان Product کاتالوگ است. تنوع/SKU پیشنهاد قابل فروش است. مدل تازهٔ بازار با وضعیت فروشگاهی Draft و بدون تنوع/قیمت/Stock ساخته می‌شود؛ Published فروشگاهی همچنان تصویر، روش خرید و تنوع فعال لازم دارد. هیچ SKU صفرقیمت یا موجودی مصنوعی اضافه نشده است.

Market.Listings مالک انتشار بازار، منبع/شناسهٔ ردیف منبع، زمان مشاهده/اعتبار، وضعیت و قیمت مرجع اختیاری است. رابطهٔ ModelId یکتا و قرارداد ماژولی است؛ Market به CatalogDbContext دسترسی ندارد. view داخلی Catalog.MarketModelsV1 را Catalog می‌سازد و هر دو consumer آن را فقط می‌خوانند. وجود مدل در view یا اشارهٔ listing پیش‌نویس آن را عمومی نمی‌کند؛ فقط listing با Status=Published از API بازار عمومی است.

Product.Status حوزهٔ انتشار فروشگاهی است؛ **انتشار مستقل بازار، متن مشخصات مدل را صریحاً منتشر می‌کند** حتی اگر پیشنهاد فروشگاهی Draft باشد. Hidden کاتالوگ، کالای دیجیتال، برند/دستهٔ غیرفعال، ترجمه/تصویر ناقص و ویژگی پایهٔ اجباریِ غایب، eligibility بازار را می‌بندند. در بازار، مشخصات پایهٔ موردنیاز باید روی خود مدل باشد؛ وجود ویژگی صرفاً روی تنوع جای آن نیست. هیچ قیمت، SKU، گارانتی تنوع یا روش خرید خصوصی از مدل عمومی بازار صادر نمی‌شود.

ویرایش مدل از قرارداد Catalog، همهٔ SKU/قیمت/قیمت مرجع تنوع و روش/طرح خرید موجود را حفظ می‌کند؛ تغییر مشترک مشخصات آگاهانه است و نسخه‌های کاتالوگ می‌چرخند. مقایسهٔ همان مدل و تبدیل بعدی به پیشنهاد فروشگاه به کپی مشخصات یا ساخت مدل دوم نیاز ندارد. رابط آتی باید فرق انتشار فروشگاه/بازار و Hidden سراسری را روشن کند.

## منبع، مبلغ و نمونه

sourceKey و sourceItemKey برای تکراری‌نبودن منبع یکتا هستند؛ نام FA/EN و پیوند HTTPS بدون credential/query پذیرفته می‌شود. هیچ provider یا اسکرپری فعال نشده است. unknown یعنی نیازمند استعلام؛ available/unavailable نیازمند observedAt/validUntil سازگارند. با رسیدن به validUntil، وضعیت خروجی stale می‌شود. این تازگیِ ادعای ثبت‌شدهٔ منبع است، تأیید مستقل بازار نیست.

ReferencePriceRial اختیاری و مثبت، bigint صحیح ریال و رشتهٔ JSON است؛ صفر جای نامعلوم نیست. تاریخ و منبع لازم دارد، در جمع پرداخت/سبد فروش وارد نمی‌شود و هیچ قابلیت پرداخت یا رزروی ایجاد نمی‌کند. referencePriceCurrent فقط اعتبار زمانی ثبت‌شده را نشان می‌دهد. نبود مبلغ در DTO عمومی صریحاً null است.

IsDemo هم در write و هم در read خارج Development بسته است؛ restore دیتابیس توسعه به محیط دیگر نمونه را به بازار واقعی تبدیل نمی‌کند. سه نمونهٔ روشن «گوشی نمونهٔ بازار A/B/C» با مشخصات برگرفته از template توسعهٔ p3، unknown/available/stale، دو مبلغ مرجع مصنوعی و نام منبع Local development samples در SQL محلی وجود دارند. این‌ها گوشی واقعی قابل تأمین یا قیمت واقعی بازار نیستند.

```sh
python3 scripts/backend-local.py --seed-market-dev
```

فرمان فقط Development، با transaction Serializable هماهنگ‌شده در composition root میان Catalog/Market/Identity و audit سیستمی اجرا می‌شود. هیچ حساب، role، SKU، Stock یا سفارش نمی‌سازد. منبع نمونهٔ موجود را حتی اگر مدیر ویرایش کرده باشد حفظ می‌کند؛ اجرای دوباره Created=0/Preserved=3 دارد. CMS را تغییر نمی‌دهد. نبود template صریح p3 خطاست و از کالای دیگری به‌طور پنهان استفاده نمی‌شود.

## قرارداد API

| مسیر | رفتار |
|---|---|
| POST /api/market/{fa\|en}/search | عمومی و no-store؛ query/categoryId/brandId/page/pageSize، حداکثر۲۴ مدل در صفحه |
| GET /api/market/{locale}/{id} | فقط listing صریحاً منتشرشده و مدل eligible |
| GET /api/admin/market | catalog.read + MFA؛ فهرست۵۰تایی seek، query/status/categoryId و cursor وابسته به فیلتر |
| GET /api/admin/market/{id} | جزئیات منبع/انتشار و version |
| POST /api/admin/market/models | catalog.write + MFA؛ ساخت مدل بدون SKU و listing در transaction مشترک با audit |
| PUT /api/admin/market/models/{id} | ویرایش نسخه‌دار مشخصات مشترک و حفظ پیشنهادهای فروشگاهی |
| POST /api/admin/market | اتصال صریح مدل موجود به listing |
| PUT /api/admin/market/{id} | ویرایش نسخه‌دار منبع/انتشار؛ جابه‌جایی ModelId ممنوع |

Model input شامل categoryId/brandId/slug/translations/attributes/imageUrls/version است. attributes از همان تعریف/گزینهٔ رابطه‌ای Catalog استفاده می‌کند. Details input شامل status، sourceKey/sourceItemKey/sourceNameFa/sourceNameEn/sourceUrl، availability، observedAt/validUntil، referencePriceRial و isDemo است. فیلدهای ناشناخته رد و ورودی تو‌در‌تو نیز اعتبارسنجی می‌شود. create body برابر {model,details} و اتصال/ویرایش listing برابر {modelId,details,version} است. nullهای اختیاری جز مبلغ مرجع عمومی ممکن است با تنظیم serializer حذف شوند.

مجوز catalog.read همان نقش‌های فقط‌خواندنی موجود را حفظ می‌کند؛ ContentManager فهرست را می‌خواند و حق write ندارد. هیچ policy برای پاس‌شدن آزمون ضعیف نشده است. همهٔ writeهای HTTP همراه audit و ماژول‌ها در transaction اتمیک‌اند؛ تکرار شناسهٔ منبع، ساخت مدل و audit موفق را با هم rollback می‌کند. ساخت دستی هنوز receipt پایدار UUID ندارد؛ قطع پاسخ به refresh/بازخوانی منبع نیاز دارد، retry خودکار موفقیت فرض نمی‌شود. CSV receipt در برش بعدی اضافه می‌شود.

خواندن مدل و listing نسخه‌ها را دوباره بررسی می‌کند؛ صفحهٔ عمومی در تعارض read-only حداکثر دو بار تلاش و سپس503 می‌دهد. count/page مشترک، snapshot سراسری بازار/موجودی و SLA بار تضمین نشده‌اند. فیلتر ویژگی پویا، مدل‌کد/GTIN اختصاصی، چند منبع/تاریخچه و وضعیت خودکار کالای واردشده به موجودی هنوز مستقل کامل می‌شوند.

## اجرا و شواهد

- source و اصلی۲۳ migration/هشت schema دارند:۲۲ view داخلی Catalog و۲۳ Market.Listings. model check هر دو Context بدون تغییر جامانده و SQL idempotent در backend/sql/catalog.sql و market.sql تولید شدند.
- ۴۵۱ واحد بک‌اند موفق‌اند. مجموعهٔ کامل۱۴۲ SQL با صفر شکست/skip موفق شد؛ سپس یک SQL مستقل نمونهٔ توسعه، بی‌تکراری و عدم ساخت حساب/SKU/Stock را پاس کرد. مجموعهٔ۱۴۳تایی پس از افزودن این یک مورد دوباره یک‌جا اجرا نشده است.
- ۱۱ مورد بازار: MFA/نقش، مدل بدون SKU، استقلال انتشار، نسخهٔ قدیمی، rollback مدل/audit، مبلغ Int64 رشته‌ای/تازگی، Hidden، جست‌وجوی ارقام فارسی، انتشار ناقص، نمونهٔ ممنوع در Production، فهرست۵۰/۳ و cursor، حفظ قیمت/قواعد SKU. اجرای نخست۶موفق/۱شکست، به خطای EF مقایسهٔ null روی entity بدون کلید در left join رسید؛ با مقایسهٔ ModelId اصلاح شد. انتظار نقش ContentManager هم با catalog.read موجود هماهنگ شد؛ مجوز تغییر نکرد. اجرای بعد۷، سپس۱۱ و کل۱۴۲ موفق‌اند. شواهد market-sql-* و market-all-sql-* محفوظ‌اند.
- fixture SQL جدید پوشهٔ key ring خودش را0700 می‌سازد و بعد از حذف موفق SQL و توقف Factory فقط همان پوشهٔ GUID را حذف می‌کند؛ شکست cleanup SQL، کلیدش را برای بررسی حفظ می‌کند. فایل شخصی/volume حذف نشده است.
- COPY_ONLY/CHECKSUM/VERIFYONLY پیش از ارتقای۲۱→۲۳ با key ring خصوصی محفوظ است؛ main-pre23-backup.json. helper دستی backup-local.py فقط همین محیط ثابت محلی را پشتیبان می‌گیرد؛ production/offsite/زمان‌بندی نیست.
- API5080 از artifact مستقل tmp/api-runtime-market23-* اجرا می‌شود تا buildهای بعدی bin سورس فایل اجرایش را تغییر ندهند. tmp/api-runtime-current.json مسیر و PID جاری را دارد؛ backend-local.py --runtime-dir فقط artifact داخل tmp پروژه را برای serve بدون migration/seed می‌پذیرد. ContentRoot و key ring اصلی صریح‌اند. این artifact محلی Debug/framework-dependent است، image نهایی Linux نیست.
- market-main-state.json: main۲۳، سه نمونه بدون تنوع، هش تمام قیمت‌های SKU و CMS، کاربران/موجودی محفوظ، سفارش موقت همچنان خاموش/بدون تنظیم، DBCC PHYSICAL_ONLY صفر خطا، صفر دیتابیس SQL تست و Redis چت exited. API دو زبان و سلامت API/Next/admin موفق‌اند؛۲۸ smoke قبلی خانه/PWA/مسیرهای خصوصی روی API تازه هم دوباره موفق‌اند. مدرک moments-main-next-http.json با بازخوانی SQL۲۳ به‌روز و کپی جدید در market-core-moments-http.json ذخیره شده است؛ پذیرش نخست آن SQL۲۱ بود.

UI/CSV/سبد درخواست، پیشنهاد مدیر و قبول مشتری/تبدیل idempotent به SKU/checkout هنوز در ادامه‌اند. visual/mobile جدید، بار و native Linux مستقل و restore این schema جدید پذیرفته نشده‌اند؛ شاهد restore قبلی برای schema۲۱ محفوظ است. هیچ درگاه، پیامک، ایمیل یا بازنشر نظر خارجی فعال نشده است.

## ادامهٔ پذیرفتهٔ CSV و پنل

بخش UI/CSV معوق بالا با برش [MARKET-CSV](MARKET-CSV.md) تکمیل شد: اصلی/سورس۲۴، پنل فهرست/فرم/راهنما/CSV و رسید پایدار، کل۱۵۲ SQL و مرورگر متصل/موبایل/unknown-retry پذیرفته‌اند. رابط عمومی بازار/سبد درخواست/پیشنهاد و قبول/تبدیل هنوز باقی‌اند؛ MARKET-02 کامل نیست. [STATUS](STATUS.md) مرجع runtime فعلی است.
