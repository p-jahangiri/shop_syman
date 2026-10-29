import type { SiteAppearance } from '../../storefront/lib/types';

export const appearanceChoices = [
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
    key: 'motion',
    label: 'حرکت و انیمیشن',
    hint: 'تنظیم کاهش حرکت دستگاه همیشه اولویت دارد؛ حرکت خودکار و بی‌پایان نداریم.',
    options: [
      { value: 'subtle', label: 'حرکت کوتاه و ملایم' },
      { value: 'none', label: 'بدون انیمیشن تزئینی' },
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

export type AppearanceChoiceKey = (typeof appearanceChoices)[number]['key'];

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
