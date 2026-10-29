import type { AttributeDefinition, Category, Product, Variant } from './types.ts';

export type ComparisonQuery = Record<string, string | string[] | undefined>;
export type ComparisonSelection =
  { valid: true; shared: boolean; ids: string[]; variants: string[] } | { valid: false };
const validId = (id: unknown): id is string =>
  typeof id === 'string' &&
  id.length > 0 &&
  id.length <= 64 &&
  id.trim() === id &&
  // eslint-disable-next-line no-control-regex -- Reject forbidden control characters at the trust boundary.
  !/[\u0000-\u001f\u007f]/.test(id);
export function parseComparisonSelection(query: ComparisonQuery): ComparisonSelection {
  const values = (key: string) =>
    query[key] === undefined
      ? []
      : Array.isArray(query[key])
        ? (query[key] as string[])
        : [query[key] as string];
  const ids = values('id'),
    variants = values('variant'),
    view = values('view');
  if (
    ids.length > 4 ||
    ids.some((id) => !validId(id)) ||
    new Set(ids).size !== ids.length ||
    (variants.length !== 0 && variants.length !== ids.length) ||
    variants.some((id) => id !== '' && !validId(id)) ||
    view.length > 1 ||
    view.some((v) => v !== 'shared')
  )
    return { valid: false };
  return { valid: true, shared: ids.length > 0 || view.length === 1, ids, variants };
}
export function comparisonHref(ids: string[], variants: string[] = []) {
  const parsed = parseComparisonSelection({ view: 'shared', id: ids, variant: variants });
  if (!parsed.valid) throw Error('Invalid comparison selection');
  const params = new URLSearchParams({ view: 'shared' });
  ids.forEach((id) => params.append('id', id));
  variants.forEach((id) => params.append('variant', id));
  return `/compare?${params}`;
}
export interface ComparisonColumn {
  product: Product;
  variant: Variant | null;
  requestedVariant: string;
}
export function comparisonColumns(
  products: Product[],
  ids: string[],
  selected: Readonly<Record<string, string>>,
): ComparisonColumn[] {
  return ids.flatMap((id) => {
    const product = products.find((p) => p.id === id);
    if (!product) return [];
    const requestedVariant = selected[id] ?? '';
    const variant = requestedVariant
      ? (product.variants.find((v) => v.id === requestedVariant) ?? null)
      : (product.variants.find((v) => v.stock > 0) ?? product.variants[0] ?? null);
    return [{ product, variant, requestedVariant }];
  });
}
export interface ComparisonRow {
  key: string;
  label: string;
  values: (string | null)[];
  different: boolean;
}
export function comparisonRows(
  columns: ComparisonColumn[],
  category: Category,
  definitions: AttributeDefinition[],
  labels: Record<string, string>,
): ComparisonRow[] {
  if (columns.some((c) => c.product.category !== category.key))
    throw Error('Comparison requires a single category');
  const keys =
    category.attributeRules === undefined
      ? definitions.filter((d) => d.comparable).map((d) => d.key)
      : category.attributeRules.filter((r) => r.comparable).map((r) => r.key);
  return keys
    .filter((key, index) => keys.indexOf(key) === index && definitions.some((d) => d.key === key))
    .flatMap((key) => {
      const values = columns.map(({ product, variant }) => {
        if (!variant) return null;
        const source =
          variant.attributes && Object.hasOwn(variant.attributes, key)
            ? variant.attributes
            : product.attributes;
        return Object.hasOwn(source, key) && source[key].trim() !== '' ? source[key] : null;
      });
      if (values.every((v) => v === null)) return [];
      return [
        {
          key,
          label: labels[key] ?? definitions.find((d) => d.key === key)!.name,
          values,
          different: new Set(values).size > 1,
        },
      ];
    });
}
