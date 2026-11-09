import { ProductAccessories, ProductQuestions } from '@/components/shopping/product-help';
import { cache, Suspense } from 'react';
import { headers } from 'next/headers';
import { ProductsScope } from '@/components/navigation/locale-provider';
import {
  CatalogServiceError,
  getCatalogProducts,
  getCatalogPage,
} from '@/lib/catalog/catalog-server';
import { lookupInputSchema } from '@/lib/catalog/catalog-contract';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getLocale, serverI18n } from '@/lib/navigation/server-locale';
import { ProductDetail } from '@/components/catalog/product-detail';
import { ProductGrid } from '@/components/catalog/product-card';
import { CompareSimilar } from '@/components/catalog/compare-similar';
import { GuideLink } from '@/components/guides/guide-discovery';
import type { Product } from '@sayman/web-shared/lib/shared/types.ts';
import { ArrowLeft } from 'lucide-react';
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
  searchParams: Promise<{ variant?: string | string[]; examples?: string | string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const [snapshot, product] = await Promise.all([
    serverI18n(),
    getLocale().then((locale) => productBySlug(locale, slug)),
  ]);
  if (!product) notFound();
  const { variant, examples } = await searchParams;
  return pageMetadata(
    snapshot,
    snapshot.locale,
    `/product/${encodeURIComponent(product.slug)}`,
    product.name,
    product.description,
    {
      image: product.image,
      noindex: examples !== undefined || unavailableVariant(product.variants, variant),
    },
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
  searchParams: Promise<{ variant?: string | string[]; examples?: string | string[] }>;
}) {
  const { slug } = await params;
  const { variant, examples } = await searchParams;
  const [snapshot, product] = await Promise.all([
    serverI18n(),
    getLocale().then((locale) => productBySlug(locale, slug)),
  ]);
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
  const data = productStructuredData(snapshot, product, snapshot.locale);
  return (
    <ProductsScope products={[product]}>
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
        questions={
          <Suspense fallback={null}>
            <ProductQuestions product={product} snapshot={snapshot} examples={examples === '1'} />
          </Suspense>
        }
        relatedProducts={
          <>
            <Suspense fallback={null}>
              <ProductAccessories
                product={product}
                snapshot={snapshot}
                examples={examples === '1'}
              />
            </Suspense>
            <div className="guide-product-link">
              <GuideLink
                locale={snapshot.locale}
                slug={
                  snapshot.site.appearance?.showUsedProducts !== false &&
                  product.variants.some((item) => item.usedCondition)
                    ? 'used-device-checklist'
                    : 'compare-products'
                }
              />
            </div>
            <Suspense fallback={null}>
              <RelatedProducts product={product} snapshot={snapshot} />
            </Suspense>
          </>
        }
      />
    </ProductsScope>
  );
}

async function RelatedProducts({
  product,
  snapshot,
}: {
  product: Product;
  snapshot: Awaited<ReturnType<typeof serverI18n>>;
}) {
  const { t, locale, site } = snapshot;
  let related: Product[];
  try {
    const page = await getCatalogPage(
      locale,
      {
        categoryId: product.category,
        pageSize: 5,
        condition: site.appearance?.showUsedProducts === false ? 'new' : undefined,
      },
      AbortSignal.timeout(1500),
    );
    related = page.products
      .filter((item) => item.id !== product.id && item.category === product.category)
      .slice(0, 4);
  } catch (error) {
    if (error instanceof CatalogServiceError) return null;
    throw error;
  }
  if (!related.length) return null;
  return (
    <ProductsScope products={related}>
      <section className="related-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{t('نگاهی به انتخاب‌های دیگر')}</span>
            <h2>{t('کنار این انتخاب ببین')}</h2>
          </div>
          <Link
            className="text-link"
            href={`/catalog?category=${encodeURIComponent(product.category)}`}
          >
            {t('همهٔ محصولات')}
            <ArrowLeft size={17} />
          </Link>
        </div>
        <ProductGrid items={related} />
        <div className="guide-product-link">
          <CompareSimilar
            locale={locale}
            productId={product.id}
            variantIds={product.variants.map((item) => item.id)}
            similarIds={related.slice(0, 3).map((item) => item.id)}
          />
        </div>
      </section>
    </ProductsScope>
  );
}
