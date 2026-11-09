import { CustomerTickets } from '@/components/support/customer-tickets';
import { getCatalogProducts } from '@/lib/catalog/catalog-server';
import { developmentExamples } from '@/lib/content/shopping-content';
import { getLocale } from '@/lib/navigation/server-locale';
import { notFound } from 'next/navigation';

export const metadata = {
  title: 'Sayman · Purchase requests',
  robots: { index: false, follow: false },
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    product?: string;
    question?: string;
    examples?: string;
    variant?: string;
  }>;
}) {
  const [locale, query] = await Promise.all([getLocale(), searchParams]);
  const slug = query.question ?? query.product;
  if (slug !== undefined && (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,139}$/.test(slug)))
    notFound();
  const [product, examples] = await Promise.all([
    slug ? getCatalogProducts(locale, { slugs: [slug] }).then((items) => items[0]) : undefined,
    query.examples === '1' && developmentExamples(),
  ]);
  if (query.question && !product) notFound();
  const variant = product?.variants.find((item) => item.id === query.variant);
  return (
    <CustomerTickets
      shoppingRequest={{
        kind: query.question ? 'product-question' : 'phone',
        product: product?.name.slice(0, 95),
        slug: product?.slug,
        variant: variant?.label,
        variantId: variant?.id,
        examples,
      }}
    />
  );
}
