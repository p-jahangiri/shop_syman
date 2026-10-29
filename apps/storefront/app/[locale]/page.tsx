import { getCatalogPage, getCatalogProducts, getCatalogFilters } from '@/lib/catalog-server';
import { ProductsScope } from '@/components/locale-provider';
import { pageMetadata } from '@/lib/seo';
import { Fragment } from 'react';
import { serverI18n } from '@/lib/server-locale';
import Link from '@/components/localized-link';
import Image from '@/components/content-image';
import { ArrowLeft, ArrowUpLeft, Sparkles, Check, CreditCard } from 'lucide-react';
import { ProductGrid } from '@/components/product-card';
import { HomeCollection } from '@/components/home-collection';
import { Button } from '@/components/ui';
import { Spotlight } from '@/components/spotlight';
import { ScrollRail } from '@/components/scroll-rail';
import { activeHomeBlocks, curatedProducts } from '@/lib/home-blocks';
import type { HomeBlock } from '@/lib/types';
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
  const { locale, t, digits, site, categories, purchaseMethods } = await serverI18n();
  const now = Date.now();
  const blocks: HomeBlock[] = site.homeBlocks ?? [
    { id: 'categories', kind: 'categories', enabled: true, title: t('دنیای دیجیتال تو') },
    { id: 'collection', kind: 'collection', enabled: true },
  ];
  const active = activeHomeBlocks(blocks, now);
  const productBlocks = active.filter(
    (b) => b.kind === 'products' || b.kind === 'collection' || b.kind === 'spotlight',
  );
  const byBlock = new Map(
    await Promise.all(
      productBlocks.map(async (b) => {
        const limit = b.kind === 'collection' ? 4 : (b.limit ?? 4);
        const records =
          b.kind === 'spotlight' && !b.productIds?.length
            ? []
            : b.productIds?.length
              ? await getCatalogProducts(locale, { productIds: b.productIds })
              : (await getCatalogPage(locale, { categoryId: b.categoryId, pageSize: limit }))
                  .products;
        const ordered = b.productIds?.length ? curatedProducts(b, records) : records;
        return [
          b.id,
          ordered.filter((p) => !b.categoryId || p.category === b.categoryId).slice(0, limit),
        ] as const;
      }),
    ),
  );
  const products = [...byBlock.values()].flat();
  const heroImage =
    site.hero.image ?? products.find((p) => p.featured)?.image ?? products[0]?.image;
  const brands = active.some((b) => b.kind === 'brands')
    ? (await getCatalogFilters(locale)).brands
    : [];
  const heading = (block: HomeBlock) => (
    <div className="section-heading">
      <div>
        {block.eyebrow && <span className="eyebrow">{block.eyebrow}</span>}
        {block.title && <h2>{lines(block.title)}</h2>}
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
          <section className="hero" aria-labelledby="home-hero-title">
            <div className="hero-copy">
              <span className="hero-eyebrow">
                <span />
                {site.hero.eyebrow}
              </span>
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
                <Button asChild>
                  <Link href={site.hero.actionHref ?? '/catalog'}>
                    {site.hero.action}
                    <ArrowUpLeft size={20} />
                  </Link>
                </Button>
                <Link href={site.hero.secondaryHref ?? '/installments'} className="hero-secondary">
                  {site.hero.secondary}
                  <ArrowLeft size={16} />
                </Link>
              </div>
              {site.hero.footnote && (
                <div className="hero-bottom">
                  <div className="hero-mini-icons" aria-hidden="true">
                    <span>
                      <Check size={14} />
                    </span>
                    <span>
                      <Sparkles size={14} />
                    </span>
                    <span>
                      <CreditCard size={14} />
                    </span>
                  </div>
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
                  alt={site.hero.title.replaceAll('\n', ' ')}
                  width={700}
                  height={560}
                  loading="eager"
                  fetchPriority="high"
                  sizes="(max-width: 600px) calc(100vw - 32px), (max-width: 1344px) 46vw, 620px"
                />
              )}
              {site.hero.floatingTitle && (
                <div className="hero-floating">
                  <span className="floating-icon">
                    <Sparkles size={21} />
                  </span>
                  <div>
                    <strong>{site.hero.floatingTitle}</strong>
                    <span>{site.hero.floatingDescription}</span>
                  </div>
                </div>
              )}
              <span className="hero-index" aria-hidden="true">
                01 <i />
                {site.latinName}
              </span>
            </div>
          </section>
          <div className="preview-note">
            <span className="live-dot" />
            {t('پیش‌نمایش فروشگاه سایمان · کالاها و شرایط نمونه‌اند؛ خرید واقعی فعال نیست.')}
          </div>
          {active.map((block) => {
            if (block.kind === 'categories')
              return (
                <section key={block.id} className="category-section">
                  {heading(block)}
                  <ScrollRail label={block.title ?? t('دنیای دیجیتال تو')}>
                    <div className="category-grid">
                      {categories.map((c, i) => (
                        <Link
                          key={c.key}
                          href={`/catalog?category=${encodeURIComponent(c.key)}`}
                          className={`category-card category-${c.key}`}
                          data-tone={i % 4}
                        >
                          <div>
                            <span className="category-index">{digits(i + 1)}</span>
                            <h3>{c.name}</h3>
                            <p>{c.description}</p>
                            <span className="category-arrow">
                              <ArrowUpLeft size={20} />
                            </span>
                          </div>
                          <Image src={c.image} alt="" width={230} height={184} sizes="160px" />
                        </Link>
                      ))}
                    </div>
                  </ScrollRail>
                </section>
              );
            if (block.kind === 'collection')
              return (
                <HomeCollection
                  key={block.id}
                  eyebrow={block.eyebrow}
                  title={block.title}
                  action={block.action}
                  initialProducts={byBlock.get(block.id) ?? []}
                />
              );
            if (block.kind === 'promotions')
              return (
                <section key={block.id} className="promo-grid">
                  {block.items?.map((item, i) => (
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
            if (block.kind === 'spotlight')
              return (
                <Spotlight
                  key={block.id}
                  block={block}
                  products={byBlock.get(block.id) ?? []}
                  locale={locale}
                />
              );
            if (block.kind === 'products') {
              const items = byBlock.get(block.id) ?? [];
              return items.length ? (
                <section key={block.id} className="deals-section">
                  {heading(block)}
                  <ProductGrid items={items} />
                </section>
              ) : null;
            }
            if (block.kind === 'brands')
              return (
                <section key={block.id} className="brands-section">
                  <span>{block.description}</span>
                  <div className="brands-row">
                    {brands.map((brand) => (
                      <span key={brand.id}>{brand.name}</span>
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
