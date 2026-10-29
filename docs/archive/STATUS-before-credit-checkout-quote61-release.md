# وضعیت و نقطهٔ ادامه

آخرین به‌روزرسانی: 2026-10-27. **اصلی محلی۶۰؛ مجوز استفاده از تأییدیه در یک خرید و ابطال مصرف‌نشده پذیرفته و منتشر است. کل پروژه/PDF هنوز کامل نیست.** D34 ادامه تا همهٔ بخش‌هاست؛ پایان یک برش پایان هدف نیست. [آرشیو پیش۶۰](archive/STATUS-before-credit-purchase-scope60-release.md) جزئیات۵۹ و تاریخچهٔ پیشین را نگه می‌دارد.

## اجرای اصلی محلی۶۰

- API http://127.0.0.1:5080 — PID38817/session3636؛ restart: `python3 tmp/credit-purchase-scope60-release.py serve-api`.
- فروشگاه http://127.0.0.1:3000 — PID38866/session90766؛ restart: `python3 tmp/credit-purchase-scope60-release.py serve-storefront`.
- پنل http://127.0.0.1:3173 — PID38893/session17037؛ restart: `node tmp/serve-credit-purchase-scope60-main-admin.mjs`.
- descriptorهای `tmp/{api,storefront,admin}-runtime-current.json` مرجع path/hash/session/restart هستند. snapshot نهایی `tmp/credit-purchase-scope60-ui-runtime-set.json`، build `dgj-edhisKrTyVTcy_i-V`؛ API mode، preview خاموش و assetهای پیشین محفوظ‌اند. snapshot اول `...60-runtime-set.json` شاهد قطع پاسخ/رسید/ownerrevoke است؛ اصلاح نهایی فقط CSS بود و فرامین پروندهٔ دوم روی bundle نهایی دوباره اجرا شدند. ۱۴API DLL و proxy دو snapshot exact هستند.
- SQL۶۰ migration/۱۶۶جدول/۱۲schema دارد. PurchaseScopes/ScopeRevocations/ScopeCommands خالی، CurrentPurchaseScopeId nullable و FK همان پرونده/review، CHECK نیاز به Approved/currentReview/currentSubmission و eventهای ScopeGranted/ScopeRevoked افزوده شدند. **۱۶۲جدول قبلی به‌جز credit history در ارتقای متوقف exact و تمام۵۹migration پیشین محفوظ‌اند**؛ دیگرschema/viewها برابرند.
- ۱۳۸۳HTTP شامل تمام۱۳۳۱شاهد قبلی و۱۴مرز خصوصی جدید401 موفق است؛۷۸۶asset قبلی پنل و۲۷۳Next حفظ شدند. پسHTTP **۱۶۵جدول غیرنشست و تمامschema/view/history/safety exact هستند**. نشست عادی زنده جدا و بدون reset حفظ شده است.
- Stock101/0/0؛ Orders/Reservations/Settings/Policies/SourcingRequests/paymenthistory/Support/Inbox/Files/CreditApplications و همهٔ شرایط/رضایت/مدارک/ارسال/تصمیم/مجوز صفرند. CMS site3FAEN/auth1 محفوظ؛ supportCMS اصلی منتشر نشده/FAQ خالی پنهان است. seed، نقش/grant، شرط حقوقی، مدرک اجباری یا سیاست مالی واقعی اضافه نشد.
- **Files اصلی Disabled؛ providerهای D16/D30 ناشناخته/خاموش‌اند**. شرایط اصلی منتشر نشده و پروندهٔ واقعی برای ارسال آماده نیست. approval/مجوز هنوز سفارش/مصرف اعتبار نیست؛ quoteهای چکی همچنان `credit_approval_required` و canPlaceOrder/canPay=false دارند. CREDIT-01/02 بازند.
- بکاپ متوقف21,094,400بایت COPY_ONLY/CHECKSUM/VERIFYONLY، SHA `0b45628c9f4ee424f5bf6e9f76e96bb51d69c0872ac81c935271c1a1b904dbba` و۱key بدون parsing: `artifacts/checks/main-pre-credit-purchase-scope60-stopped-backup.json`. همان میزبان است؛ offsite/restore۶۰/nativeLinux پذیرفته نیست. current/rollback/restart/keys/backups/evidence در tmp محفوظ؛ tmp کامل پاک نشود. Redis پارسه طبقD32 روشن و دست‌نخورده است.

## مجوز خرید۶۰ پذیرفته

[CREDIT-PURCHASE-SCOPES](CREDIT-PURCHASE-SCOPES.md) و A61 مرجع‌اند. staff/MFA/credit.read+write روی همان Approved/currentReview و applicationVersion جاری و طرح فعال با نسخهٔ ثابت، یک مجوز برای همان review صادر می‌کند. **مبنای سقف بدون default**: PayableTotalRial جمع کل تعهد خرید شامل پیش‌پرداخت/چک و هزینه‌های نهایی؛ InstallmentsTotalRial جمع چک‌ها با markup بدون پیش‌پرداخت. مبلغ و انقضا عین approval و در input قابل تغییر/افزایش نیستند. approval قدیمی بدون انتخاب صریح مدیر، مجوز مصرف نیست. هیچ نقش یا grant اصلی ساخته نشد.

Grant حداکثر یک‌بار برای هرreview و immutable است. owner یا staffwrite همان scope/applicationVersion را صریحاً باطل می‌کند؛ staff دلیل لازم دارد، owner یادداشت اختیاری؛ زبان اصلی دلیل محفوظ و متن/رسید با purpose/hash مجزا رمزند. ابطال ردیف مستقل immutable است و اصل grant/receipt را تغییر نمی‌دهد. انقضا از ساعت server بدون نوشتن GET محاسبه می‌شود. تغییر/خاموشی طرح eligibility را می‌بندد ولی ابطال فعال را نمی‌بندد. ChangedAt حتی در ساعت ثابت Modified می‌شود تا rowversion ابطال حتماً بچرخد. تنها scope فعالِ مصرف‌نشده قابل ابطال است؛ **در این برش اصلاً order/claim چکی نداریم؛ پیش از فعال‌کردن checkout باید guard مصرف و race واقعی افزوده شود.**

root Identity/Credit/Files Serializable و gate شرایط→فرمان پرونده، pointer/event/grant/revocation/receipt/audit را اتمیک می‌کند؛ object/scanner I/O داخلSQL نیست. replay actor+UUID/body تاریخی پس ابطال/تغییرطرح هم همان نتیجهٔ قدیم است؛ حالت جاری از GET جدا می‌آید. FK سه‌ستونی و CHECK non-null از اتصال scope به review/submission دیگر یا null bypass جلوگیری می‌کنند. قرارداد SharedKernel برای quote فقط owner-bound IDs/versions/basis/longrial/expiry/planhash دارد؛ یادداشت یا فایل منتقل نمی‌شود. ForQuote به transaction Serializable و همان gate/مالک/نسخه/طرح/expiry/عدمابطال نیاز دارد؛ **هیچ consumer سفارش هنوز به آن وصل نیست**.

۹۸۳unit/کل۶۸۹SQLواقعی/۴۳۴storefront/۲۱۴admin/۱۳proxy و build/typecheck موفق؛۱۴DLL درunit/SQL/harness/frozen یکسان و مدل بدون pending است. Shop.sln شامل SqlTests/UiHarness نیست؛ صریح build و تطبیق شوند. پنجSQL جدید ownership/Finance/readonlyclaims/MFA، مبنای صریح/مبلغ بزرگ/expiry، تغییرطرح، ForQuote transaction/owner/version، رسید/replayپسابطال، auditrollback، دوgrantهمزمان و raceدوابطال، FK/nullCHECK/guardedDown را پوشش دادند. هیچ دامنهٔ credit.read با finance.read ادغام نشد.

۱۶SQLwire با decoder تولیدی و۳۱۶browserwire:۳۱۴موفق و۲429صرفاًGET؛ هر دو مسیر بعداً ازUIموفق خوانده شدند و rate-limit ضعیف نشد. مرورگر۱۳فرمان یکتا: publish۱،create/consent/submit/Approve/Grant/Revoke هرکدام۲؛ یکGrantموفق قطع→یکGETreceipt و۰duplicate. هر دو basis با9007199254740993ریال وUTCexpiry `2026-10-28T10:00:00Z`، ownerrevokeاول وstaffrevokeدوم، حفظ snapshot/تاریخچه و ownerFAEN/staff، logout→حذفخصوصی وrelogin→حفظابطال پذیرفته‌اند. **فقط داده/تأیید/مجوز ساختگی QA؛ هیچ شخص واقعی ارزیابی یا سفارش ایجاد نشد.** صفرمدرک صریحاً در شرایط غیرحقوقیQA منتشر شد وFilesDisabled؛ actualS3/ClamAV این برش ادعا نمی‌شود، شواهد واقعی۵۷ مستقل‌اند.

از۱۶۶جدولQA فقط۱۸مجاز تغییر و۱۴۸دیگرexact؛۲ApprovedApplication/۲review/۲scopeRevoked،۲revocation/۴command،۱۲event/۱۳auditاعتبار و۰file/order/reservation/settings/policy. مبلغ/expiry/planhash و same-case/review/submission درSQL به‌هم مقید و دقیق‌اند.

ایراد اولیهٔ overflow۳۰px فرم فعال دسکتاپ از checkboxباwidth100% کشف شد؛ CSSمحدودبهScope، اندازهٔصریحcheckbox وgridminmax اصلاح و حفظ شاهد اولیهٔناموفق انجام شد. نسخهٔنهایی فرمGrant/Revokedesktop۱۲۸۰client=scroll۱۲۶۵ و فرمفعال staff/ownerFAEN در۳۹۰×۸۴۴client=scroll۳۷۵، پسابطال۰form و زبان یادداشتFA/RTL درEN/LTR را پذیرفت. Console۷تبخالی؛ physicaldevice/کلmobile/WCAG/performance پذیرفته نیست. **قطعپاسخ/حریمخصوصی رویcandidateاول؛ فرامین پروندهٔدوم و layout رویfinal؛ تکرارقطعپاسخ رویfinal ادعا نمی‌شود**؛API/proxyexact‌اند.

`credit-purchase-scope60-source-acceptance.json`، `credit-purchase-scope-sql-full-wire/acceptance.json`، `credit-purchase-scope-browser-wire/acceptance.json`، `credit-purchase-scope-browser-{ui-final,close-sql}.json` و `credit-purchase-scope60-main-release.json` مرجع‌اند. QA_GUID `SaymanTest_Ui_35a8ba3d3a7b480b94cc7e6143862732`، keys/credentials، تب‌های۹۰–۹۶ و پورت‌های3105/3175/5181/5182 جمع شدند؛ Dockerresource تازه ساخته نشد.

## ادامهٔ آمادهٔ D34

1. اتصال quote/checkout چکی به همین scope با قیمت و شرایط جاری server، همانمالک/طرح/نسخه/سقف/expiry، رضایت دقیقquote و claimیک‌بارمصرف اتمیک با order/reservation/audit؛ race expiry/revoke/cancel/checkout. محاسبات عادی و accepted-offer وusedsnapshot محفوظ بمانند. ابتدا quote مقید/قابل بازبینی و UIانتخابscope، سپس order/claim با پذیرش مستقل. CREDIT-02 سررسید/وصول/برگشت/یادآوری و سازمانی ادامه دارد. برش‌های۵۵–۶۰ تکرار نشوند.
2. ارسال جزئی/دیجیتال، مرجوعی/بازپرداخت، CMSپیشرفته/بلاگ/SEO، search/alert/loyalty و بقیهٔPRD ادامه دارند. هسته‌های بازار/هلو/دست‌دوم/review/compare/Support/Inbox/SignalR/Files/Payment/Fulfillment در اسناد/آرشیو محفوظ؛ اسکلت یاadapterخاموش به معنی تکمیل نیست.
3. D16درگاه/SMS/email وD30هلوlive اطلاعات ندارند؛ سؤال تکرار/APIساختگی/موفقیت ساختگی ساخته نشود. سیاست‌های مالی/حقوقی واقعی را مالک ازپنل تعیین می‌کند؛ اصلیSettings/Policy خاموش است.
4. mobile/WCAG/performance/CI/observability/nativeLinux/load/offsitebackup/restore object+keyring و معیارهای۱۲گانه شاهد مستقل می‌خواهند. D14محلی/D21نمونهQA/D32Redisروشن/D33حفظtmp/D34کلپروژه پابرجایند.

## برش۶۱ در ساخت؛ هنوز پذیرفته/منتشر نیست

محاسبهٔ خرید چکی مقید به scope و قیمت/طرح/اقساط/هزینهٔ server، مطابق A62 و CREDIT-CHECKOUT-QUOTES آغاز شد. main60 frozen فعال است؛ quote/orderconsumer فعلی همچنان blocked است. طراحی مستقل از snapshotهای تاریخی Quote3/5 و بدون مصرف اعتبار/رزرو/order است؛ schema/API/UI/SQL/مرورگر۶۱ هنوز پذیرش ندارند.

۶۱ در ساخت: مدل/هسته/API و رابط انتخاب scope/محاسبهٔ مقید به مجوز در سورس پیاده‌اند؛ ۶unitهدف،۷SQLهدف(سبدعادی/ترکیبی/accepted-only،۲basis،ریال بزرگ،expiry/revoke-race/auditrollback) و۱۷SQLwire باdecoderتولیدی موفق‌اند. FKستون تازه ابتدا varchar وparentقدیمیnvarchar بود؛ فقطmigrationمنتشرنشده/مدل/snapshotهماهنگ وpending=0 شد؛ دیتابیسQAناموفق حذف وmain60تغییرنکرد. آزمون Financeمالک نبودنرا404می‌دهد وexpectationتست اصلاح شد؛ مجوزمحصولضعیف نشد. ورودMFAبازبینساختگیMarketFixtureدرtesthostمستقل انجامشد تاauth-rate-limitمحصولباقی‌بماند. ۱۰قرارداد/BFF/journal وکل۴۴۴storefront موفق‌اند؛ fullSQL/unit/build/مرورگر۶۱ در جریانند. app هنوزsource60frozenاست؛۶۱پذیرش/انتشارندارد. seedفقطQA باflagصریح/GUID وD21shipping12345/exempt درtestexecutableدرحال‌افزودن است،mainسیاست/شرایط/مدرک/نقش/providerنمی‌گیرد.
