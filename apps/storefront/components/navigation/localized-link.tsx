'use client';
import NextLink from 'next/link';
import { usePathname as useNextPathname, useRouter as useNextRouter } from 'next/navigation';
import type { ComponentProps } from 'react';
import { localeHref, stripLocale } from '@/lib/navigation/i18n';
import { useI18n } from './locale-provider';
export default function Link({ href, ...props }: ComponentProps<typeof NextLink>) {
  const { locale } = useI18n();
  return (
    <NextLink
      href={
        typeof href === 'string'
          ? localeHref(href, locale)
          : { ...href, pathname: localeHref(href.pathname ?? '/', locale) }
      }
      {...props}
    />
  );
}
export function usePathname() {
  return stripLocale(useNextPathname());
}
export function useRouter() {
  const router = useNextRouter();
  const { locale } = useI18n();
  return {
    ...router,
    push: (href: string) => router.push(localeHref(href, locale)),
    replace: (href: string) => router.replace(localeHref(href, locale)),
  };
}
