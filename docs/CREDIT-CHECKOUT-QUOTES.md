# محاسبهٔ چکی مقید به مجوز — برش۶۱ پذیرفته

اصلی محلی۶۱ پس از پذیرش SQL/قرارداد/مرورگر/حفظ‌داده منتشر است؛ A63 و STATUS مرجع شاهدند. quoteهای۳/۵ و تاریخچهٔ آن‌ها تغییر معنا نمی‌دهند. یک محاسبهٔ مستقل Sales با snapshot همان quote عادی یا accepted-offer، scope صریح، نسخهٔ پرونده/مجوز و نتیجهٔ مقایسهٔ سقف ساخته می‌شود. قیمت/طرح/هزینه/موجودی صرفاً از server هستند؛ مبلغ درخواستی پرونده و inputclient جای آن‌ها نیست.

مشتری صاحب پرونده، cartVersion/methodId/planId/applicationId/scopeId/applicationVersion/scopeVersion و UUID را می‌فرستد. هیچ مبلغ/قیمت/درصد/انقضا در ورودی نیست. ForQuote ماژولCredit همان owner/Approved/currentreview/submission/currentScope/rowversion/plan فعال با نسخهٔثابت/expiry/عدمابطال را درrootSerializable وgateشرایط→پرونده بررسی می‌کند. سپس قفلcart و ترتیب منابع/تخصیص/stock quoteهای موجود حفظ می‌شود. انتخاب روش بایدcheque وطرح همانscope باشد. عادی ازهستهQuote3،سبد دارایacceptedOffer ازQuote5؛ هیچ قیمت توافقی باقیمت روزجایگزین نمی‌شود وusedreport همانsnapshot است.

مبنایPayableTotalRial باPayableTotalسرور وInstallmentsTotalRial باجمعcheckedچک‌ها(شاملmarkup/بدونdownpayment) مقایسه می‌شود. عدم تنظیمshipping/tax همچنانblockerاست؛ حتیوقتیbasisقسط قابل‌محاسبه باشد،نبودجمعنهایی نادیدهگرفتهنمی‌شود. مبلغ/expiryعینscope،مهلتquote حداقلscopeExpiry وbaseQuoteExpiry است. snapshotهزینه/قیمت/روش/طرح وscope جدا وimmutable می‌مانند. یکscope می‌تواندقبل ازمصرف چندمحاسبه داشتهباشد؛quoteرزرو/مصرفبودجه/اعتبارگرداننیست.

رکورد/receipt/audit درSales وIdentity اتمیک وactor+UUID/bodyثابت‌اند. UUIDهستهquoteباdomainseparation ازUUIDفرمانجدید مشتق می‌شود تاهمانUUIDقدیمیQuote3/5 اشتباهbindنشود. نتیجهٔتاریخیپسابطال/expiry بازنویسی نمی‌شود؛caller بایدزمانsnapshot/expiryراببیند،checkoutواقعیهمهauthorityها رادوبارهبررسیخواهدکرد. rootقراردادهاازDbContextماژولدیرنمی‌خوانند.

**canPlaceOrder/canPay دراینبرشfalse؛credit_order_not_configured صریح است.** برشبعدی بایدرضایت دقیقquote،claimیک‌بارمصرف وguardUsed/raceRevoke→Order/reservation/audit را اتمیک کند. فعال‌سازی chequeorder بدوناینپذیرش مجازنیست؛scopeصرفاًgrantشدهبهسفارشخودکارمبدلنمی‌شود.

رابطانتخابscopeبدونdefault وRAMjournalمقیدبهحساب/UUID/نسخه؛unknown→receipt/retryهمانbody،logoutپاک‌سازیخصوصی،مبالغString/BigInt/تومانفقطنمایش. backendتعیین‌کنندهٔمالک/eligibilityباقی‌می‌ماند. QAدادهکاملاًساختگی وD21فقطQA؛policy/مدرک/متنحقوقی/providerاصلیساختهنمی‌شود. پذیرشSQL واقعی/دسترسی/همزمانی/rollback/ریال/overflow/planchange/expiry/revoke،BFF/journal/UI/مرورگر/cleanup/backup/حفظداده/ارتقایمحلی لازم است.

## حدود پذیرش۶۱

۹۸۹unit/۶۹۶SQL/۴۴۴storefront/۲۱۴admin/۱۳proxy؛۱۸SQLwire،۴browserwire/۳quote/۱قطع→۱receipt/۰duplicate. ordinary/mixed/accepted-onlyدرSQL،مرورگرفقطordinaryبود. FAEN/mobile/desktop/logoutacrosstabs/ابطالمجوزپذیرفته؛RAMپسreload/تغییرزبانحفظنیست،SQLreceiptتاریخیحفظاست. اصلی۶۱فقط۱جدولخالیبهSQLاضافه‌کرد؛هیچpolicy/role/creditcase/providerساختهنشد. سفارش/claim/پرداخت/سررسیدهمچنانبازند؛customerhistoryپسreloadنیزدرادامهتکمیلشود.
