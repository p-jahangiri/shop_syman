# بارگیری پنل مدیریت

وضعیت 2026-10-23: تغییر سورس و build ایزوله موفق؛ پنل زنده هنوز همان dist پذیرفته‌شدهٔ قبلی است.

| خروجی گزارش‌شدهٔ Vite | پیش از جداسازی | پس از جداسازی |
|---|---:|---:|
| JavaScript اولیه | ۵۱۳٫۱۰ kB | ۴۰۲٫۰۱ kB |
| gzip اولیه | ۱۵۱٫۵۲ kB | ۱۲۴٫۱۳ kB |

حجم فایل اولیه حدود۲۱٫۶۵٪ کمتر شد. هشدار پیشین۵۰۰kB رفع شده است؛ `chunkSizeWarningLimit` تغییر نکرده و warning سرکوب نشده است. این عدد اندازهٔ خروجی build است، نه سنجش LCP/INP/CLS یا سرعت دستگاه واقعی.

Catalog، Operations، Charges و Orders با React.lazy/Suspense هنگام نیاز بارگیری می‌شوند. جدول TanStack از primitiveهای عمومی UI جدا و helperهای فرم از ماژول کاتالوگ خارج شدند؛ صفحهٔ ورود برای Field/Busy یا یک دکمهٔ فرم، تمام کاتالوگ و جدول را import نمی‌کند. helperهای ذخیره/اعتبارسنجی و قرارداد API تغییر نکرده‌اند. PageBoundary خطای بارگیری یا render یک بخش را با پیام عمومی، امکان بازکردن بخش دیگر و reload پنل نمایش می‌دهد؛ reload صریحاً پاک‌شدن draft ذخیره‌نشده را اعلام می‌کند.

شواهد: `artifacts/checks/admin-split-build.log`، `admin-typecheck.log` و دو تست تازهٔ `admin-server-tests.log`. chunkهای forms۳٫۸۴، charges۹٫۲۲، orders۱۴٫۹۹، catalog۲۳٫۱۴ و operations۲۵٫۶۱kB هستند؛ ماژول مشترک types/table حدود۵۱٫۶۹kB است. خروجی در `tmp/orders-admin-dist` بوده و dist اصلی جایگزین نشده است.

QA مرورگر روی origin مستقل فقط صفحهٔ ورود و اعتبارسنجی رمز خالی را بررسی کرد: entry جدید، بدون modulepreload فرم‌ها، بدون خطای console و بدون overflow دسکتاپ. هیچ رمز یا MFA مالک خوانده یا وارد نشد؛ fixture همهٔ ورودها را رد می‌کرد و درخواست password هم ارسال نشد. این بررسی پذیرش navigation/فرم‌های احرازشده یا ErrorBoundary در قطع واقعی chunk نیست؛ پس از رفع مانع فضا باید با مدیر موقت دارای MFA و SQL جدا انجام شود.

بارگیری/صفحه‌بندی snapshotهای بزرگ مدیریت، query plan، معیارهای دستگاه واقعی و آزمون خطای chunk هنوز بازند. تفکیک JavaScript به معنی پایان فاز performance نیست. گزارش محدود QA در `orders-layout-ui.json` و تصویر `sayman-admin-split-login.png` است.

به‌روزرسانی تاریخچهٔ انبار: build مستقل در `tmp/inventory-history-admin-dist` entry۴۰۲٫۰۶kB/gzip۱۲۴٫۱۷ و Operations۳۲٫۹۰kB دارد؛ سایر ابعاد جدول بالا شاهد برش قبلی‌اند.۱۵ QA مستقل فقط کامپوننت history با دادهٔ نمونه،۵ contract و typecheck/build موفق‌اند؛ پذیرش فرم‌ها/ناوبری کامل احرازشده همچنان باقی است. جزئیات در INVENTORY-HISTORY است.

به‌روزرسانی صفحهٔ موجودی: build ایزولهٔ `tmp/inventory-page-admin-dist` entry۴۰۵٫۲۳/gzip۱۲۵٫۳۰kB، inventory۱۴٫۸۳ و operations۲۲٫۸۳ دارد؛ هشدار۵۰۰kB ندارد. صفحه/داشبورد از snapshot کامل Stock/Catalog جدا و queryها در صفحهٔ نیازمند فعال‌اند.۱۴ QA فقط خواندنیِ کامپوننت و۱۰ contract موفق، فرم اصلاح/ناوبری کامل احرازشده و Core Web Vitals هنوز پذیرفته نشده‌اند؛ INVENTORY-PAGING مرجع است.

به‌روزرسانی مدیریت کالا: build ایزولهٔ `tmp/admin-products-dist` entry۴۰۶٫۰۰/gzip۱۲۵٫۴۶kB، products۵٫۸۰، products-contract۳٫۶۸ و operations۲۶٫۶۴ دارد؛ هشدار۵۰۰kB ندارد و threshold عوض نشد. فهرست کالا/انتخاب‌گر CMS از graph کامل جدا و جزئیات فقط هنگام ویرایش همان یک کالا خوانده می‌شوند؛ metadataOnly هنوز دسته/برند/ویژگی/گزینه‌ها را کامل دارد.۱۶ contract،۷ wire و۲۳ QA فقط خواندنی موفق‌اند؛ این اعداد سنجش دستگاه، SQL/بار یا پذیرش ویرایش/MFA/ذخیرهٔ CMS نیستند. ADMIN-PRODUCTS مرجع است و dist زنده عوض نشد.

به‌روزرسانی امنیت حساب: build مستقل `tmp/mfa-recovery-admin-dist` entry۳۲۴٫۱۲/gzip۱۰۳٫۴۰kB و schemas modulepreload۸۵٫۶۲/gzip۲۴٫۴۳kB دارد؛ جمع JS اولیه۴۰۹٫۷۴/gzip۱۲۷٫۸۳kB است. entry کوچک‌تر به معنی کاهش کل اولیه نیست؛ schema از آن جدا شده است. صفحهٔ امنیت lazy۳٫۹۷/gzip۱٫۸۵kB،۱۴ QA محدود رابط و دو تست runtime موفق‌اند. dist زنده تغییر نکرد و Core Web Vitals یا گردش مثبت احرازشده ادعا نمی‌شود؛ MFA-RECOVERY مرجع است.

به‌روزرسانی کارکنان: build مستقل `tmp/staff-admin-dist` entry۳۲۵٫۲۸/gzip۱۰۳٫۷۱ و schemas preload۸۵٫۶۳/gzip۲۴٫۴۴kB دارد؛ جمع اولیه۴۱۰٫۹۱/gzip۱۲۸٫۱۵kB و staff lazy۱۶٫۶۶/gzip۵٫۲۹kB است. هشدار۵۰۰kB ندارد و threshold عوض نشد. فهرست/رویداد۵۰تایی و metadata فقط هنگام نیاز خوانده می‌شوند؛۲۴ QA محدود و۲۶ contract موفق، ولی SQL/ناوبری کامل احرازشده و معیارهای دستگاه هنوز پذیرفته نشده‌اند. STAFF-ADMINISTRATION مرجع است؛ dist اصلی تغییر نکرد.
