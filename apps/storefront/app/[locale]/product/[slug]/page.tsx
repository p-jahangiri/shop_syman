import { cache } from 'react';
import { headers } from 'next/headers';
import { ProductsScope } from '@/components/navigation/locale-provider';
import { getCatalogProducts, getCatalogPage } from '@/lib/catalog/catalog-server';
import { lookupInputSchema } from '@/lib/catalog/catalog-contract';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { serverI18n } from '@/lib/navigation/server-locale';
import { ProductDetail } from '@/components/catalog/product-detail';
import Link from '@/components/navigation/localized-link';
import { pageMetadata, productStructuredData, jsonLd } from '@/lib/seo/seo';
const productBySlug = cache(async (locale: 'fa' | 'en', slug: string) => {
  if (!lookupInputSchema.safeParse({ slugs: [slug] }).success) notFound();
  return (await getCatalogProducts(locale, { slugs: [slug] }))[0];
});
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ variant?: string | string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const snapshot = await serverI18n();
  const product = await productBySlug(snapshot.locale, slug);
  if (!product) notFound();
  const { variant } = await searchParams;
  return pageMetadata(
    snapshot,
    snapshot.locale,
    `/product/${encodeURIComponent(product.slug)}`,
    product.name,
    product.description,
    { image: product.image, noindex: unavailableVariant(product.variants, variant) },
  );
}
function unavailableVariant(variants: { id: string }[], variant: string | string[] | undefined) {
  return (
    variant !== undefined &&
    (typeof variant !== 'string' || !variants.some((item) => item.id === variant))
  );
}
export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ variant?: string | string[] }>;
}) {
  const { slug } = await params;
  const { variant } = await searchParams;
  const snapshot = await serverI18n();
  const product = await productBySlug(snapshot.locale, slug);
  if (!product) notFound();
  if (unavailableVariant(product.variants, variant)) {
    const fa = snapshot.locale === 'fa';
    return (
      <section className="container empty-state">
        <h1>{fa ? 'این تنوع دیگر در دسترس نیست' : 'This variant is no longer available'}</h1>
        <p>{product.name}</p>
        <Link
          className="button button-outline"
          href={`/product/${encodeURIComponent(product.slug)}`}
        >
          {fa ? 'مشاهدهٔ تنوع‌های فعلی کالا' : 'See current product variants'}
        </Link>
      </section>
    );
  }
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
        initialVariantId={typeof variant === 'string' ? variant : undefined}
        relatedProducts={related}
      />
    </ProductsScope>
  );
}
