# وضعیت HTTP صفحهٔ محصول — source77 پذیرفته، A89/A91

Known issue در PLAN: notFound پس آغاز streaminglayout صفحهٔ ظاهراً404 باHTTP200 می‌ساخت. همان الگوی پذیرفتهٔ CMS پیش از streaming برای `/fa/product/{slug}` و `/en/product/{slug}` اضافه می‌شود. CMSredirect مقدم است؛ محصول واقعاً غایب باrewrite داخلی/no-store/noindex به404 می‌رود. خرابیAPI/بدنه/timeout/مغایرتقرارداد503/no-store/noindex/RetryAfter60 است، نه404 یاfallbackنمونه. ناموجودی انبار به‌تنهایی404 نیست؛ کالای عمومی باصفرموجودی همچنان وجود دارد.

Precheck از همان POSTعمومی `/api/catalog/{locale}/lookup` با یکslug معتبر استفاده می‌کند؛ قاعدهٔ نمایش جدا و ناسازگار باlookup ساخته نمی‌شود. پاسخ حداکثر1MiB،JSON/UTF8/locale/slug/حدیکproduct باdecoderتولیدی، credentialsomit/redirecterror/no-store وبدونCookie/Authorization؛بدنه بهمرورگر منتقل نمی‌شود. upstream404 بهمعنایعدموجودendpointو503 است؛ فقط200باproducts[] نشانmissing. درpreviewفقطfixtureصریح،ProductionبدونSHOP_ENABLE_PREVIEW=true unavailable است. Gateخواندنی یکlookupاضافیبهدرخواست محصول می‌افزاید؛ پذیرشperformance کلی نیست.

بک‌اند وmigrationجدید ندارد؛ همان76migration وDLLثابتpolicy76. storefront77بایدbuildایزوله وHTTPواقعیFAEN/preview/API/قطعAPI/slugنامعتبر/حفظredirectCMS/privatecache را بپذیرد. source77 پذیرفته است؛ هنوز روی اصلی منتشر نشده است. source76سیاست worker مستقل باstorefrontثابت75 پذیرفته می‌شود؛ source77 را جای آن جا نزنید. اصلی72/انتشار73منتظرسؤالمحدودتوقف محفوظ‌اند.


## پذیرش A91

530front (3caseتازه)،typecheck وNextisolatedproductionbuild پاس. 28HTTPواقعی رویAPISQLموقت وpreviewصریح:FAENmissing/invalidslug404،queryvariantهمان404،HEADbodyempty404 وRSC404،کالایzero-stock200،previewProductionبدونflag503،faultفقطlookupباCMS/سایرAPIسالم503بدونfallback،catalogهمانfault200،رفعfaultمحصول200. بازنویسی404bodyمترجم/no-store/noindex وبدونSetCookie؛unconfiguredAPI404 راabsenceاشتباهاًفرضنمی‌کند. قواعدزندهvisibilityازAPIlookupپیشیناست؛CMSredirectترتیبکدقبلیرا حفظمی‌کند،تستpublishتازهٔredirectدراینبرشانجامنشد.

مرورگرFA RTL/EN LTR،ENmobileclient375=scroll375/inner390،بازگشتواقعیبهcatalog24productlinks و2console0 پاس؛actualstatusازnativeHTTPجداگانهثابتشد. QA_GUID62e19b20ad7342acb5878762322fd666 تمام199جدولازجملهنشست/مالی/موجودی/policyدقیقاًثابت،هیچwriteمالییاپیکربندینداشت. فقط1nativecatalogreadپیش28probe،نمونهSKUازSQLموقت. GUID/key/credential/پنجپورت5181/5182/3105/3106/3107/تب147–148جمع،viewportreset/QA0/main72descriptorsهمان.

final`tmp/product-http77-runtime-set.json` و`artifacts/checks/product-http77-{source-acceptance,public-smoke,browser-ui,final-sql,qa-cleanup}.json`مرجع‌اند. backend/adminدقیق76reused/14DLL+manifest/hashتأیید؛1130unit/777SQL/217admin/25proxyبههمانقبولیبدونتغییر76مستنداست،ادعایاجرایمجددآنهابعد77نیست. migrationهمان76 و77runtimeRevisionاست،migration77ساختهنشد. عملکردواقعی/WCAGکلیپذیرفتهنیست؛یکlookupاضافیفقطبرایHTTPوجودمحصولاست. اصلی72وفروزن73/75/76محفوظ‌اند؛انتشار73هنوزمنتظرهماناجازهٔمحدوداست.
