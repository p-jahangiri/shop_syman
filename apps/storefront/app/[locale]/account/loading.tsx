'use client';
import { useI18n } from '@/components/locale-provider';
export default function Loading() {
  const { t } = useI18n();
  return (
    <div className="container loading-page" aria-label={t('در حال بارگذاری')}>
      <div className="skeleton skeleton-title" />
      <div className="product-grid">
        {[1, 2, 3, 4].map((x) => (
          <div key={x} className="skeleton skeleton-card" />
        ))}
      </div>
    </div>
  );
}
