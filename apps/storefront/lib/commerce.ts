import type { CartLine, ChequePlan, MoneyRial, Product } from './types.ts';
import { formatToman, percentBasisPoints } from './money.ts';

export function normalizePersian(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6f0))
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660))
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[\u200c\s]+/g, ' ')
    .trim()
    .toLowerCase();
}
export const digits = (value: number | bigint | string) =>
  new Intl.NumberFormat('fa-IR').format(typeof value === 'string' ? BigInt(value) : value);
export function toman(rial: MoneyRial | bigint): string {
  return formatToman(rial);
}
export function discount(price: MoneyRial, compareAt?: MoneyRial): number {
  const original = BigInt(compareAt ?? price);
  return original > BigInt(price) ? Number(((original - BigInt(price)) * 100n) / original) : 0;
}
export function findVariant(products: Product[], id: string) {
  for (const product of products) {
    const variant = product.variants.find((v) => v.id.toLowerCase() === id.toLowerCase());
    if (variant) return { product, variant };
  }
  return undefined;
}
export function sanitizeCart(input: unknown, products: Product[]): CartLine[] {
  if (!Array.isArray(input)) return [];
  const quantities = new Map<string, number>();
  for (const line of input) {
    if (
      !line ||
      typeof line !== 'object' ||
      typeof line.variantId !== 'string' ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity <= 0
    )
      continue;
    const found = findVariant(products, line.variantId);
    if (found?.variant.stock)
      quantities.set(
        line.variantId,
        Math.min((quantities.get(line.variantId) ?? 0) + line.quantity, found.variant.stock),
      );
  }
  return Array.from(quantities, ([variantId, quantity]) => ({ variantId, quantity }));
}
export function cartTotal(lines: CartLine[], products: Product[]): bigint {
  return sanitizeCart(lines, products).reduce(
    (total, line) =>
      total +
      BigInt(findVariant(products, line.variantId)!.variant.priceRial) * BigInt(line.quantity),
    0n,
  );
}
// Sample quote only. The backend will own actual commercial rules after approval.
export function chequeQuote(amountRial: bigint, plan: ChequePlan) {
  if (
    amountRial < 0n ||
    !Number.isSafeInteger(plan.months) ||
    plan.months <= 0 ||
    plan.months > 60 ||
    !Number.isSafeInteger(plan.intervalMonths) ||
    plan.intervalMonths <= 0 ||
    plan.months % plan.intervalMonths !== 0 ||
    !['1', '10'].includes(plan.roundingUnitRial ?? '10')
  )
    throw new Error('Invalid installment terms');
  const downBasisPoints = percentBasisPoints(plan.downPaymentPercent, 100);
  const markupBasisPoints = percentBasisPoints(plan.markupPercent, 1000);
  const unit = BigInt(plan.roundingUnitRial ?? '10');
  const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;
  const roundedDown = ceil(amountRial * downBasisPoints, 10000n * unit) * unit;
  const downPayment = roundedDown > amountRial ? amountRial : roundedDown;
  const financed = amountRial - downPayment;
  const markup = ceil(financed * markupBasisPoints, 10000n * unit) * unit;
  const count = plan.months / plan.intervalMonths;
  const totalCredit = financed + markup;
  const regular = (totalCredit / unit / BigInt(count)) * unit;
  const installments = Array.from({ length: count }, (_, i) =>
    i === count - 1 ? totalCredit - regular * BigInt(count - 1) : regular,
  );
  return { downPayment, markup, installments, total: downPayment + totalCredit };
}
export function matchesSearch(product: Product, query: string): boolean {
  const aliases: Record<string, string> = {
    ایفون: 'آیفون',
    ايفون: 'آیفون',
    'پلی استیشن': 'playstation',
    ایرپاد: 'airpods',
    ps5: 'playstation',
    سامسونگ: 'samsung',
    اپل: 'apple',
    'مک بوک': 'macbook',
  };
  let normalized = normalizePersian(query);
  for (const [from, to] of Object.entries(aliases))
    normalized = normalized.replaceAll(normalizePersian(from), normalizePersian(to));
  const haystack = normalizePersian(
    `${product.name} ${product.englishName} ${product.brand} ${Object.values(product.attributes).join(' ')} ${product.variants.flatMap((v) => Object.values(v.attributes ?? {})).join(' ')}`,
  );
  return normalized.split(' ').every((term) => haystack.includes(term));
}
export function filterVariants(
  product: Product,
  filters: {
    availableOnly?: boolean;
    maxPriceRial?: bigint;
    attributes?: Record<string, string[]>;
  } = {},
) {
  return product.variants.filter(
    (v) =>
      (!filters.availableOnly || v.stock > 0) &&
      (filters.maxPriceRial === undefined || BigInt(v.priceRial) <= filters.maxPriceRial) &&
      Object.entries(filters.attributes ?? {}).every(
        ([key, values]) =>
          !values.length || values.includes(v.attributes?.[key] ?? product.attributes[key]),
      ),
  );
}
