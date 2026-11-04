import {
  getCatalogPage,
  getCatalogProducts,
  getCatalogFilters,
} from '@/lib/catalog/catalog-server';
import { ProductsScope } from '@/components/navigation/locale-provider';
import { pageMetadata } from '@/lib/seo/seo';
import { Fragment } from 'react';
import { serverI18n } from '@/lib/navigation/server-locale';
import Link from '@/components/navigation/localized-link';
import Image from '@/components/media/content-image';
import { ArrowLeft, ArrowUpLeft, Sparkles, Check, CreditCard, PackageSearch } from 'lucide-react';
import { ProductGrid } from '@/components/catalog/product-card';
import { HomeCollection } from '@/components/content/home-collection';
import { Button } from '@/components/shared/ui';
import { Spotlight } from '@/components/catalog/spotlight';
import { activeHomeBlocks, curatedProducts } from '@/lib/content/home-blocks';
import type { HomeBlock } from '@sayman/web-shared/lib/shared/types.ts';
import { isPurchaseContentEnabled, isPurchaseHrefEnabled } from '@/lib/catalog/purchasing';
import { isUsedCatalogHref } from '@sayman/web-shared/lib/content/appearance.ts';
import './home-page.css';
const lines = (text: string) =>
  text.split('\n').map((line, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {line}
    </Fragment>
  ));
export async function generateMetadata() {
  const snapshot = await serverI18n();
  return pageMetadata(
    snapshot,
    snapshot.locale,
    '/',
    snapshot.site.seo?.title ?? snapshot.site.tagline,
    snapshot.site.seo?.description ?? snapshot.site.about,
  );
}
export default async function HomePage() {
  const { locale, t, site, categories, purchaseMethods } = await serverI18n();
  const showUsedProducts = site.appearance?.showUsedProducts !== false;
  const linkVisible = (href: string) =>
    isPurchaseHrefEnabled(href, purchaseMethods) && (showUsedProducts || !isUsedCatalogHref(href));
  const now = Date.now();
  const blocks: HomeBlock[] = site.homeBlocks ?? [
    { id: 'categories', kind: 'categories', enabled: true, title: t('دنیای دیجیتال تو') },
    { id: 'collection', kind: 'collection', enabled: true },
  ];
  const active = activeHomeBlocks(blocks, now).filter(
    (block) =>
      isPurchaseContentEnabled(block, purchaseMethods) &&
      (showUsedProducts || !block.href || !isUsedCatalogHref(block.href)),
  );
  const productBlocks = active.filter(
    (b) => b.kind === 'products' || b.kind === 'collection' || b.kind === 'spotlight',
  );
  const [productRows, brands] = await Promise.all([
    Promise.all(
      productBlocks.map(async (b) => {
        const limit = b.limit ?? 4;
        const result =
          b.kind === 'spotlight' && !b.productIds?.length
            ? { products: [] }
            : b.productIds?.length
              ? { products: await getCatalogProducts(locale, { productIds: b.productIds }) }
              : await getCatalogPage(locale, {
                  categoryId: b.categoryId,
                  condition: 'new',
                  pageSize: limit,
                });
        const ordered = b.productIds?.length
          ? curatedProducts(b, result.products)
          : result.products;
        return [
          b.id,
          {
            products: ordered
              .filter((p) => !b.categoryId || p.category === b.categoryId)
              .slice(0, limit),
            variantIds: 'matchingVariantIds' in result ? result.matchingVariantIds : undefined,
          },
        ] as const;
      }),
    ),
    active.some((b) => b.kind === 'brands')
      ? getCatalogFilters(locale, undefined, undefined, 'new').then((filters) => filters.brands)
      : [],
  ]);
  const byBlock = new Map(productRows);
  const products = [...byBlock.values()].flatMap((row) => row.products);
  const heroImage =
    site.hero.image ?? products.find((p) => p.featured)?.image ?? products[0]?.image;
  const heading = (block: HomeBlock) => (
    <div className="section-heading">
      <div>
        {block.eyebrow && <span className="eyebrow">{block.eyebrow}</span>}
        {block.title && <h2>{lines(block.title)}</h2>}
        {block.description && <p className="home-section-description">{block.description}</p>}
      </div>
      {block.href && block.action && (
        <Link href={block.href} className="text-link">
          {block.action}
          <ArrowLeft size={17} />
        </Link>
      )}
    </div>
  );
  return (
    <ProductsScope products={products}>
      <div className="home-page">
        <div className="container">
          {isPurchaseContentEnabled(site.hero, purchaseMethods) ? (
            <section
              className="hero"
              aria-labelledby="home-hero-title"
              data-has-art={Boolean(heroImage || site.hero.visualTitle || site.hero.floatingTitle)}
            >
              <div className="hero-copy">
                {site.hero.eyebrow && (
                  <span className="hero-eyebrow">
                    <span aria-hidden="true" />
                    {site.hero.eyebrow}
                  </span>
                )}
                <h1 id="home-hero-title">
                  {site.hero.title.split('\n').map((line, i) => (
                    <Fragment key={i}>
                      {i > 0 && <br />}
                      {i === 0 ? line : <span>{line}</span>}
                    </Fragment>
                  ))}
                </h1>
                <p>{site.hero.description}</p>
                <div className="hero-actions">
                  {site.hero.action.trim() && linkVisible(site.hero.actionHref ?? '/catalog') && (
                    <Button asChild>
                      <Link href={site.hero.actionHref ?? '/catalog'}>
                        {site.hero.action}
                        <ArrowUpLeft size={20} />
                      </Link>
                    </Button>
                  )}
                  {site.hero.secondary.trim() &&
                    linkVisible(site.hero.secondaryHref ?? '/installments') && (
                      <Link
                        href={site.hero.secondaryHref ?? '/installments'}
                        className="hero-secondary"
                      >
                        {site.hero.secondary}
                        <ArrowLeft size={16} />
                      </Link>
                    )}
                </div>
                {site.hero.footnote && (
                  <div className="hero-bottom">
                    <Sparkles size={16} aria-hidden="true" />
                    <span>{site.hero.footnote}</span>
                  </div>
                )}
              </div>
              <div className="hero-visual">
                <span className="hero-orbit orbit-one" aria-hidden="true" />
                <span className="hero-orbit orbit-two" aria-hidden="true" />
                {site.hero.visualTitle && (
                  <span className="hero-word" aria-hidden="true">
                    {lines(site.hero.visualTitle)}
                  </span>
                )}
                {heroImage && (
                  <Image
                    src={heroImage}
                    alt=""
                    width={700}
                    height={560}
                    loading="eager"
                    fetchPriority="high"
                    sizes="(max-width: 600px) calc(100vw - 32px), (max-width: 1344px) 46vw, 620px"
                  />
                )}
                {site.hero.floatingTitle && (
                  <div className="hero-floating">
                    <span className="floating-icon" aria-hidden="true">
                      <Sparkles size={21} />
                    </span>
                    <div>
                      <strong>{site.hero.floatingTitle}</strong>
                      {site.hero.floatingDescription && (
                        <span>{site.hero.floatingDescription}</span>
                      )}
                    </div>
                  </div>
                )}
                <span className="hero-index" aria-hidden="true">
                  <i />
                  {site.latinName}
                </span>
              </div>
            </section>
          ) : (
            <h1 className="sr-only">{site.name}</h1>
          )}
          {active.map((block) => {
            if (block.kind === 'categories')
              return (
                <section key={block.id} className="category-section">
                  {heading(block)}
                  <div className="category-grid">
                    {categories.map((c, i) => (
                      <Link
                        key={c.key}
                        href={`/catalog?category=${encodeURIComponent(c.key)}`}
                        className="category-card"
                        data-tone={i % 4}
                      >
                        <div className="home-category-copy">
                          <h3>{c.name}</h3>
                          {c.description && <p>{c.description}</p>}
                        </div>
                        <div className="home-category-visual" aria-hidden="true">
                          <span className="category-arrow">
                            <ArrowUpLeft size={16} />
                          </span>
                          <Image src={c.image} alt="" width={124} height={99} sizes="124px" />
                        </div>
                      </Link>
                    ))}
                    {showUsedProducts && (
                      <Link
                        href="/catalog?condition=used"
                        className="category-card home-category-used"
                      >
                        <div className="home-category-copy">
                          <h3>{locale === 'fa' ? 'کالاهای کارکرده' : 'Used products'}</h3>
                          <p>
                            {locale === 'fa' ? 'همراه با جزئیات وضعیت کالا' : 'Browse by condition'}
                          </p>
                        </div>
                        <div className="home-category-visual" aria-hidden="true">
                          <span className="category-arrow">
                            <ArrowUpLeft size={16} />
                          </span>
                          <PackageSearch className="home-category-symbol" strokeWidth={1.4} />
                        </div>
                      </Link>
                    )}
                  </div>
                </section>
              );
            if (block.kind === 'collection')
              return (
                <HomeCollection
                  key={block.id}
                  eyebrow={block.eyebrow}
                  title={block.title}
                  description={block.description}
                  action={block.action}
                  href={block.href}
                  categoryId={block.categoryId}
                  pageSize={block.limit ?? 4}
                  initialProducts={byBlock.get(block.id)?.products ?? []}
                  initialVariantIds={byBlock.get(block.id)?.variantIds}
                />
              );
            if (block.kind === 'promotions') {
              const promotions =
                block.items?.filter(
                  (item) =>
                    isPurchaseContentEnabled(item, purchaseMethods) && linkVisible(item.href),
                ) ?? [];
              if (!promotions.length) return null;
              return (
                <section key={block.id} className="promo-grid">
                  {promotions.map((item, i) => (
                    <Link
                      key={`${item.href}:${i}`}
                      href={item.href}
                      className={`promo-card ${i % 2 ? 'laptop-promo' : 'gaming-promo'}`}
                    >
                      <div>
                        <span className="pill">{item.eyebrow}</span>
                        <h2>{lines(item.title)}</h2>
                        <span className="promo-cta">
                          {item.action}
                          <ArrowUpLeft size={18} />
                        </span>
                      </div>
                      <Image
                        src={item.image}
                        alt=""
                        width={420}
                        height={336}
                        sizes="(max-width: 600px) 260px, 420px"
                      />
                      <span className="promo-watermark" aria-hidden="true">
                        {item.watermark}
                      </span>
                    </Link>
                  ))}
                </section>
              );
            }
            if (block.kind === 'spotlight')
              return (
                <Spotlight
                  key={block.id}
                  block={block}
                  products={byBlock.get(block.id)?.products ?? []}
                  locale={locale}
                />
              );
            if (block.kind === 'products') {
              const row = byBlock.get(block.id);
              return row?.products.length ? (
                <section key={block.id} className="deals-section">
                  {heading(block)}
                  <ProductGrid items={row.products} variantIds={row.variantIds} />
                </section>
              ) : null;
            }
            if (block.kind === 'brands' && brands.length)
              return (
                <section key={block.id} className="brands-section">
                  {heading({ ...block, title: block.title ?? t('برندها') })}
                  <div className="brands-row">
                    {brands.map((brand) => (
                      <Link
                        key={brand.id}
                        href={`/catalog?brand=${encodeURIComponent(brand.id)}`}
                        data-wordmark={brand.name.toLowerCase()}
                      >
                        <bdi>{brand.name}</bdi>
                      </Link>
                    ))}
                  </div>
                </section>
              );
            if (
              block.kind === 'cheque' &&
              purchaseMethods.some((m) => m.enabled && m.kind === 'cheque')
            )
              return (
                <section key={block.id} className="cheque-banner">
                  <div className="cheque-art" aria-hidden="true">
                    <div className="cheque-paper">
                      <div className="paper-heading">
                        {site.latinName}
                        <CreditCard size={21} />
                      </div>
                      <span>{site.tagline}</span>
                      <div className="paper-lines">
                        <i />
                        <i />
                        <i />
                      </div>
                      <div className="paper-stamp">
                        <Check size={29} />
                      </div>
                    </div>
                    <div className="cheque-spark">✳</div>
                  </div>
                  <div className="cheque-copy">
                    <span className="eyebrow">{block.eyebrow}</span>
                    <h2>{lines(block.title ?? '')}</h2>
                    <p>{block.description}</p>
                    {block.href && block.action && (
                      <Button asChild>
                        <Link href={block.href}>
                          {block.action}
                          <ArrowLeft size={18} />
                        </Link>
                      </Button>
                    )}
                  </div>
                </section>
              );
            return null;
          })}
        </div>
      </div>
    </ProductsScope>
  );
}
