# نظرات کاربران؛ برش در حال پذیرش

کد و اصلی۴۰ محلی منتشرند؛ مرجع `reviews40-main-release.json` است. پذیرش این برش دسکتاپ است و موبایل هنوز باز است. نظرات داخلی از کاربران همین فروشگاه‌اند؛ هیچ متن یا امتیاز خارجی، دیجی‌کالا یا نشان خریدار ساختگی وارد نمی‌شود. نمونه‌ها فقط QA مشخص و قابل حذف‌اند.

Reviews مالک پنج جدول Reviews/Revisions/Commands/Events/Reports و context مستقل است. Catalog فقط انتشار کالای فروشگاه را از قرارداد خواندنی پاسخ می‌دهد؛ Sales واقعیت سفارش Paid/Fulfilled غیرDemo را برای حداکثر۲۰جفت صاحب/کالا، از هر دوsnapshot1/2 می‌خواند. برچسبverifiedBuyer در ورودی وجود ندارد. حساب/شناسهٔ صاحب/نام خصوصی در projection عمومی نمی‌رود.

برای هر حساب/کالا یک نظر است؛نام عمومی۶۰،عنوان۱۰۰،متن۱۰–۲۰۰۰نویسه،امتیاز۱–۵،زبان اصلیFA/EN و رضایت انتشار لازم‌اند. متن ساده و Reactescaped است؛ HTML اجرا نمی‌شود. ویرایش یکrevisionتازه immutable می‌سازد، نظر راPending و پاسخ قبلی راازنمایعمومی خارج می‌کند. پنل باcms.read/write،MFA،نسخه/RevisionId وrootSerializable/audit تأیید/رد/پنهان/پاسخ را انجام می‌دهد؛رد/پنهان دلیل لازم دارد. دلیل داخلی عمومی نمی‌شود. گزارش چهار reason شناخته‌شده،حساب الزامی،یک‌باربرای هرکاربر/نسخه و count پنل دارد؛ گزارش متن آزاد یا هویت عمومی نمی‌سازد.

فرمان‌ها باUUID/hash/actor وapplicationlock درtransactionSerializable رسید پایدار دارند؛retryهمانبدنه/شناسه replay،تغییر409. رسیدsnapshotهمانفرمان است؛ وضعیت جاری باGETخوانده شود. رابط درقطعپاسخ فرم/UUID را درهمانcomponentحافظه نگه می‌دارد و manualretryهماندرخواست را می‌فرستد؛بازخوانی صریح یاخروجازصفحه آن راکنارمی‌گذارد وازGETوضعیت بازیابی می‌کند. ادعایjournalپایداربینtab/reload ندارد. اتمیک‌بودن audit با constraintمحدودِQA وretryهمانUUID تست می‌شود.

صفحه‌بندی۲۰تایی برSequenceنزولیباcursordecimalstring است؛body/schema/cursor محدودند وsnapshotمشترکcount/page ادعا نمی‌شود. عمومی فقطApproved وکالایPublished/زمان/دسته/برندفعال است؛ تغییرنسخهحین projection با503دادهقدیمیرا رد می‌کند. هویتowner وگرهکالا/پاسخمجدداًهمبسته‌می‌شوند. GETهمخصوصاًno-store است؛BFFکوکی/توکنرا بهpublicforwardنمی‌کند،mutationبهorigincanonical/accountنیازدارد،UTF8/body/responseحددار وschemastrictاست؛تمام/api/ازPWAcacheخارج است.

Migrationافزایشی فقطschema reviewsاست؛Downرویhistory/receiptدارقبلDDL51000می‌دهد؛emptyDown/UpدرSQLواقعیآزموده می‌شود. پذیرش جاری:۴SQLهدفمند،۸۱۵unit،۳۰۸فروشگاه،۱۸۶پنل وbuild/typecheckموفق؛fullSQLنهایی،strictwire،مرورگرواقعی/نمونه/cleanup/حفظاصلی و انتشار۴۰باقی‌اند. موبایلcompareهنوزبهعلتviewportواقعی۱۲۸۰معلق است و نتیجهDesktopبهجایش پذیرفته نشده.


پذیرش نهایی:۸۱۵unit/۴۸۱SQLواقعی/۳۰۸فروشگاه/۱۸۶پنل،۸SQLwire/۱۳browserwire ومرورگرFAEN/lifecycle/۴responseقطعشده/نسخهقدیمی۴۰۹/cleanupموفق‌اند. Nextfinalbdiامتیازبازآزمودهشد؛شاخهcore رویbuildقبلیبود وقراردادها/API/adminثابت‌اند. انتشارفقطیکmigration/schemaReviewsو۶جدولخالی،حفظتمام۱۱۳جدولقبلیو۸۱۴GETموفق؛دادهٔQAبه‌اصلیمنتقلنشد. `STATUS.md` حدودdesktop/mobile وproviderها را حفظ می‌کند.
