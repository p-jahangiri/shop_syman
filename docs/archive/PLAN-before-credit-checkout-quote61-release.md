# نقشهٔ راه تا تحویل — D34

وضعیت جاری **اصلی محلی۶۰، 2026-10-27**. STATUS مرجع runtime/restart/شواهد وPRD مرجع کلPDF است؛ [آرشیو پیش۶۰](archive/PLAN-before-credit-purchase-scope60-release.md) محفوظ است. پایان یک برش پایان هدف نیست.

1. CREDIT-01 بعدی: quoteچکی واقعی به scopeصریح/expiry و مالک/طرح/نسخه/سقف وصل شود؛ قیمت/روش/موجودی/هزینهٔserver وsnapshot عادی/accepted-offer/used محفوظ. UIانتخابscope ورضایت دقیقquote؛ سپس order/reservation/claimیک‌بارمصرف/auditاتمیک، replay وraceexpiry/revoke/cancel. approval۵۹ وscope۶۰ هنوز سفارش نیستند؛ quoteچکی همچنانblocked وcanPlaceOrder/canPay=false. CREDIT-02 سررسید/وصول/برگشت/یادآوری و سازمانی ادامه دارد؛۵۵–۶۰ تکرار نشوند.
2. چرخهٔفروش: ارسال جزئی/دیجیتال، مرجوعی/بازپرداخت، تخصیص دستگاه/گزارش باsnapshot/idempotency؛ ارسال کامل فیزیکی۴۸ وپرداخت۵۰ محفوظ؛ gatewayواقعیD16خاموش.
3. CMS/pagebuilder/blog/redirect/SEO، سنجش جست‌وجوی فارسی، wishlist/alert، trade-in/bundle/compatibility/loyalty و دیگرEXT با معیار مستقلPRD.
4. ارتباطات/فایل: SignalR/اعلان/پشتیبانی، retention/delete/restore object+keyring؛ FilesاصلیDisabled و سرویس تولیدی مستقل آماده شود.
5. پذیرش نهایی mobile/RTL/LTR/WCAG/performance، CI/observability، DockerLinuxواقعی، load،offsitebackup/restore و معیارهای۱۲گانه/اسنادتحویل.

۶۰:۹۸۳unit/۶۸۹SQL/۴۳۴storefront/۲۱۴admin/۱۳proxy،۱۶SQLwire/۳۱۶browserwire(۳۱۴200+۲GET429بازیابی‌شده)،۱۳فرمان/۱lostGrant→۱receipt/۰duplicate،۱۶۶جدولQA/۱۴۸دیگرexact و۱۳۸۳HTTPمحلی پذیرفته‌اند. Owner/Staff revoke وهردوbasis؛ تغییرطرح/expiry/MFA/readonly/transaction/race/FK/rollback درSQL. OverflowفرمdesktopاصلاحوفُرمفعالFAEN/mobile/desktopرویfinalدوبارهپذیرفتهشد. API/proxyدوcandidateexact؛ قطعپاسخ/حریمخصوصیcandidateاول و functionalپروندهٔدومfinal؛ تکرارقطعپاسخfinalادعانشود. FilesDisabled/صفرمدرکصریحفقطQA و تمامتصمیم‌هاساختگی‌اند.

هر برشbackend/API+storefront/adminقابل‌بازبینی،SQLواقعی/قرارداد/BFF/مرورگرمتناسب‌باریسک،QA_GUIDcleanup،artifactثابت،backup/ارتقای‌افزایشی/حفظداده/HTTPمحلی وSTATUS/DECISIONS/API؛ بعدبرشبعدیادامه. SqlTests/UiHarness صریحbuild و۱۴DLLتطبیق داده شوند. تغییرصرفاًCSSدلیل تکرارbackendtestsنیست.

D16/D30خارجی بازند؛ سؤال تکرارنشود. متنحقوقی/درصد/endpointprovider/هزینه/مالیات/تصمیم واقعی ازادامه استنباط نشود. نشست عادیAPIزنده جدا ازتجاری ثبت شود و برایhashقدیمی resetنشود. D14/D21/D32/D33/D34پابرجایند.
