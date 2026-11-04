import { headers } from 'next/headers';
import { localeFormat, translate } from './i18n';
import { getStorefront } from '../data/storefront-data';
import type { Locale } from '@sayman/web-shared/lib/shared/types.ts';
export async function getLocale(): Promise<Locale> {
  return (await headers()).get('x-shop-locale') === 'en' ? 'en' : 'fa';
}
export async function serverI18n() {
  const locale = await getLocale();
  return {
    locale,
    t: <T>(source: T, variables?: unknown[]) => translate(source, locale, variables),
    ...localeFormat(locale),
    ...(await getStorefront(locale)),
  };
}
