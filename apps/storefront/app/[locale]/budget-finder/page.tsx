import { GitCompareArrows, Search, Wallet } from 'lucide-react';
import { ProductGrid } from '@/components/catalog/product-card';
import { ProductsScope } from '@/components/navigation/locale-provider';
import Link from '@/components/navigation/localized-link';
import { localeHref } from '@/lib/navigation/i18n';
import { serverI18n } from '@/lib/navigation/server-locale';
import { CatalogServiceError, getCatalogPage } from '@/lib/catalog/catalog-server';
import { catalogInputSchema, catalogQueryParams } from '@/lib/catalog/catalog-contract';
import {
  budgetCatalogQuery,
  budgetComparison,
  budgetFinderPath,
  budgetHref,
  budgetMatches,
  budgetRequest,
  type BudgetSelection,
} from '@/lib/catalog/budget-finder';
import { pageMetadata, type SearchQuery } from '@/lib/seo/seo';
import type { Locale } from '@sayman/web-shared/lib/shared/types.ts';
import '@/components/budget-finder/budget-finder.css';

const intro = {
  fa: {
    title: 'پیداکنندهٔ کالا با بودجه',
    description:
      'بگو چه می‌خواهی و تا چقدر می‌خواهی هزینه کنی. گزینه‌های موجود را با قیمت همان تنوع ببین و مقایسه کن.',
  },
  en: {
    title: 'Budget finder',
    description:
      'Tell us what you are looking for and how much you want to spend. See and compare the exact variants in stock.',
  },
};
type Props = { searchParams: Promise<SearchQuery> };

export async function generateMetadata({ searchParams }: Props) {
  const [snapshot, query] = await Promise.all([serverI18n(), searchParams]);
  const { title, description } = intro[snapshot.locale];
  return pageMetadata(snapshot, snapshot.locale, budgetFinderPath, title, description, {
    noindex: Object.keys(query).length > 0,
  });
}

async function find(locale: Locale, selection: BudgetSelection) {
  const page = await getCatalogPage(locale, budgetCatalogQuery(selection));
  const matches = budgetMatches(page, selection);
  if (matches.length !== page.products.length || (page.total > 0 && matches.length === 0))
    throw new CatalogServiceError(503);
  if (matches.length) return { matches, total: page.total };
  // No second catalog request unless the original search has confirmed no match.
  const nearest = await getCatalogPage(
    locale,
    budgetCatalogQuery(selection, true),
    AbortSignal.timeout(2000),
  )
    .then((data) => budgetMatches(data, selection, true)[0])
    .catch((error: unknown) => {
      if (error instanceof CatalogServiceError) return undefined;
      throw error;
    });
  return { matches, total: 0, nearest };
}

export default async function BudgetFinder({ searchParams }: Props) {
  const [snapshot, query] = await Promise.all([serverI18n(), searchParams]);
  const { locale, site, categories, digits, toman } = snapshot;
  const fa = locale === 'fa';
  const text = (persian: string, english: string) => (fa ? persian : english);
  const allowUsed = site.appearance?.showUsedProducts !== false;
  const selection = budgetRequest(query, categories, allowUsed);
  const labels = intro[locale];
  const result =
    selection.kind === 'ready'
      ? await find(locale, selection).catch((error: unknown) => {
          if (error instanceof CatalogServiceError) return null;
          throw error;
        })
      : undefined;
  const comparison = result && budgetComparison(result.matches);
  const catalogHref =
    selection.kind === 'ready'
      ? '/catalog?' +
        catalogQueryParams(
          catalogInputSchema.parse({ ...budgetCatalogQuery(selection), pageSize: 12 }),
        )
      : '/catalog';
  const invalid = selection.kind === 'invalid';
  const formError = invalid
    ? {
        amount: text(
          'سقف بودجه را به تومان وارد کن؛ مثل ۲۵٬۰۰۰٬۰۰۰.',
          'Enter a budget in toman, for example 25,000,000.',
        ),
        category: text(
          'این دسته در دسترس نیست. یک دستهٔ موجود را انتخاب کن.',
          'That category is unavailable. Choose a category from the list.',
        ),
        condition: text(
          'این وضعیت کالا در دسترس نیست. یکی از گزینه‌های فرم را انتخاب کن.',
          'That product condition is unavailable. Choose one of the options in the form.',
        ),
      }[selection.error]
    : undefined;
  return (
    <div className="container budget-page">
      <header className="budget-hero">
        <div>
          <span className="eyebrow">
            {text('انتخاب بر اساس قیمت و موجودی', 'Shop by price and availability')}
          </span>
          <h1>{labels.title}</h1>
          <p>{labels.description}</p>
        </div>
        <Wallet size={52} className="budget-hero-icon" aria-hidden="true" />
      </header>
      <form
        key={JSON.stringify(query)}
        className="budget-form"
        action={localeHref(budgetFinderPath, locale)}
        method="get"
      >
        <label>
          {text('دستهٔ کالا', 'Product category')}
          <select
            name="category"
            defaultValue={selection.category}
            aria-invalid={(invalid && selection.error === 'category') || undefined}
          >
            <option value="">{text('همهٔ دسته‌ها', 'All categories')}</option>
            {categories.map((category) => (
              <option key={category.key} value={category.key}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        {allowUsed && (
          <label>
            {text('وضعیت کالا', 'Condition')}
            <select
              name="condition"
              defaultValue={selection.condition}
              aria-invalid={(invalid && selection.error === 'condition') || undefined}
            >
              <option value="new">{text('نو', 'New')}</option>
              <option value="used">{text('کارکرده', 'Used')}</option>
            </select>
          </label>
        )}
        <label>
          {text('سقف بودجه (تومان)', 'Budget limit (toman)')}
          <input
            name="budget"
            inputMode="decimal"
            type="text"
            dir="auto"
            defaultValue={selection.amount}
            required
            maxLength={32}
            placeholder={text('مثلاً ۲۵٬۰۰۰٬۰۰۰', 'e.g. 25,000,000')}
            aria-invalid={(invalid && selection.error === 'amount') || undefined}
            aria-describedby={formError ? 'budget-form-error' : undefined}
          />
        </label>
        <button className="button button-primary" type="submit">
          <Search size={18} aria-hidden="true" />
          {text('پیدا کردن کالا', 'Find products')}
        </button>
        {formError && (
          <p id="budget-form-error" className="budget-message" role="alert">
            {formError}
          </p>
        )}
      </form>
      {selection.kind === 'initial' && (
        <p className="budget-note">
          {text(
            'نتیجه‌ها بر اساس قیمت همان تنوع مرتب می‌شوند؛ از کمترین قیمت شروع می‌کنیم.',
            'Results start with the lowest-priced matching variant and are sorted by price.',
          )}
        </p>
      )}
      {result === null && (
        <p className="budget-message" role="alert">
          {text(
            'دریافت قیمت و موجودی ممکن نشد. دوباره دکمهٔ پیدا کردن کالا را بزن.',
            'Price and availability could not be loaded. Select Find products to try again.',
          )}
        </p>
      )}
      {result && selection.kind === 'ready' && (
        <section className="budget-results" aria-labelledby="budget-results-heading">
          <div className="section-heading">
            <div>
              <span className="eyebrow">
                {text('سقف بودجه: ', 'Budget limit: ')}
                <bdi>{toman(selection.maxPriceRial)}</bdi> {text('تومان', 'toman')}
              </span>
              <h2 id="budget-results-heading">
                {result.matches.length
                  ? text('انتخاب‌های موجود در بودجهٔ تو', 'In-stock options within your budget')
                  : text(
                      'فعلاً انتخابی در این بودجه پیدا نشد',
                      'No options found within this budget',
                    )}
              </h2>
              {result.matches.length > 0 && (
                <p>
                  {text(
                    `${digits(result.matches.length)} انتخاب از ${digits(result.total)} نتیجه · از کمترین قیمت`,
                    `${digits(result.matches.length)} of ${digits(result.total)} matches · Lowest price first`,
                  )}
                </p>
              )}
            </div>
            {comparison && (
              <Link className="button button-outline" href={comparison} prefetch={false}>
                <GitCompareArrows size={18} aria-hidden="true" />{' '}
                {text('مقایسهٔ انتخاب‌های هم‌دسته', 'Compare options in the same category')}
              </Link>
            )}
          </div>
          {result.matches.length > 0 && (
            <ProductsScope products={result.matches.map((m) => m.product)}>
              <ProductGrid
                items={result.matches.map((m) => m.product)}
                variantIds={Object.fromEntries(
                  result.matches.map((m) => [m.product.id, m.variant.id]),
                )}
              />
            </ProductsScope>
          )}
          {result.nearest && (
            <div className="budget-nearest">
              <strong>
                {text(
                  'کم‌هزینه‌ترین انتخاب موجود در همین محدودهٔ جست‌وجو',
                  'Lowest-priced in-stock option with these filters',
                )}
              </strong>
              <p>
                {result.nearest.product.name} · {result.nearest.variant.label} ·{' '}
                <bdi>{toman(result.nearest.variant.priceRial)}</bdi> {text('تومان', 'toman')}
              </p>
              <p>
                {text('بیشتر از بودجه: ', 'Over your budget by: ')}
                <bdi>
                  {toman(BigInt(result.nearest.variant.priceRial) - BigInt(selection.maxPriceRial))}
                </bdi>{' '}
                {text('تومان', 'toman')}
              </p>
              <Link
                className="button button-outline"
                href={budgetHref(selection, result.nearest.variant.priceRial)}
              >
                {text('جست‌وجو با این بودجه', 'Search with this budget')}
              </Link>
            </div>
          )}
          <Link
            className="text-link budget-catalog-link"
            href={result.matches.length ? catalogHref : '/catalog'}
          >
            {result.matches.length
              ? text('همهٔ نتیجه‌ها و فیلترهای بیشتر', 'See all results and more filters')
              : text('رفتن به کاتالوگ', 'Browse the catalog')}
          </Link>
        </section>
      )}
    </div>
  );
}
