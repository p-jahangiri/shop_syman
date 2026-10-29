import { notFound } from 'next/navigation';
import { serverI18n } from '@/lib/server-locale';
import { getCatalogProducts } from '@/lib/catalog-server';
import { lookupInputSchema } from '@/lib/catalog-contract';
import { ProductsScope } from '@/components/locale-provider';
import { Installments } from '@/components/installments';
export async function generateMetadata() {
  const { t } = await serverI18n();
  return { title: t('راهنما و محاسبهٔ خرید چکی') };
}
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ product?: string; variant?: string }>;
}) {
  const query = await searchParams;
  const { locale } = await serverI18n();
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
