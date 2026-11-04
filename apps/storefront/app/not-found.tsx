'use client';
import { useI18n, useStorefront } from '@/components/navigation/locale-provider';
import Link from '@/components/navigation/localized-link';
import { ArrowLeft, Search } from 'lucide-react';
export default function NotFound() {
  const { t } = useI18n();
  useStorefront();
  return (
    <div className="container empty-state page-empty">
      <Search size={48} />
      <span className="eyebrow">{t('۴۰۴')}</span>
      <h1>{t('این مسیر به محصولی نمی‌رسد')}</h1>
      <p>{t('شاید انتخاب بعدی‌تان در میان محصولات فروشگاه باشد.')}</p>
      <Link className="button button-primary" href="/catalog">
        {t('مشاهدهٔ محصولات')}
        <ArrowLeft size={17} />
      </Link>
    </div>
  );
}
