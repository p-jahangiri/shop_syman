# کیفیت کد و ابزار توسعه — D45

ESLint به‌صورت flat config در ریشه فعال است و JavaScript، TypeScript، TSX و اسکریپت‌های MTS را بررسی می‌کند. منابع برنامه، تست‌ها و اسکریپت‌ها در دامنه‌اند؛ خروجی build، runtimeهای frozen، فایل‌های تولیدشده و node_modules منبع lint نیستند. خطا یا warning باید `npm run lint` را ناموفق کند. قالب‌بندی با Prettier جداست و جای آزمون یا بررسی رفتار را نمی‌گیرد.

## نصب و فرمان‌ها

```sh
npm ci
npm ci --prefix tools/lint --ignore-scripts
npm run lint
npm run lint:fix
npm run format:check
npm run format
```

ابزارها نسخهٔ دقیق و lockfile مستقل در `tools/lint` دارند. parser فعلی typescript-eslint از TypeScript کمتر از6.1 پشتیبانی می‌کند؛ بنابراین فقط محیط ابزار از6.0.3 استفاده می‌کند. کامپایلر برنامه7.0.2 حفظ شده است. این پوشه محیط اجرایی، اپ دوم یا نسخهٔ بازبینی نیست و پورت/دیتابیس ندارد. lifecycle script بسته‌های ابزار هنگام نصب اجرا نمی‌شود.

ESLintrecommended، قواعد TypeScript، React، Hooks، دسترس‌پذیری و قواعد Next برای storefront فعال‌اند. PropTypes در فایل‌های TypeScript با بررسی strictTypeScript جایگزین است. regionهای نام‌دار و قابل پیمایش جدول اجازهٔ فوکوس صفحه‌کلید دارند. regexهایی که عمداً نویسهٔ کنترلی را در مرز ورودی رد می‌کنند استثنای محلی با دلیل دارند؛ حذف این اعتبارسنجی برای راضی‌کردن lint مجاز نیست. nativeDialog برای Escape از onCancel استفاده می‌کند؛ handler کلیک صرفاً backdrop را می‌بندد و استثنای محلی توضیح‌دار دارد.

برای اصلاح effect، افزودن کورکورانهٔ همهٔ callbackها به dependencyarray کافی نیست؛ ابتدا callback باید پایدار شود یا effect به ورودی‌های واقعی خود وابسته باشد. فرم، نشست و generationgate مالی نباید با هر render دوباره اجرا/پاک شوند. دستور lint:fix فقط اصلاح‌های قابل‌خودکار ابزار را اعمال می‌کند؛ تغییر lifecycle و مجوزها نیاز به مرور و آزمون رفتاری دارد.

## پذیرش

baseline و اصلاح‌ها در `artifacts/checks/eslint-*.json` ثبت می‌شوند. عبور lint و format، strictTS، آزمون‌های دامنه/قرارداد و build واقعی هر بخش پیش از فعال‌شدن لازم‌اند. CIفایل‌ها پس از قبولی محلی همین فرمان‌ها را اجرا می‌کنند؛ وجود YAML ادعای اجرای موفق GitHub نیست. بخش‌های ناقص، سرویس‌های بدون قرارداد و پذیرش‌های محیطی باز در STATUS/PLAN می‌مانند.

مراجع ابزار: [Flat config](https://eslint.org/docs/latest/use/configure/configuration-files)، [پشتیبانی نسخهٔ parser](https://typescript-eslint.io/users/dependency-versions/) و [وابستگی‌های Effect](https://react.dev/reference/react/useEffect). این مستندات مبنای انتخاب‌اند؛ نتیجهٔ واقعی پروژه با log و آزمون ثبت می‌شود.
