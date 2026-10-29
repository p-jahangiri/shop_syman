import { cache } from 'react';
import { headers } from 'next/headers';
import { ProductsScope } from '@/components/locale-provider';
import { getCatalogProducts, getCatalogPage } from '@/lib/catalog-server';
import { lookupInputSchema } from '@/lib/catalog-contract';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { serverI18n } from '@/lib/server-locale';
import { ProductDetail } from '@/components/product-detail';
import { pageMetadata, productStructuredData, jsonLd } from '@/lib/seo';
const productBySlug = cache(async (locale: 'fa' | 'en', slug: string) => {
  if (!lookupInputSchema.safeParse({ slugs: [slug] }).success) notFound();
  return (await getCatalogProducts(locale, { slugs: [slug] }))[0];
});
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const snapshot = await serverI18n();
  const product = await productBySlug(snapshot.locale, slug);
  if (!product) notFound();
  return pageMetadata(
    snapshot,
    snapshot.locale,
    `/product/${encodeURIComponent(product.slug)}`,
    product.name,
    product.description,
    { image: product.image },
  );
}
export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ variant?: string }>;
}) {
  const { slug } = await params;
  const { variant } = await searchParams;
  const snapshot = await serverI18n();
  const product = await productBySlug(snapshot.locale, slug);
  if (!product) notFound();
  const related = (
    await getCatalogPage(snapshot.locale, { categoryId: product.category, pageSize: 5 })
  ).products
    .filter((p) => p.id !== product.id)
    .slice(0, 4);
  const data = productStructuredData(snapshot, product, snapshot.locale);
  return (
    <ProductsScope products={[product, ...related]}>
      {data.length > 0 && (
        <script
          nonce={(await headers()).get('x-nonce') ?? undefined}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLd(data) }}
        />
      )}
      <ProductDetail
        key={`${product.id}:${variant ?? 'default'}`}
        product={product}
        initialVariantId={variant}
        relatedProducts={related}
      />
    </ProductsScope>
  );
}
