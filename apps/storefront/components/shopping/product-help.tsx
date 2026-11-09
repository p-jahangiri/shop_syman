import { ProductsScope } from '@/components/navigation/locale-provider';
import { ProductQuestionBoard } from './product-question-board';
import { normalizePersian } from '@sayman/web-shared/lib/shared/commerce.ts';
import { ProductGrid } from '@/components/catalog/product-card';
import { getCatalogProducts } from '@/lib/catalog/catalog-server';
import { getProductHelp } from '@/lib/content/shopping-content';
import { availablePurchaseMethods } from '@/lib/catalog/purchasing';
import type { Product } from '@sayman/web-shared/lib/shared/types.ts';
import type { serverI18n } from '@/lib/navigation/server-locale';
import './shopping.css';

export async function ProductAccessories({
  product,
  snapshot,
  examples,
}: {
  product: Product;
  snapshot: Awaited<ReturnType<typeof serverI18n>>;
  examples: boolean;
}) {
  const { locale, purchaseMethods, site } = snapshot;
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const help = await getProductHelp(locale, product.id);
  const demo =
    examples &&
    help?.development &&
    !help.configured &&
    ['iphone-16', 'd70-sample-iphone-15'].includes(product.slug);
  const allowExamples = examples && help?.development;
  const ids = demo
    ? ['p12', '99d155372fda48d8b45c3533b286b169']
    : !help?.accessoriesIsDemo || allowExamples
      ? (help?.accessoryIds ?? [])
      : [];
  const items = ids.length
    ? await getCatalogProducts(locale, { productIds: ids }, AbortSignal.timeout(1400)).catch(
        () => [],
      )
    : [];
  const available = ids.flatMap((id) => {
    const item = items.find((p) => p.id.toLowerCase() === id.toLowerCase());
    if (!item || item.id === product.id) return [];
    const variants = item.variants.filter(
      (variant) =>
        variant.stock > 0 &&
        (site.appearance?.showUsedProducts !== false || !variant.usedCondition) &&
        availablePurchaseMethods(item, variant, purchaseMethods).length > 0,
    );
    return variants.length ? [{ ...item, variants }] : [];
  });

  if (!available.length) return null;
  return (
    <div className="shopping-sections">
      {available.length > 0 && (
        <section aria-labelledby="compatible-accessories">
          <div className="section-heading">
            <div>
              <span className="eyebrow">{text('انتخاب فروشگاه', 'Selected by the store')}</span>
              <h2 id="compatible-accessories">
                {text('خریدت را کامل کن', 'Complete your purchase')}
              </h2>
              {(demo || help?.accessoriesIsDemo) && (
                <p>
                  {text('نمونهٔ توسعه برای نمایش این بخش', 'Development example of this section')}
                </p>
              )}
            </div>
          </div>
          <ProductsScope products={available}>
            <ProductGrid items={available} />
          </ProductsScope>
        </section>
      )}
    </div>
  );
}

export async function ProductQuestions({
  product,
  snapshot,
  examples,
}: {
  product: Product;
  snapshot: Awaited<ReturnType<typeof serverI18n>>;
  examples: boolean;
}) {
  const { locale } = snapshot;
  const help = await getProductHelp(locale, product.id);
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const allowExamples = examples && help?.development;
  const demo =
    allowExamples &&
    !help?.configured &&
    ['iphone-16', 'd70-sample-iphone-15'].includes(product.slug);
  const questions = demo
    ? [
        {
          question: text(
            'قبل از خرید از کجا رنگ و حافظه را بررسی کنم؟',
            'Where can I check color and storage?',
          ),
          answer: text(
            'تنوع را در همین صفحه انتخاب کنید. قیمت و موجودی همان گزینه در بخش خرید به‌روز می‌شود.',
            'Choose a variant here to see its own price and stock in the purchase panel.',
          ),
        },
        {
          question: text(
            'آیا لوازم جانبی همراه گوشی حساب می‌شوند؟',
            'Are accessories included with the phone?',
          ),
          answer: text(
            'اقلام پیشنهادی جداگانه‌اند. مورد دلخواه را انتخاب کنید تا مبلغ همان کالا در سبد دیده شود.',
            'Suggested accessories are separate items. Select any item to see its price in the cart.',
          ),
        },
      ]
    : !help?.questionsIsDemo || allowExamples
      ? (help?.questions ?? [])
      : [];

  const seen = new Set<string>();
  const answers = [
    ...(help?.publishedAnswers ?? []),
    ...questions.map((row) => ({ ...row, demo: Boolean(demo || help?.questionsIsDemo) })),
  ].filter((row) => {
    if ('id' in row && row.id) return true;
    const key = normalizePersian(row.question);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return (
    <ProductQuestionBoard
      answers={answers}
      productId={product.id}
      name={product.name}
      slug={product.slug}
      connected={snapshot.dataSource === 'api'}
    />
  );
}
