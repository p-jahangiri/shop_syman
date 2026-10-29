import { localeHref } from './i18n.ts';
import type { Locale } from './types.ts';
export function languageSwitchTarget(pathname: string, search: string, hash: string, next: Locale) {
  if (/^\/(?:fa|en)\/blog\/?$/.test(pathname) || /^\/blog\/?$/.test(pathname)) {
    const params = new URLSearchParams(search);
    params.delete('cursor');
    search = params.size ? '?' + params : '';
  }
  return localeHref(pathname, next) + search + hash;
}
