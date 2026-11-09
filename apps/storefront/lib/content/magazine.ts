import type { Locale } from '@sayman/web-shared/lib/shared/types.ts';

type Bilingual = Record<Locale, string>;
type GuideSection = { heading: Bilingual; body: Bilingual };
type MagazineGuide = {
  slug: string;
  anchor?: string;
  cover: 'compare' | 'inspection' | 'charging' | 'daily';
  category: Bilingual;
  title: Bilingual;
  summary: Bilingual;
  sections: GuideSection[];
  references?: { label: Bilingual; href: string }[];
};

export const magazinePath = '/mobile-news';
export const magazineGuidePath = (slug: string) => `${magazinePath}/${slug}`;

export const magazineGuides: readonly MagazineGuide[] = [
  {
    slug: 'used-phone-inspection',
    anchor: 'battery',
    cover: 'inspection',
    category: { fa: 'راهنمای کارکرده', en: 'Buying used' },
    title: {
      fa: 'قبل از پرداخت، این ۵ چیز را روی گوشی کارکرده امتحان کنید',
      en: 'Five checks to make before paying for a used phone',
    },
    summary: {
      fa: 'از رجیستری و قفل حساب تا باتری و دوربین. چک‌لیستی که موقع دیدن خود دستگاه به کارتان می‌آید.',
      en: 'An in-person checklist for registration, account locks, battery, cameras and repairs.',
    },
    sections: [
      {
        heading: { fa: '۱. شناسه و وضعیت رجیستری', en: '1. Device ID and registration' },
        body: {
          fa: 'شناسهٔ دستگاه را از تنظیمات بخوانید و با فاکتور تطبیق دهید. برای خرید در ایران، وضعیت رجیستری و امکان انتقال مالکیت همان دستگاه را پیش از پرداخت بررسی کنید. اگر گوشی دو شناسه دارد، هر دو را تطبیق دهید.',
          en: 'Read the device ID in Settings and compare it with the invoice. In Iran, verify registration and whether ownership can be transferred before paying. Match both identifiers when the phone has two.',
        },
      },
      {
        heading: { fa: '۲. خروج فروشنده از حساب', en: '2. Removal of the previous account' },
        body: {
          fa: 'فروشنده باید بتواند حساب خودش را از گوشی خارج کند. پس از پاک‌سازی با اجازهٔ او، راه‌اندازی را تا جایی ادامه دهید که مطمئن شوید دستگاه رمز یا تأیید مالک قبلی را نمی‌خواهد.',
          en: 'Ask the seller to remove their own account. After a reset with their permission, start setup and check that it does not request the previous owner’s password or approval.',
        },
      },
      {
        heading: { fa: '۳. باتری و درگاه شارژ', en: '3. Battery and charging port' },
        body: {
          fa: 'وضعیت باتری را از تنظیمات همان گوشی بخوانید. چند دقیقه دوربین و صفحه را روشن نگه دارید و با کابل سازگار، شارژ پایدار را امتحان کنید. درصد سلامت را کنار خاموشی ناگهانی، هشدار سرویس و هزینهٔ احتمالی تعویض ببینید.',
          en: 'Read the battery information on the phone itself. Run the camera and screen for a few minutes and check stable charging with a compatible cable. Weigh the battery figure alongside shutdowns, service warnings and potential replacement costs.',
        },
      },
      {
        heading: { fa: '۴. دوربین، صدا و تماس', en: '4. Camera, sound and calling' },
        body: {
          fa: 'با دوربین جلو و عقب عکس بگیرید، یک ویدیو با صدا ضبط کنید و فایل را پخش کنید. یک تماس آزمایشی با سیم‌کارت خودتان، آنتن‌دهی و صدای هر دو سمت تماس را روشن‌تر می‌کند.',
          en: 'Take front and rear photos, record a video with sound and play it back. A test call with your SIM helps check reception and audio in both directions.',
        },
      },
      {
        heading: { fa: '۵. قطعات و ظاهر همان دستگاه', en: '5. Parts and condition of this unit' },
        body: {
          fa: 'لبه‌ها، گوشه‌ها و صفحه را زیر نور بررسی کنید. در مدل‌های پشتیبانی‌شدهٔ آیفون، سابقهٔ قطعات و سرویس در مسیر Settings ← General ← About دیده می‌شود. وضعیت ثبت‌شده را کنار گزارش فروشنده و نتیجهٔ تست عملی بخوانید.',
          en: 'Inspect the edges, corners and screen under good light. On supported iPhones, Settings → General → About shows Parts and Service History. Compare it with the seller’s report and your hands-on checks.',
        },
      },
    ],
    references: [
      {
        label: { fa: 'راهنمای اپل برای سابقهٔ قطعات', en: 'Apple’s parts history guide' },
        href: 'https://support.apple.com/en-us/102658',
      },
      {
        label: { fa: 'راهنمای باتری اپل', en: 'Apple’s battery guide' },
        href: 'https://support.apple.com/en-gb/101575',
      },
    ],
  },
  {
    slug: 'iphone-14-vs-15',
    anchor: 'compare',
    cover: 'compare',
    category: { fa: 'مقایسهٔ خرید', en: 'Buying comparison' },
    title: {
      fa: 'آیفون ۱۴ یا ۱۵؟ تفاوتی که هر روز حس می‌کنید',
      en: 'iPhone 14 or 15? The differences you notice daily',
    },
    summary: {
      fa: 'مقایسهٔ مدل‌های پایه با سه سؤال دربارهٔ کابل، دوربین و هزینهٔ خرید دستگاه کارکرده.',
      en: 'Compare the base models by cable, camera and the total cost of buying used.',
    },
    sections: [
      {
        heading: { fa: 'کابلی که همراهتان می‌ماند', en: 'The cable you carry' },
        body: {
          fa: 'آیفون ۱۴ پایه درگاه Lightning دارد و آیفون ۱۵ پایه از USB‑C استفاده می‌کند. اگر لپ‌تاپ یا هندزفری شما هم با USB‑C شارژ می‌شود، تعداد کابل‌هایی را که واقعاً باید همراه ببرید در نظر بگیرید. اگر لوازم Lightning دارید، هزینهٔ جایگزینی را هم حساب کنید.',
          en: 'The base iPhone 14 uses Lightning and the base iPhone 15 uses USB‑C. If your laptop or earbuds also charge over USB‑C, count the cables you actually need to carry. Add replacement costs if you own Lightning accessories.',
        },
      },
      {
        heading: { fa: 'با همان سوژه عکس بگیرید', en: 'Photograph the same subject' },
        body: {
          fa: 'دوربین اصلی مدل پایه از ۱۲ مگاپیکسل در آیفون ۱۴ به ۴۸ مگاپیکسل در آیفون ۱۵ رسیده است. یک متن کوچک و یک چهره را در نور یکسان ثبت کنید و روی هر دو نتیجه زوم کنید. جزئیاتی که در کاربرد روزمرهٔ شما دیده می‌شوند، معیار تصمیم‌اند.',
          en: 'The main camera goes from 12 megapixels on the base iPhone 14 to 48 on the base iPhone 15. Photograph small text and a face in the same light, then zoom into both results. Judge the differences that matter in your own photos.',
        },
      },
      {
        heading: { fa: 'هزینهٔ کامل را مقایسه کنید', en: 'Compare the complete cost' },
        body: {
          fa: 'برای دو دستگاه با حافظهٔ یکسان، قیمت گوشی، هزینهٔ کابل و قاب، وضعیت باتری و شرایط ضمانت را کنار هم بنویسید. فاصلهٔ قیمت وقتی معنی دارد که گزارش سلامت دو دستگاه هم در مقایسه باشد.',
          en: 'For two devices with the same storage, write down the phone, cable and case costs alongside battery condition and warranty terms. A price difference is easier to judge when you compare the condition of both units.',
        },
      },
    ],
    references: [
      {
        label: { fa: 'مشخصات آیفون ۱۴', en: 'iPhone 14 specifications' },
        href: 'https://support.apple.com/en-ie/111850',
      },
      {
        label: { fa: 'مشخصات آیفون ۱۵', en: 'iPhone 15 specifications' },
        href: 'https://support.apple.com/en-gb/111831',
      },
    ],
  },
  {
    slug: 'choose-a-charger',
    anchor: 'charging',
    cover: 'charging',
    category: { fa: 'انتخاب لوازم', en: 'Accessories' },
    title: {
      fa: 'شارژر ۲۵ وات یا ۴۵ وات؟ اول گوشی‌تان را چک کنید',
      en: '25 W or 45 W? Check your phone before buying a charger',
    },
    summary: {
      fa: 'چطور از روی مدل گوشی، استاندارد شارژ و نوشتهٔ کابل بفهمید کدام ترکیب به دردتان می‌خورد.',
      en: 'Use your phone model, charging standard and cable rating to choose a compatible setup.',
    },
    sections: [
      {
        heading: { fa: 'شمارهٔ دقیق مدل را بخوانید', en: 'Find the exact model' },
        body: {
          fa: 'از بخش دربارهٔ گوشی، شمارهٔ مدل را پیدا کنید و شارژ سیمی پشتیبانی‌شده را در صفحهٔ سازنده بخوانید. مدل‌های یک خانواده می‌توانند سقف شارژ متفاوت داشته باشند. عدد روی آداپتور ظرفیت خود آداپتور است.',
          en: 'Find the model number in About Phone and look up its wired charging support with the manufacturer. Models in the same family can have different charging limits. The number on the adapter describes the adapter’s capacity.',
        },
      },
      {
        heading: {
          fa: 'آداپتور و کابل را با هم انتخاب کنید',
          en: 'Choose the adapter and cable together',
        },
        body: {
          fa: 'برای سرعت وعده‌داده‌شده، استانداردهای موردنیاز مثل USB Power Delivery یا PPS و ظرفیت کابل را کنار هم بررسی کنید. اگر شارژر چند درگاه دارد، توان هر خروجی را با یک دستگاه و با چند دستگاه مقایسه کنید.',
          en: 'Check the required standard, such as USB Power Delivery or PPS, along with the cable rating. On a multi-port charger, compare the per-port output with one device connected and with several.',
        },
      },
      {
        heading: { fa: 'برای موقعیت استفاده خرید کنید', en: 'Buy for the way you charge' },
        body: {
          fa: 'برای شارژ شبانه، طول مناسب کابل و دسترسی به پریز ارزش دارد. برای شارژ کوتاه میان روز، توان سازگار و کابل همراه اولویت پیدا می‌کند. مشخصات جعبه و شرایط ضمانت را پیش از سفارش بخوانید.',
          en: 'For overnight charging, cable length and outlet access matter. For quick top-ups, prioritize compatible power and the included cable. Read the package contents and warranty terms before ordering.',
        },
      },
    ],
    references: [
      {
        label: { fa: 'راهنمای رسمی شارژ گلکسی', en: 'Samsung Galaxy charging guide' },
        href: 'https://www.samsung.com/uk/support/mobile-devices/which-type-of-charger-does-my-galaxy-device-accept/',
      },
    ],
  },
  {
    slug: 'phone-storage',
    cover: 'daily',
    category: { fa: 'راهنمای خرید', en: 'Buying guide' },
    title: {
      fa: '۱۲۸ یا ۲۵۶ گیگ؟ حافظهٔ گوشی بعدی را از روی گوشی فعلی انتخاب کنید',
      en: '128 or 256 GB? Use your current phone to choose your next one',
    },
    summary: {
      fa: 'با یک نگاه به فضای مصرف‌شده، برای عکس، ویدیو و برنامه‌های چند سال آینده جا در نظر بگیرید.',
      en: 'Start with your actual storage use and leave room for photos, videos and apps.',
    },
    sections: [
      {
        heading: { fa: 'ببینید چه چیزی جا گرفته', en: 'See what is using space' },
        body: {
          fa: 'در تنظیمات، فضای عکس‌ها، ویدیوها، پیام‌رسان‌ها و بازی‌ها را جدا ببینید. مواردی را که می‌خواهید به گوشی جدید ببرید علامت بزنید و فضای اشغال‌شدهٔ آن‌ها را جمع کنید.',
          en: 'In Settings, separate the space used by photos, videos, messaging and games. Mark what you plan to transfer and add up the space it occupies.',
        },
      },
      {
        heading: { fa: 'یک هفتهٔ واقعی را حساب کنید', en: 'Estimate a typical week' },
        body: {
          fa: 'اگر زیاد فیلم می‌گیرید، چند نمونه را با وضوحی که معمولاً استفاده می‌کنید ذخیره کنید. حجم همین فایل‌ها تصویر بهتری از رشد حافظه می‌دهد. برای دانلود آفلاین و به‌روزرسانی‌ها هم فضای آزاد بگذارید.',
          en: 'If you record a lot of video, save a few clips at your usual resolution and look at their sizes. Leave free space for offline downloads and updates.',
        },
      },
      {
        heading: { fa: 'هزینه و عادت پشتیبان‌گیری', en: 'Cost and backup habits' },
        body: {
          fa: 'اگر فایل‌های قدیمی را مرتب به رایانه یا فضای ابری منتقل می‌کنید، همان روند را در انتخاب لحاظ کنید. اگر همهٔ عکس‌ها باید روی گوشی در دسترس باشند، فضای بیشتر می‌تواند ارزش بالاتری از یک گزینهٔ تزئینی داشته باشد.',
          en: 'If you routinely move older files to a computer or cloud storage, include that habit in your decision. If you keep every photo on the phone, more space may be worth more to you than a cosmetic option.',
        },
      },
    ],
  },
  {
    slug: 'test-phone-camera',
    cover: 'compare',
    category: { fa: 'تست پیش از خرید', en: 'Try before buying' },
    title: {
      fa: 'دوربین گوشی را با این سه عکس امتحان کنید',
      en: 'Test a phone camera with these three photos',
    },
    summary: {
      fa: 'صورت در نور پنجره، نوشته در نور کم و سوژهٔ متحرک. سه نمونه که سریع تفاوت‌ها را نشان می‌دهند.',
      en: 'A face by a window, small text in low light and a moving subject tell you plenty.',
    },
    sections: [
      {
        heading: { fa: '۱. چهره کنار پنجره', en: '1. A face by the window' },
        body: {
          fa: 'چهره را کنار پنجره و با اجازهٔ فرد ثبت کنید. به رنگ پوست، روشنایی صورت و جزئیات بیرون پنجره نگاه کنید. دو گوشی را در یک فاصله و با تنظیمات معمول خودشان امتحان کنید.',
          en: 'With permission, photograph a face next to a window. Look at skin tones, facial brightness and details outside the window. Keep the same distance and use each phone’s default settings.',
        },
      },
      {
        heading: { fa: '۲. نوشته در گوشهٔ کم‌نور', en: '2. Text in a dim corner' },
        body: {
          fa: 'از نوشته‌ای با حروف ریز عکس بگیرید. تصویر را بزرگ کنید و ببینید لبهٔ حروف چقدر خواناست و آیا دوربین برای فوکوس زمان زیادی می‌خواهد.',
          en: 'Photograph small print in a dim corner. Zoom into the image to see whether edges remain readable and whether focus takes a long time.',
        },
      },
      {
        heading: { fa: '۳. سوژه‌ای که حرکت می‌کند', en: '3. A moving subject' },
        body: {
          fa: 'از دستی که آرام حرکت می‌کند چند عکس بگیرید و تعداد فریم‌های شارپ را مقایسه کنید. اگر بیشتر فیلم می‌گیرید، همان صحنه را چند ثانیه ضبط کنید و صدا و لرزش را هم بررسی کنید.',
          en: 'Take several photos of a slowly moving hand and count the sharp frames. If video matters more, record the same scene and check sound and shake as well.',
        },
      },
    ],
  },
  {
    slug: 'phone-for-work-and-study',
    cover: 'daily',
    category: { fa: 'خرید بر اساس نیاز', en: 'Buy for your needs' },
    title: {
      fa: 'گوشی برای دانشگاه یا کار؟ بودجه را خرج امکاناتی کنید که هر روز لازم دارید',
      en: 'A phone for work or university? Spend on what you use daily',
    },
    summary: {
      fa: 'برای تماس، کلاس آنلاین و کار در مسیر، سه اولویت مشخص کنید و بعد به فهرست مدل‌ها برسید.',
      en: 'Set three priorities for calling, online classes and commuting before shortlisting models.',
    },
    sections: [
      {
        heading: { fa: 'از برنامهٔ یک روز شروع کنید', en: 'Start with one day' },
        body: {
          fa: 'بنویسید گوشی کجا از شارژ دور می‌ماند، چند ساعت برای پیام‌رسان و کلاس استفاده می‌شود و آیا زیاد در فضای باز صفحه را می‌خوانید. همین کار اولویت باتری، نمایشگر و ارتباط را مشخص می‌کند.',
          en: 'Write down when you are away from a charger, how long you use messages and online classes, and how often you read outdoors. Use that list to rank battery, display and connectivity.',
        },
      },
      {
        heading: { fa: 'با ابزارهایی که دارید امتحان کنید', en: 'Test it with your existing gear' },
        body: {
          fa: 'هندزفری، سیم‌کارت و شارژر فعلی را همراه ببرید. تماس، میکروفون، وضوح متن و جا شدن گوشی در دست را بررسی کنید. این تست کوتاه از مرور ده‌ها عدد مشخصات سریع‌تر به تصمیم می‌رسد.',
          en: 'Bring your headphones, SIM and charger. Test calls, the microphone, text readability and how the phone feels in your hand. A short hands-on check can narrow a long specification list.',
        },
      },
      {
        heading: {
          fa: 'برای خرج‌های بعد از خرید هم جا بگذارید',
          en: 'Allow for costs after purchase',
        },
        body: {
          fa: 'قاب، محافظ، کابل و در صورت نیاز فضای پشتیبان را در همان بودجه بگذارید. در خرید کارکرده هزینهٔ احتمالی سرویس باتری و وضعیت ضمانت را کنار قیمت دستگاه ببینید.',
          en: 'Budget for the case, screen protector, cable and backup space if needed. When buying used, consider potential battery service and warranty coverage alongside the device price.',
        },
      },
    ],
  },
];
