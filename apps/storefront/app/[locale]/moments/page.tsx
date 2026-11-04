import { serverI18n } from '@/lib/navigation/server-locale';
import { pageMetadata } from '@/lib/seo/seo';
import { activeHomeBlocks, curatedProducts } from '@/lib/content/home-blocks';
import { getCatalogProducts } from '@/lib/catalog/catalog-server';
import { ProductsScope } from '@/components/navigation/locale-provider';
import { Spotlight } from '@/components/catalog/spotlight';
import Link from '@/components/navigation/localized-link';
import { isUsedCatalogHref } from '@sayman/web-shared/lib/content/appearance.ts';

export async function generateMetadata() {
  const snapshot = await serverI18n();
  return pageMetadata(
    snapshot,
    snapshot.locale,
    '/moments',
    snapshot.t('انتخاب‌های ویژهٔ {0}', [snapshot.site.name]),
    snapshot.t('کالاهای منتخب فروشگاه و شرایط هر کالا را یک‌جا ببینید.'),
  );
}
export default async function MomentsPage() {
  const { locale, site, t } = await serverI18n();
  const blocks = activeHomeBlocks(site.homeBlocks ?? [], Date.now()).filter(
    (block) =>
      block.kind === 'spotlight' &&
      (site.appearance?.showUsedProducts !== false ||
        !block.href ||
        !isUsedCatalogHref(block.href)),
  );
  const collections = await Promise.all(
    blocks.map(async (block) => ({
      block,
      products: curatedProducts(
        block,
        block.productIds?.length
          ? await getCatalogProducts(locale, { productIds: block.productIds })
          : [],
      ),
    })),
  );
  const visible = collections.filter((collection) => collection.products.length);
  return (
    <ProductsScope products={visible.flatMap((collection) => collection.products)}>
      <div className="container moments-page">
        <header className="page-heading">
          <span className="eyebrow">{site.latinName}</span>
          <h1>{t('انتخاب‌های ویژهٔ {0}', [site.name])}</h1>
          <p>{t('کالاهای منتخب فروشگاه و شرایط هر کالا را یک‌جا ببینید.')}</p>
        </header>
        {visible.length ? (
          visible.map(({ block, products }) => (
            <Spotlight key={block.id} block={block} products={products} locale={locale} detail />
          ))
        ) : (
          <div className="empty-state">
            <h2>{t('هنوز مجموعهٔ ویژه‌ای منتشر نشده است.')}</h2>
            <Link href="/catalog" className="text-link">
              {t('کشف محصولات')}
            </Link>
          </div>
        )}
      </div>
    </ProductsScope>
  );
}
