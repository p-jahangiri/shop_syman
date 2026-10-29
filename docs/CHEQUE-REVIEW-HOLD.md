# مهلت صریح بررسی سفارش چکی — source70 در ساخت

اصلی۶۹ پذیرفته و ثابت است. D35 دریافت پیش‌پرداخت و تأیید همهٔ چک‌ها را شرط اجازهٔ ارسال می‌داند؛ تنظیم مهلت باید مستقل از اعتبار کوتاه محاسبهٔ قیمت، و برای سفارش تازه باشد. این برش مهلت بررسی **۱ تا ۶۰ دقیقه** را صریح و نسخه‌دار می‌کند؛ سقف فنی همان قرارداد فعلی Inventory است. مهلت بیش از یک ساعت به قرارداد مستقل Inventory و پذیرش جدا نیاز دارد و این برش آن را ادعا نمی‌کند. هیچ مدت پیش‌فرض یا سیاست اصلی فعال نمی‌شود. D21اجازهٔ نمونهٔ۶۰دقیقه فقطQA است.

FinanceMFA/finance.read وضعیت و تاریخچه؛finance.write فرمان Enable با Minutesصریح۱..۶۰ یا DisableباMinutesnull و Confirmedصریح می‌دهد. حالت اولیه بدونpolicy؛نسخهٔrowversion/CAS/actorUUID/hash/receipt،rootIdentitySalesSerializable/auditاتمیک. Salesمالکhead/revision/commandوسندimmutableReviewHoldهرسفارشجدید است. Enable/Disable revisionتازه دارد؛تاریخچهپاکنمی‌شود. هیچسفارشیبااینفرمانتمدید/لغو/فعال نمی‌شود. policyعمومیPIIندارد؛یادداشتآزادیاsecretندارد؛actorفقطaudit/مدلخصوصی. limit/historybounded/Downguard.

تاpolicyفعالنیست،خریدچکیقبلیهمانرفتارکوتاهِclampبهQuoteTTLرا دارد. policyفعال فقطبرایسفارشجدید:Readinessنسخهومهلتحداکثررا نشانمی‌دهد؛مشتریدرفرمهماننسخهراصریحمی‌پذیرد؛commandبهPolicyVersionمقید،نسخهقدیم/خاموش‌شده409. optionalfieldدرورودی/نتیجهwhen-nullحذفمی‌شودتاhashورودی/رسیدتاریخیv1بی‌تغییربماند؛تغییرقراردادنبایدreplayسفارشقدیمیرا بشکند.

درزمانCreate،quoteبایدهمچنانمعتبر باشد و تاپیشcommitدوبارهبررسیشود؛policyعمرقیمتراعقبنمی‌برد. پسثبت،deadlineسفارشتازهبهحداکثرNدقیقهپسایجاداست؛بهscopeExpiryوحقوقفعلیموجودی/acceptedallocationوPurchaseUntilنیزclipمی‌شود. برایacceptedstockحدودقبلیاستثنانمی‌خورند. cashوغیرچکیهمانحدودقبلیرا دارند. سندسفارشpolicyRevision/PolicyVersion/Minutes/QuoteExpiresAt/ExpiresAtثبت‌شدهراimmutablyنگهمی‌دارد؛رسیدنقدی/بانک/Paid/مجوزارسالایجادنمی‌شود. نمایشحداکثرنهتعهدبهdeadlineنامحدود،deadlineنهاییدرسفارشواضحاست.

readpolicylifecycleباSharedappgateتاcommit،فرمانcmd→Exclusivepolicygate؛policywriterهیچowner/credit/cart/stockقفلنمی‌کند. Createپسreplayownerمحفوظ،policyreadوتأییدنسخه،quote/currentfacts/stock/scopeclaim/مصرفسبدباrootتراکنشقبلی. deadlineقدیمی،scopeuseمصرف‌شده،allocationconsumedیاhistoricalreceiptتغییرنمی‌کنند. ادغاممالی نهاییD35درمرحلهبعد.

پذیرش: ابتداunset/بدونحدس،Enable/Disable/CAS/replay/receipt/auditrollback/role/MFA/origin/query/immutable/FK/Down؛neworderباquote۵دقیقهومهلتQA۶۰دقیقه/مرزscopeوacceptedrights،oldorderورسیـد/hashقدیمحفظ،quoteTTLحتیحینرزروبایدتاcommitمعتبر،cancel/expiryآزادسازیبدوناحیا،عدماثرcash،پنلreviewfalse/actionblank/unknownGETsameUUID/authlogout،customerFAENباپذیرشنسخه/مبلغریالstring. SQLواقعی/مرورگر/artifactثابت/QAcleanup/backup/حفظداده/HTTPپیشmain70لازم‌اند.


## پذیرش و انتشار محلی۷۰

A81 و STATUS مرجع شواهد نهایی‌اند: ۱۰۹۵unit/۷۵۳SQL/۵۰۷front/۲۱۷admin/۲۱proxy،۳۰SQLwire/۲۵browserwire،QAجمع؛۴جدولSalesخالی،۵FK،۶۹historyقبلی و داده/schema/views محفوظ،۱۸۸۱HTTP وbackupتأیید. سیاست اصلی همچنان unset است؛ مجوزنهایی مالی/تعهد موجودی/ارسال D35 در ادامه است.
