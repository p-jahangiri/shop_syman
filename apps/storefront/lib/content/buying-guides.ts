import type { Locale } from '@sayman/web-shared/lib/shared/types.ts';

type GuideCopy = {
  title: string;
  description: string;
  steps: readonly { title: string; body: string }[];
  takeaway: string;
};

export const buyingGuides = {
  'used-device-checklist': {
    fa: {
      title: 'چک‌لیست خرید گوشی کارکرده',
      description:
        'قبل از انتخاب یک گوشی کارکرده، گزارش همان دستگاه را بخوانید و این پنج مورد را بررسی کنید.',
      steps: [
        {
          title: 'گزارش همان دستگاه را پیدا کنید',
          body: 'رنگ، حافظه و تنوع را انتخاب کنید. گزارش سلامت یک دستگاه لزوماً دربارهٔ دستگاه دیگری از همان مدل صدق نمی‌کند.',
        },
        {
          title: 'باتری را جداگانه بررسی کنید',
          body: 'سلامت باتری و هر توضیحی دربارهٔ تعویض آن را بخوانید. نبود عدد یا عبارت «نامشخص» به معنی سالم بودن یا باتری صددرصد نیست.',
        },
        {
          title: 'عکس و وضعیت ظاهری را کنار هم ببینید',
          body: 'به لبه‌ها، نمایشگر، قاب و پشت دستگاه نگاه کنید. اگر بخشی از دستگاه در عکس مشخص نیست، پیش از سفارش درباره‌اش سؤال کنید.',
        },
        {
          title: 'وضعیت فنی را مرور کنید',
          body: 'نمایشگر و لمس، دوربین، شارژ، صدا و اتصال برای استفادهٔ روزانه مهم‌اند. بررسی‌نشده بودن یک مورد را با نتیجهٔ تست موفق اشتباه نگیرید.',
        },
        {
          title: 'شرایط خرید همان کالا را بخوانید',
          body: 'قیمت، اقلام همراه و توضیحات گارانتی را برای همان تنوع بررسی کنید. شرایط مرجوعی را پیش از ثبت سفارش بخوانید و هر ابهامی را از پشتیبانی بپرسید.',
        },
      ],
      takeaway:
        'اگر برای یکی از موارد پاسخ روشنی ندارید، پیش از خرید از پشتیبانی بپرسید. علامت‌زدن چک‌لیست فقط برای مرور شخصی است.',
    },
    en: {
      title: 'Used phone buying checklist',
      description:
        'Read the inspection report for the exact device you are considering and work through these five checks.',
      steps: [
        {
          title: 'Find the report for the exact device',
          body: 'Select the colour, storage and variant first. One unit’s inspection report does not apply to every phone of the same model.',
        },
        {
          title: 'Check the battery separately',
          body: 'Read the reported battery health and any notes about replacement. An absent or unknown reading does not mean the battery is healthy or at 100%.',
        },
        {
          title: 'Compare the photos and condition notes',
          body: 'Look at the edges, display, frame and back. Ask about anything you cannot clearly see in the photos before ordering.',
        },
        {
          title: 'Review the functional checks',
          body: 'Display and touch, camera, charging, sound and connectivity matter in everyday use. An untested item is different from a passed test.',
        },
        {
          title: 'Read the terms for that listing',
          body: 'Check the price, included items and any warranty notes for the chosen variant. Review the return terms and ask support if anything is unclear.',
        },
      ],
      takeaway:
        'Ask support before buying if you are unsure about any point. Checking a box only marks your own progress through this list.',
    },
  },
  'compare-products': {
    fa: {
      title: 'چطور دو گوشی یا لپ‌تاپ را مقایسه کنیم؟',
      description:
        'از نیاز روزمره شروع کنید، تنوع دقیق هر کالا را انتخاب کنید و تفاوت‌هایی را ببینید که روی خریدتان اثر دارند.',
      steps: [
        {
          title: 'سه اولویت خودتان را بنویسید',
          body: 'برای گوشی می‌تواند باتری، دوربین و حافظه باشد. برای لپ‌تاپ شاید وزن، رم و نوع درگاه مهم‌تر باشند. اولویت را بر اساس کار خودتان انتخاب کنید.',
        },
        {
          title: 'کالاهای هم‌دسته را کنار هم بگذارید',
          body: 'از کارت یا صفحهٔ کالا، گزینهٔ مقایسه را بزنید. در جدول مقایسه، هر ستون را روی رنگ یا ظرفیت موردنظر بگذارید تا اطلاعات همان تنوع را ببینید.',
        },
        {
          title: 'تفاوت‌ها را از مشخصات مشترک جدا کنید',
          body: 'گزینهٔ «فقط تفاوت‌ها» کمک می‌کند روی موارد متمایز تمرکز کنید. اگر مشخصه‌ای درج نشده است، درباره‌اش سؤال کنید؛ جای خالی به معنی صفر یا نداشتن آن قابلیت نیست.',
        },
        {
          title: 'قیمت و موجودی را دوباره بررسی کنید',
          body: 'قیمت و موجودی دو تنوع از یک مدل ممکن است متفاوت باشد. پیش از خرید به صفحهٔ همان تنوع برگردید. می‌توانید لینک مقایسه را برای مشورت بفرستید.',
        },
      ],
      takeaway:
        'اگر تفاوتی برای کار شما مهم نیست، به‌خاطر آن بودجهٔ بیشتری کنار نگذارید. جدول مقایسه را بر اساس اولویت‌های خودتان بخوانید.',
    },
    en: {
      title: 'How to compare two phones or laptops',
      description:
        'Start with your everyday needs, select the exact variants, and focus on the differences that matter to your purchase.',
      steps: [
        {
          title: 'Write down three priorities',
          body: 'For a phone, these might be battery life, camera and storage. For a laptop, weight, memory and ports may matter more. Choose based on the work you actually do.',
        },
        {
          title: 'Put products from the same category side by side',
          body: 'Select Compare from a product card or page. In the comparison table, choose the colour or capacity you want in each column to see that variant’s details.',
        },
        {
          title: 'Separate differences from shared features',
          body: 'Use the differences-only option to focus on what sets the products apart. Ask about missing specifications: a blank value does not mean zero or that the feature is absent.',
        },
        {
          title: 'Check price and availability again',
          body: 'Variants of the same model can have different prices and stock. Go back to the exact variant before buying. Share the comparison link if you want a second opinion.',
        },
      ],
      takeaway:
        'Avoid paying extra for a difference that does not matter to your work. Use your own priorities when reading the comparison table.',
    },
  },
} satisfies Record<string, Record<Locale, GuideCopy>>;

export type GuideSlug = keyof typeof buyingGuides;
export const guideSlugs = Object.keys(buyingGuides) as GuideSlug[];
export const guidesPath = '/guides';
export const guidePath = (slug: GuideSlug) => `${guidesPath}/${slug}`;
export const guidePaths = [guidesPath, ...guideSlugs.map(guidePath)];

export function findBuyingGuide(slug: string, locale: Locale): GuideCopy | undefined {
  return Object.hasOwn(buyingGuides, slug) ? buyingGuides[slug as GuideSlug][locale] : undefined;
}

export const guidesIntro = {
  fa: {
    title: 'راهنمای خرید سایمان',
    description: 'راهنمای مقایسهٔ کالای دیجیتال و چک‌لیست بررسی گوشی کارکرده، پیش از خرید.',
  },
  en: {
    title: 'Sayman buying guides',
    description: 'Compare digital products and check a used phone before you buy.',
  },
};
