# مجوز مالی مستقل خرید چکی — طرح A82 در ساخت

D35: «پس از دریافت پیش‌پرداخت و تأیید دستی همهٔ چک‌ها». این برش گواهی نهایی مستقل چکی، تعهد موجودی و کنترل انبار را می‌سازد؛ گزارش دستی معادل پرداخت بانکی نیست. نسخهٔ اصلی۷۰ ثابت می‌ماند تا پذیرش کامل.

FinanceMFA/finance.write پس بازبینی preview سرور، Confirmed صریح، OrderVersion، نسخهٔ قبلی گواهی و PreviewFingerprint دقیق، Approve یا Revoke را ثبت می‌کند. هیچ مبلغ، تعداد چک، مدرک بانکی یا تصمیم موجودی از HTTP پذیرفته نمی‌شود. preview همهٔ خطوط برنامهٔ محفوظ، اسناد همان خطوط، تأییدهای همان نسخهٔ ledger و گواهی فعال کل پیش‌پرداخت (یا NoUpfrontDue معتبر) را بررسی می‌کند. فهرست خالی تأیید نهایی نیست. گواهی evidence شامل schedule/upfront/approval/ledger نسخه‌دار و hash حقایق مالی ثابت سفارش است.

اولین Approve فقط AwaitingPayment پیش مهلت اصلی و رزرو Active؛ در root Serializable مشترک Identity/Sales/Credit/Inventory، مالک سپس actor-command قفل می‌شوند، Inventory تعهد همان رزرو را تأیید می‌کند و Sales وارد **CreditApproved** می‌شود. Paid، VerifiedCashPayment و جدول پرداخت نقدی تغییر نمی‌کنند. مهلت/scope/حقوق accepted و رسید ایجاد قدیمی تغییر نمی‌کنند؛ stock قبلاً رزروشده دوباره رزرو نمی‌شود و scope مصرف‌شده احیا نمی‌شود. پس تعهد، انقضای قبلی مانند Paid دیگر موجب آزادسازی خودکار موجودی نیست.

Clearance یک دفتر append-only با حداکثر۲۰۰ رویداد هر سفارش و receipt محافظت‌شدهٔ DP است. همان UUID پیش CAS/expiry replay می‌شود؛ payload متفاوت conflict و audit تنها برای ثبت تازه است. هر تغییر ledger یا تأیید دستی، evidence قبلی را stale می‌کند. تأیید مجدد چک روی CreditApproved مجاز است، چون همان سفارش قبلاً متعهد شده؛ مهلت سفارش قبلی تمدید نمی‌شود. Refresh با Approve صریح، نسخه/preview تازه و دلیل، فقط گواهی تازه می‌سازد و موجودی را دوباره allocate نمی‌کند. Revoke پیش dispatch ارسال را متوقف می‌کند و به‌تنهایی وجه/موجودی را بازنمی‌گرداند. اصلاح یا بازپرداخت پیش‌پرداخت پس تعهد در این برش نیست؛ گواهی upfront پس CreditApproved همچنان frozen است.

Sales در pack/repack/dispatch از قرارداد داخلی Credit اعتبار زندهٔ clearance را می‌خواهد؛ stale/revoked/missing blocks. ثبت تحویل بستهٔ قبلاً ارسال‌شده وابسته به پرداخت بعدی نیست؛ رویدادهای پس dispatch تاریخچهٔ ارسال را پس نمی‌گیرند. Warehouse مجوز مالی نمی‌سازد. این برش ارسال کامل فیزیکی موجود را گسترش می‌دهد؛ ارسال جزئی/دیجیتال/مرجوعی جداست.

customer فقط خلاصهٔ وضعیت، زمان و تازگی مجوز را می‌بیند؛ دلیل خصوصی/actor/مرجع اسناد مخفی است. پنل preview/action خالی/review false، تاریخچه و GET همان receipt، journal RAM و logout چندتب لازم دارد. FA/EN و گوشی، private/no-store/noindex/origin/query strict/body8K/bounded/no Cookie حفظ شوند.

پذیرش لازم: آخرین واحد، cancel/expiry/CAS/ledger race، audit rollback پس allocation، replay بدون allocation دوم، stale evidence در pack/dispatch، postdeadline refresh بدون revival، شرط همهٔ چک‌ها و مبلغ upfront سروری، cashproof strict، guardهای SQL/DP/immutability/Down، decoder واقعی wire، مرورگر مستقل SQL با قطع پاسخ، حفظ deadline/ScopeUse/موجودی، و release محلی با backup/حفظ همه داده‌های قبلی. هیچ policy/provider/seed/role اصلی خودکار فعال نشود. این سند طرح است؛ هنوز پذیرش/انتشار این برش نیست.


## پذیرش و انتشار محلی۷۲ — A83

طرح فوق برایارسالکامل فیزیکیپذیرفتهو منتشرشد؛STATUS وA83شواهد دقیق‌اند.۱۰۹۹unit/۷۶۲SQL/۵۱۲front/۲۱۷admin/۲۲proxy،۶۵SQLwire/۱۲۴browserwire،QAجمع وmainbackup/حفظداده/۱۹۳۵HTTP تأیید. source۷۲با۲migration و۲جدولCreditخالی،تنهاقیدنوعسفارشگسترشیافته؛هیچmainpolicy/seed/role/providerفعال نشد. upfrontاصلاحپسcommit/ارسالجزئی/دیجیتال/refund/باقیCREDIT-02وD34هنوزدرادامه‌اند.
