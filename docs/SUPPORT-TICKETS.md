# تیکت خصوصی و پشتیبانی

برش تیکت خصوصی با اصلی۵۱ محلی پذیرفته و منتشر شده است؛ چت زنده و کل SUPPORT-01 هنوز کامل نیست. هدف SUPPORT-01 از PRD: مشتری فقط مکالمهٔ خودش را ببیند و پشتیبان مجاز پاسخ دهد. راهنمای نمایشی فعلی پشتیبانی واقعی نیست؛ چت SignalR/اعلان/فایل امن شاهد مستقل می‌خواهند و با ساخت تیکت کامل معرفی نمی‌شوند.

Support مالک ticket/message/event/command در schema مستقل support است. عنوان، متن پیام و رسید فرمان با DataProtection و purpose/version/ticket/record مقید رمز می‌شوند؛ دادهٔ تماس یا شناسهٔ کارکنان در DTO عمومی لازم نیست. هیچ متن/فایل/پیام به سرویس بیرونی ارسال نمی‌شود. پیوست تا اتصال مسیر فایل خصوصیِ اسکن‌شده فعال نمی‌شود.

گردش اولیه: ایجاد مشتری→Open؛ پاسخ مشتری→Open؛ پاسخ پشتیبان→WaitingCustomer؛ بستن صریح مشتریِ مالک یا پشتیبان→Closed؛ بازگشایی صریح→Open. پاسخ به Closed نیازمند بازگشایی جداست. این وضعیت‌ها صرفاً گردش پشتیبانی‌اند و هیچ پرداخت/مرجوعی/اعتبار یا سفارش را تغییر نمی‌دهند. هر پاسخ/وضعیت expected rowversion دارد؛ ایجاد/پاسخ/تغییر وضعیت با actor+UUID و hash همان بدنه، receipt تاریخی و rootSerializable پایدارند. message/event/receipt append-only؛ هویت/عنوان اولیهٔ ticket immutable است. هیچ حذف تاریخچه ساخته نمی‌شود.

نقش اختصاصی SupportAgent فقط support.read/support.write دارد؛ Administrator همهٔ مجوزها را دارد. Catalog/Content/Finance/Sales/Inventory صرفاً به خاطر نقش دیگر مکالمهٔ خصوصی نمی‌خوانند. کارمند از مسیر admin/MFA و audit اتمیک استفاده می‌کند؛ مشتری از JWT مالک و origin/BFF هم‌مبدأ. پیام plain text با محدودیت۴۰۰۰ و عنوان۱۲۰، FA/EN و UTC؛ نمایش تاریخ تهران. فهرست حداکثر۵۰ با seek بر Sequence ایجاد و فیلتر state، پیام‌ها۵۰تایی به ترتیب ثبت و cursor مقید به scope/ticket. فقط مالک سرور، هیچ owner ورودی. همه no-store/noindex و خارج PWA.

محدودیت ظرفیتِ ضدسوءاستفاده، نه سیاست تجاری: حداکثر۲۰تیکت باز همزمان برای هر مالک، با گزینهٔ فنی قابل پیکربندی؛ نرخ درخواست محدود. پیام‌ها صفحه‌بندی می‌شوند و تاریخچه با پاسخ جابه‌جا یا حذف نمی‌شود. بازگشایی نیز سقف باز را رعایت می‌کند.

پذیرش لازم: SQL واقعی مالک/نقش/MFA، races reply/close و replay با همان UUID/body، رسید پس از پاسخ‌های بعدی، rollback/audit، append-only و تمام SaveChanges، متن رمزشده و عدم نشت بین ticket/record، pagination/cursor/دو زبان، rawwire decoder، رابط مشتری/پنل و قطع پاسخ/بازیابی، migration افزایشی و Down حافظ تاریخچه، cleanup GUID و backup/حفظ داده‌های اصلی. provider SMS/Email و SignalR/notification/attachment/live chat هنوز بخش‌های جدا و بازند. هیچ دادهٔ نمونه بدون برچسب و خارج QA وارد اصلی نشود.

در دیتابیس ارتقایافته ممکن است ردیف نقش SupportAgent هنوز وجود نداشته باشد. فقط هنگام اعطای صریح نقش مجاز از پنل Administrator، RoleManager در همان transaction قفل‌شده و auditشده ردیف را می‌سازد؛ startup/migration کسی را پشتیبان نمی‌کند. شکست audit باید ایجاد نقش/عضویت/stamp را هم برگرداند.


## پذیرش محلی۵۱

۸۹۶واحد/۶۳۴SQLواقعی/۳۵۲فروشگاه/۲۱۲پنل/۳proxy و۱۱wireSQL+۶۱wireمرورگر/۸ورودی مثبت‌اند. Source/harness/runtime۱۳DLLبرابر؛modelبدونpending. GUIDQAباSupportAgent/MFAواقعی،دوپاسخcreateودوstaffreply200قطع،sameUUID/bytebody/receipt/ناوبری،ردstale409/بستن/بازگشایی/دو زبان/plaintextHTMLموفق؛۱۴۲جدولسنجیده/۱۲۶سایردامنه‌هابرابر/تنها۳پیام/۵رسید،QAوkey/credential/tabهاپاک. actualviewport۱۲۸۰است؛mobileپذیرفتنشد. قبلunresolved ازfullnavigationمحافظتشد؛پسackزبانعوضشد،حفظRAMدرفولreloadادعانشود.

پسازbackup۱۸٬۹۹۳٬۱۵۲بایتیCOPY_ONLY/CHECKSUM/VERIFYONLY،Supportچهارجدولخالی+historyافزود؛تمام۱۳۷جدولقدیمیحتیIdentityroleوتعریف‌ها/viewمحفوظ‌اند.۹۰۹HTTP/assetو401/no-store وپسآنهر۱۴۲جدولبرابرپذیرفته‌اند. `support-ticket51-main-release.json`/source-acceptance/browser-acceptanceمرجع‌اند. FAQهنوزCMSنیست،ورودازحساب/متنstaffقابلتکمیل،SignalR/اعلان/file/providers/nativeLinux/loadوموبایلبازند؛پذیرشتیکتجایآن‌هانیست.
