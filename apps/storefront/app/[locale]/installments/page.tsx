import { notFound } from 'next/navigation';
import { serverI18n } from '@/lib/navigation/server-locale';
import { getCatalogProducts } from '@/lib/catalog/catalog-server';
import { lookupInputSchema } from '@/lib/catalog/catalog-contract';
import { ProductsScope } from '@/components/navigation/locale-provider';
import { Installments } from '@/components/credit/installments';
import { isPurchaseKindEnabled } from '@/lib/catalog/purchasing';
export async function generateMetadata() {
  const { t, locale, purchaseMethods } = await serverI18n();
  return {
    title: isPurchaseKindEnabled(purchaseMethods, 'cheque')
      ? t('راهنما و محاسبهٔ خرید چکی')
      : locale === 'fa'
        ? 'صفحه در دسترس نیست'
        : 'Page unavailable',
    robots: { index: false, follow: false },
  };
}
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ product?: string; variant?: string }>;
}) {
  const { locale, purchaseMethods } = await serverI18n();
  if (!isPurchaseKindEnabled(purchaseMethods, 'cheque')) notFound();
  const query = await searchParams;
  if (query.product && !lookupInputSchema.safeParse({ slugs: [query.product] }).success) notFound();
  const products = query.product
    ? await getCatalogProducts(locale, { slugs: [query.product] })
    : [];
  if (query.product && !products.length) notFound();
  return (
    <ProductsScope products={products}>
      <Installments key={`${query.product ?? 'custom'}:${query.variant ?? ''}`} />
    </ProductsScope>
  );
}
