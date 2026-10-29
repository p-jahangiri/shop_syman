# بلاگ چندزبانه — CMS-03/A94، source78 پذیرفته و منتشرنشده

پست مستقل از CmsPages و بدون تغییر قرارداد/جدول صفحهٔ ثابت است. مسیر `/fa/blog` و `/en/blog` و `/blog/{slug}`؛ slugثابت،FAENbodyوmetadataدرنسخهٔواحد،draft/save/publish/unpublish/restore،CAS/UUIDreceipt/auditاتمیک وhistoryappend-only. همان CmsPageBlockrenderer و قواعد متن/تصویر/لینک مصوب استفاده می‌شوند؛ HTML/اسکریپت آزاد یا authorازIdentityخصوصی استخراج نمی‌شود. هیچانتشار/نمونهٔاصلیدرstartup/migrationانجامنمی‌شود.

محتوا: Bodyدو‌زبانه،نوع نویسنده Person/Organization باانتخابصریح وbylineعمومیFAEN،coverاختیاریباaltهردوزبان،حد8tagباslugنامFAEN؛همه قابل ویرایش مدیر. draftنویسندهunsetدارد؛Publishعنوان/بلوک/authorهردوزبان معتبر می‌خواهد. tagهاcanonicalمرتب/متمایز؛نمایهٔrelationalدرهرrevisionازهمانJSONhashساخته ودرخواندن تطبیق می‌شود. IsDemoهنگامCreateصریح/ثابت ودرProductionغایب است؛برچسب نمونه وnoindexالزامی. حکم شخص/سازمان/تصویر واقعی از روی نام حدس زده نمی‌شود.

Cmsمالک BlogPosts/BlogPostRevisions/BlogPostCommands/BlogRevisionTags است. FirstPublishedAtفقطاولینPublish/Restoreتعیین وپسازآنimmutable؛listingجدیدترینانتشاراولیه/Id وDPcursorlocale+tag+cutoff/15min/page20،ویرایش وrestore ترتیبفهرسترا عوضنمی‌کند. publicreadبدونdraft/actor/privatefacts؛CMSread/write/MFAبرایپنل،rootIdentityCmsSerializable/audit،body وresponsebounded/noCookie/no-store/noindexخصوصی. پوششdemoباconfigمحیط،cursorبینمحیطی/فیلتر/زبانرد. privatehistory/receiptازpubliccurrentجداست.

پیشstreamوجودپست برای404/503،canonical/hreflang ازSHOP_PUBLIC_URL وگیتSEOموجود،BlogPostingباdatePublishedاولیه/dateModifiedنسخهجاری/authorKindصریح وnoindexنمونه،فهرست/sitemapخواندنی. لینکمنوعمومیازCMSقابلانتخاباست؛منویاصلییاپالیسیبدونفرمانمالکمنتشرنمی‌شود.

پذیرش لازم: CRUD/draft/publicFAEN/tags/authorvalidation،publish/restore/unpublish/CAS/replay/race/auditrollback/immutableFK/Down،SQLواقعی/TSdecoder/مرورگر/no-cache/recovery/logout/mobile،SEOHTTP/sitemap/حفظتمامجداولقدیمی/cleanup وfrozen. هنوزساخته/پذیرفته/منتشرشده محسوب نشود. source78شناسهruntimeخواهدبود؛migrationبعدی77استچونsource77HTTPmigrationنداشت. اصلی72وفروزن73/75/76/77تغییرنمی‌کنند.

## پذیرش source78

1138unit/786SQLfresh393+393/539front/217admin/26proxy؛137SQLwire با77POSTbinding و199browserwire با7POST/2receipt،2cut/0duplicate؛55HTTP نهایی+4unpublish404،FAEN/mobile375/dialog330/logout،QA203جدول/196دیگرexact/cleanup/main73ثابت پذیرفته شد. final`tmp/blog78-final-runtime-set.json` و`artifacts/checks/blog78-source-acceptance.json`مرجع‌اند؛طرح‌ها وپیشرفت‌های بالا قبلپذیرشتاریخی‌اند.

HTTP آزمایش واقعیت نشان داد NextResponse باLocationنسبی500می‌دهد؛cursorمنقضی303بهURLساخته‌شدهفقطازpublicOriginمعتبروtagمعتبر برمی‌گردد،Hostورودیمنبعredirectنیست. metadataخالیAPIصریحnull است. rowbuttons پنلwrap وmenuموبایل z40 بالاتر ازguard35 است. هیچindexing/menupublish/mainmigration/source78release انجام نشده؛نمونه‌ها فقطQAبودند و حذف شدند.
