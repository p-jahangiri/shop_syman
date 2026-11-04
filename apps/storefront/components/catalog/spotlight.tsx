import { Sparkles, ArrowUpLeft } from 'lucide-react';
import Link from '@/components/navigation/localized-link';
import Image from '@/components/media/content-image';
import { ProductGrid } from '@/components/catalog/product-card';
import type { HomeBlock, Product, Locale } from '@sayman/web-shared/lib/shared/types.ts';

export function Spotlight({
  block,
  products,
  locale,
  detail = false,
}: {
  block: HomeBlock;
  products: Product[];
  locale: Locale;
  detail?: boolean;
}) {
  if (!products.length) return null;
  const ends = block.endsAt
    ? new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Tehran',
      }).format(new Date(block.endsAt))
    : undefined;
  return (
    <section
      className={`spotlight-section${detail ? ' spotlight-detail' : ''}`}
      aria-label={block.title}
    >
      <div className="spotlight-heading">
        <div className="spotlight-copy">
          {block.eyebrow && (
            <span className="spotlight-eyebrow">
              <Sparkles size={15} aria-hidden="true" />
              {block.eyebrow}
            </span>
          )}
          <h2>{block.title}</h2>
          {block.description && <p>{block.description}</p>}
          {ends && (
            <small className="spotlight-end">
              {locale === 'fa' ? 'نمایش این مجموعه تا' : 'Collection shown until'}{' '}
              <time dateTime={block.endsAt}>{ends}</time> {locale === 'fa' ? '(تهران)' : '(Tehran)'}
            </small>
          )}
          {!detail && (
            <Link href={block.href ?? '/moments'} className="spotlight-action">
              {block.action || (locale === 'fa' ? 'دیدن این انتخاب‌ها' : 'Explore this collection')}
              <ArrowUpLeft size={19} aria-hidden="true" />
            </Link>
          )}
        </div>
        <div className="spotlight-art" aria-hidden="true">
          <span className="spotlight-orbit" />
          {products.slice(0, 2).map((product, index) => (
            <Image
              key={product.id}
              className={`spotlight-device device-${index}`}
              src={product.image}
              alt=""
              width={300}
              height={240}
            />
          ))}
        </div>
      </div>
      <div className="spotlight-products">
        <ProductGrid items={products} />
      </div>
    </section>
  );
}
