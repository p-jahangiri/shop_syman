# نقشهٔ سایت صفحه‌های CMS — CMS-03، پذیرفته code-only پس۶۶

برش مستقل D34 در اصلی۶۶ با code-only پذیرفته و منتشر است؛artifactپیشین۶۶HTTP محفوظ وschema/migration تازه ندارد. بلاگ، redirect و بقیهٔ SEO با این برش کامل اعلام نمی‌شوند.

CMS مالک projection مستقل از صفحه‌های Published و غیرنمونه است: شمارش رشته‌ای و حداکثر۱۰۰۰slug/صفحه به همراه پرچم ترجمهٔFAEN و زمان واقعی revisionانتشار. DraftJson/BodyJson،عامل،هویت،موجودی/قیمت/روش خرید خوانده/برگردانده نمی‌شوند. Head باید به revisionمنتشر همان صفحه اشاره کند؛ unpublish از شمارش و صفحه خارج است و restore زمان نسخهٔ تازه را دارد. نمونه‌ها حتی در Development در sitemap نیستند. API جدید `/api/content/page-sitemap/{locale}` و `/entries?page=1` است؛ با slugهای مجاز صفحه،ازجمله `sitemap`، برخورد مسیر ندارد.

فهرست Next فایل‌های ریشهٔ `/sitemap-fa-pages-1.xml` وENرا فقط با همهٔ gateهای موجود ایجاد می‌کند: محیط HTTPS/SHOP_ENABLE_INDEXING،apiغیرpreview و اجازهٔSEOمنتشر همان زبان. محافظ isPreview موجود تغییر نمی‌کند؛ هیچ اجازهٔایندکس اصلی فعال نمی‌شود. Catalogmanifestقدیمی/schemaآن دست‌نخورده است؛ CMSmanifest جدا با owncount و intersection زبان‌های مجاز خوانده می‌شود. alternateها فقط زبان مجاز دارای محتوا، canonicalاز SHOP_PUBLIC_URL معتبر،lastmodاز زمان واقعی انتشارند. سقف مشترک index۵۰هزارفایل/۱۰۰۰URLهرصفحه،قراردادstrict/بدونcredential/حدstream/timeout/no-store/503درفرونت حفظ می‌شود؛ خطا یا ظرفیت بی‌صدا بریده نشود.

پذیرش اجراشده (شواهد دقیق STATUS): SQLواقعی۱۰۰۱صفحه و مرز۱۰۰۰/۱،draft/demo/unpublish/restore و دو زبان/SEOgate،queryبدونgraph،ورودی/ظرفیت/DTO؛decoderتولیدی باپاسخ واقعی وnativeXML باoriginجعلی/غیرفعال/preview/error/UTF8/محدودیتبدنه وحفظسایت‌مپCatalog. mainپسbuildهایثابت/QAcleanup/حفظهمهٔ۱۷۸جدول باcode-onlyrelease؛آزمونبار/عمقOFFSET/SearchConsole/productionIndexفعال‌سازی جداست.

پذیرش:۱۰۴۵unit/۷۳۱SQL/۴۸۶front،۱۲SQLwire،۵۱nativeXMLباfixtureصریحمصنوعی؛شاخصسازیواقعی یاSearchConsoleفعال‌نشد. admin۲۱۷/proxy۱۷ازartifactثابتقبلیreuse؛schema۶۶/۱۷۸جدولبدونmigration،۱۶۸۲HTTPوحفظداده/backupاصلیپذیرفته. CMS-03/blog/redirectوکلPDFباز/D34ادامه.
