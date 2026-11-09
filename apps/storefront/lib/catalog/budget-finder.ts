import { normalizePersian } from '@sayman/web-shared/lib/shared/commerce.ts';
import { parseToman, tomanInput } from '@sayman/web-shared/lib/shared/money.ts';
import type { Category } from '@sayman/web-shared/lib/shared/types.ts';
import type { CatalogCondition, CatalogPage, CatalogQuery } from './catalog-contract.ts';
import { comparisonHref } from './comparison.ts';
import type { SearchQuery } from '../seo/seo.ts';

export const budgetFinderPath = '/budget-finder';
const resultLimit = 8;
type BudgetFilter = { category: string; condition: CatalogCondition };
export type BudgetSelection = BudgetFilter & { amount: string; maxPriceRial: string };
export type BudgetRequest = BudgetFilter &
  (
    | { kind: 'initial'; amount: '' }
    | { kind: 'invalid'; amount: string; error: 'amount' | 'category' | 'condition' }
    | (BudgetSelection & { kind: 'ready' })
  );

export function budgetRequest(
  query: SearchQuery,
  categories: readonly Category[],
  allowUsed: boolean,
): BudgetRequest {
  const rawAmount = typeof query.budget === 'string' ? query.budget : '';
  const amount = rawAmount.slice(0, 32);
  const category =
    typeof query.category === 'string' && categories.some((c) => c.key === query.category)
      ? query.category
      : '';
  const condition = allowUsed && query.condition === 'used' ? 'used' : 'new';
  const form = { category, condition, amount } as const;
  if (query.budget === undefined && query.category === undefined && query.condition === undefined)
    return { kind: 'initial', ...form, amount: '' };
  if (query.category !== undefined && query.category !== '' && !category)
    return { kind: 'invalid', ...form, error: 'category' };
  if (query.condition !== undefined && query.condition !== condition)
    return { kind: 'invalid', ...form, error: 'condition' };
  const value =
    rawAmount.length <= 32
      ? parseToman(
          normalizePersian(amount)
            .trim()
            .replace(/[ ,٬\u00a0\u202f]/g, '')
            .replace('٫', '.'),
        )
      : undefined;
  if (value === undefined) return { kind: 'invalid', ...form, error: 'amount' };
  return { kind: 'ready', ...form, amount: tomanInput(value), maxPriceRial: value.toString() };
}

export function budgetCatalogQuery(
  selection: BudgetSelection,
  nearest = false,
): Partial<CatalogQuery> {
  return {
    categoryId: selection.category || undefined,
    condition: selection.condition,
    availableOnly: true,
    maxPriceRial: nearest ? undefined : selection.maxPriceRial,
    sort: 'price-asc',
    page: 1,
    pageSize: nearest ? 1 : resultLimit,
  };
}

export function budgetHref(selection: BudgetFilter, priceRial: string) {
  return `${budgetFinderPath}?${new URLSearchParams({
    category: selection.category,
    condition: selection.condition,
    budget: tomanInput(priceRial),
  })}`;
}

// The API chooses one matching SKU per product. Never display a different
// colour, condition or price when availability has changed during hydration.
export function budgetMatches(page: CatalogPage, selection: BudgetSelection, nearest = false) {
  const cap = BigInt(selection.maxPriceRial);
  return page.products.flatMap((product) => {
    const variant = product.variants.find((v) => v.id === page.matchingVariantIds[product.id]);
    if (
      !variant ||
      variant.stock <= 0 ||
      Boolean(variant.usedCondition) !== (selection.condition === 'used')
    )
      return [];
    const price = BigInt(variant.priceRial);
    return (nearest ? price > cap : price <= cap) ? [{ product, variant }] : [];
  });
}

export function budgetComparison(matches: ReturnType<typeof budgetMatches>) {
  const groups = new Map<string, typeof matches>();
  for (const match of matches) {
    const key = match.product.category;
    const group = groups.get(key);
    if (group) group.push(match);
    else groups.set(key, [match]);
  }
  const group = [...groups.values()].find((items) => items.length >= 2)?.slice(0, 4);
  return group
    ? comparisonHref(
        group.map((m) => m.product.id),
        group.map((m) => m.variant.id),
      )
    : undefined;
}
