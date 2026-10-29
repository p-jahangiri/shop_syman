import type { Locale } from './types.ts';
import { formatToman } from './money.ts';
import en from './messages/en.json' with { type: 'json' };
import { productDescriptionsEn } from './messages/product-content.ts';

export function translate<T>(source: T, locale: Locale, variables?: unknown[]): T {
  if (typeof source !== 'string') return source;
  let value: string = source;
  if (locale === 'en') {
    const key = source.replace(/\s+/g, ' ').trim();
    value = (en as Record<string, string>)[source] ?? (en as Record<string, string>)[key] ?? source;
    if (value === source && /[\u0600-\u06ff]/.test(value)) {
      value = value.replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6f0));
      for (const [fa, english] of [
        ['میلی‌آمپرساعت', 'mAh'],
        ['میلی‌آمپر', 'mAh'],
        ['گیگابایت', 'GB'],
        ['ترابایت', 'TB'],
        ['مگاپیکسل', 'MP'],
        ['کیلوگرم', 'kg'],
        ['میلیون', 'million'],
        ['اینچ', 'inches'],
        ['گرم', 'g'],
        ['وات', 'W'],
        ['ماهه', 'months'],
        ['ماه', 'month'],
        ['متر', 'm'],
      ])
        value = value.replaceAll(fa, english);
    }
  }
  variables?.forEach((variable, index) => {
    value = value.replaceAll(`{${index}}`, String(variable));
  });
  return value as T;
}
export function localizeData<T>(value: T, locale: Locale): T {
  if (locale === 'fa') return value;
  if (typeof value === 'string') return translate(value, locale);
  if (Array.isArray(value)) return value.map((v) => localizeData(v, locale)) as T;
  if (value && typeof value === 'object') {
    const result = Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, localizeData(v, locale)]),
    );
    if ('englishName' in value && typeof value.englishName === 'string') {
      result.name = value.englishName;
      const id = 'id' in value ? String(value.id) : '';
      if (productDescriptionsEn[id]) result.description = productDescriptionsEn[id];
    }
    return result as T;
  }
  return value;
}
export const stripLocale = (path: string) => path.replace(/^\/(fa|en)(?=\/|\?|#|$)/, '') || '/';
export function localeHref(path: string, locale: Locale) {
  if (!path.startsWith('/') || path.startsWith('//') || /^\/api(?:\/|$)/.test(path)) return path;
  const stripped = stripLocale(path);
  return `/${locale}${stripped === '/' ? '' : stripped}`;
}
export function localeFormat(locale: Locale) {
  const digits = (value: number | bigint | string) =>
    new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US').format(
      typeof value === 'string' ? BigInt(value) : value,
    );
  return { digits, toman: (value: bigint | string) => formatToman(value, locale) };
}
