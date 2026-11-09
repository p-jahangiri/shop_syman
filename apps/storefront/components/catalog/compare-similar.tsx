'use client';

import { useSearchParams } from 'next/navigation';
import { GitCompareArrows } from 'lucide-react';
import Link from '../navigation/localized-link';
import { comparisonHref } from '@/lib/catalog/comparison';
import type { Locale } from '@sayman/web-shared/lib/shared/types.ts';

export function CompareSimilar({
  locale,
  productId,
  variantIds,
  similarIds,
}: {
  locale: Locale;
  productId: string;
  variantIds: string[];
  similarIds: string[];
}) {
  const variant = useSearchParams().get('variant');
  const href = comparisonHref(
    [productId, ...similarIds],
    variant && variantIds.includes(variant) ? [variant, ...similarIds.map(() => '')] : [],
  );
  return (
    <Link className="button button-outline" href={href} prefetch={false}>
      <GitCompareArrows size={18} aria-hidden="true" />
      {locale === 'fa' ? 'مقایسه با کالاهای مشابه' : 'Compare with similar products'}
    </Link>
  );
}
