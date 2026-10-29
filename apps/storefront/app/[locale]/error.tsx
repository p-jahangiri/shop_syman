'use client';
import { useI18n, useStorefront } from '@/components/locale-provider';
import { RefreshCcw } from 'lucide-react';
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  useStorefront();
  return (
    <div className="container empty-state page-empty">
      <RefreshCcw size={42} />
      <h1>{t('این صفحه دوباره به یک فرصت نیاز دارد')}</h1>
      <p>{t('بارگذاری کامل نشد. لطفاً دوباره تلاش کنید.')}</p>
      <button className="button button-primary" onClick={reset}>
        {t('تلاش دوباره')}
      </button>
    </div>
  );
}
