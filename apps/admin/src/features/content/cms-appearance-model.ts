import { motionPresets } from '@sayman/web-shared/lib/content/appearance.ts';
import type { SiteAppearance } from '@sayman/web-shared/lib/shared/types.ts';

export const layoutAppearanceChoices = [
  {
    key: 'surface',
    label: 'سطح هدر و کارت‌ها',
    hint: 'شیشه‌ای با شفافیت محدود؛ در مرورگرهای قدیمی سطح ساده نمایش داده می‌شود.',
    options: [
      { value: 'glass', label: 'شیشه‌ای' },
      { value: 'solid', label: 'یکدست' },
    ],
  },
  {
    key: 'density',
    label: 'فاصله‌گذاری محتوا',
    hint: 'فشرده فاصلهٔ بین محتوا را کمتر می‌کند؛ دکمه‌ها و ناحیهٔ لمس خوانا می‌مانند.',
    options: [
      { value: 'comfortable', label: 'راحت و باز' },
      { value: 'compact', label: 'فشرده' },
    ],
  },
  {
    key: 'corners',
    label: 'گوشهٔ کارت‌ها',
    hint: 'فرم کارت، پنل و بخش‌های اصلی فروشگاه را هماهنگ می‌کند.',
    options: [
      { value: 'rounded', label: 'گرد' },
      { value: 'soft', label: 'نرم و کم‌انحنا' },
    ],
  },
  {
    key: 'cards',
    label: 'سبک کارت کالا',
    hint: 'ظاهر کارت‌های خانه، کاتالوگ و پیشنهادهای مرتبط را تغییر می‌دهد.',
    options: [
      { value: 'classic', label: 'کلاسیک' },
      { value: 'outline', label: 'قاب‌دار' },
      { value: 'editorial', label: 'تصویر لب‌به‌لب' },
    ],
  },
  {
    key: 'navigation',
    label: 'سبک پیوندهای منو',
    hint: 'ظاهر پیوندها را تغییر می‌دهد. عنوان، مقصد و ترتیب از بخش منو می‌آیند.',
    options: [
      { value: 'links', label: 'پیوند ساده' },
      { value: 'pills', label: 'دکمه‌های کپسولی' },
    ],
  },
  {
    key: 'heroLayout',
    label: 'چیدمان ابتدای صفحه',
    hint: 'چیدمان دوقسمتی برای معرفی تصویری و چیدمان فشرده برای دسترسی سریع‌تر به کالاهاست.',
    options: [
      { value: 'split', label: 'متن و تصویر در کنار هم' },
      { value: 'compact', label: 'معرفی فشرده' },
    ],
  },
] as const;

const motionPresetLabels = {
  lift: 'بالاآمدن نرم',
  glow: 'درخشش قاب',
  ripple: 'موج نور',
};

export const motionAppearanceChoices = [
  {
    key: 'motion',
    label: 'شدت حرکت',
    hint: 'تنظیم کاهش حرکت دستگاه همیشه اولویت دارد.',
    options: [
      { value: 'subtle', label: 'ملایم' },
      { value: 'full', label: 'برجسته' },
      { value: 'none', label: 'خاموش' },
    ],
  },
  {
    key: 'motionPreset',
    label: 'سبک جلوه',
    hint: 'نمونهٔ سبک انتخابی را با دکمهٔ پخش در پیش‌نمایش ببینید.',
    options: motionPresets.map((value) => ({ value, label: motionPresetLabels[value] })),
  },
] as const;

export const appearanceChoices = [...layoutAppearanceChoices, ...motionAppearanceChoices] as const;

export type AppearanceChoice = (typeof appearanceChoices)[number];
export type AppearanceChoiceKey = AppearanceChoice['key'];

export function setAppearanceChoice(
  current: SiteAppearance | undefined,
  key: AppearanceChoiceKey,
  value: string,
): SiteAppearance {
  const choice = appearanceChoices.find((entry) => entry.key === key);
  if (!choice?.options.some((option) => option.value === value))
    throw new Error('گزینهٔ ظاهر فروشگاه معتبر نیست.');
  return { ...current, [key]: value };
}
