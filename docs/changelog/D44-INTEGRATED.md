# پذیرش بستهٔ یکپارچهٔ اصلی83

## تغییر

پذیرش بستهٔ یکپارچهٔ اصلی83

## فعال‌شده روی

بستهٔ تاریخی Sayman ۸۳.

## تأیید‌شده

unit-tested: ۱۱۷۲ واحد، ۶۲۱ فروشگاه، ۲۳۶ پنل و ۲۷ پراکسی. SQL-tested: ۸۵۶ مورد متمایز در دو گروه، بدون شکست یا skip. [شاهد بک‌اند](../../artifacts/checks/parcel-shipping82-final-backend-verification.json).

## تأیید‌نشده یا باز

مرورگر برای receiving/allocation/convert و همهٔ نماهای موبایل پنل پذیرش کامل ثبت نکرده است.

## شواهد

[شاهد بستهٔ یکپارچه](../../artifacts/checks/parcel-shipping82-final-backend-verification.json).

## سابقهٔ منتقل‌شده

## پذیرش بستهٔ یکپارچهٔ اصلی83

- Backendcore:1172unit،856SQL متمایز/0fail/0skip در449+407؛14DLL exact درAPI/unit/SQL/حوزهٔ مرورگر. `parcel-shipping82-final-backend-verification.json` وfinalbatchplan/log/TRX مرجع‌اند. fixtureهای migration پس Down ناموفق بهlatest برمی‌گردند؛ خطاهای تاریخی rawمحفوظ‌اند.
- Frontend621/admin236/proxy27، strictTS و buildهای Next/Admin پاس. D41finalUI سه‌فایل به sourcemap runtime تطبیق داده شده؛ `phone-d41-source-acceptance.json` و `phone-d41-final-runtime-parity.json` مرجع‌اند.
- Wireواقعی:مرسوله30پاسخ/9فرمان/5عمل وclearance100پاسخ decodeشدند. مرورگر مرسوله دوpack/یکrepack/دوdispatch/دوdeliver،7POST/7UUID/0duplicate،قطعپسcommit→GETreceipt،IMEIپسخروج وlogoutچندتب را تأیید کرد؛ تماماًFulfilled شد. FA/ENمشتریactual360=scroll360 پاس؛ adminmobileکامل82 هنوز پذیرفته نیست.
- D41:8مدل/67ترکیب،فیلترهای سریع/back،guest→loginmerge،ترکیبimmutable،interest،درخواستSR-1،پیشنهاد رسمی/رضایت مشتری،workerاعلانstockواقعی+1 باmovementواحد/اعلان یکتا و65sمشاهده،دو مالک/logoutچندتب،FAEN/RTL-LTR/lightdark/mobile/keyboard/focusreturn بررسی شدند. نمونهٔ قیمت/انبار فقط GUIDfixture بود؛ از آن به اصلی importنشد. مسیر receiving/allocation/convert مرورگرپذیرفته نیست؛SQL دارد.

QA اختصاصی run b292a63685bd4f3c976edb906dbf2bd9 کامل retireشد:4listener،2تب162/163،GUID وcredentials حذف و masterعدموجودDBرا تأیید کرد؛ `parcel82-exclusive-phone-retired-d44.json` مرجع است. علاقه‌مندی پس قطع باreceiptGET بازیابی شد؛ درخواست تأمین موقع outage هرگز commitنشد/COUNT0 پس بازیابی. QA قدیمی مرسوله و7orphanاثبات‌شده نیزجمع شدند؛0unknownDBحذفشد. هیچ preview جدید نسازید.

