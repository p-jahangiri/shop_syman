'use client';
import { Globe2 } from 'lucide-react';
import { languageSwitchTarget } from '@/lib/language-switch-target';
import { useI18n } from './locale-provider';
export function LanguageSwitch() {
  const { locale } = useI18n();
  const next = locale === 'fa' ? 'en' : 'fa';
  return (
    <button
      type="button"
      className="language-switch"
      lang={next}
      aria-label={locale === 'fa' ? 'Switch to English' : 'تغییر زبان به فارسی'}
      onClick={() =>
        window.location.assign(
          languageSwitchTarget(
            window.location.pathname,
            window.location.search,
            window.location.hash,
            next,
          ),
        )
      }
    >
      <Globe2 size={15} />
      {next === 'en' ? 'EN' : 'فا'}
    </button>
  );
}
