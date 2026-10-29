# صفحه‌های محتوایی — CMS-02، پذیرفته در اصلی۶۶

D34 ادامه دارد؛ هستهٔ این سند در اصلی۶۶ با شواهد STATUS پذیرفته و منتشر است. سؤال بازِ زمان اجازهٔ ارسال سفارش چکی فقط کار مالی وابسته را متوقف می‌کند.

صفحهٔ مستقل با نشانی ثابت `/fa/pages/{slug}` و `/en/pages/{slug}`، متن ساده و بلوک‌های مصوب Text/Callout/Image/Links دارد. هر بلوک شناسهٔ ثابت، ترتیب و نمایش All/Mobile/Desktop دارد؛ HTML، اسکریپت و نشانی بیرونی آزاد اجرا نمی‌شود. دو زبان در یک سند نسخه‌دار ذخیره/منتشر می‌شوند؛ انتشار به عنوان و حداقل یک بلوک معتبر در هر دو زبان نیاز دارد. ذخیرهٔ پیش‌نویس مستقل از انتشار است.

CMS مالک Pages/PageRevisions/PageCommands است. slug پس از ایجاد ثابت و حذف سابقه ممنوع است؛ unpublish محتوا را از عمومی برمی‌دارد. rollback نسخهٔ انتشار تازه از محتوای یک revision همان صفحه می‌سازد، پیش‌نویس را بازنویسی نمی‌کند. شناسهٔ فرمان+عامل/hash ورودی، expectedVersion، قفل صفحه، root Identity/Cms Serializable و audit اتمیک از تکرار و انتشار کهنه جلوگیری می‌کنند. رسید تاریخی همان فرمان از وضعیت جاری جداست.

دادهٔ نمونه فقط با علامت صریح در ایجاد و خارج از Production قابل نمایش است. migration/startup سند، سیاست فروش، منو، نقش یا انتشار جدید نمی‌سازد. مشتری فقط محتوای منتشر همان زبان می‌بیند؛ draft/preview/history برای cms.read و staff/MFA، نوشتن برای cms.write است. پاسخ خصوصی no-store/noindex و عمومی no-store است تا لغو انتشار به cache قدیمی وابسته نباشد. canonical/hreflang فقط از SHOP_PUBLIC_URL معتبر و gateهای موجود SEO می‌آید؛ نمونه هرگز index نمی‌شود.

پذیرش اجراشده (حدود دقیق/اصلاح HTTP و شواهد در STATUS): اعتبارسنجی چندزبانه/بلوک/URL/ابعاد، immutable/FK/Down، SQL واقعی برای draft/public/restore/unpublish/role/stale/replay/race/audit rollback؛ decoder سخت TS و پاسخ واقعی؛ پنل دارای فرم و preview از همان renderer عمومی، recovery همان فرمان پس پاسخ نامعلوم؛ مرورگر فارسی/انگلیسی/موبایل و حفظ دادهٔ اصلی پس backup. بلاگ، redirect، sitemap صفحات، media upload مستقل و SEO گسترده همچنان CMS-03 باقی‌اند؛ کامل اعلام نشوند.

اصلاح نهایی Next، وجود عمومی را پیش از streaming بررسی می‌کند: missing/draft/unpublished به صفحهٔ۴۰۴محلی باHTTP404واقعی rewrite وAPIناموجود503/no-store می‌دهد. مجموعهٔ اولیه۶۶ وپذیرش آن حفظ،artifactHTTPجدا باQAدوم پذیرفته شد.۱۰۳۳unit/۷۲۸SQL/۴۷۹front/۲۱۷admin/۱۷proxy،۵۴SQLwire/۶۸browserwire و۱۰HTTPQA؛ اصلی سه جدول خالی و۱۶۶۸HTTP دارد. نقش/سیاست/صفحهٔ اصلی ایجاد نشده؛ CMS-03/کلPDF بازند.
